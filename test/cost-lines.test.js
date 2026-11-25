import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCostResult } from '../src/lib/cost-lines.js';

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
  const others = ['flag-gated', 'added-runtime', 'llm', 'one-off'];
  const { result, section } = compute([
    dollars('fee', 2, 2, 'B', { tag: 'commitment' }),
    dollars('add', 1, 3),
    dollars('cut', 10, 20, 'B', { direction: 'remove' }),
    ...others.map((tag, i) => (tag === 'one-off' ? line(tag, [point(100, '$')], { tag }) : dollars(tag, 100 + i, 200 + i, 'B', { tag }))),
  ]);
  range(result.headline, -17, -5, 'negative headline');
  range(result.totals.direct, -19, -7, 'direct');
  range(result.totals.commitment, 2, 2, 'commitment');
  others.slice(0, 3).forEach((tag, i) => range(result.totals[tag], 100 + i, 200 + i, tag));
  assert.deepEqual(result.totals['one-off'], { low: 100, high: 100, unit: '$' });
  assert.match(section, /^\*\*-\$17\.00 to -\$5\.00 per month\*\*, grade B\. Estimated lines: 3 of 3 headline lines\. Uncovered targets: 0\.$/m);
  assert.match(section, /^Commitment fee inside the headline: \$2\.00 per month\.$/m);

  const crossing = compute([dollars('add', 1, 3), dollars('cut', 2, 2, 'B', { direction: 'remove' })]);
  range(crossing.result.headline, -1, 1, 'range that crosses 0');
  assert.match(crossing.section, /\*\*-\$1\.00 to \$1\.00 per month\*\*/);
  const none = compute([dollars('a', 5, 5, 'B', { tag: 'llm' })]);
  assert.deepEqual([none.result.headline.low, none.result.headline.high, none.result.headline.grade], [0, 0, null]);
  assert.match(compute([dollars('a', 0.1, 0.1), dollars('b', 0.2, 0.2), dollars('c', 0.3, 0.3, 'B', { direction: 'remove' })]).section, /\*\*\$0\.00 per month\*\*/);
});

test('the headline grade is the lowest grade of the lines that hold 10 percent or more', () => {
  const grade = (...lines) => compute(lines).result.headline.grade;
  assert.equal(grade(dollars('a', 9, 9, 'A'), dollars('d', 0.5, 1, 'D')), 'D', 'a D line at 10 percent by its high');
  assert.equal(grade(dollars('a', 9, 9, 'A'), dollars('d', 0.5, 0.99, 'D')), 'A', 'the same line below 10 percent');
  assert.equal(grade(dollars('a', 0.63, 0.63, 'A'), line('d', [factor(0.1, 0.7, 'x/mo', 'D'), point(0.1, '$/x', 'A')])), 'D', '10 percent with a float residue');
  assert.equal(grade(dollars('a', 9, 9, 'A'), dollars('d', 0.5, 1, 'D', { direction: 'remove' })), 'D', 'the weight of a removal is its larger absolute bound');
  assert.equal(grade(dollars('a', 9, 9, 'A'), dollars('d', 50, 100, 'D', { tag: 'llm' })), 'A', 'a line outside the headline has no weight');
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
  const full = compute(lines, kinds.map((kind) => entry(kind, { what: `what ${kind}`, ...(kind === 'unmeasured' ? { needs: 'the metric m on service s' } : {}) })));
  assert.deepEqual(full.result, { ...bare.result, headline: { ...bare.result.headline, uncovered_targets: 1 } });
  for (const kind of kinds) assert.ok(full.section.includes(`- ${kind}: \`what ${kind}\`. Why: \`no lookup found it\`. Source: tool, \`synthetic\`.`));
  assert.match(full.section, /grade C\. Estimated lines: 2 of 2 headline lines\. Uncovered targets: 1\.$/m);
  const empty = compute([], [entry('not_billed')]);
  assert.match(empty.section, /^No billed line moves\. Uncovered targets: 0\.$/m);
  assert.match(empty.section, /- not_billed: `a target`/);
});

