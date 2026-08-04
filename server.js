require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { google } = require('googleapis');
const { extractDocId, extractTables, readDocument, appendTransposedChart } = require('./src/docs');
const {
  isChordTable, isRomanNumeralTable, transposeCellText,
  detectKeyFromChart, transposeNote
} = require('./src/transpose');
const { readTokens, writeTokens, clearTokens } = require('./src/session');

const app = express();
const PORT = process.env.PORT || 3000;

// When deployed, BASE_URL is the public https origin (e.g. https://chords.onrender.com).
// Locally it falls back to localhost. The OAuth redirect URI is derived from it, so it
// must exactly match an "Authorized redirect URI" in the Google Cloud console.
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const IS_PROD = BASE_URL.startsWith('https://');
const SECRET = process.env.SESSION_SECRET || 'chord-transposer-dev';

// Hosting platforms terminate TLS at a proxy; without this Express sees http and
// refuses to set the secure cookie.
app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const REDIRECT_URI = `${BASE_URL}/auth/callback`;

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

// The redirect URI is derived from BASE_URL, so if BASE_URL does not match the
// origin the browser actually used, the flow is already broken: Google rejects
// it with redirect_uri_mismatch, or succeeds and then sends the user to the
// wrong origin where the session cookie does not exist. Catch it here, where we
// can say what is wrong, rather than at Google, where the error is opaque.
function originMismatch(req) {
  const actual = `${req.protocol}://${req.get('host')}`;
  return actual === BASE_URL ? null : { actual, configured: BASE_URL };
}

// Builds an authenticated client from the cookie. googleapis silently exchanges
// the refresh token for a new access token when the old one expires; the
// 'tokens' event lets us write the refreshed values back so that exchange only
// happens once per hour rather than on every request.
function getAuthedClient(req, res) {
  const tokens = readTokens(req, SECRET);
  if (!tokens) return null;

  const client = getOAuth2Client();
  client.setCredentials(tokens);

  client.on('tokens', (fresh) => {
    // A refresh response omits refresh_token, so preserve the stored one.
    const merged = { ...tokens, ...fresh };
    if (!merged.refresh_token) merged.refresh_token = tokens.refresh_token;
    if (!res.headersSent) writeTokens(res, merged, SECRET, IS_PROD);
  });

  return client;
}

// A revoked or expired refresh token can only be fixed by signing in again,
// so drop the cookie and let the UI fall back to the sign-in screen.
function isAuthFailure(err) {
  const reason = err && (err.response?.data?.error || err.message || '');
  return typeof reason === 'string' &&
    (reason.includes('invalid_grant') || reason.includes('invalid_token'));
}

const REQUIRED_VARS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Diagnostics are often read on a phone, so give them a readable shell.
function configPage(body) {
  return `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Configuration error</title>` +
    `<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;` +
    `max-width:40rem;margin:2rem auto;padding:0 1rem;color:#1a1a2e}` +
    `code{background:#f0f0f5;padding:.15rem .4rem;border-radius:4px;` +
    `word-break:break-all;font-size:.9em}h1{font-size:1.3rem}h2{font-size:1.05rem;margin-top:1.5rem}` +
    `li{margin:.5rem 0}</style>` + body;
}

// Distinguishes "never set" from "set to an empty/placeholder value", and lists
// the names of any similar-looking variables so a typo in the key is visible.
// Only names are ever shown — never values.
function diagnoseConfig() {
  const problems = [];
  for (const key of REQUIRED_VARS) {
    const val = process.env[key];
    if (val === undefined) problems.push({ key, issue: 'not set' });
    else if (!val.trim()) problems.push({ key, issue: 'set but empty' });
    else if (/^(sync:|false$|your_|<|changeme)/i.test(val.trim())) {
      problems.push({ key, issue: 'looks like a placeholder rather than a real credential' });
    } else if (key === 'GOOGLE_CLIENT_ID' && !val.trim().endsWith('.apps.googleusercontent.com')) {
      problems.push({ key, issue: 'does not look like a client ID (should end in .apps.googleusercontent.com)' });
    }
  }
  // Deliberately narrow: matching a bare /SECRET/ would surface unrelated
  // platform variables and bury a genuine typo in noise.
  const similar = Object.keys(process.env)
    .filter(k => !REQUIRED_VARS.includes(k) && /GOOGLE|CLIENT/i.test(k))
    .sort();
  return { problems, similar };
}

