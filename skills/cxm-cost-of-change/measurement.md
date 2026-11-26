# Measurement

## Keys

`key` is `<provider>/<service>/<dimension>`, in lower case.

- The provider is the `costs.cloud_provider_id` of the bill. For a provider that the bill does not hold, use its name, with words joined by `-`.
- The service is the product code of the bill of the session (`costs.product_code`), in lower case, with words joined by `-`.
- When the bill holds no such product, copy its name from "Services". Use `other` for a product that the list does not hold, and name the product in `item`.
- The dimension is one of "Dimensions". Write no other dimension.

### Dimensions

- `write-requests`: put, post, copy and list calls.
- `read-requests`: get and head calls.
- `api-requests`: each other billed call.
- `data-scanned`: the volume that a query scans.
- `data-transfer`: the volume that leaves a network, a zone or a region.
- `data-processed`: the volume that a service transforms or forwards.
- `ingestion`: the volume that a service takes in.
- `storage`: the bytes that a service keeps, per month.
- `compute-time`: the time of a task, a function, an instance or a service that runs work.
- `asset-time`: the time that an asset exists, when the bill charges for its existence: an endpoint, a web ACL, a key, a dashboard, a metric, a monitored identity.
- `ci-minutes`: the billed minutes of a CI runner.
- `commitment-fee`: the fee of a reservation or a plan.
- `tokens`: the input and output tokens of a model.
- `events`: each event, message or notification that a service bills.

### Services

- `aws`: `amazons3`, `amazonathena`, `awsglue`, `amazoncloudwatch`, `amazonecs`, `amazonecr`, `amazonec2`, `amazoneks`, `awslambda`, `awskms`, `awsqueueservice`, `amazonsns`, `awsevents`, `amazonstates`, `amazonrds`, `amazondynamodb`, `amazonelasticache`, `amazonredshift`, `amazonefs`, `amazonkinesis`, `amazonkinesisfirehose`, `amazonapigateway`, `amazoncloudfront`, `amazonroute53`, `amazonvpc`, `awselb`, `awsdatatransfer`, `awscloudtrail`, `awsxray`, `awssecretsmanager`, `amazonbedrock`, `computesavingsplans`
- `github`: `actions`, `github_actions`, `packages`, `git-lfs`, `copilot`
- each other provider: `model-api`, `object-storage`, `database`, `data-warehouse`, `compute`, `observability`, `messaging`, `ci`, `other`

## Grades

| Grade | Meaning | Source kind |
|---|---|---|
| A | A direct measure, or a list price. | `dataset`, `route`, `tool`, `public` |
| B | The bill. | `dataset`, and `route` for the discount-rate route |
| C | The code, or a ceiling that the bill gives. | `code`, and `dataset` for a bill ceiling |
| D | An assumption, with its basis, a low and a high. | `assumption` |

- The cell of the source map and the mark of the rate map give the grade. The ceiling rule of step 4 of `SKILL.md` comes first.
- A rate from the bill is B.
- A quantity that is only a ceiling has 0 as its `low`, unless another source gives the low.
- A factor that uses two sources takes the lower grade and the kind of that source. Its `ref` holds both lookups.
- A value that you measured on one target and use for another drops one grade. Put "analog of <target>" in `ref`. Never do it for a target that has its own bill rows for that usage type. An analog of a C value is an assumption: use D.
- `ref` holds the lookup: `file:line@sha`, `dataset{measures; filters; dates}`, `route?params`, `tool(params)` or `public:<url>@<date>`. Add the formula when the value has one.

## Gaps

Use the first that applies.

- `no_access`: the session cannot read the source.
- `no_dataset`: no source holds the quantity.
- `no_asset_row`: the bill has no row for the asset.
- `no_caller_split`: the source mixes the callers.
- `no_history`: the window has no data.
- `assumed_ratio`: a share or a size is assumed.
- `future_volume`: the count depends on later activity.
- `other`: none of these.

## Units

A unit is `<atom>*<atom>/<atom>*<atom>`, with `1` for an empty numerator. The units of a line reduce to `$/mo`, or to `$` for `one-off`. The constants, which hold no grade and no source:

