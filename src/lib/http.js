import { clientHeaders } from './client.js';
import { deriveHosts } from './urls.js';

export const RELOGIN = 'Session expired or unauthorized. Run: cxm login';

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

const RETRY_WAITS_MS = [1000, 2000, 4000, 8000, 16000];

// One per read, so the limit covers every poll of that read. Never send a write through it.
function gatewayRetry(deadline = Date.now() + 150000) {
  let failures = 0;
  return async (url, init) => {
    for (;;) {
      const started = Date.now();
      const res = await fetch(url, init);
      if (![502, 503, 504].includes(res.status)) return res;
      const wait = RETRY_WAITS_MS[failures++];
      if (wait === undefined || Date.now() + wait + (Date.now() - started) > deadline) {
        throw new Error(`CXM did not answer: HTTP ${res.status} after ${failures} tries. The request changed nothing. Try again in a few minutes.`);
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  };
}

// CubeJS /load: bearer token + Active-Organization header, exactly like the web app.
// A cold query answers with {"error":"Continue wait"} and must be re-polled until ready.
export async function cubeLoad(config, query, { maxWaitMs = 150000 } = {}) {
  const { cube } = deriveHosts(config);
  const deadline = Date.now() + maxWaitMs;
  const read = gatewayRetry(deadline);
  for (;;) {
    const res = await read(`${cube}/load`, {
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
  const res = await gatewayRetry()(`${cube}/meta`, {
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
  const res = await gatewayRetry()(`${tenantApi}/users/current`, { headers: authHeaders(config) });
  if (res.status === 401 || res.status === 403) throw new Error(RELOGIN);
  if (!res.ok) throw new Error(`Tenant API /users/current failed: ${res.status}`);
  return res.json();
}

// The latest published CLI version, from the public npm registry. No auth header: it is not a CXM host.
export async function latestPublishedVersion() {
  const res = await fetch('https://registry.npmjs.org/@cloudexmachina/cxm/latest', { signal: AbortSignal.timeout(2000) });
  return res.ok ? (await res.json()).version : null;
}

// Passthrough for the per-organization REST API (actions + reporting).
export async function orgApi(config, method, path, body) {
  const { orgApi: base } = deriveHosts(config);
  const send = method === 'GET' ? gatewayRetry() : fetch;
  const res = await send(`${base}/${config.organizationId}${path}`, {
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

const MCP_WAIT_MS = 90_000; // the service itself waits 50 seconds for its data
const MCP_MAX_MB = 10;
const MCP_ID = 1;
export const mcpShapeError = (status) => new Error(`The CxM MCP gave an answer that is not JSON-RPC (HTTP ${status}).`);

const eventData = (event) => event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');

// The JSON-RPC answer in a text, or undefined.
function mcpAnswer(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (message?.jsonrpc !== '2.0') return undefined;
  if (message.error && typeof message.error === 'object') return message;
  return message.id === MCP_ID && message.result && typeof message.result === 'object' ? message : undefined;
}

// Reads no more than the answer: an event stream can stay open after it.
async function readMcpAnswer(res) {
  const stream = (res.headers.get('content-type') ?? '').startsWith('text/event-stream');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for await (const chunk of res.body ?? []) {
    bytes += chunk.length;
    if (bytes > MCP_MAX_MB * 1024 * 1024) throw new Error(`The answer of the CxM MCP is larger than ${MCP_MAX_MB} MB.`);
    text += decoder.decode(chunk, { stream: true });
    if (!stream) continue;
    const events = text.split(/\r?\n\r?\n/);
    text = events.pop();
    for (const event of events) {
      const answer = mcpAnswer(eventData(event));
      if (answer) return answer;
    }
  }
  return mcpAnswer(stream ? eventData(text) : text);
}

// One JSON-RPC request to the hosted MCP. A list is a read. A tool call is sent once. No redirect, so the token stays on one host.
export async function mcpRequest(config, method, params = {}) {
  const { mcp } = deriveHosts(config);
  const send = method === 'tools/list' ? gatewayRetry(Date.now() + MCP_WAIT_MS) : fetch;
  try {
    const res = await send(mcp, {
      method: 'POST',
      headers: {
        ...clientHeaders(),
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: MCP_ID, method, params }),
      redirect: 'manual',
      signal: AbortSignal.timeout(MCP_WAIT_MS),
    });
    if (res.status === 401) throw new Error(RELOGIN);
    if (res.status === 404) throw new Error('No CxM MCP on this deployment (HTTP 404).');
    if (res.status === 403 && !res.headers.get('content-type')?.includes('json')) {
      throw new Error('The request was refused before it reached the CxM MCP (HTTP 403).');
    }
    const answer = await readMcpAnswer(res);
    if (answer?.error) throw new Error(`The CxM MCP refused the request: ${answer.error.message ?? 'no reason'}`);
    if (!answer || !res.ok) throw mcpShapeError(res.status);
    return answer.result;
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new Error(`The CxM MCP timed out after ${MCP_WAIT_MS / 1000} seconds.`);
    // Only a network fault of `fetch` has a cause.
    if (!err?.cause) throw err;
    if (err.cause.code === 'ENOTFOUND') throw new Error('No CxM MCP on this deployment (no host), or this machine cannot resolve the host. Check the network.');
    throw new Error(`The CxM MCP did not answer: network fault (${err.cause.code ?? 'no code'}).`);
  }
}
