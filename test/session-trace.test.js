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
  assistant('m4', 8, [{ type: 'text', text: 'EC2 drives the bill.\n```chart\n{"x":"service"}\n```\n```chart\n{not json\n```\n```cube-chart\n{"query":{}}\n```\n```chart\n{"x":"s","y":"c","data":[{"s":"EC2","c":1}]}\n```' }]),
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
  assert.deepEqual(trace.properties.viz_blocks, { chart: 3, 'cube-chart': 1 });
  assert.deepEqual(trace.properties.viz_failed, { 'chart invalid': 1, 'chart unparseable': 1 }, 'a drawable chart and a queried one are not failures');
  const subagent = { ...assistant('s1', 9, [{ type: 'text', text: '```mermaid\nflowchart LR\n```' }]), isSidechain: true };
  const [withSubagent] = buildSessionTrace([...session, subagent], { sessionId: 'sess-1', reason: 'exit' });
  assert.deepEqual(withSubagent.properties.viz_blocks, { chart: 3, 'cube-chart': 1 }, 'a block a subagent wrote is not in the reply');
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

test('the mcp command is named, and its tool and arguments are not', () => {
  for (const command of ['cxm mcp', 'cxm mcp secret-tool', "cxm mcp secret_tool '{\"secret\":1}'"]) assert.equal(cxmCommand(command), 'mcp', command);
  const calls = [assistant('m1', 1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `cxm mcp secret-tool '{"secret-argument":"our aws secretword secretverb"}'` } }]), result('t1', 2, 'secret-result')];
  const events = buildSessionTrace(calls, { sessionId: 's' });
  assert.deepEqual(events[0].properties.cxm_commands, { mcp: 1 });
  assert.deepEqual(events[0].properties.aws_cli_calls, {});
  assert.ok(!JSON.stringify(events).includes('secret'));
  const whoami = assistant('m0', 0, [{ type: 'tool_use', id: 't0', name: 'Bash', input: { command: 'cxm whoami' } }]);
  const awsCalls = (command) => buildSessionTrace([whoami, assistant('m1', 1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command } }])], { sessionId: 's' })[0].properties.aws_cli_calls;
  const argument = `'{"q":"our aws secretword secretverb"}'`;
  for (const call of ['cxm', '~/.local/bin/cxm', '"$HOME/.local/bin/cxm"', 'npx @cloudexmachina/cxm@latest', 'node "/p/bin/cxm.js"', 'cxm \\\n', 'C=cxm; $C']) assert.deepEqual(awsCalls(`${call} mcp t ${argument}`), {}, call);
  for (const command of [`cxm 'mcp' t ${argument}`, `python3 - <<'EOF'\nsubprocess.run(["cxm", "mcp", "t", "our aws secretword secretverb"])\nEOF`, `node "/p/bin/cxm.js" context 'our aws secretword secretverb'`, `npx @cloudexmachina/cxm@latest context 'our aws secretword secretverb'`]) assert.deepEqual(awsCalls(command), {}, command);
  // A quoted word is a boundary: the words on its two sides never join.
  for (const command of ['aws "s3" ls my-bucket --profile cxm', 'aws --profile "cxm-prod" sts get-caller-identity']) assert.deepEqual(awsCalls(command), {}, command);
  for (const command of ['cxm context - <<EOF\nour aws secretword secretverb\nEOF', "cxm context 'it'\\''s aws secretword secretverb'"]) assert.deepEqual(awsCalls(command), {}, command);
  for (const command of ["cxm whoami # don't\naws s3 ls\n# don't", 'cxm whoami && aws s3 ls', 'aws s3 ls cxm --recursive', 'aws s3 ls --profile cxm --region us-east-1', "cxm whoami;# don't\naws s3 ls\n# don't"]) assert.deepEqual(awsCalls(command), { 's3 ls': 1 }, command);
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
  assert.equal(cxmCommand("cxm viz chart '{}'"), 'viz chart');
  assert.equal(cxmCommand('cxm viz foo'), 'viz');
  assert.equal(cxmCommand("cxm cost-result <<'EOF'"), 'cost-result');
  assert.equal(cxmCommand('cxm my-secret-thing'), 'other');
  assert.equal(cxmCommand('echo cxmfoo'), null);
  assert.deepEqual(awsCall('AWS_PROFILE=x aws ec2 describe-instances --filters y'), { service: 'ec2', operation: 'describe-instances' });
  assert.equal(awsCall('cxm mcp t aws s3 ls'), null);
  assert.deepEqual(awsCall("cat > n.md <<'EOF'\nask cxm mcp\nEOF\naws s3 ls"), { service: 's3', operation: 'ls' });
  assert.equal(awsCall('cxm context - <<EOF\naws s3 ls\nEOF'), null);
});

