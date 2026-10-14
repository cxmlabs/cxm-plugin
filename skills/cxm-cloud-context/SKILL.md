---
name: cxm-cloud-context
description: Use WHENEVER the user asks about their own cloud in an understanding sense — what a resource/service/account/app is, what it is for, why it exists, how it's set up, who owns it, how things connect, naming, tags and tagging, cost allocation, untagged or unallocated spend, environments, standards/conventions/policies, data, or economics — including when asked to add, change, or record a documented standard, convention, or policy ("write this down", "remember our tagging standard", "don't ask me again"). Also before advising on any change, and before raw `aws` CLI calls about their own estate. Search the CloudExMachina cloud-map wiki as part of answering, so the answer reflects THEIR documented reality, not generic cloud knowledge.
---

# Understand the user's cloud from CXM's cloud-map (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

CXM keeps a per-organization **cloud-map wiki** — dense, data-grounded pages about *this*
customer's estate across 12 topics (economics, connectivity, data, governance, lifecycle,
naming, ownership, structure, behavior, delivery, operating, client_records). It usually knows
the *specific* answer for their cloud. Treat searching it as a **reflex**.

## When to search the wiki (do it, don't ask first)
Any "understand my cloud" question is a trigger — for example:
- "What is `<resource/service/account/app>`?" / "what is it for?" / "why do we have it?"
- "How is our `<networking / data / auth / CI/CD>` set up?" / "how does X connect to Y?"
- "Who owns `<resource>`?" / "which team runs this?"
- "What are our naming conventions / environments / tagging?"
- "What's our cost basis / commitment strategy / discounts?" (economics pages)
- Before you answer an architecture or cost question (feeds `cxm-architecture-review` /
  `cxm-cost-of-change`) — ground it in what CXM already documented.

If the question is purely generic ("what is an EBS volume in general") the wiki won't help; but
the moment it's about *their* cloud, search first.

## How
1. Turn the question into a search sentence and run it:
   ```bash
   cxm context "what is the extract-and-load pipeline and what does it do"
   cxm context "who owns the production RDS databases"
   ```
   Returns the best cloud-map pages (hybrid full-text + semantic) as `{path, score, snippet}`.
   Scope to a topic with `--category` (repeatable) when the question is clearly one area
   (`cxm context "commitment strategy" --category economics`); find pages like one you're reading with
   `cxm context --related cloud-map/economics/economics_cost_basis.md`.
2. Read the most relevant full page(s):
   ```bash
   cxm context --page 'cloud-map/delivery/delivery_runtime_wiring.md'
   ```
   (`cxm context --pages` lists everything.)
3. Answer from what you found — quote the wiki's specifics (it cites data with `@C` markers).
   If the wiki has nothing, **fall back — never conclude the thing doesn't exist.** The cloud-map
   documents the estate but is not exhaustive; **absence from the wiki means "undocumented", never
   "nonexistent".** Fall back in this order:
   (a) **If you are in a repo, grep it first.** A resource named in the question is very often defined
       in the Terraform/IaC/code right in front of you (a composed `name_prefix`, an ECS service, a
       module). The plugin *augments* your own repo reasoning — it never replaces it, and a wiki gap
       never overrides what the repo plainly defines.
   (b) live data (`cxm-cloud-topology`, `cxm-workload-context`, `cxm-waste`);
   (c) generic knowledge.
   **Do NOT narrate the tool's coverage.** Never tell the reader "the cloud-map has no page for X" or
   "the wiki only confirms broad context" — they want the answer, not a report on where it came from.
   Include CXM/cloud-map context ONLY when it materially sharpens the answer to THIS subject (its
   purpose, relationships, ownership) — woven in as substance, not behind a "wiki said…" preamble. If the
   only CXM data is generic estate stats (total counts, unrelated naming rules), drop it silently. The
   test is "does this help understand the specific thing asked about", never "was there a dedicated page".
   **Never infer a different architecture from nearby wiki snippets** — if the wiki lacks the exact
   thing, the repo/live data decides, not the closest page you did find.

