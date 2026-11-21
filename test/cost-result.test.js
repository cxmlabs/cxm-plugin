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

test('each faulty cost result names its fault', () => {
  const faults = {
    'factor-no-grade': /results\[0\]\.factors\[0\]\.grade/,
    'undefined-cite': /cite c9 is not defined in citations/,
    'no-doubts': /doubts: must be a list/,
    'failed-with-amount': /a failed result holds an amount/,
    'no-factor': /results\[0\]\.factors: must hold a factor/,
    'unmeasured-no-reason': /results\[0\]\.factors\[0\]\.reason/,
  };
  for (const [name, expected] of Object.entries(faults)) {
    const found = validateCostResult(fixture(name));
    assert.equal(found.length, 1, `${name}: ${found.join(' | ')}`);
    assert.match(found[0], expected, name);
  }
});
