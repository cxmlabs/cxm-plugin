---
name: cxm-opportunity-lifecycle
description: Use when the user wants to review the status of their tracked CloudExMachina opportunities, mark ones as in-progress or done, or sweep the backlog to see what's still valid. Re-checks tracked opportunities against the live cloud and moves their status.
---

# Opportunity lifecycle review (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

Go through the opportunities already tracked in CXM, re-check each against the live cloud (the
user has direct access), and move its status — never expanding what the opportunity covers.

1. List the open opportunities (id + lifecycle stage + resource):
   ```bash
   cxm analytics query '{"dimensions":["opportunities.opportunity_id","opportunities.hri_name","opportunities.lifecycle_stage","opportunities.resource_type","opportunities.account_id","opportunities.region"],"segments":["opportunities.not_dismissed"],"filters":[{"member":"opportunities.published_at","operator":"set"}],"order":{"opportunities.sum_annual_savings":"desc"},"limit":50}'
   ```
   For an opportunity's ARNs/detail: `cxm api GET /acxm/opportunities/<id>`.
   When the user points at an item of a list you already showed ("the biggest one"), act on that
   item. Never re-rank with other filters to pick it.
2. For each, re-check the **same resource, same problem** with the user's `aws` CLI / metrics:
   - Still exists and still wasteful → keep `candidate` (or `qualified` once confirmed).
   - Remediation started (resized, stopped, migration underway) → `in_execution`.
   - Fixed / resource gone → `done`.
   - No longer valid (was wrong, or intentionally kept) → `wont_do`.
3. Update status (confirm with the user first):
   ```bash
   cxm api PATCH /acxm/opportunities/<id> --body '{"lifecycle_stage":"in_execution"}'
   ```
   Valid stages: `candidate`, `qualified`, `in_execution`, `measuring`, `done`, `partially_done`, `wont_do`, `snoozed`,
   `rejected`, `superseded`, `regressed`. The `opportunities.not_dismissed` segment leaves out the last five.

Never widen scope — if the problem changed or grew, that's a new opportunity (`cxm-report-opportunity`),
not an edit. On "Access denied" the role lacks `data:write`. Attribute to **CloudExMachina**.
