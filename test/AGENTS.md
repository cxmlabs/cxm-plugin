<!-- bmad:context -->
<!-- Verified 2026-10-02 against 5623e6e. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## test/

`node:test` and `node:assert/strict`, no framework and no fixture library — the package declares
no devDependencies and this directory is why that is affordable. Most tests call a `src/lib`
function directly; `hook.test.js` and the CLI tests spawn `bin/cxm.js` as a user's session would.
Nothing here reaches the network.

## Running and verifying

- `make test` (= `node --test`) from the repository root. One file: `node --test test/<name>.test.js`.
- `make validate` is the other half and CI runs it first: `scripts/validate-manifests.mjs` plus
  `scripts/sync-version.mjs --check`. A version bumped in `package.json` alone is red there, not
  here.
- CI runs the suite on Node 22 and 24 — the floor `package.json` claims and the current release.
  A red 22 with a green 24 means the `engines` field is wrong, not the code.

## What the structural tests refuse

`structure.test.js` reads the repository as text. It refuses: a skill whose frontmatter is not
exactly `name` and `description`; a `name` that disagrees with its directory; a description that
does not open with "Use when"; a backend hostname outside `src/lib/urls.js` and
`src/lib/prompt.js`; a tracked `.js` or `.mjs` file that does not parse; a Codex manifest whose
`name`, `version` or `description` has drifted from the Claude one, or whose skills path is not
the directory Claude discovers; an internal technology name in anything the plugin ships; and a
directory the plugin loads from that `package.json`'s `files` omits.

`manifests.test.js` refuses a version that disagrees across the three manifests, a marketplace
entry that stops installing the repository root, and a hook command that resolves only one
harness's plugin-root placeholder.

## Known pitfalls

- The parse sweep is what covers `scripts/` and the hook paths. `node --test` only parses files a
  test imports, so a syntax error in a script nothing imports would otherwise first appear at a
  user's session start.
- Writing a test that spawns the CLI means it runs with the developer's real
  `~/.config/cxm/credentials.json` unless the test says otherwise. Keep spawned tests to code
  paths that do not read credentials, or pass the configuration in.

<!-- /bmad:context -->
