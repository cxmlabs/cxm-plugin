import { requireSession } from '../lib/config.js';
import { queryShape } from '../lib/query-shape.js';
import { schemaView } from '../lib/datasets.js';
import { cubeLoad, cubeMeta, currentUser, orgApi } from '../lib/http.js';
import { emit } from '../lib/telemetry.js';

export async function whoami() {
  const config = await requireSession();
  const user = await currentUser(config);
  console.log(JSON.stringify({ organization: config.organizationId, user }, null, 2));
}

function getFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// Translates customer dataset names to cubes before the query, and cube-qualified keys back after.
// `--schema [dataset]` returns the schema instead of running a query.
export async function cube(argv) {
  const config = await requireSession();
  if (argv.includes('--schema')) return cubeSchema(config, getFlag(argv, '--schema'));
  const raw = getFlag(argv, '--query');
  if (!raw) throw new Error("analytics query requires a query, e.g. cxm analytics query '<json>' (or: cxm analytics schema [dataset])");
  const query = JSON.parse(raw);
  const timeoutFlag = getFlag(argv, '--timeout');
  const maxWaitMs = timeoutFlag ? Number(timeoutFlag) * 1000 : 150000;
  const rows = await cubeLoad(config, query, { maxWaitMs });
  console.log(JSON.stringify({ organization: config.organizationId, rows }, null, 2));
  // Which datasets were asked for and how complex the query was — the signal that tells us which
  // queries to promote into their own commands. Plus the empty-result rate: a query that returns
  // nothing is a common dead end (wrong grain/filter, no data for the window). Dataset names and
  // counts only — never a filter value, a row, or a result.
  await emit('plugin.analytics_query', { rows: rows.length, empty: rows.length === 0, ...queryShape(query) });
}

// `--schema` with no name returns every dataset and its field counts. With a name, exact or a
// case-insensitive substring, it returns that dataset's measures and dimensions with their types.
async function cubeSchema(config, name) {
  const cubes = await cubeMeta(config);
  console.log(JSON.stringify({ organization: config.organizationId, ...schemaView(cubes, name) }, null, 2));
}

// Thin passthrough for the organization REST API (actions / reachability).
// Raw escape hatch, kept out of USAGE: `cxm admin request PATCH /acxm/opportunities/<id> --body '…'`.
// Prefer a named verb (`cxm savings update`) when one covers the call.`
export async function api(argv) {
  const config = await requireSession();
  const method = (argv[0] || 'GET').toUpperCase();
  const path = argv[1];
  if (!path) throw new Error('admin request requires a path, e.g. cxm admin request GET /users/current');
  const bodyIdx = argv.indexOf('--body');
  const body = bodyIdx >= 0 && argv[bodyIdx + 1] ? JSON.parse(argv[bodyIdx + 1]) : undefined;
  const result = await orgApi(config, method, path, body);
  console.log(JSON.stringify({ organization: config.organizationId, body: result }, null, 2));
}
