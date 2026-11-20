// The cost-of-change skill branches on what `cxm api` prints when a pricing route fails. These
// tests hold the two ends together: orgApi() puts the status and detail.code in the error, and the
// skill names a branch for each status and code, so a route that is not deployed yet prints
// `unmeasured`, never a price.
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
