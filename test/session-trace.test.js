import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awsCall, buildSessionTrace, cxmCommand, redact } from '../src/lib/session-trace.js';

const at = (s) => `2026-10-12T10:00:${String(s).padStart(2, '0')}.000Z`;
const assistant = (id, s, content, usage = { input_tokens: 10, output_tokens: 5 }) => ({
  type: 'assistant', timestamp: at(s), sessionId: 'sess-1', message: { id, model: 'claude-x', usage, content },
});
const result = (id, s, content, isError = false) => ({
  type: 'user', timestamp: at(s), message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
});

const session = [
  { type: 'attachment', attachment: { type: 'skill_listing', content: '- cxm-agent-plugin:cxm: Run a command\n- cxm-agent-plugin:cxm-cost-drivers: Use when…\n- cxm-waste: Use when…\n- my-private-skill: secret' } },
  { type: 'user', timestamp: at(0), sessionId: 'sess-1', message: { content: 'What drives my bill? key=AKIAABCDEFGHIJKLMNOP' } },
  assistant('m1', 1, [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'cxm-agent-plugin:cxm-cost-drivers' } }]),
  result('t1', 2, 'Launching skill'),
  assistant('m2', 3, [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: "cxm analytics query '{\"filters\":[\"secret-arn\"]}'" } }]),
  result('t2', 5, 'rows for arn:aws:ec2:secret'),
  assistant('m3', 6, [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'aws ce get-cost-and-usage --time-period X' } }]),
  result('t3', 7, 'AccessDenied', true),
  assistant('m4', 8, [{ type: 'text', text: 'EC2 drives the bill.\n```chart\n{"x":"service"}\n```' }]),
  { type: 'cost-state', totalCostUSD: 0.12 },
];

test('a CXM session becomes one metadata-only trace with no content, arguments or resource ids', () => {
  const events = buildSessionTrace(session, { sessionId: 'sess-1', reason: 'exit' });
  const [trace] = events;
  assert.equal(trace.event, '$ai_trace');
  assert.deepEqual(trace.properties.cxm_skills, ['cxm-cost-drivers']);
  assert.deepEqual(trace.properties.cxm_commands, { 'analytics query': 1 });
  assert.deepEqual(trace.properties.aws_cli_calls, { 'ce get-cost-and-usage': 1 });
  assert.equal(trace.properties.turns, 4);
  assert.equal(trace.properties.tool_errors, 1);
  assert.equal(trace.properties.input_tokens, 40);
  assert.equal(trace.properties.session_cost_usd, 0.12);
  assert.deepEqual(trace.properties.viz_blocks, { chart: 1 });
  assert.deepEqual(trace.properties.viz_failed, { 'chart invalid': 1 }, 'a chart with no rows shows as source');
  const subagent = { ...assistant('s1', 9, [{ type: 'text', text: '```mermaid\nflowchart LR\n```' }]), isSidechain: true };
  const [withSubagent] = buildSessionTrace([...session, subagent], { sessionId: 'sess-1', reason: 'exit' });
  assert.deepEqual(withSubagent.properties.viz_blocks, { chart: 1 }, 'a block a subagent wrote is not in the reply');
  assert.deepEqual(trace.properties.cxm_skills_used, ['cxm-cost-drivers']);
  assert.deepEqual(trace.properties.cxm_skills_available, ['plugin:cxm-cost-drivers', 'project:cxm-waste']);
  assert.deepEqual(trace.properties.cxm_install, ['plugin', 'project']);
  assert.equal(events.find((e) => e.properties.cxm_skill).properties.aws_calls_after, 1);
  assert.equal(events.filter((e) => e.event === '$ai_generation').length, 4);
  assert.equal(events.filter((e) => e.event === '$ai_span').length, 3);
  assert.equal(events.find((e) => e.properties.cxm_command).properties.$ai_latency, 2);
  const sent = JSON.stringify(events);
  for (const leak of ['my-private-skill', 'What drives', 'secret-arn', 'arn:aws', 'AKIA', 'EC2 drives', 'time-period', 'sess-1']) {
    assert.ok(!sent.includes(leak), `metadata trace leaked "${leak}"`);
  }
});

test('a session that never used CXM sends nothing', () => {
  const other = [assistant('m1', 1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]), result('t1', 2, 'x')];
  assert.deepEqual(buildSessionTrace(other, { sessionId: 's' }), []);
});

test('full mode shares content, redacted and truncated', () => {
  const events = buildSessionTrace(session, { sessionId: 'sess-1', full: true });
  assert.match(events[0].properties.$ai_input_state, /What drives my bill/);
  assert.ok(!JSON.stringify(events).includes('AKIAABCDEFGHIJKLMNOP'));
  assert.equal(redact('signed in as jane.doe@example.com'), 'signed in as [EMAIL]');
  assert.equal(redact('x'.repeat(5000)).length < 4100, true);
});

test('command names come from an allowlist, never from arguments', () => {
  assert.equal(cxmCommand('cxm analytics schema costs'), 'analytics schema');
  assert.equal(cxmCommand('node /p/bin/cxm.js price --service ec2'), 'price');
  assert.equal(cxmCommand("cxm viz chart '{}'"), 'viz');
  assert.equal(cxmCommand('cxm my-secret-thing'), 'other');
  assert.equal(cxmCommand('echo cxmfoo'), null);
  assert.deepEqual(awsCall('AWS_PROFILE=x aws ec2 describe-instances --filters y'), { service: 'ec2', operation: 'describe-instances' });
});

test('a skill loaded by reading its file counts, and one with no successful command is unused', () => {
  const lines = [
    assistant('m1', 1, [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/home/u/.agents/skills/cxm-waste/SKILL.md' } }]),
    result('t1', 2, 'skill body'),
    assistant('m2', 3, [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'cxm analytics query x' } }]),
    result('t2', 4, 'Session expired', true),
  ];
  const [trace] = buildSessionTrace(lines, { sessionId: 's' });
  assert.deepEqual(trace.properties.cxm_skills, ['cxm-waste']);
  assert.deepEqual(trace.properties.cxm_skills_unused, ['cxm-waste']);
  assert.ok(!JSON.stringify(trace).includes('/home/u'));
});

test('a repo skill named cxm-* does not count as a CXM skill, called or listed', () => {
  const lines = [assistant('m1', 1, [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'cxm-dbt' } }]), result('t1', 2, 'ok')];
  assert.deepEqual(buildSessionTrace(lines, { sessionId: 's', ours: new Set(['cxm-waste']) }), []);
  const listing = { type: 'attachment', attachment: { type: 'skill_listing', content: '- cxm-create-pr: Use when…\n- cxm-agent-plugin:cxm-waste: Use when…' } };
  const [trace] = buildSessionTrace([listing, ...session.slice(1)], { sessionId: 's', ours: new Set(['cxm-waste', 'cxm-cost-drivers']) });
  assert.deepEqual(trace.properties.cxm_skills_available, ['plugin:cxm-waste']);
});
