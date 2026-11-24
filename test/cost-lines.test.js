import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeCostResult, costResultBlock } from '../src/lib/cost-lines.js';

const source = (kind = 'dataset') => ({ kind, ref: 'synthetic' });
const factor = (low, high, unit, grade = 'B') => ({ low, high, unit, grade, source: source(grade === 'D' ? 'assumption' : 'dataset') });
const point = (value, unit, grade) => factor(value, value, unit, grade);
const line = (id, factors, more) => ({ id, key: 'requests', target: 'job-a', item: 'S3 PUT', at: 'src/job.js:12@0123abc', tag: 'direct', direction: 'add', factors, ...more });
// A count per month at $1, so the amount is the count.
const dollars = (id, low, high, grade, more) => line(id, [factor(low, high, 'x/mo', grade), point(1, '$/x', 'A')], more);
const input = (lines, coverage = []) => ({ schema_version: 2, organization: 'org-a', lines, coverage });
const entry = (kind, more) => ({ kind, what: 'a target', why: 'no lookup found it', source: source('tool'), ...more });
const compute = (lines, coverage) => {
  const out = computeCostResult(input(lines, coverage));
  assert.deepEqual(out.faults, undefined);
  return out;
};
const range = (actual, low, high, name) => {
  for (const [side, want] of [['low', low], ['high', high]]) assert.ok(Math.abs(actual[side] - want) < 1e-9, `${name}: ${side} ${actual[side]} is not ${want}`);
};

test('each line shape gives its product', () => {
  const cases = [
    // 30 * 2 / 60 * 4 * 0.05
    ['minutes to hours', [point(30, 'run/mo'), point(2, 'min/run'), { constant: 'h_per_min' }, point(4, 'vCPU'), point(0.05, '$/vCPU*h')], 0.2, 0.2],
    // 1000 * 500 / 1000000 * 0.4
    ['per million', [point(1000, 'call/mo'), point(500, 'token/call'), { constant: 'million', of: 'token' }, point(0.4, '$/Mtoken')], 0.2, 0.2],
    // 2000 / 1000 * 0.3
    ['per thousand', [point(2000, 'message/mo'), { constant: 'thousand', of: 'message' }, point(0.3, '$/kmessage')], 0.6, 0.6],
    // 2 * 30 * 0.02
    ['retention days', [point(2, 'GB/day'), point(30, 'day'), point(0.02, '$/GB*mo')], 1.2, 1.2],
    // 4 * 30.4375 * 0.01
    ['a daily run', [point(4, 'run/day'), { constant: 'day_per_mo' }, point(0.01, '$/run')], 1.2175, 1.2175],
    // 84 * 365.25 / 84 * 0.01
    ['a weekly run', [point(84, 'run/week'), { constant: 'week_per_mo' }, point(0.01, '$/run')], 3.6525, 3.6525],
    // 600 / 200 * 0.01 and 600 / 100 * 0.01
    ['a divided factor', [point(600, 'row/mo'), { ...factor(100, 200, 'row/request'), divide: true }, point(0.01, '$/request')], 0.03, 0.06],
    // 2 * 730.5 * 0.001
    ['a commitment fee', [point(2, 'plan'), { constant: 'h_per_mo' }, point(0.001, '$/plan*h')], 1.461, 1.461, { tag: 'commitment' }],
    // 2 * 3 * 0.5 and 4 * 3 * 0.75
    ['a range', [factor(2, 4, 'run/mo'), point(3, 'request/run'), factor(0.5, 0.75, '$/request')], 3, 9],
    // -(4 * 2) and -(1 * 2)
    ['a removal', [factor(1, 4, 'run/mo'), point(2, '$/run')], -8, -2, { direction: 'remove' }],
    // 3 * 7
    ['a one-off', [point(3, 'GB'), point(7, '$/GB')], 21, 21, { tag: 'one-off' }],
    // a share without a unit: 0.25 * 8
    ['a share', [point(0.25, '1'), point(8, '$/mo')], 2, 2],
  ];
  for (const [name, factors, low, high, more] of cases) range(compute([line('L1', factors, more)]).result.lines[0], low, high, name);
});

