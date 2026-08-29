require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { google } = require('googleapis');
const {
  extractDocId, extractTables, readDocument, appendTransposedChart,
  copyDocument, replaceChart
} = require('./src/docs');
const {
  isChordTable, isRomanNumeralTable, transposeCellText,
  realizeRomanCellText, noteToIndex,
  buildChartGroups, transposeNote
} = require('./src/transpose');

// A table is a chart whether written in chords or roman numerals. Every place
// that indexes chart tables (grouping, and rewriting the copy) must share this
// predicate, or the indices drift.
const isChartTable = (data) => isChordTable(data) || isRomanNumeralTable(data);
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
// The transposition/detection module is shared verbatim with the browser so
// the live preview and the server never disagree on what a chord chart is.
app.get('/transpose.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'transpose.js'));
});

const REDIRECT_URI = `${BASE_URL}/auth/callback`;

const SCOPE_BASE = 'https://www.googleapis.com/auth/';
const SCOPES = [
  // Read the chart and write the transposed one back.
  `${SCOPE_BASE}documents`,
  // Create the transposed copy, and reach files the user hands over through the
  // Picker. Deliberately not drive.readonly: that is a *restricted* scope
  // requiring Google verification, whereas Picker grants per-file access on top
  // of drive.file with no restricted scope at all.
  `${SCOPE_BASE}drive.file`
];

// Picker runs in the browser and needs a Google API key of its own.
const PICKER_API_KEY = process.env.GOOGLE_API_KEY || '';
// The Cloud project *number*, which Picker uses to associate a picked file with
// this app. The project *ID* is the value on display in the console's project
// list, so it is the one people reach for by mistake; Picker fails obscurely if
// given it, so a non-numeric value is rejected here instead.
const RAW_PROJECT_NUMBER = (process.env.GOOGLE_PROJECT_NUMBER || '').trim();
const PICKER_APP_ID = /^\d+$/.test(RAW_PROJECT_NUMBER) ? RAW_PROJECT_NUMBER : '';

// Tokens issued before the Drive scopes were added still work for appending,
// so rather than forcing everyone to re-authorize we check what was actually
// granted and let the UI offer a reconnect only where it is needed.
function grantedScopes(tokens) {
  return new Set(String(tokens.scope || '').split(/\s+/).filter(Boolean));
}

function canCreateCopy(tokens) {
  const g = grantedScopes(tokens);
  return g.has(SCOPE_BASE + 'drive') || g.has(SCOPE_BASE + 'drive.file');
}

// Google can grant a subset of what was requested — the consent screen offers
// per-permission checkboxes, and a published-but-unverified app is refused
// restricted scopes outright. Both look identical from the app's side, so
// report exactly what came back rather than guessing.
function scopeReport(tokens) {
  const granted = grantedScopes(tokens);
  return {
    granted: [...granted].sort(),
    missing: SCOPES.filter(s => !granted.has(s)),
    // An older token predating this field entirely.
    unknown: !tokens.scope
  };
}

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