- `h_per_min`: minutes to hours (h/min).
- `h_per_mo`: 730.5 hours per month (h/mo).
- `day_per_mo`: 30.4375 days per month (day/mo).
- `week_per_mo`: weeks per month (week/mo).
- `million`: needs `"of": "<atom>"`, and gives M<atom>/<atom>.
- `thousand`: needs `"of": "<atom>"`, and gives k<atom>/<atom>.

Rules:

- Write each atom as one exact word, in the singular: `run` and `runs` do not cancel.
- Use a constant and never a typed conversion. The `day/mo` factor of the retention rule is the one exception.
- Retention is a `day` factor on a `GB/day` volume. On a `GB/mo` volume, add the retention as a `day` factor and a `day/mo` factor of 30.4375 with `"divide": true`, grade A, kind `public`, `ref` "calendar: 365.25 / 12".
- Write `GB*mo` and never `GB-Mo`, also when the route prints `GB-Mo`. Write `h` for `Hrs`.
- Use the unit `1` for a share or a discount. The factor of a discount of 20 percent is 0.8.
- For an hourly price, use `hourly_usd` × `h_per_mo`, and never `monthly_usd`. `cxm price` is a lookup of the rate catalog: use grade A and kind `dataset`.
- A total of the 30-day window becomes a `/day` factor: total ÷ 30, with both terms in `ref`. Then use `day_per_mo`.
- A grade D factor has a `low` below its `high`.
- `"activity": true` makes the calculator take half of the low and twice the high. Use it on one factor of a line at most, and never on a `$` factor or a constant.
- `"shared": "<text>"` makes lines take the same end of a factor. The same text needs the same low, high, unit, grade and `activity`. Use at most 4 different texts.
- A `$` factor comes only from a dataset, a route or a public source.

## Billing dimensions

Check each service of the list.

1. **List.** Read two sources, names only, with no measure. First, the `costs.usage_type` values that the bill holds for the product code in the target accounts, in the window of step 4 of `SKILL.md`. Second, the catalog usage types of the service and region: the `search` call of "Pricing routes". Write no dimension from memory.
2. **Mark.** Mark each dimension `moved` or `not moved`, with a one-line reason and `file:line`. A change moves a dimension directly (the call or the resource itself) or through what it produces (data that it writes is ingested, then stored, then read). A moved dimension that the list does not hold becomes a line. Its tag comes from "Tag" of `SKILL.md`. A dimension that is not moved makes no line.

## Pricing routes

Quote the path: it holds `?` and `&`.

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
  pass `costs.payer_account_id` in place of a different `costs.account_id`. The route returns `rows` and
  `row_count`, with at most one row. The row holds `effective_discount_rate_pct`, a percent, null
  when the list price is 0. With no row it also returns `product_code_verified` and
  `suggested_action`.

A failed route prints `Org API GET <path> failed: <status>.` and the start of the JSON body.

- On HTTP 422, read `detail.code` and follow it:
  - `no_price_found`: the filter did not match. It is never a zero price. Search the catalog.
  - `no_usage_type_found`: search once with other words. Then the line is `unmeasured (no_usage_type_found: no usage type matched the search)`.
  - `ambiguous_usage_type`: take the rate from the `costs` row of that usage type. Else the
    line is `unmeasured (ambiguous_usage_type: several prices share this usage type)`.
  - `too_many_products`: use `cxm price --instance-type` for an instance. Else the line is `unmeasured`.
  - `no_aws_datasource`: the organization holds no AWS bill. Each input that needs it is
    `unmeasured`. Do not call the route again.
  - `unknown_service_id`: copy `product_code` from a `costs` row and call once again.
  - Any other code, or a discount-rate error: `unmeasured (<code>: <reason>)`, where
    `<reason>` says in plain words what failed, from `detail.message`.
  - A validation 422 carries a list in `detail` and no code: fix the parameter.
- On HTTP 404 from either route, each input that needs it is `unmeasured (route not deployed)`.
- A missing price or a failed discount lookup is never 0.

## Money rules

