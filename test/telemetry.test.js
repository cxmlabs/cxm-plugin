import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Isolate the credential store so minting an anonymous distinctId can't touch the real config.
process.env.CXM_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cxm-telemetry-'));
const { emit, classifyError } = await import('../src/lib/telemetry.js');
const { computeCostResult } = await import('../src/lib/cost-lines.js');
// Absent before the change, so each test that uses it fails by itself.
const { costResultEvent, SERVICES, DIMENSIONS, OTHER_SERVICES } = await import('../src/lib/cost-event.js').catch(() => ({}));

test('opt-out: CXM_TELEMETRY=0 sends nothing', async () => {
  process.env.CXM_TELEMETRY = '0';
  delete process.env.CXM_TELEMETRY_DRYRUN;
  assert.equal(await emit('plugin.command_run', { command: 'whoami' }), false);
});

test('dry-run payload is coarse and carries no customer data', async () => {
  process.env.CXM_TELEMETRY = '1';
  process.env.CXM_TELEMETRY_DRYRUN = '1';
  const p = await emit('plugin.savings_advised', { amount_monthly_usd: 42, advice_category: 'ec2' });
  assert.equal(p.event, 'plugin.savings_advised');
  assert.ok(p.api_key.startsWith('phc_'));
  assert.ok(p.distinct_id);
  assert.ok(p.properties.plugin_version);
  assert.ok(['tty', 'agent'].includes(p.properties.surface));
  assert.equal(p.properties.amount_monthly_usd, 42);
  // The guarantee: nothing customer-identifying can ride along.
  const blob = JSON.stringify(p).toLowerCase();
  for (const forbidden of ['arn:', 'analysis', 'access_token', 'accesstoken']) {
    assert.ok(!blob.includes(forbidden), `payload must not contain ${forbidden}`);
  }
});

test('classifyError buckets errors into low-cardinality classes', () => {
  assert.equal(classifyError(new Error('Session expired or unauthorized. Run: cxm login')), 'auth_expired');
  assert.equal(classifyError(new Error("Access denied — your CXM role lacks 'data:write'.")), 'authz');
  assert.equal(classifyError(new Error('CubeJS meta error: 500')), 'cube_meta');
  assert.equal(classifyError(new Error('CubeJS query timed out waiting for results.')), 'timeout');
  assert.equal(classifyError(new Error('CubeJS error: Some cube failure')), 'cube_query');
  assert.equal(classifyError(new Error('Org API GET /x failed: 503. upstream')), 'http_5xx');
  assert.equal(classifyError(new Error('Org API GET /x failed: 404. missing')), 'http_4xx');
  assert.equal(classifyError(new TypeError('fetch failed')), 'network');
  assert.equal(classifyError(new Error("cube requires --query '<cubejs-json>'")), 'bad_input');
  assert.equal(classifyError(new Error('something odd happened')), 'other');
});

test('distinct_id and machine_id are the same value', async () => {
  process.env.CXM_TELEMETRY = '1';
  process.env.CXM_TELEMETRY_DRYRUN = '1';
  const p = await emit('plugin.command_run', { command: 'auth status' });
  // They are meant to be one id. distinctId() persists to the config file but is handed the same
  // already-loaded config object each call, so calling it twice once minted two ids and the first
  // event a machine ever sent was orphaned from every later one.
  assert.equal(p.distinct_id, p.properties.machine_id);
});