test('the section prints each line and each coverage entry, and prints once the text that they share', () => {
  const lines = ['t-1', 't-2'].flatMap((target, t) => ['i-1', 'i-2'].map((item, i) => dollars(`${target}-${item}`, 1 + t, 5 + i, 'C', { target, item, key: `k-${item}`, at: `src/${item}.js:1@0123abc` })));
  const { section } = compute(
    [...lines, line('once', [point(7, '$')], { tag: 'one-off', item: 'i-3', at: 'src/i-3.js:1@0123abc' })],
    ['w-1', 'w-2'].map((what) => entry('uncovered_target', { what })),
  );
  assert.ok(section.includes(`Lines, at commit \`0123abc\`, in dollars per month (a one-off line: in dollars, once):

- direct, add: \`i-1\`, \`k-i-1\`, at \`src/i-1.js:1\`
  - \`t-1-i-1\` \`t-1\`: $1.00 to $5.00, grade C
    = \`1–5 x/mo [C, dataset] × 1 $/x [A, dataset]\`
  - \`t-2-i-1\` \`t-2\`: $2.00 to $5.00, grade C
    = \`2–5 x/mo [C, dataset] × 1 $/x [A, dataset]\`
- direct, add: \`i-2\`, \`k-i-2\`, at \`src/i-2.js:1\`
  - \`t-1-i-2\` \`t-1\`: $1.00 to $6.00, grade C
    = \`1–6 x/mo [C, dataset] × 1 $/x [A, dataset]\`
  - \`t-2-i-2\` \`t-2\`: $2.00 to $6.00, grade C
    = \`2–6 x/mo [C, dataset] × 1 $/x [A, dataset]\`
- one-off, add: \`i-3\`, \`requests\`, at \`src/i-3.js:1\`. \`once\` \`job-a\`: $7.00, grade B
  = \`7 $ [B, dataset]\`
`), section);
  assert.ok(section.includes('- uncovered_target: `w-1`, `w-2`. Why: `no lookup found it`. Source: tool, `synthetic`.'), section);
  // Two commits: each line keeps its own.
  const two = compute([dollars('a', 1, 1), dollars('b', 1, 1, 'B', { at: 'src/job.js:12@9999999' })]).section;
  for (const text of ['Lines, in dollars per month (', 'at `src/job.js:12@0123abc`. `a`', 'at `src/job.js:12@9999999`. `b`']) assert.ok(two.includes(text), two);
});

test('the section prints each factor of each line under its line, and a unit cannot leave its code span', () => {
  const rate = point(0.05, '$/vCPU*h', 'A');
  const lines = [
    line('time', [factor(30, 45, 'run/mo', 'D'), point(2, 'min/run', 'C'), { constant: 'h_per_min' }, point(4, 'vCPU'), rate]),
    line('keep', [point(60, 'GB/mo'), point(30, 'day'), { ...point(30.4375, 'day/mo', 'A'), divide: true }, point(0.8, '1'), point(0.02, '$/GB*mo')], { item: 'i-2' }),
    line('token', [{ ...point(4, 'row/call'), divide: true }, point(1e-7, 'row/mo'), point(500, 'token/call'), { constant: 'million', of: 'token' }, point(0.4, '$/Mtoken')], { item: 'i-3', direction: 'remove' }),
  ];
  const { section } = compute(lines);
  for (const [id, formula] of [
    ['time', '30–45 run/mo [D, assumption] × 2 min/run [C, dataset] × h_per_min × 4 vCPU [B, dataset] × 0.05 $/vCPU*h [A, dataset]'],
    ['keep', '60 GB/mo [B, dataset] × 30 day [B, dataset] ÷ 30.4375 day/mo [A, dataset] × 0.8 [B, dataset] × 0.02 $/GB*mo [B, dataset]'],
    ['token', '1 ÷ 4 row/call [B, dataset] × 1e-7 row/mo [B, dataset] × 500 token/call [B, dataset] × million of token × 0.4 $/Mtoken [B, dataset]'],
  ]) assert.match(section, new RegExp(`\`${id}\`.*\\n  = \`${formula.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\`\\n`), id);
  assert.ok(!section.includes('synthetic'), 'no ref: it stays in the block');
  for (const unit of ['x`y/mo', 'x\ny/mo', 'x y/mo']) assert.ok(computeCostResult(input([line('a', [point(1, unit), point(1, '$/x')])])).faults, unit);
});

