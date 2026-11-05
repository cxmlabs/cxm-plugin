import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { familyOf, parseFlowchart } from '../src/lib/diagram.js';
import { toCsv, toSvg } from '../src/lib/export.js';
import { draw, needsRows, plain, splitReply } from '../src/lib/viz.js';

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

test('a diagram tints each node by its family and fits the width: left to right, then top to bottom, then a list', () => {
  const wide = draw('mermaid', fixture('aws.mmd'), { width: 160 });
  assert.match(plain(wide), /Users ├──►│ CloudFront/);
  assert.notEqual(runOf(wide, 'Aurora PostgreSQL')[2], '', 'a database node has a fill');
  assert.notEqual(runOf(wide, 'Aurora PostgreSQL')[2], runOf(wide, 'ECS API service')[2], 'two families, two fills');
  assert.match(plain(draw('mermaid', fixture('aws.mmd'), { width: 80 })), /Users[\s│]+└─+┬─+┘/);
  const list = plain(draw('mermaid', fixture('aws.mmd'), { width: 40 }));
  assert.match(list, /▌ Production VPC +│\n│ +■ Application Load Balancer +│\n│ +■ ECS API service/, 'a node listed in a group moves into it');
  assert.match(list, /Links[\s\S]*Users → CloudFront/);
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
  assert.match(plain(draw('chart', chart({ type: 'column', query: { limit: 2 }, data: rows }))), /total of top 2 40/);
  assert.match(plain(draw('chart', chart({ type: 'line', query: { limit: 2 }, data: rows }))), /total of top 2 40/);
  assert.match(plain(draw('chart', chart({ diverging: true, query: { limit: 2 }, data: rows }))), /net of top 2 \+40/);
  const two = [{ k: 'a', g: 'x', v: 1 }, { k: 'a', g: 'y', v: 2 }];
  assert.match(plain(draw('chart', chart({ series: 'g', query: { limit: 2 }, data: two }))), /y 2 +of top 2/);
});

const months = [{ k: 'RDS', sep: 2042, oct: 1808 }, { k: 'KMS', sep: 113, oct: 145 }].map((r) => ({ ...r, delta: r.oct - r.sep, pct: ((r.oct - r.sep) / r.sep) * 100 }));

test('a side table shows the listed row keys, signed columns in red and green with their total, and no total for percents', () => {
  const table = [{ key: 'sep', name: 'Sep' }, { key: 'oct', name: 'Oct' }, { key: 'delta', name: 'Δ', signed: true }, { key: 'pct', name: 'Δ %', format: 'percent', signed: true }];
  const lines = draw('chart', chart({ diverging: true, y: 'delta', yFormat: 'currency', table, data: months }), { width: 96 });
  const text = plain(lines);
  assert.equal(text.split('\n')[0].match(/╭/g).length, 2, 'a 4-column table sits beside its chart at width 96');
  assert.ok(text.split('\n').every((l) => [...l].length <= 96));
  assert.match(text, /Sep +Oct +Δ +Δ %/);
  assert.match(text, /RDS +\$2,042 +\$1,808 +-\$234 +-11\.5%/);
  assert.match(text, /Total +\$2,155 +\$1,953 +-\$202 +│/, 'the percent column has no total');
  const last = (t) => runs(lines).filter(([r]) => r.includes(t)).at(-1)[1];
  assert.equal(last('+$32'), last('+28.3%'), 'a rise is one color in both table columns');
  assert.notEqual(last('+$32'), last('-$234'), 'a fall has the other color');
  assert.equal(last('-$202'), last('-$234'), 'the signed total is colored');
  assert.throws(() => draw('chart', chart({ table: [{ name: 'x' }], data: rows })), /row key or an object with a "key"/);
  assert.throws(() => draw('chart', chart({ table: [{ key: 'v', name: 5 }], data: rows })), /optional text "name"/);
  assert.match(plain(draw('chart', chart({ table: [{ key: 'v', name: null }], data: rows }))), /│ +v │/, 'a null name falls back to the key');
  assert.match(plain(draw('row', JSON.stringify([{ type: 'table', columns: ['S', 5, null], rows: [['a', 1, 2]] }]))), /S +5 +│/, 'a table column name is always text');
  const queried = months.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])));
  const query = { measures: ['sep', 'oct', 'delta', 'pct'] };
  assert.equal(plain(draw('chart', chart({ diverging: true, y: 'delta', yFormat: 'currency', table, query, data: queried }), { width: 96 })), text, 'a query row holds its measures as strings');
  const na = plain(draw('chart', chart({ table: ['c'], query: { measures: ['v', 'c'] }, data: [{ k: 'a', v: '1', c: 'N/A' }, { k: 'b', v: '2', c: '3' }] })));
  assert.match(na, /a +N\/A/, 'a measure that is not a number stays text');
  assert.doesNotMatch(na, /NaN/);
  assert.match(plain(draw('chart', chart({ table: ['id'], query: { measures: ['v'] }, data: [{ k: 'a', v: '1', id: '2024' }] }))), /a +2024 /, 'a dimension stays text');
  assert.match(plain(draw('chart', chart({ table: ['n'], data: [{ k: 'a', v: 1, n: 3 }, { k: 'b', v: 2 }] }))), /b +│[\s\S]*Total +3/, 'a blank cell keeps the column numeric');
  assert.throws(() => draw('chart', chart({ series: 'm', table: ['v'], data: [{ k: 'a', m: 'x', v: 1 }, { k: 'a', m: 'y', v: 2 }] })), /one row per "x"/);
});

