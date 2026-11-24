---
name: cxm-cost-of-change
description: Use when the user is writing or reviewing Terraform / IaC, running AWS CLI to create resources, or asking "what will this cost", "what does this code change cost", "price this PR", or the "cost of adding API calls". Estimates the monthly cost of a cloud resource change, or of a code change that adds, removes or multiplies paid API calls, from CloudExMachina's rate catalog and the organization's bill.
---

# Cost of a change (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Step 6 replaces its answer style and its visuals for the result of a code change.

- For a resource with no diff, follow "Price a resource".
- For a diff, read `measurement.md` of this directory, then follow "Price a code change". A resource in the diff is a line of that method. Its rate comes from "Price a resource".

## Price a resource

1. Read the resource spec from the code or the command: service, instance type, region. For RDS also read the engine and Multi-AZ. For ElastiCache also read the engine.
2. Price it. Add `--count N` for several identical resources.
   ```bash
   cxm price --service ec2 --instance-type m5.large --region eu-west-3
   cxm price --service rds --instance-type db.r5.large --region us-east-1 --engine PostgreSQL --deployment Multi-AZ
   cxm price --service elasticache --instance-type cache.r6g.large --region eu-west-1 --engine redis
   ```
   The output has three layers: `on_demand_list`, `committed_1yr` and `committed_3yr`. Each holds `hourly_usd`, `monthly_usd` and `savings_vs_on_demand_pct`.
3. Report the layers as a short ladder:
   - **On-demand (list):** the upper bound.
   - **If committed:** the 1-year and 3-year rates, which the user pays if they reserve that family.
   - **Effective today:** read the discount of the usage account that will run the resource with the discount-rate route ("Pricing routes" of `measurement.md`).
     The net rate is `on_demand × (1 − rows[0].effective_discount_rate_pct ÷ 100)`. Label it and warn as the discount rules of "Rate map" say. With no row, or a null rate, skip this line.
   - **Existing coverage:** the current effective savings rate of this commitment type, from `commitment_this_month_kpi` (`cxm-commitments` skill). It shows how much similar usage is already discounted, so if spare commitment can cover the resource.
   Name which number is a list price, which is a catalog committed rate, and which is the effective rate of the organization.
4. If the family is a previous generation (m5, r5, c5), say that a current one (m7g, r7g) is usually cheaper, and offer to price it.
   For a design critique use `cxm-architecture-review`.

## Price a code change

Answer one question: what range in dollars per month does this diff add or remove?
You choose the lines. Code gives each amount. Do the six steps in this order.

### 1. Capabilities

Fill this table before step 2. Read names and dates only: no quantity, no count and no rate.

| Capability | Read | Value |
|---|---|---|
| Organization | `cxm whoami` | |
| Last bill day of each provider | `cur_reach.latest_day` by `cur_reach.cloud_provider_id`; with no row, today | |
| Providers and products of the bill | the `costs.cloud_provider_id` and `costs.product_code` values in the window of step 4, with no measure | |
| Datasets | `cxm analytics schema` | |
| Pricing routes | one `search` call of "Pricing routes" of `measurement.md`, with a product code of the bill | |
| Last inventory crawl | the latest `inventory_crawl_manifest.sync_time` | |

When a command fails, find its text here. An `unmeasured` input that a line needs is a coverage entry of step 5, with the failed command as its source.

| The command prints | Meaning | Do this |
|---|---|---|
| `Not logged in`, `Session expired` | no session, or HTTP 401 | Tell the user to run `cxm login`. Stop. |
| `Session expired` for one dataset, and `cxm whoami` works | HTTP 403 | `unmeasured (no access: <dataset>)` |
| `Access denied` | HTTP 403 of a route | `unmeasured (no access: <path>)` |
| `429` as the status | too many requests | Wait 30 seconds. Run it once more. Then `unmeasured (429)`. |
| `5xx` as the status, or `timed out` | the platform did not answer | Run it once more. Then `unmeasured (<error>)`. |
| `"rows": []` of a dataset | no row | Compare the filter with the schema once. Then `unmeasured (no rows in <dataset>)`. |
| `No dataset matches`, `not found for path` | unknown dataset or field | Use a listed name. With no listed name, `unmeasured (no dataset: <name>)`. |
| `failed: 404` or `failed: 422` of a pricing route | see "Pricing routes" of `measurement.md` | Follow the branch of the 404 or of the `detail.code`. |
| other text | the read failed | `unmeasured (<error>)` |

