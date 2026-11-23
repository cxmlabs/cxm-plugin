---
name: cxm-cost-of-change
description: Use when the user is writing or reviewing Terraform / IaC, running AWS CLI to create resources, or asking "what will this cost", "what does this code change cost", "price this PR", or the "cost of adding API calls". Estimates the monthly cost of a cloud resource change, or of a code change that adds, removes or multiplies paid API calls, from CloudExMachina's rate catalog and the organization's bill.
---

# Cost of a change (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

This skill prices two kinds of change:

- **A resource change** (Terraform `aws_instance`, `aws_db_instance`, `aws_elasticache_cluster`, an
  `aws ... create` CLI call, etc.). Follow "Price a resource".
- **A code change** that adds, removes or multiplies paid API calls (a crawler config, a scheduled
  function, a loop over accounts or regions). Follow "Price a code change".

A diff that does both gets two subtotals. Add them only for one payer and one currency.

## Price a resource

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
     - **EDP/PRA:** read the negotiated discount of the usage account that will run the resource
       with the discount-rate route (see "Pricing routes"). Its net rate is
       `on_demand × (1 − rows[0].effective_discount_rate_pct ÷ 100)`. Label it and warn as the
        discount rules of "Rate map" say. With no row, or a null rate, skip this line.
     - **Existing coverage:** the org's current ESR for this commitment_type (from
       `commitment_this_month_kpi`) indicates how much of similar usage is already discounted, i.e.
       whether spare Savings-Plan/RI capacity might already cover this new resource at the committed rate.
   Be explicit about which number is a *list price*, which is a *catalog committed rate*, and which
   is the org's *actual effective rate* — don't conflate them.
4. If the instance is a previous-generation family (e.g. m5/r5/c5), mention that a current-gen or
   Graviton equivalent (m7g/r7g/…) is usually cheaper, and offer to price the alternative for
   comparison. For a deeper design critique use `cxm-architecture-review`.

## Pricing routes

The plugin reads list prices and negotiated discounts through `cxm api`. Quote the path: it holds
`?` and `&`. The routes return lookups only. You compute the change and show the formula.

```bash
# A rate and a tiered cost. Add &region=<region> only to override the usage-type prefix.
cxm api GET "/pricing/aws/list-price?service_code=<code>&usage_type=<usage type>&volume_amount=<quantity>"
# Ranked usage types that match some words, in one region.
cxm api GET "/pricing/aws/list-price?service_code=<code>&region=<region>&search=<words>"
# The negotiated discount of one usage account on one product code.
cxm api GET "/pricing/aws/discount-rate?account_id=<usage account>&product_code=<code>"
```

- The list-price route returns `unit`, `tiers` (`price_per_unit_usd`), and with `volume_amount`
  also `applicable_tier` and `total_cost_for_volume`. Without a `region`, the region comes from the
  usage-type prefix (`EUW3-` → eu-west-3; no known prefix → us-east-1). It returns USD only.
- Pass the usage account that the call bills (`costs.account_id`) to the discount-rate route. Never
  pass `costs.payer_account_id` in place of a different `costs.account_id`. When the two are
  equal, pass that account. The route returns `rows` and
  `row_count`, with at most one row. The row holds `effective_discount_rate_pct`, a percent, null
  when the list price is 0. With no row it also returns `product_code_verified` and
  `suggested_action`.

A failed route prints `Org API GET <path> failed: <status>.` and the start of the JSON body.

- On HTTP 422, read `detail.code` and follow it:
  - `no_price_found`: the filter did not match. It is never a zero price. Search the catalog.
  - `no_usage_type_found`: search once with other words. Then print `unmeasured (no_usage_type_found: no usage type matched the search)`.
  - `ambiguous_usage_type`: take the rate from the `costs` row of that usage type. Else print the
    list rate as `unmeasured (ambiguous_usage_type: several prices share this usage type)`. The route takes no parameter that narrows it,
    and `cxm api` cuts the candidate list.
  - `too_many_products`: use `cxm price --instance-type` for an instance. Else print `unmeasured`.
  - `no_aws_datasource`: the organization holds no AWS bill. Print each input that needs it as
    `unmeasured`, and do not call the route again.
  - `unknown_service_id`: copy `product_code` from a `costs` row and call once again.
  - Any other code, or a discount-rate error: print `unmeasured (<code>: <reason>)`, where
    `<reason>` says in plain words what failed, from `detail.message`.
  - A validation 422 carries a list in `detail` and no code: fix the parameter.
