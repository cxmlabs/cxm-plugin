---
name: cxm-waste
description: Use when the user asks about waste, anti-patterns, flagged issues, suspicious resources, "what looks wrong", OR asks to clean up / tidy / reduce waste in an environment or account (e.g. "clean up the dev environment"). Lists CloudExMachina's detected smells for the connected organization.
---

# Smells / flagged waste (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

Smells are cheap detector hits (pre-qualification), distinct from the finalized
opportunities in `cxm-opportunities`. When the user asks what looks wasteful or suspicious:

1. Funnel summary:
   ```bash
   cxm analytics query '{"measures":["smells.total","smells.pending_count","smells.qualified_count","smells.disqualified_count","smells.total_monthly_usd","smells.pending_monthly_usd"]}'
   ```
2. Top pending smells by monthly cost:
   ```bash
   cxm analytics query '{"dimensions":["smells.arn","smells.signal","smells.source","smells.category","smells.cloud_provider_id","smells.estimated_monthly_cost"],"filters":[{"member":"smells.status","operator":"equals","values":["pending"]}],"order":{"smells.estimated_monthly_cost":"desc"},"limit":15}'
   ```

3. Qualified smells become opportunities, so a scope with few pending smells may still hold waste.
   Run the `cxm-opportunities` ranked list (segment `opportunities.not_dismissed`, `published_at` set) for
   the same scope before you say nobody has looked at it.

`estimated_monthly_cost` is what the resource costs per month, not the saving. Quote a saving only from
an opportunity or from the smell's own text.

Lead with the funnel (total smells, how many pending vs qualified/disqualified, the monthly cost of
the flagged resources), then the top pending items with their signal + estimated monthly cost. If the funnel
`total` is 0, say there is no detected waste. Attribute to **CloudExMachina**. On "Not logged
in" / "Session expired", tell the user to run `cxm login`.

## "Clean up the <env>" — surface targets, don't ask what they mean

A cleanup request is not ambiguous to the plugin: it means "find and remove the waste in that scope."
Don't stall asking what "clean up" means or re-derive the environment from repo greps — **use the
data**. Identify the environment's scope (`cxm-workload-context` / `cxm-cloud-topology`; if env tags
are null, classify from the repo/account structure), pull the smells (and `cxm-opportunities`) for
that scope, and answer with a **concrete, grounded target list** — each resource, its signal, and its
monthly cost — ordered by savings. Then confirm before anything irreversible: deletion needs a yes,
but the list of what to delete comes first, not a clarifying question.
