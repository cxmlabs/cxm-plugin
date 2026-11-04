// Draws chart, row and diagram blocks as lines of [text, fg, bg, bold] runs. It imports no Node module.
import { drawDiagram } from './diagram.js';

const PALETTE = ['#5B8DEF', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#14B8A6', '#EC4899', '#64748B'];
const MUTED = '#94A3B8';
const FAINT = '#64748B';
const BORDER = '#334155';
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const LOWER = ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const LABEL_MAX = 28;
const TYPES = ['bar', 'line', 'column', 'pie'];
// Labels come from cloud data; a control character in one would send a command to the terminal that prints it.
const CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
const CONTROL_BUT_LINES = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

// The fenced blocks the renderer draws. `cube-chart` is a chart whose rows come from a query.
const FENCE = /```(chart|cube-chart|row|mermaid)[ \t]*\n([\s\S]*?)```/g;

// True for a chart that names a query and holds no rows yet. Throws on a body that does not parse.
export function needsRows(kind, body) {
  if (kind !== 'chart' && kind !== 'cube-chart') return false;
  const spec = parseBlock(body);
  return Boolean(spec?.query) && !spec.data;
}

const len = (s) => [...s].length;
const widthOf = (runs) => runs.reduce((n, [t]) => n + len(t), 0);
const padEnd = (runs, w) => (widthOf(runs) < w ? [...runs, [' '.repeat(w - widthOf(runs))]] : runs);
const cut = (s, max) => (len(s) > max ? `${[...s].slice(0, max - 1).join('')}…` : s);

// Intl may be absent where the reply renderer runs, so group the thousands by hand.
function number(v, digits = v >= 100 ? 0 : 1) {
  const [int, dec] = v.toFixed(digits).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec && dec !== '0' ? `.${dec}` : '');
}
// Whole dollars from $10, so a column of amounts lines up; cents only below.
const dollars = (v) => number(v, Math.round(v * 100) >= 1000 ? 0 : 2);
const nonZero = (text) => /[1-9]/.test(text);
// A value that rounds to zero shows no sign, so it never reads "-$0.00" or "+0%".
function fmt(v, format) {
  const a = Math.abs(v);
  const text = format === 'currency' ? `$${dollars(a)}` : format === 'percent' ? `${number(a)}%` : number(a);
  return v < 0 && nonZero(text) ? `-${text}` : text;
}
function signed(v, format) {
  const text = fmt(v, format);
  return v > 0 && nonZero(text) ? `+${text}` : text;
}
// A rise reads red and a fall green, as on a bill.
const RISE = '#F87171';
const FALL = '#4ADE80';
const signColor = (v) => (v > 0 ? RISE : v < 0 ? FALL : '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatX(v, xFormat) {
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m || !xFormat) return String(v);
  if (xFormat === 'month') return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  if (xFormat === 'date') return `${m[1]}-${m[2]}-${m[3]}`;
  return `${m[2]}-${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'}`;
}