- On HTTP 404 from either route, print each input that needs it as `unmeasured (route not deployed)`.
- Never print a missing price or a failed discount lookup as 0.

## Price a code change

Read `../cxm-shared-rules.md`, `measurement.md` and `output.md` first. `measurement.md` sets the
source map, the stop rule and the required counts. Print `unmeasured` only as its stop rule allows.

### 1. What the change bills

Run `cxm whoami` and name the organization of the session. Say that the answer covers this
organization only. "Deployment targets" lists each target that the code reaches, including each
target that another organization holds.

Read the datasources that the organization holds: the distinct `costs.cloud_provider_id` over the
last 30 days, and the datasets that `cxm analytics schema` lists. Read the diff
(`git diff <base>...HEAD`). Find each paid call that the diff adds, removes or multiplies.
A call to a third-party service is a paid call. List each billed item. Print each with its
datasource and its kind (call, resource, or the compute that runs the code: a CI job, a function,
a task) in the result lines.

- Name the API operation of a call. If its datasource does not bill it, mark it "not billed", with
  its reason and a citation.
- Send a resource to "Price a resource", then on to sections 5 and 6.
- If the organization holds no datasource for an item, print `unmeasured (no datasource: <kind>)`.
- If the datasource has no quantity measure, print `unmeasured (no quantity measure: <datasource>)`.
- Give the query that proves each `unmeasured`.
- Price only what the code of the diff makes. Name an indirect call in a doubt, as "Billing dimensions" of `measurement.md` says.

Then list the billing dimensions that each call, resource or data write moves, as
"Billing dimensions" of `measurement.md` says. For example, a diff that adds log writes moves log
ingestion.

### 2. Unit of work

For each paid call, name the unit of work and the asset type that the call iterates over. The unit of
work is once per run, per account, per account and region, per asset, per GitHub org, or per
request.

**Trigger.** Name the trigger of each unit of work: a schedule, a request, an event, a CI run or an
operator action. Cite the code or configuration that sets it, as `file:line@sha`. A workflow can
have several triggers: its cron is a schedule and its manual dispatch is an operator action. Name
each one. Count the units of each trigger from its row of the source map. Send every trigger of a
CI workflow (`schedule`, `workflow_dispatch`, `push` and any other event) to "CI runs per month".
That row counts every run of the workflow and splits the count by event. Use "Requests per month"
for a request. Use "Runs per month" for a schedule, an event or an operator action outside CI.

The unit of work of a CI job is once per CI run. Price a CI job as CI runs per month [cite] × CI
minutes per run [cite] × the rate. Show both factors on the result line. "CI minutes per run" is
`github_workflow_costs.billable_minutes` ÷ the runs in the same window, per workflow and SKU [B].

If the diff adds, removes and multiplies no paid call and moves no billing dimension, go to "No billed unit change".

**Billed units per unit of work.** Count them from the request that the code sends, never from
stored data. Follow "Billed units". Then compare these inputs before and after the diff: the
payer and the usage type of every call, the billed units of every call, the unit of work, the
runs per month, the row filters, and the accounts, regions and asset type that the call
iterates over. If one of them changes, or the diff moves a billing dimension, continue. A change
of payer is a removal on the old payer and an addition on the new payer: give each one a subtotal.
If all of them stay the same and the diff moves no billing dimension, show the count before and
after, and go to "No billed unit change". For example, a diff removes 2 of 4 statistics of a
metric, or changes the batch size and keeps one page.

**Row filters.** Apply each filter that the code puts on the rows before the call. For the
metrics crawler, read the `source_filter`, `min_stored_bytes` and `max_dimension_values` of the
service entry in `aws_services_metrics.yml`, and cite file and line. Filter `assets` on the
column that `source_filter` names when `assets` has it. Cap each account-region count at
`max_dimension_values`. Label the count a ceiling when `assets` cannot express a filter
(`min_stored_bytes`).

#### Billed units

- GetMetricData bills up to 5 statistics of one metric in one request as one metric. Billed
  metrics per asset = the sum of ⌈statistics ÷ 5⌉ per metric. A metric with 4 statistics bills 1;
  removing 2 of its 4 statistics changes 0 billed metrics. A change of batch size, period or time
  window changes no billed metric, unless it changes the number of pages. If the code can put
  the statistics of one metric in two requests, the metric bills once in each request. Count
  ⌈statistics ÷ 5⌉ per request in that case.