// A 403 from Google means several very different things, and flattening them
// into "access refused" sends people to re-authorize when the real problem is
// an API left disabled in the Cloud project. Pull out Google's own reason.
function classifyForbidden(err) {
  const data = err && err.response && err.response.data && err.response.data.error;
  const reasons = new Set();
  const collect = (arr) => {
    if (Array.isArray(arr)) arr.forEach(e => e && e.reason && reasons.add(e.reason));
  };
  collect(err && err.errors);
  collect(data && data.details);
  if (data && data.status) reasons.add(data.status);

  const message = (data && data.message) || (err && err.message) || '';

  if (reasons.has('SERVICE_DISABLED') || reasons.has('accessNotConfigured') ||
      /has not been used in project|is disabled/i.test(message)) {
    return {
      kind: 'apiDisabled',
      error: 'The Google Drive API is not enabled in your Google Cloud project. ' +
        'Enable it under APIs & Services → Library → Google Drive API, wait a minute, then try again.',
      detail: message
    };
  }

  if (reasons.has('insufficientPermissions') || reasons.has('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
      /insufficient (authentication )?scopes?/i.test(message)) {
    return {
      kind: 'scope',
      error: 'This needs a permission that was not granted. Please reconnect your Google account.',
      needsReauth: true,
      detail: message
    };
  }

  return { kind: 'other', error: message || 'Google refused the request.', detail: message };
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
function configPage(body, title = 'Configuration error') {
  return `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>` +
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
    scope: SCOPES,
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
  const tokens = readTokens(req, SECRET);
  res.json({
    authenticated: !!tokens,
    // Browsing needs an API key on the server; copying needs the drive.file
    // scope from Google. They fail for different reasons, so report separately.
    canBrowse: !!PICKER_API_KEY,
    canCopy: tokens ? canCreateCopy(tokens) : false,
    scopes: tokens ? scopeReport(tokens) : null
  });
});

// Shows what Google actually granted versus what was asked for. Scope URLs are
// not secrets, and this is the only way to tell a declined permission apart
// from a scope Google refused to issue at all.
app.get('/auth/status', (req, res) => {
  const tokens = readTokens(req, SECRET);
  if (!tokens) {
    return res.status(401).send(configPage(
      `<h1>Not signed in</h1><p><a href="/auth">Sign in with Google</a></p>`,
      'Google connection'
    ));
  }

  const { granted, missing, unknown } = scopeReport(tokens);
  const short = (s) => s.replace(SCOPE_BASE, '');

  res.send(configPage(
    `<h1>Google connection</h1>` +
    `<h2>Granted</h2>` +
    (granted.length
      ? `<ul>${granted.map(s => `<li><code>${escapeHtml(short(s))}</code></li>`).join('')}</ul>`
      : `<p>None reported${unknown ? ' — this sign-in predates scope tracking, so reconnecting will refresh it.' : '.'}</p>`) +
    `<h2>Missing</h2>` +
    (missing.length
      ? `<ul>${missing.map(s => `<li><code>${escapeHtml(short(s))}</code></li>`).join('')}</ul>` +
        `<p>Reconnect and accept every permission the consent screen offers — it ` +
        `presents them as separate checkboxes, and leaving one unticked withholds ` +
        `that scope.</p>`
      : `<p>Nothing missing.</p>`) +
    `<p><a href="/auth">Reconnect Google</a> &middot; <a href="/">Back to the app</a></p>`,
    'Google connection'
  ));
});

// Picker runs client-side and needs the user's access token plus an API key.
// Handing the access token to the page is inherent to how Picker works; it is
// the signed-in user's own token, delivered only to that authenticated session,
// and it carries just the documents and drive.file scopes.
app.get('/api/picker-config', async (req, res) => {
  const tokens = readTokens(req, SECRET);
  if (!tokens) return res.status(401).json({ error: 'Not authenticated' });

  if (!PICKER_API_KEY) {
    return res.status(503).json({
      error: 'Browsing needs a Google API key. Set GOOGLE_API_KEY in the server environment ' +
        '(Google Cloud console → APIs & Services → Credentials → Create credentials → API key), then redeploy.',
      needsConfig: true
    });
  }

  const auth = getAuthedClient(req, res);
  try {
    // Forces a refresh when the stored access token has expired, so Picker is
    // never handed a dead token.
    const { token } = await auth.getAccessToken();
    if (!token) throw new Error('Could not obtain an access token');
    res.json({ accessToken: token, apiKey: PICKER_API_KEY, appId: PICKER_APP_ID || undefined });
  } catch (err) {
    console.error('Picker config error:', err.message);
    if (isAuthFailure(err)) {
      clearTokens(res, IS_PROD);
      return res.status(401).json({ error: 'Your Google sign-in expired. Please sign in again.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/document', async (req, res) => {
  const auth = getAuthedClient(req, res);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  // `url` is what the paste box sends; `id` is what the Drive browser sends.
  const source = req.query.url || req.query.id;
  if (!source) return res.status(400).json({ error: 'Missing url parameter' });

  const docId = extractDocId(source);
  if (!docId) return res.status(400).json({ error: 'Invalid Google Doc URL. Expected a URL like https://docs.google.com/document/d/...' });

  try {
    const doc = await readDocument(auth, docId);
    const tables = extractTables(doc);

    const chartDatas = tables.filter(t => isChartTable(t.data)).map(t => t.data);

    const chordCharts = buildChartGroups(chartDatas).map((g, i) => ({
      index: i,
      detectedKey: g.detectedKey,
      roman: !!g.roman,
      mode: g.mode || null,
      parts: g.parts.map(p => ({ data: p.data, hasLabelColumn: p.hasLabelColumn }))
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

  const { documentId, chartIndex, semitones, useFlats, mode, targetKey } = req.body;
  if (!documentId) return res.status(400).json({ error: 'Missing documentId' });
  // Chord charts move by semitones; roman charts are realized into a target
  // key. Which one applies is only known once the chart is loaded, so the
  // per-kind validation happens after the group lookup below.

  const outputMode = mode === 'copy' ? 'copy' : 'append';
  const tokens = readTokens(req, SECRET);
  if (outputMode === 'copy' && !canCreateCopy(tokens)) {
    return res.status(403).json({
      error: 'Creating a copy needs Drive access. Please reconnect your Google account.',
      needsReauth: true
    });
  }

  try {
    const doc = await readDocument(auth, documentId);
    const tables = extractTables(doc);
    const groups = buildChartGroups(tables.map(t => t.data).filter(isChartTable));

    const index = chartIndex || 0;
    const chart = groups[index];
    if (!chart) return res.status(404).json({ error: 'Chord chart not found in document' });

    let transposedParts, newKey, title;

    if (chart.roman) {
      if (!targetKey || noteToIndex(targetKey) === -1) {
        return res.status(400).json({ error: 'A target key is needed to realize a Roman numeral chart' });
      }
      transposedParts = chart.parts.map(part =>
        part.data.map(row =>
          row.map((cell, c) => {
            if (part.hasLabelColumn && c === 0) return cell;
            return realizeRomanCellText(cell, targetKey, chart.mode, useFlats);
          })
        )
      );
      newKey = targetKey;
      title = `In ${targetKey} (from Roman numerals, ${chart.mode})`;
    } else {
      if (semitones === undefined || semitones === 0) {
        return res.status(400).json({ error: 'Semitones must be non-zero' });
      }
      // Column 0 is skipped only when it holds section labels; in charts
      // without a label column the first column is the first bar of each line.
      transposedParts = chart.parts.map(part =>
        part.data.map(row =>
          row.map((cell, c) => {
            if (part.hasLabelColumn && c === 0) return cell;
            return transposeCellText(cell, semitones, useFlats);
          })
        )
      );
      const originalKey = chart.detectedKey;
      newKey = transposeNote(originalKey, semitones, useFlats);
      const direction = semitones > 0 ? '+' : '';
      title = `Transposed to ${newKey} (${direction}${semitones} semitones from ${originalKey})`;
    }

    if (outputMode === 'copy') {
      // Strip any "(key)" this app added previously, so transposing a copy of a
      // copy gives "Song (A)" rather than "Song (G) (A)".
      const baseName = String(doc.title || 'Chord chart').replace(/\s*\([A-G][#b]?\)\s*$/, '').trim();
      const newName = `${baseName} (${newKey})`;

      const copy = await copyDocument(auth, documentId, newName);
      await replaceChart(auth, copy.id, isChartTable,
        chart.parts.map(p => p.chordTableIndex), transposedParts);

      return res.json({
        success: true,
        mode: 'copy',
        title: newName,
        documentId: copy.id,
        url: copy.webViewLink || `https://docs.google.com/document/d/${copy.id}`,
        transposedParts
      });
    }

    for (let i = 0; i < transposedParts.length; i++) {
      await appendTransposedChart(auth, documentId, transposedParts[i], i === 0 ? title : null);
    }

    res.json({
      success: true,
      mode: 'append',
      title,
      documentId,
      url: `https://docs.google.com/document/d/${documentId}`,
      transposedParts
    });
  } catch (err) {
    console.error('Transpose error:', err.message);
    if (isAuthFailure(err)) {
      clearTokens(res, IS_PROD);
      return res.status(401).json({ error: 'Your Google sign-in expired. Please sign in again.' });
    }
    if (err.code === 403) {
      const info = classifyForbidden(err);
      console.error('Forbidden:', info.kind, '-', info.detail);
      return res.status(403).json({ error: info.error, needsReauth: info.needsReauth });
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
  if (RAW_PROJECT_NUMBER && !PICKER_APP_ID) {
    console.warn(`WARNING: GOOGLE_PROJECT_NUMBER is "${RAW_PROJECT_NUMBER}", which is not a number.`);
    console.warn('         That looks like the project ID. The project number is digits only —');
    console.warn('         find it under IAM & Admin > Settings. Ignoring it for now.');
  }
});