test('the headline holds the indirect lines, and the section prints their share of it', () => {
  // direct 1 to 3, commitment 2, indirect 10 to 20 less 4: the headline is 1 + 2 + 6 = 9 to 3 + 2 + 16 = 21.
  const { result, section } = compute([
    dollars('a', 1, 3, 'A'), dollars('fee', 2, 2, 'A', { tag: 'commitment' }), dollars('i', 10, 20, 'C', { tag: 'indirect' }),
    dollars('j', 4, 4, 'A', { tag: 'indirect', direction: 'remove' }), ...['flag-gated', 'added-runtime', 'llm'].map((tag) => dollars(tag, 50, 60, 'D', { tag })),
  ]);
  range(result.headline, 9, 21, 'headline');
  range(result.totals.indirect, 6, 16, 'indirect');
  assert.equal(result.headline.grade, 'C', 'an indirect line has a weight');
  assert.match(section, /^Indirect cost inside the headline: \$6\.00 to \$16\.00 per month\.$/m);
  assert.doesNotMatch(compute([dollars('a', 1, 3)]).section, /Indirect cost/);
});

const shared = (text, f) => ({ ...f, shared: text });
test('lines that share a factor take the same end of it, and the headline is the range of the sums', () => {
  const volume = () => shared('daily volume', factor(10, 20, 'GB/mo', 'C'));
  // add 10 to 20 GB at $3 to $4, remove the same GB at $2.
  // Volume 10: 30 - 20 = 10 to 40 - 20 = 20. Volume 20: 60 - 40 = 20 to 80 - 40 = 40. The headline is 10 to 40.
  const pair = [line('add', [volume(), factor(3, 4, '$/GB')]), line('cut', [volume(), point(2, '$/GB')], { direction: 'remove' })];
  const { result, section } = compute(pair);
  range(result.headline, 10, 40, 'headline');
  range(result.lines[0], 30, 80, 'the line keeps its own range');
  range(result.lines[1], -40, -20, 'the line keeps its own range');
  // The simple sum: 30 - 40 = -10 to 80 - 20 = 60.
  range(result.totals.direct, -10, 60, 'the total of the tag is the simple sum');
  assert.match(section, /^Each part takes one end of each shared factor, so it can be narrower than the sum of its lines: `daily volume`\.$/m);
  assert.ok(section.includes('10–20 GB/mo [C, dataset, shared: daily volume]'), section);

  // A divided factor: 12 ÷ s plus 3 × s. s = 1: 12 + 3 = 15. s = 2: 6 + 6 = 12. The headline is 12 to 15, and the simple sum is 9 to 18.
  const s = () => shared('rows', factor(1, 2, 'x/y', 'C'));
  const divided = compute([line('a', [point(12, 'x/mo'), { ...s(), divide: true }, point(1, '$/y')]), line('b', [s(), point(3, 'y/mo'), point(1, '$/x')])]).result;
  range(divided.headline, 12, 15, 'divided');
  range(divided.totals.direct, 9, 18, 'divided');

  // Two texts move alone: u in 1 to 2 and v in 10 to 20. (u - v) at $1 is 1 - 20 = -19 to 2 - 10 = -8, as without a share.
  const two = compute([line('u', [shared('u', factor(1, 2, 'x/mo')), point(1, '$/x')]), line('v', [shared('v', factor(10, 20, 'x/mo')), point(1, '$/x')], { direction: 'remove' })]).result;
  range(two.headline, -19, -8, 'two texts');
  // A line outside the headline does not move it.
  range(compute([pair[0], { ...pair[1], tag: 'llm' }]).result.headline, 30, 80, 'one line of the pair');

  const texts = (n) => Array.from({ length: n }, (_, i) => line(`l${i}`, [shared(`t${i}`, factor(1, 2, 'x/mo')), point(1, '$/x')]));
  range(compute(texts(4)).result.headline, 4, 8, 'four texts');
  assert.deepEqual(computeCostResult(input(texts(5))).faults, ['input: 5 shared texts. At most 4']);
  for (const [name, other] of [['low', factor(11, 20, 'GB/mo', 'C')], ['high', factor(10, 21, 'GB/mo', 'C')], ['grade', factor(10, 20, 'GB/mo', 'B')], ['unit', factor(10, 20, 'GB/day', 'C')]]) {
    const tail = name === 'unit' ? [{ constant: 'day_per_mo' }] : [];
    const bad = computeCostResult(input([pair[0], line('b', [shared(' daily  volume', other), ...tail, point(1, '$/GB')])]));
    assert.deepEqual(bad.faults, ['line "b": factor 1: shared "daily volume" needs the same low, high, unit and grade in each line'], name);
  }
  assert.match(computeCostResult(input([line('a', [shared(' ', factor(1, 2, 'x/mo')), point(1, '$/x')])])).faults[0], /factor 1: shared is not a text/);
  assert.match(computeCostResult(input([line('a', [point(1, 'x/mo'), { constant: 'million', of: 'x', shared: 'm' }, point(1, '$/Mx')])])).faults[0], /factor 2: unknown field "shared"/);
});

