# CloudExMachina plugin for coding agents

Ask your coding agent (Claude Code, Codex) about your cloud cost drivers and savings
opportunities. After a one-time browser sign-in, skills fire when you ask about cloud
cost or savings and answer with live data from your CloudExMachina organization.

> **Preview.** Commands and skills can change between versions. See [CHANGELOG.md](CHANGELOG.md).

## Before you start

- **A CloudExMachina account.** The plugin answers from your organization's own cost and
  optimization data, so it works for CloudExMachina customers. Already a customer? Sign in with
  your usual account. Not yet? We would love to show you what it finds in your cloud: write to
  hello@cloudexmachina.io.
- **Node.js 22 or later.**
- **macOS or Linux.** Windows is not tested; use WSL.

## Install

```bash
npx @cloudexmachina/cxm@latest install
```

It finds Claude Code and Codex on your machine, shows the commands it will run, installs the
plugin into each, then opens your browser to sign in. Run it again to update. Options:
`--agent claude|codex`, `--yes` (no confirmation), `--no-login`. Requires Node.js 22 or later.

### Or by hand

The plugin ships through a marketplace hosted in this repo, `cxm-marketplace`, that both Claude
Code and Codex read. One command adds it, one installs the plugin.

#### Claude Code

```bash
claude plugin marketplace add https://github.com/cxmlabs/cxm-plugin.git
claude plugin install cxm-agent-plugin@cxm-marketplace
```

#### Codex

```bash
codex plugin marketplace add cxmlabs/cxm-plugin --ref main
codex plugin add cxm-agent-plugin@cxm-marketplace
```

#### Then sign in

Start one agent session first (`claude`, then `/exit`): the plugin puts `cxm` on your PATH at
session start, with a symlink in `~/.local/bin` (never on top of an existing `cxm`).

```bash
cxm login                       # opens your browser, then pick an organization
```

