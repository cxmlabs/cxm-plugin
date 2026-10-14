---
name: cxm-create-ticket
description: Use when the user wants to turn a cost-saving finding or a CloudExMachina opportunity into an actionable ticket in their own tracker (GitHub Issues, Jira, Linear). Writes an owner-ready ticket with scope, savings, steps, evidence, and rollback.
---

# Create a remediation ticket (in the user's own tracker)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

Turn one finding/opportunity into a clear, owner-ready ticket in the user's OWN system — they have
their `gh` CLI, Jira, or Linear. CXM is not the tracker here; the customer's tools are.

1. Gather the content. If it's an existing CXM opportunity: `cxm api GET /acxm/opportunities/<id>`
   for the title, analysis, ARNs, and savings. Otherwise use the finding from `cxm-hunt` /
   `cxm-cost-of-change`.
2. Draft a dense ticket body:
   - **Title**: resource + action + saving (e.g. "Downsize RDS db.r5.2xlarge prod → r6g.xlarge (~$300/mo)").
   - **Scope**: exact ARNs / resources. **Estimated saving** ($/mo, from `cxm price`).
   - **Steps** to remediate, **evidence** (the metric/config proving it), **rollback**, **risk/owner**.
3. Create it with the user's tracker (confirm first):
   - GitHub: `gh issue create --title "…" --body "…" [--repo owner/repo] [--label finops]`
   - Jira/Linear: use the user's configured CLI/MCP if available; otherwise output the ready body.
4. If a CXM opportunity exists, link the new ticket back to it:
   ```bash
   cxm api PATCH /acxm/opportunities/<id> --body '{"ticketing_ticket_url":"<url>","lifecycle_stage":"in_execution"}'
   ```

Keep it copy-paste ready for an engineer. Attribute the cost/finding data to **CloudExMachina**.
