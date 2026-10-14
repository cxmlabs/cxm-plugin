import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaView } from '../src/lib/datasets.js';

const cubes = [
  { name: 'costs', measures: [{ name: 'costs.sum_x', type: 'number', shortTitle: 'Sum X', description: 'Net cost' }], dimensions: [{ name: 'costs.service', type: 'string', title: 'Service' }], segments: [{ name: 'costs.prod', title: 'Prod' }] },
  { name: 'costs_daily', measures: [], dimensions: [] },
  { name: 'internal_cube', meta: { internal: true }, measures: [], dimensions: [] },
  { name: 'commitments', meta: { other: 1 }, measures: [], dimensions: [{ name: 'commitments.segment', type: 'string' }] },
];

test('schemaView lists every dataset not marked internal, with its fields', () => {
  assert.deepEqual(schemaView(cubes).datasets.map((d) => d.dataset), ['costs', 'costs_daily', 'commitments']);
  const schema = schemaView(cubes, 'costs').schema;
  assert.deepEqual(schema.measures[0], { name: 'costs.sum_x', type: 'number', title: 'Sum X', description: 'Net cost' });
  assert.equal(schema.segments[0].name, 'costs.prod', 'an exact name returns that dataset alone, segments included');
  assert.equal(schemaView(cubes, 'cost').schema.length, 2);
  assert.throws(() => schemaView(cubes, 'internal_cube'), /No dataset matches/);
});
