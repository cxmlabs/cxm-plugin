// `cxm viz <chart|cube-chart|row|mermaid> <body|file|->`: prints one block as text, for an agent to paste in a code block,
// or writes it out with --csv <file> (its rows) or --svg <file> (its drawing).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireSession } from '../lib/config.js';
import { cubeLoad } from '../lib/http.js';
import { toCsv, toSvg } from '../lib/export.js';
import { ansi, draw, needsRows, plain } from '../lib/viz.js';

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
  if (!needsRows(kind, body)) return body;
  // needsRows already parsed the body, so this parse cannot fail.
  const spec = JSON.parse(body);
  const data = await cubeLoad(await requireSession(), spec.query);
  return JSON.stringify({ ...spec, data });
}

export async function viz(argv) {
  const [kind, ...rest] = argv;
  const valued = ['--width', '--csv', '--svg'];
  const arg = rest.find((a, i) => (a === '-' || !a.startsWith('--')) && !valued.includes(rest[i - 1]));
  if (!KINDS.includes(kind) || !arg) throw new Error(`viz needs a kind and a body, e.g. cxm viz chart '<json>' (kinds: ${KINDS.join(', ')}; body: inline, a file, or - for stdin)`);
  const body = await withRows(kind, readInput(arg));
  // The reply renderer runs the query here, with the session, and draws the rows itself.
  if (argv.includes('--rows')) return process.stdout.write(body);
  const width = argv.includes('--width') ? Number(flag(argv, '--width')) : process.stdout.columns || 100;
  if (!(width >= 20)) throw new Error('--width needs a number of columns, 20 or more');
  const lines = draw(kind, body, { width });
  const csv = flag(argv, '--csv');
  const svg = flag(argv, '--svg');
  if ((argv.includes('--csv') && !csv) || (argv.includes('--svg') && !svg)) throw new Error('--csv and --svg need a file path');
  if (csv) writeFileSync(csv, `${toCsv(kind, body)}\n`);
  if (svg) writeFileSync(svg, `${toSvg(lines)}\n`);
  for (const file of [csv, svg].filter(Boolean)) console.log(`Wrote ${resolve(file)}`);
  if (!csv && !svg) console.log(argv.includes('--color') ? ansi(lines) : plain(lines));
}
