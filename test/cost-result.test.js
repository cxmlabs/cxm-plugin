// validateCostResult checks the shape of the structured result and nothing else.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateCostResult } from '../src/lib/cost-result.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/cost-result/${name}.json`, import.meta.url), 'utf8'));
const schema = JSON.parse(readFileSync(new URL('../skills/cxm-cost-of-change/cost-result.schema.json', import.meta.url), 'utf8'));

test('a valid cost result has no fault', () => {
  for (const name of ['valid', 'no-billed-unit-change']) {
    const result = fixture(name);
    assert.deepEqual(validateCostResult(result), [], name);
    for (const key of Object.keys(result)) assert.ok(key in schema.properties, `${name}: ${key} is not in the schema`);
  }
});

test('an unmeasured target amount is valid, and a billed-unit result holds no headline', () => {
  const unmeasured = structuredClone(fixture('valid'));
  unmeasured.targets[0].amounts = { list: 'unmeasured', effective: 'unmeasured' };
  assert.deepEqual(validateCostResult(unmeasured), []);
  const billed = { ...fixture('no-billed-unit-change'), headlines: fixture('valid').headlines };
  assert.match(validateCostResult(billed).join(), /a no billed unit change result holds a headline or a target/);
  assert.deepEqual(schema.properties.results.items.properties.factors.items.then.required, ['grade', 'cite']);
  assert.ok(schema.allOf.some((r) => r.then.required?.includes('failed')));
});

test('each faulty cost result names its fault', () => {
  const faults = {
    'factor-no-grade': /results\[0\]\.factors\[0\]\.grade/,
    'undefined-cite': /cite c9 is not defined in citations/,
    'no-doubts': /doubts: must be a list/,
    'failed-with-amount': /a failed result holds an amount/,
    'failed-with-doubt': /a failed result holds a doubt or a citation/,
    'failed-with-citation': /a failed result holds a doubt or a citation/,
    'no-factor': /results\[0\]\.factors: must hold a factor/,
    'unmeasured-no-reason': /results\[0\]\.factors\[0\]\.reason/,
    'unmeasured-with-cite': /results\[0\]\.factors\[0\]: an unmeasured factor has no grade and no cite/,
  };
  for (const [name, expected] of Object.entries(faults)) {
    const found = validateCostResult(fixture(name));
    assert.equal(found.length, 1, `${name}: ${found.join(' | ')}`);
    assert.match(found[0], expected, name);
  }
});
