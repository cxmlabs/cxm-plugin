// Lightweight scan of Terraform text for priceable compute resources. Deliberately shallow —
// it only spots instance specs to nudge the agent toward `cxm price estimate`; the agent does the reasoning.

const PATTERNS = [
  { re: /instance_type\s*=\s*"([^"]+)"/g, kind: 'instance_type' },
  { re: /instance_class\s*=\s*"([^"]+)"/g, kind: 'instance_class' }, // RDS
  { re: /node_type\s*=\s*"([^"]+)"/g, kind: 'node_type' }, // ElastiCache
];

function serviceFor(kind, value) {
  if (kind === 'instance_class' || value.startsWith('db.')) return 'rds';
  if (kind === 'node_type' || value.startsWith('cache.')) return 'elasticache';
  return 'ec2';
}

export function scanTerraform(content) {
  if (!content) return { instances: [], region: null };
  const instances = [];
  const seen = new Set();
  for (const { re, kind } of PATTERNS) {
    for (const m of content.matchAll(re)) {
      const instanceType = m[1];
      const key = `${kind}:${instanceType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      instances.push({ service: serviceFor(kind, instanceType), instanceType });
    }
  }
  const regionMatch = content.match(/region\s*=\s*"([^"]+)"/);
  return { instances, region: regionMatch ? regionMatch[1] : null };
}

// Shared IaC nudge (Terraform or CloudFormation): point the agent at the CXM enrichment it can add.
export function iacNudge(instances, { source = 'Terraform', region = null } = {}) {
  if (!instances.length) return '';
  const list = instances.map((i) => `${i.instanceType} (${i.service})`).join(', ');
  const regionHint = region ? ` (region ${region})` : '';
  return (
    `CloudExMachina: this ${source} change adds/updates ${list}${regionHint}. Enrich it before apply — ` +
    'price it with cxm-cost-of-change (on-demand + the org\'s effective Savings Plan / RI / EDP rate), ' +
    'check what CXM already knows about similar resources with cxm-cloud-context, and consider a cheaper ' +
    'equivalent with cxm-architecture-review. ' +
    'If you are editing an EXISTING resource, use cxm-repo-graph to resolve it to its live ARN and surface ' +
    'any open CXM opportunity, its real cost, and its owner — a grounded side-track while you are in the file. ' +
    `e.g. cxm price estimate --service ${instances[0].service} --instance-type ${instances[0].instanceType} --region <region>.`
  );
}

// Back-compat wrapper for the Terraform path.
export function nudgeText({ instances, region }) {
  return iacNudge(instances, { source: 'Terraform', region });
}
