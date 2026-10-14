#!/usr/bin/env node
// Structural check of every manifest both harnesses read. This is the gate, not a fallback: it
// needs no agent installed, and it covers the Codex manifest, which has no official validator at
// all. `claude plugin validate` is run beside it when that CLI happens to be there.
// Catches the failures we can actually cause: a renamed plugin, a manifest that stopped parsing,
// a declared path that no longer exists.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = 'cxm-agent-plugin';
const MARKETPLACE = 'cxm-marketplace';
const errors = [];

const read = (file) => {
  try {
    return JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (err) {
    errors.push(`${file}: ${err.message}`);
    return null;
  }
};

const claudeMarket = read('.claude-plugin/marketplace.json');
const claudePlugin = read('.claude-plugin/plugin.json');
const codexPlugin = read('.codex-plugin/plugin.json');
read('hooks/hooks.json');

if (claudeMarket && claudeMarket.name !== MARKETPLACE) {
  errors.push(`.claude-plugin/marketplace.json: name is "${claudeMarket.name}", expected "${MARKETPLACE}" (users install with @${MARKETPLACE})`);
}
const entry = claudeMarket?.plugins?.find((p) => p.name === PLUGIN);
if (claudeMarket && !entry) errors.push(`.claude-plugin/marketplace.json: no "${PLUGIN}" entry`);
if (entry && entry.source !== './') errors.push(`.claude-plugin/marketplace.json: source must be "./" (the repo root is the plugin)`);
for (const [file, manifest] of [['.claude-plugin/plugin.json', claudePlugin], ['.codex-plugin/plugin.json', codexPlugin]]) {
  if (!manifest) continue;
  if (manifest.name !== PLUGIN) errors.push(`${file}: name is "${manifest.name}", expected "${PLUGIN}"`);
  for (const field of ['version', 'description', 'license']) {
    if (!manifest[field]) errors.push(`${file}: missing ${field}`);
  }
  // UNLICENSED grants no rights. A customer who installs the plugin then has no right to run it.
  if (manifest.license === 'UNLICENSED') errors.push(`${file}: license is UNLICENSED, which grants no rights`);
}
if (codexPlugin?.skills && !existsSync(join(root, codexPlugin.skills))) {
  errors.push(`.codex-plugin/plugin.json: skills path ${codexPlugin.skills} does not exist`);
}
for (const path of ['skills', 'commands/cxm.md', 'hooks/hooks.json', 'bin/cxm.js', 'scripts/install-cxm-shim.sh', 'LICENSE']) {
  if (!existsSync(join(root, path))) errors.push(`missing ${path}, which the plugin ships`);
}

if (errors.length) {
  console.error(`Manifest validation failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`Manifests OK for ${PLUGIN}.`);
