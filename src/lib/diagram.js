// Colors the vendored mermaid text renderer's flowchart by service family, and fits it to the width.
import { renderMermaidASCII } from '../vendor/mermaid-ascii.js';

const BG = '#0F172A';
// Service families: a service name (`ecs`, `sqs`) wins over a generic word (`image`, `queue`), so
// "ECS services using the image" is compute. Within each pass, the first family that matches wins.
const FAMILY = [
  [/key ?vault|entra|active directory|azure ad\b|\biam\b|kms|secrets? manager|firewall|\bwaf\b|defender|guardduty|shield|\bsso\b|cognito|okta/i, /secrets?|identity|\bauth|security/i, '#EAB308'],
  [/\brds\b|aurora|postgres|mysql|dynamo|azure sql|cloud sql|cosmos|redshift|bigquery|spanner|firestore|bigtable/i, /database|\bdb\b|sql/i, '#5B8DEF'],
  [/\bs3\b|\befs\b|glacier|blob|\bgcs\b|filestore/i, /bucket|lake|storage/i, '#10B981'],
  [/redis|memcached|elasticache/i, /cache/i, '#EF4444'],
  [/\bsns\b|\bsqs\b|eventbridge|event ?grid|event ?hubs?|service ?bus|pub\/?sub|kinesis|kafka|\bmsk\b/i, /queue|topic|\bstream|webhook|notification|\bevents?\b/i, '#EC4899'],
  [/github|gitlab|bitbucket|\becr\b|\bacr\b|codepipeline|codebuild|cloud ?build|azure ?devops|terraform|argo ?cd|\bhelm\b/i, /registry|pipeline|\bci\b|deploy|image|iac/i, '#14B8A6'],
  [/cloudwatch|grafana|datadog|prometheus|sentry|posthog|x-?ray/i, /\blog(s|ging)?\b|monitor|metric|alarm|trace|observab/i, '#84CC16'],
  [/\bglue\b|\bemr\b|\bdbt\b|airflow|\bspark\b|databricks|cube ?js|synapse/i, /warehouse|analytics|\betl\b/i, '#06B6D4'],
  [/\baws account|subscription|management group|resource group|landing zone|\bou\b/i, /\baccount|tenant|organi[sz]ation|\borg\b|project/i, '#818CF8'],
  [/\bvpc\b|vnet|subnet|\bnat\b|load.balanc|\b[an]lb\b|\belb\b|cloudfront|front ?door|route ?53|transit|internet gateway|private ?endpoint|expressroute|interconnect|cloud cdn|\bnsg\b|api gateway/i, /gateway|\bdns\b|\bcdn\b|ingress|vpn|network/i, '#A78BFA'],
  [/\becs\b|\beks\b|\baks\b|\bgke\b|\bec2\b|cloud run|compute engine|app engine|lambda|fargate|app service|container apps?|kubernetes|\bk8s\b|azure functions?|cloud functions?/i, /\bvm\b|virtual machine|function|\bapi\b|service|worker|compute|cluster|\btask|\bapp\b|\bservers?\b/i, '#F59E0B'],
  [/internet/i, /user|client|browser|customer|operator|developer|team/i, '#E2E8F0'],
];
// The family color a label names, or undefined when it names none.
export const familyOf = (text) => (FAMILY.find(([strong]) => strong.test(text)) ?? FAMILY.find(([, weak]) => weak.test(text)))?.[2];
const ARROW = /[►◄▲▼]/;
const LINE = /[─│├┤┬┴┼┌┐└┘╭╮╰╯]/;
const tint = (hex, pct) =>
  '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * pct + parseInt(BG.slice(i, i + 2), 16) * (1 - pct)).toString(16).padStart(2, '0')).join('');

// The text renderer has no icons: each `id@{ img, label }` node becomes a labelled box, colored by its label, icon name or id.
function fromIcons(src) {
  const icons = {};
  const text = src.replace(/(\w+)@\{([^}]*)\}/g, (_, id, attrs) => {
    icons[id] = (attrs.match(/img:\s*"[^"]*\/([\w-]+)\/([\w.-]+)\.svg"/) ?? []).slice(1).join(' ');
    return `${id}["${(attrs.match(/label:\s*"([^"]*)"/) ?? [])[1] ?? id}"]`;
  });
  return { text, icons };
}

