# Which calls use the CxM API and which calls use the MCP

Decided on 2026-11-24.

## The rule

- A purely deterministic operation uses the CxM API, through the `cxm` command. The same input always
  selects the same data, and no step needs a judgment.
- An operation that needs thinking, to format its input or to interpret its output, uses the central
  CxM MCP, with an authenticated session.
- Prefer a CxM integration to a local call.

This plugin holds no server of its own.

## Where each call goes

| Call | Type | Goes to | Example |
|---|---|---|---|
| A lookup by key, for example a list price | Deterministic | CxM API | `cxm api GET "/pricing/aws/list-price?service_code=<code>&usage_type=<usage type>&volume_amount=<quantity>"` |
| A query of a dataset, for example the cost of one service in one month | Deterministic | CxM API | `cxm analytics query '<json>'` |
| A question whose answer needs interpretation | Needs thinking | Central CxM MCP | "Is this cost increase expected, and which change of the workload explains it?" |

To place a call, ask one question: can a script send the request and use the answer without a judgment?
If yes, use the API. If no, use the central CxM MCP.

An agent writes the query of a deterministic call, but the call itself stays deterministic. Write the
query from the output of `cxm analytics schema`, and send it through the API.

## Why the CLI stays

- **Hooks call a command.** A command hook of the plugin runs `cxm hook …`.
- **The CLI holds the login.** It stores the session, and each API call uses it.
- **It works in each harness.** Claude Code, Codex, a shell and CI can all run a command.

## When the MCP is not available

How a session signs in to the central CxM MCP is not decided yet (MONETA-UV2-DECISION-001). Do not add
an MCP configuration file or a login step before that decision.

An agent that cannot reach the MCP says so. It prints no figure for that input.
