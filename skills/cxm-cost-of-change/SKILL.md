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
        discount rules of "Rate rules" say. With no row, or a null rate, skip this line.
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

1. **Organization.** Run `cxm whoami` and name the organization of the session. Say that the
   answer covers this organization only. Print the cost for each other organization that the code
   reaches as `unmeasured`.
2. **Paid calls.** Read the diff (`git diff <base>...HEAD`). Find each paid call that the diff
   adds, removes or multiplies. A call to a third-party service is a paid call. For each paid call,
   name the API operation, the payer, the unit of work and the asset type that the call iterates
   over. The unit of work is once per run, per account, per account and region, per asset, or per
   request. If the diff adds, removes and multiplies no paid call, go to "No billed unit change".
3. **Payer.** A call with a role in another account bills that account. A call with the platform
   credentials bills the platform account. If the session organization does not hold the bill of
   the payer, print each input that needs that bill as `unmeasured`.
4. **Billed units per unit of work.** Count them from the request that the code sends, never from
   stored data. Follow "Billed units". Then compare these inputs before and after the diff: the
   payer and the usage type of every call, the billed units of every call, the unit of work, the
   runs per month, the row filters, and the accounts, regions and asset type that the call
   iterates over. If one of them changes, continue to step 5. A change of payer is a removal on
   the old payer and an addition on the new payer: give each one a subtotal. If all of them stay the same, show the count before and after, and go to "No billed
   unit change". For example, a diff removes 2 of 4 statistics of a metric, or changes the batch
   size and keeps one page.
5. **Runtime node.** Find the runtime node and the image of the changed code with the
   `cxm-repo-graph` skill. Do not take a schedule or an account list from a node that only matches
   by name, or from a `deploys` edge.
6. **Runs per month.** Take them from the schedule that the code declares, and cite its file and
   line. A weekday cron such as `0 4 * * 1-5` gives 5 × 365.25 ÷ 7 ÷ 12 = 21.74 runs per month; a
   daily cron gives 30.44. Use the bill only as a ceiling: the bill names no caller. If no schedule
   is readable, print the runs per month as `unmeasured`. Never infer a run count from the bill.
7. **Accounts.** For code that runs with the CXM crawler's roles, take the accounts from the
   `scoped_accounts_only` segment of `costs`: the accounts where the crawler has read access, among
   those with cost rows in the window. Do not take only the accounts where the bill shows the call
   now. For other code that calls into other accounts, take the accounts from the list that the
   code or its configuration declares, with file and line. Else print the account count as
   `unmeasured`.
8. **Assets.** Count the affected assets per account and region with `assets`. Filter
   `assets.asset_type` on the inventory table that the code iterates over, and
   `assets.inventory_status` on `live`. Print the date of the count.
9. **Row filters.** Apply each filter that the code puts on the rows before the call. For the
   metrics crawler, read the `source_filter`, `min_stored_bytes` and `max_dimension_values` of the
   service entry in `aws_services_metrics.yml`, and cite file and line. Filter `assets` on the
   column that `source_filter` names when `assets` has it. Cap each account-region count at
   `max_dimension_values`. Label the count a ceiling when `assets` cannot express a filter
   (`min_stored_bytes`).
10. **Baseline.** Read the current usage and cost of the same usage type per account and region
    with `costs`, over the 30 full days before `cur_reach.latest_day`. `cur_reach.latest_day` is a
    measure, not a dimension: query it as `{"measures":["cur_reach.latest_day"],"filters":[{"member":
    "cur_reach.cloud_provider_id","operator":"equals","values":["aws"]}]}`. If the change already
    runs in the organization, end the window 2 days before the commit date of the change
    (`git log --format=%cs -1 <commit>`). Cite that date. The change cannot run before its commit
    date. The bill uses UTC days and the commit date uses local time. The extra day covers the
    difference. If the change does not run yet, say that the baseline excludes the change. If the change runs and its start date is
    unknown, say that the baseline includes the change.
11. **Rates.** Read the effective rate from `costs` as net cost ÷ usage per usage type, with the
    `usage_charges_only` segment. Read the list rate with the list-price route, for the usage type
    of the region of the API endpoint. Follow "Rate rules".
12. **Monthly change.** (units of work × billed units per unit of work × runs per month after the
    diff − the same product before the diff) × rate, at the list rate and at the effective rate.
    Show both products. Give a decrease with a minus sign. For a usage type with more than one
    tier, follow the tier rule of "Rate rules".
13. **Report.** Follow "Output".

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

### Rate rules

- Prefer the rate the account pays: net cost ÷ usage per usage type from `costs`. Otherwise use
  the list-price route with `volume_amount`. Quote `total_cost_for_volume` for a tiered cost, never
  `applicable_tier` × the whole volume. For a change on top of current usage, price the current
  usage plus the change, and the current usage alone, and give the difference. Show the formula.
- If the list-price route returns more than one tier for the usage type, do not use the average
  net rate: it misprices the units in a higher tier. AWS applies the tiers to the total of the
  payer. Sum the usage of that usage type over every account of the same
  `costs.payer_account_id`. Call the route with that sum plus the change, then with that sum
  alone, and give the difference of the two `total_cost_for_volume` values. That is the
  list-rate change. For the effective-rate change, multiply it by the ratio
  `costs.sum_current_net_unblended_cost` ÷ `costs.sum_list_cost` of that usage type over the same
  accounts and window. Show the ratio.
- Copy the usage type verbatim from a `costs` row. Do not add or strip a region prefix. If the bill
  has no row for it, find it with the `search` call.
- Map an API operation to its usage type from a `costs` row that holds both. If no row of the
  organization holds the pair, search the catalog. If the search finds nothing, print the rate as
  `unmeasured`.
