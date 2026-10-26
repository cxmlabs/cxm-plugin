# Gate wiring for this repository

How this repository decides each gate the plugin's `gates.md` defines. A section uses a gate id
that file defines; it cannot add a gate or switch one off. Run the commands here before you ask a
lens; only the residue goes to the `security` lens. A gate this file does not wire keeps its
plugin default.

This repository holds a CLI, skills and hooks that run on a user's machine, not a server. Each gate
reads its plugin intent on what the plugin does there: a route is the loopback sign-in callback and
the hosts the access token goes to; stored data is the credentials file; a cache is any answer the
CLI keeps between two commands.

`<base>` in a command below is the base commit of the pull request,
`gh pr view <n> --json baseRefOid -q .baseRefOid`, or `origin/main` for `--local`. A bare
`origin/main` gives an empty diff once the base moves or the PR merges, and an empty diff passes
nothing: a command that prints nothing on a diff that has files is a `met` only when the command
can print a finding.

Read the `CI` check on the head commit (`gh pr checks <n>`) before you run the suite again. It runs
`node scripts/sync-version.mjs --check`, `node scripts/validate-manifests.mjs` and `node --test` on
Node 22 and 24. A red check on either Node is a failed gate for every gate below that names a test.

---

## SOC2-DEPS — the package declares no dependency

The plugin has no lockfile because it has no dependency. The gate holds that fact, which is
stricter than the plugin default.

**Triggers on**: `package.json`, and any lockfile (`package-lock.json`, `npm-shrinkwrap.json`,
`yarn.lock`, `pnpm-lock.yaml`).

**What it checks**: `package.json` declares no `dependencies`, `devDependencies`,
`optionalDependencies` or `peerDependencies`, and the repository tracks no lockfile.

**Decided by**: **deterministic**. Both commands print nothing and exit 0 when the gate is met.

```bash
node -e 'const p = require("./package.json"); const k = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].filter((x) => p[x] && Object.keys(p[x]).length); if (k.length) { console.log(k.join(" ")); process.exit(1); }'
git ls-files package-lock.json npm-shrinkwrap.json yarn.lock pnpm-lock.yaml
```

**Citation**: `AGENTS.md:17` `Keep the package dependency-free`;
`src/AGENTS.md:10` `The zero-dependency rule is a policy`.

**Unmet reads as**:

> ❌ **SOC2-DEPS — unmet.** `package.json:14` adds `dependencies` with one package.
> **Rule**: `AGENTS.md:17`.
> **Required change**: remove the key and vendor the lines that are needed into `src/lib/`.
> **Acceptance**: the `node -e` command above exits 0.
> **This blocks approval regardless of score.**

---

## SOC2-SECRET — no token, key or secret in code, output, telemetry or CI logs

**Triggers on**: every pull request.

**What it checks**:

1. No access token, refresh token, PKCE verifier, private key or password is committed, printed by
   the CLI, written to a log, put in a telemetry property or printed by a workflow step.
2. Only `src/lib/config.js` writes the credentials file, with mode `0600`.
3. The access token goes only into the `Authorization` header that `src/lib/http.js` builds.

**Decided by**: **mixed**. The commands below decide the literal patterns. The `security` lens
decides the residue, for example a token that reaches an error message through a thrown object.

```bash
git diff <base>...HEAD -U0 -- src bin scripts hooks | grep -nE '^\+.*(console\.(log|error|warn)|emit\(|emitBatch\(|echo ).*(accessToken|refreshToken|codeVerifier|code_verifier|client_secret)'   # prints nothing when met
grep -c 'mode: 0o600' src/lib/config.js                                    # prints 1 or more when met
git grep -nE 'writeFileSync\([^)]*configPath' -- src bin | grep -v '^src/lib/config.js:'   # prints nothing when met
gitleaks git --log-opts="<base>..HEAD" --redact --no-banner                # when gitleaks is installed; not in CI yet
```

`.gitleaksignore` lists the accepted findings. A new entry there is a risk acceptance and names the
reason on its line.

