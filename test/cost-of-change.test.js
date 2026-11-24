// The skill text and the calculator agree on one contract, and the maps and routes keep what the method relies on.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { computeCostResult } from '../src/lib/cost-lines.js';
import { orgApi } from '../src/lib/http.js';

const skillDir = new URL('../skills/cxm-cost-of-change/', import.meta.url);
const read = (name) => readFileSync(new URL(name, skillDir), 'utf8');
const skillOnly = read('SKILL.md');
const measurement = read('measurement.md');
const skill = `${skillOnly}\n${measurement}`;
const phrase = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
const ticks = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
// The text under one heading, down to the next heading of the same level or above.
function section(text, heading) {
  const out = [];
  let level = 0;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const depth = fenced ? 0 : (/^#+(?= )/.exec(line)?.[0].length ?? 0);
    if (level && depth && depth <= level) break;
    if (level) out.push(line);
    else if (line === heading) level = depth;
  }
  assert.ok(out.some((line) => line.trim()), `no section "${heading}"`);
  return out.join('\n');
}
const STEPS = ['Capabilities', 'Scope', 'Bound', 'Measure', 'Compute', 'Answer'].map((name, i) => `### ${i + 1}. ${name}`);
const step = (name) => section(skillOnly, STEPS.find((heading) => heading.endsWith(` ${name}`)));
function example() {
  const body = /^cxm cost-result <<'EOF'\n([\s\S]*?)\nEOF$/m.exec(step('Compute'));
  assert.ok(body, 'the Compute step holds no quoted heredoc to cxm cost-result');
  return JSON.parse(body[1]);
}
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

test('the shared rules name a structured result, not a pull request body', () => {
  const shared = readFileSync(new URL('../skills/cxm-shared-rules.md', import.meta.url), 'utf8');
  assert.ok(shared.includes('Exception for a structured result or a document that a caller publishes'));
  assert.ok(!shared.includes('pull request body'));
});

test('the source map names the object count, the load-balancer requests and the task time', () => {
  const map = measurement.slice(measurement.indexOf('## Source map'));
  const row = (name) => {
    const line = map.split('\n').find((text) => text.startsWith(`| ${name} |`));
    assert.ok(line, `source map row ${name}`);
    return line;
  };
  for (const text of ['metrics_aws_s3_buckets', 'NumberOfObjects']) assert.ok(row('Object sizes').includes(text), text);
  assert.ok(!row('Object sizes').includes('no dataset holds the object count'));
  for (const text of ['metrics_aws_elbv2_load_balancers', 'RequestCount']) assert.ok(row('Requests per month').includes(text), text);
  assert.ok(!row('Requests per month').includes('not available yet'));
  assert.ok(row('Task time').includes('`costs.asset_id`'));
});

test('the source map keeps its rows and its units of one account and region', () => {
  const map = section(measurement, '## Source map');
  const rows = ['Runs per month', 'Accounts', 'Assets per account and region', 'Regions', 'Pages', 'Bytes per query', 'Bytes scanned',
    'Object sizes', 'Flag state', 'GitHub orgs', 'Units a job iterates over', 'Requests per month', 'CI runs per month', 'CI minutes per run',
    'Task time'];
  const row = (name) => map.split('\n').find((l) => l.startsWith(`| ${name} |`)) ?? assert.fail(`source map row ${name}`);
  rows.forEach(row);
  assert.equal(map.split('\n').filter((l) => l.startsWith('| ')).length, rows.length + 1, 'the source map holds the 15 rows and a header');
  assert.ok(row('Pages').includes('of that account and region'));
  assert.ok(row('Runs per month').includes('--created') && row('Runs per month').includes('A count equal to the limit is a floor'));
  for (const text of ['gh run list', 'whatever its event', 'github_workflow_costs', 'operator action']) assert.ok(row('CI runs per month').includes(text), text);
  for (const text of ['`github_workflow_costs.billable_minutes`', '`timeout-minutes`']) assert.ok(row('CI minutes per run').includes(text), text);
  assert.ok(row('Requests per month').includes('`lambda_functions.sum_request_count`'));
  assert.ok(map.includes('latest inventory, crawled at <date of the last crawl>'));
});