- **Rate.** When a rule of the rate map gives a floor and a ceiling, they are the `low` and the `high` of the rate factor.
- Else, when a line has a list rate and an effective rate (the rate that the account pays), the rate factor holds the lower one as `low` and the higher one as `high`.
- **Tiers.** When the list-price route returns more than one tier, do not use the average net rate. AWS applies the tiers to the total of the payer. Sum the usage of that usage type over every account of the same `costs.payer_account_id`.
- Call the route with that sum plus the change, then with that sum alone. For a `remove`, call it with that sum, then with that sum minus the change.
- The marginal list rate is the difference of the two `total_cost_for_volume` values ÷ the change. The marginal effective rate is that rate × the ratio `costs.sum_current_net_unblended_cost` ÷ `costs.sum_list_cost` of that usage type over the same accounts and window. Put the ratio in `ref`.
- **Raw bill.** A `costs` query that reads `sum_usage_amount` or `operation` scans the raw bill. Filter it on `costs.account_id`, `costs.product_code`, `costs.usage_type` and the dates, use the `usage_charges_only` segment, and pass `--timeout 300`. Measures come back as strings.
  `cxm analytics query '{"measures":["costs.sum_usage_amount","costs.sum_current_net_unblended_cost"],"dimensions":["costs.account_id","costs.usage_type","costs.billing_currency"],"segments":["costs.usage_charges_only"],"filters":[{"member":"costs.account_id","operator":"equals","values":["<account>"]},{"member":"costs.product_code","operator":"equals","values":["<product code>"]},{"member":"costs.usage_type","operator":"equals","values":["<usage type>"]}],"timeDimensions":[{"dimension":"costs.billing_day","dateRange":["<start>","<end>"]}]}' --timeout 300`
- **Last bill day.** `cur_reach.latest_day` is a measure, not a dimension. Group it by `cur_reach.cloud_provider_id`.
- **Payer.** A call with a role in another account bills that account. A call with the credentials of the platform bills the platform account. A change of payer is a `remove` on the old payer and an `add` on the new payer.
- When the session does not hold the bill of the payer, each input that needs that bill is `unmeasured`.
- **Request.** Count the billed units from the request that the code sends, never from stored data.
- Apply each filter that the code puts on the rows before the call. A filter that `assets` cannot express makes the count a ceiling.
- A metric-data request bills each metric once for each 5 statistics: ⌈statistics ÷ 5⌉ per metric and request. A metric with no data also bills.
- **Page.** Each page of a paged response is one more request with the same billed units. A change of batch size, period or time window moves billed units only when it changes the number of pages or of requests.
- Price the success path. Name the retry count of the code in a `doubt`.
- **Query.** The query service (product code `AmazonAthena`) bills the scan of each query rounded up to the next MB, with a 10 MB minimum.
- **CI.** A CI job is CI runs per month × CI minutes per run × the rate. Count each trigger of the workflow.
- **Storage.** Price the steady state: the daily volume × the retention days. Use the volume that the storage usage type bills.
- When a service stores a different volume than it ingests, read the ratio of stored to ingested bytes from the bill of the same resource (`costs.asset_arn`). With no ratio, or with no retention in the code, use a D factor.
- **Read window.** The bytes of a read are the sum of the bytes that the resources it reads ingested in the read window. For log groups, read `costs.sum_usage_amount` by `costs.asset_arn` on the ingestion usage type.
- **Decrease.** A `remove` is never above the current cost of that usage type in the payer accounts.
- **Regions.** When the code calls in each enabled region, the regions of `assets` or `costs` are a lower bound: name it in a `doubt`.
- **Targets.** Find the deployable unit of each changed file: a CI workflow, an image, an infrastructure resource or a schedule. Count for a target only the units that its own code reaches.
- For infrastructure, follow the `deploys` edges of the `cxm-repo-graph` skill from each workspace that uses the module or the image to its accounts. A target is a workspace × account × region.
- For CI, read the jobs, the schedule, the role variables, the region, the matrix and the environment of the workflow. A target is a job × role × region × matrix entry.
- A `deploys` edge names a candidate target. A schedule, a run count and an account list never come from it, and never from a node that matches only by name.

## Rate map

Each datasource has one row. The rate is the marginal rate: what one more unit adds after the included
allowance, the tiers, the commitments and the negotiated discount. A datasource with no row is an
`unmeasured (no rate rule: <datasource>)` entry. The rate map is the proof that no source exists.