- Take the unit from the `unit` that the route returns. Group usage by `costs.usage_type`. Do not
  add the usage of two usage types.
- Do not subtract a free tier. If the effective rate is lower than the list rate after the
  discount, give 0 as the floor and the list rate as the ceiling.
- Say that the effective rate excludes credits, refunds, reseller discounts and tax.
- For a usage type with usage, the rate the account pays is already net of EDP/PRA. Apply no
  discount on top of it.
- For a usage type with no usage, read the negotiated discount with the discount-rate route for
  the usage account. Apply `rows[0].effective_discount_rate_pct` ÷ 100 to the list rate. Label it
  "blended over <product code>, latest billing month within 45 days". The route does not return
  the month. Never carry the discount to another account or product code.
- If the discount-rate route returns no row, or a null rate, use a discount of 0. Print the
  warning "no discounted usage of <product code> in <account> in the last 45 days", and label the
  result a ceiling.
- Report each amount in its `costs.billing_currency`. Do not add two currencies. The list-price
  route returns USD: compare a list rate with an effective rate, or set a floor and a ceiling from
  them, only when `costs.billing_currency` is USD. Otherwise print the list rate in USD on its own
  line. The routes cover AWS only. For another cloud, print the list rate as `unmeasured`.
- Print each amount with 2 significant digits at least, and the billed units beside it.

### Billed units

- GetMetricData bills up to 5 statistics of one metric in one request as one metric. Billed
  metrics per asset = the sum of ⌈statistics ÷ 5⌉ per metric. A metric with 4 statistics bills 1;
  removing 2 of its 4 statistics changes 0 billed metrics. A change of batch size, period or time
  window changes no billed metric, unless it changes the number of pages. If the code can put
  the statistics of one metric in two requests, the metric bills once in each request. Count
  ⌈statistics ÷ 5⌉ per request in that case.
- A requested metric with no data still bills.
- Count each page of a paged response as one more request with the same billed units. If the code
  cannot bound the page count, print it as `unmeasured`.
- Price the success path. Print the retry count of the code as a ceiling only.
- The query service (product code `AmazonAthena`) bills each query's scan rounded up to the next
  MB, with a 10 MB minimum. Print the bytes per query as `unmeasured`, and give the floor
  runs × 10 MB × rate.
- List each call that the diff causes indirectly, such as a KMS `Decrypt` for each S3 `GetObject`
  on a key-encrypted bucket without a bucket key. Price it, or print it as `unmeasured`.

### Count rules

- If a dataset returns no rows, print `unmeasured (no rows in <dataset>)`. If a query fails,
  print `unmeasured (<error>)`.
- If the code calls in each enabled region, print the region count as `unmeasured`, and give the
  regions in `assets` or `costs` as a lower bound.
- Code behind a flag that is off costs 0 as merged. Give the cost when enabled on its own line.
- Do not claim a decrease larger than the current cost of that usage type in the payer accounts.
- A token count per model call and a request count per route are not in a dataset. The exceptions
  are `lambda_functions.sum_request_count` and a usage type in `costs` that counts requests. For a
  model call, give the rate and the per-call formula, or "cannot price" for a model outside the bill.
- Price a third-party metered service in three steps. First run `cxm price --datasource` with no
  value. It lists the `datasources` that have a published rate. Pick the datasource of the service of
  the call. If the listing returns `no_rate_found`, or no listed datasource is the service of the call,
  print `unmeasured (no published rate: <service>)`. Then run `cxm price --datasource <datasource>`.
  It lists the `dimension`, `unit` and `billing_period` of each published rate. The dimension is the
  billed item of the datasource, for example a sku, a model or a plan. If `limit_reached` is true on
  the datasource listing or on the dimension listing, say that the list is cut. Pick the dimension and
  the unit of the call from that list. Then run
  `cxm price --datasource <datasource> --dimension <dimension> --unit <unit> [--quantity <n>]`. Read
  `unit_rate_usd`, `unit`, `billing_period` and `rate_source` from the answer, and cite
  `rate_source`. The rate is the average billed rate of that billing period. Before you multiply,
  state the quantity of the change in the published `unit`, and show the conversion in the input
  table of "Output". If you cannot convert the quantity to that unit, print
  `unmeasured (unit: <unit>)`. Then multiply the quantity by the rate in your formula. If the
  dimension listing or the rate answer is `no_rate_found`, print `unmeasured (no published rate: <datasource>)`.

### No billed unit change

Say "no billed unit changes". Print no cost, no monthly total and no rate. Print the section of
"Output" with this line and the count before and after. Do not read the steps that follow the step
that sent you here.

### Output

- Print one line first: the monthly change at the list rate and at the effective rate, the payer,
  and the organization. Then print a table with one row per input: the value, its dataset or route,
  its filter and its window (dates). Label each floor and each ceiling. This table names datasets,
  routes and filters on purpose, so that a reviewer can run each lookup again.
- Print an input that you cannot read as `unmeasured`, never as a number. If one input of the
  session organization is `unmeasured`, print the per-line amounts and no monthly total. The
  `unmeasured` row of the other organizations does not block the total of the session organization.
- Print the result as one markdown section headed `### Cost of this change`. If a pull request of
  the current branch exists (`gh pr view`), add the section to its body with
  `gh pr edit --body-file`, and keep the rest of the body. Otherwise print the section for the
  pull request author to paste. If the body already has a `### Cost of this change` section,
  replace it. The section ends at the next heading of level 3 or less, or at the end of the body.
  Add a section only when the body has none. Add it at the end of the body.

Always attribute the pricing to **CloudExMachina**. On "Not logged in" / "Session expired", tell
the user to run `cxm login`.
