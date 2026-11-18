import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { test } from 'node:test';

// An install writes the CXM config and Claude Code's settings, so both point at scratch directories before the import.
process.env.CXM_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cxm-install-'));
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'cxm-install-claude-'));
const { AGENTS, SHIM, agentStatus, chooseAgents, install, spawnAgent } = await import('../src/commands/install.js');
const { removeShim } = await import('../src/commands/init.js');

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
  const { HOME } = process.env;
  t.after(() => { process.env.HOME = HOME; });
  process.env.HOME = root;
  await install(['--yes', '--no-login', '--agent', 'claude']);
  assert.equal(spawnAgent(['claude', 'plugin', 'install', 'x'], { input: 'y\n' }).status, 0, 'the agent never gets input');
  const timesOut = (cmd) => (cmd[1] === '--version' ? { status: 0 } : { status: null, error: new Error('spawnSync claude ETIMEDOUT') });
  assert.throws(() => agentStatus('claude', timesOut), /did not finish: spawnSync claude ETIMEDOUT/);
});

test('the cxm launcher runs the newest plugin copy, reads stdin, and replaces only its own shim, even broken', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cxm-shim-'));
  const [claudeDir, codexDir] = [join(home, 'claude-config'), join(home, 'codex-home')];
  const copy = (root, version, marketplace = 'cxm-marketplace') => {
    const dir = join(root, 'plugins', 'cache', marketplace, 'cxm-agent-plugin', version, 'bin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cxm.js'), `process.stdin.on('data', (d) => process.stdout.write('${version} ' + d));`);
  };
  copy(codexDir, '0.3.3');
  copy(claudeDir, '0.3.4');
  copy(claudeDir, '0.10.0');
  copy(claudeDir, '9.9.9', 'other-marketplace');
  const [bin, later] = [join(home, '.local', 'bin'), join(home, 'later')];
  mkdirSync(bin, { recursive: true });
  mkdirSync(later, { recursive: true });
  // The incident: our link broken by a removed copy, and an older foreign cxm later on PATH.
  symlinkSync(join(codexDir, 'plugins', 'cache', 'cxm-marketplace', 'cxm-agent-plugin', '0.3.2', 'bin', 'cxm.js'), join(bin, 'cxm'));
  writeFileSync(join(later, 'cxm'), '#!/bin/sh\necho 0.2.1\n', { mode: 0o755 });
  const env = { HOME: home, CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir, PATH: [bin, later, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter) };
  const shim = (e = env) => new Promise((done) => execFile('sh', [SHIM], { env: e }, (err, stdout, stderr) => done([err?.code ?? 0, stdout, stderr])));
  const runs = await Promise.all(Array.from({ length: 8 }, () => shim()));
  assert.deepEqual(runs, runs.map(() => [0, '', '']), 'session starts at once all succeed in silence, the launcher first on PATH');
  assert.equal(spawnSync('cxm', { env, input: 'hi', encoding: 'utf8' }).stdout, '0.10.0 hi', 'the newest copy by version, of this marketplace only');
  rmSync(claudeDir, { recursive: true });
  assert.equal(spawnSync('cxm', { env, input: 'hi', encoding: 'utf8' }).stdout, '0.3.3 hi', 'a removed copy leaves the next one, in CODEX_HOME');
  assert.deepEqual(await shim({ ...env, PATH: [later, '/usr/bin', '/bin'].join(delimiter) }), [0, `CloudExMachina: the cxm on PATH (${join(later, 'cxm')}) is not this plugin's launcher and may be outdated. Call ${join(bin, 'cxm')} directly, and tell the user to remove the other one (npm uninstall -g @cloudexmachina/cxm).\n`, '']);
  assert.match((await shim({ ...env, PATH: '/usr/bin:/bin' }))[1], /is not on PATH/);
  assert.equal(removeShim(join(bin, 'cxm')), true, 'cxm uninstall removes the launcher');

  // A link to a --plugin-dir checkout is ours; an npm link and a plain file are foreign, kept by the shim and by uninstall.
  symlinkSync(join(home, 'checkout', 'bin', 'cxm.js'), join(bin, 'cxm'));
  assert.equal(removeShim(join(bin, 'cxm')), true);
  assert.equal(lstatSync(join(bin, 'cxm'), { throwIfNoEntry: false }), undefined, 'a broken link is removed too');
  for (const foreign of ['npm', 'file']) {
    const npm = join(home, 'npm', 'node_modules', '@cloudexmachina', 'cxm', 'bin', 'cxm.js');
    mkdirSync(dirname(npm), { recursive: true });
    writeFileSync(npm, '');
    if (foreign === 'npm') symlinkSync(npm, join(bin, 'cxm'));
    else writeFileSync(join(bin, 'cxm'), '#!/bin/sh\necho foreign\n', { mode: 0o755 });
    const before = foreign === 'npm' ? readlinkSync(join(bin, 'cxm')) : readFileSync(join(bin, 'cxm'), 'utf8');
    await shim();
    assert.equal(foreign === 'npm' ? readlinkSync(join(bin, 'cxm')) : readFileSync(join(bin, 'cxm'), 'utf8'), before, `a foreign ${foreign} cxm stays`);
    assert.equal(removeShim(join(bin, 'cxm')), false, `cxm uninstall keeps a foreign ${foreign} cxm`);
    rmSync(join(bin, 'cxm'));
    rmSync(join(home, 'bin'), { recursive: true, force: true });
  }

  // Bin folders it cannot write to: nothing is written and nothing is printed.
  const locked = mkdtempSync(join(tmpdir(), 'cxm-shim-locked-'));
  mkdirSync(join(locked, '.local', 'bin'), { recursive: true });
  mkdirSync(join(locked, 'bin'));
  chmodSync(join(locked, '.local', 'bin'), 0o555);
  chmodSync(join(locked, 'bin'), 0o555);
  assert.deepEqual(await shim({ ...env, HOME: locked }), [0, '', '']);
});
