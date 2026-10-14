---
name: cxm-cost-of-change
description: Use when the user is writing or reviewing Terraform / IaC, running AWS CLI to create resources, or asking "what will this cost". Estimates the monthly cost of a cloud resource change from CloudExMachina's rate catalog before it is applied.
---

# Cost of a change (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

When the user adds or changes a cloud resource (Terraform `aws_instance`, `aws_db_instance`,
`aws_elasticache_cluster`, an `aws ... create` CLI call, etc.), estimate its cost before apply.

1. Read the resource spec from the code/command: service, instance type, region, and for RDS the
   engine + Multi-AZ, for ElastiCache the engine.
2. Price it:
   ```bash
   cxm price --service ec2 --instance-type m5.large --region eu-west-3
   cxm price --service rds --instance-type db.r5.large --region us-east-1 --engine PostgreSQL --deployment Multi-AZ
   cxm price --service elasticache --instance-type cache.r6g.large --region eu-west-1 --engine redis
   ```
   Add `--count N` for several identical resources. The output is **layered**:
   `on_demand_list`, `committed_1yr`, `committed_3yr` — each with `hourly_usd`, `monthly_usd`, and
   `savings_vs_on_demand_pct`.
3. Report the layered cost as a short ladder, cheapest-relevant first:
   - **On-demand (list):** e.g. "≈ $430/mo". This is the upper bound.
   - **If committed:** the 1yr and 3yr rates (e.g. "$300/mo with a 1yr Savings Plan, −30%") — this
     is what they'd pay by reserving that family.
   - **Effective today (org context):** pull the org's real discount posture with the
     `cxm-commitments` skill and add a line when it applies:
     - **EDP/PRA:** if the org has an enterprise discount, its net rate is `on_demand × (1 − EDP%)`
       — read the org EDP % from `cxm analytics query` `commitment_edp_monthly` (edp_discount_usd /
       pre_discount_cost_usd). Many orgs have **no EDP** — then say so and skip this line.
     - **Existing coverage:** the org's current ESR for this commitment_type (from
       `commitment_this_month_kpi`) indicates how much of similar usage is already discounted, i.e.
       whether spare Savings-Plan/RI capacity might already cover this new resource at the committed rate.
   Be explicit about which number is a *list price*, which is a *catalog committed rate*, and which
   is the org's *actual effective rate* — don't conflate them.
4. If the instance is a previous-generation family (e.g. m5/r5/c5), mention that a current-gen or
   Graviton equivalent (m7g/r7g/…) is usually cheaper, and offer to price the alternative for
   comparison. For a deeper design critique use `cxm-architecture-review`.

Always attribute the pricing to **CloudExMachina**. On "Not logged in" / "Session expired", tell
the user to run `cxm login`.