An error or an empty answer is never 0. It is never proof that a target does not run the code.

### 2. Scope

Describe the change from `git diff` and the files at the commit. Never read the pull request of the change, its title, body, comments or reviews, because its text is a claim and not a measure.
Run `git diff <base>...HEAD` for commits. For an uncommitted change, run `git diff HEAD` and read each untracked file.
Read only the checkout of the change, the folder of this skill and the CXM skill files that this file names. Do not list or read another folder of the machine, a shell profile or another checkout. You can read the results that the harness saved for this session.

1. Read the full diff. List each changed file that runs in production or in CI. A test, a doc, a type or a translation moves no line, except CI time when a CI workflow changes.
2. For each added, removed or changed code path, write each call, resource, task or job that a provider bills. A free control-plane call makes no line.
3. Follow each changed code path up to its trigger: schedule, request, event, CI or person. Note each flag, setting or tag that decides if the path runs, in the diff or in a caller, and read its default in the code.
4. Follow a helper call one level. A line exists when the diff gives the helper the billed work: a query, an object, a list of items. Work that a helper does by itself to load configuration, secrets or credentials makes no line.
5. List each deployment target that runs the code, as "Money rules" of `measurement.md` says. A target that the session cannot read is an `uncovered_target` entry. It does not lower the grade. Never claim that a target is not deployed.
6. Give each line a `key` as "Keys" of `measurement.md` says, one tag, one direction and one target. Write one line for each key, tag, direction and target. It names each of its triggers. A quantity that is a sum holds its terms in `ref`.
7. Run the List and Mark check of "Billing dimensions" of `measurement.md`. It reads names only.
8. Read the list again against the diff once. Remove a line with no `file:line` of the diff. Add a line that you missed.
9. Print the list before any read of a quantity, a count or a rate: write it as text in a message to the user, before the first command that reads one. A thought, a file, a plan or a command output is not a message.
   Write one line for each entry: `key | tag | direction | target | trigger | file:line@sha`. For an uncommitted file, use the sha of HEAD and add a `doubt`. Then go on to step 3 and wait for no answer.
10. Do not add a line after the list, except a line that a measure proves. Name that line in a `doubt`.

#### Tag

Use the first that applies.

1. `commitment`: the code buys a reservation or a plan, or returns one. A purchase that the code only checks, delays or refuses makes no line.
2. `llm`: model tokens.
3. `flag-gated`: each path to the code needs a flag whose default is off. When one path needs no flag, the line is not flag-gated; the gated path gets its own line.
4. `one-off`: the code runs once or a person runs it for one deployment, such as a migration, a backfill or a check before or after the deployment.
5. `added-runtime`: extra time on a task, a worker or a job definition that exists before the change, also when the change gives it one more item, step or workflow. Compute is `direct` only when the diff adds a new task, job or service definition.
6. `indirect`: another system bills as a reaction: key management, log lines that the code writes, events, the network path, files that a provider writes by itself, such as query results. The use that a commitment replaces is its own `indirect` line.
7. `direct`: the diff states the billed work. The storage of an object has the tag of the call that writes it.

#### Direction

Directions: `add`, `remove`.
When the diff replaces work, write one `add` line and one `remove` line.
When the diff multiplies the same work, write one `add` line for the difference. When it decreases the same work, write one `remove` line for the difference.

### 3. Bound

If the list is not yet in a message, stop and print it.

Give each line a ceiling in dollars per month, from the code and from the bill rows of the window of step 4.

- A ceiling of 0 is a `not_billed` entry. A line with no rate or no source is an `unmeasured` entry. Both leave the lines.
- The headline lines are the `direct` and `commitment` lines.
- When the ceiling is below $1/mo and below 10 percent of the sum of the ceilings of the headline lines, stop. Spend no more lookups on that line.
- A stopped line keeps 0 to its ceiling. Write the 0 as the `low` of its quantity factor, with the grade and the source kind of the ceiling.
- After step 4, the weight of a line is its ceiling, or its measured high. When a stopped headline line holds 10 percent or more of the weight of the headline lines, measure it.

### 4. Measure

Use one window for each read that has a date: a bill row, a usage or metric row, and a CI run list. The window is the 30 full days that end 2 days before the earliest commit date (`git log --format=%cs <base>..HEAD`) of the diff, or 2 days before the last bill day, whichever is earlier. For an uncommitted change, use the last bill day. Read nothing after the window.
Give each of these reads a fixed start date and a fixed end date, in each step, also when its cell of the source map shows no end date. Use no relative range. Write each date as a literal in the query itself, never through a shell variable, a loop or a script. A "latest day" cell takes the latest day of the window.
A dataset that holds only the state of today, such as the inventory or the prices, has no date: read it as it is.

