import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Isolate the credential store so minting an anonymous distinctId can't touch the real config.
process.env.CXM_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cxm-telemetry-'));
const { emit, classifyError } = await import('../src/lib/telemetry.js');

test('opt-out: CXM_TELEMETRY=0 sends nothing', async () => {
  process.env.CXM_TELEMETRY = '0';
  delete process.env.CXM_TELEMETRY_DRYRUN;
  assert.equal(await emit('plugin.command_run', { command: 'whoami' }), false);
});

test('dry-run payload is coarse and carries no customer data', async () => {
  process.env.CXM_TELEMETRY = '1';
  process.env.CXM_TELEMETRY_DRYRUN = '1';
  const p = await emit('plugin.savings_advised', { amount_monthly_usd: 42, advice_category: 'ec2' });
  assert.equal(p.event, 'plugin.savings_advised');
  assert.ok(p.api_key.startsWith('phc_'));
  assert.ok(p.distinct_id);
  assert.ok(p.properties.plugin_version);
  assert.ok(['tty', 'agent'].includes(p.properties.surface));
  assert.equal(p.properties.amount_monthly_usd, 42);
  // The guarantee: nothing customer-identifying can ride along.
  const blob = JSON.stringify(p).toLowerCase();
  for (const forbidden of ['arn:', 'analysis', 'access_token', 'accesstoken']) {
    assert.ok(!blob.includes(forbidden), `payload must not contain ${forbidden}`);
  }
});

test('classifyError buckets errors into low-cardinality classes', () => {
  assert.equal(classifyError(new Error('Session expired or unauthorized. Run: cxm login')), 'auth_expired');
  assert.equal(classifyError(new Error("Access denied — your CXM role lacks 'data:write'.")), 'authz');
  assert.equal(classifyError(new Error('CubeJS meta error: 500')), 'cube_meta');
  assert.equal(classifyError(new Error('CubeJS query timed out waiting for results.')), 'timeout');
  assert.equal(classifyError(new Error('CubeJS error: Some cube failure')), 'cube_query');
  assert.equal(classifyError(new Error('Org API GET /x failed: 503. upstream')), 'http_5xx');
  assert.equal(classifyError(new Error('Org API GET /x failed: 404. missing')), 'http_4xx');
  assert.equal(classifyError(new TypeError('fetch failed')), 'network');
  assert.equal(classifyError(new Error("cube requires --query '<cubejs-json>'")), 'bad_input');
  assert.equal(classifyError(new Error('something odd happened')), 'other');
});

test('distinct_id and machine_id are the same value', async () => {
  process.env.CXM_TELEMETRY = '1';
  process.env.CXM_TELEMETRY_DRYRUN = '1';
  const p = await emit('plugin.command_run', { command: 'auth status' });
  // They are meant to be one id. distinctId() persists to the config file but is handed the same
  // already-loaded config object each call, so calling it twice once minted two ids and the first
  // event a machine ever sent was orphaned from every later one.
  assert.equal(p.distinct_id, p.properties.machine_id);
});
