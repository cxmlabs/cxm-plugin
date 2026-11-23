// The skill text keeps the branches, routes and stop rules that its pricing steps rely on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { orgApi } from '../src/lib/http.js';

const skill = readFileSync(new URL('../skills/cxm-cost-of-change/SKILL.md', import.meta.url), 'utf8');
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

test('the skill stops only when nothing about the cost changes, and does not duplicate the section', () => {
  assert.match(skill, /accounts, regions and asset type that the call\s+iterates over\. If one of them changes, continue/);
  assert.match(skill, /replace it\. The section ends at the next heading of level 3 or less/);
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

test('the skill prices a third-party service from the published rate, not from a per-dataset division', () => {
  const rules = skill.slice(skill.indexOf('### Count rules'), skill.indexOf('### No billed unit change'));
  assert.ok(rules.includes('cxm price --datasource'));
  assert.ok(rules.includes('unmeasured (no published rate: <datasource>)'));
  assert.match(rules, /state the quantity of the change in the published `unit`/);
  assert.ok(rules.includes('unmeasured (unit: <unit>)'));
  assert.ok(!rules.includes('`github_workflow_costs` gives `net_amount` ÷ `quantity`'));
});
