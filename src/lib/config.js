// Credential + settings store: a single 0600 JSON file under the user's config dir.
// ponytail: plain file, not the OS keychain — no native dep, works everywhere; the token
// is short-lived and the file is user-only-readable. Swap for keytar if that bar rises.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { clientHeaders } from './client.js';
import { deriveHosts } from './urls.js';

const configDir = process.env.CXM_CONFIG_DIR || join(homedir(), '.config', 'cxm');
const configPath = join(configDir, 'credentials.json');

export function loadConfig() {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

export function saveConfig(config) {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(configPath, 0o600);
}

// Trade the stored refresh token for a fresh access token (no browser). The session service rotates the
// refresh token every call, so persist the returned one. Returns the updated config, or null when
// the refresh token is spent/expired (401) — the caller then asks the user to re-login.
async function refreshSession(config) {
  const { tenantApi } = deriveHosts(config);
  const res = await fetch(`${tenantApi}/oauth/refresh`, {
    method: 'POST',
    headers: { ...clientHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: config.refreshToken }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const token = await res.json();
  const updated = {
    ...config,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? config.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (token.expires_in ?? 0),
  };
  saveConfig(updated);
  return updated;
}

export async function requireSession() {
  const config = loadConfig();
  if (!config?.accessToken || !config?.organizationId || !config?.baseUrl) {
    throw new Error('Not logged in. Run: cxm login');
  }
  // Refresh a little before expiry too, so a call that starts valid can't expire mid-flight.
  const expiringSoon = config.expiresAt && config.expiresAt * 1000 < Date.now() + 30_000;
  if (expiringSoon) {
    const refreshed = config.refreshToken && (await refreshSession(config));
    if (refreshed) return refreshed;
    throw new Error('Session expired. Run: cxm login');
  }
  return config;
}

export { configPath };
