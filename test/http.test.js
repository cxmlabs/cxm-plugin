// A read survives a gateway error. A write and a session refresh are sent once.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// The config module reads its directory when it loads, so it is set before the import.
process.env.CXM_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cxm-http-'));
const { cubeLoad, cubeMeta, currentUser, orgApi } = await import('../src/lib/http.js');
const { requireSession, saveConfig } = await import('../src/lib/config.js');
const { classifyError } = await import('../src/lib/telemetry.js');

const config = { baseUrl: 'https://example.test', organizationId: 'org', accessToken: 't' };
const reads = {
  cubeLoad: () => cubeLoad(config, {}),
  cubeMeta: () => cubeMeta(config),
  currentUser: () => currentUser(config),
  orgApi: () => orgApi(config, 'GET', '/wiki/pages'),
};

// `answer(n)` gives the status and the body of call n. Each wait moves the clock and returns at once.
function stub(t, answer) {
  const seen = { calls: 0, waits: [] };
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => {
    seen.waits.push(ms);
    now += ms;
    queueMicrotask(fn);
  });
  t.mock.method(globalThis, 'fetch', async () => {
    const [status, body = {}] = answer(seen.calls++);
    return new Response(JSON.stringify(body), { status });
  });
  return seen;
}

test('a read is repeated after 502, 503 and 504 and then gives its rows', async (t) => {
  const rows = [{ id: 1 }];
  const body = { cubeLoad: { data: rows }, cubeMeta: { cubes: rows }, currentUser: rows, orgApi: rows };
  for (const [name, read] of Object.entries(reads)) {
    const seen = stub(t, (n) => [[502], [503], [504], [200, body[name]]][n]);
    assert.deepEqual(await read(), rows, name);
    assert.deepEqual(seen.waits, [1000, 2000, 4000], name);
    t.mock.restoreAll();
  }
});

test('a read stops after six tries with the status and the number of tries', async (t) => {
  const gaveUp = (status, tries) => ({
    message: `CXM did not answer: HTTP ${status} after ${tries} tries. The request changed nothing. Try again in a few minutes.`,
  });
  for (const [name, read] of Object.entries(reads)) {
    const seen = stub(t, () => [503]);
    await assert.rejects(read(), gaveUp(503, 6), name);
    assert.equal(seen.calls, 6, name);
    assert.deepEqual(seen.waits, [1000, 2000, 4000, 8000, 16000], name);
    t.mock.restoreAll();
  }

  // Each "Continue wait" between two failures keeps the same limit.
  stub(t, (n) => (n % 2 ? [200, { error: 'Continue wait' }] : [502]));
  await assert.rejects(reads.cubeLoad(), gaveUp(502, 6));
  t.mock.restoreAll();

  for (const [maxWaitMs, tries] of [[0, 1], [5000, 3]]) {
    const seen = stub(t, () => [504]);
    await assert.rejects(cubeLoad(config, {}, { maxWaitMs }), gaveUp(504, tries));
    assert.equal(seen.calls, tries);
    t.mock.restoreAll();
  }

  assert.equal(classifyError(gaveUp(503, 6)), 'http_5xx');
});

test('a write, a session refresh, a 500 and a 4xx are sent once', async (t) => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const seen = stub(t, () => [503]);
    await assert.rejects(orgApi(config, method, '/x', {}), new RegExp(`Org API ${method} /x failed: 503\\.`));
    assert.equal(seen.calls, 1, method);
    t.mock.restoreAll();
  }
  for (const status of [500, 404]) {
    for (const [name, read] of Object.entries(reads)) {
      const seen = stub(t, () => [status]);
      await assert.rejects(read(), new RegExp(String(status)));
      assert.equal(seen.calls, 1, `${name} ${status}`);
      t.mock.restoreAll();
    }
  }
  saveConfig({ ...config, refreshToken: 'r', expiresAt: 1 });
  const seen = stub(t, () => [503]);
  await assert.rejects(requireSession(), /Session expired/);
  assert.equal(seen.calls, 1);
});
