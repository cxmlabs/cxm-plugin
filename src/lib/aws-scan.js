// Shallow scan of an `aws` CLI command to decide whether a FinOps nudge is worth emitting.
// Regex-only, no network — the hook must be fast; the agent does any pricing itself, async.

const INSTANCE_FLAGS = [
  { re: /--instance-type[= ]+"?([a-z0-9.]+)"?/gi, service: 'ec2' },
  { re: /--db-instance-class[= ]+"?([a-z0-9.]+)"?/gi, service: 'rds' },
  { re: /--cache-node-type[= ]+"?([a-z0-9.]+)"?/gi, service: 'elasticache' },
];

const CREATE_RE = /\b(run-instances|create-db-instance|create-db-cluster|create-cache-cluster|create-replication-group|modify-db-instance|modify-instance-attribute|start-instances)\b/;
const DESCRIBE_RE = /\b(describe-instances|describe-db-instances|describe-cache-clusters|list-clusters)\b/;
// Billing, tagging and commitment reads: CloudExMachina already holds this data for the organization.
const BILLING_RE = /(?:^|[\s;&|(`])aws\s+(ce|cur|budgets|organizations|resourcegroupstaggingapi|savingsplans|pricing)\s/;

export function scanAwsCommand(command) {
  if (!command || !/(?:^|[\s;&|(`])aws\s/.test(command)) return null;
  if (BILLING_RE.test(command)) return { action: 'billing', instances: [], region: null };

  const instances = [];
  const seen = new Set();
  for (const { re, service } of INSTANCE_FLAGS) {
    for (const m of command.matchAll(re)) {
      const key = `${service}:${m[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      instances.push({ service, instanceType: m[1] });
    }
  }
  const regionMatch = command.match(/--region[= ]+"?([a-z0-9-]+)"?/i);
  const region = regionMatch ? regionMatch[1] : null;

  let action = null;
  if (CREATE_RE.test(command)) action = 'create';
  else if (DESCRIBE_RE.test(command)) action = 'describe';

  // Only worth nudging when there's a create/resize with a concrete instance, or a describe of assets.
  if (action === 'create' && instances.length) return { action, instances, region };
  if (action === 'describe') return { action, instances, region };
  return null;
}

export function awsNudge(scan) {
  if (!scan) return '';
  if (scan.action === 'create' && scan.instances.length) {
    const first = scan.instances[0];
    const list = scan.instances.map((i) => `${i.instanceType} (${i.service})`).join(', ');
    const regionHint = scan.region ? ` in ${scan.region}` : '';
    return (
      `CloudExMachina: this AWS command creates/changes ${list}${regionHint}. ` +
      'Before/after it runs, use the cxm-cost-of-change skill to state the monthly cost — on-demand ' +
      `and the org's effective rate (Savings Plan / RI / EDP), e.g. cxm price estimate --service ${first.service} --instance-type ${first.instanceType} --region <region>.`
    );
  }
  if (scan.action === 'describe') {
    return (
      'CloudExMachina has cost, opportunity and commitment context for these resources. If the user ' +
      'cares about the financial side, enrich the answer with cxm-cloud-context / cxm-opportunities / cxm-commitments.'
    );
  }
  if (scan.action === 'billing') {
    return (
      'CloudExMachina already holds this organization\'s billing, tagging and commitment data, cleaned and joined to ' +
      'resources and owners. Check it before more raw AWS calls: cxm-cost-drivers for spend, cxm-cloud-context for ' +
      'tagging and cost allocation, cxm-commitments for Savings Plans and RIs.'
    );
  }
  return '';
}