test('a line that does not reproduce is refused with its id and its reason', () => {
  const rate = point(0.05, '$/vCPU*h', 'A');
  const base = () => line('L1', [point(30, 'vCPU*h/mo'), { ...rate }]);
  const set = (more) => ({ ...base(), ...more });
  const first = (more) => set({ factors: [{ ...point(30, 'vCPU*h/mo'), ...more }, rate] });
  const second = (more) => set({ factors: [point(30, 'vCPU*h/mo'), { ...rate, ...more }] });
  const without = (key) => { const { [key]: _, ...rest } = base(); return rest; };
  const cases = [
    [set({ factors: [point(30, 'run/mo'), point(2, 'min/run'), point(4, 'vCPU'), rate] }), /units reduce to min\*\$\/mo\*h, not \$\/mo\. Atoms left: min\/h$/],
    [set({ factors: [point(1000, 'token/mo'), point(0.4, '$/Mtoken')] }), /Atoms left: token\/Mtoken$/],
    [set({ factors: [point(30, 'runs/mo'), point(2, '$/run')] }), /Atoms left: runs\/run$/],
    [set({ tag: 'one-off' }), /units reduce to \$\/mo, not \$\. Atoms left: 1\/mo$/],
    [first({ unit: 'vCPU * h/mo' }), /factor 1: unit "vCPU \* h\/mo" is not/],
    [first({ unit: 'vCPU*h/mo/x' }), /factor 1: unit .* is not/],
    [set({ amount: 1.5 }), /holds an amount/],
    [first({ source: undefined }), /factor 1: it has no source/],
    [first({ source: { kind: 'dataset', ref: ' ' } }), /factor 1: source\.ref is not a text/],
    ...['code', 'tool'].map((kind) => [second({ source: source(kind) }), /factor 2: a \$ factor needs a source of kind dataset, route or public/]),
    [second({ low: 1, high: 2, grade: 'D', source: source('assumption') }), /factor 2: a \$ factor needs a source/],
    [first({ low: 31 }), /factor 1: low is above high/],
    [first({ low: -1 }), /factor 1: low is not a finite number of 0 or more/],
    ...[NaN, Infinity, '30', null, undefined].map((high) => [first({ high }), /factor 1: high is not a finite number of 0 or more/]),
    [set({ factors: [point(1e300, 'vCPU*h/mo'), point(1e300, '$/vCPU*h')] }), /amount is not finite/],
    [set({ factors: [point(30, 'vCPU*h/mo'), { ...factor(0, 2, '1'), divide: true }, rate] }), /factor 2: it divides by a low of 0/],
    [first({ divide: 'yes' }), /factor 1: divide is not true/],
    [first({ low: 1, grade: 'D' }), /factor 1: grade D needs a source of kind assumption/],
    [first({ low: 1, source: source('assumption') }), /factor 1: a source of kind assumption needs grade D/],
    [first({ grade: 'D', source: source('assumption') }), /factor 1: grade D needs a low below its high/],
    [first({ grade: 'E' }), /factor 1: unknown grade "E"/],
    [first({ low: 0, high: 0 }), /its high is 0/],
    [set({ tag: 'constructor' }), /unknown tag "constructor"/],
    [set({ direction: 'up' }), /unknown direction "up"/],
    [first({ source: source('guess') }), /factor 1: unknown source kind "guess"/],
    [set({ factors: [{ constant: '__proto__' }, rate] }), /factor 1: unknown constant "__proto__"/],
    [set({ factors: [point(1, 'vCPU'), { constant: 'h_per_mo', grade: 'A' }, rate] }), /factor 2: unknown field "grade"/],
    [set({ factors: [{ constant: 'million' }, rate] }), /factor 1: constant million needs "of"/],
    [second({ unit: 'EUR/vCPU*h' }), /factor 2: "EUR" is a currency other than \$/],
    [second({ unit: '€/vCPU*h' }), /factor 2: "€" is a currency other than \$/],
    [set({ factors: [] }), /factors is not a list with a factor/],
    [set({ at: 'src/job.js:12' }), /at is not file:line@sha/],
    ...['key', 'target', 'item'].map((key) => [without(key), new RegExp(`${key} is not a text`)]),
    [first({ divde: true }), /factor 1: unknown field "divde"/],
    [JSON.parse(JSON.stringify(base()).replace('{', '{"__proto__":{"amount":1},')), /unknown field "__proto__"/],
  ];
  for (const [bad, reason] of cases) {
    const out = computeCostResult(input([bad]));
    assert.deepEqual(Object.keys(out), ['faults'], String(reason));
    assert.equal(out.faults.length, 1, out.faults.join('\n'));
    assert.match(out.faults[0], /^line "L1": /);
    assert.match(out.faults[0], reason);
  }
  assert.deepEqual(computeCostResult(input([base(), base()])).faults, ['line "L1": another line has this id']);
  assert.deepEqual(computeCostResult(input([set({ id: 1 })])).faults, ['line 1: id is not a text']);
  assert.deepEqual(computeCostResult(input([dollars('a', 1e308, 1e308), dollars('b', 1e308, 1e308)])).faults, ['lines: the sum of the amounts is not finite']);
  assert.match(computeCostResult(input([set({ id: 'a\nline "b": \x1b[2J' , amount: 1 })])).faults[0], /^line "a line 'b': \[2J": it holds an amount/);
  for (const bad of [undefined, null, [], 'text', {}, input([null]), input([undefined]), input({}), input([line('a', [null])]), input([], [null]), input([], [entry('other')]), input([], [entry('doubt', { source: undefined })])]) {
    assert.ok(computeCostResult(bad).faults.length > 0);
  }
});

