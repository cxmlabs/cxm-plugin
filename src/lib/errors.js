// Crash reports for PostHog Error Tracking. Only unexpected errors (bugs) are reported: the message is
// sanitized and cut short, and only stack frames inside the plugin are kept, as paths relative to it.
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_MESSAGE = 200;
const SCRUB = [
  [/arn:aws[a-z-]*:[^\s"',)]+/gi, '<arn>'],
  [/https?:\/\/[^\s"',)]+/gi, '<url>'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>'],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b|\bphc_[A-Za-z0-9]{20,}|\beyJ[\w-]{10,}\.[\w-]+\.[\w-]+/g, '<secret>'],
  // Local file paths only: an API path such as /commitments/summary-sp is what makes an error actionable.
  [/(?:[A-Za-z]:\\|~\/|\/(?:Users|home|private|tmp|var|opt|root|mnt|Volumes|etc)\/)[^\s"',:)]*/g, '<path>'],
  [/\b\d{12}\b/g, '<account>'],
];

export function sanitizeMessage(message) {
  let text = String(message ?? '');
  for (const [pattern, replacement] of SCRUB) text = text.replace(pattern, replacement);
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
}

// V8 frames look like "    at fn (file:///…/src/lib/http.js:12:5)" or "    at file:///…:3:1".
function pluginFrames(stack) {
  const frames = [];
  for (const line of String(stack ?? '').split('\n').slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(?:file:\/\/)?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const file = m[2].startsWith('/') || /^[A-Za-z]:/.test(m[2]) ? m[2] : null;
    const rel = file ? relative(PLUGIN_ROOT, file) : '';
    if (!file || rel.startsWith('..') || rel.includes(`node_modules${sep}`)) continue;
    frames.push({ filename: rel.split(sep).join('/'), function: m[1] ?? '<anonymous>', lineno: Number(m[3]), colno: Number(m[4]), in_app: true, platform: 'node:javascript' });
  }
  return frames.reverse(); // PostHog, like Sentry, lists the outermost frame first
}

// The `$exception` properties PostHog Error Tracking groups into issues.
export function exceptionProperties(err, { source, command, handled = true } = {}) {
  const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-Error value thrown');
  return {
    $exception_list: [
      {
        type: error.name || 'Error',
        value: sanitizeMessage(error.message),
        mechanism: { type: 'generic', handled, synthetic: !(err instanceof Error) },
        stacktrace: { type: 'raw', frames: pluginFrames(error.stack) },
      },
    ],
    source,
    command: command ?? null,
  };
}
