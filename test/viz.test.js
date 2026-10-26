import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { draw, plain, splitReply } from '../src/lib/viz.js';

const fixture = (name) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const runs = (lines) => lines.flat();
const runOf = (lines, text) => runs(lines).find(([t]) => t.includes(text));

test('a Dex chart block draws bars with shares and a total, and its table beside it at the same height', () => {
  const text = plain(draw('chart', fixture('spend.json'), { width: 120 }));
  assert.match(text, /RDS █+ \$1,854 +27%/);
  assert.match(text, /total \$6,872/);
  assert.match(text, /Total +\$6,872/);
  const rows = text.split('\n');
  assert.equal(new Set(rows.map((r) => [...r].length)).size, 1, 'the chart and the table frames end level');
  assert.equal(rows.filter((r) => r.includes('Values')).length, 1);
});

test('a diverging chart puts rises right in red and falls left in green, with the net', () => {
  const spec = { type: 'bar', diverging: true, yFormat: 'currency', x: 's', y: 'd', data: [{ s: 'RDS', d: 300 }, { s: 'NAT', d: -600 }] };
  const lines = draw('chart', JSON.stringify(spec));
  const text = plain(lines);
  assert.match(text, /RDS +│█.* \+\$300/);
  assert.match(text, /NAT .*█│ +-\$600/);
  assert.match(text, /net -\$300/);
  const rise = runOf(lines, '+$300')[1];
  const fall = runOf(lines, '-$600')[1];
  assert.ok(parseInt(rise.slice(1, 3), 16) > parseInt(rise.slice(3, 5), 16), 'a rise is red');
  assert.ok(parseInt(fall.slice(3, 5), 16) > parseInt(fall.slice(1, 3), 16), 'a fall is green');
});

test('a diagram tints each node by its family and fits the width: left to right, then top to bottom, then an edge list', () => {
  const wide = draw('mermaid', fixture('aws.mmd'), { width: 160 });
  assert.match(plain(wide), /Users ├──►│ CloudFront/);
  assert.notEqual(runOf(wide, 'Aurora PostgreSQL')[2], '', 'a database node has a fill');
  assert.notEqual(runOf(wide, 'Aurora PostgreSQL')[2], runOf(wide, 'ECS API service')[2], 'two families, two fills');
  assert.match(plain(draw('mermaid', fixture('aws.mmd'), { width: 80 })), /Users[\s│]+└─+┬─+┘/);
  assert.match(plain(draw('mermaid', fixture('aws.mmd'), { width: 40 })), /^│ Users → CloudFront/m);
});

test("a Dex cloud diagram's icon nodes become labelled boxes colored by the icon, and edge labels keep their spaces", () => {
  const lines = draw('mermaid', fixture('dex-cloud.mmd'), { width: 120 });
  assert.match(plain(lines), /Public ALB .*https.*Orders API .*sql queries.*Orders DB/);
  assert.equal(runs(lines).find(([t]) => /^┌─+┐$/.test(t) && t.length === 13)?.[1], '#5B8DEF', 'the database box is blue');
});

const chart = (spec) => JSON.stringify({ x: 'k', y: 'v', ...spec });
const rows = [{ k: 'RDS', v: 30 }, { k: 'ECS', v: 10 }];

test('pie, column and line charts draw their shape and their figures', () => {
  assert.match(plain(draw('chart', chart({ type: 'pie', data: rows }))), /RDS █{30,}.* 30 +75%/);
  const pie = draw('chart', chart({ type: 'pie', series: 's', data: [{ k: 'a', s: 'p', v: 1 }, { k: 'b', s: 'p', v: 1 }, { k: 'a', s: 'q', v: 3 }, { k: 'b', s: 'q', v: 6 }] }));
  const [p, q] = pie.slice(1, 3).map((l) => l.find(([t]) => t.includes('█'))[0].trim().length);
  assert.ok(q < p, 'each series of a pie scales to its own total: 3 of 9 is shorter than 1 of 2');
  const column = plain(draw('chart', chart({ type: 'column', data: rows })));
  assert.match(column, /30 +10 [\s\S]*^│ ███ {6}│$[\s\S]*RDS ECS/m);
  assert.match(column, /total 40/);
  const line = plain(draw('chart', chart({ type: 'line', xFormat: 'month', data: [{ k: '2026-01-01', v: 5 }, { k: '2026-02-01', v: 9 }] })));
  assert.match(line, /max 9[\s\S]*min 5[\s\S]*now 9 · total 14[\s\S]*Jan 2026 → Feb 2026/);
});

test('a query that hit its limit labels its total as the top rows only', () => {
  const text = plain(draw('chart', chart({ table: true, query: { limit: 2 }, data: rows })));
  assert.match(text, /total of top 2 40/);
  assert.match(text, /Total of top 2 +40/);
  assert.match(plain(draw('chart', chart({ query: { limit: 5 }, data: rows }))), /^│ +total 40/m);
});

test('signed rows show no share, and a negative column stands as tall as its size', () => {
  const bar = plain(draw('chart', chart({ data: [{ k: 'a', v: -5 }, { k: 'b', v: 10 }] })));
  assert.doesNotMatch(bar, /%/);
  const pie = plain(draw('chart', chart({ type: 'pie', data: [{ k: 'a', v: -5 }, { k: 'b', v: 10 }] })));
  assert.ok(pie.split('\n').every((l) => [...l].length <= 100), 'a signed pie bar stays inside the width');
  const column = plain(draw('chart', chart({ type: 'column', data: [{ k: 'a', v: -5 }, { k: 'b', v: -10 }] })));
  assert.match(column, /^│ +███ +│$/m, 'the bigger fall is the only full-height column');
});

