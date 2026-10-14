import assert from 'node:assert/strict';
import { test } from 'node:test';

const { buildResolution } = await import('../src/commands/resolve.js');

const A = 'resource_map';
const C = 'costs';

test('buildResolution merges arn-source-map + summed cost + opportunities', () => {
  const arn = 'arn:aws:ecs:eu-west-3:123456789012:cluster/cxm';
  const r = buildResolution(arn, {
    arnRow: {
      [`${A}.resource_type`]: 'aws_ecs_cluster',
      [`${A}.account_id`]: '123456789012',
      [`${A}.region`]: 'eu-west-3',
      [`${A}.repo`]: 'example-org/infra',
      [`${A}.terraform_address`]: 'aws_ecs_cluster.main',
      [`${A}.source_file`]: 'ecs_cluster.tf',
    },
    costRows: [{ [`${C}.sum_current_unblended_cost`]: 12.5 }, { [`${C}.sum_current_unblended_cost`]: 7.25 }],
    opportunities: [{ id: 'opp-1', title: 'Rightsize' }],
  });
  assert.equal(r.arn, arn);
  assert.equal(r.repo, 'example-org/infra');
  assert.equal(r.terraform_address, 'aws_ecs_cluster.main');
  assert.equal(r.monthly_cost_usd, 19.75);
  assert.equal(r.open_opportunities.length, 1);
});

test('buildResolution tolerates missing rows / {items} opportunity shape', () => {
  const r = buildResolution('arn:x', { arnRow: undefined, costRows: [], opportunities: { items: [{ id: 'o' }] } });
  assert.equal(r.monthly_cost_usd, 0);
  assert.equal(r.repo, null);
  assert.equal(r.open_opportunities.length, 1);
});