Always attribute CXM-sourced facts to **CloudExMachina**. On "Session expired", run `cxm login`.

## The plugin is additive — it must never make the answer thinner than a plain agent's

You have everything a plugin-less agent has — the repo, `aws`, your own reasoning — PLUS CloudExMachina.
So your answer should never be *worse* than one written without the plugin. When it is, the cause is
always the same: the skill pulled your attention onto a plugin lookup (`cxm context`/`cube`) that came back
empty, and you then settled for a shallower answer than you'd have written from the repo alone. Don't.

- **Do the full base investigation first, to the depth a plugin-less agent would** — read the actual
  Terraform/code, follow the wiring, get the specific mechanics, alarms, env flags, exact error strings,
  line references. That, on its own, must already be a complete and strong answer. The wiki search is a
  bonus lookup, not a substitute for reading the code.
- **An empty plugin result costs you nothing** — no cloud-map page is not a dead end and never a reason
  to stop early or hedge. You still have the repo you've already read in full, plus live data.

Then ADD what only the plugin can, on top: the live deployed reality (`assets` filtered by
`resource_id` → `resource_type`, count, accounts/regions, cost; `lambda_functions` /
`_ecs_clusters` / `_cloudwatch` for type detail and whether it's actually active), real owners, real $$.
Base answer at full depth, then plugin data on top — that ordering is what puts you *ahead*, never level.

## Standards / conventions / policies ("add X to our architecture standards")

CXM keeps the org's canonical standards in the cloud-map (governance / operating / delivery pages),
which the local repo may not fully mirror.

**A team standard is not a personal preference.** When asked to "write down" / "remember" a convention
so you don't ask again (tagging standard, naming rule, an availability mandate), record it where the
**whole team** sees it — the project's **existing standards / architecture doc** (e.g.
`docs/architecture.md`) or the shared CXM cloud-map wiki. **Never** record it in:
- personal or project-local **agent memory**;
- an **agent/tool config or instructions file** — `CLAUDE.md`, `AGENTS.md`, `RTK.md`, `.cursorrules`,
  `.mdc`, and the like. These are not team documentation; a reference to such a file in your inherited
  instructions is NOT the place to write a standard, even if it looks like one.
- a **new stray top-level file** you invent for the purpose.
First locate the real standards doc (grep for the existing convention); append there. That mis-filing —
writing the standard somewhere the team never reads — is the one failure this path exists to prevent.

When asked to add or change a standard:
- **Check both** — `cxm context "<the standard>"` for CXM's canonical version AND the local repo doc.
  Report where it already exists (or doesn't) in each; reconcile any drift between them.
- If it's already documented, say so and stop — don't re-add it.
- If a write is genuinely needed and the target path is PR-gated, **make the change and let the PR be
  the review — don't stall asking permission** (the PR *is* the review gate). Never force a commit
  straight to a protected path.

## Change-safety questions ("is it safe to downsize / delete / change X?")

Here the plugin's real edge over a plain agent is **who owns it and whether it's constrained** — data
the repo alone can't give. A change-safety answer is incomplete without them, so always surface:
- **Owner / team** (wiki ownership pages, `cxm context "who owns <X>"`) — name who must sign off.
- **Compliance / criticality** (`cxm-workload-context` → `compliance_framework`, criticality tags). A
  **compliance-tagged resource is a hard constraint** — say so plainly; it can block the change outright.
- **Dependencies + live headroom** (what reads it, and whether current load leaves room to shrink).

And **state the resource's ACTUAL config from the repo/live data, not the wiki's framing** — if the
repo says a provisioned `db.r6g.2xlarge`, don't call it serverless because a wiki page mentioned
serverless elsewhere. Reconcile to what's really deployed, then advise.
