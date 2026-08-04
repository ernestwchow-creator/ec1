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

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are not values that exist
anywhere yet — you create them, and they identify *this app* to Google so it
can ask for permission to edit your Docs. They are tied to your Google
account, so they cannot be copied from anywhere else.

**1. Create a project.** [Google Cloud Console](https://console.cloud.google.com/)
→ project dropdown in the top bar → **New Project**. Name it anything.

**2. Enable the API.** **APIs & Services → Library** → search *Google Docs
API* → **Enable**. Without this, sign-in succeeds but every request fails.

**3. Set up the consent screen.** Under **APIs & Services → OAuth consent
screen** (newer consoles call this **Google Auth Platform**):

- User type **External** for a personal `@gmail.com` account; **Internal**
  only if you have Google Workspace.
- Fill in app name and your email where required.
- Under **Audience → Test users**, add your own Google address. Skipping
  this causes *"Access blocked: app has not completed verification"*.

**4. Create the credentials.** **APIs & Services → Credentials → Create
Credentials → OAuth client ID**:

- Application type: **Web application**
- Under **Authorized redirect URIs**, add one entry per environment. These
  must match `BASE_URL` exactly — same scheme, no trailing slash:
  - `http://localhost:3000/auth/callback` for local development
  - `https://your-app.onrender.com/auth/callback` once deployed

**5. Copy the two values** shown when you click **Create**:

| Variable | Looks like | Where |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | `1234567890-abc...xyz.apps.googleusercontent.com` | Shown on the client's detail page any time |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-...` | Same page; if it is hidden, add a new secret |

Put them in `.env` locally, or in your host's environment settings when
deployed.

Treat the client secret like a password: it belongs in `.env` or your host's
environment settings, never in a commit. `.env` is already gitignored.

## Putting it on your iPhone and iPad

The app needs to be reachable over HTTPS from your devices, so deploy it
somewhere and then install it to the home screen.

### 1. Deploy

The repo includes `render.yaml` for [Render](https://render.com), which has a
free tier.

> **This project lives on the `claude/chord-transposer-app-xdm5df` branch, and
> it is not the repository's default branch** — the default is a different
> project. Whenever Render asks which branch to deploy, pick that one. The
> `branch:` key in `render.yaml` pins it for Blueprint deploys.

1. In Render: **New → Blueprint**, point it at this repo, and select the
   branch above. It reads `render.yaml`.
2. In the service's **Environment** tab, set `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.
3. Once the first deploy finishes, copy the service URL and set `BASE_URL` to
   it (e.g. `https://chord-transposer.onrender.com`, no trailing slash).
   Saving triggers a redeploy. `BASE_URL` cannot be set before the first
   deploy because the URL is not known until Render assigns it.

Any Node host works — Railway, Fly.io, a VPS. The only requirements are HTTPS
and setting `BASE_URL`.

> On Render's free tier the service sleeps after inactivity, so the first
> request after a break takes ~30 seconds to wake up. You stay signed in
> across sleeps and redeploys (see [Sessions](#sessions)).

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

## Sessions

Sign-in survives server restarts, sleeps and redeploys. There is no database:
the Google OAuth tokens are held in a cookie encrypted with AES-256-GCM using a
key derived from `SESSION_SECRET`, and the server keeps no state at all.

- The cookie is `httpOnly` (JavaScript cannot read it), `secure` over https,
  and `sameSite=lax`.
- The refresh token is encrypted, not merely signed, so it is unreadable at
  rest in the browser. GCM's authentication tag makes any tampering fail
  closed.
- Changing `SESSION_SECRET` invalidates existing sessions and requires signing
  in again. On Render it is generated once and then persists, so redeploys
  keep you signed in.
- If Google revokes the token, the app clears the cookie and returns you to the
  sign-in screen with an explanation.

## Troubleshooting

**`Error 400: invalid_request — Missing required parameter: client_id`**
`GOOGLE_CLIENT_ID` is not set in the environment the server is actually running
in. On Render, set it under **Environment** and redeploy; locally, check
`.env`. The app now detects this before redirecting and shows which variable is
missing.

**`Error 400: redirect_uri_mismatch`**
`BASE_URL` and the **Authorized redirect URI** in Google Cloud disagree. They
must match exactly, including `https://` and with no trailing slash on
`BASE_URL`.

**Signed out every 7 days**
The OAuth consent screen is still in *Testing* mode, where Google expires
refresh tokens after 7 days. Publish the app (it stays private to you) to stop
that.

## Notes

- The app requests the `documents` scope because it needs to write the
  transposed chart back into your Doc.
