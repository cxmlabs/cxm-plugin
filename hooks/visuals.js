// Claude Code only: draws the chart and diagram blocks of a reply in place, in color, and tells the
// agent it can write them. Without this module (Codex, an older Claude Code) the agent runs `cxm viz`.
// `h`, the element factory, is a global of the hooks module environment.
import { draw, needsRows, splitReply } from '../src/lib/viz.js';

const SECTION = {
  id: 'cxm-agent-plugin:visuals',
  scope: 'session',
  text: 'CXM rich visuals are on: write a CXM chart, cube-chart or mermaid block as a fenced block in the reply, and it is drawn in place. Do not run `cxm viz`.',
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

const style = (fg, bg, bold) => ({ ...(fg && { color: fg }), ...(bg && { backgroundColor: bg }), ...(bold && { bold: true }) });
const raw = (t, part, reason) => h(t.Markdown, { text: `${part.text}\n\n_Not drawn: ${reason}_` });

function block($, t, part, width) {
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
  );
}

export const register = (on) => {
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e);
    return e.surfaces.length ? { sections: [...result.sections, SECTION] } : result;
  });

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const parts = splitReply(e.props.text);
    if (!parts.some((p) => p.kind)) return next(e);
    const t = $.ui.resolve(e);
    const width = (e.viewport?.columns ?? 100) - 4;
    // A block that does not parse shows as written, with a note, so a bad block never hides the reply.
    const drawn = parts.map((p) => {
      if (!p.kind) return h(t.Markdown, { text: p.text });
      try {
        return block($, t, p, width);
      } catch (err) {
        return raw(t, p, err.message);
      }
    });
    return h(t.Box, { flexDirection: 'column' }, ...drawn);
  });
};