// Each text is a word that no closed list holds, and each amount is a number that no count can be.
const secret = (name) => `zq${name}zq`;
const factor = (low, high, unit, grade = 'B', more) => ({ low, high, unit, grade, source: { kind: grade === 'D' ? 'assumption' : 'dataset', ref: secret('ref') }, ...more });
const costLine = (id, key, factors, more) => ({ id: secret(id), key, target: secret('target'), item: secret('item'), at: `src/${secret('path')}.js:8117@0123abcdef`, tag: 'direct', direction: 'add', factors, ...more });
const PLANTED = 'AKIAZQZQZQZQZQZQZQZQ';
const asks = (gap, text = secret('directive')) => ({ directive: `${text} ${PLANTED} ${'x '.repeat(200)}`, gap, trigger: secret('trigger') });
const COST_INPUT = {
  schema_version: 2,
  organization: secret('organization'),
  lines: [
    costLine('one', 'aws/amazons3/write-requests', [factor(131.77, 197.31, 'x/mo', 'C', { activity: true }), { constant: 'thousand', of: 'x' }, factor(7.613, 7.613, '$/kx', 'A')]),
    costLine('two', 'github/actions/ci-minutes', [factor(0, 8423.19, 'x/mo', 'C', { shared: secret('shared') }), factor(1, 1, '$/x')], { tag: 'indirect', ...asks('no_caller_split') }),
    costLine('three', `aws/${secret('s')}${'a'.repeat(60)}/storage`, [factor(0.231, 0.331, '$/mo')]),
    costLine('four', `${secret('provider')}/amazons3/storage`, [factor(17.419, 19.611, '$/mo')], { direction: 'remove' }),
    costLine('five', `aws/amazons3/${secret('dimension')}`, [factor(117.23, 5291.43, 'x/mo', 'D'), factor(1, 1, '$/x')], { tag: 'llm' }),
    costLine('six', 'aws/999988887777/storage', [factor(2.317, 2.317, '$/mo')]),
    costLine('seven', 'aws/amazons3/storage/more', [factor(1.317, 1.317, '$/mo')]),
    costLine('eight', 'aws/zq-customer-invoices.zq/storage', [factor(1.419, 1.419, '$/mo')]),
    costLine('nine', 'github/amazons3/storage', [factor(1.531, 1.531, '$/mo')]),
  ],
  coverage: [
    { kind: 'unmeasured', what: secret('what'), why: secret('why'), source: { kind: 'route', ref: secret('ref') }, ...asks('no_access') },
    { kind: 'uncovered_target', what: secret('what'), why: secret('why'), source: { kind: 'tool', ref: secret('ref') } },
  ],
};
// Each string and each number of a value, with its object keys.
function leaves(value) {
  if (value === null || typeof value !== 'object') return [value];
  return Object.entries(value).flatMap(([key, held]) => [...(Array.isArray(value) ? [] : [key]), ...leaves(held)]);
}
const sent = async (input, options) => {
  process.env.CXM_TELEMETRY = '1';
  process.env.CXM_TELEMETRY_DRYRUN = '1';
  return emit('plugin.cost_result', costResultEvent(input, computeCostResult(input), options));
};

