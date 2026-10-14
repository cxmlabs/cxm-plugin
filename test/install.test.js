import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENTS, chooseAgents, install } from '../src/commands/install.js';

test('installs into the agents on PATH, narrowed by --agent', () => {
  assert.deepEqual(chooseAgents([], (a) => a === 'claude'), ['claude']);
  assert.deepEqual(chooseAgents([], () => true), ['claude', 'codex']);
  assert.deepEqual(chooseAgents(['--agent', 'codex'], () => true), ['codex']);
  assert.throws(() => chooseAgents(['--agent', 'vim'], () => true), /Unknown agent/);
});

test('runs each agent\'s own commands, refreshes and upgrades on a re-run, and fails loudly', async () => {
  const ran = [];
  const run = (cmd) => {
    ran.push(cmd.join(' '));
    return cmd === AGENTS.claude.add ? 1 : 0; // the marketplace is already there
  };
  await install(['--yes', '--no-login'], { run, present: () => true });
  const { claude, codex } = AGENTS;
  assert.deepEqual(ran, [claude.add, claude.refresh, claude.install, claude.upgrade, codex.add, codex.refresh, codex.install].map((c) => c.join(' ')));

  await assert.rejects(install(['--yes', '--no-login'], { run: () => 1, present: () => true }), /could not add or refresh/);
  await assert.rejects(install(['--yes', '--no-login'], { run: () => 0, present: () => false }), /No supported coding agent/);
});