test('a heredoc body never reaches the command name or the aws call', () => {
  const command = "cxm cost-result <<'EOF'\nthe aws batch payroll-nightly job\nEOF";
  const lines = [assistant('m1', 1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command } }]), result('t1', 2, 'ok')];
  const events = buildSessionTrace(lines, { sessionId: 's' });
  const span = events.find((e) => e.properties.cxm_command);
  assert.equal(span.properties.cxm_command, 'cost-result');
  assert.equal(span.properties.aws_service, null);
  assert.ok(!JSON.stringify(events).includes('payroll-nightly'));
  const spanOf = (command) => buildSessionTrace([assistant('m0', 0, [{ type: 'tool_use', id: 't0', name: 'Bash', input: { command: 'cxm price x' } }]), assistant('m1', 1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command } }])], { sessionId: 's' })[0].properties;
  for (const opener of ["<<'END-JSON'", '<<\\END-JSON', '<<"END-JSON"', '<<-END-JSON']) assert.deepEqual(spanOf(`cxm cost-result ${opener}\nthe aws batch payroll-x\nEND-JSON\naws s3 ls`).aws_cli_calls, { 's3 ls': 1 }, opener);
  assert.deepEqual(spanOf("cat <<E'OF'\naws batch payroll-q\nEOF\naws s3 ls").aws_cli_calls, { 's3 ls': 1 });
  assert.deepEqual(spanOf('cat <<EOF:\naws batch payroll-q\nEOF:\naws s3 ls').aws_cli_calls, { 's3 ls': 1 });
  for (const tail of ['', '\n  EOF']) assert.deepEqual(spanOf(`cxm cost-result <<'EOF'\nthe aws batch payroll-z${tail}`).aws_cli_calls, {}, tail);
  assert.deepEqual(spanOf('cat <<EOF > f\n\tEOF\naws batch payroll-z\nEOF\naws s3 ls').aws_cli_calls, { 's3 ls': 1 });
  assert.deepEqual(spanOf('cat <<A <<B\nx\nA\naws batch payroll-y\nB\naws s3 ls').aws_cli_calls, { 's3 ls': 1 });
  // Text that opens no heredoc, and an empty heredoc, hide no later call.
  for (const before of ['jq . <<<"abc"', 'echo $((1<<20))', 'echo $((1<<n))', "# then cat <<'EOF' writes it", "python3 -c 'print(a << b)'", "python3 -c 'print(a << \"b\")'", "echo 'std::cout << \"hi\";' > a.cpp", "grep -n '<<<<<<< HEAD' a.py", 'rg -n "<<\'EOF\'" skills', 'cat > /tmp/e <<EOF\nEOF']) assert.deepEqual(spanOf(`${before}\ncxm whoami`).cxm_commands, { price: 1, whoami: 1 }, before);
  assert.deepEqual(spanOf('git commit -m "$(cat <<\'EOF\'\naws batch payroll-c\nEOF\n)"\naws s3 ls').aws_cli_calls, { 's3 ls': 1 });
  assert.deepEqual(spanOf("echo 'a\nb'; cat <<EOF\naws batch payroll-q\nEOF\naws s3 ls").aws_cli_calls, { 's3 ls': 1 });
  assert.deepEqual(spanOf("# it's\ncat <<EOF\naws batch payroll-q\nEOF\naws s3 ls").aws_cli_calls, { 's3 ls': 1 });
  assert.deepEqual(spanOf("cd x;# it's\ncat <<EOF\naws batch payroll-q\nEOF\naws s3 ls").aws_cli_calls, { 's3 ls': 1 });
  assert.deepEqual(spanOf("printf $'it\\'s\\n'\ncat <<EOF\naws batch payroll-q\nEOF\naws s3 ls").aws_cli_calls, { 's3 ls': 1 });
  assert.deepEqual(spanOf('if true; then\n  cat <<EOF\n  aws batch payroll-q\n  EOF\nfi').aws_cli_calls, {});
  for (const before of ['echo $(( (1 << n) - 1 ))', 'for ((i=0; i<(1<<n); i++)); do :; done']) assert.deepEqual(spanOf(`${before}\ncxm whoami`).cxm_commands, { price: 1, whoami: 1 }, before);
  assert.deepEqual(spanOf('((i++)); cat <<EOF\naws batch payroll-q\nEOF\naws s3 ls').aws_cli_calls, { 's3 ls': 1 });
  assert.deepEqual(spanOf("grep -c '((' f; cat <<EOF\naws batch payroll-q\nEOF\naws s3 ls").aws_cli_calls, { 's3 ls': 1 });
  assert.deepEqual(spanOf("echo \\$'a\\'; cat <<EOF\naws batch payroll-q\nEOF\naws s3 ls").aws_cli_calls, { 's3 ls': 1 });
  assert.doesNotThrow(() => spanOf(['cxm', 'whoami']));
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