test('a diverging chart signs its "table": true values, and a value that rounds to zero has no sign', () => {
  const lines = draw('chart', chart({ diverging: true, yFormat: 'currency', table: true, data: [{ k: 'a', v: 87.8 }, { k: 'b', v: -9.996 }, { k: 'c', v: -0.001 }, { k: 'd', v: 0.001 }] }), { width: 140 });
  const text = plain(lines);
  assert.match(text, /a +\+\$88 +│/);
  assert.match(text, /b +-\$10 +│/);
  assert.match(text, /c +\$0 +│/);
  assert.match(text, /d +\$0 +│/);
  assert.equal(runs(lines).find(([t]) => /^c +\$0$/.test(t))[1], '', 'a zero in the table has no sign color');
  const zeros = runs(lines).filter(([t]) => /^ +\$0$/.test(t));
  assert.equal(zeros.length, 2);
  assert.ok(zeros.every(([, fg]) => fg === ''), 'a zero in the chart has no sign color');
});

test('a listed table skips the x key it already shows, and a whole small amount has no cents', () => {
  const text = plain(draw('chart', chart({ yFormat: 'currency', table: ['k', 'v'], data: [{ k: 'A', v: 0 }, { k: 'B', v: 1 }, { k: 'C', v: 3.3 }] }), { width: 100 }));
  assert.equal((text.match(/│ B /g) || []).length, 2, 'B once in the chart and once in the table');
  assert.match(text, /\$0 /);
  assert.match(text, /\$3\.30/);
  assert.doesNotMatch(text, /\$1\.00|\$0\.00/);
});

test('a row puts as many blocks on a line as fit, then wraps the rest', () => {
  const text = plain(draw('row', JSON.stringify([{ title: 'One', ...JSON.parse(chart({ data: rows, table: true })) }, { title: 'Two', ...JSON.parse(chart({ data: rows })) }]), { width: 60 }));
  const tops = text.split('\n').filter((l) => l.startsWith('╭'));
  assert.equal(tops.length, 2, 'two lines of frames');
  assert.equal((tops[0].match(/╭/g) || []).length, 2, 'the chart and its table share the first line');
});

