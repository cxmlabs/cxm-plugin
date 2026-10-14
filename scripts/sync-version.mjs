#!/usr/bin/env node
// package.json is the single source of truth for the plugin version. This copies it into the
// Claude and Codex manifests. `npm version` runs it automatically (see the "version" script);
// `--check` fails instead of writing, which is what CI uses to verify a tag.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

// path → where the version lives in that file
const targets = [
  ['.claude-plugin/plugin.json', (m) => m],
  ['.claude-plugin/marketplace.json', (m) => m.plugins.find((p) => p.name === 'cxm-agent-plugin')],
  ['.codex-plugin/plugin.json', (m) => m],
];

const stale = [];
for (const [file, locate] of targets) {
  const path = join(root, file);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const holder = locate(manifest);
  if (!holder) throw new Error(`${file}: no cxm-agent-plugin entry to version`);
  if (holder.version === version) continue;
  stale.push(`${file}: ${holder.version} != ${version}`);
  if (!check) {
    holder.version = version;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

if (check && stale.length) {
  console.error(`Version mismatch against package.json ${version}:\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
console.log(check ? `All manifests at ${version}.` : `Synced manifests to ${version}.`);