- A requested metric with no data still bills.
- Count each page of a paged response as one more request with the same billed units. If the code
  cannot bound the page count, take it from the "Pages" row of the source map.
- Price the success path. Print the retry count of the code as a ceiling only.
- The query service (product code `AmazonAthena`) bills each query's scan rounded up to the next
  MB, with a 10 MB minimum. Take the bytes per query from the "Bytes per query" row of the source map.
- List each call that the diff causes indirectly, such as a KMS `Decrypt` for each S3 `GetObject`
  on a key-encrypted bucket without a bucket key. Price it, or print it as `unmeasured`. Follow
  "Billing dimensions" of `measurement.md` for the dimensions that it moves.

### 3. Units on each target

**Deployment targets.** List every target that runs the changed code, before you name a payer.
Do this for each changed file:
- Find its deployable unit: a CI workflow (jobs, schedule, role variables, `--region`, matrix,
  `environment:`), an image, an infrastructure resource, or a schedule in code or infrastructure.
- Expand the unit into targets. For infrastructure, follow the `deploys` edges of the
  `cxm-repo-graph` skill from each Terraform workspace that uses the module or image to its
  accounts. A target is a workspace × account × region. For CI, a target is a job × role × region
  × matrix entry. For release state, read `git tag --list 'deploy/*' --contains <file-sha>` and
  `gh run list`. `<file-sha>` is `git log -1 --format=%H <base> -- <file>`. For a file that the
  diff adds, run the same command on the file of its deployable unit. For the accounts of the
  tenants, read the account names in `costs` and `assets` of the organization.
- Answer "Runs here?" for each target, with its grade: A for a run history count, a metric or an
  audit log count. B for bill usage after the deploy date. C for code, configuration or a deploy
  marker. D for an assumption. Answer from the run history of the window: count the runs that
  reached the call. Never answer from one run. A count of 0 gives no only when the schedule of the code fires inside
  the window. If the schedule fires less often, or the job runs on an event, answer from code or
  configuration (C). A job, image or schedule with no run yet, such as
  one that the diff adds before merge, takes its Runs here? from code or configuration (C). An
  empty release history never gives no.
- Give each target one row of the target table, and price each target on its own. Never copy a
  measurement to another target without G2 of `output.md`. A target row counts only the units of
  work that the code deployed on that target reaches: its accounts of "Accounts", its regions and
  assets of "Assets". Never count the units of another target. The total is the sum of the rows.
- Keep a row for each candidate target, also when its answer is no: it prints $0, with the grade
  of its evidence. Never drop a candidate target from the table. A no needs grade C or better. A
  no that rests on an assumption (D) is `unknown`: print it as `unknown [D: <basis>]`, and the
  total becomes a floor (G6).
- If the organization cannot reach a target, keep its row as
  `Runs here? unknown — no access: <error>`, with grade D. The total becomes a floor (G6). Add a
  doubt that names the missing datasource.
- A target that is not attempted fails the run. Print the FAILED line of `output.md` with
  `Deployment targets` as the count, then the structured block.

**Payer.** A call with a role in another account bills that account. A call with the platform
credentials bills the platform account. If the session organization does not hold the bill of
the payer, print each input that needs that bill as `unmeasured`.

**Runtime node.** Find the runtime node and the image of the changed code with the
`cxm-repo-graph` skill. Do not take a schedule, a run count or an account list from a node that
only matches by name. A `deploys` edge names a candidate target of "Deployment targets". A schedule
and a run count never come from it.

**Runs per month.** For each trigger of a CI workflow, take the count from "CI runs per month". For a request, take it from "Requests per month". Else take them from the schedule that the code declares, and cite its
`file:line@sha`. Show the run count as a factor: `21.74 runs/mo [C:c1]`, with the citation
`c1 21.74 = 5 × 365.25 ÷ 7 ÷ 12 ; cron "0 4 * * 1-5" at <file>:<line>@<sha> [C]`. A weekday
cron gives 21.74 runs per month; a daily cron gives 30.44. Use the bill only as a ceiling: the
bill names no caller. If no schedule is readable, take the runs per month from the "Runs per month"
row of the source map. Never infer a run count from the bill.

