import { requireSession } from '../lib/config.js';
import { cubeLoad } from '../lib/http.js';
import { buildPricingQuery, summarizePricing } from '../lib/pricing.js';

function getFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function price(argv) {
  const config = await requireSession();
  const spec = {
    service: (getFlag(argv, '--service') ?? 'ec2').toLowerCase(),
    instanceType: getFlag(argv, '--instance-type'),
    region: getFlag(argv, '--region'),
    os: getFlag(argv, '--os'),
    engine: getFlag(argv, '--engine'),
    deployment: getFlag(argv, '--deployment'),
    tenancy: getFlag(argv, '--tenancy'),
  };
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
