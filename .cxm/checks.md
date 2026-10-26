# Review checks for this repository

The Tach plugin's `cxm-pr-review` runs these rows on top of the plugin defaults.
The schema is the plugin's `skills/cxm-pr-review/checks.md`. A row here adds a check; it cannot reuse a
default id. Add a check by appending a row.
`<base>` in a command is the base commit of the pull request, as `.cxm/gates.md` defines it.

## Enforced deterministically — not lenses

A lens reports the result of these commands. It does not judge the same fact again.

| Fact | Decided by |
|------|------------|
| Every manifest carries the `package.json` version | `node scripts/sync-version.mjs --check`, in `.github/workflows/ci.yml` |
| The manifests parse and declare paths that exist | `node scripts/validate-manifests.mjs`, in `.github/workflows/ci.yml` |
| Skill frontmatter is exactly `name` and `description`, `name` matches the directory, `description` opens with "Use when", every skill reads the shared rules | `test/structure.test.js`, in `node --test` |
| No backend hostname outside `src/lib/urls.js` and `src/lib/prompt.js` | `test/structure.test.js` |
| Every tracked `.js` and `.mjs` file parses | `test/structure.test.js` |
| No internal technology name in shipped text, and no internal dataset name in any tracked file | `test/structure.test.js` |
| The two harness manifests describe the same plugin | `test/structure.test.js` |
| `package.json` `files` covers every directory the plugin loads from | `test/structure.test.js` |
| The Node guard matches `package.json` `engines` | `test/structure.test.js` |
| The versions agree, the marketplace installs the root, every hook command resolves both plugin-root placeholders | `test/manifests.test.js` |
| A hook stays silent on bad input and prints one JSON line | `test/hook.test.js` |
| Telemetry and the session trace carry no content, and `CXM_TELEMETRY=0` sends nothing | `test/telemetry.test.js`, `test/session-trace.test.js` |
| The suite runs on the `engines` floor and on the current Node | the Node 22 and 24 matrix in `.github/workflows/ci.yml` |

## Checks

| ID | When | What | Severity | Auto-fix | Stage |
|----|------|------|----------|----------|-------|
| zero-deps | `package.json` | inline: a `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies` key in `package.json`, or a new lockfile, is a BLOCKER, as `AGENTS.md:17` `Keep the package dependency-free` requires. The fix is to vendor the few lines that are needed into `src/lib/`. | BLOCKER | no | both |
| compute-boundary | `src/**` | doc:src/AGENTS.md | per-finding | defer | both |
| lib-reuse | `src/**`, `bin/**` | inline: read the added lines only. A new `fetch(` outside `src/lib/http.js`, a read of `credentials.json` or of the config directory outside `src/lib/config.js`, or a URL built outside `src/lib/urls.js`, is a finding, as `src/AGENTS.md:59` `Reach for` requires. Four calls predate the rule and are not findings: the two in `src/lib/telemetry.js` (the analytics host), the token refresh in `src/lib/config.js` and the token exchange in `src/commands/login.js`. | HIGH | yes | both |
| skill-rules | `skills/**` | inline: hold each changed skill against `skills/AGENTS.md` and `skills/cxm-shared-rules.md`. A rule for one skill stays in that skill, and a shared rule changes once, in `skills/cxm-shared-rules.md`, as `skills/AGENTS.md:37` `cxm-shared-rules.md` requires. Every `cxm` subcommand and flag a skill tells the agent to run exists in the `commands` map and the usage text of `bin/cxm.js`, or in the argument handling of its file under `src/commands/`. A skill that writes to CXM (`cxm report-opportunity`, a status change through `cxm api`) tells the agent to confirm with the user first, as `skills/cxm-report-opportunity/SKILL.md:21` `Confirm with the user before writing` does. | per-finding | yes | both |
| hook-advisory | `hooks/hooks.json`, `src/commands/hook.js`, `src/lib/*-scan.js`, `scripts/install-cxm-shim.sh` | inline: a hook is advisory, as `src/AGENTS.md:64` `A hook command is advisory and must always exit 0` requires. It exits 0 on every path, and it prints one `hookSpecificOutput` JSON line or nothing. The `iac-cost` and `aws-cost` hooks and the scanners reach no network. The `session-end` hook reads the transcript on the machine and sends at most one trace through `emitBatch` in `src/lib/telemetry.js`, and nothing when `CXM_TELEMETRY=0`. The shim never overwrites an existing `cxm` and never fails a session, as `scripts/AGENTS.md:25` `It must stay silent and` requires. Name the case in `test/hook.test.js` that covers the change. | HIGH | no | both |
| privacy-promise | the diff changes `src/lib/telemetry.js`, `src/lib/session-trace.js`, `src/lib/query-shape.js`, `src/lib/errors.js` or `docs/privacy.md`, OR adds or changes a call to `emit(`, `emitBatch(` or `reportCrash(` | inline: every property that the change sends is listed in `docs/privacy.md` in the same pull request, as `docs/privacy.md:4` `Every statement here is reconcilable with the source` requires. A property never carries a filter value, a row, a result, a resource id, a file path, a prompt or a command argument, as `docs/privacy.md:25` `never` states. An error message goes through `sanitizeMessage` or `exceptionProperties` in `src/lib/errors.js` before it is sent. Name the assertion in `test/telemetry.test.js` or `test/session-trace.test.js` that holds the new property. | BLOCKER | no | both |
| manifest-parity | `.claude-plugin/**`, `.codex-plugin/**`, `package.json` | inline: a field added to one plugin manifest is added to the other in the same change, as `AGENTS.md:35` `A field added to one plugin manifest` requires. A `version` edited by hand in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` or `.codex-plugin/plugin.json` is a finding, as `AGENTS.md:20` `is the only place the version is written` requires; only the prepare-release workflow moves the version. | HIGH | yes | both |
| product-text-names | always | inline: no customer, partner or vendor name in a skill, in text the CLI prints, in hook output, in a commit message or in the pull request title and body, as `AGENTS.md:24` `Never introduce a customer, partner, or vendor name` requires. Say "your team", "this workspace" or "your organization". The `author` field of the plugin manifests and the `owner` field of `.claude-plugin/marketplace.json` are the exception. Naming the product that is queried, or the tool that is driven, is allowed. | HIGH | yes | both |
| release-path | `.github/**`, `scripts/sync-version.mjs`, `scripts/validate-manifests.mjs`, `scripts/install-cxm-shim.sh` | inline: this path publishes to every install with no staging registry, and `@cxmlabs/sre` owns it, as `AGENTS.md:48` `The release path has a human owner` and `.github/CODEOWNERS:24` `A human owner approves every change below` require. Run `uvx zizmor@1.31.1 --offline --min-severity medium --format plain` on each changed workflow at `<base>` and at the head, and report only the findings the head adds. Flag a new `pull_request_target`, `issue_comment` or `workflow_run` trigger, a wider `permissions:` block, a third-party action not pinned to a full commit SHA, and a gate step removed from `ci.yml` or `release.yml` that the other file still runs. The review never approves a change on this path: a person from `@cxmlabs/sre` does. | HIGH | no | pr |
| security-shipped | `scripts/**`, `hooks/**`, `src/lib/config.js`, `src/lib/http.js`, `src/lib/pkce.js`, `src/lib/urls.js`, `src/commands/login.js`, `src/commands/init.js`, `src/commands/install.js` | extends:security | per-finding | no | pr |
