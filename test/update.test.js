import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// The config module reads its directory when it loads, so it is set before the import.
process.env.CXM_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cxm-update-'));
process.env.CXM_TELEMETRY = '0';
const { claudeInstalledVersion, codexInstalledVersion, compareVersions, enableClaudeAutoUpdate, refreshPlugins, updatePlugins, updateNotice } = await import('../src/lib/update.js');
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

test('a newer version is announced, the registry is asked once a day even when it fails, and CXM_TELEMETRY=0 asks nothing', async () => {
  delete process.env.CXM_TELEMETRY;
  saveConfig({});
  let asked = 0;
  const fetchLatest = async () => (asked++, '9.0.0');
  const now = 1_000 * DAY;
  assert.match(await updateNotice({ now, current: '0.2.1', fetchLatest }), /CloudExMachina 9\.0\.0 is available \(this is 0\.2\.1\)\. Update: npx @cloudexmachina\/cxm@latest install/);
  assert.equal(await updateNotice({ now: now + 1000, current: '0.2.1', fetchLatest }), null, 'once a day');
  assert.equal(await updateNotice({ now: now + DAY, current: '9.0.0', fetchLatest }), null, 'nothing when current');
  assert.equal(asked, 2);
  saveConfig({});
  assert.equal(await updateNotice({ now, current: '0.2.1', fetchLatest: async () => { throw new Error('offline'); } }), null);
  assert.equal(await updateNotice({ now: now + 1000, current: '0.2.1', fetchLatest }), null, 'a failed check also waits a day');
  saveConfig({});
  process.env.CXM_TELEMETRY = '0';
  assert.equal(await updateNotice({ now, current: '0.2.1', fetchLatest }), null);
  assert.equal(asked, 2, 'the registry is not asked');
});

test('the plugins are refreshed at a session start only when the user agreed, and at most once a day', () => {
  const runs = [];
  const run = (cmd) => runs.push(cmd);
  saveConfig({ autoUpdate: false });
  assert.equal(refreshPlugins({ now: DAY, run }), false);
  saveConfig({ autoUpdate: true });
  assert.equal(refreshPlugins({ now: DAY, run }), true);
  assert.equal(refreshPlugins({ now: DAY + 1000, run }), false);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].slice(-2), ['hook', 'self-update']);
});

test('the update moves each installed plugin to the newest release, Claude Code and Codex, and never installs one', async () => {
  const ran = [];
  const run = (cmd) => (ran.push(cmd.join(' ')), 0);
  assert.deepEqual(await updatePlugins({ claude: null, codex: null, latest: '0.3.1', run }), [], 'absent: left absent');
  assert.deepEqual(await updatePlugins({ claude: '0.3.1', codex: '0.3.1', latest: '0.3.1', run }), [], 'current: nothing to do');
  assert.deepEqual(await updatePlugins({ claude: '0.3.0', codex: '0.3.0', latest: '0.3.1', run }), ['claude', 'codex']);
  assert.deepEqual(ran, [
    'claude plugin marketplace update cxm-marketplace',
    'claude plugin update cxm-agent-plugin@cxm-marketplace',
    'codex plugin marketplace remove cxm-marketplace',
    'codex plugin marketplace add cxmlabs/cxm-plugin --ref v0.3.1',
    'codex plugin add cxm-agent-plugin@cxm-marketplace',
  ]);
  assert.deepEqual(await updatePlugins({ claude: '0.3.0', codex: null, latest: '0.3.1', run: () => 1 }), [], 'a failed command reports no update');
  const home = mkdtempSync(join(tmpdir(), 'cxm-codex-'));
  for (const v of ['0.2.0', '0.10.1', '0.9.0']) mkdirSync(join(home, 'plugins', 'cache', 'cxm-marketplace', 'cxm-agent-plugin', v), { recursive: true });
  assert.equal(codexInstalledVersion(home), '0.10.1');
  const claude = mkdtempSync(join(tmpdir(), 'cxm-claude-'));
  mkdirSync(join(claude, 'plugins'));
  writeFileSync(join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'cxm-agent-plugin@cxm-marketplace': [{ version: '0.3.0' }] } }));
  assert.equal(claudeInstalledVersion(claude), '0.3.0');
  assert.equal(claudeInstalledVersion(mkdtempSync(join(tmpdir(), 'cxm-claude-'))), null);
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
  const failed = mkdtempSync(join(tmpdir(), 'cxm-claude-'));
  process.env.CLAUDE_CONFIG_DIR = failed;
  await install(['--yes', '--no-login'], { run: (cmd) => (cmd[0] === 'claude' ? 1 : 0), status: () => 'ready' }).catch(() => {});
  assert.throws(() => readFileSync(join(failed, 'settings.json')), /ENOENT/, 'no setting for a Claude Code install that failed');
  delete process.env.CLAUDE_CONFIG_DIR;
});
