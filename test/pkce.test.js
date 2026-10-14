import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createPkcePair } from '../src/lib/pkce.js';

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('challenge is the base64url S256 hash of the verifier', () => {
  const { codeVerifier, codeChallenge } = createPkcePair();
  const expected = base64url(createHash('sha256').update(codeVerifier).digest());
  assert.equal(codeChallenge, expected);
  assert.match(codeChallenge, /^[A-Za-z0-9_-]+$/); // base64url, no padding
});
