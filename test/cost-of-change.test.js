// The skill text keeps the branches, routes and stop rules that its pricing steps rely on.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateCostResult } from '../src/lib/cost-result.js';
import { orgApi } from '../src/lib/http.js';

const skillDir = new URL('../skills/cxm-cost-of-change/', import.meta.url);
const read = (name) => readFileSync(new URL(name, skillDir), 'utf8');
const skillOnly = read('SKILL.md');
const output = read('output.md');
const measurement = read('measurement.md');
const skill = `${skillOnly}\n${output}\n${measurement}`;
const config = { baseUrl: 'https://example.test', organizationId: 'org', accessToken: 't' };

async function failWith(status, body) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
  try {
    await orgApi(config, 'GET', '/pricing/aws/list-price?service_code=AmazonS3');
    assert.fail('orgApi must throw on a failed route');
  } catch (err) {
    return err.message;
  } finally {
    globalThis.fetch = real;
  }
}

test('a route that is not deployed prints 404, and the skill prints unmeasured for it', async () => {
  const message = await failWith(404, { detail: 'Not Found' });
  assert.match(message, /failed: 404\./);
  assert.match(skill, /HTTP 404[^\n]*unmeasured \(route not deployed\)/);
});

test('a pricing 422 prints detail.code first, and the skill names a branch for each code', async () => {
  const message = await failWith(422, { detail: { error: true, code: 'no_price_found', message: 'x'.repeat(400) } });
  assert.match(message, /failed: 422\. \{"detail":\{"error":true,"code":"no_price_found"/);
  for (const code of ['no_price_found', 'no_usage_type_found', 'ambiguous_usage_type', 'too_many_products',
    'no_aws_datasource', 'unknown_service_id']) {
    assert.ok(skill.includes(`\`${code}\``), `the skill has no branch for ${code}`);
  }
});

test('the skill calls both pricing routes and never reads the commitment-fee dataset for a discount', () => {
  assert.ok(skill.includes('cxm api GET "/pricing/aws/list-price?'), 'list-price route');
  assert.ok(skill.includes('cxm api GET "/pricing/aws/discount-rate?'), 'discount-rate route');
  assert.ok(!skill.includes('commitment_edp_monthly'), 'commitment_edp_monthly covers commitment fees only');
});

test('the skill stops only when nothing about the cost changes, and keeps its count and rate rules', () => {
  assert.match(skill, /accounts, regions and asset type that the call\s+iterates over\. If one of them changes, or the diff moves a billing dimension, continue/);
  assert.match(skill, /If a dataset returns no rows, print `unmeasured \(no rows in <dataset>\)`/);
  assert.match(skill, /AWS applies the tiers to the total of the\s+payer/);
  assert.match(skill, /If the diff adds, removes and multiplies no paid call and moves no billing dimension, go to "No billed unit change"/);
  assert.match(skill, /If the change does not run yet, say that the baseline excludes the change/);
  assert.match(skill, /With no row, or a null rate, skip this line/);
  assert.match(skill, /returns no row, or a null rate, use a discount of 0/);
  assert.match(skill, /the\s+payer and the usage type of every call/);
  assert.match(skill, /after the\s+diff − the same product before the diff/);
  assert.match(skill, /### No billed unit change\n\nSay "no billed unit changes"[^#]*Print the section of\n"Output"/);
  assert.match(skill, /`costs\.sum_current_net_unblended_cost` ÷ `costs\.sum_list_cost`/);
  assert.ok(skill.includes('"member":"costs.account_id"'), 'raw-bill example filters the account');
});

test('every result line carries grades and citations, and the doubts block always prints', () => {
  const names = { A: 'Measured in the target', B: 'Measured from the bill', C: 'Derived from code', D: 'Assumed' };
  for (const [grade, name] of Object.entries(names)) assert.ok(output.includes(`| ${grade} | ${name} |`), `grade ${grade}`);
  for (const rule of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']) assert.ok(output.includes(`**${rule}.**`), `rule ${rule}`);
  assert.ok(output.includes('[<grade>:<cite>]'));
  assert.ok(output.includes('The doubts block always prints.'));
  assert.ok(output.includes('No doubt: every factor is A or B.'));
  assert.ok(output.includes('<details><summary>Citations</summary>'));
  assert.ok(output.includes('**FAILED: required count not run: <count> (unit of work: <unit>).**'));
  const none = output.slice(output.indexOf('### No billed unit change'), output.indexOf('## Worked example'));
  assert.ok(none.includes('"no billed unit changes"'));
  assert.match(none, /count before and after the diff, each with its grade and its citation/);
  assert.ok(none.includes('The doubts block. In this case, give the effect of each doubt in billed units per run, not in $/mo.'));
});

test('the runs-per-month step gives the runs-per-month factor with its grade and cron citation', () => {
  const step7 = skillOnly.slice(skillOnly.indexOf('. **Runs per month.**'), skillOnly.indexOf('. **Accounts.**'));
  assert.ok(step7.includes('21.74 runs/mo [C:c1]'));
  assert.ok(step7.includes('@<sha>'));
});

test('the skill returns its result and never reads or writes a pull request', () => {
  for (const name of readdirSync(skillDir)) assert.doesNotMatch(read(name), /\bgh (pr|api)\b|--body-file/, `${name} names a pull request command`);
  assert.ok(skill.includes('The caller decides where the result goes.'));
  const pointer = skillOnly.slice(skillOnly.indexOf('### Output'));
  assert.ok(pointer.includes('Print the result as `output.md` says.'));
});

test('the skill ends its answer with one cxm-cost-result block', () => {
  assert.ok(output.includes('exactly one fenced block whose info string is `cxm-cost-result`'));
  assert.ok(output.includes('`cost-result.schema.json`'));
  assert.ok(output.includes('Read `cost-result.schema.json` before you write the block.'));
  assert.ok(output.includes('"low"'));
  assert.ok(output.includes('"effect_low": <number>'));
  assert.ok(output.includes('The block of the worked example. Give every field it shows.'));
  const example = output.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(example, 'output.md holds no json example of the block');
  assert.deepEqual(validateCostResult(JSON.parse(example[1])), []);
  assert.ok(output.includes('print only this line, then the structured block:'));
  assert.equal(JSON.parse(read('cost-result.schema.json')).properties.status.enum.length, 3);
});

test('the shared rules name a structured result, not a pull request body', () => {
  const shared = readFileSync(new URL('../skills/cxm-shared-rules.md', import.meta.url), 'utf8');
  assert.ok(shared.includes('Exception for a structured result or a document that a caller publishes'));
  assert.ok(!shared.includes('pull request body'));
});

const phrase = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));

test('the skill prints unmeasured only from the stop rule', () => {
  for (const rule of ['S1', 'S2', 'S3', 'S4', 'S5']) assert.ok(measurement.includes(`**${rule}.**`), `stop rule ${rule}`);
  const map = measurement.slice(measurement.indexOf('## Source map'));
  const rows = ['Runs per month', 'Accounts', 'Assets per account and region', 'Regions', 'Pages', 'Bytes per query', 'Bytes scanned',
    'Object sizes', 'Flag state', 'GitHub orgs', 'Units a job iterates over'];
  for (const row of rows) assert.ok(map.includes(`\n| ${row}`), `source map row ${row}`);
  assert.equal(map.split('\n').filter((line) => line.startsWith('| ')).length, rows.length + 1, 'the source map holds the 11 rows and a header');
  assert.match(measurement, /error text of the attempted query/);
  assert.ok(measurement.includes('latest inventory, crawled at <date of the last crawl>'));
  const row = (name) => map.split('\n').find((line) => line.startsWith(`| ${name}`));
  assert.ok(row('Pages').includes('of that account and region'));
  assert.ok(!measurement.includes('Σ over account and region'));
  assert.ok(row('Runs per month').includes('--created') && row('Runs per month').includes('A count equal to the limit is a floor'));
  for (const order of ['print the runs per month as `unmeasured`', 'print the account count as `unmeasured`',
    'If the code cannot bound the page count, print it as `unmeasured`',
    'Print the bytes per query as `unmeasured`, and give the floor runs × 10 MB × rate', 'print the region count as `unmeasured`']) {
    assert.doesNotMatch(skill, phrase(order), order);
  }
  const code = skillOnly.slice(skillOnly.indexOf('## Price a code change'));
  assert.ok(code.indexOf('measurement.md') > 0 && code.indexOf('measurement.md') < code.indexOf('1. **Organization.**'));
});

test('a required count that was not attempted fails the run', () => {
  const counts = measurement.slice(measurement.indexOf('## Required counts'), measurement.indexOf('## Source map'));
  for (const count of ['Accounts', 'Assets per account and region', 'GitHub orgs', 'Runs per month']) assert.ok(counts.includes(count), count);
  assert.ok(measurement.includes('A required count not attempted fails the run.'));
  assert.match(measurement, phrase('prints only the FAILED line of `output.md`, then the structured block.'));
  assert.match(skillOnly, phrase('per account and region, per asset, per GitHub org, or per request'));
  assert.doesNotMatch(skill, phrase('print the per-line amounts and no monthly total'));
});

test('the skill lists every deployment target before it names a payer', () => {
  const code = skillOnly.slice(skillOnly.indexOf('## Price a code change'));
  const targets = code.indexOf('. **Deployment targets.**');
  assert.ok(targets > 0 && targets < code.indexOf('. **Payer.**'), 'Deployment targets comes before Payer');
  const step = code.slice(targets, code.indexOf('. **Payer.**'));
  assert.ok(step.includes('Runs here? unknown — no access: <error>'));
  for (const source of ['`deploys` edge', "git tag --list 'deploy/*' --contains <file-sha>", '`gh run list`', '`costs` and `assets`']) assert.ok(step.includes(source), source);
  assert.match(step, phrase('A target that is not attempted fails the run'));
  assert.match(step, phrase('names the missing datasource'));
  assert.ok(output.includes('| Target | Runs here? |') && output.includes('`runs_here.value`'));
  assert.doesNotMatch(code, phrase('Print the cost for each other organization'));
  assert.match(code, phrase('A schedule and a run count never come from it.'));
  for (const sentence of ['`<file-sha>` is `git log -1 --format=%H <base> -- <file>`.',
    'For a file that the diff adds, run the same command on the file of its deployable unit.',
    'A job, image or schedule with no run yet, such as one that the diff adds before merge, takes its Runs here? from code or configuration (C).',
    'An empty release history never gives no.',
    'A target row counts only the units of work that the code deployed on that target reaches: its accounts of step 8, its regions and assets of step 9. Never count the units of another target. The total is the sum of the rows.',
    'Keep a row for each candidate target, also when its answer is no: it prints $0, with the grade of its evidence. Never drop a candidate target from the table.',
    'Answer from the run history of the window: count the runs that reached the call. Never answer from one run.',
    'A count of 0 gives no only when the schedule of the code fires inside the window. If the schedule fires less often, or the job runs on an event, answer from code or configuration (C).',
    'A no needs grade C or better. A no that rests on an assumption (D) is `unknown`: print it as `unknown [D: <basis>]`, and the total becomes a floor (G6).']) assert.match(step, phrase(sentence), sentence);
  assert.match(output, phrase('`no` takes grade A, B or C.'));
  assert.match(code, phrase('Do not take a schedule, a run count or an account list from a node that only matches by name.'));
  assert.doesNotMatch(output, phrase('production and other tenants'));
  assert.doesNotMatch(output, phrase('Until the skill reads more than one deployment target'));
  assert.doesNotMatch(output, phrase('wait for the deployment-target step'));
});

test('the skill lists every billing dimension of a service before it prices one', () => {
  const start = measurement.indexOf('## Billing dimensions');
  assert.ok(start > 0, 'measurement.md has no section "## Billing dimensions"');
  const dims = measurement.slice(start).split(/\n## /)[0];
  assert.ok(dims.includes('`costs.usage_type`'), 'the bill lists the dimensions');
  assert.match(dims, phrase('list-price `search` call'));
  assert.ok(dims.includes('`moved`') && dims.includes('`not moved`'));
  assert.match(dims, phrase('daily volume × the retention days'));
  assert.match(dims, phrase('(`file:line@sha`)'));
  assert.match(dims, phrase('D factor'));
  assert.match(dims, phrase('`costs.sum_usage_amount` by `costs.asset_arn`'));
  assert.match(dims, phrase('Print the dimensions table as `output.md` says.'));
  assert.ok(output.includes('| Dimension | Moved? | Reason | Driver | Grade |'), 'output.md holds the dimensions table');
  assert.ok(output.includes('List every dimension that the bill and the catalog give'));
  const finished = 'Print one dimensions table for each service that a result line names. A result line with no dimensions table for its service is not finished.';
  assert.match(dims, phrase(finished));
  assert.match(output, phrase('print one dimensions table for each service that a result line names'));
  assert.match(output, phrase('A result line with no dimensions table for its service is not finished.'));
  assert.match(output, phrase('For a log query, the service is the log service: list ingestion, storage and query scan.'));
  assert.match(output, phrase('For object storage, this includes request tiers, storage and data transfer, in the table of that service.'));
  assert.ok(dims.includes('1. Bill noise.') && dims.indexOf('1. Bill noise.') < dims.indexOf('2. Bill cap.') && dims.indexOf('2. Bill cap.') < dims.indexOf('3. `confirmed within ±20 %`'));
  assert.match(dims, phrase('the bill caps it. The headline takes the bill value [B] as a ceiling'));
  assert.match(dims, phrase('Compare each moved dimension that has a C result with the bill of its usage types, before and after the merge or deploy date (G3 of `output.md`).'));
  for (const outcome of ['`confirmed within ±20 %`', '`change below the bill noise of <usage type>`', 'A larger gap is a doubt.',
    'An A value then applies.', 'A B value from the bill stays a ceiling.']) assert.match(dims, phrase(outcome), outcome);
  assert.match(output, phrase('A larger gap is a doubt. An A value then applies. A B value from the bill stays a ceiling'));
  const paid = skillOnly.slice(skillOnly.indexOf('. **Paid calls.**'), skillOnly.indexOf('. **Deployment targets.**'));
  assert.ok(paid.includes('"Billing dimensions" of `measurement.md`'), 'step 2 points to the section');
  const indirect = skillOnly.match(/- List each call that the diff causes indirectly[^]*?(?=\n- |\n\n)/)[0];
  assert.ok(indirect.includes('Billing dimensions'), 'the indirect-calls line points to the section');
});