test('the cost-result event holds no item, target, path, ref, amount or directive', async () => {
  const { faults, result } = computeCostResult(COST_INPUT);
  assert.equal(faults, undefined, faults?.join('\n'));
  const payload = await sent(COST_INPUT);
  assert.equal(payload.event, 'plugin.cost_result');
  const base = Object.keys((await emit('plugin.command_run', {})).properties);
  const own = Object.fromEntries(Object.entries(payload.properties).filter(([key]) => !base.includes(key)));
  for (const held of leaves(payload)) if (typeof held === 'string') assert.ok(!/zq|AKIA|0123abc|99998888/i.test(held), `the payload holds ${held}`);
  // No number of the input or of the result leaves, as a number or inside a string. The counts of the event are below 10.
  const amounts = [...leaves(COST_INPUT.lines), ...leaves(result.lines), ...leaves(result.totals), ...leaves(result.headline), ...leaves(result.open)].filter((v) => typeof v === 'number' && Math.abs(v) > 10).concat(0.231, 0.331, 7.613, 2.317, 1.317, 1.419, 1.531, 8117);
  for (const held of leaves(own)) {
    for (const value of amounts) assert.ok(!String(held).includes(String(Math.abs(value))), `the payload holds ${value} in ${held}`);
    if (typeof held === 'number') assert.ok(Number.isInteger(held) && held >= 0 && held < 10, `${held} is not a count`);
  }
  const line = (more) => ({ tag: 'direct', direction: 'add', provider: 'other', service: 'other', dimension: 'other', grade: 'B', state: 'estimated', open_reason: null, size: '1_10', ratio: '1_2', factors: ['dataset:B'], activity: false, shared: false, gap: null, ...more });
  assert.deepEqual(own, {
    ok: true, fault_count: 0, fault_codes: [], line_count: 9, estimated_count: 7, open_count: 1, directive_count: 2, uncovered_targets: 1,
    coverage: { uncovered_target: 1, unmeasured: 1, not_billed: 0, doubt: 0 },
    unmeasured_gaps: ['no_access'],
    // 0.50 + 0.231 + 2.317 + 1.317 + 1.419 + 1.531 = 7.32 less 19.611 to 9.92 less 17.419: -12.30 to -7.50.
    // Line one weighs 3.00 of 29.53, more than 10 percent, so its C is the grade.
    headline: { grade: 'C', low_size: '10_100', high_size: '1_10', ratio: '1_2' },
    lines: [
      // 65.885 to 394.62 a thousand at 7.613: 0.50 to 3.00.
      line({ provider: 'aws', service: 'amazons3', dimension: 'write-requests', grade: 'C', ratio: '5_10', factors: ['dataset:C', 'constant', 'dataset:A'], activity: true }),
      line({ tag: 'indirect', provider: 'github', service: 'actions', dimension: 'ci-minutes', grade: 'C', state: 'open', open_reason: 'zero_end', size: 'gte_1000', ratio: 'gt_10', factors: ['dataset:C', 'dataset:B'], shared: true, gap: 'no_caller_split' }),
      line({ provider: 'aws', dimension: 'storage', size: 'lt_1' }), line({ direction: 'remove', dimension: 'storage', size: '10_100' }),
      line({ tag: 'llm', provider: 'aws', service: 'amazons3', grade: 'D', state: 'outside', size: 'gte_1000', ratio: 'gt_10', factors: ['assumption:D', 'dataset:B'] }),
      line({ provider: 'aws', dimension: 'storage' }), line(), line({ provider: 'aws', dimension: 'storage' }), line({ provider: 'github', dimension: 'storage' }),
    ],
  });
  // The closed lists of the keys are the ones of the skill.
  const keys = readFileSync(new URL('../skills/cxm-cost-of-change/measurement.md', import.meta.url), 'utf8').split('\n## ').find((part) => part.startsWith('Keys'));
  assert.deepEqual([...keys.split('### Services')[0].matchAll(/^- `([^`]+)`: /gm)].map((m) => m[1]).sort(), [...DIMENSIONS].sort());
  const services = [...keys.split('### Services')[1].matchAll(/^- `([^`]+)`: (.+)$/gm)].map((m) => [m[1], [...m[2].matchAll(/`([^`]+)`/g)].map((t) => t[1])]);
  assert.deepEqual(Object.fromEntries(services), SERVICES);
  assert.deepEqual([...keys.match(/^- each other provider: (.+)$/m)[1].matchAll(/`([^`]+)`/g)].map((t) => t[1]), OTHER_SERVICES);
});

test('the cost-result event is off with CXM_TELEMETRY=0, and the full mode redacts a planted key', async () => {
  const plain = costResultEvent(COST_INPUT, computeCostResult(COST_INPUT));
  assert.ok(!('directives' in plain));
  const full = costResultEvent(COST_INPUT, computeCostResult(COST_INPUT), { full: true });
  assert.equal(full.directives.length, 2);
  for (const text of full.directives) {
    assert.ok(text.startsWith(`${secret('directive')} [REDACTED] x x`), text);
    assert.equal(text.length, 300);
  }
  // The cut would leave the first half of this key, so the mask comes first.
  const late = structuredClone(COST_INPUT);
  late.lines[1].directive = `${'y'.repeat(289)} ${PLANTED}`;
  assert.ok(!JSON.stringify(costResultEvent(late, computeCostResult(late), { full: true })).includes('AKIA'));
  assert.deepEqual(Object.keys(full).filter((key) => key !== 'directives'), Object.keys(plain), 'the full mode adds the directives only');
  process.env.CXM_TELEMETRY = '0';
  delete process.env.CXM_TELEMETRY_DRYRUN;
  assert.equal(await emit('plugin.cost_result', plain), false);
});

test('a fault run sends closed codes only, and the buckets, the open reasons and the limits hold', async () => {
  const bad = structuredClone(COST_INPUT);
  bad.lines[0].tag = secret('tag');
  bad.lines[1].factors[0].unit = secret('unit');
  bad.lines[2][secret('field')] = 1;
  bad.lines[3].id = 'line "x": unknown field "y"';
  bad.lines[3].direction = secret('direction');
  bad.lines[6].at = secret('at');
  const { faults } = computeCostResult(bad);
  const event = costResultEvent(bad, { faults });
  assert.deepEqual(event, { ok: false, fault_count: faults.length, fault_codes: ['at', 'units', 'unknown_direction', 'unknown_field', 'unknown_tag'] });
  assert.ok(!/zq/.test(JSON.stringify(await sent(bad))));
  const codes = (change) => { const given = structuredClone(COST_INPUT); change(given); return costResultEvent(given, computeCostResult(given)).fault_codes; };
  assert.deepEqual(codes((g) => delete g.coverage[0].trigger), ['no_trigger']);
  assert.deepEqual(codes((g) => { g.coverage[1].trigger = secret('trigger'); }), ['extra_trigger']);
  assert.deepEqual(codes((g) => { g.lines[0].trigger = ' '; }), ['missing_text']);
  for (const [given, code] of [[undefined, 'not_an_object'], [{}, 'missing_text'], [{ schema_version: 2, organization: 'o', lines: 1, coverage: [] }, 'not_a_list']]) assert.ok(costResultEvent(given, computeCostResult(given)).fault_codes.includes(code), code);
  assert.deepEqual(costResultEvent(undefined, { faults: ['file: CXM_COST_RESULT_FILE cannot be written (ENOENT)', 'a text of tomorrow'] }).fault_codes, ['file_not_written', 'other']);

  const one = (low, high, more) => ({ ...COST_INPUT, coverage: [], lines: [costLine('l', 'aws/amazons3/storage', [factor(low, high, '$/mo')], { tag: 'llm', ...more })] });
  const line = (...args) => costResultEvent(one(...args), computeCostResult(one(...args))).lines[0];
  for (const [high, size] of [[0.99, 'lt_1'], [1, '1_10'], [9.99, '1_10'], [10, '10_100'], [100, '100_1000'], [999, '100_1000'], [1000, 'gte_1000']]) assert.equal(line(high, high).size, size, String(high));
  for (const [low, ratio] of [[100, '1_2'], [50.1, '1_2'], [50, '2_5'], [20.1, '2_5'], [20, '5_10'], [10, '5_10'], [9.9, 'gt_10'], [0, 'gt_10']]) assert.equal(line(low, 100).ratio, ratio, String(low));
  // The reason is the one of the group: a pair on one volume crosses zero, and no line of it does.
  const v = () => factor(1, 3, 'GB/mo', 'B', { shared: 'v' });
  const pair = { ...COST_INPUT, coverage: [], lines: [costLine('p', 'aws/amazons3/storage', [v(), factor(1, 4, '$/GB')], asks('other')), costLine('q', 'aws/amazons3/storage', [v(), factor(2, 2, '$/GB')], { direction: 'remove', ...asks('other') })] };
  assert.deepEqual(costResultEvent(pair, computeCostResult(pair)).lines.map((l) => [l.open_reason, l.ratio]), [['opposite_signs', 'gt_10'], ['opposite_signs', '2_5']]);
  assert.equal(line(1, 20, { tag: 'direct', ...asks('other') }).open_reason, 'ratio');
  // A float residue at a zero end is a zero end.
  const w = () => factor(1, 3, 'GB/mo', 'B', { shared: 'w' });
  const residue = { ...COST_INPUT, coverage: [], lines: [costLine('p', 'aws/amazons3/storage', [w(), factor(0.3, 5, '$/GB')], asks('other')), costLine('q', 'aws/amazons3/storage', [w(), factor(3 * 0.1, 3 * 0.1, '$/GB')], { direction: 'remove', ...asks('other') })] };
  assert.deepEqual(costResultEvent(residue, computeCostResult(residue)).lines.map((l) => l.open_reason), ['zero_end', 'zero_end']);
  // A float residue at an edge of a bucket stays on the side of the result.
  const eventOf = (key, factors) => { const input = { ...COST_INPUT, coverage: [], lines: [costLine('b', key, factors, { tag: 'direct' })] }; return costResultEvent(input, computeCostResult(input)).lines[0]; };
  const ratio = eventOf('aws/amazons3/storage', [factor(3, 30, 'x/mo'), factor(0.35, 0.35, '$/x')]);
  assert.deepEqual([ratio.state, ratio.ratio], ['estimated', '5_10']);
  assert.equal(eventOf('aws/amazons3/storage', [factor(1.1, 5.5, 'x/mo'), factor(0.07, 0.07, '$/x')]).ratio, '5_10');
  assert.equal(eventOf('aws/amazons3/storage', [factor(3 * 0.1, 0.6, '$/mo')]).ratio, '2_5');
  const net = { ...COST_INPUT, coverage: [], lines: [costLine('a', 'aws/amazons3/storage', [factor(300, 900, '$/mo')]), costLine('r', 'aws/amazons3/storage', [factor(3 * 0.1 * 1000, 3 * 0.1 * 1000, '$/mo')], { direction: 'remove' })] };
  assert.equal(costResultEvent(net, computeCostResult(net)).headline.ratio, 'gt_10');
  assert.equal(eventOf('aws/amazons3/storage', [factor(200000, 200000, 'x/mo'), { constant: 'million', of: 'x' }, factor(5, 5, '$/Mx')]).size, '1_10');
  // A key is read one part at a time: a word of a closed list stays, any other word is `other`.
  const keyOf = (key) => { const { provider, service, dimension } = eventOf(key, [factor(1, 1, '$/mo')]); return [provider, service, dimension]; };
  assert.deepEqual(keyOf('aws/other/api-requests'), ['aws', 'other', 'api-requests']);
  assert.deepEqual(keyOf('openai/model-api/tokens'), ['other', 'model-api', 'tokens']);
  assert.deepEqual(keyOf('aws/amazons3/storage/more'), ['other', 'other', 'other']);
  assert.equal(costResultEvent(one(1, 2), computeCostResult(one(1, 2))).headline, null, 'no estimated line');
  assert.deepEqual(['added-runtime', 'indirect', 'flag-gated'].map((tag) => line(1, 2, { tag, trigger: secret('trigger') }).state), ['estimated', 'estimated', 'outside']);
  const many = { ...COST_INPUT, coverage: [], lines: Array.from({ length: 61 }, (_, i) => costLine(`m${i}`, 'aws/amazons3/storage', [factor(1, 1, '$/mo'), ...Array.from({ length: 30 }, () => factor(1, 1, '1'))])) };
  const big = costResultEvent(many, computeCostResult(many));
  assert.deepEqual([big.line_count, big.lines.length, big.lines[0].factors.length], [61, 60, 20]);
});
