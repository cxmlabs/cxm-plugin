import assert from 'node:assert/strict';
import { test } from 'node:test';
import { specFromArgv } from '../src/commands/report.js';

test('report-opportunity reads every flag into the spec', () => {
  const spec = specFromArgv(['--arn', 'a1', '--arn', 'a2', '--title', 't', '--analysis', 'x', '--savings-monthly', '80', '--current-monthly', '100']);
  assert.deepEqual(spec.arns, ['a1', 'a2']);
  assert.equal(spec.savingsMonthly, 80);
  assert.equal(spec.currentMonthly, 100);
});