const NODE = /(\w+)\s*[[({]+"?([^"\])}]+?)"?[\])}]+(?::::(\w+))?/g;

function labelsOf(src) {
  const labels = {};
  const nodeClass = {};
  for (const m of src.matchAll(NODE)) {
    labels[m[1]] ??= m[2].trim();
    if (m[3]) nodeClass[m[1]] = m[3];
  }
  for (const m of src.matchAll(/^\s*class\s+([\w,]+)\s+(\w+)/gm)) for (const id of m[1].split(',')) nodeClass[id] = m[2];
  const classes = {};
  for (const m of src.matchAll(/classDef\s+(\w+)\s+([^\n]+)/g)) {
    const hex = m[2].match(/(?:stroke|fill|color):\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/)?.[1];
    if (hex) classes[m[1]] = `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
  }
  return { labels, hue: (id, hint = '') => classes[nodeClass[id]] ?? familyOf(`${labels[id] ?? ''} ${hint} ${id}`) };
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

// Where `label` fills a box row on its own, so `API` never matches inside `API Gateway`.
function labelAt(line, label) {
  for (let c = line.indexOf(label); c >= 0; c = line.indexOf(label, c + 1)) {
    if (/[│├┤┼]$/.test(line.slice(0, c).trimEnd()) && /^[│├┤┼]/.test(line.slice(c + label.length).trimStart())) return c;
  }
  return -1;
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
      const c = labelAt(grid[r].join(''), label);
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

// Shapes the text renderer draws, by their opening token; any other shape becomes a box.
const SHAPES = [['[(', ')]'], ['([', '])'], ['((', '))'], ['[[', ']]'], ['[', ']'], ['(', ')'], ['{{', '}}'], ['{', '}'], ['>', ']']];
const DRAWN = new Set(['[(', '([', '((', '[', '(']);
const NODE_MAX = 32;
const EDGE_MAX = 24;
const TITLE_MAX = 40;
const LIST_MAX = 64;
const cut = (s, max) => ([...s].length > max ? `${[...s].slice(0, max - 1).join('')}…` : s);
// One plain line: the renderer overlays a two-line label, and a quote ends the label it is written in.
const clean = (s, max) => cut(s.replace(/<br\s*\/?>/gi, ' · ').replace(/<[^>]*>/g, '').replace(/"/g, "'").replace(/\s+/g, ' ').trim(), max);

// Reads one node reference at `at`: an id, then an optional shape that holds its label.
function readNode(line, at) {
  const id = line.slice(at).match(/^([A-Za-z0-9_][\w-]*)/)?.[1];
  if (!id) return null;
  let i = at + id.length;
  const shape = SHAPES.find(([open]) => line.startsWith(open, i));
  if (!shape) return { id, end: i };
  const [open, close] = shape;
  i += open.length;
  let label;
  if (line[i] === '"') {
    const q = line.indexOf('"', i + 1);
    label = line.slice(i + 1, q < 0 ? undefined : q);
    i = q < 0 ? line.length : q + 1;
    const c = line.indexOf(close, i);
    i = c < 0 ? line.length : c + close.length;
  } else {
    const c = line.indexOf(close, i);
    label = line.slice(i, c < 0 ? undefined : c);
    i = c < 0 ? line.length : c + close.length;
  }
  const cls = line.slice(i).match(/^:::(\w+)/);
  return { id, label, open, close, cls: cls?.[1], end: i + (cls ? cls[0].length : 0) };
}

const OP = /^\s*<?(?:-{2,}|={2,}|-\.+-?|~~~)[>ox]?\s*/;
const TEXT_OP = /^\s*(?:--|==|-\.)\s+(.+?)\s+(?:-{2,}|={2,}|\.-)[>ox]?\s*/;

// The flowchart as a model: nodes (label, shape, group), nested groups, edges, class lines.
export function parseFlowchart(src) {
  const model = { dir: 'LR', nodes: new Map(), groups: new Map(), edges: [], classLines: [], order: [] };
  const stack = [];
  const touch = (n) => {
    const node = model.nodes.get(n.id) ?? { id: n.id, group: stack.at(-1) ?? null };
    if (n.label !== undefined && node.label === undefined) Object.assign(node, { label: n.label, open: n.open, close: n.close });
    if (n.cls) node.cls = n.cls;
    if (!model.nodes.has(n.id) && !model.groups.has(n.id)) {
      model.nodes.set(n.id, node);
      (node.group ? model.groups.get(node.group).items : model.order).push({ node: n.id });
    }
  };
  for (const raw of src.replace(/%%.*$/gm, '').split('\n')) {
    for (const stmt of raw.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
      const line = stmt.trim();
      if (!line) continue;
      const head = line.match(/^(?:flowchart|graph)\s+(\w+)/);
      if (head) { model.dir = head[1].toUpperCase(); continue; }
      const sub = line.match(/^subgraph\s+(.+)$/);
      if (sub) {
        const ref = readNode(sub[1], 0);
        const id = ref?.end === sub[1].trim().length || ref?.label !== undefined ? ref.id : `g${model.groups.size}`;
        const title = ref?.label ?? (ref?.end === sub[1].trim().length ? ref.id : sub[1].trim());
        const group = { id, title, parent: stack.at(-1) ?? null, items: [] };
        model.groups.set(id, group);
        (group.parent ? model.groups.get(group.parent).items : model.order).push({ group: id });
        stack.push(id);
        continue;
      }
      if (/^end\b/.test(line)) { stack.pop(); continue; }
      if (/^(classDef|class)\s/.test(line)) { model.classLines.push(line); continue; }
      if (/^(style|linkStyle|click|direction)\s/.test(line)) continue;
      // A chain of node groups joined by links: `A & B -->|x| C --> D`.
      let at = 0;
      let left = null;
      while (at < line.length) {
        const refs = [];
        for (;;) {
          const n = readNode(line, at + (line.slice(at).match(/^\s*/)[0].length));
          if (!n) break;
          refs.push(n);
          at = n.end;
          const amp = line.slice(at).match(/^\s*&\s*/);
          if (!amp) break;
          at += amp[0].length;
        }
        if (!refs.length) break;
        refs.forEach(touch);
        if (left) for (const a of left.refs) for (const b of refs) model.edges.push({ from: a.id, to: b.id, label: left.label });
        const rest = line.slice(at);
        const text = rest.match(TEXT_OP);
        const op = text ?? rest.match(OP);
        if (!op) break;
        at += op[0].length;
        let label = text?.[1];
        const pipe = line.slice(at).match(/^\|([^|]*)\|\s*/);
        if (pipe) { label = pipe[1]; at += pipe[0].length; }
        left = { refs, label: label?.replace(/^"|"$/g, '') };
      }
    }
  }
  return model;
}

// A link to a group goes to the group's first node, as the reader means it.
function firstNode(model, id) {
  const group = model.groups.get(id);
  if (!group) return id;
  for (const item of group.items) {
    const found = item.node ?? firstNode(model, item.group);
    if (found && model.nodes.has(found)) return found;
  }
  return null;
}

// The model written back as the plain flowchart the text renderer draws best.
function emit(model, dir) {
  const out = [`flowchart ${dir}`];
  const node = (n) => {
    const [open, close] = DRAWN.has(n.open) ? [n.open, n.close] : ['[', ']'];
    // A space each side keeps the text off the walls of a box drawn with no inner padding.
    return `${n.id}${open}" ${clean(n.label ?? n.id, NODE_MAX)} "${close}${n.cls ? `:::${n.cls}` : ''}`;
  };
  const write = (items, depth) => {
    for (const item of items) {
      if (item.node) out.push(`${'  '.repeat(depth)}${node(model.nodes.get(item.node))}`);
      else {
        const g = model.groups.get(item.group);
        out.push(`${'  '.repeat(depth)}subgraph ${g.id}["${clean(g.title, TITLE_MAX)}"]`);
        write(g.items, depth + 1);
        out.push(`${'  '.repeat(depth)}end`);
      }
    }
  };
  write(model.order, 1);
  for (const e of edges(model)) out.push(`  ${e.from} -->${e.label ? `|"${clean(e.label, EDGE_MAX)}"|` : ''} ${e.to}`);
  return [...out, ...model.classLines].join('\n');
}

const edges = (model) =>
  model.edges.map((e) => ({ ...e, from: firstNode(model, e.from), to: firstNode(model, e.to) })).filter((e) => e.from && e.to && e.from !== e.to);

const plainOf = (lines) => lines.map((runs) => runs.map(([t]) => t).join(''));

// A drawing is kept only when every node label and group title reads whole in it.
function intact(lines, model) {
  const text = plainOf(lines).join('\n');
  const names = [...[...model.nodes.values()].map((n) => clean(n.label ?? n.id, NODE_MAX)), ...[...model.groups.values()].map((g) => clean(g.title, TITLE_MAX))];
  return names.every((name) => text.includes(name));
}

// The fallback: each group a frame that lists its nodes, then every link with its label.
function groupedView(model, icons, width) {
  const { hue } = labelsOf(emit(model, model.dir));
  // A list has room for the whole label, and a link to a group names the group.
  const nameRun = (id) => {
    const g = model.groups.get(id);
    if (g) return [`${clean(g.title, LIST_MAX)} (group)`, hue(g.id) ?? '#94A3B8'];
    return [clean(model.nodes.get(id)?.label ?? id, LIST_MAX), hue(id, icons[id]) ?? '#E2E8F0'];
  };
  const lines = [];
  const block = (items, depth, title, color) => {
    const pad = '  '.repeat(depth);
    if (title) lines.push([[pad], ['▌ ', color], [title, '#F8FAFC', '', true]]);
    for (const item of items) {
      if (item.node) lines.push([[`${pad}${title ? '  ' : ''}`], ['■ ', nameRun(item.node)[1]], [nameRun(item.node)[0]]]);
      else {
        const g = model.groups.get(item.group);
        block(g.items, depth + (title ? 1 : 0), clean(g.title, TITLE_MAX), hue(g.id) ?? '#64748B');
      }
    }
  };
  block(model.order, 0, '', '');
  const links = model.edges.filter((e) => e.from !== e.to);
  if (links.length) {
    lines.push([], [['Links', '#94A3B8', '', true]]);
    for (const e of links) lines.push([['  '], nameRun(e.from), [' → ', '#5B8DEF'], nameRun(e.to), ...(e.label ? [[`  ${clean(e.label, EDGE_MAX)}`, '#94A3B8']] : [])]);
  }
  return lines.map((runs) => {
    let room = width;
    return runs.map(([t, ...rest]) => {
      const part = [...t].slice(0, Math.max(0, room)).join('');
      room -= [...part].length;
      return [part, ...rest];
    });
  });
}

const visible = (lines) => Math.max(0, ...lines.map((runs) => runs.reduce((n, [t]) => n + [...t].length, 0)));

// The best drawing of a model that fits the width with every label whole, else null.
function drawWhole(model, icons, width) {
  const dirs = /^(LR|RL)$/.test(model.dir) ? [model.dir, 'TB'] : [model.dir === 'TD' ? 'TB' : model.dir];
  for (const dir of dirs) {
    const src = emit(model, dir);
    for (const paddingX of [3, 1]) {
      let text;
      // The vendored layout throws on some link routes; that layout is skipped like one that does not fit.
      try {
        text = renderMermaidASCII(src, { colorMode: 'none', paddingX, paddingY: 1, boxBorderPadding: 0 });
      } catch {
        continue;
      }
      const lines = trim(colorGrid(text, src, icons));
      if (visible(lines) <= width && intact(lines, model)) return lines;
    }
  }
  return null;
}

// One group's own nodes and the links between them, as a model with no group.
function sectionModel(model, nodeIds) {
  const ids = new Set(nodeIds);
  return {
    ...model,
    groups: new Map(),
    nodes: new Map(nodeIds.map((id) => [id, { ...model.nodes.get(id), group: null }])),
    order: nodeIds.map((id) => ({ node: id })),
    edges: edges(model).filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

const pathOf = (model, id) => {
  const names = [];
  for (let g = model.groups.get(id); g; g = model.groups.get(g.parent)) names.unshift(clean(g.title, TITLE_MAX));
  return names.join(' › ');
};

// A rounded frame titled in its group's color, padded to `height`.
function sectionFrame(title, color, lines, height = 0) {
  const inner = Math.max(visible(lines), [...title].length + 2);
  const body = lines.map((runs) => [...runs, [' '.repeat(inner - visible([runs]))]]);
  while (body.length < height - 2) body.push([[' '.repeat(inner)]]);
  const top = title ? `─ ${title} ${'─'.repeat(Math.max(0, inner - [...title].length - 1))}` : '─'.repeat(inner + 2);
  return [
    [['╭', color], [title ? '─ ' : '', color], [title, '#F8FAFC', '', true], [title ? ` ${'─'.repeat(Math.max(0, inner - [...title].length - 1))}` : top, color], ['╮', color]],
    ...body.map((runs) => [['│ ', color], ...runs, [' │', color]]),
    [[`╰${'─'.repeat(inner + 2)}╯`, color]],
  ];
}

// Several groups: each group that holds nodes is drawn on its own, then the links between groups.
function drawSections(model, icons, width) {
  const { hue } = labelsOf(emit(model, model.dir));
  const sections = [];
  const loose = model.order.filter((i) => i.node).map((i) => i.node);
  if (loose.length) sections.push({ title: '', color: '#475569', ids: loose });
  for (const g of model.groups.values()) {
    const ids = g.items.filter((i) => i.node).map((i) => i.node);
    if (ids.length) sections.push({ title: cut(pathOf(model, g.id), width - 8), color: hue(g.id) ?? '#64748B', ids });
  }
  const framed = [];
  for (const sec of sections) {
    const sub = sectionModel(model, sec.ids);
    const lines = drawWhole(sub, icons, width - 4) ?? groupedView(sub, icons, width - 4);
    framed.push({ ...sec, lines });
  }
  // Frames side by side while they fit, level at the bottom.
  const out = [];
  let row = [];
  const flush = () => {
    if (!row.length) return;
    const height = Math.max(...row.map((f) => f.lines.length)) + 2;
    const frames = row.map((f) => sectionFrame(f.title, f.color, f.lines, height));
    for (let r = 0; r < height; r++) out.push(frames.flatMap((f, i) => [...(i ? [[' ']] : []), ...f[r]]));
    row = [];
  };
  for (const f of framed) {
    const w = Math.max(visible(f.lines), [...f.title].length + 2) + 4;
    const used = row.reduce((n, x) => n + Math.max(visible(x.lines), [...x.title].length + 2) + 5, 0);
    if (row.length && used + w > width) flush();
    row.push(f);
  }
  flush();
  const section = new Map(sections.flatMap((sec, i) => sec.ids.map((id) => [id, i])));
  const across = model.edges.filter((e) => {
    const a = firstNode(model, e.from);
    const b = firstNode(model, e.to);
    return a && b && section.get(a) !== section.get(b);
  });
  if (across.length) {
    const links = groupedView({ ...model, order: [], edges: across }, icons, width);
    out.push([], [['Links between groups', '#94A3B8', '', true]], ...links.slice(2));
  }
  return out;
}

// Draws a flowchart that fits the width with every label whole: whole when it has at most one
// group, else group by group. A part that cannot be drawn shows as a list.
export function drawDiagram(source, width = 100) {
  const { text, icons } = fromIcons(source);
  const model = parseFlowchart(text);
  if (!model.nodes.size) throw new Error('no node');
  const nested = [...model.groups.values()].some((g) => g.parent);
  if (model.groups.size <= 1 && !nested) return drawWhole(model, icons, width) ?? groupedView(model, icons, width);
  return drawSections(model, icons, width);
}
