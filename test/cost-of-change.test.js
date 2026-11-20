// Each pricing-route failure maps to a branch of the skill, so a missing route prints unmeasured.
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
  assert.ok(!skill.includes('If the diff adds no paid call'), 'a removal or a multiplier is priced');
  assert.match(skill, /the row filters, and the accounts, regions and asset type that the call\s+iterates over all stay the same/);
  assert.match(skill, /replace it\. Add a section only when the body has none/);
  assert.match(skill, /If a dataset returns no rows, print `unmeasured \(no rows in <dataset>\)`/);
  assert.match(skill, /more than one tier, do this with either rate source/);
  assert.match(skill, /baseline excludes the change/);
  assert.ok(!skill.includes('Otherwise say that the baseline includes'), 'unmerged change is not in the baseline');
  assert.ok(!skill.includes('has no negotiated discount on that product code'));
  assert.ok(skill.includes('"member":"costs.account_id"'), 'raw-bill example filters the account');
});
