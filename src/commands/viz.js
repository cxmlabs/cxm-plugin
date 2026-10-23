// `cxm viz <chart|cube-chart|row|mermaid> <body|file|->`: prints one block as text, for an agent to paste in a code block.
import { existsSync, readFileSync } from 'node:fs';
import { requireSession } from '../lib/config.js';
import { cubeLoad } from '../lib/http.js';
import { ansi, draw, plain } from '../lib/viz.js';

const KINDS = ['chart', 'cube-chart', 'row', 'mermaid'];

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function readInput(arg) {
  if (arg === '-') return readFileSync(0, 'utf8');
  if (existsSync(arg)) return readFileSync(arg, 'utf8');
  if (/\.(json|mmd)$/.test(arg)) throw new Error(`No such file: ${arg}`);
  return arg;
}

// A cube-chart names a query instead of rows; run it once, then draw it as a chart.
async function withRows(kind, body) {
  if (kind !== 'chart' && kind !== 'cube-chart') return body;
  const spec = JSON.parse(body);
  if (!spec?.query || spec.data) return body;
  const data = await cubeLoad(await requireSession(), spec.query);
  return JSON.stringify({ ...spec, data });
}

export async function viz(argv) {
  const [kind, ...rest] = argv;
  const arg = rest.find((a, i) => (a === '-' || !a.startsWith('--')) && rest[i - 1] !== '--width');
  if (!KINDS.includes(kind) || !arg) throw new Error(`viz needs a kind and a body, e.g. cxm viz chart '<json>' (kinds: ${KINDS.join(', ')}; body: inline, a file, or - for stdin)`);
  const body = await withRows(kind, readInput(arg));
  // The reply renderer runs the query here, with the session, and draws the rows itself.
  if (argv.includes('--rows')) return process.stdout.write(body);
  const width = argv.includes('--width') ? Number(flag(argv, '--width')) : process.stdout.columns || 100;
  if (!(width >= 20)) throw new Error('--width needs a number of columns, 20 or more');
  const lines = draw(kind, body, { width });
  console.log(argv.includes('--color') ? ansi(lines) : plain(lines));
}
