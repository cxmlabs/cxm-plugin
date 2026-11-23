import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceSpec, rateDatasourcesResult, rateDimensionsResult, unitRate, unitRateResult, unitRateSpec } from '../src/commands/price.js';
import { classifyError } from '../src/lib/telemetry.js';
import { RATE_DIMENSIONS_LIMIT, buildPricingQuery, buildRateDatasourcesQuery, buildRateDimensionsQuery, buildUnitRateQuery, summarizePricing } from '../src/lib/pricing.js';

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
  assert.ok(q.dimensions.includes(`${C}.amortized_rate_per_unit_usd`));
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

test('an unknown --os or --tenancy is bad input, not a crash', () => {
  const base = { service: 'ec2', instanceType: 'm5.large', region: 'us-east-1' };
  for (const bad of [{ os: 'BeOS' }, { tenancy: 'default' }]) assert.throws(() => buildPricingQuery({ ...base, ...bad }), (e) => classifyError(e) === 'bad_input');
});

test('--service lowercases only to find ec2, rds and elasticache, and passes an AWS service code through', () => {
  const spec = { instanceType: 'm7g.large', region: 'eu-west-3' };
  const ec2 = buildPricingQuery({ ...spec, service: 'ec2' });
  assert.deepEqual(buildPricingQuery({ ...spec, service: 'EC2' }), ec2);
  assert.deepEqual(buildPricingQuery({ ...spec, service: 'AmazonEC2' }), ec2);
  const cw = buildPricingQuery({ ...spec, service: 'AmazonCloudWatch' });
  assert.deepEqual(cw.filters[0].values, ['AmazonCloudWatch']);
});

