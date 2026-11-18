import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { test } from 'node:test';

// An install writes the CXM config and Claude Code's settings, so both point at scratch directories before the import.
process.env.CXM_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cxm-install-'));
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cxm-install-claude-'));
const { AGENTS, SHIM, agentStatus, chooseAgents, install, spawnAgent } = await import('../src/commands/install.js');
const { LAUNCHER_MARK } = await import('../src/commands/init.js');

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
  assert.match(codex.add.join(' '), /--ref v\d+\.\d+\.\d+/, 'Codex is pinned to a release tag');
  assert.deepEqual(ran, [claude.add, claude.refresh, claude.install, claude.upgrade, codex.reset, codex.add, codex.refresh, codex.install, ['sh', SHIM]].map((c) => c.join(' ')));

  await assert.rejects(install(['--yes', '--no-login'], { run: () => 1, status: () => 'ready' }), /could not add or refresh/);
  await assert.rejects(install(['--yes', '--no-login'], { run: () => 0, status: () => 'outdated' }), /No coding agent with plugin support/);
  // Codex failing still installs Claude Code, then reports the failure.
  const codexFails = (cmd) => (cmd[0] === 'codex' ? 1 : 0);
  await assert.rejects(install(['--yes', '--no-login'], { run: codexFails, status: () => 'ready' }), /Installed, except:\nCodex/);
});

// A fake `claude`: `--version` works and `plugin --help` lists marketplaces only when `plugins` is set.
// An old one fails every other call; a current one fails only when it reads a line of input.
function fakeClaude(dir, { plugins }) {
  mkdirSync(dir, { recursive: true });
  const help = plugins ? 'Commands:\n  marketplace  Manage marketplaces' : 'Usage: claude [options] [prompt]';
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/bin/sh\ncase "$1 $2" in\n"--version "*) echo 1.0;;\n"plugin --help") echo "${help}";;\n*) ${plugins ? 'read line && exit 1; exit 0' : 'exit 1'};;\nesac\n`);
  chmodSync(path, 0o755);
}

test('install skips a node_modules/.bin copy of an agent, calls an old one outdated, and never passes it input', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cxm-install-'));
  const [project, old, bin] = [join(root, 'project', 'node_modules', '.bin'), join(root, 'old'), join(root, 'bin')];
  fakeClaude(project, { plugins: false });
  fakeClaude(old, { plugins: false });
  fakeClaude(bin, { plugins: true });
  const { PATH } = process.env;
  t.after(() => { process.env.PATH = PATH; });

  process.env.PATH = old;
  assert.equal(agentStatus('claude'), 'outdated');
  process.env.PATH = [project, bin].join(delimiter);
  await install(['--yes', '--no-login', '--agent', 'claude']);
  assert.equal(spawnAgent(['claude', 'plugin', 'install', 'x'], { input: 'y\n' }).status, 0, 'the agent never gets input');
  const timesOut = (cmd) => (cmd[1] === '--version' ? { status: 0 } : { status: null, error: new Error('spawnSync claude ETIMEDOUT') });
  assert.throws(() => agentStatus('claude', timesOut), /did not finish: spawnSync claude ETIMEDOUT/);
});

test('the cxm launcher runs the newest plugin copy of either agent, reads stdin, and replaces only its own shim', () => {
  const home = mkdtempSync(join(tmpdir(), 'cxm-shim-'));
  const copy = (agent, version) => {
    const dir = join(home, agent, 'plugins', 'cache', 'cxm-marketplace', 'cxm-agent-plugin', version, 'bin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cxm.js'), `process.stdin.on('data', (d) => process.stdout.write('${version} ' + d));`);
  };
  copy('.codex', '0.3.3');
  copy('.claude', '0.3.4');
  copy('.claude', '0.10.0');
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  symlinkSync(join(home, 'gone', 'bin', 'cxm.js'), join(bin, 'cxm'));
  const env = { HOME: home, PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter) };
  assert.equal(spawnSync('sh', [SHIM], { env, encoding: 'utf8' }).status, 0);
  assert.ok(readFileSync(join(bin, 'cxm'), 'utf8').includes(LAUNCHER_MARK), 'cxm uninstall knows the launcher as ours');
  assert.equal(spawnSync(join(bin, 'cxm'), { env, input: 'hi', encoding: 'utf8' }).stdout, '0.10.0 hi', 'the newest copy by version, not by name');
  rmSync(join(home, '.claude'), { recursive: true });
  assert.equal(spawnSync(join(bin, 'cxm'), { env, input: 'hi', encoding: 'utf8' }).stdout, '0.3.3 hi', 'a removed copy leaves the next one');
  writeFileSync(join(bin, 'cxm'), '#!/bin/sh\necho foreign\n', { mode: 0o755 });
  assert.match(spawnSync('sh', [SHIM], { env, encoding: 'utf8' }).stdout, /not this plugin's launcher/);
  assert.equal(readFileSync(join(bin, 'cxm'), 'utf8'), '#!/bin/sh\necho foreign\n');
});
