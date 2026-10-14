// Shallow scan of a CloudFormation template (YAML or JSON) for priceable compute resources.
// Only nudges when the file actually looks like CFN, so ordinary YAML/JSON edits stay silent.

const CFN_MARKERS = /AWSTemplateFormatVersion|Type:\s*["']?AWS::|"Type"\s*:\s*"AWS::/;

// Value quotes are optional (YAML: `InstanceType: m5.large`; JSON: `"InstanceType":"m5.large"`).
const PROPERTY_PATTERNS = [
  { re: /["']?InstanceType["']?\s*:\s*["']?([a-z0-9.]+)["']?/gi, service: 'ec2' },
  { re: /["']?DBInstanceClass["']?\s*:\s*["']?([a-z0-9.]+)["']?/gi, service: 'rds' },
  { re: /["']?CacheNodeType["']?\s*:\s*["']?([a-z0-9.]+)["']?/gi, service: 'elasticache' },
];

function serviceFor(service, value) {
  if (value.startsWith('db.')) return 'rds';
  if (value.startsWith('cache.')) return 'elasticache';
  return service;
}

export function scanCloudFormation(content) {
  if (!content || !CFN_MARKERS.test(content)) return { isCfn: false, instances: [] };
  const instances = [];
  const seen = new Set();
  for (const { re, service } of PROPERTY_PATTERNS) {
    for (const m of content.matchAll(re)) {
      const instanceType = m[1];
      const svc = serviceFor(service, instanceType);
      const key = `${svc}:${instanceType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      instances.push({ service: svc, instanceType });
    }
  }
  return { isCfn: true, instances };
}
