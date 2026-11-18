import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPricingQuery, summarizePricing } from '../src/lib/pricing.js';

const C = 'pricing_rates';
const row = (model, term, rate, unit = 'Hrs') => ({
  [`${C}.pricing_model`]: model,
  [`${C}.term`]: term,
  [`${C}.unit`]: unit,
  [`${C}.amortized_rate_per_unit_usd`]: String(rate),
});
const members = (q) => q.filters.flatMap((x) => (x.or ? x.or : [x])).map((x) => x.member);

test('ec2 query matches usage type and operation, not operating system and tenancy, so Savings Plan rows count', () => {
  const q = buildPricingQuery({ service: 'ec2', instanceType: 'm7g.large', region: 'eu-west-3' });
  const eq = (m, v) => q.filters.some((x) => x.member === `${C}.${m}` && x.values[0] === v);
  assert.ok(eq('product_service_name', 'AmazonEC2'));
  assert.ok(eq('instance_type', 'm7g.large'));
  assert.ok(eq('region', 'eu-west-3'));
  assert.ok(eq('operation', 'RunInstances'));
  assert.deepEqual(q.filters.find((x) => x.or).or, [
    { member: `${C}.usage_type`, operator: 'equals', values: ['BoxUsage:m7g.large'] },
    { member: `${C}.usage_type`, operator: 'endsWith', values: ['-BoxUsage:m7g.large'] },
  ]);
  assert.ok(!members(q).includes(`${C}.operating_system`) && !members(q).includes(`${C}.tenancy`));
  assert.ok(!members(q).includes(`${C}.pricing_model`)); // layered: fetch all models
  const w = buildPricingQuery({ service: 'ec2', instanceType: 'm5.large', region: 'us-east-1', os: 'Windows', tenancy: 'Dedicated' });
  assert.ok(w.filters.some((x) => x.member === `${C}.operation` && x.values[0] === 'RunInstances:0002'));
  assert.equal(w.filters.find((x) => x.or).or[0].values[0], 'DedicatedUsage:m5.large');
  assert.throws(() => buildPricingQuery({ service: 'ec2', instanceType: 'm5.large', region: 'us-east-1', os: 'BeOS' }), /--os/);
});

test('--service lowercases only to find ec2, rds and elasticache, and passes an AWS service code through', () => {
  const spec = { instanceType: 'm7g.large', region: 'eu-west-3' };
  const ec2 = buildPricingQuery({ ...spec, service: 'ec2' });
  assert.deepEqual(buildPricingQuery({ ...spec, service: 'EC2' }), ec2);
  assert.deepEqual(buildPricingQuery({ ...spec, service: 'AmazonEC2' }), ec2);
  const cw = buildPricingQuery({ ...spec, service: 'AmazonCloudWatch' });
  assert.deepEqual(cw.filters[0].values, ['AmazonCloudWatch']);
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
  assert.equal(s.on_demand_list.monthly_usd, 1460);
  assert.equal(s.committed_1yr.hourly_usd, 0.65);
  assert.equal(s.committed_1yr.savings_vs_on_demand_pct, 35);
  assert.equal(s.committed_3yr.hourly_usd, 0.5);
  assert.equal(s.committed_3yr.savings_vs_on_demand_pct, 50);
});

test('a reservation counts its upfront fee: m7g.large eu-west-3 rate card rows', () => {
  const rows = [
    row('ON_DEMAND', '', 0.0952),
    { ...row('RESERVED', '1yr', 0.05980867579908676), [`${C}.rate_per_unit_usd`]: '0.0299' }, // Partial Upfront
    { ...row('RESERVED', '1yr', 0.05980867579908676, 'Quantity'), [`${C}.rate_per_unit_usd`]: '262.0' },
    { ...row('RESERVED', '1yr', 0.05856164383561644), [`${C}.rate_per_unit_usd`]: '0.0' }, // All Upfront
    { ...row('RESERVED', '1yr', 0.05856164383561644, 'Quantity'), [`${C}.rate_per_unit_usd`]: '513.0' },
    row('SAVINGS_PLAN', '1yr', 0.0598),
  ];
  const s = summarizePricing(rows);
  assert.equal(s.on_demand_list.monthly_usd, 69.5);
  assert.equal(s.committed_1yr.hourly_usd, 0.0585616);
  assert.equal(s.committed_1yr.savings_vs_on_demand_pct, 38.5);
});

test('a sub-cent rate keeps 6 significant digits and never rounds to 0', () => {
  const s = summarizePricing([row('ON_DEMAND', '', 0.0000123456789)]);
  assert.equal(s.on_demand_list.hourly_usd, 0.0000123457);
  assert.equal(s.on_demand_list.monthly_usd, 0.00901235);
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