For each line that step 3 did not stop:

- Take each factor from its row of the source map of `measurement.md`. Read the cells from A to D, and use the first cell that gives the factor.
- When a CxM cell and a local cell both give the factor, use the CxM cell.
- A cell that gives only a ceiling does not give the factor. Use it only when no other cell does.
- Use the `scoped_accounts_only` cell only for code that runs with the read role of the platform. For other code, start at the account list of the code, then the bill.
- A quantity from a bill row is grade B only when the usage type or the asset shows no other caller. Else it is a ceiling with grade C.
- Take each rate from the rate map, and follow "Money rules", "Grades" and "Units" of `measurement.md`.
- A deterministic lookup uses the `cxm` command. An operation that needs thinking uses the central CxM MCP when the session holds it. When the session does not hold it, write an `unmeasured` entry that says that the MCP was not reachable, and give no figure.

### 5. Compute

Send the lines and the coverage to the command through a quoted heredoc. Replace each value of this example:

```bash
cxm cost-result <<'EOF'
{"schema_version": 2, "organization": "example-org", "lines": [
  {"id": "L1", "key": "aws/amazons3/write-requests", "target": "job-a, account-a, region-a", "item": "put of each report", "at": "src/example/report.py:41@0123abc", "tag": "direct", "direction": "add", "factors": [
    {"low": 6, "high": 6, "unit": "run/day", "grade": "C", "source": {"kind": "code", "ref": "src/example/schedule.py:9@0123abc"}}, {"constant": "day_per_mo"},
    {"low": 100, "high": 300, "unit": "request/run", "grade": "D", "source": {"kind": "assumption", "ref": "one report for each item, 100 to 300 items"}}, {"constant": "thousand", "of": "request"},
    {"low": 0.01, "high": 0.02, "unit": "$/krequest", "grade": "B", "source": {"kind": "dataset", "ref": "costs{net cost, usage; usage type; dates} as low, list-price route as high"}}]},
  {"id": "L2", "key": "aws/amazoncloudwatch/storage", "target": "job-a, account-a, region-a", "item": "archive of the removed debug log", "at": "src/example/report.py:57@0123abc", "tag": "direct", "direction": "remove", "factors": [
    {"low": 0.1, "high": 0.1, "unit": "GB/day", "grade": "B", "source": {"kind": "dataset", "ref": "costs{usage; asset; dates}, the only writer"}},
    {"low": 14, "high": 14, "unit": "day", "grade": "C", "source": {"kind": "code", "ref": "src/example/logs.tf:3@0123abc"}},
    {"low": 0.05, "high": 0.05, "unit": "$/GB*mo", "grade": "A", "source": {"kind": "route", "ref": "list-price?service_code=<code>&usage_type=<usage type>"}}]}],
 "coverage": [{"kind": "uncovered_target", "what": "job-a, account-b", "why": "the session holds no bill of account-b", "source": {"kind": "dataset", "ref": "costs{account_id; dates}: no row"}}]}
EOF
```

Coverage kinds: `uncovered_target`, `unmeasured`, `not_billed`, `doubt`.
Each entry holds `kind`, `what`, `why` and `source`.

- Write no amount and no total. A change with no line has an empty `lines` list.
- When `costs.billing_currency` is not USD, use no bill rate. Use the USD list rate as the high and 0 as the low, with a `doubt`. With no USD rate, the line is an `unmeasured` entry. Convert no currency.
- Exit code 1 prints one fault per line. Fix each fault that it names and send again, three runs in total. Never delete a line to remove a fault: correct it, or write it as coverage.
- When the shell does not find the command, when it prints `Usage: cxm <command>`, or when three runs leave a fault, the result is not computed. Say so, print the lines and the faults, and print no total.

### 6. Answer

1. Write one sentence that names CloudExMachina, the organization and the window of step 4.
2. Print the section of step 5 after it, complete and unchanged. Copy each of its lines. Add no figure, no chart and no second summary.
3. The section holds the counts, the rates and the source kinds. Answer a question about units, counts or rates with the section. Write no table and no total of your own. A total over several tags is a figure that code did not compute: never write one.

The caller decides where the result goes.
