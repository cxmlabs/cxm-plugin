<!-- bmad:context -->
<!-- Verified 2026-10-02 against 5623e6e. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

# cxm-plugin

Claude Code / Codex plugin that answers cloud cost and savings questions from live CloudExMachina
data. Plain ESM Node (>= 22), zero runtime and dev dependencies, tested with `node:test`. The
plugin is three pieces: markdown skills under `skills/`, the `cxm` CLI they shell out to
(`bin/cxm.js` → `src/`), and hooks in `hooks/hooks.json`. Tickets are `CLO-nnnn` in Linear.
Design rationale and runbooks live in `docs/`. The benchmark harness and run corpus are in the
separate private `cxm-plugin-benchmark` repository.

## Policy

- Never push to `main`; open a pull request. A pushed `v*` tag publishes in one workflow —
  release branch, GitHub Release, npm — with no staging registry in between.
- Keep the package dependency-free — `package.json` declares no `dependencies` or
  `devDependencies`, and tests, release tooling and the CLI all run on stdlib. Vendor a few lines
  before adding a package.
- `package.json` is the only place the version is written. Never hand-edit the version in
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, or `.codex-plugin/plugin.json` —
  `npm version` (via `make patch|minor|major`) runs `scripts/sync-version.mjs` to sync them, and
  CI and the release workflow both fail otherwise.
- Never introduce a customer, partner, or vendor name into product-facing text — skill prompts
  under `skills/`, anything the CLI prints, anything a hook emits. Say "your team", "this
  workspace", "your organization". Attribution belongs in metadata only: `author` in the plugin
  manifests and `owner` in `.claude-plugin/marketplace.json`.
- Every backend host derives from the one base URL stored at setup. A hostname written anywhere
  but `src/lib/urls.js` and `src/lib/prompt.js` is a second source of truth that staging and local
  development then disagree with; `test/structure.test.js` refuses it.
- Neither harness is the primary one. No development step may require one of them: `make test` and
  `make validate` are the contract, and both run with no agent installed. A tool that exists for
  one harness only — `claude plugin validate` has no Codex equivalent — is an extra opinion on top
  of a check this repository owns, never the check itself.
- A field added to one plugin manifest is added to the other in the same change.
  `test/structure.test.js` holds `name`, `version` and `description` together, and holds Codex's
  declared skills path to the directory Claude discovers by convention.
- The CLI computes nothing. It authenticates, shapes a query and prints the answer; joins,
  aggregation, ranking and derived figures belong in the analytics layer behind one query or one
  endpoint. A number computed on a laptop is a second implementation of a number the platform
  publishes. `src/AGENTS.md` holds the boundary and names the two places that break it today.
- Name the capability, not the service behind it. The plugin ships as readable text, so an
  internal technology named in a comment, a prompt, or CLI output tells a customer what runs
  inside the platform. The query format is the exception, because a skill that cannot say `cubejs`
  cannot write a query. `test/structure.test.js` holds a word list.
- Do not add an MCP server. The decision and the conditions that would reverse it are in
  `docs/why-cli-not-mcp.md`; logic stays in `src/lib` either way.
- The release path has a human owner. `.github/`, `scripts/sync-version.mjs`,
  `scripts/validate-manifests.mjs` and `scripts/install-cxm-shim.sh` need an SRE review — see
  `.github/CODEOWNERS` for why.

## Where things are

- The CLI, and which `lib` module to reach for before writing a request or a URL: `src/AGENTS.md`
- The shape a skill must have, and what the structural test refuses: `skills/AGENTS.md`
- How to run the suite, and what the structural tests refuse: `test/AGENTS.md`
- The release gates and the user-facing shim: `scripts/AGENTS.md`
- Release mechanics: `docs/releasing.md`. Why this is a CLI and not an MCP server:
  `docs/why-cli-not-mcp.md`
- Plugin hooks are one file for both harnesses, `hooks/hooks.json`, and each command resolves
  `${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}` so the same line works under Claude and Codex. A command
  that names one placeholder only fails silently at runtime, because hook output goes nowhere a
  user sees. `test/manifests.test.js` is what catches it.
- These instructions load once per harness and are written once. Codex reads `AGENTS.md`
  directly; `CLAUDE.md` is a one-line `@AGENTS.md` import and holds no content of its own. A rule
  written in `CLAUDE.md` is a rule Codex never sees.
- Benchmark harness and run corpus: the separate private `cxm-plugin-benchmark` repository

## Running and verifying

- `make test` (= `node --test`) runs the suite; `make validate` runs
  `scripts/validate-manifests.mjs` + `sync-version.mjs --check`, then the real
  `claude plugin validate . --strict` when the `claude` CLI is present.
- `.github/workflows/ci.yml` runs the two cheap checks and then the suite on every pull request,
  on Node 22 and 24. A red 22 with a green 24 means the `engines` floor is wrong, not the code.
- Release: `make patch|minor|major` (validates, tests, bumps, commits, tags) then `make release`
  to push. `npm version` refuses a dirty tree — that is the intended guard.
- There is no linter or formatter configured; match the surrounding file instead. The parse sweep
  in `test/structure.test.js` is what covers files no test imports.

## Conventions that differ from defaults

- Write all text in ASD-STE100 Simplified Technical English: code comments, documents, Linear
  tickets, commit messages and pull request text. Short sentences, active voice, one instruction
  per sentence, one word for one meaning. No metaphor, idiom or humour. Agents read this text and
  execute it, and an agent cannot ask what a sentence meant.
- Every comment we publish is one line, 25 words at most. State the defect and the fix, or the
  fact. Reviewers reject longer comments, so a long one does not get read and the work of writing
  it is lost.
  - One inline review comment is one line. `file:line` carries the location, and the code is the
    evidence — never paste the code back.
  - One reply to a reviewer is one line. Name what changed and the commit SHA, or name the fact
    that refutes the remark.
  - One finding in a summary comment is one table row. No heading per finding, no code fence.
  - Anything longer belongs in the pull request body or a linked document, and the one-line
    comment points at it. The pull request body stays under one screen.
  - The rule governs published comments only. A local report keeps whatever structure it needs.
- Commit subjects are `scope: what the change does (CLO-nnnn)` — lowercase, imperative, the ticket
  identifier last when there is one. Pull request titles match.
- ESM everywhere (`"type": "module"`); standalone scripts are `.mjs`.
- Adding a directory the plugin loads from means adding it to `package.json` `files`, or `npx`
  installs ship without it while marketplace installs work. The structural test holds the list.
- Locally installed agent state is not tracked: `.claude/`, `.codex/`, `_bmad/`, `_bmad-output/`
  and `.agents/skills/bmad-*/`. BMAD installs the same skills once per harness
  (`--tools claude-code,codex`), and `_bmad/` is the state both copies read. Anything meant to
  ship goes in `skills/`, which both harnesses load from.

<!-- /bmad:context -->
