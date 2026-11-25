# Measurement for the cost-of-change skill

This file sets how the skill gets each input of a code change. The skill tries every source that it can
reach, in rung order, before it prints `unmeasured`. Print the grade and the source of each value as
`output.md` says.

## Ladder

Try the rungs in this order. Each rung gives the grade of `output.md` on the same line.

| Rung | Grade | Try |
|---|---|---|
| 1 | A | A measure in the target: run history, a live metric, an object listing, crawled inventory, a catalog price. |
| 2 | B | The bill: usage and cost rows of the accounts of the target. State the attribution in the citation. |
| 3 | C | The code: cron, loop bound, page size, default argument, pinned library default. |
| 4 | D | An assumption: give its basis, a low value and a high value. |

## Stop rule

- **S1.** Try the sources of the source map in rung order. Use the first value that a rung gives.
- **S2.** Print `unmeasured` only when every rung failed, or when the source does not exist for the
  organization. Print it with the error text of the attempted query, or with the proof that the source
  does not exist. The error of a pricing route, as "Pricing routes" of `SKILL.md` sets, is such an error
  text. A source that the source map marks "not available yet" does not exist: the source map is the
  proof. A source that you can reach and did not try forbids `unmeasured`.
- **S3.** Skip a source whose own measurement costs more than 10 % of the current estimate. Name the
  skip in the doubts block.
- **S4.** A required count not attempted fails the run. Such a run prints only the FAILED line of
  `output.md`, then the structured block.
- **S5.** Stop when every input is A, B or C, or D with a basis and a range.

## Required counts

Each unit of work needs the counts of its row. Attempt each count through its row of the source map.

| Unit of work | Required counts |
|---|---|
| once per run | Runs per month |
| per request | Requests per month |
| per CI run | CI runs per month, CI minutes per run |
| per account, per account and region | Accounts, Runs per month |
| per asset | Assets per account and region, Accounts, Runs per month |
| per GitHub org | GitHub orgs, Runs per month |

A required count that every rung failed to give prints as `unmeasured`, with the error text of each
rung, as S2 says.

## Rate map

Each datasource has one row. The rate is the marginal rate: what one more unit adds after the included
allowance, the tiers, the commitments and the negotiated discount. A datasource with no row prints
`unmeasured (no rate rule: <datasource>)`. The rate map is the proof that no source exists (S2).

| Datasource | Quantity measure | Usage dimension | List rate | Effective rate | Service terms and marginal-rate rule |
|---|---|---|---|---|---|
| AWS | `costs.sum_usage_amount` | `costs.usage_type` | The list-price route, for the usage type of the region of the API endpoint [A]. | `costs` net cost ÷ usage per usage type, with the `usage_charges_only` segment [B]. The discount-rate route when the usage type has no usage [B]. | The AWS rules below. |
| GitHub | `github_costs.sum_quantity` | `github_costs.sku` | `github_costs.sum_gross_amount` ÷ `sum_quantity` per `sku` [B]. | `github_costs.sum_net_amount` ÷ `sum_quantity` per `sku` [B]. | Never `costs.sum_list_cost`: it equals the net amount for GitHub. When `sum_discount_quantity` is below `sum_quantity` by more than 0.1 % in the billing period, the included allowance is used up, and the marginal unit bills at the list rate. Otherwise the floor is 0 and the ceiling is the list rate. The effective amount of "Monthly change" uses the marginal rate: the list rate when the allowance is used up, else 0 to the list rate. Cite net ÷ quantity as the average only. |

**AWS rules**

- Prefer the rate the account pays: net cost ÷ usage per usage type from `costs`. Otherwise use
  the list-price route with `volume_amount`. Quote `total_cost_for_volume` for a tiered cost, never
  `applicable_tier` × the whole volume. For a change on top of current usage, price the current
  usage plus the change, and the current usage alone, and give the difference. Show the formula.
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
  line. For another datasource, follow its row of the rate map.
- Print each amount with 2 significant digits at least, and the billed units beside it.
- Tiers: "Monthly change" of `SKILL.md` applies them to the total of the payer.
- Commitment: when a usage type has `costs.pricing_term` = `OnDemand` usage in the window, the marginal
  unit bills at the on-demand rate. When all its usage is `Reserved`, give 0 as the floor and the
  on-demand rate as the ceiling. Add the doubt that the use of a commitment is known over its life only
  (`commitments.lifetime_usage_rate`).

## Source map

