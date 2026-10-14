import { requireSession } from '../lib/config.js';
import { cubeLoad, orgApi } from '../lib/http.js';

function getFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// Merge the repo-graph + cost + opportunity lookups into one answer. Pure, so it's unit-testable
// without the network. `k(cube, field)` reads a cube-qualified key from a row.
export function buildResolution(arn, { arnRow, costRows, opportunities }) {
  const k = (row, cube, field) => row?.[`${cube}.${field}`];
  const A = 'resource_map';
  const C = 'costs';
  const monthly = (costRows || []).reduce((s, r) => s + Number(k(r, C, 'sum_current_unblended_cost') || 0), 0);
  return {
    arn,
    resource_type: k(arnRow, A, 'resource_type') || null,
    account_id: k(arnRow, A, 'account_id') || null,
    region: k(arnRow, A, 'region') || null,
    repo: k(arnRow, A, 'repo') || null,
    terraform_address: k(arnRow, A, 'terraform_address') || null,
    source_file: k(arnRow, A, 'source_file') || null,
    monthly_cost_usd: Math.round(monthly * 100) / 100,
    open_opportunities: Array.isArray(opportunities) ? opportunities : (opportunities?.items ?? []),
  };
}

// `cxm context show --arn <ARN>` or `--address <tf-address> [--repo <owner/repo>]` — one call that returns
// the resource's live identity, cost, owner-repo, and open CXM opportunities. Convenience over the
// several analytics calls the cxm-repo-graph skill otherwise chains.
export async function resolve(argv) {
  const config = await requireSession();
  const A = 'resource_map';
  let arn = getFlag(argv, '--arn');
  const address = getFlag(argv, '--address');
  const repo = getFlag(argv, '--repo');

  if (!arn && !address) throw new Error('context show requires --arn <ARN> or --address <tf-address> [--repo <owner/repo>]');

  if (!arn) {
    const filters = [{ member: `${A}.terraform_address`, operator: 'equals', values: [address] }];
    if (repo) filters.push({ member: `${A}.repo`, operator: 'equals', values: [repo] });
    const rows = await cubeLoad(config, { dimensions: [`${A}.arn`, `${A}.confidence`], filters, order: { [`${A}.confidence`]: 'desc' }, limit: 1 });
    arn = rows[0]?.[`${A}.arn`];
    if (!arn) throw new Error(`No ARN found for address ${address}${repo ? ` in ${repo}` : ''}. It may not be deployed yet, or try --repo.`);
  }

  const dims = ['arn', 'resource_type', 'account_id', 'region', 'repo', 'terraform_address', 'source_file'].map((d) => `${A}.${d}`);
  const [arnRows, costRows, opportunities] = await Promise.all([
    cubeLoad(config, { dimensions: dims, filters: [{ member: `${A}.arn`, operator: 'equals', values: [arn] }], limit: 1 }),
    cubeLoad(config, {
      measures: ['costs.sum_current_unblended_cost'],
      filters: [{ member: 'costs.resource_id', operator: 'equals', values: [arn] }],
      timeDimensions: [{ dimension: 'costs.billing_day', dateRange: 'last 30 days' }],
    }),
    orgApi(config, 'GET', `/acxm/opportunities?arn=${encodeURIComponent(arn)}`).catch(() => []),
  ]);

  const resolution = buildResolution(arn, { arnRow: arnRows[0], costRows, opportunities });
  console.log(JSON.stringify({ organization: config.organizationId, resolution }, null, 2));
}