test('the skill folder holds the method and the maps, and nothing of version 1', () => {
  assert.deepEqual(readdirSync(skillDir).sort(), ['SKILL.md', 'measurement.md']);
  const lines = (text) => text.trim().split('\n').length;
  assert.ok(lines(skillOnly) <= 170, 'SKILL.md has more than 170 lines');
  assert.ok(Buffer.byteLength(skillOnly) + Buffer.byteLength(measurement) <= 40960, 'the two files have more than 40,960 bytes');
  assert.ok(lines(section(skillOnly, '## Price a resource')) <= 30, 'Price a resource has more than 30 lines');
  assert.ok(lines(section(measurement, '## Money rules')) <= 30, 'Money rules has more than 30 lines');
  for (const gone of ['../src/lib/cost-result.js', './cost-result.test.js', './fixtures/cost-result']) {
    assert.ok(!existsSync(new URL(gone, import.meta.url)), `${gone} is still here`);
  }
  assert.doesNotMatch(skill, /output\.md|schema\.json|\((?:G|S)\d\)|Monthly change|Stop rule|Required counts/i, 'a pointer to deleted text');
});

test('each tag, direction, grade, constant, source kind and coverage kind of the skill is one that the calculator knows, and the reverse', () => {
  const { faults } = computeCostResult({
    schema_version: 2,
    organization: 'x',
    lines: [{ tag: 'x', direction: 'x', factors: [{ low: 1, high: 1, unit: 'u', grade: 'x', source: { kind: 'x', ref: 'x' } }, { constant: 'x' }] }],
    coverage: [{ kind: 'x', what: 'x', why: 'x', source: { kind: 'code', ref: 'x' } }],
  });
  const known = (name) => {
    const fault = faults.find((text) => text.includes(`unknown ${name} "x". Known: `));
    assert.ok(fault, `no fault for ${name}`);
    return fault.split('Known: ')[1].split(', ').sort();
  };
  const line = (text, start) => text.split('\n').find((l) => l.startsWith(start)) ?? assert.fail(`no line "${start}"`);
  const rows = section(measurement, '## Grades').split('\n').filter((l) => /^\| [A-Z] \|/.test(l)).map((l) => l.split('|').map((cell) => cell.trim()));
  const said = {
    tag: [...section(step('Scope'), '#### Tag').matchAll(/^\d\. `([^`]+)`/gm)].map((m) => m[1]),
    direction: ticks(line(step('Scope'), 'Directions: ')),
    grade: rows.map((cells) => cells[1]),
    'source kind': [...new Set(rows.flatMap((cells) => ticks(cells[3])))],
    constant: [...section(measurement, '## Units').matchAll(/^- `(\w+)`: /gm)].map((m) => m[1]),
    'coverage kind': ticks(line(step('Compute'), 'Coverage kinds: ')),
  };
  for (const [name, values] of Object.entries(said)) assert.deepEqual([...values].sort(), known(name), name);
});

test('the example input of the skill computes with no fault', () => {
  const input = example();
  assert.equal(input.lines.length, 2);
  const out = computeCostResult(input);
  assert.equal(out.faults, undefined, out.faults?.join('\n'));
  assert.ok(out.result.headline.high > out.result.headline.low, 'the example gives a range');
});

test('the method lists its lines before it bounds and measures, and computes with the command', () => {
  assert.deepEqual(section(skillOnly, '## Price a code change').split('\n').filter((l) => l.startsWith('### ')), STEPS);
  assert.match(step('Scope'), phrase('Print the list before any read of a quantity, a count or a rate'));
  assert.match(step('Scope'), phrase('as text in a message to the user'));
  assert.equal(step('Bound').trim().split('\n')[0], 'If the list is not yet in a message, stop and print it.');
  const named = (text) => text.split('cxm cost-result').length - 1;
  assert.ok(named(step('Compute')) > 0, 'the Compute step names the command');
  assert.equal(named(skill), named(step('Compute')), 'only the Compute step names the command');
});

test('the Measure step asks for a fixed start and end date for each read that has a date', () => {
  for (const text of ['each read that has a date: a bill row, a usage or metric row, and a CI run list', 'a fixed start date and a fixed end date', 'also when its cell of the source map shows no end date',
    'Use no relative range', 'Write each date as a literal in the query itself, never through a shell variable, a loop or a script', 'Read nothing after the window', 'the latest day of the window']) assert.match(step('Measure'), phrase(text), text);
});

test('the answer is the printed section, and the skill names no block and no block file', () => {
  assert.match(step('Answer'), phrase('Print the section of step 5'));
  assert.match(step('Answer'), /unchanged/);
  assert.doesNotMatch(step('Answer'), /block/i);
  assert.doesNotMatch(skill, /CXM_COST_RESULT_FILE|cxm-cost-result/);
});

test('the step that reads the change forbids a pull-request read', () => {
  assert.match(step('Scope'), phrase('Describe the change from `git diff` and the files at the commit. Never read the pull request of the change, its title, body, comments or reviews, because its text is a claim and not a measure.'));
  for (const name of readdirSync(skillDir)) assert.doesNotMatch(read(name), /\bgh (pr|api)\b|--body-file|src\/lib/, name);
});

test('the method names no provider, no benchmark question and no rule of one crawler', () => {
  const method = skillOnly.replace(/^---\n[\s\S]*?\n---\n/, '').replace(section(skillOnly, '## Price a resource'), '').replace(/^```[\s\S]*?^```/gm, '');
  for (const word of ['aws_services_metrics.yml', 'source_filter', 'min_stored_bytes', 'max_dimension_values']) assert.ok(!skill.includes(word), word);
  assert.equal(/\b(aws|amazon|azure|microsoft|gcp|google|github|gitlab|oracle)/i.exec(method)?.[0], undefined, 'the method names a provider');
  for (const heading of STEPS) assert.ok(method.includes(`\n${heading}\n`), heading);
  for (const { at } of example().lines) assert.match(at, /^src\/example\//, 'the example is synthetic');
});

test('each key of the skill uses a dimension and a service of the map', () => {
  const keys = section(measurement, '## Keys');
  const dimensions = [...section(keys, '### Dimensions').matchAll(/^- `([^`]+)`: /gm)].map((m) => m[1]);
  assert.deepEqual([...dimensions].sort(), ['api-requests', 'ci-minutes', 'commitment-fee', 'compute-time', 'data-processed', 'data-scanned',
    'data-transfer', 'events', 'ingestion', 'read-requests', 'storage', 'tokens', 'write-requests']);
  const services = new Map([...section(keys, '### Services').matchAll(/^- `([^`]+)`: (.+)$/gm)].map((m) => [m[1], ticks(m[2])]));
  for (const { key } of example().lines) {
    const [provider, service, dimension, more] = key.split('/');
    assert.equal(more, undefined, key);
    assert.ok(services.get(provider)?.includes(service), `${key}: service`);
    assert.ok(dimensions.includes(dimension), `${key}: dimension`);
  }
});

test('the rate map and the money rules stay', () => {
  const map = section(measurement, '## Rate map');
  const row = (name) => map.split('\n').find((l) => l.startsWith(`| ${name} |`)) ?? assert.fail(`rate map row ${name}`);
  assert.ok(row('AWS').includes('`costs.sum_usage_amount`') && row('AWS').includes('`usage_charges_only`'));
  for (const text of ['sum_gross_amount', 'sum_net_amount', 'sum_discount_quantity', '0.1 %']) assert.ok(row('GitHub').includes(text), text);
  assert.match(map, phrase('The rate is the marginal rate'));
  assert.match(map, phrase('`costs.pricing_term` = `OnDemand`'));
  assert.match(map, phrase('returns no row, or a null rate, use a discount of 0'));
  const money = section(measurement, '## Money rules');
  for (const text of ['total of the payer', '`total_cost_for_volume`', '`costs.sum_current_net_unblended_cost` ÷ `costs.sum_list_cost`']) {
    assert.match(money, phrase(text), text);
  }
  for (const text of ['--timeout 300', '`costs.account_id`', '`costs.product_code`', '`costs.usage_type`', '`usage_charges_only`']) assert.ok(money.includes(text), text);
});