| Datasource | Quantity measure | Usage dimension | List rate | Effective rate | Service terms and marginal-rate rule |
|---|---|---|---|---|---|
| AWS | `costs.sum_usage_amount` | `costs.usage_type` | The list-price route, for the usage type of the region of the API endpoint [A]. | `costs` net cost ÷ usage per usage type, with the `usage_charges_only` segment [B]. The discount-rate route when the usage type has no usage [B]. | The AWS rules below. |
| GitHub | `github_costs.sum_quantity` | `github_costs.sku` | `github_costs.sum_gross_amount` ÷ `sum_quantity` per `sku` [B]. | `github_costs.sum_net_amount` ÷ `sum_quantity` per `sku` [B]. | Never `costs.sum_list_cost`: it equals the net amount for GitHub. When `sum_discount_quantity` is below `sum_quantity` by more than 0.1 % in the billing period, the included allowance is used up, and the marginal unit bills at the list rate. Otherwise the floor is 0 and the ceiling is the list rate. The effective amount uses the marginal rate: the list rate when the allowance is used up, else 0 to the list rate. Cite net ÷ quantity as the average only. |

**AWS rules**

- The rate factor and the tiers: "Money rules" (Rate, Tiers). Quote `total_cost_for_volume` for a tiered cost, never `applicable_tier` × the whole volume.
- Copy the usage type verbatim from a `costs` row. Do not add or strip a region prefix. If the bill
  has no row for it, find it with the `search` call.
- Map an API operation to its usage type from a `costs` row that holds both. If no row of the
  organization holds the pair, search the catalog. If the search finds nothing, the line is an
  `unmeasured` entry.
- Take the unit from the `unit` that the route returns. Group usage by `costs.usage_type`. Do not
  add the usage of two usage types.
- Do not subtract a free tier. If the effective rate is lower than the list rate after the
  discount, give 0 as the floor and the list rate as the ceiling.
- Add one `doubt`: the effective rate excludes credits, refunds, reseller discounts and tax.
- For a usage type with usage, the rate the account pays is already net of EDP/PRA. Apply no
  discount on top of it.
- For a usage type with no usage, read the negotiated discount with the discount-rate route for
  the usage account. Apply `rows[0].effective_discount_rate_pct` ÷ 100 to the list rate. Put
  "blended over <product code>, latest billing month within 45 days" in `ref`. The route does not return
  the month. Never carry the discount to another account or product code.
- If the discount-rate route returns no row, or a null rate, use a discount of 0. Add the
  `doubt` "no discounted usage of <product code> in <account> in the last 45 days: the rate is a
  ceiling".
- The list-price
  route returns USD: compare a list rate with an effective rate, or set a floor and a ceiling from
  them, only when `costs.billing_currency` is USD. Otherwise follow the currency rule of
  step 5 of `SKILL.md`. For another datasource, follow its row of the rate map.
- Commitment: when a usage type has `costs.pricing_term` = `OnDemand` usage in the window, the marginal
  unit bills at the on-demand rate. When all its usage is `Reserved`, give 0 as the floor and the
  on-demand rate as the ceiling. Add the doubt that the use of a commitment is known over its life only
  (`commitments.lifetime_usage_rate`).

## Source map

Cite each value that the inventory gives as "latest inventory, crawled at <date of the last crawl>". Read
the date from `inventory_crawl_manifest` (`sync_time`, latest, for the table of the asset type). An
inventory value that you cite this way is a source, not a doubt.

One row for each input. A cell that shows "none" has no source: go to the next cell. A source that shows
"not available yet" needs a measurement route that does not exist today: skip it, and say so in a
`doubt`. `<usage type>` and the filters are those of "Money rules". `<window>` is the window of step 4 of `SKILL.md`. `<window start>` and `<window end>` are its two dates.