// The chat's chart block: `x`, `y` and `series` name keys of the `data` rows.
function toSeries(spec) {
  const { x, y, data } = spec;
  if (!Array.isArray(data) || data.length === 0 || !x || !y) throw new Error('A chart needs "x", "y" and at least one "data" row');
  const bad = data.find((r) => r === null || typeof r !== 'object' || !Number.isFinite(Number(r[y] ?? 0)));
  // The row's values never go in the message: an error message is sent with usage analytics.
  if (bad !== undefined) throw new Error(`A chart row needs a number in "${y}" (row ${data.indexOf(bad) + 1})`);
  const keys = data.map((r) => `${r[x]}\u0000${spec.series ? r[spec.series] : ''}`);
  const twice = keys.findIndex((k, i) => keys.indexOf(k) !== i);
  if (twice !== -1) throw new Error(`A chart has two rows for one "${x}" (row ${twice + 1}); give one row per "${x}"${spec.series ? ` and "${spec.series}"` : ''}`);
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

// One line per category; `pie` scales each bar to its series' total, so the bars read as shares.
function barLines({ labels, series }, spec, room) {
  const labelW = Math.max(...labels.map(len));
  const values = series.flatMap((s) => s.data);
  const valueW = Math.max(...values.map((v) => len(fmt(v, spec.yFormat))));
  const single = series.length === 1;
  // A share of a signed total reads as nonsense (-100%, 200%), so signed rows show none.
  const shares = single && values.every((v) => v >= 0);
  const barW = Math.max(8, Math.min(46, room - labelW - valueW - (shares ? 8 : 3)));
  const totals = series.map((s) => sum(s.data));
  const sizes = series.map((s) => (spec.type === 'pie' ? sum(s.data.map(Math.abs)) : Math.max(...values.map(Math.abs))));
  const lines = [];
  labels.forEach((label, i) =>
    series.forEach((s, j) => {
      const v = s.data[i];
      const line = [
        [`${(j === 0 ? label : '').padStart(labelW)} `, MUTED],
        [blocks(Math.abs(v), sizes[j], barW).padEnd(barW), PALETTE[(single ? i : j) % PALETTE.length]],
        [` ${fmt(v, spec.yFormat).padStart(valueW)}`],
      ];
      if (shares) line.push([`  ${String(Math.round((v / (totals[0] || 1)) * 100)).padStart(3)}%`, FAINT]);
      lines.push(line);
    }),
  );
  lines.push([]);
  if (single) lines.push([[`${' '.repeat(labelW)} ${spec.totalLabel} ${fmt(totals[0], spec.yFormat)}`, FAINT]]);
  else lines.push([...series.flatMap((s, j) => [['■ ', PALETTE[j % PALETTE.length]], [`${s.name} ${fmt(totals[j], spec.yFormat)}  `, FAINT]]), [spec.top ? `of top ${spec.top}` : '', FAINT]]);
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
  return [...lines, [], [[`net${spec.top ? ` of top ${spec.top}` : ''} ${signed(sum(data), spec.yFormat)}`, FAINT]]];
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
  const max = Math.max(...data.map(Math.abs));
  const w = Math.min(Math.max(3, ...labels.map(len), ...data.map((v) => len(fmt(v, spec.yFormat)))), Math.max(3, Math.floor(room / data.length) - 1));
  const levels = data.map((v) => Math.max(1, Math.round((Math.abs(v) / (max || 1)) * height * 8)));
  const bars = columnsOf(levels, height, w, ' ').map((cells) => cells.map(([t], i) => [t, PALETTE[i % PALETTE.length]]));
  return [
    [[data.map((v) => cut(fmt(v, spec.yFormat), w).padStart(w)).join(' ')]],
    ...bars,
    [[labels.map((x) => cut(x, w).padStart(w)).join(' '), MUTED]],
    [],
    [[`${spec.totalLabel} ${fmt(sum(data), spec.yFormat)}`, FAINT]],
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
    lines.push([[`${' '.repeat(nameW)} now ${fmt(s.data.at(-1), spec.yFormat)} · ${spec.totalLabel} ${fmt(sum(s.data), spec.yFormat)}`, FAINT]]);
  });
  lines.push([[`${' '.repeat(nameW)} ${labels[0]} → ${labels.at(-1)}`, FAINT]]);
  return lines;
}

// A table block: numbers right-aligned, and a bold total row unless `total` is false. A column is a
// name or { name, format, signed, total }; a signed column shows +/− in red and green, its total too.
function tableBlock({ title, columns, rows, total, format, totalLabel = 'Total' }) {
  const cols = columns.map((c) => (typeof c === 'string' ? { name: c } : c));
  // A blank cell stays blank and leaves its column numeric, as a missing chart value does.
  const blank = (v) => v === null || v === undefined || v === '';
  const numeric = cols.map((_, i) => rows.some((r) => typeof r[i] === 'number') && rows.every((r) => typeof r[i] === 'number' || blank(r[i])));
  // A sum of percentages means nothing, so a percent column has no total.
  const sums = cols.map((c, i) => (numeric[i] && c.total !== false && (c.format ?? format) !== 'percent' ? sum(rows.map((r) => r[i] || 0)) : null));
  const withTotal = total !== false && sums.some((v) => v !== null);
  const show = (v, c) => (c.signed ? signed(v, c.format ?? format) : fmt(v, c.format ?? format));
  const cell = (v, i) => {
    if (typeof v !== 'number') return [String(v ?? ''), ''];
    const text = show(v, cols[i]);
    return [text, cols[i].signed && nonZero(text) ? signColor(v) : ''];
  };
  const cells = rows.map((r) => cols.map((_, i) => cell(r[i], i)));
  const totalRow = cols.map((c, i) => (sums[i] !== null ? cell(sums[i], i) : [i === 0 ? totalLabel : '', '']));
  const w = cols.map((c, i) => Math.max(len(c.name), ...cells.map((r) => len(r[i][0])), withTotal ? len(totalRow[i][0]) : 0));
  const pad = (t, i) => (numeric[i] ? t.padStart(w[i]) : t.padEnd(w[i]));
  // Neighbour cells of one style stay one run, so only a colored cell splits the line.
  const line = (r, bold) =>
    r.reduce((out, [t, fg], i) => {
      const text = (i ? '  ' : '') + pad(t, i);
      const last = out.at(-1);
      if (last && last[1] === fg) last[0] += text;
      else out.push([text, fg, '', bold]);
      return out;
    }, []);
  const rule = [[w.map((n) => '─'.repeat(n)).join('  '), BORDER]];
  return {
    title,
    lines: [
      [[cols.map((c, i) => pad(c.name, i)).join('  '), MUTED, '', true]],
      rule,
      ...cells.map((r) => line(r, false)),
      ...(withTotal ? [rule, line(totalRow, true)] : []),
    ],
  };
}

