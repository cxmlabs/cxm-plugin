// Build a lightweight local repo graph — the client half of `cxm context scan`. Deliberately shallow (regex,
// no HCL/terravision engine): it captures the nodes and edges CXM's server graph re-links against —
// terraform resources/modules/data plus project markers — so a customer can push their current code
// state without waiting for the monthly server crawl. Node ids match the server grammar
// REPO_ID:WORKSPACE_PATH:SUFFIX so an ingest can merge them.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.terraform', 'vendor', 'dist', 'build', '.venv', '__pycache__', '.next', '.cache']);

// Marker file → a project/build node type (matches the server's MarkerType intent).
const MARKERS = {
  'pyproject.toml': 'python',
  'requirements.txt': 'python',
  'package.json': 'node',
  'go.mod': 'go',
  'Cargo.toml': 'rust',
  'pom.xml': 'java',
  Dockerfile: 'docker',
};

// owner/repo from the git remote, or a stable fallback so ids stay valid off a checkout.
export function repoIdFor(rootDir) {
  try {
    const url = execFileSync('git', ['-C', rootDir, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim();
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch {
    /* not a git repo / no remote — fall through */
  }
  const base = rootDir.split(sep).filter(Boolean).pop() || 'repo';
  return `local/${base}`;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// resource "aws_x" "name" → address aws_x.name ; data "aws_x" "name" → data.aws_x.name ; module "n" → module.n
function terraformNodes(text, repo, relPath) {
  const nodes = [];
  const addrs = new Set();
  const add = (address, type) => {
    if (addrs.has(address)) return;
    addrs.add(address);
    nodes.push({ id: `${repo}:${relPath}:${address}`, label: address, type, scope: 'resource', repo, path: relPath, metadata: { terraform_address: address, source_file: relPath } });
  };
  for (const m of text.matchAll(/\bresource\s+"([A-Za-z0-9_]+)"\s+"([A-Za-z0-9_-]+)"/g)) add(`${m[1]}.${m[2]}`, 'resource');
  for (const m of text.matchAll(/\bdata\s+"([A-Za-z0-9_]+)"\s+"([A-Za-z0-9_-]+)"/g)) add(`data.${m[1]}.${m[2]}`, 'data_source');
  for (const m of text.matchAll(/\bmodule\s+"([A-Za-z0-9_-]+)"/g)) add(`module.${m[1]}`, 'module_ref');
  return nodes;
}

// Best-effort reference edges: within one file, a resource block that mentions another block's address.
function terraformEdges(text, repo, relPath, addressToId) {
  const edges = [];
  const seen = new Set();
  // Split into resource/data/module blocks to know the "source" of a reference.
  const blockRe = /\b(resource|data|module)\s+"([A-Za-z0-9_]+)"(?:\s+"([A-Za-z0-9_-]+)")?\s*{/g;
  const heads = [...text.matchAll(blockRe)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const kind = h[1];
    const address = kind === 'module' ? `module.${h[2]}` : kind === 'data' ? `data.${h[2]}.${h[3]}` : `${h[2]}.${h[3]}`;
    const sourceId = addressToId.get(address);
    if (!sourceId) continue;
    const body = text.slice(h.index, heads[i + 1]?.index ?? text.length);
    for (const [addr, targetId] of addressToId) {
      if (addr === address || targetId === sourceId) continue;
      // The address token must appear as a real reference, not a substring of a longer name.
      if (!new RegExp(`(^|[^A-Za-z0-9_.])${addr.replace(/[.]/g, '\\.')}([^A-Za-z0-9_]|$)`).test(body)) continue;
      const key = `${sourceId}->${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: sourceId, target: targetId, edge_type: 'references', weight: 1.0 });
    }
  }
  return edges;
}

export function scanRepo(rootDir) {
  const repo = repoIdFor(rootDir);
  const nodes = [];
  const edges = [];
  const tfFiles = [];
  const addressToId = new Map();
  for (const file of walk(rootDir)) {
    const relPath = relative(rootDir, file).split(sep).join('/');
    const base = relPath.split('/').pop();
    if (MARKERS[base]) {
      nodes.push({ id: `${repo}:${relPath}:marker:${MARKERS[base]}`, label: base, type: MARKERS[base] === 'docker' ? 'build' : 'runtime', scope: 'project', repo, path: relPath, metadata: { marker: MARKERS[base] } });
    }
    if (base?.endsWith('.tf')) {
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const tn = terraformNodes(text, repo, relPath);
      for (const n of tn) {
        nodes.push(n);
        addressToId.set(n.metadata.terraform_address, n.id);
      }
      tfFiles.push({ relPath, text });
    }
  }
  // Edges after all addresses are known (still per-file, but the id map spans the repo).
  for (const { relPath, text } of tfFiles) edges.push(...terraformEdges(text, repo, relPath, addressToId));
  return {
    repo,
    scanned_at: new Date().toISOString(),
    stats: { nodes: nodes.length, edges: edges.length, terraform_files: tfFiles.length },
    nodes,
    edges,
  };
}
