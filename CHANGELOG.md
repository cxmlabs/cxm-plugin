# Changelog

This project follows [Semantic Versioning](https://semver.org/). Before 1.0, a minor version can
change or remove commands and skills; a patch version only fixes. Only the latest version gets
fixes, including security fixes.

## Unreleased

- `cxm cost-result`: computes the amounts, totals and grades of a cost-of-change result from its tagged lines.
  It prints what moves and, apart, what might move after the merge.
  `CXM_COST_RESULT_FILE=<file>` also writes its JSON block to that file.
- `cxm-cost-of-change`: lists the lines of a code change first, then gives one range in dollars per month, with each amount from `cxm cost-result`.
- `cxm mcp`: lists the tools of the hosted CxM MCP and calls one of them, with the session of `cxm login`.

- Auto-update: the installer asks once whether to keep the plugin up to date. On yes, Claude Code's
  plugin auto-update is on for the CXM marketplace and Codex is refreshed at a session start, once a
  day. A `cxm` command says, at most once a day, when a newer version is out.

- Charts and diagrams: the agent draws bar, line, column, pie and diverging charts, with totals
  and an optional table, and mermaid architecture diagrams colored by service family. It accepts
  the chart and cloud-diagram blocks of the CloudExMachina chat. `cxm viz` prints one as text;
  `--color` adds colors in a terminal. In Claude Code the plugin draws the blocks in color in the
  reply; a `cube-chart` block runs its query with your session first. The `rich_visuals` setting
  turns the in-reply drawing off.

- A read is repeated after HTTP 502, 503 or 504, at most five times, except the `cxm context` search. A write is sent once.
- `cxm install`: one command, `npx @cloudexmachina/cxm@latest install`, installs the plugin into
  Claude Code and Codex, signs in, and on a re-run updates to the latest version.
- Releases run in CI: a `patch|minor|major` dispatch opens the version-bump PR; merging it tags,
  releases on GitHub, and stages the npm version for a 2FA approval.

## 0.1.0 — first public release

- 16 skills for Claude Code and Codex: cost drivers, savings opportunities and their lifecycle,
  waste, savings hunt, commitments, cloud topology and context, workload context, repository
  graph, cost of change, architecture review, service limits, tickets and finding reports.
- `cxm` CLI: `setup`, `login`, `whoami`, `analytics schema`, `analytics query`, `price`, `context`,
  `resolve`, `scan`, `report-opportunity`, `api`, `uninstall`.
- Cost hooks after Terraform and CloudFormation edits and after `aws` create or resize commands.
  Decline them with `cxm setup --no-hooks`.
- Browser sign-in with OAuth 2.0 + PKCE for any CloudExMachina organization.
- Pseudonymous usage analytics: command events, and one metadata-only summary per session that used CXM.
  Share session content with `CXM_TELEMETRY=full`; opt out with `CXM_TELEMETRY=0`. See [docs/privacy.md](docs/privacy.md).
- Requires Node.js 22 or later.
