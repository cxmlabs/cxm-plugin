import { requireSession } from '../lib/config.js';
import { orgApi } from '../lib/http.js';
import { buildOpportunityPayload } from '../lib/opportunity.js';
import { emit } from '../lib/telemetry.js';

function getFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// Collect a repeatable flag (e.g. multiple --arn).
function getAll(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}

const num = (v) => (v !== undefined ? Number(v) : undefined);

export function specFromArgv(argv) {
  return {
    arns: getAll(argv, '--arn'),
    title: getFlag(argv, '--title'),
    analysis: getFlag(argv, '--analysis'),
    description: getFlag(argv, '--description'),
    resourceType: getFlag(argv, '--resource-type'),
    effort: getFlag(argv, '--effort'),
    accountId: getFlag(argv, '--account-id'),
    region: getFlag(argv, '--region'),
    savingsMonthly: num(getFlag(argv, '--savings-monthly')),
    currentMonthly: num(getFlag(argv, '--current-monthly')),
  };
}

export async function reportOpportunity(argv) {
  const config = await requireSession();
  const spec = specFromArgv(argv);
  const payload = buildOpportunityPayload(spec);
  const created = await orgApi(config, 'POST', '/acxm/opportunities', payload);

  // How much money the plugin's advice put on the table. Amount + coarse category ONLY —
  // never the arn, title, or analysis (that's customer data). Only when a real number is given.
  if (Number.isFinite(spec.savingsMonthly) && spec.savingsMonthly > 0) {
    await emit('plugin.savings_advised', {
      amount_monthly_usd: spec.savingsMonthly,
      currency: 'USD',
      advice_category: spec.resourceType || 'unknown',
      effort: spec.effort,
    });
  }
  console.log(
    JSON.stringify(
      { source: 'CloudExMachina', organization: config.organizationId, reported: true, opportunity: created },
      null,
      2,
    ),
  );
}