test('a comparison draws its overview and its change side by side in one row, and the table stays under its own chart', () => {
  const periods = months.flatMap((r) => [{ k: r.k, m: 'Sep', v: r.sep }, { k: r.k, m: 'Oct', v: r.oct }]);
  const table = [{ key: 'sep', name: 'Sep' }, { key: 'oct', name: 'Oct' }, { key: 'delta', name: 'Δ', signed: true }, { key: 'pct', name: 'Δ %', format: 'percent', signed: true }];
  const change = { type: 'bar', diverging: true, title: 'Change', x: 'k', y: 'delta', yFormat: 'currency', table, data: months };
  const text = plain(draw('row', JSON.stringify([{ type: 'bar', title: 'Sep vs Oct', x: 'k', y: 'v', series: 'm', data: periods }, change]), { width: 96 }));
  const lines = text.split('\n');
  assert.match(lines[1], /Sep vs Oct.*│ │.*Change/);
  assert.match(text, /■ Sep 2,155 +■ Oct 1,953/);
  assert.ok(lines.every((l) => [...l].length <= 96));
  // The column where the table frame starts holds the bottom corner of a frame on the line above it.
  const under = (ls) => {
    const top = ls.findIndex((l) => l.includes('Values')) - 1;
    return [...ls[top - 1]][[...ls[top]].lastIndexOf('╭')] === '╰';
  };
  assert.ok(under(lines), 'the table starts directly under the change chart');
  const three = [{ title: 'A', ...JSON.parse(chart({ data: rows })) }, change, { title: 'C', ...JSON.parse(chart({ data: rows })) }];
  assert.ok(under(plain(draw('row', JSON.stringify(three), { width: 96 })).split('\n')), 'in a wrapped row the table still sits under its own chart');
});

