import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exceptionProperties, sanitizeMessage } from '../src/lib/errors.js';

test('crash messages lose ARNs, accounts, URLs, paths, emails, ids and secrets, and stay short', () => {
  const raw =
    'Org API GET /acxm/opportunities?arn=arn:aws:ec2:eu-west-1:123456789012:instance/i-1 failed: 404 ' +
    'for jane@corp.com at https://api.corp.com/x in /Users/jane/repo/main.tf id 3f1c2a9e-1b2c-4d5e-8f90-1234567890ab key AKIAABCDEFGHIJKLMNOP';
  const clean = sanitizeMessage(raw);
  for (const leak of ['arn:aws', '123456789012', 'jane', 'corp.com', '/Users', '3f1c2a9e', 'AKIA']) assert.ok(!clean.includes(leak), `leaked ${leak}`);
  assert.ok(clean.includes('GET /acxm/opportunities'), 'the API path stays');
  assert.ok(sanitizeMessage('x'.repeat(500)).length <= 201);
});

test('only plugin stack frames are kept, relative to the plugin, outermost first', () => {
  const err = new TypeError('boom');
  err.stack = [
    'TypeError: boom',
    `    at inner (${new URL('../src/lib/http.js', import.meta.url).pathname}:10:5)`,
    '    at node:internal/process/task_queues:95:5',
    '    at outer (/Users/jane/other-tool/index.js:3:1)',
    `    at file://${new URL('../bin/cxm.js', import.meta.url).pathname}:140:7`,
  ].join('\n');
  const [ex] = exceptionProperties(err, { source: 'command', command: 'price' }).$exception_list;
  assert.equal(ex.type, 'TypeError');
  assert.deepEqual(ex.stacktrace.frames.map((f) => [f.filename, f.lineno]), [['bin/cxm.js', 140], ['src/lib/http.js', 10]]);
  assert.ok(!JSON.stringify(ex).includes('jane'));
});

test('a thrown non-Error still makes a report', () => {
  const [ex] = exceptionProperties({ weird: true }, { source: 'process' }).$exception_list;
  assert.equal(ex.mechanism.synthetic, true);
});
