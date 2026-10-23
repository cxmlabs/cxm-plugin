// Draws the chart, row and diagram blocks of an agent reply as lines of colored text runs. One
// drawing serves every tier: the reply renderer turns the runs into styled text, `cxm viz` prints them.
// Pure and import-free but for diagram.js, because the reply renderer runs with no Node.
import { drawDiagram } from './diagram.js';

// A run is [text, foreground, background, bold]; empty strings mean the surface default.
export const PALETTE = ['#5B8DEF', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#14B8A6', '#EC4899', '#64748B'];
const MUTED = '#94A3B8';
const FAINT = '#64748B';
const BORDER = '#334155';
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const LOWER = ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const LABEL_MAX = 24;

// The fenced blocks the renderer draws. `cube-chart` is a chart whose rows come from a query.
export const FENCE = /```(chart|cube-chart|row|mermaid)[ \t]*\n([\s\S]*?)```/g;

const len = (s) => [...s].length;
const widthOf = (runs) => runs.reduce((n, [t]) => n + len(t), 0);
const padEnd = (runs, w) => (widthOf(runs) < w ? [...runs, [' '.repeat(w - widthOf(runs))]] : runs);
const cut = (s, max) => (len(s) > max ? `${[...s].slice(0, max - 1).join('')}…` : s);

// Intl may be absent where the reply renderer runs, so group the thousands by hand.
function number(v) {
  const digits = Math.abs(v) >= 100 ? 0 : 1;
  const [int, dec] = Math.abs(v).toFixed(digits).split('.');
  const text = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec && dec !== '0' ? `.${dec}` : '');
  return v < 0 ? `-${text}` : text;
}
export const fmt = (v, format) => (format === 'currency' ? (v < 0 ? `-$${number(-v)}` : `$${number(v)}`) : format === 'percent' ? `${number(v)}%` : number(v));
const signed = (v, format) => `${v > 0 ? '+' : ''}${fmt(v, format)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatX(v, xFormat) {
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m || !xFormat) return String(v);
  if (xFormat === 'month') return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  if (xFormat === 'date') return `${m[1]}-${m[2]}-${m[3]}`;
  return `${m[2]}-${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'}`;
}

// Dex's chart block: `x`, `y` and `series` name keys of the `data` rows.
export function toSeries(spec) {
  const { x, y, data } = spec;
  if (!Array.isArray(data) || !x || !y) throw new Error('A chart needs "x", "y" and "data" rows');
  const xs = [...new Set(data.map((r) => String(r[x])))];
  const names = spec.series ? [...new Set(data.map((r) => String(r[spec.series])))] : [spec.yName ?? y];
  const value = (xv, name) => Number(data.find((r) => String(r[x]) === xv && (!spec.series || String(r[spec.series]) === name))?.[y] ?? 0);
  return { labels: xs.map((v) => formatX(v, spec.xFormat)), series: names.map((name) => ({ name, data: xs.map((xv) => value(xv, name)) })) };
}

