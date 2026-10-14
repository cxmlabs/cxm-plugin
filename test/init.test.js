import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'bin', 'cxm.js');

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'cxm-init-'));
  const project = join(base, 'project');
  const home = join(base, 'home');
  const config = join(base, 'config');
  mkdirSync(project);
  mkdirSync(home);
  return { base, project, home, config };
}

function init({ project, home, config }) {
  return spawnSync(process.execPath, [bin, 'init', '--agent', 'codex', '--url', 'https://example.test'], {
    cwd: project,
    encoding: 'utf8',
    // CXM_TELEMETRY=0: a test run is not a customer machine and must not reach usage analytics.
    env: { ...process.env, HOME: home, CXM_CONFIG_DIR: config, CXM_TELEMETRY: '0' },
  });
}

test('Codex init installs owned skills, command, and merged hooks cleanly', () => {
  const fixture = setup();
  const hooksPath = join(fixture.project, '.codex', 'hooks.json');
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] } }));

  const first = init(fixture);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(existsSync(join(fixture.project, '.agents', 'skills', 'cxm-cost-drivers', 'SKILL.md')));
  assert.match(readFileSync(join(fixture.home, '.codex', 'prompts', 'cxm.md'), 'utf8'), /cxm \$ARGUMENTS/);
  const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));
  assert.equal(hooks.hooks.SessionStart[0].hooks[0].command, 'keep-me');
  assert.deepEqual(
    hooks.hooks.PostToolUse.flatMap((entry) => entry.hooks.map((hook) => hook.command)).sort(),
    ['cxm hook aws-cost', 'cxm hook iac-cost'],
  );

  const configPath = join(fixture.config, 'credentials.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.installedSkills['.agents/skills'].push('cxm-retired');
  writeFileSync(configPath, JSON.stringify(config));
  rmSync(join(fixture.project, '.agents', 'skills', 'cxm-cost-drivers'), { recursive: true });
  mkdirSync(join(fixture.project, '.agents', 'skills', 'cxm-retired'));

  const second = init(fixture);
  assert.equal(second.status, 0, second.stderr);
  assert.ok(existsSync(join(fixture.project, '.agents', 'skills', 'cxm-cost-drivers', 'SKILL.md')));
  assert.equal(existsSync(join(fixture.project, '.agents', 'skills', 'cxm-retired')), false);
});

test('Codex init refuses an unowned global cxm prompt without changing it', () => {
  const fixture = setup();
  const promptPath = join(fixture.home, '.codex', 'prompts', 'cxm.md');
  mkdirSync(dirname(promptPath), { recursive: true });
  writeFileSync(promptPath, 'user prompt');

  const result = init(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not owned by CXM/);
  assert.equal(readFileSync(promptPath, 'utf8'), 'user prompt');
  assert.equal(existsSync(join(fixture.project, '.agents', 'skills')), false);
});

test('Codex init leaves an invalid hook file untouched', () => {
  const fixture = setup();
  const hooksPath = join(fixture.project, '.codex', 'hooks.json');
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, '{ not json');

  const result = init(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not valid JSON/);
  assert.equal(readFileSync(hooksPath, 'utf8'), '{ not json');
  assert.equal(existsSync(join(fixture.home, '.codex', 'prompts', 'cxm.md')), false);
});

test('init --no-hooks installs skills but writes no cost hooks', () => {
  const fixture = setup();
  const result = spawnSync(
    process.execPath,
    [bin, 'init', '--agent', 'codex', '--url', 'https://example.test', '--no-hooks'],
    { cwd: fixture.project, encoding: 'utf8', env: { ...process.env, HOME: fixture.home, CXM_CONFIG_DIR: fixture.config } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(fixture.project, '.agents', 'skills', 'cxm-cost-drivers', 'SKILL.md')), 'skills still install');
  assert.equal(existsSync(join(fixture.project, '.codex', 'hooks.json')), false, 'no hooks file written');
  assert.match(result.stdout, /Skipped the cost-of-change hooks/);
});

test('uninstall removes what setup wrote and keeps the user\'s own hooks', () => {
  const fixture = setup();
  const hooksPath = join(fixture.project, '.codex', 'hooks.json');
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] } }));
  assert.equal(init(fixture).status, 0);
  const env = { ...process.env, HOME: fixture.home, CXM_CONFIG_DIR: fixture.config, CXM_TELEMETRY: '0' };
  const out = spawnSync(process.execPath, [bin, 'uninstall'], { cwd: fixture.project, encoding: 'utf8', env });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(!existsSync(join(fixture.project, '.agents', 'skills', 'cxm-cost-drivers')));
  assert.ok(!existsSync(join(fixture.home, '.codex', 'prompts', 'cxm.md')));
  assert.ok(!existsSync(fixture.config));
  const commands = JSON.parse(readFileSync(hooksPath, 'utf8')).hooks.PostToolUse.flatMap((e) => e.hooks.map((h) => h.command));
  assert.deepEqual(commands, ['keep-me']);
  rmSync(fixture.base, { recursive: true, force: true });
});
