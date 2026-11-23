# Output of the cost-of-change skill

This file sets the format of every result of the skill. A result shows each number with a grade, a
formula and a source. Print the result as one markdown section headed `### Cost of this change`.
The caller decides where the result goes. The skill never reads or writes a pull request.
End the answer with the structured block that "Structured block" sets.

## Grades

Give each number one grade. The grade says how the number was obtained.

| Grade | Name | What qualifies |
|---|---|---|
| A | Measured in the target | Live metric, run history, object listing or manifest, audit log, crawled inventory or metrics that are 7 days old or less. A catalog list price. |
| B | Measured from the bill | Usage and cost rows of the accounts of the target, an effective rate, the discount-rate route. The citation states the attribution. |
| C | Derived from code | Cron, loop bound, page size, default argument, pinned library default, a local run over public inputs. |
| D | Assumed | No source above. The citation gives its basis, a low value and a high value. |

`unmeasured` is not a grade. Print `unmeasured` only as the rest of this skill allows.

### Grade rules

- **G1.** A product or a sum takes the lowest grade of its factors.
- **G2.** A value that was measured on one target and is used for another drops one grade. Cite it
  as "analog of `<target>`".
- **G3.** A C value that an independent A or B source confirms within ±20 % becomes B. A larger
  gap is a doubt. An A value then applies. A B value from the bill stays a ceiling, as steps 4 and 6
  of `SKILL.md` say.
- **G4.** Print a floor or a ceiling as a bound. If ceiling ÷ floor is more than 3, the result is
  C at best. A floor of 0 that a free allowance sets is exempt from this ratio.
- **G5.** A D factor makes the result D. An assumption is a D factor: it cites its basis and gives
  a low value and a high value. The headline prints the low–high range.
- **G6.** The total takes the lowest grade of the targets that hold 10 % or more of it. A target
  with an unknown run status makes the total a floor, C at best.
- **G7.** A catalog rate is A. A bill effective rate is B. A discount-rate route is B. An assumed
  discount is D.

## Format of the result

```
### Cost of this change

**<payer>: <±$list>/mo list, <±$effective>/mo effective, grade <G>**
Organization: <name>. <floor or ceiling label, when one applies>

| Target | Runs here? | Δ list /mo | Δ effective /mo | Grade |
|---|---|---|---|---|

**Result lines**
<id> <target> <item> = <amount> [<grade>] = <factor> <unit> [<grade>:<cite>] × <factor> <unit> [<grade>:<cite>] …

**Doubts**
1. <assumption or unknown> — effect: <low>–<high or unmeasured> $/mo — resolve: <dataset, route, tool or owner>.

<details><summary>Citations</summary>
<cite> <value> <unit> = <formula over cites or constants> ; <source> [<grade>]
</details>
```

- Print one headline for each payer and each currency. Never add two currencies.
- A decrease takes a minus sign.
- Until the skill reads more than one deployment target, the target table has one row: the session
  organization.
- Print each result line with its whole formula. Each factor carries `[<grade>:<cite>]`.
- A citation holds its own formula, and the cites and sources of that formula. Follow the chain
  down to a leaf source.
- Label each floor and each ceiling.
- This format names datasets, routes and filters on purpose, so that a reviewer can run each lookup
  again.

### Source forms

A leaf source has one of five forms:

- `file:line@sha`: a line of code at a commit.
- `dataset{measures; filters; window}`: a dataset query. Give the dates of the window.
- `route?params`: a call to a route of the API.
- `tool(params)`: a call to a tool.
- `public:<url>@<date>`: a public page, with the date of the read.

### Doubts

The doubts block always prints. Each doubt names an assumption or an unknown. It gives its effect
in $/mo as a low and a high value. The high value is `unmeasured` when no source gives it. Each doubt says how to resolve it: a dataset, a route, a tool
or an owner. When no factor is C or D, no bound applies, no input is `unmeasured` and no G3 gap exists, print this
line in place of the list:

`No doubt: every factor is A or B.`

### Unmeasured inputs

- Print an input that you cannot read as `unmeasured`, never as a number. If one input of the
  session organization is `unmeasured`, print the per-line amounts and no monthly total. The
  `unmeasured` row of the other organizations does not block the total of the session organization.

### A failed run

When the skill must stop because a required count did not run, print only this line, then the structured block:

**FAILED: required count not run: <count> (unit of work: <unit>).**

Print no table, no result line and no doubts block. Until the skill names a required count, no run fails: print a failed query as `unmeasured`.

### No billed unit change

Print the section with these parts:

1. The line "no billed unit changes". Print no cost, no monthly total and no rate.
2. The count before and after the diff, each with its grade and its citation.
3. The doubts block. In this case, give the effect of each doubt in billed units per run, not in $/mo.

## Worked example

A change adds one scheduled CI job. The job runs a log query on the staging account. The example
shows two payers, so it has two headlines. It also shows two targets of the cloud payer.
The rows for other targets wait for the deployment-target step. Until then, the skill prints only the
row of the session organization.

**Staging AWS account: +$0.064/mo list, $0–0.064/mo effective, grade B**
**CI provider organization: +$4.19 per 30 days list, grade C**
Organization: the session organization.