test('an activity factor takes half of its low and twice its high, and the section says so', () => {
  const active = (f) => ({ ...f, activity: true });
  // 40 runs at $2: 20 x 2 = 40 to 80 x 2 = 160.
  const { result, section } = compute([line('a', [active(point(40, 'run/mo')), point(2, '$/run')])]);
  range(result.lines[0], 40, 160, 'one value');
  range(result.headline, 40, 160, 'headline');
  assert.ok(section.includes('40 run/mo [B, dataset, activity: 20–80] × 2 $/run'), section);
  // 10 to 30 runs at $2: 5 x 2 = 10 to 60 x 2 = 120.
  range(compute([line('a', [active(factor(10, 30, 'run/mo')), point(2, '$/run')], { needs: 'the run count' })]).result.lines[0], 10, 120, 'a range');
  // 800 rows ÷ 10 rows in a request: 800 / 20 = 40 to 800 / 5 = 160.
  range(compute([line('a', [point(800, 'row/mo'), { ...active(point(10, 'row/request')), divide: true }, point(1, '$/request')])]).result.lines[0], 40, 160, 'divided');
  // A shared activity factor of 10 moves in 5 to 20. (3 - 2) x 5 = 5 to (3 - 2) x 20 = 20.
  const both = () => shared('runs', active(point(10, 'run/mo')));
  range(compute([line('a', [both(), point(3, '$/run')]), line('b', [both(), point(2, '$/run')], { direction: 'remove' })]).result.headline, 5, 20, 'shared');
  const fault = (factors) => computeCostResult(input([line('a', factors)])).faults[0];
  assert.match(fault([active(point(1, 'x/mo')), active(point(1, 'y/x')), point(1, '$/y')]), /^line "a": more than one activity factor$/);
  assert.match(fault([point(1, 'x/mo'), active(point(1, '$/x'))]), /factor 2: a \$ factor takes no activity$/);
  assert.match(fault([point(1, 'x/mo'), { constant: 'million', of: 'x', activity: true }, point(1, '$/Mx')]), /factor 2: unknown field "activity"/);
  assert.match(fault([{ ...point(1, 'x/mo'), activity: 'yes' }, point(1, '$/x')]), /factor 1: activity is not true or false$/);
  assert.match(computeCostResult(input([line('a', [both(), point(3, '$/run')]), line('b', [shared('runs', point(10, 'run/mo')), point(2, '$/run')])])).faults[0], /shared "runs" needs the same/, 'the band is part of the value');
});

