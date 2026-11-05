// Claude Code only: draws the chart and diagram blocks of a reply in place, in color, and tells the
// agent it can write them. Without this module (Codex, an older Claude Code) the agent runs `cxm viz`.
// `h`, the element factory, is a global of the hooks module environment.
import { toCsv, toSvg } from '../src/lib/export.js';
import { draw, needsRows, splitReply } from '../src/lib/viz.js';

const SECTION = {
  id: 'cxm-agent-plugin:visuals',
  scope: 'session',
  text: 'CXM rich visuals are on: write a CXM chart, cube-chart, row or mermaid block as a fenced block in the reply, and it is drawn in place. Do not run `cxm viz` to draw it; run it only to export a block with --csv or --svg. Draw one picture for each part of the answer, next to its text and table. A picture never replaces the table. For 3 or more items to compare, draw a bar chart. For a series over time, draw a line chart, or a column chart for a few periods. For two periods, draw grouped bars and a diverging chart of the change. For 3 or more things that connect, draw a mermaid diagram. For an overview, draw a chart and a diagram. For one number or one lookup, draw nothing, unless the user asks for a picture.',
};

// A queried chart's rows, fetched once per block by the CLI with the user's session.
const rows = new Map();

function fetchRows($, kind, body) {
  const entry = { pending: true };
  rows.set(body, entry);
  $.process
    .run(['node', `${$.plugin.root}/bin/cxm.js`, 'viz', kind, '-', '--rows'], { stdin: body, timeoutMs: 160000 })
    .then((r) => rows.set(body, r.exitCode === 0 ? { body: r.stdout } : { error: r.stderr.trim().split('\n').pop() || `exit ${r.exitCode}` }))
    .catch((err) => rows.set(body, { error: err.message }))
    .finally(() => $.ui.invalidate('ui.render'));
  return entry;
}

// What an export button reads after its press, by block and button.
const pressed = new Map();

function exportButton($, t, key, label, act) {
  return h(
    t.Button,
    {
      key,
      onPress: async (press) => {
        pressed.set(key, await Promise.resolve(press).then(act).catch((err) => `Not exported: ${err.message}`));
        $.ui.invalidate('ui.render');
      },
    },
    pressed.get(key) ?? label,
  );
}

async function save($, name, text) {
  const path = `${(await $.session.cwd()).replace(/\/$/, '')}/${name}`;
  await $.fs.write(path, `${text}\n`);
  return `✓ Saved ${path}`;
}

// A block's file name, the same in every redraw and different for a different block.
const idOf = (part) => `cxm-${part.kind}-${[...part.body].reduce((x, c) => (Math.imul(x, 31) + c.charCodeAt(0)) >>> 0, 7).toString(36)}`;

function exportButtons($, t, part, body, lines, place) {
  const id = idOf(part);
  // The message and the place in it keep two copies of one block apart.
  const key = (button) => `${id}-${place}-${button}`;
  return h(
    t.Box,
    { flexDirection: 'row', gap: 1 },
    exportButton($, t, key('copy'), 'Copy CSV', async (press) => {
      const r = await $.ui.copy({ text: toCsv(part.kind, body), surface: press.surface });
      return r.isCopied ? '✓ Copied' : `Not copied: ${r.reason}`;
    }),
    exportButton($, t, key('csv'), 'Save CSV', () => save($, `${id}.csv`, toCsv(part.kind, body))),
    exportButton($, t, key('svg'), 'Save SVG', () => save($, `${id}.svg`, toSvg(lines))),
  );
}

const style = (fg, bg, bold) => ({ ...(fg && { color: fg }), ...(bg && { backgroundColor: bg }), ...(bold && { bold: true }) });
const raw = (t, part, reason) => h(t.Markdown, { text: `${part.text}\n\n_Not drawn: ${reason}_` });

function block($, t, part, width, place) {
  let body = part.body;
  if (needsRows(part.kind, body)) {
    const got = rows.get(body) ?? fetchRows($, part.kind, body);
    if (got.pending) return h(t.Text, { dimColor: true }, 'Running the chart query…');
    if (got.error) return raw(t, part, got.error);
    body = got.body;
  }
  const lines = draw(part.kind, body, { width });
  return h(
    t.Box,
    { flexDirection: 'column', alignItems: 'center' },
    h(t.Box, { flexDirection: 'column' }, ...lines.map((runs) => h(t.Box, {}, ...runs.filter(([s]) => s).map(([s, fg, bg, bold]) => h(t.Text, style(fg, bg, bold), s))))),
    exportButtons($, t, part, body, lines, place),
  );
}

export const register = (on, options) => {
  // Off: no section, so the agent prints with `cxm viz`, and blocks show as written.
  if (options.rich_visuals === false) return;
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e);
    return e.surfaces.length ? { sections: [...result.sections, SECTION] } : result;
  });

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    // A message with no text yet renders as Claude Code draws it.
    const parts = splitReply(typeof e.props?.text === 'string' ? e.props.text : '');
    if (!parts.some((p) => p.kind)) return next(e);
    const t = $.ui.resolve(e);
    const width = (e.viewport?.columns ?? 100) - 4;
    // A block that does not parse shows as written, with a note, so a bad block never hides the reply.
    const drawn = parts.map((p, n) => {
      if (!p.kind) return h(t.Markdown, { text: p.text });
      try {
        return block($, t, p, width, `${e.requestId}-${n}`);
      } catch (err) {
        return raw(t, p, err.message);
      }
    });
    return h(t.Box, { flexDirection: 'column' }, ...drawn);
  });
};