Cite each value that the inventory gives as "latest inventory, crawled at <date of the last crawl>". Read
the date from `inventory_crawl_manifest` (`sync_time`, latest, for the table of the asset type). An
inventory value that you cite this way is a source, not a doubt.

One row for each input. A rung that shows "none" has no source: go to the next rung. A source that shows
"not available yet" needs a measurement route that does not exist today: skip it, and say so in the
doubts block. `<usage type>`, `<window>` and the filters are those of the lookup in `SKILL.md`.

| Input | A | B | C | D |
|---|---|---|---|---|
| Runs per month | `gh run list --workflow <file> --created ">=<date 30 days ago>" --limit 1000 --json createdAt`, then count the rows. A count equal to the limit is a floor: raise the limit and run again. Scheduler and task metrics, audit log and job log lines: not available yet. | Days with usage in `costs` (`billing_day`). A ceiling only for a job that runs at most once a day, never the run count: the bill names no caller. For any other job this cell gives no value. | Cron at `file:line@sha`. | Basis, low value, high value. |
| Accounts | `costs` with segment `scoped_accounts_only`, for the accounts with rows in the window. | Distinct `costs.account_id` of the usage type. | List in the code or in its configuration, at `file:line@sha`. | none |
| Assets per account and region | `assets{count; asset_type; inventory_status is live; account_id; region}`, with the date of the count. | Distinct `costs.asset_id` that have cost rows in the window. | none | none |
| Regions | Distinct `assets.region` of the asset type. Listing or manifest of the outputs: not available yet. | Distinct `costs.region` of the usage type. | Region list in the code. Local run of the planner over public inputs. | none |
| Pages | Pages of one account and region: ⌈`assets{count}` of that account and region ÷ page size⌉, at least 1 when the code calls it. The page size is a C factor. | none | Pages of one account and region: ⌈item count of that account and region ÷ page size⌉, at least 1 when the code calls it. Both from the code. | Basis, low value, high value. |
| Bytes per query | `ProcessedBytes` ÷ `SampleCount` per workgroup: not available yet. | `costs{sum_usage_amount}` of the query service, by workgroup ÷ runs. | Table sizes from inventory: not available yet. | The 10 MB minimum of one query, as a floor. |
| Bytes scanned | `IncomingBytes` per log group: not available yet. | `costs{sum_usage_amount}` on the usage types that end in `DataProcessing-Bytes`, by `asset_arn`. | none | Basis, low value, high value. |
| Object sizes | Percentiles of an S3 prefix: not available yet. | From `metrics_aws_s3_buckets`, on the latest day, for one bucket (`arn`), by `metric_name` and `storage_type`: the `average` of `BucketSizeBytes` ÷ the `average` of `NumberOfObjects`. The bytes are the sum of the storage types other than `AllStorageTypes`. `NumberOfObjects` is under the storage type `AllStorageTypes`. Limits: an average of the whole bucket, one value per day. A prefix of the bucket is an analog (G2). | `TransferConfig` in the code, else the pinned default of the library. | Basis, low value, high value. |
| Flag state | The connected flag service: not available yet. | none | Default value in the code. | Basis, low value, high value. |
| GitHub orgs | Datasources of the organization: not available yet. | Distinct `github_costs.org` in the window. | none | none |
| Units a job iterates over | Count in the logs or in the outputs of the job: not available yet. | Distinct accounts of the provider cost view: `costs` or `github_costs`. | Loop bound in the code. | Basis, low value, high value. |
| Requests per month | `lambda_functions.sum_request_count` of the function, in the window. Behind a load balancer: `metrics_aws_elbv2_load_balancers.sum`, where `metric_name` is `RequestCount`, for one `arn`, in the window. Limit: per load balancer, not per route. | A usage type in `costs` that counts requests: `costs{sum_usage_amount}` of that usage type, in the window. | Request count or rate that the code sets, at `file:line@sha`. | Basis, low value, high value. |
| CI runs per month | `gh run list --workflow <file> --created ">=<date 30 days ago>" --limit 1000 --json createdAt,event`, then count every row of the workflow, whatever its event. A count equal to the limit is a floor: raise the limit and run again. Count the rows of each `event` as one trigger: `schedule` is a schedule, `workflow_dispatch` is an operator action. This is a local read of the CI history that the user already holds. | Days with usage in `github_workflow_costs` (`usage_date`) for the workflow. It is the CxM-side source of the same count. A ceiling only for a workflow that runs at most once a day. For any other workflow this cell gives no value. | Cron at `file:line@sha`: it counts the schedule trigger only, never an operator action. | Basis, low value, high value. |
| CI minutes per run | none | `github_workflow_costs.billable_minutes` ÷ the runs of the same window ("CI runs per month"), per workflow and SKU. | `timeout-minutes` at `file:line@sha`, as a ceiling. | Basis, low value, high value. |
| Task time | not available yet | `costs.sum_usage_amount` by `costs.asset_id`, `costs.usage_type` and `costs.billing_day`, which gives hours per usage type. Use the usage types that contain `-Hours`. `costs.asset_id` is the ARN of one task run. Do not use `costs.asset_arn`: it is empty for a task run that the inventory does not hold. Limit: vCPU-hours and GB-hours, not the elapsed time. The elapsed time is the vCPU-hours ÷ the vCPU of the task. Read the vCPU at `file:line@sha`. | The timeout of the task at `file:line@sha`, as a ceiling. | Basis, low value, high value. |

