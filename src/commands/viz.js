// `cxm viz <chart|row|mermaid> '<body>' | <file> | -`: prints the drawing of one block as text, for an
// agent to paste into its reply in a code block. `--color` is for a person who runs it in a terminal.
import { existsSync, readFileSync } from 'node:fs';
import { requireSession } from '../lib/config.js';
import { cubeLoad } from '../lib/http.js';
import { ansi, draw, plain } from '../lib/viz.js';

const KINDS = ['chart', 'cube-chart', 'row', 'mermaid'];

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const readInput = (arg) => (arg === '-' ? readFileSync(0, 'utf8') : existsSync(arg) ? readFileSync(arg, 'utf8') : arg);

// A cube-chart names a query instead of rows; run it once, then draw it as a chart.
export async function withRows(kind, body) {
  if (kind !== 'chart' && kind !== 'cube-chart') return body;
  const spec = JSON.parse(body);
  if (!spec.query || spec.data) return body;
  const data = await cubeLoad(await requireSession(), spec.query, { maxWaitMs: 150000 });
  return JSON.stringify({ ...spec, data });
}

export async function viz(argv) {
  const [kind, arg] = argv;
  if (!KINDS.includes(kind) || !arg) throw new Error(`viz needs a kind and a body, e.g. cxm viz chart '<json>' (kinds: ${KINDS.join(', ')}; body: inline, a file, or - for stdin)`);
  const width = Number(flag(argv, '--width')) || process.stdout.columns || 100;
  const lines = draw(kind, await withRows(kind, readInput(arg)), { width });
  console.log(argv.includes('--color') ? ansi(lines) : plain(lines));
}
