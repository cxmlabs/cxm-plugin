import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// The config module reads its directory when it loads, so it is set before the import.
process.env.CXM_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cxm-update-'));
process.env.CXM_TELEMETRY = '0';
const { compareVersions, enableClaudeAutoUpdate, refreshCodex, updateNotice } = await import('../src/lib/update.js');
const { loadConfig, saveConfig } = await import('../src/lib/config.js');
const { install } = await import('../src/commands/install.js');

const DAY = 24 * 60 * 60 * 1000;

test('auto-update is set on the CXM marketplace entry, and every other setting stays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cxm-claude-'));
  const entry = { source: { source: 'git', url: 'https://github.com/cxmlabs/cxm-plugin.git' } };
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'x', extraKnownMarketplaces: { other: { source: {} }, 'cxm-marketplace': entry } }));
  enableClaudeAutoUpdate(dir);
  const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
  assert.equal(settings.model, 'x');
  assert.deepEqual(settings.extraKnownMarketplaces.other, { source: {} });
  assert.deepEqual(settings.extraKnownMarketplaces['cxm-marketplace'], { ...entry, autoUpdate: true });
  const empty = mkdtempSync(join(tmpdir(), 'cxm-claude-'));
  enableClaudeAutoUpdate(empty);
  assert.equal(JSON.parse(readFileSync(join(empty, 'settings.json'), 'utf8')).extraKnownMarketplaces['cxm-marketplace'].autoUpdate, true);
});

test('versions compare on their numbers', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.2.1', '0.2.1'), 0);
  assert.equal(compareVersions('0.2.1', '1.0.0-rc.1'), -1);
});

test('a newer version is announced once a day, a failed check says nothing, and the registry is asked once a day', async () => {
  saveConfig({});
  let asked = 0;
  const fetchJson = async () => (asked++, '9.0.0');
  const now = 1_000 * DAY;
  assert.match(await updateNotice({ now, current: '0.2.1', fetchJson }), /CloudExMachina 9\.0\.0 is available \(this is 0\.2\.1\)\. Update: npx @cloudexmachina\/cxm@latest install/);
  assert.equal(await updateNotice({ now: now + 1000, current: '0.2.1', fetchJson }), null, 'once a day');
  assert.equal(asked, 1, 'the registry answer is kept for a day');
  assert.equal(await updateNotice({ now: now + 2 * DAY, current: '9.0.0', fetchJson }), null, 'nothing when current');
  saveConfig({});
  assert.equal(await updateNotice({ now, current: '0.2.1', fetchJson: async () => { throw new Error('offline'); } }), null);
});

test('Codex is refreshed at a session start only when the user agreed, and at most once a day', () => {
  const runs = [];
  const run = (cmd) => runs.push(cmd);
  saveConfig({ autoUpdate: false });
  assert.equal(refreshCodex({ now: DAY, run }), false);
  saveConfig({ autoUpdate: true });
  assert.equal(refreshCodex({ now: DAY, run }), true);
  assert.equal(refreshCodex({ now: DAY + 1000, run }), false);
  assert.deepEqual(runs, ['codex plugin marketplace upgrade cxm-marketplace && codex plugin add cxm-agent-plugin@cxm-marketplace']);
});

test('install turns auto-update on unless --no-auto-update, and records the answer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cxm-claude-'));
  process.env.CLAUDE_CONFIG_DIR = dir;
  const quiet = { run: () => 0, status: (a) => (a === 'claude' ? 'ready' : 'missing') };
  await install(['--yes', '--no-login'], quiet);
  assert.equal(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).extraKnownMarketplaces['cxm-marketplace'].autoUpdate, true);
  assert.equal(loadConfig().autoUpdate, true);
  const off = mkdtempSync(join(tmpdir(), 'cxm-claude-'));
  process.env.CLAUDE_CONFIG_DIR = off;
  await install(['--yes', '--no-login', '--no-auto-update'], quiet);
  assert.equal(loadConfig().autoUpdate, false);
  assert.throws(() => readFileSync(join(off, 'settings.json')), /ENOENT/, 'no setting is written on no');
  delete process.env.CLAUDE_CONFIG_DIR;
});