test('price reads --service verbatim and defaults to ec2', () => {
  assert.equal(priceSpec(['--service', 'AmazonCloudWatch']).service, 'AmazonCloudWatch');
  assert.equal(priceSpec([]).service, 'ec2');
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

test('prices a third-party datasource from the published rate', () => {
  const R = 'third_party_unit_rates';
  const spec = unitRateSpec(['--datasource', 'ci', '--dimension', 'runner_linux', '--unit', 'minute']);
  assert.deepEqual(buildUnitRateQuery(spec), {
    dimensions: ['datasource', 'dimension', 'unit', 'billing_period', 'unit_rate_usd', 'rate_source'].map((m) => `${R}.${m}`),
    filters: [
      { member: `${R}.datasource`, operator: 'equals', values: ['ci'] },
      { member: `${R}.dimension`, operator: 'equals', values: ['runner_linux'] },
      { member: `${R}.unit_rate_usd`, operator: 'set' },
      { member: `${R}.unit`, operator: 'equals', values: ['minute'] },
    ],
    order: [[`${R}.billing_period`, 'desc'], [`${R}.unit`, 'asc'], [`${R}.rate_source`, 'asc']],
    limit: 1,
  });
  const noUnit = buildUnitRateQuery(unitRateSpec(['--datasource', 'ci', '--dimension', 'runner_linux']));
  assert.ok(!noUnit.filters.some((x) => x.member === `${R}.unit`));
  for (const bad of [{ datasource: 'ci' }, { dimension: 'runner_linux' }]) assert.throws(() => buildUnitRateQuery(bad), (e) => classifyError(e) === 'bad_input');
  const row = { [`${R}.unit_rate_usd`]: '0.008', [`${R}.unit`]: 'minute', [`${R}.billing_period`]: '2026-10', [`${R}.rate_source`]: 'ci_costs' };
  const priced = unitRateResult(spec, [row], { organization: 'org', quantity: '120' });
  assert.equal(priced.unit_rate_usd, '0.008');
  assert.equal(priced.billing_period, '2026-10');
  assert.equal(priced.quantity, 120);
  const empty = unitRateResult(spec, [], { organization: 'org' });
  assert.equal(empty.result, 'no_rate_found');
  assert.equal(empty.datasource, 'ci');
  assert.ok(!('unit_rate_usd' in empty));
  assert.equal(unitRateResult(spec, [{ ...row, [`${R}.unit_rate_usd`]: null }], { organization: 'org' }).result, 'no_rate_found');
  const listing = unitRateSpec(['--datasource', 'ci']);
  assert.deepEqual(buildRateDimensionsQuery(listing), {
    dimensions: ['dimension', 'unit', 'billing_period'].map((m) => `${R}.${m}`),
    filters: [{ member: `${R}.datasource`, operator: 'equals', values: ['ci'] }, { member: `${R}.unit_rate_usd`, operator: 'set' }],
    order: [[`${R}.billing_period`, 'desc'], [`${R}.dimension`, 'asc']],
    limit: RATE_DIMENSIONS_LIMIT + 1,
  });
  const listed = rateDimensionsResult(listing, [{ [`${R}.dimension`]: 'runner_linux', [`${R}.unit`]: 'minute', [`${R}.billing_period`]: '2026-10' }], { organization: 'org' });
  assert.deepEqual(listed.dimensions, [{ dimension: 'runner_linux', unit: 'minute', billing_period: '2026-10' }]);
  assert.equal(listed.limit_reached, false);
  const full = Array.from({ length: RATE_DIMENSIONS_LIMIT }, () => ({}));
  const over = Array.from({ length: RATE_DIMENSIONS_LIMIT + 1 }, () => ({}));
  assert.equal(rateDimensionsResult(listing, full, { organization: 'org' }).limit_reached, false);
  const cut = rateDimensionsResult(listing, over, { organization: 'org' });
  assert.equal(cut.limit_reached, true);
  assert.equal(cut.dimensions.length, RATE_DIMENSIONS_LIMIT);
  assert.equal(rateDimensionsResult(listing, [], { organization: 'org' }).result, 'no_rate_found');
  assert.deepEqual(buildRateDatasourcesQuery(), {
    dimensions: [`${R}.datasource`],
    filters: [{ member: `${R}.unit_rate_usd`, operator: 'set' }],
    order: [[`${R}.datasource`, 'asc']],
    limit: RATE_DIMENSIONS_LIMIT + 1,
  });
  assert.deepEqual(rateDatasourcesResult([{ [`${R}.datasource`]: 'ci' }], { organization: 'org' }).datasources, ['ci']);
  assert.equal(rateDatasourcesResult([], { organization: 'org' }).result, 'no_rate_found');
  assert.equal(rateDatasourcesResult([{ [`${R}.datasource`]: 'ci' }], { organization: 'org' }).limit_reached, false);
  assert.equal(rateDatasourcesResult(full, { organization: 'org' }).limit_reached, false);
  const cutNames = rateDatasourcesResult(over, { organization: 'org' });
  assert.equal(cutNames.limit_reached, true);
  assert.equal(cutNames.datasources.length, RATE_DIMENSIONS_LIMIT);
});

test('price dispatches on the datasource and dimension flags and checks the quantity', async () => {
  const R = 'third_party_unit_rates';
  const real = globalThis.fetch;
  const config = { baseUrl: 'https://example.test', organizationId: 'org', accessToken: 't' };
  const queries = [];
  globalThis.fetch = async (url, init) => {
    const query = JSON.parse(init.body).query;
    queries.push(query);
    const data = query.limit === 1 && query.filters.some((x) => x.values?.[0] === 'runner_linux')
      ? [{ [`${R}.unit_rate_usd`]: '0.008', [`${R}.unit`]: 'minute', [`${R}.billing_period`]: '2026-10', [`${R}.rate_source`]: 'ci_costs' }]
      : query.dimensions.length === 1 ? [{ [`${R}.datasource`]: 'ci' }]
        : query.limit === 1 ? [] : [{ [`${R}.dimension`]: 'runner_linux', [`${R}.unit`]: 'minute', [`${R}.billing_period`]: '2026-10' }];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  const logs = console.log;
  const printed = [];
  console.log = (text) => printed.push(JSON.parse(text));
  try {
    await unitRate(config, ['--datasource']);
    await unitRate(config, ['--datasource', 'ci']);
    await unitRate(config, ['--datasource', 'ci', '--dimension', 'runner_linux', '--quantity', '120']);
    await unitRate(config, ['--datasource', 'ci', '--dimension', 'missing']);
    await assert.rejects(unitRate(config, ['--datasource', 'ci', '--dimension', 'x', '--quantity', 'abc']), (e) => classifyError(e) === 'bad_input');
  } finally {
    globalThis.fetch = real;
    console.log = logs;
  }
  assert.deepEqual(queries.map((q) => q.limit), [201, 201, 1, 1]);
  assert.deepEqual(queries.map((q) => q.dimensions.length), [1, 3, 6, 6]);
  assert.deepEqual(printed[0].datasources, ['ci']);
  assert.deepEqual(printed[1].dimensions, [{ dimension: 'runner_linux', unit: 'minute', billing_period: '2026-10' }]);
  assert.equal(printed[2].unit_rate_usd, '0.008');
  assert.equal(printed[2].quantity, 120);
  assert.equal(printed[3].result, 'no_rate_found');
  assert.equal(printed.length, 4);
});