const blocks = (v, max, width) => {
  const eighths = Math.round((v / (max || 1)) * width * 8);
  return '█'.repeat(Math.floor(eighths / 8)) + EIGHTHS[eighths % 8];
};
const shade = (light, deep, k) =>
  '#' + [1, 3, 5].map((i) => Math.round(parseInt(light.slice(i, i + 2), 16) * (1 - k) + parseInt(deep.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
const sum = (a) => a.reduce((s, v) => s + v, 0);

// One line per category; `pie` scales each bar to the total, so the bars read as shares.
function barLines({ labels, series }, spec, room) {
  const labelW = Math.max(...labels.map(len));
  const values = series.flatMap((s) => s.data);
  const valueW = Math.max(...values.map((v) => len(fmt(v, spec.yFormat))));
  const single = series.length === 1;
  const barW = Math.max(8, Math.min(46, room - labelW - valueW - (single ? 8 : 3)));
  const totals = series.map((s) => sum(s.data));
  const max = spec.type === 'pie' ? totals[0] : Math.max(...values.map(Math.abs));
  const lines = [];
  labels.forEach((label, i) =>
    series.forEach((s, j) => {
      const v = s.data[i];
      const line = [
        [`${(j === 0 ? label : '').padStart(labelW)} `, MUTED],
        [blocks(Math.abs(v), max, barW).padEnd(barW), PALETTE[(single ? i : j) % PALETTE.length]],
        [` ${fmt(v, spec.yFormat).padStart(valueW)}`],
      ];
      if (single) line.push([`  ${String(Math.round((v / (totals[0] || 1)) * 100)).padStart(3)}%`, FAINT]);
      lines.push(line);
    }),
  );
  lines.push([]);
  if (single) lines.push([[`${' '.repeat(labelW)} total ${fmt(totals[0], spec.yFormat)}`, FAINT]]);
  else lines.push(series.flatMap((s, j) => [['■ ', PALETTE[j % PALETTE.length]], [`${s.name} ${fmt(totals[j], spec.yFormat)}  `, FAINT]]));
  return lines;
}

// Rises go right in red, falls go left in green, both deeper as they grow.
function divergingLines({ labels, series }, spec, room) {
  const data = series[0].data;
  const labelW = Math.max(...labels.map(len));
  const valueW = Math.max(...data.map((v) => len(signed(v, spec.yFormat))));
  const half = Math.max(6, Math.min(23, Math.floor((room - labelW - valueW - 3) / 2)));
  const max = Math.max(...data.map(Math.abs));
  const lines = data.map((v, i) => {
    const k = 0.25 + 0.75 * (Math.abs(v) / (max || 1));
    const color = v > 0 ? shade('#FCA5A5', '#B91C1C', k) : shade('#86EFAC', '#15803D', k);
    const bar = blocks(Math.abs(v), max, half);
    const left = v < 0 ? [...bar].reverse().join('').replace(/[▏▎▍▌▋▊▉]/, '▐') : '';
    return [
      [`${labels[i].padStart(labelW)} `, MUTED],
      [left.padStart(half), color],
      ['│', FAINT],
      [(v > 0 ? bar : '').padEnd(half), color],
      [` ${signed(v, spec.yFormat).padStart(valueW)}`, color],
    ];
  });
  return [...lines, [], [[`net ${signed(sum(data), spec.yFormat)}`, FAINT]]];
}

function columnsOf(levels, height, w, gap) {
  return Array.from({ length: height }, (_, r) => {
    const floor = (height - 1 - r) * 8;
    return levels.map((l) => (LOWER[Math.max(0, Math.min(8, l - floor))] || ' ').repeat(w));
  }).map((cells) => cells.map((c, i) => [c + (i < cells.length - 1 ? gap : '')]));
}

// Vertical bars, one series, the value above each bar and the category under it.
function columnLines({ labels, series }, spec, room) {
  const data = series[0].data;
  const height = spec.height ?? 4;
  const max = Math.max(...data);
  const w = Math.min(Math.max(3, ...labels.map(len), ...data.map((v) => len(fmt(v, spec.yFormat)))), Math.max(3, Math.floor(room / data.length) - 1));
  const levels = data.map((v) => Math.max(1, Math.round((v / (max || 1)) * height * 8)));
  const bars = columnsOf(levels, height, w, ' ').map((cells) => cells.map(([t], i) => [t, PALETTE[i % PALETTE.length]]));
  return [
    [[data.map((v) => cut(fmt(v, spec.yFormat), w).padStart(w)).join(' ')]],
    ...bars,
    [[labels.map((x) => cut(x, w).padStart(w)).join(' '), MUTED]],
    [],
    [[`total ${fmt(sum(data), spec.yFormat)}`, FAINT]],
  ];
}

// One band of vertical bars per series, scaled to the shared low and high.
function lineLines({ labels, series }, spec, room) {
  const all = series.flatMap((s) => s.data);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const height = spec.height ?? 4;
  const nameW = Math.max(...series.map((s) => len(s.name)));
  const step = labels.length * 3 <= room - nameW - 24 ? 3 : 1;
  const lines = [];
  series.forEach((s, i) => {
    const levels = s.data.map((v) => 1 + Math.round(((v - lo) / (hi - lo || 1)) * (height * 8 - 1)));
    columnsOf(levels, height, step === 3 ? 2 : 1, step === 3 ? ' ' : '').forEach((cells, r) => {
      const note = r === 0 ? `  max ${fmt(Math.max(...s.data), spec.yFormat)}` : r === height - 1 ? `  min ${fmt(Math.min(...s.data), spec.yFormat)}` : '';
      lines.push([[`${(r === Math.floor(height / 2) ? s.name : '').padStart(nameW)} `, MUTED], [cells.map(([t]) => t).join(''), PALETTE[i % PALETTE.length]], [note, FAINT]]);
    });
    lines.push([[`${' '.repeat(nameW)} now ${fmt(s.data.at(-1), spec.yFormat)} · total ${fmt(sum(s.data), spec.yFormat)}`, FAINT]]);
  });
  lines.push([[`${' '.repeat(nameW)} ${labels[0]} → ${labels.at(-1)}`, FAINT]]);
  return lines;
}

// A table block: numbers right-aligned, and a bold total row unless `total` is false.
export function tableBlock({ title, columns, rows, total, format }) {
  const numeric = columns.map((_, i) => rows.length > 0 && rows.every((r) => typeof r[i] === 'number'));
  const sums = columns.map((_, i) => (numeric[i] ? sum(rows.map((r) => r[i])) : null));
  const withTotal = total !== false && sums.some((v) => v !== null);
  const cells = rows.map((r) => r.map((v) => (typeof v === 'number' ? fmt(v, format) : String(v ?? ''))));
  const totalRow = columns.map((_, i) => (sums[i] !== null ? fmt(sums[i], format) : i === 0 ? 'Total' : ''));
  const w = columns.map((h, i) => Math.max(len(h), ...cells.map((r) => len(r[i] ?? '')), withTotal ? len(totalRow[i]) : 0));
  const line = (r) => r.map((v, i) => (numeric[i] ? v.padStart(w[i]) : v.padEnd(w[i]))).join('  ');
  const rule = [[w.map((n) => '─'.repeat(n)).join('  '), BORDER]];
  return {
    title,
    lines: [
      [[line(columns), MUTED, '', true]],
      rule,
      ...cells.map((r) => [[line(r)]]),
      ...(withTotal ? [rule, [[line(totalRow), '', '', true]]] : []),
    ],
  };
}

const asTable = (spec, { labels, series }) =>
  tableBlock({ title: 'Values', columns: ['', ...series.map((s) => s.name)], rows: labels.map((x, i) => [x, ...series.map((s) => s.data[i])]), format: spec.yFormat });

// The blocks one chart spec draws: the chart, and its table beside it when `table` is set.
function chartBlocks(spec, room) {
  if (!Array.isArray(spec.data)) throw new Error('This chart has no rows yet: a cube-chart needs `cxm viz` to run its query first');
  const parsed = toSeries(spec);
  parsed.labels = parsed.labels.map((l) => cut(l, LABEL_MAX));
  const inner = (spec.table ? Math.floor(room * 0.6) : room) - 4;
  const draw = spec.type === 'line' ? lineLines : spec.type === 'column' ? columnLines : spec.diverging ? divergingLines : barLines;
  const chart = { title: spec.title ?? spec.yName ?? '', spaced: true, lines: draw(parsed, spec, inner) };
  return spec.table ? [chart, asTable(spec, parsed)] : [chart];
}

function noteBlock({ title, text }) {
  const words = String(text).split(/\s+/);
  const lines = [''];
  for (const word of words) {
    if (len(lines.at(-1)) + len(word) + 1 > 40 && lines.at(-1)) lines.push('');
    lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word;
  }
  return { title, lines: lines.map((l) => [[l]]) };
}

const itemBlocks = (item, room) => (item.type === 'table' ? [tableBlock(item)] : item.type === 'note' || item.type === 'markdown' ? [noteBlock(item)] : chartBlocks(item, room));

// A rounded frame around one block, padded to `height` so blocks side by side end level.
function frame({ title, lines, spaced }, height = 0) {
  const bodyW = Math.max(0, ...lines.map(widthOf));
  const titleW = title ? len(title) : 0;
  const inner = Math.max(bodyW, titleW);
  const left = Math.floor((inner - bodyW) / 2);
  const body = lines.map((runs) => padEnd([[' '.repeat(left)], ...runs], inner));
  const head = title ? [[[' '.repeat(Math.floor((inner - titleW) / 2)) + title, '', '', true]], ...(spaced ? [[]] : [])].map((r) => padEnd(r, inner)) : [];
  const all = [...head, ...body];
  while (all.length < height - 2) all.push([[' '.repeat(inner)]]);
  return [
    [[`╭${'─'.repeat(inner + 2)}╮`, BORDER]],
    ...all.map((runs) => [['│ ', BORDER], ...runs, [' │', BORDER]]),
    [[`╰${'─'.repeat(inner + 2)}╯`, BORDER]],
  ];
}

// Blocks side by side when they fit the width, else one under the other.
function layout(blocks, width) {
  const framed = blocks.map((b) => frame(b));
  const total = framed.reduce((n, f) => n + widthOf(f[0]) + 1, -1);
  if (framed.length === 1 || total > width) return framed.flatMap((f, i) => (i ? [[], ...f] : f));
  const height = Math.max(...framed.map((f) => f.length));
  const even = blocks.map((b) => frame(b, height));
  return Array.from({ length: height }, (_, r) => even.flatMap((f, i) => [...(i ? [[' ']] : []), ...f[r]]));
}

// Draws one fenced block. Throws on a body it cannot read, so a caller can show the raw block.
export function draw(kind, body, { width = 100 } = {}) {
  if (kind === 'mermaid') return frame({ lines: drawDiagram(body, width - 4) });
  const spec = JSON.parse(body);
  if (kind === 'row') {
    const items = Array.isArray(spec) ? spec : spec.items;
    const room = Math.floor(width / items.length) - 1;
    return layout(items.flatMap((item) => itemBlocks(item, room)), width);
  }
  return layout(chartBlocks(spec, width), width);
}

// The reply split into text and the blocks the renderer draws, in order.
export function splitReply(text) {
  const parts = [];
  let at = 0;
  for (const m of text.matchAll(FENCE)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ kind: m[1], body: m[2], text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

export const plain = (lines) => lines.map((runs) => runs.map(([t]) => t).join('').trimEnd()).join('\n');

const sgr = (hex, layer) => {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[${layer};2;${n >> 16};${(n >> 8) & 255};${n & 255}m`;
};
export const ansi = (lines) =>
  lines.map((runs) => runs.filter(([t]) => t).map(([t, fg, bg, bold]) => `${bold ? '\x1b[1m' : ''}${fg ? sgr(fg, 38) : ''}${bg ? sgr(bg, 48) : ''}${t}\x1b[0m`).join('')).join('\n');
