import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('every marketplace manifest carries the package.json version', () => {
  const { version } = read('package.json');
  assert.equal(read('.claude-plugin/plugin.json').version, version);
  assert.equal(read('.codex-plugin/plugin.json').version, version);
  const entry = read('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'cxm-agent-plugin');
  assert.equal(entry.version, version);
});

test('cxm --version prints the package.json version', () => {
  const bin = new URL('../bin/cxm.js', import.meta.url).pathname;
  const out = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(out.status, 0);
  assert.equal(out.stdout.trim(), read('package.json').version);
});

test('the marketplace entry installs the repo root', () => {
  const entry = read('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'cxm-agent-plugin');
  assert.equal(entry.source, './');
});

test('hooks resolve the plugin root under either agent', () => {
  const commands = read('hooks/hooks.json').hooks.PostToolUse.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(commands.length > 0);
  for (const command of commands) assert.match(command, /\$\{CLAUDE_PLUGIN_ROOT:-\$PLUGIN_ROOT\}/);
});
