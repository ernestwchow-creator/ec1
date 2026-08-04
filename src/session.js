const crypto = require('crypto');

// Google OAuth tokens are kept in an encrypted cookie rather than in server
// memory, so signing in survives restarts, sleeps and redeploys. The cookie is
// AES-256-GCM encrypted (not merely signed) so the refresh token is never
// readable at rest in the browser, and GCM's auth tag makes tampering fail
// closed.

const COOKIE_NAME = 'ct_session';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function keyFrom(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encrypt(data, secret) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, keyFrom(secret), iv);
  const plain = Buffer.from(JSON.stringify(data), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

function decrypt(value, secret) {
  try {
    const buf = Buffer.from(value, 'base64url');
    if (buf.length <= IV_LEN + TAG_LEN) return null;
    const decipher = crypto.createDecipheriv(
      ALGO, keyFrom(secret), buf.subarray(0, IV_LEN)
    );
    decipher.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN));
    const dec = Buffer.concat([
      decipher.update(buf.subarray(IV_LEN + TAG_LEN)),
      decipher.final()
    ]);
    return JSON.parse(dec.toString('utf8'));
  } catch {
    // Tampered with, or SESSION_SECRET changed. Treat as signed out.
    return null;
  }
}

function cookieOptions(isProd) {
  return {
    httpOnly: true,
    secure: isProd,
    // 'lax' still sends the cookie on the top-level redirect back from Google.
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
    path: '/'
  };
}

function readTokens(req, secret) {
  const raw = req.cookies && req.cookies[COOKIE_NAME];
  if (!raw) return null;
  const tokens = decrypt(raw, secret);
  // Without a refresh token the session cannot outlive the access token,
  // so treat it as unauthenticated and force a fresh consent.
  if (!tokens || !tokens.refresh_token) return null;
  return tokens;
}

function writeTokens(res, tokens, secret, isProd) {
  res.cookie(COOKIE_NAME, encrypt(tokens, secret), cookieOptions(isProd));
}

function clearTokens(res, isProd) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(isProd), maxAge: undefined });
}

module.exports = { COOKIE_NAME, encrypt, decrypt, readTokens, writeTokens, clearTokens };
