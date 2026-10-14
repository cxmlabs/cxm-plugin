// The query shape feeds usage telemetry. A filter value must never reach it.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The safety property of the usage signal: dataset names are harvested from structural positions
// only, so a filter VALUE can never be mistaken for one. A regression here would put customer
// resource ids into our analytics.
test('queryShape harvests datasets but never filter values', async () => {
  const { queryShape } = await import('../src/lib/query-shape.js');
  const shape = queryShape({
    measures: ['costs.sum_current_unblended_cost'],
    dimensions: ['costs.usage_type'],
    segments: ['opportunities.not_dismissed'],
    timeDimensions: [{ dimension: 'costs.billing_day', dateRange: 'last 30 days' }],
    order: { 'smells.estimated_monthly_cost': 'desc' },
    filters: [
      { member: 'costs.resource_id', operator: 'equals', values: ['arn:aws:s3:::acme.prod.bucket'] },
      { or: [{ member: 'resource_map.repo', operator: 'equals', values: ['acme/infra.git'] }] },
    ],
    limit: 10,
  });
  assert.deepEqual(shape.datasets, ['costs', 'opportunities', 'resource_map', 'smells']);
  assert.equal(shape.measures, 1);
  assert.equal(shape.dimensions, 1);
  assert.equal(shape.filters, 2);
  assert.equal(shape.time_dimensions, 1);
  assert.equal(shape.ordered, true);
  assert.equal(shape.limit, 10);
  // The two values both contain dots and both name a customer asset. Neither may appear anywhere.
  const serialized = JSON.stringify(shape);
  for (const leak of ['arn', 'acme', 'bucket', 'infra']) {
    assert.ok(!serialized.includes(leak), `queryShape leaked "${leak}": ${serialized}`);
  }
});

test('an empty query produces an empty shape rather than throwing', async () => {
  const { queryShape } = await import('../src/lib/query-shape.js');
  assert.deepEqual(queryShape({}).datasets, []);
  assert.equal(queryShape({}).ordered, false);
  assert.equal(queryShape({}).limit, null);
});

// Pins the two claims the README makes that are easiest to break by accident.
test('the error path ships a class, never a raw message', () => {
  const src = readFileSync(new URL('../bin/cxm.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf("plugin.command_error"), src.indexOf('console.error(`Error: ${err.message}`)'));
  assert.ok(block.includes('error_class: classifyError(err)'), 'error_class must still be emitted');
  assert.ok(!/\n\s*error:/.test(block), 'a raw error message must not be emitted — orgApi() paths can carry an ARN');
});

test('telemetry points at the plugin project, not the shared app project', () => {
  const src = readFileSync(new URL('../src/lib/telemetry.js', import.meta.url), 'utf8');
  assert.ok(src.includes("'phc_xtYRe5MvWTcWDF6qicjiievMkb22Cc7VCcFoQyd5pmCV'"), 'plugin project key missing');
  assert.ok(!src.includes('phc_UsaMLU7cNOAp8sI8rwlNJoIfq2RilDUkH2QiLsRt7qG'), 'shared CxM app key must be gone');
});