## Billing dimensions

A change can move more than one billing dimension. A log line is billed at ingestion, then as storage for
its retention, then by each query that scans it. List the dimensions of each service before you price one.

For each service that the change touches (a call, a resource it creates, or data it writes):

1. **List.** Read two sources. First, the usage types that the organization pays today for the product
   code in the target accounts: `costs.usage_type`, grouped. Second, the catalog usage types of the service
   and region: the list-price `search` call of `SKILL.md`. The catalog shows a dimension that the bill does
   not show yet. Write no dimension from memory.
2. **Mark.** Mark each dimension `moved` or `not moved`, with a one-line reason and a citation. A change
   moves a dimension directly (the call or the resource itself) or through what it produces (data that it
   writes is ingested, then stored, then read). Price only the calls, resources and compute that the code of the diff makes. A call that the running system makes in response to the change's traffic (the app's own calls, its database reads, the logs it writes, the load balancer in front of it) is indirect: name it in a doubt with its driver, never in a result line.
3. **Drive.** Name the driver of each moved dimension and its unit (bytes, hours, requests, GB-month).
   Measure the driver with the source map.
4. **Store.** For a stored dimension, price the steady state: daily volume × the retention days. Read the
   retention from the code or the infrastructure code (`file:line@sha`). When no retention is set, use a
   D factor with a low value and a high value.
   Use the volume that the storage usage type bills. When a service stores a different volume than it
   ingests (for example, compressed log storage), read the ratio of stored to ingested bytes from the bill
   of the same resource (`costs.asset_arn`). When the bill of that resource gives no ratio, use a D factor
   with a low value and a high value.
5. **Read.** For a dimension billed by the volume that a call reads, take the bytes per run as the sum of
   the bytes that the resources it reads ingested in the read window. For log groups, read
   `costs.sum_usage_amount` by `costs.asset_arn` on the ingestion usage type.
6. **Compare.** Compare each moved dimension that has a C result with the bill of its usage types, before
   and after the merge or deploy date (G3 of `output.md`). The before window is the baseline window of
   the baseline step of `SKILL.md`. The after window starts at the deploy date, or at the commit date when
   the deploy date is unknown. It ends at the latest bill day, and the volume is scaled to 30 days. Both
   windows use the same accounts, regions and usage types. Compare the sizes, without their signs. When the
   bill change is zero or has the opposite sign of the code value, apply no cap: keep C and print
   `bill: gap`. Print the comparison as a citation with the first outcome that holds:
   1. Bill noise. The bill noise is the spread of the daily usage in the baseline window without its
      single highest day, scaled to 30 days. A single spike day is not noise: name it in a doubt. When the
      predicted change is below that noise, print `change below the bill noise of <usage type>`. The bill
      gives no confirmation, and the result keeps C.
   2. Bill cap. When the code value is more than 20 % above the bill change, the bill caps the result
      line. The line takes the bill change × its rate [B] as a ceiling, and the headline adds up the lines
      as usual. The code value goes into a doubt.
   3. `confirmed within ±20 %`: C becomes B.
   4. When the code value is more than 20 % below the bill change, the result keeps C, and the gap is a
      doubt.

   G3 holds in every outcome. A larger gap is a doubt. An A value then applies. A B value from the bill
   stays a ceiling. When the change does not run yet, no after window exists. Keep C and name the missing
   window in a doubt. Print `bill: none`. End the result line with its outcome as `output.md` says:
   `bill: noise`, `bill: cap`, `bill: confirmed` or `bill: gap`.
7. **Print.** Print the dimensions table as `output.md` says. Print one dimensions table for each service
   that a result line names. A result line with no dimensions table for its service is not finished.