app.get('/auth', (req, res) => {
  // Without credentials the generated URL omits client_id and Google answers
  // with an opaque "Missing required parameter: client_id" page. Say what is
  // actually wrong instead.
  const { problems, similar } = diagnoseConfig();
  if (problems.length) {
    return res.status(500).send(configPage(
      `<h1>Configuration error</h1><ul>` +
      problems.map(p => `<li><code>${escapeHtml(p.key)}</code> &mdash; ${escapeHtml(p.issue)}</li>`).join('') +
      `</ul>` +
      (similar.length
        ? `<p>Other variables that look related (names only): <code>` +
          similar.map(escapeHtml).join('</code>, <code>') + `</code>. ` +
          `If one of these is a misspelling of the names above, rename it.</p>`
        : '') +
      `<p>Set the real values from the Google Cloud console under your host's ` +
      `environment settings, then redeploy. In <code>render.yaml</code>, ` +
      `<code>sync: false</code> only marks a variable as a secret to be entered ` +
      `in the dashboard &mdash; it is not itself a value.</p>`
    ));
  }

  const mismatch = originMismatch(req);
  if (mismatch) {
    return res.status(500).send(
      configPage(
        `<h1>Configuration error</h1>` +
        `<p>This app is being used at <code>${escapeHtml(mismatch.actual)}</code>, ` +
        `but <code>BASE_URL</code> is set to <code>${escapeHtml(mismatch.configured)}</code>.</p>` +
        `<p>Sign-in would fail with <code>redirect_uri_mismatch</code>, because the app ` +
        `would ask Google to return to <code>${escapeHtml(REDIRECT_URI)}</code>.</p>` +
        `<h2>Fix</h2><ol>` +
        `<li>Set <code>BASE_URL</code> to exactly:<br><code>${escapeHtml(mismatch.actual)}</code></li>` +
        `<li>Add this to <b>Authorized redirect URIs</b> in the Google Cloud console:<br>` +
        `<code>${escapeHtml(mismatch.actual)}/auth/callback</code></li>` +
        `<li>Redeploy.</li></ol>` +
        `<p>Both must match character for character &mdash; no trailing slash on ` +
        `<code>BASE_URL</code>, and <code>https</code> not <code>http</code> once deployed.</p>`
      )
    );
  }

  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    // 'offline' + forced consent guarantees Google returns a refresh token,
    // which is the credential that makes the session durable.
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/documents'],
    prompt: 'consent'
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(req.query.code);
    writeTokens(res, tokens, SECRET, IS_PROD);
    res.redirect('/');
  } catch (err) {
    console.error('Auth error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  clearTokens(res, IS_PROD);
  res.redirect('/');
});

app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!readTokens(req, SECRET) });
});

app.get('/api/document', async (req, res) => {
  const auth = getAuthedClient(req, res);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  const docId = extractDocId(url);
  if (!docId) return res.status(400).json({ error: 'Invalid Google Doc URL. Expected a URL like https://docs.google.com/document/d/...' });

  try {
    const doc = await readDocument(auth, docId);
    const tables = extractTables(doc);

    const chordCharts = tables
      .filter(t => isChordTable(t.data) && !isRomanNumeralTable(t.data))
      .map((t, i) => ({
        index: i,
        data: t.data,
        rows: t.rows,
        columns: t.columns,
        detectedKey: detectKeyFromChart(t.data)
      }));

    res.json({
      title: doc.title,
      documentId: doc.documentId,
      chordCharts
    });
  } catch (err) {
    console.error('Document read error:', err.message);
    if (isAuthFailure(err)) {
      clearTokens(res, IS_PROD);
      return res.status(401).json({ error: 'Your Google sign-in expired. Please sign in again.' });
    }
    if (err.code === 404) return res.status(404).json({ error: 'Document not found. Check the URL and make sure you have access.' });
    if (err.code === 403) return res.status(403).json({ error: 'No access to this document. Make sure it is shared with your Google account.' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transpose', async (req, res) => {
  const auth = getAuthedClient(req, res);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  const { documentId, chartIndex, semitones, useFlats } = req.body;
  if (!documentId) return res.status(400).json({ error: 'Missing documentId' });
  if (semitones === undefined || semitones === 0) return res.status(400).json({ error: 'Semitones must be non-zero' });

  try {
    const doc = await readDocument(auth, documentId);
    const tables = extractTables(doc);
    const chordCharts = tables.filter(t => isChordTable(t.data) && !isRomanNumeralTable(t.data));

    const chart = chordCharts[chartIndex || 0];
    if (!chart) return res.status(404).json({ error: 'Chord chart not found in document' });

    const transposed = chart.data.map((row) =>
      row.map((cell, c) => {
        if (c === 0) return cell;
        return transposeCellText(cell, semitones, useFlats);
      })
    );

    const originalKey = detectKeyFromChart(chart.data);
    const newKey = transposeNote(originalKey, semitones, useFlats);
    const direction = semitones > 0 ? '+' : '';
    const title = `Transposed to ${newKey} (${direction}${semitones} semitones from ${originalKey})`;

    await appendTransposedChart(auth, documentId, transposed, title);

    res.json({ success: true, title, transposedChart: transposed });
  } catch (err) {
    console.error('Transpose error:', err.message);
    if (isAuthFailure(err)) {
      clearTokens(res, IS_PROD);
      return res.status(401).json({ error: 'Your Google sign-in expired. Please sign in again.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Bind 0.0.0.0 so the app is reachable from other devices on the network
// (and from the host platform's proxy when deployed).
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Chord Transposer running on port ${PORT}`);
  console.log(`Base URL:     ${BASE_URL}`);
  // Printed so it can be copied straight into the Google Cloud console; a
  // mismatch here is the single most common cause of a failed sign-in.
  console.log(`Redirect URI: ${REDIRECT_URI}`);
  if (!process.env.BASE_URL) {
    console.warn('WARNING: BASE_URL is not set, so the redirect URI above points at localhost.');
    console.warn('         Set BASE_URL to the public https origin when deploying.');
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('WARNING: GOOGLE_CLIENT_ID is not set. Copy .env.example to .env and fill it in.');
  }
  if (IS_PROD && !process.env.SESSION_SECRET) {
    console.warn('WARNING: SESSION_SECRET is not set. Sessions will not survive a restart.');
  }
});
