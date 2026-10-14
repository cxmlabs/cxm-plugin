import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configPath, loadConfig, saveConfig } from '../lib/config.js';
import { mergeConfig, parseHostFlags } from '../lib/host-flags.js';
import { confirmBaseUrl } from '../lib/prompt.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skillsSource = join(packageRoot, 'skills');

const AGENT_SKILL_DIRS = {
  claude: '.claude/skills',
  codex: '.agents/skills',
};

// Claude's `/cxm` command and Codex's `/prompts:cxm` command both run the plugin binary.
// Same file the marketplace plugin ships as its slash command — one source, two install paths.
const CXM_COMMAND = readFileSync(join(packageRoot, 'commands', 'cxm.md'), 'utf8');

const CODEX_PROMPT_PATH = join(homedir(), '.codex', 'prompts', 'cxm.md');

function detectAgent() {
  if (existsSync('.codex') && !existsSync('.claude')) return 'codex';
  return 'claude';
}

// PostToolUse FinOps nudge hooks: Terraform/CloudFormation edits → price + enrich the change;
// `aws` CLI create/describe → cost / FinOps context. Merged into .claude/settings.json without
// clobbering other hooks. Idempotent.
const HOOKS = [
  { event: 'PostToolUse', matcher: 'Edit|Write', command: 'cxm hook iac-cost' },
  { event: 'PostToolUse', matcher: 'Bash', command: 'cxm hook aws-cost' },
  { event: 'SessionEnd', command: 'cxm hook session-end' },
];

function installHooks(path, failOnInvalid = false) {
  let settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      if (failOnInvalid) throw new Error(`Cannot update ${path}: it is not valid JSON.`);
      return false;
    }
  }
  settings.hooks ??= {};
  let changed = false;
  for (const { event, matcher, command } of HOOKS) {
    settings.hooks[event] ??= [];
    const already = settings.hooks[event].some((entry) => (entry.hooks ?? []).some((h) => h.command === command));
    if (!already) {
      settings.hooks[event].push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] });
      changed = true;
    }
  }
  if (changed) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  }
  return true;
}

function installClaudeHook() {
  return installHooks('.claude/settings.json');
}

function installCodexHook() {
  return installHooks('.codex/hooks.json', true);
}

function assertCodexPromptAvailable(existingConfig) {
  const owned = existingConfig.installedCodexPrompt === CODEX_PROMPT_PATH;
  if (existsSync(CODEX_PROMPT_PATH) && !owned) {
    throw new Error(`Cannot install Codex command: ${CODEX_PROMPT_PATH} already exists and is not owned by CXM.`);
  }
}

function installCodexPrompt() {
  mkdirSync(dirname(CODEX_PROMPT_PATH), { recursive: true });
  writeFileSync(CODEX_PROMPT_PATH, CXM_COMMAND);
  return CODEX_PROMPT_PATH;
}

export async function init(argv) {
  const parsed = parseHostFlags(argv);
  const skipHooks = argv.includes('--no-hooks');
  const agent = parsed.agent || detectAgent();
  const targetDir = AGENT_SKILL_DIRS[agent];
  if (!targetDir) throw new Error(`Unknown agent "${agent}". Use --agent claude or --agent codex.`);

  // Clean-install the plugin's skills: reset each so renamed/deleted files inside a skill don't
  // linger, and drop skills we shipped before but no longer do. Only touch skills WE installed —
  // never the user's own skills sitting in the same dir.
  const existingConfig = loadConfig() ?? {};
  if (agent === 'codex') assertCodexPromptAvailable(existingConfig);
  const shipped = readdirSync(skillsSource);
  const previouslyInstalled = existingConfig.installedSkills?.[targetDir] ?? [];
  mkdirSync(targetDir, { recursive: true });
  for (const orphan of previouslyInstalled) {
    if (!shipped.includes(orphan)) rmSync(join(targetDir, orphan), { recursive: true, force: true });
  }
  for (const skill of shipped) {
    rmSync(join(targetDir, skill), { recursive: true, force: true });
    cpSync(join(skillsSource, skill), join(targetDir, skill), { recursive: true });
  }

  let hookInstalled = false;
  if (agent === 'claude') {
    mkdirSync('.claude/commands', { recursive: true });
    writeFileSync('.claude/commands/cxm.md', CXM_COMMAND);
    mkdirSync('.claude', { recursive: true });
    if (!skipHooks) hookInstalled = installClaudeHook();
  }
  if (agent === 'codex') {
    if (!skipHooks) hookInstalled = installCodexHook();
    installCodexPrompt();
  }

  const config = mergeConfig(existingConfig, parsed);
  config.installedSkills = { ...(config.installedSkills ?? {}), [targetDir]: shipped };
  if (agent === 'codex') config.installedCodexPrompt = CODEX_PROMPT_PATH;
  // Confirm the URL interactively on setup; skip when --url was given or when non-interactive.
  if (!parsed.url && process.stdin.isTTY) {
    config.baseUrl = await confirmBaseUrl(config.baseUrl);
  }
  saveConfig(config);

  console.log(`Installed CloudExMachina skills into ${targetDir} for ${agent}.`);
  console.log(
    'Usage analytics are on to help us improve the plugin: which commands run, timings, success/failure, ' +
      'your organization id, and which datasets a query named. Never your cloud data, query results, ' +
      'filter values or resource ids. Opt out any time with CXM_TELEMETRY=0 — see the README for the full list.',
  );
  if (agent === 'claude') console.log('Installed the /cxm slash command into .claude/commands.');
  if (agent === 'claude' && hookInstalled) console.log('Installed the cost-of-change hooks (Terraform + aws CLI) into .claude/settings.json.');
  if (agent === 'codex') console.log(`Installed the /prompts:cxm command into ${CODEX_PROMPT_PATH}.`);
  if (agent === 'codex' && hookInstalled) console.log('Installed the cost-of-change hooks into .codex/hooks.json. Trust them in Codex before use.');
  if (skipHooks) console.log('Skipped the cost-of-change hooks (--no-hooks). Re-run cxm setup without it to add them later.');
  console.log('Next: cxm login');
}

