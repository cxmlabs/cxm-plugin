<!-- bmad:context -->
<!-- Verified 2026-10-02 against 5623e6e. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## scripts/

Two populations: the release gates CI runs, and the shim the plugin installs on a user's machine.
Both are owned by `@cxmlabs/sre` in `.github/CODEOWNERS`, because weakening a gate and deleting it
are the same act.

## Where things are

- `sync-version.mjs` — copies the `package.json` version into the three manifests. `npm version`
  runs it through the `version` lifecycle hook; `--check` fails instead of writing, and that is
  what CI and the release workflow use.
- `validate-manifests.mjs` — structural check of the marketplace manifests for the case where the
  `claude` CLI is absent: a renamed plugin, a manifest that stopped parsing, a declared path that
  no longer exists.
- `install-cxm-shim.sh` — run by the `SessionStart` hook. It symlinks `cxm` into `~/.local/bin`
  and never on top of an existing `cxm`.

## Known pitfalls

- This directory ships to users (`package.json` `files`), so anything added here lands on their
  machines.
- `install-cxm-shim.sh` runs on every session start of every install. It must stay silent and
  fast, and must never fail a session.

<!-- /bmad:context -->
