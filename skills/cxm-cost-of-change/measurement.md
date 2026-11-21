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
  `output.md`.
- **S5.** Stop when every input is A, B or C, or D with a basis and a range.

## Required counts

Each unit of work needs the counts of its row. Attempt each count through its row of the source map.

| Unit of work | Required counts |
|---|---|
| once per run, per request | Runs per month |
| per account, per account and region | Accounts, Runs per month |
| per asset | Assets per account and region, Accounts, Runs per month |
| per GitHub org | GitHub orgs, Runs per month |

A required count that every rung failed to give prints as `unmeasured`, with the error text of each
rung, as S2 says.

## Source map

One row for each input. A rung that shows "none" has no source: go to the next rung. A source that shows
"not available yet" needs a measurement route that does not exist today: skip it, and say so in the
doubts block. `<usage type>`, `<window>` and the filters are those of the lookup in `SKILL.md`.

| Input | A | B | C | D |
|---|---|---|---|---|
| Runs per month | `gh run list` of the workflow that runs the job, over 30 days. Scheduler and task metrics, audit log and job log lines: not available yet. | Days with usage in `costs` (`billing_day`). A ceiling, never the run count: the bill names no caller. | Cron at `file:line@sha`. | Basis, low value, high value. |
| Accounts | `costs` with segment `scoped_accounts_only`, for the accounts with rows in the window. | Distinct `costs.account_id` of the usage type. | List in the code or in its configuration, at `file:line@sha`. | none |
| Assets per account and region | `assets{count; asset_type; inventory_status is live; account_id; region}`, with the date of the count. | Distinct `costs.asset_id` that have cost rows in the window. | none | none |
| Regions | Distinct `assets.region` of the asset type. Listing or manifest of the outputs: not available yet. | Distinct `costs.region` of the usage type. | Region list in the code. Local run of the planner over public inputs. | none |
| Pages | `assets{count}` of the asset type ÷ the page size. The page size is a C factor. | none | Page size × count, both from the code. | Basis, low value, high value. |
| Bytes per query | `ProcessedBytes` ÷ `SampleCount` per workgroup: not available yet. | `costs{sum_usage_amount}` of the query service, by workgroup ÷ runs. | Table sizes from inventory: not available yet. | The 10 MB minimum of one query, as a floor. |
| Bytes scanned | `IncomingBytes` per log group: not available yet. | `costs{sum_usage_amount}` on the usage types that end in `DataProcessing-Bytes`, by `asset_arn`. | none | Basis, low value, high value. |
| Object sizes | Percentiles of an S3 prefix: not available yet. | Storage bytes ÷ object count: not available yet, because no dataset holds the object count. | `TransferConfig` in the code. | Pinned default of the library. |
| Flag state | The connected flag service: not available yet. | none | Default value in the code. | Basis, low value, high value. |
| GitHub orgs | Datasources of the organization: not available yet. | Distinct `github_costs.org` in the window. | none | none |
| Units a job iterates over | Count in the logs or in the outputs of the job: not available yet. | Distinct accounts of the provider cost view: `costs` or `github_costs`. | Loop bound in the code. | Basis, low value, high value. |