const open = (id, low, high, needs = 'the metric m on service s', more) => dollars(id, low, high, 'B', { needs, ...more });
test('a group is open by an end of 0, by opposite signs or by its ratio, at $1 or more', () => {
  // Opposite signs need two linked lines: n at a range of rates, less the same n at one rate. One line has one sign.
  const cross = (n, plus, minus) => [
    line('p', [shared('n', factor(...n, 'x/mo')), factor(...plus, '$/x')]),
    line('q', [shared('n', factor(...n, 'x/mo')), point(minus, '$/x')], { direction: 'remove' }),
  ];
  const isOpen = (lines) => {
    const faults = computeCostResult(input(lines)).faults ?? [];
    for (const l of lines) assert.equal(faults.some((f) => f.startsWith(`line "${l.id}": its group is open`)), faults.length > 0, faults.join());
    return faults.length > 0;
  };
  for (const [low, high, want] of [[1, 10, false], [1, 10.01, true], [0.3, 3, false], [0.05, 0.99, false], [0.05, 1, true], [0, 0.99, false], [0, 1, true], [5, 5, false]]) {
    assert.equal(isOpen([dollars('a', low, high)]), want, `${low} to ${high}`);
    assert.equal(isOpen([dollars('a', low, high, 'B', { direction: 'remove' })]), want, `remove ${low} to ${high}`);
  }
  // n = 1: 1 x 1 - 1 x 1.5 = -0.5 to 1 x 2 - 1.5 = 0.5. n = 2: -1 to 1. The group is -1 to 1.
  assert.equal(isOpen(cross([1, 2], [1, 2], 1.5)), true, '-1 to 1');
  // n = 1: 1 - 1.9 = -0.9 to 2 - 1.9 = 0.1. The group is -0.9 to 0.1.
  assert.equal(isOpen(cross([1, 1], [1, 2], 1.9)), false, '-0.9 to 0.1');
  // n = 1: 1 - 1.9 = -0.9 to 101.9 - 1.9 = 100. The ratio of the ends does not matter.
  assert.equal(isOpen(cross([1, 1], [1, 101.9], 1.9)), true, '-0.9 to 100');
});

test('linked lines are one group: a pair that nets narrow is estimated, and one linked line can open the group', () => {
  const v = () => shared('v', factor(1, 20, 'GB/mo'));
  // Alone: 3 to 60 and 2.9 to 58, each with a ratio of 20. Net: 1 x 0.1 = 0.1 to 20 x 0.1 = 2, ratio 20, so this pair is open.
  // With $2.96 the net is 0.04 to 0.8, below $1, so this pair is estimated.
  const pair = (rate) => [line('add', [v(), point(3, '$/GB')]), line('cut', [v(), point(rate, '$/GB')], { direction: 'remove' })];
  assert.equal(computeCostResult(input(pair(2.9))).faults.length, 2);
  const { result } = compute(pair(2.96));
  range(result.headline, 0.04, 0.8, 'pair');
  assert.deepEqual([result.headline.estimated_lines, result.headline.open_lines], [['add', 'cut'], []]);
  // A third line holds v at $0 to $2.5. v = 1: 0.04 to 2.54. v = 20: 0.8 to 50.8. The group is 0.04 to 50.8, so the three lines are open.
  const needs = 'the metric m';
  const third = [
    { ...line('add', [v(), point(3, '$/GB')]), needs }, { ...line('cut', [v(), point(2.96, '$/GB')], { direction: 'remove' }), needs },
    { ...line('far', [v(), factor(0, 2.5, '$/GB')]), needs }, dollars('alone', 4, 5),
  ];
  const opened = compute(third).result;
  range(opened.open, 0.04, 50.8, 'group');
  assert.deepEqual([opened.open.lines, opened.headline.estimated_lines], [['add', 'cut', 'far'], ['alone']]);
  range(opened.headline, 4, 5, 'the other line');
  assert.match(compute(third).section, /- `the metric m`\. Narrows `add`, `cut`, `far`: \$0\.04 to \$50\.80 per month\.$/m, 'the row nets the linked lines');
  // A chain: a and b share s, b and c share t. They are one group, also when the line that joins them comes last.
  const s = (f) => [shared('s', factor(1, 2, 'x/mo')), ...f];
  const t = () => shared('t', factor(1, 2, '1'));
  const chain = [line('a', s([point(1, '$/x')]), { needs }), line('c', [t(), factor(0, 9, '$/mo')], { needs }), line('b', s([t(), point(1, '$/x')]), { needs }), line('d', [t(), point(1, '$/mo')], { needs }), line('e', s([point(1, '$/x')]), { needs })];
  assert.deepEqual(compute(chain).result.open.lines, ['a', 'c', 'b', 'd', 'e']);
  // Outside the headline a line links nothing and is never open.
  assert.deepEqual(compute([...pair(2.96), dollars('l', 0, 900, 'B', { tag: 'llm' })]).result.open, { low: 0, high: 0, unit: '$/mo', lines: [] });
});