test('a row draws its blocks side by side, and stacks them when they do not fit', () => {
  const items = [{ type: 'bar', ...JSON.parse(chart({ data: rows })) }, { type: 'table', columns: ['Service', 'Cost'], rows: [['RDS', 30], ['ECS', 10]], total: false }];
  const wide = plain(draw('row', JSON.stringify(items), { width: 160 }));
  assert.equal(wide.split('\n')[0].match(/╭/g).length, 2);
  assert.doesNotMatch(wide, /Total/);
  assert.equal(plain(draw('row', JSON.stringify(items), { width: 40 })).split('\n')[0].match(/╭/g).length, 1);
});

test('a chart refuses no rows, a value that is not a number, and an unknown type, and drops control characters', () => {
  assert.throws(() => draw('chart', chart({ data: [] })), /at least one "data" row/);
  assert.throws(() => draw('chart', chart({ data: [{ k: 'a', v: 'n/a' }] })), /needs a number in "v" \(row 1\)/);
  assert.throws(() => draw('chart', chart({ type: 'scatter', data: rows })), /Unknown chart type "scatter"/);
  const text = plain(draw('chart', chart({ title: 'x\u001b]0;owned\u0007', data: [{ k: 'a\u001b[2J', v: 1 }] })));
  assert.doesNotMatch(text, /[\u0000-\u0009\u000b-\u001f]/);
  assert.doesNotMatch(plain(draw('mermaid', 'flowchart LR\n  A[a\u001b[2J] --> B')), /\u001b/);
});

test('a diagram takes a classDef color in short hex, and its edge list keeps every edge of a chain', () => {
  const lines = draw('mermaid', 'flowchart LR\n  A[Users] --> B[Orders]\n  classDef hot fill:#f00\n  class B hot');
  assert.ok(runs(lines).some(([, fg]) => fg === '#ff0000'), 'the class color wins over the family color');
  const list = plain(draw('mermaid', 'flowchart LR\n  A[Users of the shop] --> B[Orders API of the shop] --> C[(Orders database of the shop)]', { width: 20 }));
  assert.match(list, /Users of the shop → Orders API of the shop/);
  assert.match(list, /Orders API of the shop → Orders database of the shop/);
});

test('a label inside a longer label colors only its own box', () => {
  const lines = draw('mermaid', 'flowchart LR\n  G[API Gateway] --> A[API]', { width: 120 });
  assert.notEqual(runOf(lines, 'API Gateway')[2], runs(lines).find(([t]) => t === 'API')[2]);
});

test('the reply splits into text and the blocks it draws', () => {
  const parts = splitReply('Top cost:\n```chart\n{}\n```\nDone.\n```js\nx\n```\n```row\n[]\n```\n```cube-chart\n{}\n```');
  assert.deepEqual(parts.map((p) => p.kind ?? 'text'), ['text', 'chart', 'text', 'row', 'text', 'cube-chart']);
});

const cli = (args, input) => spawnSync(process.execPath, ['bin/cxm.js', 'viz', ...args], { encoding: 'utf8', input, env: { ...process.env, CXM_TELEMETRY: '0' } });

test('cxm viz reads a file, stdin or an inline body after its flags, and --color paints it', () => {
  const file = cli(['chart', '--width', '100', 'test/fixtures/spend.json']);
  assert.equal(file.status, 0, file.stderr);
  assert.match(file.stdout, /RDS █+ \$1,854/);
  const piped = cli(['chart', '-', '--color'], chart({ data: rows }));
  assert.equal(piped.status, 0, piped.stderr);
  assert.match(piped.stdout, /\x1b\[38;2;91;141;239m█+\x1b\[0m/);
});

test('cxm viz names its kinds and refuses a bad width or a missing file', () => {
  assert.match(cli(['pie', '{}']).stderr, /kinds: chart, cube-chart, row, mermaid/);
  assert.match(cli(['chart', '{}', '--width', '19']).stderr, /--width needs a number/);
  assert.match(cli(['row', '[]']).stderr, /A row needs a non-empty array/);
  const missing = cli(['chart', 'nope.json']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No such file: nope\.json/);
});

test('a chart refuses a repeated key and never echoes a row in its error', () => {
  assert.throws(() => draw('chart', chart({ data: [{ s: 'RDS', c: 100 }, { s: 'RDS', c: 50 }, { s: 'ECS', c: 10 }] , x: 's', y: 'c' })), /two rows for "RDS"/);
  assert.throws(() => draw('chart', chart({ x: 'k', y: 'v', data: [{ k: 'a', v: 'private-label' }] })), (err) => /row 1/.test(err.message) && !/private-label/.test(err.message));
});

test('cxm viz cube-chart runs its query only when the block has no rows', () => {
  const env = { ...process.env, CXM_TELEMETRY: '0', CXM_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'cxm-viz-')) };
  const run = (body) => spawnSync(process.execPath, ['bin/cxm.js', 'viz', 'cube-chart', '-'], { encoding: 'utf8', input: body, env });
  const query = run('{"x":"a","y":"b","query":{"measures":["m"]}}');
  assert.equal(query.status, 1);
  assert.match(query.stderr, /Not logged in/);
  const given = run('{"x":"a","y":"b","query":{"measures":["m"]},"data":[{"a":"p","b":1}]}');
  assert.equal(given.status, 0, given.stderr);
  assert.match(given.stdout, /p █/);
});
