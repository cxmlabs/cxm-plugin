---
name: cxm-workload-context
description: Use when the user asks about their workload makeup — prod vs dev/staging split, stateful vs stateless, customer-facing vs internal, ownership, criticality, or compliance frameworks — for their connected CloudExMachina organization.
---

# Workload context (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

CXM derives business context from resource tags. When the user asks how their estate breaks
down (environments, statefulness, exposure, compliance), run these and summarize.

1. Totals:
   ```bash
   cxm analytics query '{"measures":["workload_context.asset_count","workload_context.spend_usd_30d"]}'
   ```
2. By environment:
   ```bash
   cxm analytics query '{"measures":["workload_context.asset_count","workload_context.spend_usd_30d"],"dimensions":["workload_context.environment"]}'
   ```
3. Stateful vs stateless:
   ```bash
   cxm analytics query '{"measures":["workload_context.asset_count","workload_context.spend_usd_30d"],"dimensions":["workload_context.is_stateful"]}'
   ```
4. Customer-facing vs internal:
   ```bash
   cxm analytics query '{"measures":["workload_context.asset_count","workload_context.spend_usd_30d"],"dimensions":["workload_context.is_customer_facing"]}'
   ```
5. Compliance frameworks:
   ```bash
   cxm analytics query '{"measures":["workload_context.asset_count","workload_context.spend_usd_30d"],"dimensions":["workload_context.compliance_framework"]}'
   ```

Summarize the splits with asset counts and 30-day spend. This context comes from tags, so coverage
depends on the org's tagging. Attribute to **CloudExMachina**.

**When the environment tag is null/empty** (common — many estates barely tag env), do NOT dead-end on
"can't tell dev from prod." Classify environments from the evidence you *do* have and scope the answer
to it:
- **Repo / IaC** — tenant/account folders, a `pause_mode`/`enable_*` flag, account names in the
  Terraform. In this estate the non-prod tenants are named and pausable in the repo; grep for them
  rather than declaring "no dev/staging exists".
- **Live data** — `cxm-cloud-topology` for the account shape.

For an **off-hours / "what would shutting down non-prod save"** question: identify the actual non-prod
scope first, then size the saving **only on uptime-billed, pausable compute in that scope** (EC2, ECS,
RDS/Aurora provisioned — NOT S3, data transfer, GuardDuty, logs, or serverless that already scales to
zero), off nights+weekends ≈ 60/168h running ≈ 64% off what you pause. Give the scoped dollar figure,
not an org-wide number.

For a **showback / "spend per team"** question when `team`/`owner` tag coverage is poor: say plainly a
true team split isn't possible yet, deliver **spend by account/tenant** as the sendable fallback (the
de-facto accountability boundary), AND give the concrete **fix path** so it's answerable next time —
activate `team` (and `cost-center`) as a **cost-allocation tag** in the Billing console, tag keys are
**case-sensitive** and only bill **from activation forward (not retroactive)**, so the sooner it's on
the sooner showback works. A remediation the user can act on is what turns an honest "can't yet" into a
useful answer. On "Not logged in" / "Session expired", tell the user to run `cxm login`.