test('the headline holds the estimated lines only, and the open part stands beside it with what to expose', () => {
  // Estimated: 4 to 6 (A) and 1 to 2 (B, indirect): 5 to 8. Open: 0 to 50 and 0 to 20, less 0 to 3: -3 to 70. The llm line counts in neither.
  const metric = 'the request count of service s, as a metric in requests per day';
  const { result, section } = compute([
    dollars('a', 4, 6, 'A'), dollars('i', 1, 2, 'B', { tag: 'indirect' }), open('o', 0, 50, metric), open('p', 0, 20, 'the log m', { tag: 'indirect' }),
    open('r', 0, 3, ` ${metric.replace(' ', '  ')}`, { direction: 'remove', tag: 'commitment' }), dollars('l', 0, 900, 'D', { tag: 'llm' }),
  ], [entry('unmeasured', { what: 'w-1', needs: metric }), entry('unmeasured', { what: 'w-2', needs: 'the setting n' }), entry('doubt')]);
  assert.deepEqual(result.headline, {
    low: 5, high: 8, unit: '$/mo', grade: 'B', shares: { A: 0.75, B: 0.25, C: 0, D: 0 }, uncovered_targets: 0, estimated_lines: ['a', 'i'], open_lines: ['o', 'p', 'r'],
  });
  assert.deepEqual(result.open, { low: -3, high: 70, unit: '$/mo', lines: ['o', 'p', 'r'] });
  // The row of the metric: o and r, 0 - 3 to 50 - 0.
  assert.ok(section.startsWith(`### Cost of this change

**$5.00 to $8.00 per month**, grade B. Estimated lines: 2 of 5 headline lines. Uncovered targets: 0.

Indirect cost inside the headline: $1.00 to $2.00 per month.

Share of the weight by grade: A 75.0 %, B 25.0 %.

Not estimated yet: between -$3.00 and $70.00 per month, 3 lines.

To narrow it, expose:

- \`${metric}\`. Narrows \`o\`, \`r\`: -$3.00 to $50.00 per month. Unmeasured: \`w-1\`.
- \`the log m\`. Narrows \`p\`: $0.00 to $20.00 per month.
- \`the setting n\`. Unmeasured: \`w-2\`.

Totals:
`), section);
  for (const sum of ['$2.00 to $78.00', 'Commitment fee']) assert.ok(!section.includes(sum), sum);

  const none = compute([open('o', 0, 50)]);
  assert.deepEqual([none.result.headline.low, none.result.headline.high, none.result.headline.grade, none.result.headline.shares], [0, 0, null, { A: 0, B: 0, C: 0, D: 0 }]);
  assert.ok(none.section.startsWith('### Cost of this change\n\nNo line can be estimated yet. Estimated lines: 0 of 1 headline lines. Uncovered targets: 0.\n\nNot estimated yet: between $0.00 and $50.00 per month, 1 lines.\n'), none.section);
  assert.match(compute([dollars('a', 5, 5, 'B', { tag: 'llm' })]).section, /^\*\*\$0\.00 per month\*\*, grade none\. Estimated lines: 0 of 0 headline lines\./m);
  assert.doesNotMatch(compute([dollars('a', 1, 2)]).section, /Not estimated yet|To narrow it/);
  assert.match(compute([], [entry('unmeasured', { needs: 'the setting n' })]).section, /^No billed line moves\. Uncovered targets: 0\.\n\nTo narrow it, expose:\n\n- `the setting n`\. Unmeasured: `a target`\.\n\nCoverage:/m);
  const hostile = compute([open('o', 0, 50, 'x`\n```\n# y')]).section;
  assert.ok(!hostile.includes('```') && hostile.includes("- `x' ''' # y`. Narrows"), hostile);
});

