import { requireSession } from '../lib/config.js';
import { cubeLoad } from '../lib/http.js';
import { RATE_DIMENSIONS_LIMIT, buildPricingQuery, buildRateDimensionsQuery, buildUnitRateQuery, rateDimensionRows, summarizePricing, unitRateRow } from '../lib/pricing.js';

function getFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function priceSpec(argv) {
  return {
    service: getFlag(argv, '--service') ?? 'ec2',
    instanceType: getFlag(argv, '--instance-type'),
    region: getFlag(argv, '--region'),
    os: getFlag(argv, '--os'),
    engine: getFlag(argv, '--engine'),
    deployment: getFlag(argv, '--deployment'),
    tenancy: getFlag(argv, '--tenancy'),
  };
}

export function unitRateSpec(argv) {
  return {
    datasource: getFlag(argv, '--datasource'),
    dimension: getFlag(argv, '--dimension'),
    unit: getFlag(argv, '--unit'),
    billingPeriod: getFlag(argv, '--billing-period'),
  };
}

export function unitRateResult(spec, rows, { organization, quantity }) {
  const rate = unitRateRow(rows);
  if (!rate) {
    return { source: 'CloudExMachina', spec, result: 'no_rate_found', datasource: spec.datasource, hint: 'Check --datasource/--dimension/--unit/--billing-period.' };
  }
  return { source: 'CloudExMachina', organization, spec, ...rate, ...(quantity === undefined ? {} : { quantity: Number(quantity) }) };
}

export function rateDimensionsResult(spec, rows, { organization }) {
  if (!rows.length) return { source: 'CloudExMachina', spec, result: 'no_rate_found', datasource: spec.datasource, hint: 'Check --datasource.' };
  return { source: 'CloudExMachina', organization, spec, dimensions: rateDimensionRows(rows), limit_reached: rows.length >= RATE_DIMENSIONS_LIMIT };
}

async function rateDimensions(config, spec) {
  const rows = await cubeLoad(config, buildRateDimensionsQuery(spec), { maxWaitMs: 60000 });
  console.log(JSON.stringify(rateDimensionsResult(spec, rows, { organization: config.organizationId }), null, 2));
}

async function unitRate(config, argv) {
  const spec = unitRateSpec(argv);
  if (!spec.dimension) return rateDimensions(config, spec);
  const quantity = getFlag(argv, '--quantity');
  if (quantity !== undefined && !Number.isFinite(Number(quantity))) throw new Error('price requires --quantity to be a number');
  const rows = await cubeLoad(config, buildUnitRateQuery(spec), { maxWaitMs: 60000 });
  const result = unitRateResult(spec, rows, { organization: config.organizationId, quantity });
  console.log(JSON.stringify(result, null, 2));
}

export async function price(argv) {
  const config = await requireSession();
  if (argv.includes('--datasource')) return unitRate(config, argv);
  const spec = priceSpec(argv);
  const count = Number(getFlag(argv, '--count') ?? 1);
  const hours = Number(getFlag(argv, '--hours') ?? 730);

  const rows = await cubeLoad(config, buildPricingQuery(spec), { maxWaitMs: 60000 });
  const summary = summarizePricing(rows, { hours, count });

  if (!summary) {
    console.log(
      JSON.stringify(
        { source: 'CloudExMachina', spec, result: 'no_rate_found', hint: 'Check --service/--instance-type/--region/--os/--engine/--deployment.' },
        null,
        2,
      ),
    );
    return;
  }
  console.log(JSON.stringify({ source: 'CloudExMachina', organization: config.organizationId, spec, ...summary }, null, 2));
}
