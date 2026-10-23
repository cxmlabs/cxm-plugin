# Privacy and data handling

This explains what the Cloud ex Machina plugin and its `cxm` CLI send off your machine, what stays
on it, and how your credentials are stored. Every statement here is reconcilable with the source in
this repository.

## What leaves your machine

**1. Your queries go to your own Cloud ex Machina environment.** `cxm` authenticates to the CXM API
and analytics endpoints you configured at setup (your `--url`, e.g. `app.cloudexmachina.io`) and
sends your query there. This is the plugin's purpose. It carries your access token and the query you
or the agent wrote; it does not send your cloud data anywhere else.

**2. Product-usage telemetry goes to our analytics provider.** Usage events go to PostHog EU
(`https://eu.i.posthog.com`) with a write-only ingest key. There are two kinds.

*Command events*, one per `cxm` command. Each carries:

- the command name, whether it succeeded or failed, its duration, and on failure an error class and the error message with ARNs, account ids, ids, emails, URLs, local paths and secrets masked (200 characters at most);
- `plugin_version`, `node_version`, `os`, `platform`, `arch`, whether it ran in CI, and whether a
  person or an agent ran it;
- an anonymous per-machine id (`distinct_id` / `machine_id`), generated locally;
- your `organization_id` (so the data is pseudonymous, not anonymous — it is tied to your org, not to you personally);
- for an analytics query: which datasets it named and the query's shape (counts of measures, dimensions,
  filters, and whether it returned rows) — **never** a filter value, a row, a result, or a resource id.

*A session trace*, at most one per agent session, and **only when the session used CXM** (a `cxm-*`
skill, a `cxm` command or `/cxm`). When the session ends, the plugin reads the session transcript
**on your machine** and sends a summary:

- per model call: the model name, token counts and latency;
- per tool call: the tool name (`Bash`, `Read`, `Edit`…; every MCP tool is just `mcp`), the CXM skill or
  `cxm` command name, for an `aws` CLI call its service and operation names (`ce get-cost-and-usage`),
  whether it failed, and its latency;
- for the session: its duration, turn count, total tokens and the cost the agent reported;
- which CXM skills the agent could see, which it loaded, and which it used (a `cxm` command succeeded
  after loading it). Only CXM skills are named; your other skills are never listed;
- how many chart and diagram blocks the agent wrote, per kind (`chart`, `mermaid`…), and how many could not be drawn, with a fixed reason (`unparseable`, `invalid`); never their content.

By default the session trace contains **no content**: no prompt, no answer, no file path or file
content, no command argument, no query, no tool output, no resource id. Sessions that did not use CXM
send nothing.

*A crash report*, only when the plugin itself breaks: a command fails with an error we did not expect,
a hook crashes, or the process stops on an unhandled error. Expected failures (session expired, access
denied, network, a bad query) are not reported this way. A crash report carries the error type, its
message cut to 200 characters with ARNs, account ids, URLs, file paths, emails, ids and key-like strings
replaced, and the stack frames that are inside the plugin, as paths relative to it. It never carries a
frame from your code or your file paths.

**Optional: share session content.** If you set `CXM_TELEMETRY=full`, the session trace also carries
your prompts, the agent's answers, and tool inputs and outputs. Each is cut to 4,000 characters, and
strings that look like keys or tokens are replaced with `[REDACTED]`. This is off unless you turn it
on; use it when you want us to debug a session with you.

Turn all telemetry off with `CXM_TELEMETRY=0`. The full list of keys is in `src/lib/telemetry.js`
and `src/lib/session-trace.js`.

**3. Nothing else.** The plugin has **zero runtime dependencies** — `package.json` declares no
`dependencies` and no `devDependencies`, and everything runs on the Node standard library. No
transitive package can phone home, because there are none.

## What stays on your machine

- **`cxm context scan`** builds a repo graph (Terraform resources and modules, project markers,
  best-effort reference edges) locally and prints it. It leaves your machine only when you pass
  `--push`, which sends it to your own CXM environment (`POST /repo-graph/scan`). Without `--push`
  it never goes anywhere.
- **The cost hooks never touch the network.** `cxm hook iac-cost` and `cxm hook aws-cost` run on
  every edit and shell command, make no outbound call, and stay silent unless the file is Terraform or
  CloudFormation, or the command is a relevant `aws` call. The only hook that sends anything is
  `cxm hook session-end`, which sends the session trace described above. If a hook crashes, it sends a
  crash report (described above) and still lets your agent continue.
- **The transcript stays local.** The session-end hook reads it on your machine; only the summary
  above leaves, or the content too if you set `CXM_TELEMETRY=full`.

## Credentials

`cxm login` stores a single JSON file at `~/.config/cxm/credentials.json` (override the directory
with `CXM_CONFIG_DIR`), written with mode `0600` — readable and writable only by your user. It holds
a short-lived access token and a rotating refresh token, in plaintext.

This is deliberately **not** the OS keychain: that needs a native dependency, and keeping the store
a plain file lets the plugin stay dependency-free and work the same on every platform. The tokens
are short-lived and scoped to your session.

- **Revoke:** the access token is short-lived and expires on its own; run `cxm login` again to start
  a new session.
- **Delete:** remove the file, or the whole config, with `rm -rf ~/.config/cxm`.

## Retention and deletion

_To be completed with Legal before the public release._ This section must state how long telemetry
is kept and how you ask for it to be purged. Do not treat it as final until that is filled in.

## Processor or controller, and the DPA

_To be completed with Legal before the public release._ Whether Cloud ex Machina is a processor or a
controller for the telemetry above, and whether it is covered by the existing Data Processing
Agreement, is a legal determination, not an engineering one.
