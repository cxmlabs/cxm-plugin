import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

test('the reply splits into text and drawable blocks, and cxm viz prints one block or names its kinds', () => {
  const parts = splitReply('Top cost:\n```chart\n{}\n```\nDone.\n```js\nx\n```');
  assert.deepEqual(parts.map((p) => p.kind ?? 'text'), ['text', 'chart', 'text']);
  const cli = (...args) => spawnSync(process.execPath, ['bin/cxm.js', 'viz', ...args], { encoding: 'utf8', env: { ...process.env, CXM_TELEMETRY: '0' } });
  const ok = cli('chart', 'test/fixtures/spend.json', '--width', '100');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Spend by service/);
  const bad = cli('pie', '{}');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /kinds: chart, cube-chart, row, mermaid/);
});
