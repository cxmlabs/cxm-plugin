import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactSecrets } from '../src/lib/secrets.js';

// Fake bodies, assembled so that no scanner reads a real credential in this file.
const v = (head = '') => `${head}Fake${'q7'.repeat(10)}`;
const leaks = (out, value) => [...Array(value.length - 15).keys()].some((i) => out.includes(value.slice(i, i + 16)));
const jwt = 'eyJhbGciOiJub25lIn0' + '.' + 'eyJzdWIiOiJmYWtlLXVzZXIifQ' + '.';
const pem = '-----BEGIN ' + 'PRIVATE KEY-----\n' + v() + '\n' + v('b') + '\n-----END ' + 'PRIVATE KEY-----';

test('each credential form is replaced, and each text that is not a credential stays', () => {
  const cases = [
    [`AWS_SECRET_ACCESS_KEY=${v()}`, v()],
    [`aws_secret_access_key = ${v()}`, v()],
    [`aws-secret-access-key: ${v()}`, v()],
    [`{"api_key": "${v()}"}`, v()],
    [`curl --api-key=${v()}`, v()],
    [`GITHUB_TOKEN=${v()}`, v()],
    [`db_password: ${v()}`, v()],
    [`passwd=${v()}`, v()],
    [`client_secret: "${v()}"`, v()],
    [`Authorization: Bearer ${v()}`, v()],
    [`curl -H 'Authorization: Basic ${v()}=='`, v()],
    [`{"authorization": "Bearer ${v()}"}`, v()],
    [JSON.stringify({ content: `{"apiKey": "${v()}"}` }), v()],
    [`redis://default:${v()}@cache:6379`, v()],
    [`postgres://app:${v()}@db.internal/x`, v()],
    [`key ${'AKIA' + 'Z'.repeat(16)}`, 'AKIA' + 'Z'.repeat(16)],
    [`key ${'ASIA' + 'Z'.repeat(16)}`, 'ASIA' + 'Z'.repeat(16)],
    [pem, pem],
    [`out: ${pem.slice(0, 60)}`, pem.slice(0, 60)],
    [`token ${jwt}`, jwt],
    ...['phc_', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_', 'xoxb-', 'xoxp-', 'sk-', 'sk-proj-', 'sk-ant-', 'sk_live_', 'rk_live_', 'sk_test_', 'AIza'].map((p) => [`use ${v(p)} now`, v(p)]),
  ];
  for (const [text, value] of cases) assert.ok(!leaks(redactSecrets(text), value), text);
  const keep = [
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '3f1c2a9e-1b2c-4d5e-8f90-1234567890ab',
    'bd36091f2c4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
    'arn:aws:iam::123456789012:role/Deploy',
    '{"key": "name"}',
  ];
  for (const text of keep) assert.equal(redactSecrets(text), text);
});
