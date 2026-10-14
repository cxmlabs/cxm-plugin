import { clientHeaders } from './client.js';
import { deriveHosts } from './urls.js';

const RELOGIN = 'Session expired or unauthorized. Run: cxm login';

// The session APIs read the token from the sAccessToken cookie (they are configured
// cookie-transfer), so send it there. Bearer is kept for anything header-based.
function authHeaders(config) {
  return {
    ...clientHeaders(),
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.accessToken}`,
    Cookie: `sAccessToken=${config.accessToken}`,
  };
}

// CubeJS /load: bearer token + Active-Organization header, exactly like the web app.
// A cold query answers with {"error":"Continue wait"} and must be re-polled until ready.
export async function cubeLoad(config, query, { maxWaitMs = 150000 } = {}) {
  const { cube } = deriveHosts(config);
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const res = await fetch(`${cube}/load`, {
      method: 'POST',
      headers: {
        ...clientHeaders(),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.accessToken}`,
        'Active-Organization': config.organizationId,
      },
      body: JSON.stringify({ query }),
    });
    if (res.status === 401 || res.status === 403) throw new Error(RELOGIN);
    const body = await res.json().catch(() => ({}));
    if (body.error === 'Continue wait') {
      if (Date.now() > deadline) throw new Error('CubeJS query timed out waiting for results.');
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!res.ok || body.error) {
      // A platform-side permission failure names internal roles and buckets: never pass it through.
      if (/PERMISSION_DENIED|AccessDenied|arn:aws:/.test(String(body.error))) {
        throw new Error('CubeJS error: the platform could not read this dataset. Report it to CloudExMachina support.');
      }
      const hint = /invalid input value for enum|not found for path/.test(String(body.error))
        ? " Run 'cxm analytics schema <dataset>' and use a listed member, segment or value."
        : '';
      throw new Error(`CubeJS error: ${body.error || res.status}${hint}`);
    }
    return body.data ?? [];
  }
}

// CubeJS /meta: the schema (every cube's measures + dimensions). Same auth as /load. Lets a skill
// discover the exact measure/dimension names in ONE call instead of guessing or grepping — the
// schema-discovery tax that burns turns.
export async function cubeMeta(config) {
  const { cube } = deriveHosts(config);
  const res = await fetch(`${cube}/meta`, {
    headers: {
      ...clientHeaders(),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.accessToken}`,
      'Active-Organization': config.organizationId,
    },
  });
  if (res.status === 401 || res.status === 403) throw new Error(RELOGIN);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`CubeJS meta error: ${body.error || res.status}`);
  return body.cubes ?? [];
}

// Current user + organizations from the tenant API — the env-stable connection check.
export async function currentUser(config) {
  const { tenantApi } = deriveHosts(config);
  const res = await fetch(`${tenantApi}/users/current`, { headers: authHeaders(config) });
  if (res.status === 401 || res.status === 403) throw new Error(RELOGIN);
  if (!res.ok) throw new Error(`Tenant API /users/current failed: ${res.status}`);
  return res.json();
}

// Passthrough for the per-organization REST API (actions + reporting).
export async function orgApi(config, method, path, body) {
  const { orgApi: base } = deriveHosts(config);
  const res = await fetch(`${base}/${config.organizationId}${path}`, {
    method,
    headers: authHeaders(config),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401) throw new Error(RELOGIN);
  if (res.status === 403) throw new Error("Access denied — your CXM role lacks 'data:write'. Ask an admin for an editor role.");
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Org API ${method} ${path} failed: ${res.status}. ${detail.slice(0, 300)}`);
  }
  return res.status === 204 ? {} : res.json();
}
