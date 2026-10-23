// Draws a mermaid flowchart in box-drawing characters, each node tinted by its service family.
// The layout is beautiful-mermaid's text renderer, vendored; this file only colors and fits it.
import { renderMermaidASCII } from '../vendor/mermaid-ascii.js';

const BG = '#0F172A';
const FAMILY = [
  [/key ?vault|entra|active directory|\biam\b|kms|secrets?|firewall|waf|defender|guardduty|shield/i, '#EAB308'],
  [/rds|aurora|postgres|mysql|dynamo|database|\bdb\b|azure sql|sql database|cloud sql|cosmos|redshift|bigquery|spanner|firestore|bigtable/i, '#5B8DEF'],
  [/s3|bucket|lake|storage|efs|glacier|blob|gcs|filestore/i, '#10B981'],
  [/cache|redis|memcached|elasticache/i, '#EF4444'],
  [/vpc|vnet|subnet|nat|gateway|load.balanc|\b[an]lb\b|elb|cloudfront|front ?door|route ?53|dns|transit|private ?endpoint|expressroute|interconnect|cloud cdn|nsg|virtual.network/i, '#A78BFA'],
  [/ecs|eks|aks|gke|ec2|cloud run|compute engine|app engine|\bvm\b|virtual machine|lambda|functions?|fargate|app service|container apps?|api|service|worker|compute/i, '#F59E0B'],
  [/user|client|browser|internet/i, '#E2E8F0'],
];
const ARROW = /[►◄▲▼]/;
const LINE = /[─│├┤┬┴┼┌┐└┘╭╮╰╯]/;
const tint = (hex, pct) =>
  '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * pct + parseInt(BG.slice(i, i + 2), 16) * (1 - pct)).toString(16).padStart(2, '0')).join('');

// Dex's cloud diagrams draw icon nodes, `id@{ img: ".../aws/rds.svg", label: "…" }`. The text
// renderer has no icons, so each becomes a labelled box and its icon name picks the color.
export function fromIcons(src) {
  const icons = {};
  const text = src.replace(/(\w+)@\{([^}]*)\}/g, (_, id, attrs) => {
    icons[id] = (attrs.match(/img:\s*"[^"]*\/([\w-]+)\/([\w.-]+)\.svg"/) ?? []).slice(1).join(' ');
    return `${id}["${(attrs.match(/label:\s*"([^"]*)"/) ?? [])[1] ?? id}"]`;
  });
  return { text, icons };
}

const NODE = /(\w+)\s*[[({]+"?([^"\])}]+?)"?[\])}]+(?::::(\w+))?/g;
const EDGE = /(\w+)(?:\s*[[({]+[^\])}\n]*[\])}]+)?\s*(?:-{2,}|={2,}|-\.+-)>?\s*(?:\|"?([^|"]*)"?\|)?\s*(\w+)/g;