**Accounts.** For code that runs with the CXM crawler's roles, take the accounts from the
`scoped_accounts_only` segment of `costs`: the accounts where the crawler has read access, among
those with cost rows in the window. Do not take only the accounts where the bill shows the call
now. For other code that calls into other accounts, take the accounts from the list that the
code or its configuration declares, with file and line. Else take the accounts from the "Accounts"
row of the source map.

**Assets.** Count the affected assets per account and region with `assets`. Filter
`assets.asset_type` on the inventory table that the code iterates over, and
`assets.inventory_status` on `live`. Print the date of the count.

#### Count rules

- If a dataset returns no rows, print `unmeasured (no rows in <dataset>)`. If a query fails,
  print `unmeasured (<error>)`. Do both only when the stop rule of `measurement.md` allows it.
- If the code calls in each enabled region, take the region count from the "Regions" row of the
  source map. Label the regions of `assets` or `costs` a lower bound.
- Code behind a flag that is off costs 0 as merged. Give the cost when enabled on its own line.
- Do not claim a decrease larger than the current cost of that usage type in the payer accounts.
- A token count per model call and a request count per route are not in a dataset. The exception is
  the "Requests per month" row of the source map. For a
  model call, give the rate and the per-call formula, or "cannot price" for a model outside the bill.

### 4. Billing dimensions

Price each moved dimension as "Billing dimensions" of `measurement.md` says.

### 5. Rates

**Baseline.** Read the current usage and cost of the same usage type per account and region
with `costs`, over the 30 full days before `cur_reach.latest_day`. `cur_reach.latest_day` is a
measure, not a dimension: query it as `{"measures":["cur_reach.latest_day"],"filters":[{"member":
"cur_reach.cloud_provider_id","operator":"equals","values":["aws"]}]}`. If the change already
runs in the organization, end the window 2 days before the commit date of the change
(`git log --format=%cs -1 <commit>`). Cite that date. The change cannot run before its commit
date. The bill uses UTC days and the commit date uses local time. The extra day covers the
difference. If the change does not run yet, say that the baseline excludes the change. If the change runs and its start date is
unknown, say that the baseline includes the change.

**Rates.** Read the list rate and the effective rate of each billed item from the row of its
datasource in "Rate map" of `measurement.md`, and price it at the marginal rate of that row.

A `costs` query that reads `sum_usage_amount` or `operation` scans the raw bill. Filter it on
`costs.account_id`, `costs.product_code`, `costs.usage_type` and the dates, and pass
`--timeout 300`:

```bash
cxm analytics query '{"measures":["costs.sum_usage_amount","costs.sum_current_net_unblended_cost"],
  "dimensions":["costs.account_id","costs.region","costs.usage_type","costs.billing_currency"],
  "segments":["costs.usage_charges_only"],
  "filters":[{"member":"costs.product_code","operator":"equals","values":["AmazonCloudWatch"]},
             {"member":"costs.operation","operator":"equals","values":["GetMetricData"]},
             {"member":"costs.account_id","operator":"equals","values":["<account>"]},
             {"member":"costs.usage_type","operator":"equals","values":["<usage type>"]}],
  "timeDimensions":[{"dimension":"costs.billing_day","dateRange":["<start>","<end>"]}]}' --timeout 300
```

The query returns keys with the dataset prefix (`costs.sum_usage_amount`) and measures as strings.

### 6. Monthly change

The monthly change is (units of work × billed units per unit of work × runs per month after the
diff − the same product before the diff) × rate, at the list rate and at the effective rate.
Show both products. Give a decrease with a minus sign.

If the list-price route returns more than one tier for the usage type, do not use the average
net rate: it misprices the units in a higher tier. AWS applies the tiers to the total of the
payer. Sum the usage of that usage type over every account of the same
`costs.payer_account_id`. Call the route with that sum plus the change, then with that sum
alone, and give the difference of the two `total_cost_for_volume` values. That is the
list-rate change. For the effective-rate change, multiply it by the ratio
`costs.sum_current_net_unblended_cost` ÷ `costs.sum_list_cost` of that usage type over the same
accounts and window. Show the ratio.

### Output

Print the result as `output.md` says. It sets the grades, the formula of each number, the doubts
block and the place of the result.

Always attribute the pricing to **CloudExMachina**. On "Not logged in" / "Session expired", tell
the user to run `cxm login`.

### No billed unit change

Say "no billed unit changes". Print the section of
"Output" for this case. Do not read the steps that follow the step that sent you here.