If `cxm` is still not found, `~/.local/bin` is not on your PATH (the default on macOS):

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && exec zsh
```

`login` stores a short-lived access token under `~/.config/cxm/credentials.json` (readable only
by you). When it expires, run it again. **Open a new session after installing** so skills,
commands and hooks load.

## Try it

Ask your agent:

- "What are my biggest cloud cost drivers?" / "What savings opportunities do I have?"
- "What's my cloud footprint?" / "How does my workload break down?" / "What looks wasteful?"
- "What will this Terraform change cost?" — or just edit a Terraform / CloudFormation file and the plugin nudges you.
- "Review this architecture for cost."

## Update

Run the install again: it refreshes the marketplace and moves the plugin to the latest version.

```bash
npx @cloudexmachina/cxm@latest install --no-login
```

By hand:

```bash
claude plugin marketplace update cxm-marketplace && claude plugin update cxm-agent-plugin@cxm-marketplace
codex plugin marketplace upgrade cxm-marketplace && codex plugin add cxm-agent-plugin@cxm-marketplace
```

Your credentials survive an update. Restart the session afterwards.

## Hooks

The plugin installs two PostToolUse hooks so the agent prices a change before you apply it:

- after an edit to a Terraform (`.tf`) or CloudFormation file, it suggests pricing the change;
- after an `aws` CLI create or resize command, it adds cost context.

A third hook runs when a session ends and sends the session summary described under Privacy.

The hook runs after every edit and every shell command, but it does nothing and makes no network
call unless the edited file is Terraform or CloudFormation, or the command is a relevant `aws` call.
Codex asks you to trust plugin hooks before it runs them. With a per-project install, decline them
with `cxm setup --no-hooks`.

## Uninstall

Run `cxm uninstall` first, while `cxm` still exists (or `npx @cloudexmachina/cxm@latest uninstall`),
then remove the plugin:

```bash
cxm uninstall                   # the PATH symlink, your credentials, the Codex prompt, and in this repo what setup wrote
claude plugin uninstall cxm-agent-plugin@cxm-marketplace
codex plugin remove cxm-agent-plugin@cxm-marketplace
```

`cxm uninstall` removes only what CXM wrote: the skills it installed, its own hook entries (your
other hooks stay), its `/cxm` command, a PATH symlink that points to the plugin, and `~/.config/cxm`.
Run it in each repository where you ran `cxm setup`; the machine-wide part runs once.

## Install per project, without the marketplace

`cxm setup` copies the skills into the *current repository* (`.claude/skills` or `.agents/skills`)
and merges the hooks into that project's settings. Re-run it per repository. Use it when you want a
pinned or modified copy of the skills in one repo.

```bash
npx github:cxmlabs/cxm-plugin setup --agent claude    # or --agent codex
npx github:cxmlabs/cxm-plugin login
```

Re-running `setup` updates that copy: it reinstalls the skills it ships and drops the ones it no
longer does. `npx` caches the fetched repo, so use `npx --yes github:cxmlabs/cxm-plugin@main …`
to pull the latest. Running `setup` from your home directory installs into `~/.claude`, which
Claude Code loads for every project (Codex only reads project-level skills). If you installed from
the marketplace, you do not need `cxm setup` at all.

With `cxm setup --agent codex`, the global `/prompts:cxm` command goes to `~/.codex/prompts/cxm.md`.
A pre-existing file there that CXM did not install makes setup fail rather than overwrite it.

### Agent feature comparison

| Feature | Claude Code | Codex |
| --- | --- | --- |
| Skills (marketplace) | shipped in the plugin | shipped in the plugin |
| Skills (`cxm setup`) | `.claude/skills` | `.agents/skills` |
| Explicit command | `/cxm login` | `$cxm-…`, or `/prompts:cxm login` after `setup` |
| Cost hooks (marketplace) | `hooks/hooks.json` | `hooks/hooks.json` (trust required) |
| Cost hooks (`cxm setup`) | `.claude/settings.json` | `.codex/hooks.json` (trust required) |
| `cxm` binary | Same CLI and authenticated CXM data | Same CLI and authenticated CXM data |

## The CLI is for the agent, not for you

After setup and `cxm login`, a skill runs every command. The datasets and the REST API are the
interface; the CLI carries your session and prints the answer. It does not compute — joins,
aggregation and derived figures stay in the platform.

```bash
cxm whoami                             # did the login work?
cxm analytics schema                   # which datasets exist
cxm analytics schema <dataset>         # the fields of one dataset
cxm analytics query '<cubejs-json>'    # the agent writes this
```

## How it works

- **Auth**: OAuth 2.0 authorization-code + PKCE with a loopback redirect. The plugin sends the
  session token as a Bearer header.
- **Data**: cost and opportunity data comes from the analytics layer.
- **Hosts**: all backend hosts are derived from the single base URL you provide at setup.

## Privacy

The plugin sends pseudonymous usage analytics: which `cxm` command ran, how long it took, whether it
succeeded, versions, a random machine id and your organization id. When a session used CXM, it also
sends one summary of that session: which skills and commands ran, tool names, errors, token counts and
cost. If the plugin itself crashes, it sends a sanitized crash report. It never sends your prompts, answers, cloud data, query results, resource identifiers or file
contents, unless you choose to share session content with `CXM_TELEMETRY=full`. Opt out of everything
with `CXM_TELEMETRY=0`. The full statement is in [docs/privacy.md](docs/privacy.md).

## Support

This plugin is a preview. It has no service level agreement (SLA), and a new version can contain breaking changes.

- Questions and bugs: support@cloudexmachina.io
- Bug reports: open a [GitHub issue](https://github.com/cxmlabs/cxm-plugin/issues/new/choose)
- Vulnerabilities: follow [SECURITY.md](SECURITY.md)

## License

[Functional Source License 1.1, Apache 2.0 future license](LICENSE). Each version becomes
Apache-2.0 two years after its release.
