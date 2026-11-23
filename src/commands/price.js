import { requireSession } from '../lib/config.js';
import { cubeLoad } from '../lib/http.js';
import { RATE_DIMENSIONS_LIMIT, buildPricingQuery, buildRateDatasourcesQuery, buildRateDimensionsQuery, buildUnitRateQuery, rateDatasourceNames, rateDimensionRows, summarizePricing, unitRateRow } from '../lib/pricing.js';

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
  };
}

export function unitRateResult(spec, rows, { organization, quantity }) {
  const rate = unitRateRow(rows);
  if (!rate) {
    return { source: 'CloudExMachina', spec, result: 'no_rate_found', datasource: spec.datasource, hint: 'Check --datasource/--dimension/--unit.' };
  }
  return { source: 'CloudExMachina', organization, spec, ...rate, ...(quantity === undefined ? {} : { quantity: Number(quantity) }) };
}

export function rateDimensionsResult(spec, rows, { organization }) {
  if (!rows.length) return { source: 'CloudExMachina', spec, result: 'no_rate_found', datasource: spec.datasource, hint: 'Check --datasource.' };
  return { source: 'CloudExMachina', organization, spec, dimensions: rateDimensionRows(rows.slice(0, RATE_DIMENSIONS_LIMIT)), limit_reached: rows.length > RATE_DIMENSIONS_LIMIT };
}

export function rateDatasourcesResult(rows, { organization }) {
  if (!rows.length) return { source: 'CloudExMachina', result: 'no_rate_found', hint: 'No datasource has a published rate.' };
  return { source: 'CloudExMachina', organization, datasources: rateDatasourceNames(rows.slice(0, RATE_DIMENSIONS_LIMIT)), limit_reached: rows.length > RATE_DIMENSIONS_LIMIT };
}

async function rateDimensions(config, spec) {
  const rows = await cubeLoad(config, buildRateDimensionsQuery(spec), { maxWaitMs: 60000 });
  console.log(JSON.stringify(rateDimensionsResult(spec, rows, { organization: config.organizationId }), null, 2));
}

export async function unitRate(config, argv) {
  const spec = unitRateSpec(argv);
  if (!spec.datasource) {
    const rows = await cubeLoad(config, buildRateDatasourcesQuery(), { maxWaitMs: 60000 });
    console.log(JSON.stringify(rateDatasourcesResult(rows, { organization: config.organizationId }), null, 2));
    return;
  }
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
