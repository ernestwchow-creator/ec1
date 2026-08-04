// Verifies the encrypted-cookie session: round-trip, tamper rejection,
// wrong-key rejection, and refusal of a session with no refresh token.
const assert = require('assert');
const { encrypt, decrypt, readTokens } = require('./src/session');

const SECRET = 'a-test-secret';
const TOKENS = {
  access_token: 'ya29.fake-access',
  refresh_token: '1//fake-refresh-token',
  expiry_date: 1893456000000
};

// 1. Round trip
const cookie = encrypt(TOKENS, SECRET);
assert.deepStrictEqual(decrypt(cookie, SECRET), TOKENS);
console.log('PASS  round-trips through encrypt/decrypt');

// 2. The refresh token must not be readable from the cookie value
assert.ok(!Buffer.from(cookie, 'base64url').toString('utf8').includes('fake-refresh-token'));
assert.ok(!cookie.includes('fake-refresh'));
console.log('PASS  refresh token is not readable in the cookie');

// 3. Wrong secret cannot decrypt (e.g. SESSION_SECRET rotated)
assert.strictEqual(decrypt(cookie, 'different-secret'), null);
console.log('PASS  wrong secret yields null, not a throw');

// 4. Tampering is rejected by the GCM auth tag
const buf = Buffer.from(cookie, 'base64url');
buf[buf.length - 1] ^= 0xff;
assert.strictEqual(decrypt(buf.toString('base64url'), SECRET), null);
console.log('PASS  tampered cookie rejected');

// 5. Garbage input
for (const junk of ['', 'not-base64!!', 'YWJj']) {
  assert.strictEqual(decrypt(junk, SECRET), null);
}
console.log('PASS  malformed cookie rejected');

// 6. readTokens requires a refresh token, else the session cannot be durable
const noRefresh = encrypt({ access_token: 'x' }, SECRET);
assert.strictEqual(readTokens({ cookies: { ct_session: noRefresh } }, SECRET), null);
assert.deepStrictEqual(readTokens({ cookies: { ct_session: cookie } }, SECRET), TOKENS);
assert.strictEqual(readTokens({ cookies: {} }, SECRET), null);
assert.strictEqual(readTokens({}, SECRET), null);
console.log('PASS  readTokens requires a refresh token');

// 7. Ciphertext differs each time (random IV) but decrypts the same
assert.notStrictEqual(encrypt(TOKENS, SECRET), encrypt(TOKENS, SECRET));
console.log('PASS  IV is random per encryption');

console.log('\nAll session tests passed.');
