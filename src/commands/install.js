// `npx @cloudexmachina/cxm install`: one command that installs the plugin into every coding agent
// it finds, then signs in. It runs each agent's own plugin commands, the ones the README lists, and
// never edits an agent's files itself.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { login } from './login.js';

const MARKETPLACE = 'cxm-marketplace';
const PLUGIN = `cxm-agent-plugin@${MARKETPLACE}`;

// Per agent: add the marketplace (fails harmlessly when it is there), refresh it from git, install
// the plugin, then upgrade it: `install` keeps an installed copy, so a re-run needs `upgrade` to move
// to the new version. Codex has no upgrade command: its `add` takes the refreshed marketplace.
export const AGENTS = {
  claude: {
    label: 'Claude Code',
    add: ['claude', 'plugin', 'marketplace', 'add', 'https://github.com/cxmlabs/cxm-plugin.git'],
    refresh: ['claude', 'plugin', 'marketplace', 'update', MARKETPLACE],
    install: ['claude', 'plugin', 'install', PLUGIN],
    upgrade: ['claude', 'plugin', 'update', PLUGIN],
  },
  codex: {
    label: 'Codex',
    add: ['codex', 'plugin', 'marketplace', 'add', 'cxmlabs/cxm-plugin', '--ref', 'main'],
    refresh: ['codex', 'plugin', 'marketplace', 'upgrade', MARKETPLACE],
    install: ['codex', 'plugin', 'add', PLUGIN],
  },
};

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// The agents to install into: the ones on PATH, narrowed by --agent.
export function chooseAgents(argv, present) {
  const only = flag(argv, '--agent');
  if (only && !AGENTS[only]) throw new Error(`Unknown agent "${only}". Use: ${Object.keys(AGENTS).join(', ')}`);
  const wanted = only ? [only] : Object.keys(AGENTS);
  return wanted.filter((a) => present(a));
}

const onPath = (bin) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
const show = (cmd) => cmd.join(' ');

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim().toLowerCase();
  rl.close();
  return answer === '' || answer === 'y' || answer === 'yes';
}

export async function install(argv, { run = (cmd) => spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit' }).status, present = onPath } = {}) {
  const agents = chooseAgents(argv, present);
  if (!agents.length) {
    throw new Error('No supported coding agent found on PATH (Claude Code: `claude`, Codex: `codex`). Install one, then run this again.');
  }

  console.log('CloudExMachina will be installed into:\n');
  for (const a of agents) {
    const { label, add, refresh, install: installCmd, upgrade } = AGENTS[a];
    console.log(`  ${label}:`);
    for (const cmd of [add, refresh, installCmd, upgrade].filter(Boolean)) console.log(`    ${show(cmd)}`);
  }
  const signIn = !argv.includes('--no-login');
  if (signIn) console.log('\nThen it opens your browser to sign in to CloudExMachina.');
  if (!argv.includes('--yes') && process.stdin.isTTY && !(await confirm('\nContinue? [Y/n] '))) {
    console.log('Nothing changed.');
    return;
  }

  for (const a of agents) {
    const { label, add, refresh, install: installCmd, upgrade } = AGENTS[a];
    console.log(`\n${label}`);
    run(add);
    if (run(refresh) !== 0) throw new Error(`${label}: could not add or refresh the ${MARKETPLACE} marketplace.`);
    if (run(installCmd) !== 0) throw new Error(`${label}: could not install ${PLUGIN}.`);
    if (upgrade && run(upgrade) !== 0) throw new Error(`${label}: could not update ${PLUGIN} to the latest version.`);
  }

  if (signIn) {
    console.log('');
    const url = flag(argv, '--url');
    await login(url ? ['--url', url] : []);
  }
  console.log('\nDone. Open a new agent session and ask: "What are my biggest cloud cost drivers?"');
}