function removeHooks(path) {
  if (!existsSync(path)) return false;
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  const ours = new Set(HOOKS.map((h) => h.command));
  let changed = false;
  for (const event of new Set(HOOKS.map((h) => h.event))) {
    const entries = settings.hooks?.[event];
    if (!Array.isArray(entries)) continue;
    const kept = entries
      .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !ours.has(h.command)) }))
      .filter((e) => e.hooks.length);
    if (kept.length === entries.length && kept.every((e, i) => e.hooks.length === entries[i].hooks.length)) continue;
    settings.hooks[event] = kept;
    changed = true;
  }
  if (changed) writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return changed;
}

// Only a symlink to this plugin's cxm.js is ours; a global npm `cxm` or anything else stays.
function removeShim(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isSymbolicLink() || !readlinkSync(path).endsWith(join('bin', 'cxm.js'))) return false;
  rmSync(path);
  return true;
}

// Reverse of `setup` for the current repository, plus the machine-wide pieces: the PATH shim, the
// Codex prompt and the stored credentials. Run it before `plugin uninstall`, which removes `cxm` itself.
export function uninstall() {
  const config = loadConfig() ?? {};
  const removed = [];
  for (const [dir, skills] of Object.entries(config.installedSkills ?? {})) {
    for (const skill of skills) {
      if (existsSync(join(dir, skill))) {
        rmSync(join(dir, skill), { recursive: true, force: true });
        removed.push(join(dir, skill));
      }
    }
  }
  for (const path of ['.claude/settings.json', '.codex/hooks.json']) if (removeHooks(path)) removed.push(`${path} (cxm hooks)`);
  if (existsSync('.claude/commands/cxm.md') && readFileSync('.claude/commands/cxm.md', 'utf8') === CXM_COMMAND) {
    rmSync('.claude/commands/cxm.md');
    removed.push('.claude/commands/cxm.md');
  }
  if (config.installedCodexPrompt && existsSync(config.installedCodexPrompt)) {
    rmSync(config.installedCodexPrompt);
    removed.push(config.installedCodexPrompt);
  }
  for (const dir of [join(homedir(), '.local', 'bin'), join(homedir(), 'bin')]) if (removeShim(join(dir, 'cxm'))) removed.push(join(dir, 'cxm'));
  const configDir = dirname(configPath);
  if (existsSync(configDir)) {
    rmSync(configDir, { recursive: true, force: true });
    removed.push(`${configDir} (credentials and config)`);
  }
  console.log(removed.length ? `Removed:\n  ${removed.join('\n  ')}` : 'Nothing to remove.');
  console.log('Now remove the plugin itself: claude plugin uninstall cxm-agent-plugin@cxm-marketplace (or codex plugin remove).');
  // A plugin copy lives under the agent's plugin directory; anything else came from npm (install or link).
  const self = realpathSync(process.argv[1] ?? '');
  if (!/[/\\](\.claude|\.codex|_npx)[/\\]/.test(self)) console.log(`This cxm (${process.argv[1]}) comes from npm, not the plugin. Remove it with: npm uninstall -g @cloudexmachina/cxm`);
}