// The side table: `true` shows the charted values; a list names more keys of the rows, one per
// column, each a key or { key, name, format, signed }. A diverging chart's values are signed.
function asTable(spec, { labels, series }) {
  const base = { title: 'Values', format: spec.yFormat, totalLabel: `T${spec.totalLabel.slice(1)}` };
  if (spec.table === true) {
    const cols = ['', ...series.map((s) => (spec.diverging ? { name: s.name, signed: true } : s.name))];
    return tableBlock({ ...base, columns: cols, rows: labels.map((x, i) => [x, ...series.map((s) => s.data[i])]) });
  }
  if (!Array.isArray(spec.table) || spec.table.length === 0) throw new Error('"table" is true or a list of row keys');
  const cols = spec.table.map((c) => (typeof c === 'string' ? { key: c } : c));
  if (cols.some((c) => typeof c?.key !== 'string')) throw new Error('Each "table" column is a row key or an object with a "key"');
  // A series chart holds one row per x and series, so a list of row keys has no single row per x.
  if (spec.series) throw new Error('A "table" list needs one row per "x": use "table": true on a chart with "series"');
  // A query returns its measures as strings; only those turn into numbers, never a dimension such as an account ID.
  const measures = new Set(spec.query?.measures ?? []);
  const value = (r, key) => (measures.has(key) && typeof r[key] === 'string' && r[key] !== '' ? Number(r[key]) : r[key]);
  const rows = spec.data.map((r) => [cut(formatX(r[spec.x], spec.xFormat), LABEL_MAX), ...cols.map((c) => value(r, c.key))]);
  return tableBlock({ ...base, columns: ['', ...cols.map((c) => ({ name: c.key, ...c }))], rows });
}

// The blocks one chart spec draws: the chart, and its table beside it when `table` is set.
function chartBlocks(spec, room) {
  if (!Array.isArray(spec.data)) throw new Error('This chart has no rows yet: a cube-chart needs `cxm viz` to run its query first');
  if (!TYPES.includes(spec.type ?? 'bar')) throw new Error(`Unknown chart type (types: ${TYPES.join(', ')})`);
  // A query that hit its limit returned the top rows only, so their sum is not the whole.
  const top = spec.query?.limit && spec.data.length >= spec.query.limit ? spec.data.length : 0;
  spec = { ...spec, top, totalLabel: top ? `total of top ${top}` : 'total' };
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

// JSON.parse with a message that never quotes the body.
export function parseBlock(body, reviver) {
  try {
    return JSON.parse(body, reviver);
  } catch {
    throw new SyntaxError('This block is not valid JSON');
  }
}

// Draws one fenced block. Throws on a body it cannot read, so a caller can show the raw block.
export function draw(kind, body, { width = 100 } = {}) {
  // The parser messages quote the body, and the CLI sends an error message with usage analytics.
  if (kind === 'mermaid') {
    try {
      return frame({ lines: drawDiagram(body.replace(CONTROL_BUT_LINES, ''), width - 4) });
    } catch {
      throw new Error('This mermaid block cannot be drawn: check its first line (e.g. "flowchart LR") and its syntax');
    }
  }
  const spec = parseBlock(body, (_, v) => (typeof v === 'string' ? v.replace(CONTROL, (c) => (/\s/.test(c) ? ' ' : '')) : v));
  if (kind === 'row') {
    const items = Array.isArray(spec) ? spec : spec?.items;
    if (!Array.isArray(items) || items.length === 0) throw new Error('A row needs a non-empty array of items');
    const room = Math.floor(width / items.length) - 1;
    return layout(items.flatMap((item) => itemBlocks(item, room)), width);
  }
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('A chart is one JSON object');
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
