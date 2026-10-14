# Why this plugin is a CLI + skills, not an MCP server

ELI15 note on how the pieces fit and why we picked this shape.

## The three pieces

- **Skills** — markdown files that tell the agent *when and how* to answer a cloud/cost question. Cost almost nothing until they fire.
- **`cxm` binary** — the thing that actually *does* the work: talks to CXM, runs the cost query, prices a change. Skills shell out to it.
- **Hooks** — auto-nudges wired into `.claude/settings.json`. When you edit a `*.tf` file or run `aws`, a hook runs `cxm hook …` and adds cost context without being asked.

`cxm install` installs all three into every agent on the machine (`cxm setup` into one project).

## Why an installer is required (not just skills in a folder)

Skills on their own are dead text. They call the binary, and the binary needs to be installed and logged in. Hooks need to be written into settings. So you need *something* that ships the binary, holds your login, and wires the hooks. That is the npm package + `cxm install`.

It is **not** a formal Claude Code "plugin" (no marketplace manifest). It's an npm package with an `init` step. Same result, and it has to ship via npm anyway because of the binary.

## What is MCP, in one line

MCP = a standard way to hand an agent a set of typed **tools** (plus read-only data and prompt templates). You run a small server; the agent calls its tools directly.

## Why we do NOT use MCP (the real reasons)

1. **The binary is mandatory no matter what.** Hooks can only call a plain command, not an MCP tool. Auth lives in the binary. Zero-install `npx` needs it. So MCP could never *replace* anything — it would only be a second thing to maintain on top.
2. **The binary already reaches everywhere.** `cxm analytics query` runs in Claude Code, Codex, a plain shell, CI — anything that can run a command. MCP reaches *fewer* places (a host has to speak MCP). So we don't even gain reach.
3. **All our features are simple request → answer.** Cost, price, query, wiki, whoami. No live sessions, no multi-step tool conversations. That's the exact shape a one-shot command is best at. MCP's strengths (stateful, interactive, dozens of dynamic tools) go unused.
4. **MCP tool schemas sit in context all the time.** Skills cost nothing until you ask. At a big tool count that context tax hurts.

## The one real weakness — and the fix

The soft spot is that the agent hand-writes raw query JSON for `cxm analytics query`. That's fragile. The fix is **typed CLI subcommands** (like `cxm price --instance m5.large`, and future `cxm cost-drivers --top 10`), so the agent never writes raw JSON. This removes most of the reason people reach for MCP — no server needed.

## When we'd reconsider MCP

Only when one of these is concretely true:

- A target host that can attach an MCP server but can't run our skills/commands — and it's actually in our audience.
- A feature that needs a live, multi-step tool session (e.g. an approval loop).
- The tool surface grows to dozens and we want the agent to freely compose them.

Until then: sharpen the CLI's typing, keep skills for the workflows, skip the server. If we ever build MCP, it's a thin wrapper over the same `src/lib` — never a second copy of the logic.
