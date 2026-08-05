# Chord Transposer

Transpose chord charts in your Google Docs. Find a chart by pasting a Doc URL
or by picking it from Drive, choose how many semitones to move, preview the
result, then either append the transposed chart to the same document or save a
new copy in the new key.

Runs in any browser and installs to the iPhone/iPad home screen as a
full-screen app.

## No Google Doc? Paste the chart

The **Or paste a chart** box takes a chord table pasted as plain text — from a
spreadsheet, another document, or anywhere else. Tabs, pipes, or runs of two or
more spaces separate the cells; blank lines separate the parts of a split
chart. Transposition runs entirely in the browser, no sign-in required, and the
result copies back to the clipboard as tab-separated cells that paste cleanly
into a spreadsheet or table.

## Two ways to save

- **Add to this document** — appends the transposed chart as a new table at the
  bottom, leaving the original chart untouched.
- **Create a copy in the new key** — copies the document, rewrites the chart in
  place, and names it `Original name (G)`. The original document is not
  modified. Transposing an already-transposed copy replaces the key suffix
  rather than stacking, so you get `Song (A)`, never `Song (G) (A)`.

## What it handles

- Basic chords (`C`, `Am`), 7ths (`E7`), extended (`Am9`, `C13`)
- Altered and jazz voicings (`BbΔ`, `Gø`, `Aaug`, `Gdim`, `F6/9`)
- Jazz shorthand: `-` minors (`A-7`), `∆` majors (`C∆`), `º` diminished
  (`Ebº7`), `+` augmented (`G+`)
- Slash chords (`E7/G#`, `Gm7/D`, `A-7/C`) — root and bass note both move
- Bar splits inside a cell, spaced or not: `C | G+` and `Bb7|A7` both work
- Repeat signs (`||:`, `:||`), repeat counts (`x3`), voltas (`1:`, `2:`) and
  section labels are preserved as-is; `N.C.` (no chord) is never transposed
- Charts with a section-label first column (`[Verse]`, or bare `A`/`B`/`C`
  form letters) and charts whose first column is simply the first bar — the
  label column is detected per table and left untouched
- One chart split across several tables (intro / body / outro fragments):
  consecutive tables in the same key are treated as one chart and transposed
  together, while tables in different keys (an original plus already-transposed
  copies) stay separate
- A sharps/flats toggle, which starts on whichever the destination key is
  conventionally written in — transposing to Eb gives `Eb Cm`, not `D# B#m` —
  and stays put once set by hand
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

**2. Enable the APIs.** Three are needed. The Library page does not list them
until you search by name, so these direct links are quicker — each opens the
enable page for the project selected in the top bar:

