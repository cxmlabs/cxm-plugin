#!/usr/bin/env node
import '../src/lib/node-guard.js'; // first — must run before any module that needs a current Node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/lib/config.js';
import { pluginVersion } from '../src/lib/client.js';
import { sanitizeMessage } from '../src/lib/errors.js';
import { classifyError, emit, reportCrash } from '../src/lib/telemetry.js';

// Before the config read, so the flag works with no credentials and emits no telemetry.
if (process.argv[2] === '--version' || process.argv[2] === '-v') {
  console.log(pluginVersion());
  process.exit(0);
}

// Node must trust a stored CA at startup, so relaunch once with NODE_EXTRA_CA_CERTS set. A real
// deployment has a public certificate and no caCertPath, so this does nothing there.
const cfg = loadConfig();
if (process.argv[2] !== 'hook' && cfg?.caCertPath && !process.env.NODE_EXTRA_CA_CERTS) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: cfg.caCertPath },
  });
  process.exit(child.status ?? 0);
}

const { api, cube, whoami } = await import('../src/commands/query.js');
const { init, uninstall } = await import('../src/commands/init.js');
const { login } = await import('../src/commands/login.js');
const { install } = await import('../src/commands/install.js');
const { price } = await import('../src/commands/price.js');
const { hook } = await import('../src/commands/hook.js');
const { reportOpportunity } = await import('../src/commands/report.js');
const { context } = await import('../src/commands/wiki.js');
const { scan } = await import('../src/commands/scan.js');
const { resolve } = await import('../src/commands/resolve.js');

// Written for an agent. A person runs `setup` and `login`. A skill runs the rest, so this names
// each capability and its arguments. It does not teach a workflow.
const USAGE = `Cloud cost and optimization data, for your coding agent

Usage: cxm <command> [options]

Setup. A person runs these. A skill runs everything else.
  install [--agent claude|codex] [--yes] [--no-login] [--url <base>]
                                                Install the plugin into Claude Code and Codex, then sign in
  setup [--url <base>] [--agent claude|codex]   Install the skills and the /cxm command
  login [--url <base>]                          Sign in through the browser and pick an organization
  whoami                                        Show the signed-in user and the active organization
  uninstall                                     Remove what setup and login wrote (run before plugin uninstall)

Data. Read the schema, then write your own query.
  analytics schema [dataset]                    List the datasets, or one dataset's fields
  analytics query '<json>' [--timeout <s>]      Run a CubeJS-format query

Everything else
  price --service <ec2|rds|elasticache> --instance-type <t> --region <r>
        [--os/--engine/--deployment/--count/--hours]
                                                On-demand and committed rates for one resource
  context '<query>' [--limit n] [--category c]  Search the cloud map
  context --pages | --page <path>               List the pages, or read one
  resolve --arn <a> | --address <tf> [--repo r] Identity, cost, owner repository and opportunities
  scan [--dir <d>] [--out <f>] [--push]         Build the local repository graph
  report-opportunity --arn <a> --title <t> --analysis <text>
        [--savings-monthly + --current-monthly/--region/--resource-type/--description]
                                                Record a finding in the platform
  api <METHOD> <path> [--body '<json>']         Call a REST endpoint the datasets do not cover
  --version, -v                                 Print the CLI version

The datasets and the REST API are the interface. This command only carries your session.`;

// `analytics query '<json>'` takes the query as the first argument. `--query <json>` also works,
// so the pre-rename call sites keep running.
const asQuery = (argv) =>
  argv[0] && !argv[0].startsWith('--') ? ['--query', argv[0], ...argv.slice(1)] : argv;

// Only a skill calls these, so the surface stays flat. `analytics` keeps two verbs because the
// schema call and the query call are one capability. A deeper tree would be ceremony that an LLM
// must learn and that no person reads. `hook` runs before dispatch and is absent here.
const tree = {
  install: (a) => install(a),
  setup: (a) => init(a),
  login: (a) => login(a),
  whoami: () => whoami(),
  analytics: {
    query: (a) => cube(asQuery(a)),
    schema: (a) => cube(['--schema', ...a]),
  },
  price: (a) => price(a),
  context: (a) => context(a),
  resolve: (a) => resolve(a),
  scan: (a) => scan(a),
  'report-opportunity': (a) => reportOpportunity(a),
  api: (a) => api(a),
};

// Pre-rename names. Each one routes to the handler it always used, so old call sites still work.
// Absent from the help, so the agent learns one surface. Remove them at 1.0.
const legacy = { init, cube, wiki: context };

// Telemetry records the canonical name, so an alias and its new name stay one series.
const CANONICAL = { init: 'setup', cube: 'analytics query', wiki: 'context' };

function dispatch(argv) {
  const [ns, verb] = argv;
  const node = tree[ns];

  if (typeof node === 'function') return { name: ns, run: () => node(argv.slice(1)) };
  if (node && verb && node[verb]) return { name: `${ns} ${verb}`, run: () => node[verb](argv.slice(2)) };

  // A pre-rename name, such as `cxm cube --query`.
  if (legacy[ns]) return { name: CANONICAL[ns] ?? ns, run: () => legacy[ns](argv.slice(1)) };

  // `analytics` with a missing or wrong verb. Name the verbs that exist.
  if (node) {
    const verbs = Object.keys(node).join(', ');
    return { error: verb ? `Unknown verb "${verb}" for ${ns}. Try: ${verbs}` : `cxm ${ns} needs a verb. Try: ${verbs}` };
  }
  return {};
}

const argv = process.argv.slice(2);
// `hook` runs on every agent edit, so dispatch does not see it and no command event is sent. Only
// `hook session-end` calls the network, to send the session trace, unless a hook crashes (see docs/privacy.md).
// Anything thrown outside a command's own error path is a bug: report it, then exit. A hook always
// exits 0, so a crash in it never blocks the agent.
const crashExit = (err) => reportCrash(err, { source: argv[0] === 'hook' ? `hook:${argv[1]}` : 'process', handled: false }).finally(() => process.exit(argv[0] === 'hook' ? 0 : 1));
process.on('uncaughtException', crashExit);
process.on('unhandledRejection', crashExit);

if (argv[0] === 'hook') {
  try {
    await hook(argv.slice(1));
  } catch (err) {
    await reportCrash(err, { source: `hook:${argv[1]}` });
  }
  process.exit(0);
}

// `uninstall` deletes the config directory, so it emits no telemetry: an event would write it back.
if (argv[0] === 'uninstall') {
  uninstall();
  process.exit(0);
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const { name, run, error } = dispatch(argv);

if (error) {
  console.error(`Error: ${error}`);
  process.exit(1);
}
if (!run) {
  console.log(USAGE);
  process.exit(argv[0] ? 1 : 0);
}

const started = Date.now();
Promise.resolve()
  .then(run)
  .then(() => emit('plugin.command_run', { command: name, ok: true, duration_ms: Date.now() - started }))
  .catch(async (err) => {
    await emit('plugin.command_error', {
      command: name,
      ok: false,
      duration_ms: Date.now() - started,
      error_class: classifyError(err),
      // Sanitized: ARNs, account ids, ids, emails, URLs, local paths and secrets are masked.
      error_message: sanitizeMessage(err.message),
    });
    // An unclassified failure is most likely our bug: also send a sanitized crash report.
    if (classifyError(err) === 'other') await reportCrash(err, { source: 'command', command: name });
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
