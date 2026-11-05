// Keeps the plugin current: Claude Code's own auto-update for the marketplace, a daily Codex refresh,
// and a once-a-day notice when a newer version exists. Every network or file failure here is silent.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginVersion } from './client.js';
import { loadConfig, saveConfig } from './config.js';
import { latestPublishedVersion } from './http.js';

export const MARKETPLACE = 'cxm-marketplace';
export const PLUGIN = `cxm-agent-plugin@${MARKETPLACE}`;
export const SOURCE = { source: 'git', url: 'https://github.com/cxmlabs/cxm-plugin.git' };
const DAY_MS = 24 * 60 * 60 * 1000;

// Claude Code has no command for it: the setting is `autoUpdate` on the marketplace entry it wrote
// itself into the user settings when the marketplace was added.
export function enableClaudeAutoUpdate(dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')) {
  const path = join(dir, 'settings.json');
  const settings = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const known = settings.extraKnownMarketplaces ?? {};
  settings.extraKnownMarketplaces = { ...known, [MARKETPLACE]: { source: SOURCE, ...known[MARKETPLACE], autoUpdate: true } };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

// -1, 0 or 1, on the numeric parts of two versions; a pre-release counts as its release.
export function compareVersions(a, b) {
  const parts = (v) => String(v).split('-')[0].split('.').map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  return 0;
}

// One line when a newer version exists; the registry is asked at most once a day, before the wait, so a failed check also waits a day.
export async function updateNotice({ now = Date.now(), current = pluginVersion(), fetchLatest = latestPublishedVersion } = {}) {
  const config = loadConfig() ?? {};
  if (process.env.CXM_TELEMETRY === '0' || now - (config.latestCheckedAt ?? 0) < DAY_MS) return null;
  saveConfig({ ...config, latestCheckedAt: now });
  const latest = await fetchLatest().catch(() => null);
  return latest && compareVersions(latest, current) > 0
    ? `CloudExMachina ${latest} is available (this is ${current}). Update: npx @cloudexmachina/cxm@latest install`
    : null;
}

// Codex pins the marketplace to a release tag, so a merge to main reaches nobody before its release.
export const codexPin = (version) => [
  ['codex', 'plugin', 'marketplace', 'remove', MARKETPLACE],
  ['codex', 'plugin', 'marketplace', 'add', 'cxmlabs/cxm-plugin', '--ref', `v${version}`],
  ['codex', 'plugin', 'add', PLUGIN],
];

// The newest CXM plugin version in the Codex cache, or null when Codex does not have it installed.
export function codexInstalledVersion(home = process.env.CODEX_HOME || join(homedir(), '.codex')) {
  const dir = join(home, 'plugins', 'cache', MARKETPLACE, 'cxm-agent-plugin');
  const versions = existsSync(dir) ? readdirSync(dir).filter((v) => /^\d+\.\d+\.\d+/.test(v)) : [];
  return versions.sort(compareVersions).at(-1) ?? null;
}

// Codex has no auto-update. When the user agreed, a session start launches the check below once a
// day, detached, so the session does not wait.
export function refreshCodex({ now = Date.now(), run = spawnDetached } = {}) {
  const config = loadConfig() ?? {};
  if (config.autoUpdate !== true || now - (config.codexRefreshedAt ?? 0) < DAY_MS) return false;
  saveConfig({ ...config, codexRefreshedAt: now });
  run([process.execPath, join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cxm.js'), 'hook', 'codex-update']);
  return true;
}

// Moves an installed Codex plugin to the newest release; never installs it where it is absent.
export async function updateCodex({ latest, installed = codexInstalledVersion(), run = (cmd) => spawnSync(cmd[0], cmd.slice(1), { stdio: 'ignore' }).status } = {}) {
  if (!installed) return false;
  const newest = latest ?? (await latestPublishedVersion().catch(() => null));
  if (!newest || compareVersions(newest, installed) <= 0) return false;
  for (const cmd of codexPin(newest)) if (run(cmd) !== 0) return false;
  return true;
}

function spawnDetached(argv) {
  const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}
