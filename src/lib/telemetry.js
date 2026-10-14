// Pseudonymous product-usage analytics for the plugin. Opt-out with CXM_TELEMETRY=0; CXM_TELEMETRY=full also
// shares session content (see session-trace.js). Fire-and-forget POST to the product-analytics ingest — never
// throws, never blocks a command, no runtime deps (stdlib fetch). By default only COARSE metadata leaves the
// machine: NEVER cloud data, answers, query contents, resource ids/arns, or command arguments.

import { randomUUID } from 'node:crypto';
import { arch, platform, release } from 'node:os';
import { pluginVersion } from './client.js';
import { exceptionProperties } from './errors.js';
import { loadConfig, saveConfig } from './config.js';

// Write-only ingest key for the product-analytics project. Safe to ship: it sends events and
// cannot read them. Same kind of key as before, in the plugin's own project.
const BAKED_KEY = 'phc_xtYRe5MvWTcWDF6qicjiievMkb22Cc7VCcFoQyd5pmCV';
const DEFAULT_HOST = 'https://eu.i.posthog.com';

const enabled = () => process.env.CXM_TELEMETRY !== '0';
// The customer opts in to sharing session content; the default is metadata only.
export const shareContent = () => process.env.CXM_TELEMETRY === 'full';

// Stable anonymous id, minted once and persisted. Never PII.
function distinctId(config) {
  if (config?.distinctId) return config.distinctId;
  const id = randomUUID();
  try {
    saveConfig({ ...(config ?? {}), distinctId: id });
  } catch {
    /* best-effort — a read-only config just means a fresh id next time */
  }
  return id;
}

function buildPayload(event, properties, config) {
  const orgId = config?.organizationId;
  // Mint once. Two calls with the same loaded config minted two ids on a new machine.
  const id = distinctId(config);
  return {
    api_key: process.env.POSTHOG_KEY || BAKED_KEY,
    event,
    distinct_id: id,
    properties: {
      plugin_version: pluginVersion(),
      node_version: process.version,
      node_major: Number(process.versions.node.split('.')[0]) || null,
      os: `${platform()} ${arch()}`,
      platform: platform(),
      arch: arch(),
      os_release: release(),
      ci: !!(process.env.CI || process.env.GITHUB_ACTIONS),
      term_program: process.env.TERM_PROGRAM || null,
      // Coarse "why/when": a human typing `cxm` (tty) vs a coding agent/skill invoking it.
      surface: process.stdin.isTTY ? 'tty' : 'agent',
      // Same value as distinct_id, duplicated as a property so "calls per machine" is a simple breakdown.
      machine_id: id,
      session_id: config?.sessionId,
      organization_id: orgId,
      ...(orgId ? { $groups: { organization: orgId } } : {}),
      ...properties,
    },
    timestamp: new Date().toISOString(),
  };
}

// Bucket an error message into a low-cardinality class so PostHog can break errors down by TYPE (what
// actually fails on customer machines) instead of by unique message string. Coarse on purpose.
export function classifyError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  if (!m) return 'other';
  if (m.includes('aborted with ctrl+c') || m.includes('authorization was denied')) return 'cancelled';
  if (m.includes('session expired') || m.includes('not logged in') || m.includes('run: cxm login')) return 'auth_expired';
  if (m.includes('role lacks') || m.includes('access denied')) return 'authz';
  // Input errors first — their message can mention the query engine.
  if (m.includes('requires') || m.includes('unexpected token')) return 'bad_input';
  if (m.includes('cubejs meta')) return 'cube_meta';
  if (m.includes('timed out')) return 'timeout';
  if (m.includes('cubejs')) return 'cube_query';
  if (/\b5\d\d\b/.test(m)) return 'http_5xx';
  if (/\b4\d\d\b/.test(m)) return 'http_4xx';
  if (m.includes('fetch failed') || m.includes('network') || m.includes('enotfound') || m.includes('econnrefused')) return 'network';
  return 'other';
}

// Emit one event. Returns whether it was sent (false when disabled or on any failure). CXM_TELEMETRY_DRYRUN
// returns the payload instead of sending — used by tests and for `cxm`-debugging what would be emitted.
export async function emit(event, properties = {}) {
  if (!enabled()) return false;
  const config = loadConfig();
  const payload = buildPayload(event, properties, config);
  if (process.env.CXM_TELEMETRY_DRYRUN) return payload;
  const host = (process.env.POSTHOG_HOST || DEFAULT_HOST).replace(/\/$/, '');
  try {
    const res = await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false; // analytics must never break a command
  }
}

// Emit many events in one request (one session trace). Same base properties and opt-out as `emit`.
export async function emitBatch(events) {
  if (!enabled() || !events.length) return false;
  const config = loadConfig();
  const batch = events.map(({ event, properties, timestamp }) => {
    const { api_key, ...payload } = buildPayload(event, properties, config);
    return { ...payload, timestamp: timestamp ?? payload.timestamp };
  });
  if (process.env.CXM_TELEMETRY_DRYRUN) return batch;
  const host = (process.env.POSTHOG_HOST || DEFAULT_HOST).replace(/\/$/, '');
  try {
    const res = await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.POSTHOG_KEY || BAKED_KEY, batch }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// A bug, not an expected failure: one sanitized crash report for PostHog Error Tracking (see errors.js).
export function reportCrash(err, context) {
  return emit('$exception', exceptionProperties(err, context));
}