| Target | Runs here? | Δ list /mo | Δ effective /mo | Grade |
|---|---|---|---|---|
| the staging account, one region | yes [A: 22 runs in 30 days, CI run history] | +$0.064 | $0–0.064 | B |
| production and other tenants | no [C: both callers assume the staging reader role and pass the staging region] | $0 | $0 | C |
| the CI provider, two workflows | yes [A: CI run history] | +$4.19 per 30 days | +$4.19 per 30 days | C |

**Result lines**
- `R1 staging Logs query = $0.064/mo [B] = 21.74 runs/mo [B:c1] × 0.50 GB/run [B:c4] × $0.0059/GB [A:c6]`
- `R2 CI provider <log watch workflow> = $0.349 per 30 days [B] = 69.8 billed min [B:c7] × $0.005/min [B:c9]`
- `R3 CI provider <nightly E2E workflow> = $3.84 per 30 days [C] = 768.5 billed min [C:c8] × $0.005/min [B:c9]`

**Doubts**
1. A window with 10,000 rows or more scans both halves again (`<script>.py:176@<sha>`) — effect: 0–0.064 $/mo, at most one more scan of both halves — resolve: count the "hit the row limit" warnings in the CI logs.
2. The free tier is account-wide, so the effective cost is $0 to $0.064 — effect: 0–0.064 $/mo — resolve: read the free-tier usage of the payer account.
3. The production row is C until a CloudTrail count of the job exists — effect: 0–0.064 $/mo — resolve: count the job calls in the audit log of the production account.
4. The nightly job changed after the merge, so its minutes are an analog. Its timeout went from 40 min (`<workflow>.yml:<line>@<sha>`) to 60 min (`<workflow>.yml:<line>@<sha>`). The analog overstates the minutes of the merged job by one third at most. That is 768.5 × 1/3 = 256 min, at $0.005/min [B:c9] — effect: –1.28 to 0 $/mo — resolve: read `github_workflow_costs` again 30 days after the change.

<details><summary>Citations</summary>

- `c1 21.74 = 5 × 365.25 ÷ 7 ÷ 12 ; cron "30 5 * * 1-5" at <workflow>.yml:15@<sha> [C] ; confirmed by 22 runs in 30 days [A] → B`
- `c2 36 h = 12 h window (<workflow>.yml:54@<sha>) + 24 h baseline (<script>.py:216@<sha>) [C]`
- `c3 0.0139 GB/h = 9.99 GB ÷ 30 ÷ 24 ; costs{sum_usage_amount; EUW3-DataProcessing-Bytes; asset_arn under the 3 prefixes of <script>.py:231@<sha>; 2026-10-20..2026-11-18} [B]`
- `c4 0.50 GB/run = c2 × c3 [C] ; bill difference +11.75 GB/mo against 10.9 GB/mo predicted, within ±20 % → B`
- `c6 $0.0059/GB = /pricing/aws/list-price?service_code=AmazonCloudWatch&usage_type=EUW3-DataScanned-Bytes [A]`
- `c7 69.8 min = CI minutes per run × CI runs per month ; github_workflow_costs{billable_minutes; workflow is <log watch workflow>; 2026-10-20..2026-11-18} [B]`
- `c8 768.5 min = CI minutes per run × CI runs per month ; github_workflow_costs{billable_minutes; workflow is <nightly E2E workflow>; 2026-10-20..2026-11-18} [B] ; analog per G2, because the job changed after the merge → C`
- `c9 $0.005/min = $0.349 ÷ 69.8 min = $3.84 ÷ 768.5 min ; github_workflow_costs{gross_amount, billable_minutes; both workflows; 2026-10-20..2026-11-18} [B] ; the marginal rate is the list rate, because the included minutes are used up`

</details>

## Structured block

End the answer with exactly one fenced block whose info string is `cxm-cost-result`. The block holds
one JSON object that follows `cost-result.schema.json` in this directory. Build it from the same
values as the markdown section. Print no figure in it that the section does not print.
Read `cost-result.schema.json` before you write the block.

- `schema_version` is the number 1.
- Each amount is `{"low": <number>, "high": <number>, "unit": "<unit>"}`. This holds for
  `headlines[].list`, `headlines[].effective`, `targets[].amounts.list`, `targets[].amounts.effective`
  and `results[].amount`. A single value has `low` equal to `high`. Only `targets[].amounts` and
  `results[].amount` may be the text `unmeasured` in place of this object.
- Each `citations` value is `{"value": <number>, "unit": "<unit>", "formula": "<text>", "source": "<text>", "grade": "<A to D>"}`.
- A factor `value` is a number or `unmeasured`.
- `status` is `priced`, `no_billed_unit_change` or `failed`.
- Make one `headlines` entry for each headline, one `targets` entry for each row of the table, one
  `results` entry for each result line with its `factors`, one `citations` key for each cite, and one
  `doubts` entry for each doubt. When the section prints "No doubt", `doubts` is an empty list.
- A factor that the section prints as `unmeasured` has the value `unmeasured` and a `reason`. It has
  no grade and no cite.
- A target row that the table prints as `unmeasured` has the value `unmeasured` in `amounts.list` and
  `amounts.effective`.
- For a failed run, set `status` to `failed` and fill `failed`. Leave `headlines`, `targets`,
  `results`, `doubts` and `citations` empty.
- For no billed unit change, leave `headlines` and `targets` empty. `results` holds the count before
  and the count after the diff. Each amount and each doubt effect is in billed units per run.

The skill does not validate or publish this block. The caller does.
