// Map a resource spec to a CubeJS query over the rate catalog and
// layer the result: on-demand list vs the cheapest 1yr/3yr committed (Reserved / Savings Plan) rate.
// Org-specific EDP/PRA discount and current SP/RI coverage are added by the skill, not here —
// they are org context, not per-spec catalog data.

const CUBE = 'pricing_rates';

// The rate catalog uses AWS's engine labels; accept the usual slugs too.
const RDS_ENGINES = {
  postgres: 'PostgreSQL', postgresql: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', oracle: 'Oracle', sqlserver: 'SQL Server',
  'aurora-postgresql': 'Aurora PostgreSQL', 'aurora-mysql': 'Aurora MySQL', aurora: 'Aurora MySQL',
};
const rdsEngine = (e) => RDS_ENGINES[String(e).toLowerCase().replace(/[\s_]+/g, '-')] ?? e;

const SERVICE = {
  ec2: { product: 'AmazonEC2', extra: (s) => [f('operating_system', s.os ?? 'Linux'), f('tenancy', s.tenancy ?? 'Shared')] },
  rds: { product: 'AmazonRDS', extra: (s) => [...(s.engine ? [f('database_engine', rdsEngine(s.engine))] : []), f('deployment_option', s.deployment ?? 'Single-AZ')] },
  elasticache: { product: 'AmazonElastiCache', extra: (s) => (s.engine ? [f('cache_engine', s.engine)] : []) },
};

function f(member, value) {
  return { member: `${CUBE}.${member}`, operator: 'equals', values: [value] };
}

export function buildPricingQuery(spec) {
  const svc = SERVICE[spec.service];
  const product = svc ? svc.product : spec.service; // allow a raw AWS service code passthrough
  if (!spec.instanceType) throw new Error('price requires --instance-type');
  if (!spec.region) throw new Error('price requires --region');
  return {
    dimensions: [
      `${CUBE}.rate_per_unit_usd`,
      `${CUBE}.unit`,
      `${CUBE}.pricing_model`,
      `${CUBE}.term`,
      `${CUBE}.payment_option`,
      `${CUBE}.savings_plan_type`,
    ],
    filters: [
      f('product_service_name', product),
      f('instance_type', spec.instanceType),
      f('region', spec.region),
      ...(svc ? svc.extra(spec) : []),
    ],
    limit: 100,
  };
}

const num = (r, k) => Number(r[`${CUBE}.${k}`]);
const isHourly = (r) => (r[`${CUBE}.unit`] ?? 'Hrs') === 'Hrs';

// Cheapest positive hourly rate among rows matching the predicate.
function cheapest(rows, predicate) {
  const rates = rows.filter((r) => isHourly(r) && predicate(r)).map((r) => num(r, 'rate_per_unit_usd')).filter((n) => Number.isFinite(n) && n > 0);
  return rates.length ? Math.min(...rates) : null;
}

function layer(hourly, ondemand, { hours, count }) {
  if (hourly == null) return null;
  return {
    hourly_usd: Number(hourly.toFixed(4)),
    monthly_usd: Number((hourly * hours * count).toFixed(2)),
    savings_vs_on_demand_pct: ondemand ? Number((100 * (1 - hourly / ondemand)).toFixed(1)) : null,
  };
}

export function summarizePricing(rows, { hours = 730, count = 1 } = {}) {
  const model = (r) => r[`${CUBE}.pricing_model`];
  const term = (r) => r[`${CUBE}.term`];
  const committed = (r) => model(r) === 'RESERVED' || model(r) === 'SAVINGS_PLAN';

  const onDemand = cheapest(rows, (r) => model(r) === 'ON_DEMAND');
  if (onDemand == null) return null;

  return {
    on_demand_list: layer(onDemand, onDemand, { hours, count }),
    committed_1yr: layer(cheapest(rows, (r) => committed(r) && term(r) === '1yr'), onDemand, { hours, count }),
    committed_3yr: layer(cheapest(rows, (r) => committed(r) && term(r) === '3yr'), onDemand, { hours, count }),
    hours,
    count,
  };
}