| Input | A | B | C | D |
|---|---|---|---|---|
| Runs per month | `gh run list --workflow <file> --created "<window start>..<window end>" --limit 1000 --json createdAt`, then count the rows. A count equal to the limit is a floor: raise the limit and run again. Scheduler and task metrics, audit log and job log lines: not available yet. | Days with usage in `costs` (`billing_day`). A ceiling only for a job that runs at most once a day, never the run count: the bill names no caller. For any other job this cell gives no value. | Cron at `file:line@sha`. | Basis, low value, high value. |
| Accounts | `costs` with segment `scoped_accounts_only`, for the accounts with rows in the window. | Distinct `costs.account_id` of the usage type. | List in the code or in its configuration, at `file:line@sha`. | none |
| Assets per account and region | `assets{count; asset_type; inventory_status is live; account_id; region}`, with the date of the count. | Distinct `costs.asset_id` that have cost rows in the window. | none | none |
| Regions | Distinct `assets.region` of the asset type. Listing or manifest of the outputs: not available yet. | Distinct `costs.region` of the usage type. | Region list in the code. Local run of the planner over public inputs. | none |
| Pages | Pages of one account and region: ⌈`assets{count}` of that account and region ÷ page size⌉, at least 1 when the code calls it. The page size is a C factor. | none | Pages of one account and region: ⌈item count of that account and region ÷ page size⌉, at least 1 when the code calls it. Both from the code. | Basis, low value, high value. |
| Bytes per query | `ProcessedBytes` ÷ `SampleCount` per workgroup: not available yet. | `costs{sum_usage_amount}` of the query service, by workgroup ÷ runs. | Table sizes from inventory: not available yet. | The 10 MB minimum of one query, as a floor. |
| Bytes scanned | `IncomingBytes` per log group: not available yet. | `costs{sum_usage_amount}` on the usage types that end in `DataProcessing-Bytes`, by `asset_arn`. | none | Basis, low value, high value. |
| Object sizes | Percentiles of an S3 prefix: not available yet. | From `metrics_aws_s3_buckets`, on the latest day, for one bucket (`arn`), by `metric_name` and `storage_type`: the `average` of `BucketSizeBytes` ÷ the `average` of `NumberOfObjects`. The bytes are the sum of the storage types other than `AllStorageTypes`. `NumberOfObjects` is under the storage type `AllStorageTypes`. Limits: an average of the whole bucket, one value per day. A prefix of the bucket is an analog ("Grades"). | `TransferConfig` in the code, else the pinned default of the library. | Basis, low value, high value. |
| Flag state | The connected flag service: not available yet. | none | Default value in the code. | Basis, low value, high value. |
| GitHub orgs | Datasources of the organization: not available yet. | Distinct `github_costs.org` in the window. | none | none |
| Units a job iterates over | Count in the logs or in the outputs of the job: not available yet. | Distinct accounts of the provider cost view: `costs` or `github_costs`. | Loop bound in the code. | Basis, low value, high value. |
| Requests per month | `lambda_functions.sum_request_count` of the function, in the window. Behind a load balancer: `metrics_aws_elbv2_load_balancers.sum`, where `metric_name` is `RequestCount`, for one `arn`, in the window. Limit: per load balancer, not per route. | A usage type in `costs` that counts requests: `costs{sum_usage_amount}` of that usage type, in the window. | Request count or rate that the code sets, at `file:line@sha`. | Basis, low value, high value. |
| CI runs per month | `gh run list --workflow <file> --created "<window start>..<window end>" --limit 1000 --json createdAt,event`, then count every row of the workflow, whatever its event. A count equal to the limit is a floor: raise the limit and run again. Count the rows of each `event` as one trigger: `schedule` is a schedule, `workflow_dispatch` is an operator action. | Days with usage in `github_workflow_costs` (`usage_date`) for the workflow. It is the CxM-side source of the same count. A ceiling only for a workflow that runs at most once a day. For any other workflow this cell gives no value. | Cron at `file:line@sha`: it counts the schedule trigger only, never an operator action. | Basis, low value, high value. |
| CI minutes per run | none | `github_workflow_costs.billable_minutes` ÷ the runs of the same window ("CI runs per month"), per workflow and SKU. | `timeout-minutes` at `file:line@sha`, as a ceiling. | Basis, low value, high value. |
| Task time | not available yet | `costs.sum_usage_amount` by `costs.asset_id`, `costs.usage_type` and `costs.billing_day`, which gives hours per usage type. Use the usage types that contain `-Hours`. `costs.asset_id` is the ARN of one task run. Do not use `costs.asset_arn`: it is empty for a task run that the inventory does not hold. Limit: vCPU-hours and GB-hours, not the elapsed time. The elapsed time is the vCPU-hours ÷ the vCPU of the task. Read the vCPU at `file:line@sha`. | The timeout of the task at `file:line@sha`, as a ceiling. | Basis, low value, high value. |
