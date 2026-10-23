// Turn a Claude Code session transcript into one PostHog AI trace. Pure: no I/O, so tests feed it lines.
// Metadata by default; content only when `full` is set, truncated and with obvious secrets redacted.
// A session that never used CXM produces nothing: we do not observe the customer's other work.

import { createHash } from 'node:crypto';
import { draw, needsRows, splitReply } from './viz.js';

// `cxm` sub-commands we may name. Anything else is reported as `other`, so an argument can never leak.
const CXM_COMMANDS = new Set([
  'setup', 'init', 'login', 'whoami', 'uninstall', 'price', 'context', 'resolve', 'scan', 'report-opportunity', 'api',
  'analytics query', 'analytics schema', 'cube', 'wiki', 'viz', 'viz chart', 'viz cube-chart', 'viz row', 'viz mermaid',
]);
const CXM_CALL = /(?:^|[\s;&|(`])(?:cxm|\S*\/bin\/cxm\.js)\s+([a-z-]+)(?:\s+([a-z-]+))?/;
const AWS_CALL = /(?:^|[\s;&|(`])aws\s+([a-z0-9-]+)\s+([a-z0-9-]+)/;
const BUILTIN_TOOL = /^[A-Z][A-Za-z]+$/;
const MAX_EVENTS = 400;
const MAX_CHARS = 4000;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const SECRET = /\b(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|phc_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b|((?:secret|token|password|passwd|api[_-]?key)["'\s:=]+)[^\s"',}]{8,}/gi;

// Why a block would show as source, not drawn: its kind and a fixed reason, never its content.
function drawFailure({ kind, body }) {
  try {
    if (!needsRows(kind, body)) draw(kind, body);
    return null;
  } catch (err) {
    return `${kind} ${err instanceof SyntaxError ? 'unparseable' : 'invalid'}`;
  }
}

export const hashId = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 32);

export function cxmCommand(command) {
  const m = CXM_CALL.exec(command ?? '');
  if (!m) return null;
  const two = m[2] ? `${m[1]} ${m[2]}` : null;
  if (two && CXM_COMMANDS.has(two)) return two;
  return CXM_COMMANDS.has(m[1]) ? m[1] : 'other';
}

export function awsCall(command) {
  const m = AWS_CALL.exec(command ?? '');
  return m ? { service: m[1], operation: m[2] } : null;
}

function cxmSkill(input, ours) {
  const skill = String(input?.skill ?? '').split(':').pop();
  return skill.startsWith('cxm-') && (!ours || ours.has(skill)) ? skill : null;
}

// A skill can also be loaded by reading its file (Codex does this). Keep only the skill name, never the path.
function skillRead(tool, input, ours) {
  const m = tool === 'Read' ? /(?:^|\/)skills\/(cxm-[a-z0-9-]+)\/SKILL\.md$/.exec(String(input?.file_path ?? '')) : null;
  return m && (!ours || ours.has(m[1])) ? m[1] : null;
}

// Our skills in the harness's skill listing: `cxm-agent-plugin:cxm-x` comes from the marketplace plugin, a bare
// `cxm-x` from a per-project `cxm setup` copy. Every other skill the customer has is ignored, including a
// repo's own `cxm-*` skills: only the names this plugin ships count.
function listedSkills(content, ours) {
  return [...String(content ?? '').matchAll(/^- ([\w-]+:)?(cxm-[a-z0-9-]+): /gm)]
    .filter((m) => !ours || ours.has(m[2]))
    .map((m) => (m[1] ? `plugin:${m[2]}` : `project:${m[2]}`));
}

function toolName(name) {
  if (String(name).startsWith('mcp__')) return 'mcp';
  return BUILTIN_TOOL.test(name) ? name : 'other';
}

export function redact(text) {
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  const clean = (s ?? '').replace(SECRET, (all, token, prefix) => (prefix ? `${prefix}[REDACTED]` : '[REDACTED]')).replace(EMAIL, '[EMAIL]');
  return clean.length > MAX_CHARS ? `${clean.slice(0, MAX_CHARS)}…[truncated]` : clean;
}

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : (content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const ms = (a, b) => (a && b ? Math.max(0, Date.parse(b) - Date.parse(a)) / 1000 : undefined);

// `lines`: the parsed JSONL entries of one transcript. Returns [] when the session did not use CXM, unless
// `always` (the private benchmark traces its no-plugin lanes with the same parser).
export function buildSessionTrace(lines, { sessionId, reason, full = false, always = false, ours } = {}) {
  const traceId = hashId(sessionId ?? lines.find((l) => l.sessionId)?.sessionId ?? 'unknown');
  const generations = new Map(); // message id -> { model, usage, start, end, sidechain, text }
  const toolUses = new Map(); // tool_use id -> span draft
  const results = new Map(); // tool_use id -> { at, isError, content }
  let firstPrompt = null;
  let lastAt = null;
  let cost = null;
  let slashCxm = false;
  let available = [];

  for (const line of lines) {
    if (line.type === 'cost-state') cost = line;
    if (line.type === 'attachment' && line.attachment?.type === 'skill_listing') available = listedSkills(line.attachment.content, ours);
    if (line.timestamp) lastAt = line.timestamp;
    const msg = line.message;
    if (!msg) continue;
    if (line.type === 'user') {
      if (typeof msg.content === 'string') {
        if (firstPrompt === null && !line.isSidechain) firstPrompt = msg.content;
        if (/<command-name>\/?cxm<\/command-name>/.test(msg.content)) slashCxm = true;
      }
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b.type === 'tool_result') results.set(b.tool_use_id, { at: line.timestamp, isError: !!b.is_error, content: b.content });
      }
    }
    if (line.type === 'assistant' && msg.id) {
      const g = generations.get(msg.id) ?? { start: line.timestamp, sidechain: !!line.isSidechain, text: [] };
      g.model = msg.model;
      g.usage = msg.usage ?? g.usage;
      g.end = line.timestamp;
      for (const b of msg.content ?? []) {
        if (b.type === 'text') g.text.push(b.text);
        if (b.type === 'tool_use') toolUses.set(b.id, { name: b.name, input: b.input, at: line.timestamp, parent: msg.id });
      }
      generations.set(msg.id, g);
    }
  }

  const spans = [...toolUses.entries()].map(([id, t]) => {
    const r = results.get(id);
    const command = t.name === 'Bash' ? t.input?.command : null;
    return {
      id,
      tool: toolName(t.name),
      skill: t.name === 'Skill' ? cxmSkill(t.input, ours) : skillRead(t.name, t.input, ours),
      cxm: command ? cxmCommand(command) : null,
      aws: command ? awsCall(command) : null,
      isError: r?.isError ?? false,
      latency: ms(t.at, r?.at),
      at: t.at,
      parent: t.parent,
      input: t.input,
      output: r?.content,
    };
  });

  spans.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  // A loaded skill counts as used when a `cxm` command succeeds before the next skill loads.
  let current = null;
  for (const s of spans) {
    if (s.skill) {
      current = s;
      Object.assign(s, { followedOk: 0, followedErrors: 0, followedAws: 0 });
    } else if (current) {
      if (s.cxm) current[s.isError ? 'followedErrors' : 'followedOk']++;
      if (s.aws) current.followedAws++;
    }
  }
  const skills = [...new Set(spans.map((s) => s.skill).filter(Boolean))];
  const used = new Set(spans.filter((s) => s.skill && s.followedOk > 0).map((s) => s.skill));
  const cxmCalls = spans.filter((s) => s.cxm);
  if (!always && !skills.length && !cxmCalls.length && !slashCxm) return [];

  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const generationEvents = [...generations.entries()].map(([id, g]) => {
    const u = g.usage ?? {};
    tokens.input += u.input_tokens ?? 0;
    tokens.output += u.output_tokens ?? 0;
    tokens.cacheRead += u.cache_read_input_tokens ?? 0;
    tokens.cacheWrite += u.cache_creation_input_tokens ?? 0;
    return {
      event: '$ai_generation',
      timestamp: g.end,
      properties: {
        $ai_trace_id: traceId,
        $ai_session_id: traceId,
        $ai_span_id: hashId(id),
        $ai_model: g.model,
        $ai_provider: 'anthropic',
        $ai_input_tokens: u.input_tokens ?? 0,
        $ai_output_tokens: u.output_tokens ?? 0,
        $ai_cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        $ai_cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
        $ai_latency: ms(g.start, g.end),
        subagent: g.sidechain,
        ...(full ? { $ai_output_choices: [{ role: 'assistant', content: redact(g.text.join('\n')) }] } : {}),
      },
    };
  });

  const spanEvents = spans.map((s) => ({
    event: '$ai_span',
    timestamp: s.at,
    properties: {
      $ai_trace_id: traceId,
      $ai_session_id: traceId,
      $ai_span_id: hashId(s.id),
      $ai_parent_id: hashId(s.parent),
      $ai_span_name: s.skill ?? (s.cxm ? `cxm ${s.cxm}` : s.aws ? 'aws' : s.tool),
      $ai_latency: s.latency,
      $ai_is_error: s.isError,
      tool: s.tool,
      cxm_skill: s.skill,
      ...(s.skill ? { skill_used: s.followedOk > 0, cxm_commands_after: s.followedOk, cxm_errors_after: s.followedErrors, aws_calls_after: s.followedAws } : {}),
      cxm_command: s.cxm,
      aws_service: s.aws?.service ?? null,
      aws_operation: s.aws?.operation ?? null,
      ...(full ? { $ai_input_state: redact(s.input), $ai_output_state: redact(textOf(s.output) || s.output) } : {}),
    },
  }));

  const count = (list) => list.reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});
  const finalText = [...generations.values()].filter((g) => !g.sidechain).flatMap((g) => g.text).pop() ?? '';
  const children = [...generationEvents, ...spanEvents].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const truncated = children.length > MAX_EVENTS;
  const firstAt = lines.find((l) => l.timestamp)?.timestamp;

  const blocks = [...generations.values()].filter((g) => !g.sidechain).flatMap((g) => splitReply(g.text.join('\n')).filter((p) => p.kind));
  const trace = {
    event: '$ai_trace',
    timestamp: lastAt,
    properties: {
      $ai_trace_id: traceId,
      $ai_session_id: traceId,
      $ai_span_name: 'cxm session',
      $ai_latency: ms(firstAt, lastAt),
      $ai_is_error: spans.some((s) => s.cxm && s.isError),
      $ai_input_state: full ? redact(firstPrompt ?? '') : null,
      $ai_output_state: full ? redact(finalText) : null,
      end_reason: reason ?? null,
      models: [...new Set([...generations.values()].map((g) => g.model).filter(Boolean))],
      turns: generations.size,
      tool_calls: spans.length,
      tool_errors: spans.filter((s) => s.isError).length,
      tools: count(spans.map((s) => s.tool)),
      cxm_skills: skills,
      cxm_skills_used: [...used],
      cxm_skills_unused: skills.filter((k) => !used.has(k)),
      cxm_skills_available: available,
      cxm_install: [...new Set(available.map((a) => a.split(':')[0]))],
      cxm_commands: count(cxmCalls.map((s) => s.cxm)),
      cxm_errors: cxmCalls.filter((s) => s.isError).length,
      cxm_slash_command: slashCxm,
      // Blocks the main agent wrote for the reply renderer; `cxm_commands['viz <kind>']` counts the text fallback.
      viz_blocks: count(blocks.map((p) => p.kind)),
      viz_failed: count(blocks.map(drawFailure).filter(Boolean)),
      aws_cli_calls: count(spans.filter((s) => s.aws).map((s) => `${s.aws.service} ${s.aws.operation}`)),
      subagent_turns: [...generations.values()].filter((g) => g.sidechain).length,
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_read_tokens: tokens.cacheRead,
      cache_write_tokens: tokens.cacheWrite,
      session_cost_usd: cost?.totalCostUSD ?? null, // not $ai_total_cost_usd: PostHog already costs each generation
      content_shared: full,
      truncated,
    },
  };
  return [trace, ...children.slice(0, MAX_EVENTS)];
}
