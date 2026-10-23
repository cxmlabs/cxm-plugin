# Changelog

This project follows [Semantic Versioning](https://semver.org/). Before 1.0, a minor version can
change or remove commands and skills; a patch version only fixes. Only the latest version gets
fixes, including security fixes.

## Unreleased

- Charts and diagrams: the agent draws bar, line, column, pie and diverging charts, with totals
  and an optional table, and mermaid architecture diagrams colored by service family. It accepts
  the chart and cloud-diagram blocks of the CloudExMachina chat. `cxm viz` prints one as text;
  `--color` adds colors in a terminal. In Claude Code the plugin draws the blocks in color in the
  reply; a `cube-chart` block runs its query with your session first.

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
