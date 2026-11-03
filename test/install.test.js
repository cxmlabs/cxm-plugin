import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { AGENTS, agentPath, agentStatus, chooseAgents, install, spawnAgent } from '../src/commands/install.js';

test('installs into the agents that support plugins, narrowed by --agent; an old agent is skipped', () => {
  assert.deepEqual(chooseAgents([], (a) => (a === 'claude' ? 'ready' : 'missing')), { ready: ['claude'], outdated: [] });
  assert.deepEqual(chooseAgents([], (a) => (a === 'claude' ? 'ready' : 'outdated')), { ready: ['claude'], outdated: ['codex'] });
  assert.deepEqual(chooseAgents(['--agent', 'codex'], () => 'ready'), { ready: ['codex'], outdated: [] });
  assert.throws(() => chooseAgents(['--agent', 'vim'], () => 'ready'), /Unknown agent/);
});

test('runs each agent\'s own commands, refreshes and upgrades on a re-run, and fails loudly', async () => {
  const ran = [];
  const run = (cmd) => {
    ran.push(cmd.join(' '));
    return cmd === AGENTS.claude.add ? 1 : 0; // the marketplace is already there
  };
  await install(['--yes', '--no-login'], { run, status: () => 'ready' });
  const { claude, codex } = AGENTS;
  assert.deepEqual(ran, [claude.add, claude.refresh, claude.install, claude.upgrade, codex.add, codex.refresh, codex.install].map((c) => c.join(' ')));

  await assert.rejects(install(['--yes', '--no-login'], { run: () => 1, status: () => 'ready' }), /could not add or refresh/);
  await assert.rejects(install(['--yes', '--no-login'], { run: () => 0, status: () => 'outdated' }), /No coding agent with plugin support/);
  // Codex failing still installs Claude Code, then reports the failure.
  const codexFails = (cmd) => (cmd[0] === 'codex' ? 1 : 0);
  await assert.rejects(install(['--yes', '--no-login'], { run: codexFails, status: () => 'ready' }), /Installed, except:\nCodex/);
});

// A fake agent: `--version` works; `plugin --help` lists marketplaces only when `plugins` is set; any
// other call reads a line of input, as an old agent waits on a chat prompt.
function fakeAgent(dir, { plugins }) {
  mkdirSync(dir, { recursive: true });
  const help = plugins ? 'Commands:\n  marketplace  Manage marketplaces' : 'Usage: claude [options] [prompt]';
  const path = join(dir, 'fakeagent');
  writeFileSync(path, `#!/bin/sh\ncase "$1 $2" in\n"--version "*) echo 1.0;;\n"plugin --help") echo "${help}";;\n*) read line; echo "read:$line";;\nesac\n`);
  chmodSync(path, 0o755);
}

test('an agent too old for plugins is outdated, a node_modules/.bin copy is skipped, and no command reads the terminal', () => {
  const root = mkdtempSync(join(tmpdir(), 'cxm-install-'));
  fakeAgent(join(root, 'project', 'node_modules', '.bin'), { plugins: false });
  fakeAgent(join(root, 'bin'), { plugins: true });
  const PATH = [join(root, 'project', 'node_modules', '.bin'), join(root, 'bin')].join(delimiter);
  const onPath = (dirs) => (cmd, { out, ...opts }) => spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', ...opts, stdio: ['ignore', out, out], env: { ...process.env, PATH: dirs } });
  const spawn = onPath(agentPath(PATH));
  assert.equal(agentStatus('fakeagent', spawn), 'ready', 'the node_modules/.bin copy is not the one asked');
  assert.equal(agentStatus('fakeagent', onPath(join(root, 'project', 'node_modules', '.bin'))), 'outdated');
  const run = spawnAgent([join(root, 'bin', 'fakeagent'), 'plugin', 'install', 'x'], { out: 'pipe', timeout: 5000 });
  assert.equal(run.stdout, 'read:\n', 'input is empty, never the terminal');
});
