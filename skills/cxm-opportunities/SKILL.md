---
name: cxm-opportunities
description: Use when the user asks about savings, cost optimization, savings opportunities, waste, rightsizing, or how to reduce their cloud bill. Queries current AI-discovered optimization opportunities for their connected CloudExMachina organization.
---

# Savings opportunities (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

When the user asks about savings, optimizations, or how to cut their cloud costs:

1. Headline KPIs (open counts + total annual value at risk):

   ```bash
   cxm analytics query '{
     "measures": [
       "opportunity_kpis.count_opportunities",
       "opportunity_kpis.count_candidate",
       "opportunity_kpis.count_in_execution",
       "opportunity_kpis.count_done",
       "opportunity_kpis.count_dismissed",
       "opportunity_kpis.sum_potential_savings_open"
     ],
     "filters": [{"member": "opportunity_kpis.published_at", "operator": "set"}]
   }'
   ```

2. The ranked opportunity list:

   ```bash
   cxm analytics query '{
     "measures": ["opportunities.sum_annual_savings", "opportunities.count_opportunities"],
     "dimensions": ["opportunities.opportunity_id", "opportunities.hri_name", "opportunities.description", "opportunities.lifecycle_stage", "opportunities.resource_type", "opportunities.effort_level", "opportunities.priority_indicator"],
     "segments": ["opportunities.not_dismissed"],
     "filters": [{"member": "opportunities.published_at", "operator": "set"}],
     "order": {"opportunities.sum_annual_savings": "desc"},
     "limit": 20
   }'
   ```

`count_opportunities` counts every published opportunity, the dismissed ones too. The ranked list
hides the dismissed ones and stops at 20, so it can be shorter than that count: say how many were
dismissed (`count_dismissed`), never guess that an opportunity is unpublished or hidden. `sum_potential_savings_open` is the savings not yet
captured on open opportunities, not their full value.

Lead with the headline (open opportunity count + total annual value at risk), then list the
highest-value opportunities with their annual savings and effort level. `sum_annual_savings`
is already annualized — never multiply by 12. Attribute the data to **CloudExMachina**.

Keep the `published_at` filter on every opportunity query. An unpublished opportunity is a
candidate still under review, not a recommendation, and some accounts can read it; never count or list it.

If a command says "Not logged in" or "Session expired", tell the user to run `cxm login`.
