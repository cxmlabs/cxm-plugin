// Keeps the plugin current: Claude Code's own auto-update for the marketplace, a daily Codex refresh,
// and a once-a-day notice when a newer version exists. Every network or file failure here is silent.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pluginVersion } from './client.js';
import { loadConfig, saveConfig } from './config.js';

export const MARKETPLACE = 'cxm-marketplace';
export const PLUGIN = `cxm-agent-plugin@${MARKETPLACE}`;
const SOURCE = { source: 'git', url: 'https://github.com/cxmlabs/cxm-plugin.git' };
const REGISTRY = 'https://registry.npmjs.org/@cloudexmachina/cxm/latest';
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

// The latest published version, asked at most once a day and kept in the config.
export async function latestVersion({ now = Date.now(), fetchJson = registryLatest } = {}) {
  const config = loadConfig() ?? {};
  if (config.latestVersion && now - (config.latestCheckedAt ?? 0) < DAY_MS) return config.latestVersion;
  const latest = await fetchJson().catch(() => null);
  saveConfig({ ...(loadConfig() ?? {}), latestCheckedAt: now, ...(latest ? { latestVersion: latest } : {}) });
  return latest ?? config.latestVersion ?? null;
}

async function registryLatest() {
  const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(2000) });
  return res.ok ? (await res.json()).version : null;
}

// One line when a newer version exists, at most once a day; null otherwise.
export async function updateNotice({ now = Date.now(), current = pluginVersion(), fetchJson } = {}) {
  const latest = await latestVersion({ now, fetchJson });
  const config = loadConfig() ?? {};
  if (!latest || compareVersions(latest, current) <= 0 || now - (config.noticeShownAt ?? 0) < DAY_MS) return null;
  saveConfig({ ...config, noticeShownAt: now });
  return `CloudExMachina ${latest} is available (this is ${current}). Update: npx @cloudexmachina/cxm@latest install`;
}

// Codex has no auto-update. When the user agreed, a session start refreshes the marketplace and
// re-adds the plugin, once a day, detached so the session does not wait.
export function refreshCodex({ now = Date.now(), run = spawnDetached } = {}) {
  const config = loadConfig() ?? {};
  if (config.autoUpdate !== true || now - (config.codexRefreshedAt ?? 0) < DAY_MS) return false;
  saveConfig({ ...config, codexRefreshedAt: now });
  run(`codex plugin marketplace upgrade ${MARKETPLACE} && codex plugin add ${PLUGIN}`);
  return true;
}

function spawnDetached(command) {
  const child = spawn('sh', ['-c', `command -v codex >/dev/null 2>&1 && { ${command}; }`], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}
