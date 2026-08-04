# Chord Transposer

Transpose chord charts in your Google Docs. Paste a Doc URL, pick how many
semitones to move, preview the result, and the app appends the transposed chart
as a new table at the bottom of the same document.

Runs in any browser and installs to the iPhone/iPad home screen as a
full-screen app.

## What it handles

- Basic chords (`C`, `Am`), 7ths (`E7`), extended (`Am9`, `C13`)
- Altered and jazz voicings (`BbΔ`, `Gø`, `Aaug`, `Gdim`, `F6/9`)
- Slash chords (`E7/G#`, `Gm7/D`) — root and bass note both move
- Repeat signs (`||:`, `:||`), repeat counts (`x3`), and section labels are
  preserved as-is
- Sharp/flat spelling toggle
- Skips lyric tables and Roman-numeral analysis tables
- Documents with several charts: pick which one to transpose

## Local setup

```bash
npm install
cp .env.example .env    # then fill in your Google credentials
npm start
```

Open http://localhost:3000

### Google credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a project.
2. **APIs & Services → Enable APIs** → enable the **Google Docs API**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/auth/callback`
4. Copy the Client ID and Client Secret into `.env`.

While the OAuth consent screen is in "Testing" mode, add your own Google
account under **Audience → Test users**, or sign-in will be blocked.

## Putting it on your iPhone and iPad

The app needs to be reachable over HTTPS from your devices, so deploy it
somewhere and then install it to the home screen.

### 1. Deploy

The repo includes `render.yaml` for [Render](https://render.com), which has a
free tier:

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo. It reads
   `render.yaml`.
3. In the service's **Environment** tab, set `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, and `BASE_URL` (your full Render URL, e.g.
   `https://chord-transposer.onrender.com`, no trailing slash).

Any Node host works — Railway, Fly.io, a VPS. The only requirements are HTTPS
and setting `BASE_URL`.

> On Render's free tier the service sleeps after inactivity, so the first
> request after a break takes ~30 seconds to wake up. You will also be signed
> out when it sleeps, since sessions are kept in memory.

### 2. Add the deployed URL to Google

Back in the Google Cloud console, add a second **Authorized redirect URI**:

```
https://your-app.onrender.com/auth/callback
```

This must match `BASE_URL` exactly, or sign-in fails with `redirect_uri_mismatch`.

### 3. Install to the home screen

**iPhone / iPad (Safari — required, Chrome on iOS cannot install web apps):**

1. Open your deployed URL in Safari.
2. Tap the **Share** button (the square with an arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.

It now has its own icon and opens full-screen with no browser chrome, like a
native app.

**Mac / Windows (Chrome or Edge):** click the install icon in the address bar.

## Mobile behaviour

- Section labels stay pinned to the left while chord columns scroll sideways
- Large touch targets throughout; the `+`/`−` steppers are sized for thumbs
- Content stays clear of the notch and home indicator
- On iPad, the original and transposed charts sit side by side for comparison
- The interface shell is cached, so it opens instantly

## Project layout

| Path | Purpose |
| --- | --- |
| `server.js` | Express server, Google OAuth, API routes |
| `src/transpose.js` | Chord parsing, transposition, chart detection |
| `src/docs.js` | Google Docs API: read tables, append transposed chart |
| `public/index.html` | Front end with live transposition preview |
| `public/manifest.json` | PWA manifest (home-screen install) |
| `public/sw.js` | Service worker caching the app shell |
| `render.yaml` | Deployment blueprint for Render |

## Notes

- The app requests the `documents` scope because it needs to write the
  transposed chart back into your Doc.
- Nothing is stored server-side; tokens live in an in-memory session for the
  life of the process.
