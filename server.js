require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { extractDocId, extractTables, readDocument, appendTransposedChart } = require('./src/docs');
const {
  isChordTable, isRomanNumeralTable, transposeCellText,
  detectKeyFromChart, defaultUseFlats, transposeNote
} = require('./src/transpose');

const app = express();
const PORT = process.env.PORT || 3000;

// When deployed, BASE_URL is the public https origin (e.g. https://chords.onrender.com).
// Locally it falls back to localhost. The OAuth redirect URI is derived from it, so it
// must exactly match an "Authorized redirect URI" in the Google Cloud console.
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const IS_PROD = BASE_URL.startsWith('https://');

// Hosting platforms terminate TLS at a proxy; without this Express sees http and
// refuses to set the secure session cookie.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'chord-transposer-dev',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: IS_PROD,
    httpOnly: true,
    // 'lax' still sends the cookie on the top-level redirect back from Google.
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

function getOAuth2Client() {
  const { google } = require('googleapis');
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BASE_URL}/auth/callback`
  );
}

app.get('/auth', (req, res) => {
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
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
    req.session.tokens = tokens;
    res.redirect('/');
  } catch (err) {
    console.error('Auth error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session.tokens });
});

app.get('/api/document', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });

  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  const docId = extractDocId(url);
  if (!docId) return res.status(400).json({ error: 'Invalid Google Doc URL. Expected a URL like https://docs.google.com/document/d/...' });

  try {
    const doc = await readDocument(req.session.tokens, docId);
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
    if (err.code === 404) return res.status(404).json({ error: 'Document not found. Check the URL and make sure you have access.' });
    if (err.code === 403) return res.status(403).json({ error: 'No access to this document. Make sure it is shared with your Google account.' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transpose', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });

  const { documentId, chartIndex, semitones, useFlats } = req.body;
  if (!documentId) return res.status(400).json({ error: 'Missing documentId' });
  if (semitones === undefined || semitones === 0) return res.status(400).json({ error: 'Semitones must be non-zero' });

  try {
    const doc = await readDocument(req.session.tokens, documentId);
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

    await appendTransposedChart(req.session.tokens, documentId, transposed, title);

    res.json({ success: true, title, transposedChart: transposed });
  } catch (err) {
    console.error('Transpose error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bind 0.0.0.0 so the app is reachable from other devices on the network
// (and from the host platform's proxy when deployed).
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Chord Transposer running on port ${PORT}`);
  console.log(`Base URL: ${BASE_URL}`);
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('WARNING: GOOGLE_CLIENT_ID is not set. Copy .env.example to .env and fill it in.');
  }
});