**Citation**: `src/AGENTS.md:15` `Do not read`; `docs/privacy.md:79` `0600`;
`src/lib/config.js:24` `mode: 0o600`.

**Unmet reads as**:

> ❌ **SOC2-SECRET — unmet.** `src/commands/login.js:80` prints the token response, which holds
> the access token.
> **Rule**: `docs/privacy.md:79`.
> **Required change**: print the organization name only, as `cxm whoami` does.
> **Acceptance**: the first `git diff` command above prints nothing.
> **This blocks approval regardless of score.**

---

## SOC2-AUTHZ — the sign-in stays on the loopback, and the token goes only to the CXM hosts

**Triggers on**: `src/commands/login.js`, `src/lib/pkce.js`, `src/lib/http.js`, `src/lib/urls.js`,
`src/lib/config.js`, `src/lib/host-flags.js`, `bin/cxm.js`, and any diff that adds a `fetch(`, an
`http.createServer`, a `listen(` or a new `CXM_*_URL` variable.

**What it checks**:

1. The sign-in callback server listens on `127.0.0.1` only, and rejects a callback whose `state`
   differs from the one it sent.
2. The sign-in uses PKCE with `S256`.
3. Every request that carries the token goes to a host that `deriveHosts` in `src/lib/urls.js`
   returns, through `src/lib/http.js`. A new destination for the token is a widening.
4. TLS verification stays on. A new `rejectUnauthorized: false` or `NODE_TLS_REJECT_UNAUTHORIZED`
   is a finding. A custom CA comes only from the stored `caCertPath`.

**Decided by**: **mixed**. The tests and the commands below decide 1, 2 and 4. The `security` lens
decides 3 on the new request.

```bash
node --test test/pkce.test.js test/urls.test.js
grep -c "listen(0, '127.0.0.1'" src/commands/login.js                     # prints 1 when met
grep -c 'state !== expectedState' src/commands/login.js                   # prints 1 when met
git grep -nE 'rejectUnauthorized:\s*false|NODE_TLS_REJECT_UNAUTHORIZED' -- src bin scripts   # prints nothing when met
```

**Citation**: `src/commands/login.js:54` `127.0.0.1`; `src/commands/login.js:34` `State mismatch`;
`src/AGENTS.md:17` `deriveHosts`; `src/AGENTS.md:20` `The only HTTP client`.

**Unmet reads as**:

> ❌ **SOC2-AUTHZ — unmet.** `src/commands/login.js:54` listens on `0.0.0.0`, so another machine
> on the network can deliver the callback.
> **Rule**: `src/commands/login.js:54`.
> **Required change**: listen on `127.0.0.1`, as before.
> **Acceptance**: the `grep -c "listen(0, '127.0.0.1'"` command above prints 1.
> **This blocks approval regardless of score.**

---

## SOC2-IAM — the release identity stays least-privilege, and a widening goes to a person

**Triggers on**: the `permissions:` block of a file in `.github/workflows/`, a new job or step that
reads a secret, the npm publish step of `.github/workflows/release.yml`, and
`.github/CODEOWNERS`.

**What it checks**:

1. A workflow grants no permission wider than its jobs need. `release.yml` keeps `id-token: write`
   for npm trusted publishing and provenance; a long-lived npm token in its place is a widening.
2. A row removed from `.github/CODEOWNERS`, or an owner changed on the release path, is a widening.
3. A workflow that has no `permissions:` block gets the repository default. `ci.yml` has none today.
   A change that adds a step with write access to `ci.yml` adds a `permissions:` block.

**Decided by**: **mixed**. The `release-path` row of `.cxm/checks.md` runs `zizmor` on the
changed workflows. The `security` lens judges the widening. The review never approves a widening,
whatever the score: report it as `unmet`, with "a person from `@cxmlabs/sre` approves this
widening" as the required change.

**Citation**: `.github/CODEOWNERS:24` `A human owner approves every change below`;
`AGENTS.md:48` `The release path has a human owner`;
`.github/workflows/release.yml:17` `id-token: write`.

**Unmet reads as**:

