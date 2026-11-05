// A drawn block taken out of the conversation: its rows as CSV, its drawing as an SVG image.
// It imports no Node module, so the reply renderer can use it too.
import { parseFlowchart } from './diagram.js';
import { parseBlock } from './viz.js';

// A cell a spreadsheet would run as a formula starts with one of these; a quote makes it text.
const FORMULA = /^[=+\-@\t\r]/;
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
  const safe = FORMULA.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const csvOf = (header, rows) => [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');

// The keys of the rows, the chart's own keys first, in the order they appear.
function chartCsv(spec) {
  const rows = Array.isArray(spec.data) ? spec.data : [];
  const keys = [...new Set([spec.x, spec.series, spec.y, ...rows.flatMap((r) => Object.keys(r ?? {}))].filter(Boolean))];
  return csvOf(keys, rows.map((r) => keys.map((k) => r?.[k])));
}

const itemCsv = (item) => (item?.type === 'table' ? csvOf(item.columns ?? [], item.rows ?? []) : item?.type === 'note' || item?.type === 'markdown' ? '' : chartCsv(item ?? {}));

// The block's data as CSV: a chart's rows, each item of a row with a blank line between, a diagram's links.
export function toCsv(kind, body) {
  if (kind === 'mermaid') {
    const model = parseFlowchart(body);
    const name = (id) => model.nodes.get(id)?.label ?? model.groups.get(id)?.title ?? id;
    return csvOf(['source', 'target', 'label'], model.edges.map((e) => [name(e.from), name(e.to), e.label ?? '']));
  }
  const spec = parseBlock(body);
  if (kind === 'row') return (Array.isArray(spec) ? spec : spec?.items ?? []).map(itemCsv).filter(Boolean).join('\n\n');
  return chartCsv(spec ?? {});
}

const CELL_W = 8.4;
const CELL_H = 18;
const PAD = 12;
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The drawing as an SVG: one monospace text line per row, with the run colors and fills.
export function toSvg(lines, { background = '#0F172A', foreground = '#E2E8F0' } = {}) {
  const cols = Math.max(1, ...lines.map((runs) => runs.reduce((n, [t]) => n + [...t].length, 0)));
  const width = Math.ceil(cols * CELL_W + 2 * PAD);
  const height = lines.length * CELL_H + 2 * PAD;
  const fills = [];
  const texts = lines.map((runs, row) => {
    const y = PAD + row * CELL_H;
    let col = 0;
    const spans = runs.map(([t, fg, bg, bold]) => {
      const n = [...t].length;
      if (bg) fills.push(`<rect x="${(PAD + col * CELL_W).toFixed(1)}" y="${y}" width="${(n * CELL_W).toFixed(1)}" height="${CELL_H}" fill="${bg}" shape-rendering="crispEdges"/>`);
      col += n;
      return `<tspan fill="${fg || foreground}"${bold ? ' font-weight="bold"' : ''}>${escape(t)}</tspan>`;
    });
    return `<text x="${PAD}" y="${y + CELL_H * 0.75}" xml:space="preserve">${spans.join('')}</text>`;
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="14">`,
    `<rect width="100%" height="100%" fill="${background}"/>`,
    ...fills,
    ...texts,
    '</svg>',
  ].join('\n');
}
