// The skill text keeps the branches, routes and stop rules that its pricing steps rely on.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
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
  assert.match(skill, /accounts, regions and asset type that the call\s+iterates over\. If one of them changes, continue/);
  assert.match(skill, /If a dataset returns no rows, print `unmeasured \(no rows in <dataset>\)`/);
  assert.match(skill, /AWS applies the tiers to the total of the\s+payer/);
  assert.match(skill, /If the diff adds, removes and multiplies no paid call, go to "No billed unit change"/);
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

test('step 6 gives the runs-per-month factor with its grade and cron citation', () => {
  const step6 = skillOnly.slice(skillOnly.indexOf('6. **Runs per month.**'), skillOnly.indexOf('7. **Accounts.**'));
  assert.ok(step6.includes('21.74 runs/mo [C:c1]'));
  assert.ok(step6.includes('@<sha>'));
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