test('needs stands on each open line and each unmeasured entry, and nowhere else', () => {
  const faults = (lines, coverage) => computeCostResult(input(lines, coverage)).faults ?? [];
  for (const needs of [undefined, '', ' ', 5, null]) {
    const given = needs === undefined ? {} : { needs };
    assert.deepEqual(faults([dollars('o', 0, 50, 'B', given)]).map((f) => f.slice(0, 40)), ['line "o": its group is open, and it stat'], String(needs));
    assert.deepEqual(faults([], [entry('unmeasured', given)]).map((f) => f.slice(0, 40)), ['coverage 1: an unmeasured entry states n'], String(needs));
  }
  for (const needs of ['the metric m', '']) {
    assert.deepEqual(faults([dollars('a', 1, 2, 'B', { needs })]), ['line "a": its group is not open, so it takes no needs']);
    assert.deepEqual(faults([dollars('a', 0, 900, 'B', { needs, tag: 'llm' })]), ['line "a": its group is not open, so it takes no needs']);
    for (const kind of ['uncovered_target', 'not_billed', 'doubt']) assert.deepEqual(faults([], [entry(kind, { needs })]), ['coverage 1: only an unmeasured entry takes needs']);
  }
});

test('a result with an estimated part, an open part, a shared factor and an activity factor computes again to the same result', () => {
  const both = () => shared('runs', { ...point(10, 'run/mo'), activity: true });
  const needs = 'the run count of job-a';
  const given = input([line('a', [both(), factor(0, 3, '$/run')], { needs }), line('b', [both(), point(2, '$/run')], { direction: 'remove', tag: 'indirect', needs }), dollars('c', 1, 2)], [entry('unmeasured', { needs })]);
  const first = computeCostResult(given);
  assert.deepEqual(first.faults, undefined);
  assert.deepEqual([first.result.open.lines, first.result.headline.estimated_lines], [['a', 'b'], ['c']]);
  assert.equal('status' in first.result.headline, false);
  assert.deepEqual(computeCostResult(JSON.parse(JSON.stringify({ ...given, result: first.result }))), first);
});

test('the function imports nothing and the written block computes to the same result', () => {
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
  assert.doesNotMatch(section, /```/, 'a text field opens no fence');
  assert.doesNotMatch(section, /[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u202e]/);
  const file = join(mkdtempSync(join(tmpdir(), 'cxm-cost-lines-')), 'block.json');
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/cxm.js', import.meta.url)), 'cost-result'], {
    input: JSON.stringify(given),
    encoding: 'utf8',
    env: { ...process.env, CXM_CONFIG_DIR: dirname(file), CXM_TELEMETRY: '0', CXM_COST_RESULT_FILE: file },
  });
  assert.equal(run.stdout, section, run.stderr);
  const block = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(block, { ...JSON.parse(JSON.stringify(given)), result });
  assert.deepEqual(computeCostResult(block), { result, section });
});