function labelsOf(src) {
  const labels = {};
  const nodeClass = {};
  for (const m of src.matchAll(NODE)) {
    labels[m[1]] ??= m[2].trim();
    if (m[3]) nodeClass[m[1]] = m[3];
  }
  for (const m of src.matchAll(/^\s*class\s+([\w,]+)\s+(\w+)/gm)) for (const id of m[1].split(',')) nodeClass[id] = m[2];
  const classes = {};
  for (const m of src.matchAll(/classDef\s+(\w+)\s+([^\n]+)/g)) classes[m[1]] = (m[2].match(/(?:stroke|fill|color):\s*(#[0-9a-fA-F]{6})/) ?? [])[1];
  return { labels, hue: (id, hint = '') => classes[nodeClass[id]] ?? FAMILY.find(([re]) => re.test(`${labels[id] ?? ''} ${hint} ${id}`))?.[1] };
}

// The box whose left wall is the first vertical left of (r, c) with real corners at both ends.
function findBox(grid, r, c, width) {
  const at = (y, x) => grid[y]?.[x] ?? ' ';
  const wall = (ch) => /[│├┤┼]/.test(ch);
  for (let L = c - 1; L >= 0; L--) {
    if (!wall(at(r, L))) continue;
    let top = r;
    while (top > 0 && wall(at(top - 1, L))) top--;
    let bot = r;
    while (bot < grid.length - 1 && wall(at(bot + 1, L))) bot++;
    top -= 1;
    bot += 1;
    if (!/[┌╭]/.test(at(top, L)) || !/[└╰]/.test(at(bot, L))) continue;
    let R = L + 1;
    while (R < grid[top].length && !/[┐╮]/.test(at(top, R))) R++;
    if (R < c + width || !/[┘╯]/.test(at(bot, R))) continue;
    return { top, bot, L, R };
  }
  return null;
}

function colorGrid(text, src, icons) {
  const grid = text.split('\n').map((l) => [...l]);
  const fg = grid.map((row) => row.map((ch) => (ARROW.test(ch) ? '#5B8DEF' : LINE.test(ch) ? '#475569' : '#E2E8F0')));
  const bg = grid.map((row) => row.map(() => ''));
  const { labels, hue } = labelsOf(src);
  const groups = new Set([...src.matchAll(/subgraph\s+(\w+)/g)].map((m) => m[1]));
  // Groups first, so a node inside one tints over the group's faint fill.
  const order = Object.entries(labels).sort(([a], [b]) => Number(groups.has(b)) - Number(groups.has(a)));
  for (const [id, label] of order) {
    const color = hue(id, icons[id]);
    if (!color) continue;
    const group = groups.has(id);
    for (let r = 0; r < grid.length; r++) {
      const c = grid[r].join('').indexOf(label);
      const box = c < 0 ? null : findBox(grid, r, c, label.length);
      if (!box) continue;
      const { top, bot, L, R } = box;
      for (let y = top; y <= bot; y++) {
        for (let x = L; x <= R; x++) {
          const border = y === top || y === bot || x === L || x === R;
          if ((!group || border) && grid[y][x] !== ' ' && !ARROW.test(grid[y][x])) fg[y][x] = color;
          if (!border) bg[y][x] = tint(color, group ? 0.08 : 0.28);
        }
      }
      for (let x = c; x < c + label.length; x++) fg[r][x] = '#F8FAFC';
      break;
    }
  }
  // The renderer draws the spaces of an edge label as line characters; put the spaces back.
  for (const m of src.matchAll(/--+>?\|"?([^|"]+)"?\|/g)) {
    const label = m[1].trim();
    const drawn = label.replace(/ /g, '─');
    grid.forEach((row, r) => {
      const c = row.join('').indexOf(drawn);
      if (c >= 0) for (let x = 0; x < label.length; x++) [grid[r][c + x], fg[r][c + x]] = [label[x], '#94A3B8'];
    });
  }
  return grid.map((row, y) => {
    const runs = [];
    row.forEach((ch, x) => {
      const last = runs.at(-1);
      if (last && last[1] === fg[y][x] && last[2] === bg[y][x]) last[0] += ch;
      else runs.push([ch, fg[y][x], bg[y][x]]);
    });
    return runs;
  });
}

// The drawing without its blank border rows and the empty columns on its right.
function trim(lines) {
  const text = lines.map((r) => r.map(([t]) => t).join(''));
  const width = Math.max(...text.map((l) => [...l.trimEnd()].length));
  const keep = text.map((l) => l.trim() !== '');
  return lines.slice(keep.indexOf(true), keep.lastIndexOf(true) + 1).map((runs) => {
    let room = width;
    return runs.flatMap(([t, fg, bg]) => {
      const part = [...t].slice(0, Math.max(0, room)).join('');
      room -= [...part].length;
      return part ? [[part, fg, bg]] : [];
    });
  });
}

// The fallback when no layout fits the width: one line per edge.
function edgeList(src, icons) {
  const { labels, hue } = labelsOf(src);
  const name = (id) => [labels[id] ?? id, hue(id, icons[id]) ?? '#E2E8F0'];
  return [...src.replace(/^\s*(?:flowchart|graph)\b.*$/m, '').matchAll(EDGE)].map(([, a, label, b]) => [
    name(a),
    [' → ', '#5B8DEF'],
    name(b),
    ...(label ? [[` (${label.trim()})`, '#94A3B8']] : []),
  ]);
}

const visible = (lines) => Math.max(0, ...lines.map((runs) => runs.reduce((n, [t]) => n + [...t].length, 0)));

// Tries the given direction, then tighter spacing, then top-to-bottom, then the edge list.
export function drawDiagram(source, width = 100) {
  const { text: src, icons } = fromIcons(source);
  const header = src.match(/^\s*(flowchart|graph)\s+(LR|RL)\b/m);
  const tb = header && src.replace(header[0], header[0].replace(/(LR|RL)$/, 'TB'));
  const tries = [[src, 3], [src, 1], ...(tb ? [[tb, 3], [tb, 1]] : [])];
  for (const [text, paddingX] of tries) {
    const lines = trim(colorGrid(renderMermaidASCII(text, { colorMode: 'none', paddingX, paddingY: 1, boxBorderPadding: 1 }), text, icons));
    if (visible(lines) <= width) return lines;
  }
  return edgeList(src, icons);
}
