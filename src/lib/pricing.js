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

// Savings Plan rows carry no operating system and a lowercase tenancy, so EC2 matches the operation and the usage type instead.
const EC2_OPERATIONS = {
  Linux: 'RunInstances', Windows: 'RunInstances:0002', RHEL: 'RunInstances:0010', SUSE: 'RunInstances:000g',
  'Red Hat Enterprise Linux with HA': 'RunInstances:1010', 'Ubuntu Pro': 'RunInstances:0g00',
};
const EC2_USAGE = { Shared: 'BoxUsage', Dedicated: 'DedicatedUsage', Host: 'HostBoxUsage' };
function known(map, value, flag) {
  if (!Object.hasOwn(map, value)) throw new Error(`price requires ${flag} to be one of: ${Object.keys(map).join(', ')}`);
  return map[value];
}

// A usage type has a region prefix everywhere but us-east-1.
function ec2Filters(s) {
  const usage = `${known(EC2_USAGE, s.tenancy ?? 'Shared', '--tenancy')}:${s.instanceType}`;
  return [
    f('operation', known(EC2_OPERATIONS, s.os ?? 'Linux', '--os')),
    { or: [f('usage_type', usage), { member: `${CUBE}.usage_type`, operator: 'endsWith', values: [`-${usage}`] }] },
  ];
}

const SERVICE = {
  ec2: { product: 'AmazonEC2', extra: ec2Filters },
  rds: { product: 'AmazonRDS', extra: (s) => [...(s.engine ? [f('database_engine', rdsEngine(s.engine))] : []), f('deployment_option', s.deployment ?? 'Single-AZ')] },
  elasticache: { product: 'AmazonElastiCache', extra: (s) => (s.engine ? [f('cache_engine', s.engine)] : []) },
};

function f(member, value) {
  return { member: `${CUBE}.${member}`, operator: 'equals', values: [value] };
}

export function buildPricingQuery(spec) {
  const svc = SERVICE[String(spec.service).toLowerCase()] ?? Object.values(SERVICE).find((x) => x.product === spec.service);
  const product = svc ? svc.product : spec.service; // allow a raw AWS service code passthrough
  if (!spec.instanceType) throw new Error('price requires --instance-type');
  if (!spec.region) throw new Error('price requires --region');
  return {
    dimensions: [
      `${CUBE}.amortized_rate_per_unit_usd`,
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

// Cheapest positive hourly rate among the matching rows. A reservation's amortized rate includes its upfront fee.
function cheapest(rows, predicate) {
  const rates = rows.filter((r) => isHourly(r) && predicate(r)).map((r) => num(r, 'amortized_rate_per_unit_usd')).filter((n) => Number.isFinite(n) && n > 0);
  return rates.length ? Math.min(...rates) : null;
}

const sig6 = (n) => Number(n.toPrecision(6));
const cents = (n) => (Math.abs(n) >= 0.01 ? Number(n.toFixed(2)) : sig6(n));

function layer(hourly, ondemand, { hours, count }) {
  if (hourly == null) return null;
  return {
    hourly_usd: sig6(hourly),
    monthly_usd: cents(hourly * hours * count),
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
