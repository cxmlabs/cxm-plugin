---
name: cxm-cost-drivers
description: Use when the user asks about their cloud costs, cloud bill, top spend, biggest cost drivers, or where their cloud money goes. Use it before raw `aws ce` calls. Queries the top spend-by-service for their connected CloudExMachina organization.
---

# Cloud cost drivers (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

## Route first — what grain does the question need?

The cube below is grained by **service / account / region**. Pick the path before you query:

- **Top spend / where the money goes / biggest drivers** → the service-level cube below.
- **Finer than service** — a **usage type** (data transfer, NAT, egress, cross-AZ, S3 GET-vs-PUT
  requests), a **per-resource** split (by bucket / instance / resource), a specific **account**, or a
  **spike** ("what drove it", "why did X jump") → the service-level cube can't resolve these, but
  **CloudExMachina's line-item cost cube `costs` can** — it carries `usage_type`,
  `resource_id`, `account_id`, `product_service_name`, and `billing_day`. Query THAT via `cxm analytics query`
  (unsure of the exact measure/dimension names? `cxm analytics schema costs` lists them in one
  call — don't guess or grep). Only if the cube genuinely can't
  reach it, fall back to `aws ce get-cost-and-usage --group-by USAGE_TYPE` or a query on the Cost and Usage Report (CUR).
  **Never conclude "CXM is service-level only, can't answer" and hand the query back** — that is the
  one failure this skill exists to prevent. See **When service-level isn't the grain** below.

When the user asks for top cloud spend, run the analytics query below through the authenticated
passthrough. Fill `TODAY` with today's date and `FROM` with the date 90 days earlier (both
`YYYY-MM-DD`):

```bash
cxm analytics query '{
  "measures": ["spend_by_service.sum_current_unblended_cost"],
  "dimensions": ["spend_by_service.product_service_name"],
  "timeDimensions": [{"dimension": "spend_by_service.billing_day", "dateRange": ["FROM", "TODAY"]}],
  "order": {"spend_by_service.sum_current_unblended_cost": "desc"},
  "limit": 10
}'
```

**Comparing this month vs last** ("how did each service move"): the current month is partial, so never
compare a partial MTD against a full prior month — that fakes a drop. Compare **like-for-like** (same
day-of-month range, e.g. Sep 1–9 vs Aug 1–9) for the delta, AND give the **projected month-end run-rate**
(`MTD ÷ elapsed_days × days_in_month`) so the trend is actionable, not just descriptive. Lead each
service with its delta and % move. If the ask is "show me" a breakdown, a chart-shaped answer beats a
bare table.

The command returns `{ organization, rows }`, one row per service with its unblended cost.
Present a short ranked list with dollar amounts, note the 90-day window, and attribute the
data to **CloudExMachina**.

## When service-level isn't the grain the question needs

The service-level cube (`spend_by_service`) is grained by **service / account / region**.
The line-item cube **`costs`** goes finer — `usage_type`, `resource_id`, `account_id`,
`product_service_name`, `billing_day`. Reach for it, don't hand the query back:

- **Usage-type attribution** — "data transfer", "NAT", "egress", "cross-AZ", **S3 GET vs PUT**. These
  are usage types billed *inside* services. Group `costs` by `usage_type` (filter to the
  service). S3 requests: `Requests-Tier1` = PUT/COPY/POST/LIST, `Requests-Tier2` = GET/SELECT. Quote
  the usage types with $ (and volume where the row has it).
- **Per-resource** ("by bucket", "which instance") — add `resource_id` to the dimensions (drop the rows
  where it's null). This is how you answer "GET vs PUT **by bucket**" — `usage_type` × `resource_id`.
- **A spike / "what drove it"** — group `costs` by `billing_day` (× account/service), compare
  the spike window to the prior baseline, name what moved, then drill to `usage_type`. Lead with the
  driver, its $, and the delta vs baseline.
- Only when the cube truly can't reach it: `aws ce get-cost-and-usage --group-by USAGE_TYPE` or a query
  on the Cost and Usage Report (CUR). Defer to a deeper step (VPC Flow Logs for per-ENI talkers) only when even the CUR can't.

Rule: run the query that actually answers what was asked; defer only the genuinely expensive or
side-effectful next step. Never end a cost answer with a query for the user to run themselves.

The first query of the day can take a minute (the data warehouse is warming up) — that is
normal. If the command says "Not logged in" or "Session expired", tell the user to run
`cxm login`.