test('a percent chart prints no sum of percentages in its footer', () => {
  const pct = (spec) => plain(draw('chart', chart({ yFormat: 'percent', data: rows, ...spec })));
  for (const spec of [{}, { type: 'column' }, { type: 'line' }, { diverging: true }, { series: 'g', data: [{ k: 'a', g: 'x', v: 1 }, { k: 'a', g: 'y', v: 2 }] }]) {
    assert.doesNotMatch(pct(spec), /total|net|40%|of top/, JSON.stringify(spec));
  }
  assert.match(pct({}), /RDS █+ 30%/);
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
  assert.throws(() => draw('chart', chart({ type: 'scatter', data: rows })), /Unknown chart type \(types:/);
  const text = plain(draw('chart', chart({ title: 'x\u001b]0;owned\u0007', data: [{ k: 'a\u001b[2J', v: 1 }] })));
  assert.doesNotMatch(text, /[\u0000-\u0009\u000b-\u001f]/);
  assert.doesNotMatch(plain(draw('mermaid', 'flowchart LR\n  A[a\u001b[2J] --> B')), /\u001b/);
});

test('a diagram takes a classDef color in short hex, and its list keeps every edge of a chain', () => {
  const lines = draw('mermaid', 'flowchart LR\n  A[Users] --> B[Orders]\n  classDef hot fill:#f00\n  class B hot');
  assert.ok(runs(lines).some(([, fg]) => fg === '#ff0000'), 'the class color wins over the family color');
  const list = plain(draw('mermaid', 'flowchart LR\n  A[Users of the shop] --> B[Orders API of the shop] --> C[(Orders database of the shop)]', { width: 60 }));
  assert.match(list, /Users of the shop[\s\S]*▼[\s\S]*Orders API of the shop[\s\S]*▼[\s\S]*Orders database of the shop/, 'both links of the chain');
});

test('a diagram reads chains, fan-outs and text links, joins a two-line label, and sends a link to a group to its first node', () => {
  const src = 'flowchart LR\n  subgraph net["Network"]\n    lb["Load balancer<br/>public"]\n  end\n  u[Users] & b[Bots] --> lb\n  lb -- calls --> api[API service] -->|"sql"| db[(Orders DB)]\n  ops[Operators] --> net';
  const text = plain(draw('mermaid', src, { width: 160 }));
  for (const label of ['Load balancer · public', 'Users', 'Bots', 'API service', 'Orders DB', 'Operators', 'Network']) assert.ok(text.includes(label), label);
  assert.doesNotMatch(text, /<br/);
  assert.doesNotMatch(text, /│ net +│/, 'a link to a group draws no box of its own');
  const links = (s) => parseFlowchart(s).edges.map((e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ''}`);
  assert.deepEqual(links(src), ['u>lb', 'b>lb', 'lb>api:calls', 'api>db:sql', 'ops>net']);
  const twoGroups = `${src}\n  subgraph jobs["Jobs"]\n    q[Queue]\n  end`;
  assert.match(plain(draw('mermaid', twoGroups, { width: 120 })), /Operators → Network \(group\)/, 'a link between groups names the group');
  const terse = 'graph TD; a-1:::hot-->b-2[B] -.-> c-->d %% note\n  style a-1 fill:#f00\n  d ==> idle\n  subgraph outer[Outer]\n    subgraph idle[Idle group]\n    end\n  end';
  assert.deepEqual(links(terse), ['a-1>b-2', 'b-2>c', 'c>d', 'd>idle']);
  const { label, group } = parseFlowchart(terse).nodes.get('idle');
  assert.deepEqual([label, group], ['Idle group', 'outer'], 'an empty group is a node of its parent');
  const bare = parseFlowchart('flowchart\n  a --> b');
  assert.deepEqual([bare.dir, ...bare.nodes.keys()], ['TB', 'a', 'b'], 'a header with no direction is not a node');
});

test('a diagram that no layout draws whole is a list that wraps a long line at a space and keeps every label', () => {
  const src = 'flowchart LR\n  subgraph g["A rather long group title for one box"]\n    a[Alpha]\n  end\n  b[Beta] -->|a label longer than twenty-four characters| a';
  assert.match(plain(draw('mermaid', src, { width: 100 })), /▌ A rather long group title for one box/, 'a layout that fits but cuts the title is not kept');
  const text = plain(draw('mermaid', src, { width: 34 }));
  assert.match(text, /▌ A rather long group title\s+│\n│ +for one box/);
  assert.match(text, /Beta → Alpha {2}a label longer +│\n│ +than twenty-four +│\n│ +characters/);
  assert.ok(text.split('\n').every((row) => [...row].length <= 34));
});

test('a mermaid block of another kind draws as the text renderer draws it', () => {
  const src = '%% a note\nsequenceDiagram\n  Alice->>Bob: Hello';
  const text = plain(draw('mermaid', src, { width: 60 }));
  assert.match(text, /│ Alice │ +│ Bob │/);
  assert.doesNotMatch(text, /sequenceDiagram/);
  assert.throws(() => draw('mermaid', src, { width: 12 }), /cannot be drawn/);
});

test('several groups draw one frame each, titled by their path, then the links between them', () => {
  const src = 'flowchart LR\n  subgraph acct["Account prod"]\n    subgraph vpc["VPC main"]\n      api[ECS API] --> db[(RDS orders)]\n    end\n  end\n  subgraph edge["Edge"]\n    cdn[CloudFront]\n  end\n  cdn --> api';
  const lines = draw('mermaid', src, { width: 120 });
  const text = plain(lines);
  const at = (title) => {
    const i = lines.flat().findIndex(([t]) => t === title);
    assert.ok(i > 0, `no frame titled ${title}`);
    return i;
  };
  const frame = (title) => lines.flat()[at(title) - 1][1];
  assert.equal(frame('Account prod › VPC main'), familyOf('VPC main'), 'a frame takes the color of its group');
  assert.equal(lines.flat()[at('Account prod › VPC main')][1], familyOf('VPC main'), 'a family titles its frame in its color');
  assert.equal(lines.flat()[at('Edge')][1], '#F8FAFC', 'a group with no family keeps a light title');
  const listed = (title) => {
    const src = `flowchart LR\n  subgraph g["${title}"]\n    a[Alpha]\n  end\n  b[Beta] -->|a label longer than twenty-four characters| a`;
    const list = draw('mermaid', src, { width: 34 });
    assert.match(plain(list), new RegExp(`▌ ${title}`), 'the group is listed');
    return runs(list).find(([t]) => t === title)?.[1];
  };
  assert.equal(listed('Shop'), '#F8FAFC', 'a listed group with no family keeps a light title');
  assert.equal(listed('VPC main'), familyOf('VPC main'), 'a listed group takes its family color');
  assert.match(text, /╭─ Account prod › VPC main ─/);
  assert.match(text, /╭─ Edge ─/);
  assert.match(text, /Links between groups +│\n│ +CloudFront → ECS API/);
  assert.match(text, /ECS API ├──►│ RDS orders/, 'a link inside a group is drawn');
  const narrow = plain(draw('mermaid', src, { width: 40 }));
  assert.match(narrow, /╭─ Account prod › VPC main ─+╮ │\n│ │ ┌/, 'a frame that does not fit beside the last goes under it');
  assert.ok(narrow.split('\n').every((row) => [...row].length <= 40));
});

test('a flowchart parses dashed ids, late and repeated groups, both title forms, link styles and an escaped line break', () => {
  const groupOf = (src) => Object.fromEntries([...parseFlowchart(src).nodes.values()].map((n) => [n.id, n.group]));
  assert.deepEqual(groupOf('flowchart LR\n  subgraph s[S]\n    end-user[User] --> graph-db[DB]\n  end'), { 'end-user': 's', 'graph-db': 's' }, 'a dashed id is not a keyword');
  const late = parseFlowchart('flowchart LR\n  ops[Operators] --> net\n  subgraph net[Network]\n    lb[LB]\n  end');
  assert.deepEqual([[...late.nodes.keys()], late.order], [['ops', 'lb'], [{ node: 'ops' }, { group: 'net' }]], 'a group declared after a link to it draws no box');
  const moved = parseFlowchart('flowchart LR\n  a[Users] --> b[API]\n  subgraph s[Cloud]\n    b\n  end');
  assert.deepEqual([moved.nodes.get('b').group, moved.order, moved.groups.get('s').items], ['s', [{ node: 'a' }, { group: 's' }], [{ node: 'b' }]]);
  const twice = parseFlowchart('flowchart LR\n  subgraph s[First]\n    a\n  end\n  subgraph s\n    b\n  end');
  assert.deepEqual([twice.groups.get('s').title, twice.groups.get('s').items.length, twice.order.length], ['First', 2, 1], 'a repeated group id adds to the first group');
  const titles = parseFlowchart('flowchart LR\n  subgraph "My title"\n    a\n  end\n  subgraph id [Other]\n    b\n  end\n  x --> id');
  assert.deepEqual([...titles.groups.values()].map((g) => [g.id, g.title]), [['g0', 'My title'], ['id', 'Other']]);
  assert.match(plain(draw('mermaid', 'flowchart LR\n  subgraph id [Other]\n    b[Box]\n  end\n  x[X] --> id', { width: 120 })), /X ├─┼►│ Box/, 'a link to a spaced group id reaches it');
  const styled = 'flowchart LR\n  a[Alpha] ~~~ b[Beta]\n  a --- c[Gamma]\n  a <--> d[Delta]\n  a -- text --- e[Epsilon]';
  assert.deepEqual(parseFlowchart(styled).edges.map((e) => e.link), ['hidden', 'line', 'both', 'line']);
  const drawn = plain(draw('mermaid', styled, { width: 160 }));
  assert.doesNotMatch(drawn, /►│ Beta/, 'a hidden link draws no arrow');
  assert.match(drawn, /Alpha ◄[\s\S]*▼/, 'a two-way link has an arrow at both ends');
  const list = plain(draw('mermaid', styled, { width: 30 }));
  assert.match(list, /Alpha — Gamma/);
  assert.match(list, /Alpha ↔ Delta/);
  assert.doesNotMatch(list, /Alpha . Beta/);
  const escaped = plain(draw('mermaid', 'flowchart LR\n  a["one\\ntwo"] --> b[B]', { width: 120 }));
  assert.match(escaped, /one · two/);
  assert.doesNotMatch(escaped, /\\n/);
});

test('a layout that fuses two link labels or runs a wall through one is not kept', () => {
  const src = 'flowchart TB\n  q[SQS jobs] --> l[Lambda deploy]\n  e[EventBridge rule] -->|invoke| l\n  l -->|UpdateFunctionCode| f[Lambdas using image]\n  l -->|UpdateService| s[ECS services]';
  const text = plain(draw('mermaid', src, { width: 100 }));
  assert.doesNotMatch(text, /invoke─?Update|Update\w*─invoke/);
  assert.match(text, /EventBridge rule → Lambda deploy +invoke/);
});

test('among generic words, the last one in a label wins', () => {
  assert.equal(familyOf('Auth DB'), familyOf('orders database'));
  assert.equal(familyOf('Analytics API'), familyOf('ECS api'));
  assert.equal(familyOf('Monitoring worker'), familyOf('ECS api'));
  assert.notEqual(familyOf('Auth DB'), familyOf('Auth API'));
});

test('a node takes the color of the service it names, before a generic word', () => {
  const same = (a, b) => assert.equal(familyOf(a), familyOf(b), `${a} / ${b}`);
  const differ = (a, b) => assert.notEqual(familyOf(a), familyOf(b), `${a} / ${b}`);
  same('SQS jobs', 'Service Bus orders');
  same('GitHub repo', 'ECR push');
  same('AWS account prod', 'tenant acme');
  same('All ECS services using the image', 'Cloud Run api');
  same('Cloud Build', 'GitHub repo');
  same('Internet Gateway', 'NAT gateway');
  same('Upstream API', 'ECS api');
  differ('Dashboards', 'RDS orders');
  differ('SQS jobs', 'ECS api');
  differ('CloudWatch logs', 'S3 logs bucket');
  assert.equal(familyOf('Shop front page'), undefined);
});

test('among service names, the first one in a label wins, as a label starts with its subject', () => {
  assert.equal(familyOf('ECS task writing to S3'), familyOf('ECS api'));
  assert.equal(familyOf('Lambda reads RDS'), familyOf('ECS api'));
  assert.equal(familyOf('Kafka on EKS'), familyOf('SQS jobs'));
  assert.equal(familyOf('Terraform state bucket'), familyOf('GitHub repo'), 'terraform is the only service name, so the bucket is CI/CD');
});

test('an account or a network needs a cloud word, not a word that a product also uses', () => {
  const account = familyOf('AWS account prod');
  assert.equal(familyOf('Azure subscription prod'), account);
  assert.equal(familyOf('GCP project data'), account);
  assert.notEqual(familyOf('Stripe subscription'), account);
  assert.notEqual(familyOf('API project'), account);
  assert.notEqual(familyOf('Payment gateway'), familyOf('VPC main'));
  assert.equal(familyOf('VPN gateway'), familyOf('VPC main'));
  assert.equal(familyOf('API Gateway'), familyOf('VPC main'));
});

test('a node label decides its color, and its id or icon name counts only when the label names no family', () => {
  const src = 'flowchart LR\n  users[(Users DB)] --> auth[(Auth DB)] --> api[Orders queue]\n  r[(RDS main)] --> s[SQS jobs]\n  db[Primary] --> u[Users]';
  const lines = draw('mermaid', src, { width: 200 });
  const fill = (label) => runs(lines).find(([t]) => t === label)?.[2];
  assert.equal(fill('Users DB'), fill('RDS main'));
  assert.equal(fill('Auth DB'), fill('RDS main'));
  assert.equal(fill('Orders queue'), fill('SQS jobs'));
  assert.equal(fill('Primary'), fill('RDS main'), 'the id names the family when the label names none');
});

test('a link that closes a cycle is listed under the drawing, and the rest draws in link order', () => {
  const src = 'flowchart LR\n  q[SQS jobs] --> l[Lambda deploy]\n  l -->|redeploy| s[ECS services]\n  s -->|done| e[EventBridge state]\n  e --> l';
  const text = plain(draw('mermaid', src, { width: 120 }));
  assert.match(text, /↺ EventBridge state → Lambda deploy/);
  assert.match(text, /SQS jobs[\s\S]*Lambda deploy[\s\S]*ECS services[\s\S]*EventBridge state/);
  const narrow = plain(draw('mermaid', 'flowchart TB\n  q[Queue] --> l[Deploy]\n  l --> s[Services]\n  s --> e[Event state of the deployment] --> l', { width: 40 }));
  assert.match(narrow, /↺/);
  assert.ok(narrow.split('\n').every((row) => [...row].length <= 40), 'a back link wraps to the width');
});

test('a group with no link inside lists its nodes instead of drawing empty boxes', () => {
  const src = 'flowchart LR\n  subgraph a["Account prod"]\n    r[RDS]\n    e[ECS]\n  end\n  subgraph b["Account dev"]\n    s[S3]\n  end';
  const text = plain(draw('mermaid', src, { width: 120 }));
  assert.match(text, /╭─ Account prod ─[\s\S]*■ RDS[\s\S]*■ ECS/);
  assert.doesNotMatch(text, /┌/);
});

test('in a group, linked nodes are drawn and lone nodes are listed under the drawing', () => {
  const src = 'flowchart LR\n  subgraph v["VPC main"]\n    a[ALB public] --> n[NAT gateway]\n    r[(RDS orders)]\n  end\n  subgraph w["VPC edge"]\n    c[CloudFront]\n  end\n  c --> a';
  const text = plain(draw('mermaid', src, { width: 120 }));
  assert.match(text, /ALB public ├[^\n]*►│ NAT gateway/);
  assert.match(text, /■ RDS orders/);
  assert.doesNotMatch(text, /│ RDS orders │/);
});

test('a group whose linked nodes do not fit the width lists every node and its links', () => {
  const src = 'flowchart LR\n  subgraph v["VPC main"]\n    a[ALB public facing orders] --> n[NAT gateway shared egress]\n    r[(RDS orders)]\n  end\n  subgraph w["VPC edge"]\n    c[CloudFront]\n  end';
  const text = plain(draw('mermaid', src, { width: 28 }));
  assert.match(text, /■ ALB public facing[\s\S]*■ NAT gateway shared[\s\S]*■ RDS orders[\s\S]*Links/);
});

test('a label inside a longer label colors only its own box', () => {
  const lines = draw('mermaid', 'flowchart LR\n  G[API Gateway] --> A[API]', { width: 120 });
  assert.notEqual(runOf(lines, 'API Gateway')[2], runs(lines).find(([t]) => t === 'API')[2]);
});

test('the reply splits into text and the blocks it draws', () => {
  const parts = splitReply('Top cost:\n```chart\n{}\n```\nDone.\n```js\nx\n```\n```row\n[]\n```\n```cube-chart\n{}\n```');
  assert.deepEqual(parts.map((p) => p.kind ?? 'text'), ['text', 'chart', 'text', 'row', 'text', 'cube-chart']);
  assert.equal(needsRows('cube-chart', '{"query":{"filters":[{"values":["data"]}]}}'), true);
  assert.equal(needsRows('chart', '{"query":{},"data":[]}'), false);
  assert.equal(needsRows('mermaid', 'flowchart LR'), false);
});

const cli = (args, input) => spawnSync(process.execPath, ['bin/cxm.js', 'viz', ...args], { encoding: 'utf8', input, env: { ...process.env, CXM_TELEMETRY: '0' } });

test('cxm viz reads a file, stdin or an inline body after its flags, and --color paints it', () => {
  const file = cli(['chart', '--width', '100', 'test/fixtures/spend.json']);
  assert.equal(file.status, 0, file.stderr);
  assert.match(file.stdout, /RDS █+ \$1,854/);
  const piped = cli(['chart', '-', '--color'], chart({ data: rows }));
  assert.equal(piped.status, 0, piped.stderr);
  assert.match(piped.stdout, /\x1b\[38;2;91;141;239m█+\x1b\[0m/);
  const withData = '{"x":"a","y":"b","query":{},"data":[{"a":1,"b":2}]}';
  assert.equal(cli(['cube-chart', '-', '--rows'], withData).stdout, withData, 'a block with rows needs no query');
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
  assert.throws(() => draw('chart', chart({ data: [{ s: 'RDS', c: 100 }, { s: 'RDS', c: 50 }, { s: 'ECS', c: 10 }] , x: 's', y: 'c' })), (err) => /two rows for one "s" \(row 2\)/.test(err.message) && !/RDS/.test(err.message));
  assert.throws(() => draw('chart', 'prod-payments-db'), (err) => /not valid JSON/.test(err.message) && !/prod/.test(err.message));
  assert.throws(() => draw('chart', chart({ type: 'prod-payments-db', data: [{ k: 'a', v: 1 }] })), (err) => /Unknown chart type/.test(err.message) && !/prod/.test(err.message));
  const cli = spawnSync(process.execPath, ['bin/cxm.js', 'viz', 'cube-chart', 'prod-payments-db'], { encoding: 'utf8', env: { ...process.env, CXM_TELEMETRY: '0' } });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /not valid JSON/);
  assert.doesNotMatch(cli.stderr, /prod/);
  assert.throws(() => draw('mermaid', 'graph prod-payments-db'), (err) => /cannot be drawn/.test(err.message) && !/prod/.test(err.message));
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

test('with one group or none, linked nodes are drawn, lone nodes are listed, and a hidden link keeps a node drawn', () => {
  const one = plain(draw('mermaid', 'flowchart LR\n  subgraph v["VPC main"]\n    a[ALB] --> n[NAT]\n    r[(RDS orders)]\n  end', { width: 120 }));
  assert.match(one, /VPC main/);
  assert.match(one, /■ RDS orders/);
  assert.doesNotMatch(one, /│ RDS orders │/);
  const none = plain(draw('mermaid', 'flowchart LR\n  a[ALB] --> n[NAT]\n  r[(RDS orders)]', { width: 120 }));
  assert.match(none, /■ RDS orders/);
  const hidden = plain(draw('mermaid', 'flowchart LR\n  subgraph v["VPC main"]\n    a[ALB] --> n[NAT]\n    n ~~~ c[Cache]\n  end\n  subgraph w["Edge"]\n    e[CDN]\n  end', { width: 120 }));
  assert.match(hidden, /│ +Cache +│/);
  assert.doesNotMatch(hidden, /■ Cache/);
});

test('a block exports its rows as CSV, with no cell a spreadsheet would run as a formula', () => {
  const spec = { x: 'k', y: 'v', series: 's', table: true, data: [{ k: 'RDS, orders', s: 'Oct', v: 30, note: '=HYPERLINK("x")' }, { k: 'ECS', s: 'Oct', v: '-1.5e3', note: '-2+3' }] };
  assert.equal(toCsv('chart', JSON.stringify(spec)), 'k,s,v,note\n"RDS, orders",Oct,30,"\'=HYPERLINK(""x"")"\nECS,Oct,-1.5e3,\'-2+3');
  const items = [{ type: 'table', columns: ['a', { name: 'b', format: 'usd' }], rows: [[1, 2]] }, { type: 'note', text: 'x' }, { type: 'bar', x: 'k', y: 'v', table: [{ key: 'v', name: 'Cost' }], data: [{ k: 'a', v: 1 }] }];
  assert.equal(toCsv('row', JSON.stringify(items)), 'a,b\n1,2\n\nk,Cost\na,1');
  assert.equal(toCsv('mermaid', 'flowchart LR\n  a[ALB] -->|https| b[ECS api]'), 'source,target,label\nALB,ECS api,https');
});

test('a drawing exports as an SVG with its colors, fills and escaped text', () => {
  const svg = toSvg([[['<RDS>', '#5B8DEF', '#123456', true], [' & co']]]);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<rect x="12\.0" y="12" width="42\.0" height="18" fill="#123456"/);
  assert.match(svg, /<tspan fill="#5B8DEF" font-weight="bold">&lt;RDS&gt;<\/tspan><tspan fill="#E2E8F0"> &amp; co<\/tspan>/);
});

test('cxm viz writes --csv and --svg files and names them, and refuses a flag with no path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cxm-export-'));
  const env = { ...process.env, CXM_TELEMETRY: '0', CXM_CONFIG_DIR: dir };
  const run = (...args) => spawnSync(process.execPath, ['bin/cxm.js', 'viz', ...args], { encoding: 'utf8', env });
  const ok = run('chart', 'test/fixtures/spend.json', '--csv', join(dir, 'a.csv'), '--svg', join(dir, 'a.svg'));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Wrote .*a\.csv\nWrote .*a\.svg/);
  assert.match(readFileSync(join(dir, 'a.csv'), 'utf8'), /^service,cost\nRDS,1854\n/);
  assert.match(readFileSync(join(dir, 'a.svg'), 'utf8'), /<svg[\s\S]*Spend by service/);
  assert.match(run('chart', 'test/fixtures/spend.json', '--csv').stderr, /--csv and --svg need a file path/);
  assert.match(run('chart', 'test/fixtures/spend.json', '--csv', '--svg', join(dir, 'b.svg')).stderr, /--csv and --svg need a file path/);
});
