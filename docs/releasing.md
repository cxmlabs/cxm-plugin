# Releasing cxm-agent-plugin

One tag publishes to **two channels**, from one version:

- **Marketplace** (Claude + Codex) — both agents install the plugin **straight from this git
  repo**, so there is no upload: CI fast-forwards the `release` branch and cuts a GitHub Release.
- **npm** — the `cxm` CLI is published as `@cloudexmachina/cxm` so `npx @cloudexmachina/cxm …`
  works with **no repo access**. CI runs `npm publish --provenance`, but **only if the repo
  variable `NPM_PUBLISH` is `true`** — until then the npm step skips and the marketplace release
  is unaffected.

Publishing a version therefore means: bump the version in every manifest, tag the commit, push.
CI does the rest.

## Layout

| File | Read by | Holds |
| --- | --- | --- |
| `.claude-plugin/marketplace.json` | Claude **and** Codex | the `cxm-marketplace` marketplace and its plugin list |
| `.claude-plugin/plugin.json` | Claude | Claude's plugin metadata |
| `.codex-plugin/plugin.json` | Codex | Codex's plugin metadata (`interface`, skills path) |
| `hooks/hooks.json` | both | cost nudges + the PATH shim, resolved via `${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}` |
| `commands/cxm.md` | Claude | the `/cxm` slash command, also what `cxm setup` copies |
| `skills/` | both | the skills |

The marketplace entry uses `"source": "./"`: the repository root *is* the plugin, so there is no
second copy of the skills to keep in sync. Codex reads the same `.claude-plugin/marketplace.json`
and takes its per-plugin metadata from `.codex-plugin/plugin.json`.

`package.json` is the single source of truth for the version. `scripts/sync-version.mjs` copies
it into the three manifests; `npm version` runs it automatically through its `version` lifecycle
hook, so the manifests are always part of the release commit.

## Cutting a release

```bash
make patch     # 0.1.0 -> 0.1.1   (also: make minor, make major)
make release   # push the commit and the tag
```

`make patch` validates the manifests, runs the tests, bumps `package.json`, syncs the manifests,
commits, and creates the `vX.Y.Z` tag. `npm version` refuses to run on a dirty tree, which is the
guard we want. Nothing has left your machine until `make release`.

Other targets: `make validate`, `make test`, `make version`. Both run with no agent installed:
`scripts/validate-manifests.mjs` checks the Claude and the Codex manifests, and the Codex one has
no official validator at all. `claude plugin validate` runs beside it when that CLI is present,
as a second opinion on the half it covers.

## What CI does

`.github/workflows/release.yml` fires on any `v*` tag and:

1. checks the tag matches `package.json`,
2. checks every manifest carries that same version (`scripts/sync-version.mjs --check`),
3. checks the manifests are structurally sound (`scripts/validate-manifests.mjs`),
4. runs the test suite,
5. fast-forwards the **`release` branch** to the tagged commit,
6. cuts a GitHub Release with generated notes,
7. publishes the `cxm` CLI to npm with provenance — **only when `NPM_PUBLISH` is `true`** (else skipped).

Users who track `main` get every merge; users who track `release` only ever get tagged versions.
Point conservative installs at it:

```bash
claude plugin marketplace add https://github.com/cxmlabs/cxm-plugin.git   # then: claude plugin marketplace update
codex plugin marketplace add cxmlabs/cxm-plugin --ref release
```

## The npm channel

The `cxm` CLI publishes to npm as **`@cloudexmachina/cxm`** on the same tag, publicly
(`publishConfig.access: public`), with a provenance statement that links each version to its
workflow run. One-time setup:

1. **The npm organisation `cloudexmachina`** owns the `@cloudexmachina` scope.
2. **First publish, by hand, with 2FA.** npm sets up trusted publishing only on a package that already
   exists, and a token that bypasses 2FA is not an option. From a clean checkout of the `v0.1.0` tag, an
   org owner runs `npm publish --access public` and enters the 2FA code. Leave `NPM_PUBLISH` unset for
   this tag, so the workflow cuts the GitHub release and skips npm.
3. **Then switch to trusted publishing.** On npmjs.com, add this repository and `release.yml` as the
   package's trusted publisher, and set the repo variable `NPM_PUBLISH` to `true`. Every later version
   publishes from CI through GitHub OIDC, with provenance and no stored token.

`npx @cloudexmachina/cxm …` always resolves the latest published version; a global `npm i -g
@cloudexmachina/cxm` pins until updated. A marketplace install ships its own `cxm` via a PATH shim
that **never replaces a `cxm` it did not create**. When a global npm `cxm` shadows it, the session
start tells the agent to use the plugin's copy and names the `npm uninstall -g` command.

## Versioning

Semver, starting at **0.1.0**, shared by the Claude and Codex manifests — one plugin, one number,
whichever agent installs it.

- **patch** — skill wording, prompt tuning, bug fixes, hook tweaks
- **minor** — new skill, new command, new hook, anything a user would notice
- **major** — a breaking change to the CLI surface or to how the plugin is installed

## Checking a release landed

```bash
claude plugin marketplace add https://github.com/cxmlabs/cxm-plugin.git
claude plugin install cxm-agent-plugin@cxm-marketplace
codex plugin marketplace add cxmlabs/cxm-plugin --ref main && codex plugin add cxm-agent-plugin@cxm-marketplace
```

Both print the resolved version. To try an unpushed change first, add the marketplace from a
local path — `claude plugin marketplace add "$PWD"` or `codex plugin marketplace add .` — install,
then remove both when done.