> ❌ **SOC2-IAM — unmet.** `.github/workflows/release.yml:70` passes `NODE_AUTH_TOKEN` from a
> repository secret in place of trusted publishing.
> **Rule**: `.github/workflows/release.yml:17`.
> **Required change**: remove the secret and publish with the OIDC identity.
> **Acceptance**: `release.yml` reads no npm secret, and a person from `@cxmlabs/sre` approves.
> **This blocks approval regardless of score.**

---

## SOC2-AUDIT — a write to CXM asks first, and setup never overwrites a file it did not write

**Triggers on**: `src/commands/report.js`, `src/commands/init.js`, `src/commands/install.js`,
`scripts/install-cxm-shim.sh`, `skills/cxm-report-opportunity/**`,
`skills/cxm-opportunity-lifecycle/**`, and any skill or command that adds a `POST`, `PUT`,
`PATCH` or `DELETE` call.

**What it checks**:

1. A skill that writes to CXM tells the agent to show the change and confirm with the user before
   it runs the command.
2. `cxm init`, `cxm install` and the shim never overwrite or delete a file that they did not
   install. An uninstall removes only what setup wrote.

**Decided by**: **mixed**. The tests below decide 2. The `security` lens decides 1 on the skill
text.

```bash
node --test test/init.test.js test/install.test.js test/report.test.js
```

**Citation**: `skills/cxm-report-opportunity/SKILL.md:21` `Confirm with the user before writing`;
`src/commands/init.js:75` `already exists and is not owned by CXM`;
`scripts/AGENTS.md:25` `It must stay silent and`.

**Unmet reads as**:

> ❌ **SOC2-AUDIT — unmet.** `skills/cxm-opportunity-lifecycle/SKILL.md:26` now updates the status
> without the confirmation step.
> **Rule**: `skills/cxm-report-opportunity/SKILL.md:21`.
> **Required change**: restore "confirm with the user first" before the status update.
> **Acceptance**: the skill names the confirmation before every `cxm api` call that writes.
> **This blocks approval regardless of score.**

---

## SOC2-PII — telemetry and the session trace send what `docs/privacy.md` says, and no more

The plugin keeps no answer between two commands, so the plugin default, a cache per caller, reads
here as what leaves the machine.

**Triggers on**: `src/lib/telemetry.js`, `src/lib/session-trace.js`, `src/lib/errors.js`,
`src/lib/query-shape.js`, `docs/privacy.md`, a call to `emit(`, `emitBatch(` or `reportCrash(`
that the diff adds or changes, and any diff that keeps a query answer on disk or in memory between
two commands.

**What it checks**:

1. Every property sent is listed in `docs/privacy.md` in the same pull request.
2. No property carries a filter value, a row, a result, a resource id, a file path, a prompt or a
   command argument. An error message goes through `src/lib/errors.js` first.
3. `CXM_TELEMETRY=0` sends nothing.
4. An answer kept between two commands is keyed on the organization id of the stored session.

**Decided by**: **mixed**. The tests decide 2 and 3 for the properties they hold. The `security`
lens decides 1 and 4, and 2 for a new property.

```bash
node --test test/telemetry.test.js test/session-trace.test.js test/errors.test.js
```

**Citation**: `docs/privacy.md:4` `Every statement here is reconcilable with the source`;
`docs/privacy.md:25` `never`.

**Unmet reads as**:

> ❌ **SOC2-PII — unmet.** `src/commands/query.js:34` adds the filter values to
> `plugin.analytics_query`.
> **Rule**: `docs/privacy.md:25`.
> **Required change**: send the count of filters only, as `queryShape` does.
> **Acceptance**: an assertion in `test/telemetry.test.js` that the event holds no filter value.
> **This blocks approval regardless of score.**

---

## SOC2-RETENTION — not triggered in this repository

The plugin creates no table. The only file it stores is the credentials file, which holds a
short-lived token and is replaced at each sign-in. A change that makes the plugin store other data
on the machine is decided under `SOC2-PII` and `SOC2-SECRET`.