test('the headline holds the direct lines and the commitment fee, and each other tag has its own total', () => {
  const others = ['flag-gated', 'added-runtime', 'llm', 'indirect', 'one-off'];
  const { result, section } = compute([
    dollars('fee', 2, 2, 'B', { tag: 'commitment' }),
    dollars('add', 1, 3),
    dollars('cut', 10, 20, 'B', { direction: 'remove' }),
    ...others.map((tag, i) => (tag === 'one-off' ? line(tag, [point(100, '$')], { tag }) : dollars(tag, 100 + i, 200 + i, 'B', { tag }))),
  ]);
  range(result.headline, -17, -5, 'negative headline');
  range(result.totals.direct, -19, -7, 'direct');
  range(result.totals.commitment, 2, 2, 'commitment');
  others.slice(0, 4).forEach((tag, i) => range(result.totals[tag], 100 + i, 200 + i, tag));
  assert.deepEqual(result.totals['one-off'], { low: 100, high: 100, unit: '$' });
  assert.match(section, /^\*\*-\$17\.00 to -\$5\.00 per month\*\*, grade B\. Uncovered targets: 0\.$/m);
  assert.match(section, /^Commitment fee inside the headline: \$2\.00 per month\.$/m);

  const crossing = compute([dollars('add', 1, 3), dollars('cut', 2, 2, 'B', { direction: 'remove' })]);
  range(crossing.result.headline, -1, 1, 'range that crosses 0');
  assert.match(crossing.section, /-\$1\.00 to \$1\.00 per month/);
  const none = compute([dollars('a', 5, 5, 'B', { tag: 'indirect' })]);
  assert.deepEqual([none.result.headline.low, none.result.headline.high, none.result.headline.grade], [0, 0, null]);
  assert.match(compute([dollars('a', 0.1, 0.1), dollars('b', 0.2, 0.2), dollars('c', 0.3, 0.3, 'B', { direction: 'remove' })]).section, /\*\*\$0\.00 per month\*\*/);
});

