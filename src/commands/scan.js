import { writeFileSync } from 'node:fs';
import { requireSession } from '../lib/config.js';
import { orgApi } from '../lib/http.js';
import { scanRepo } from '../lib/repo-scan.js';

function getFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// `cxm context scan` builds a local repo graph (terraform resources/modules + project markers, with
// best-effort reference edges) and prints it. `--push` sends it to CXM so the server graph can merge
// the current code state without waiting for the monthly crawl.
export async function scan(argv) {
  const root = getFlag(argv, '--dir') || process.cwd();
  const graph = scanRepo(root);
  const out = getFlag(argv, '--out');

  if (argv.includes('--push')) {
    const config = await requireSession();
    // Server ingest endpoint (repo-graph merge). Until it ships, this surfaces a clear 404 rather
    // than pretending success — see CLO-7426 backend.
    const result = await orgApi(config, 'POST', '/repo-graph/scan', graph);
    console.log(JSON.stringify({ organization: config.organizationId, pushed: graph.stats, result }, null, 2));
    return;
  }

  const payload = JSON.stringify(graph, null, 2);
  if (out) {
    writeFileSync(out, payload);
    console.error(`Wrote ${graph.stats.nodes} nodes, ${graph.stats.edges} edges (${graph.repo}) to ${out}`);
  } else {
    console.log(payload);
  }
}
