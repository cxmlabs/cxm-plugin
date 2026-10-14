import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPricingQuery, summarizePricing } from '../src/lib/pricing.js';

const C = 'pricing_rates';
const row = (model, term, rate) => ({
  [`${C}.pricing_model`]: model,
  [`${C}.term`]: term,
  [`${C}.unit`]: 'Hrs',
  [`${C}.rate_per_unit_usd`]: String(rate),
});

test('ec2 query filters service/instance/region + default os; no pricing_model filter', () => {
  const q = buildPricingQuery({ service: 'ec2', instanceType: 'm5.large', region: 'eu-west-3' });
  const eq = (m, v) => q.filters.some((x) => x.member === `${C}.${m}` && x.values[0] === v);
  assert.ok(eq('product_service_name', 'AmazonEC2'));
  assert.ok(eq('instance_type', 'm5.large'));
  assert.ok(eq('region', 'eu-west-3'));
  assert.ok(eq('operating_system', 'Linux'));
  assert.ok(!q.filters.some((x) => x.member === `${C}.pricing_model`)); // layered: fetch all models
});

test('rds query adds engine + default deployment', () => {
  const q = buildPricingQuery({ service: 'rds', instanceType: 'db.r5.large', region: 'us-east-1', engine: 'PostgreSQL' });
  const eq = (m, v) => q.filters.some((x) => x.member === `${C}.${m}` && x.values[0] === v);
  assert.ok(eq('database_engine', 'PostgreSQL'));
  assert.ok(eq('deployment_option', 'Single-AZ'));
});

test('requires instance-type and region', () => {
  assert.throws(() => buildPricingQuery({ service: 'ec2', region: 'eu-west-3' }));
  assert.throws(() => buildPricingQuery({ service: 'ec2', instanceType: 'm5.large' }));
});

test('layers on-demand vs cheapest 1yr/3yr committed with savings %', () => {
  const rows = [
    row('ON_DEMAND', '', 1.0),
    row('RESERVED', '1yr', 0.7),
    row('SAVINGS_PLAN', '1yr', 0.65), // cheaper 1yr
    row('RESERVED', '3yr', 0.5),
  ];
  const s = summarizePricing(rows, { hours: 730, count: 2 });
  assert.equal(s.on_demand_list.hourly_usd, 1.0);
  assert.equal(s.on_demand_list.monthly_usd, Number((1.0 * 730 * 2).toFixed(2)));
  assert.equal(s.committed_1yr.hourly_usd, 0.65);
  assert.equal(s.committed_1yr.savings_vs_on_demand_pct, 35);
  assert.equal(s.committed_3yr.hourly_usd, 0.5);
  assert.equal(s.committed_3yr.savings_vs_on_demand_pct, 50);
});

test('null committed layers when no reserved rows; null overall when no on-demand', () => {
  const s = summarizePricing([row('ON_DEMAND', '', 1.0)]);
  assert.equal(s.committed_1yr, null);
  assert.equal(s.committed_3yr, null);
  assert.equal(summarizePricing([row('RESERVED', '1yr', 0.5)]), null); // no OD baseline
});

test('an RDS engine slug maps to the catalog label', () => {
  const q = buildPricingQuery({ service: 'rds', instanceType: 'db.r6g.xlarge', region: 'eu-west-1', engine: 'aurora-postgresql' });
  assert.ok(q.filters.some((f) => f.member === 'pricing_rates.database_engine' && f.values[0] === 'Aurora PostgreSQL'));
});