test('the headline grade is the lowest grade of the lines that hold 10 percent or more', () => {
  const grade = (...lines) => compute(lines).result.headline.grade;
  assert.equal(grade(dollars('a', 9, 9, 'A'), dollars('d', 0.5, 1, 'D')), 'D', 'a D line at 10 percent by its high');
  assert.equal(grade(dollars('a', 9, 9, 'A'), dollars('d', 0.5, 0.99, 'D')), 'A', 'the same line below 10 percent');
  assert.equal(grade(dollars('a', 0.63, 0.63, 'A'), line('d', [factor(0.1, 0.7, 'x/mo', 'D'), point(0.1, '$/x', 'A')])), 'D', '10 percent with a float residue');
  assert.equal(grade(dollars('a', 9, 9, 'A'), dollars('d', 0.5, 1, 'D', { direction: 'remove' })), 'D', 'the weight of a removal is its larger absolute bound');
  assert.equal(grade(dollars('a', 9, 9, 'A'), dollars('d', 50, 100, 'D', { tag: 'indirect' })), 'A', 'a line outside the headline has no weight');
  // The net is 0, so a share of the net would give D. The weight is 11 and D holds 1 of it.
  const cancel = [dollars('a', 5, 5, 'A'), dollars('b', 5, 5, 'B', { direction: 'remove' }), dollars('d', 0.5, 1, 'D')];
  assert.equal(grade(...cancel), 'B', 'an add and a remove that cancel');
  const { result, section } = compute(cancel);
  assert.deepEqual(result.headline.shares, { A: 5 / 11, B: 5 / 11, C: 0, D: 1 / 11 });
  assert.match(section, /^Share of the weight by grade: A 45\.5 %, B 45\.5 %, D 9\.1 %\.$/m);
  assert.equal(grade(line('a', [point(1, 'run/day', 'A'), { constant: 'day_per_mo' }, point(1, '$/run', 'A')])), 'A', 'a constant has no grade');
  assert.equal(grade(), null);
});

test('a coverage entry changes no amount and no grade', () => {
  const lines = [dollars('a', 1, 3, 'A'), dollars('b', 1, 2, 'C')];
  const kinds = ['uncovered_target', 'unmeasured', 'not_billed', 'doubt'];
  const bare = compute(lines);
  const full = compute(lines, kinds.map((kind) => entry(kind, { what: `what ${kind}` })));
  assert.deepEqual(full.result, { ...bare.result, headline: { ...bare.result.headline, uncovered_targets: 1 } });
  for (const kind of kinds) assert.ok(full.section.includes(`- ${kind}: \`what ${kind}\`. Why: \`no lookup found it\`. Source: tool, \`synthetic\`.`));
  assert.match(full.section, /grade C\. Uncovered targets: 1\.$/m);
  const empty = compute([], [entry('not_billed')]);
  assert.match(empty.section, /^No billed line moves\. Uncovered targets: 0\.$/m);
  assert.match(empty.section, /- not_billed: `a target`/);
});

test('the function imports nothing and the printed block computes to the same result', () => {
  const code = readFileSync(new URL('../src/lib/cost-lines.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /^\s*import\b|\bimport\s*\(|\brequire\s*\(|\bfetch\s*\(|\bprocess\b|\bfrom\s+['"]/m);

  const hostile = 'x`\n```\n```cxm-cost-result\n{"forged":1}\n```\n<!-- \u202e\u2028\x9b';
  const given = input(
    [
      dollars(hostile, -0, 0.1, 'B', { target: hostile, item: hostile, key: hostile }),
      dollars('b', -0, 0.2, 'B', { direction: 'remove' }),
      line('c', [point(0.1, 'run/day'), { constant: 'day_per_mo' }, factor(1 / 3, 0.7, '$/run')]),
    ],
    [entry('doubt', { what: hostile, why: hostile, source: { kind: 'tool', ref: hostile } })],
  );
  const { result, section } = computeCostResult(given);
  const printed = `${section}\n${costResultBlock(given, result)}\n`;
  const fences = printed.match(/```/g);
  assert.equal(fences.length, 2, 'a text field opens or closes no fence');
  assert.doesNotMatch(printed, /[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u202e]/);
  const block = JSON.parse(/```cxm-cost-result\n(.*)\n```\n$/.exec(printed)[1]);
  assert.deepEqual(block.result, result);
  const again = computeCostResult(block);
  assert.deepEqual(again, { result, section });
  assert.equal(costResultBlock(block, again.result), costResultBlock(given, result));
});