| API | What needs it | Direct link |
| --- | --- | --- |
| Google Docs API | Reading and writing charts | [`docs.googleapis.com`](https://console.cloud.google.com/apis/library/docs.googleapis.com) |
| Google Drive API | Creating the transposed copy | [`drive.googleapis.com`](https://console.cloud.google.com/apis/library/drive.googleapis.com) |
| Google Picker API | The "Browse Google Drive" button | [`picker.googleapis.com`](https://console.cloud.google.com/apis/library/picker.googleapis.com) |

Check the project name in the console's top bar before clicking **Enable** —
enabling an API on the wrong project is easy to do and looks identical
afterwards.

Sign-in succeeds without these, and then requests fail with a 403 whose real
meaning is "this API is switched off", so enable them up front.

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

**6. Create an API key** for the Picker (the "Browse Google Drive" button).
**Credentials → Create Credentials → API key**, then **Edit API key** and set
both restrictions. The key reaches the browser — Picker cannot work otherwise —
so anyone using the app can read it. Restricting it is what stops it being
reused elsewhere.

- **Application restrictions → Websites.** Add one entry per origin the app is
  served from:
  - `https://your-app.onrender.com/*`
  - `http://localhost:3000/*` (only if you run it locally)
- **API restrictions → Restrict key** → tick **Google Picker API** only.

Leave *"Authenticate API calls through a service account"* unchecked. A service
account is a robot identity with its own Drive, and it has no access to your
files. This app acts as *you*, via the OAuth token from signing in; the API key
only identifies the project for quota purposes.

Set the key as `GOOGLE_API_KEY`.

**7. Set `GOOGLE_PROJECT_NUMBER`** to your Cloud project **number**. Picker uses
it to associate a picked file with this app, which is what extends `drive.file`
access to the file you chose.

This is not the project ID, and the project list shows the ID, so it is easy to
grab the wrong one:

| | Example | Where |
| --- | --- | --- |
| Project **ID** | `chord-transposer-472913` | Shown in the project list — letters, digits, hyphens |
| Project **number** | `123456789012` | Digits only |

Find the number under
[IAM & Admin → Settings](https://console.cloud.google.com/iam-admin/settings),
or in the **Project info** card on the console home page.

Without `GOOGLE_API_KEY` the browse button is simply hidden; pasting a URL
still works.

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
2. In the service's **Environment** tab, set `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, and `GOOGLE_API_KEY` (plus the optional
   `GOOGLE_PROJECT_NUMBER`).
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
| `src/transpose.js` | Chord parsing, transposition, chart detection — served to the browser as `/transpose.js` so preview and server share one implementation |
| `src/docs.js` | Google Docs and Drive: read, append, copy, rewrite in place |
| `src/session.js` | Encrypted cookie session |
| `test-session.js`, `test-replace.js`, `test-charts.js` | Tests (`npm test`) |
| `public/index.html` | Front end with live transposition preview |
| `public/manifest.json` | PWA manifest (home-screen install) |
| `public/sw.js` | Service worker caching the app shell |
| `render.yaml` | Deployment blueprint for Render |

## Scopes and re-authorizing

The app requests two OAuth scopes:

| Scope | Why |
| --- | --- |
| `documents` | Read the chart and write the transposed one back |
| `drive.file` | Create the transposed copy, and reach files you hand over through the Picker |

There is deliberately no `drive.readonly`. That is a **restricted** scope:
Google will not issue it to an app whose publishing status is *In production*
without formal verification, so browsing built on it breaks the moment you
publish. The Google Picker avoids the problem — you choose a file in Google's
own UI, which grants this app access to that one file under `drive.file`. No
restricted scope, no verification, and the app never gains visibility of the
rest of your Drive.

Copying was added after the first release, so a sign-in from before then holds
a token without `drive.file`. The app detects this, disables that mode, and
shows a **Reconnect Google** link. Appending keeps working throughout.

Picker runs in the browser and is handed your access token, which is inherent
to how it works. The token goes only to your own authenticated session and
carries just the two scopes above.

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
The redirect URI the app sent is not one of the **Authorized redirect URIs**
registered on the OAuth client. The app derives it from `BASE_URL`, so the
usual cause is `BASE_URL` being unset on the host — it then falls back to
`http://localhost:3000` and asks Google to return there.

The app prints the exact URI it will use at startup, so check the host's logs:

```
Base URL:     https://your-app.onrender.com
Redirect URI: https://your-app.onrender.com/auth/callback
```

That `Redirect URI` line is the string that must appear verbatim in Google
Cloud under **Credentials → your OAuth client → Authorized redirect URIs**.
Common mismatches: `http` instead of `https`, a trailing slash, a missing
`/auth/callback`, or the wrong subdomain.

If you open `/auth` from an origin that disagrees with `BASE_URL`, the app now
detects it first and shows both values along with the exact string to
register, instead of handing you Google's generic error.

**A Drive action fails with 403**
Most often the relevant API is switched off rather than a permission problem.
Enable **Google Drive API** and **Google Picker API** under APIs & Services →
Library, wait a minute, and retry. The app now reports Google's own reason, so
the message will say which case it is.

**`Error 403: access_denied` — "can only be accessed by developer-approved testers"**
The consent screen is in *Testing* mode and your account is not on the tester
list. Owning the Cloud project does not grant access by itself. Either:

- **APIs & Services → OAuth consent screen → Audience → Test users → Add
  users**, and add your own Google address; or
- **Publish app**, which removes the tester list entirely (see below).

**Signed out every 7 days**
In *Testing* mode Google expires refresh tokens after 7 days, so the durable
session cannot outlive that. **OAuth consent screen → Publishing status →
Publish app** fixes it and the app stays private to you — publishing controls
who may sign in, not discoverability.

Because this app uses a sensitive scope (`documents`) and is unverified, a
"Google hasn't verified this app" screen appears at first sign-in. Choose
**Advanced → Go to … (unsafe)** to continue. That is expected for a personal
app; verification is only needed to remove the warning for other people.

## Notes

- The app requests the `documents` scope because it needs to write the
  transposed chart back into your Doc.
