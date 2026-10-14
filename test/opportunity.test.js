import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOpportunityPayload } from '../src/lib/opportunity.js';

test('builds payload with required fields and the two costs the user gave', () => {
  const p = buildOpportunityPayload({
    arns: ['arn:aws:ec2:eu-west-3:1:instance/i-abc'],
    title: 'Idle EC2 instance i-abc',
    analysis: 'Instance has <2% CPU for 30 days.',
    savingsMonthly: 80,
    currentMonthly: 100,
    region: 'eu-west-3',
    resourceType: 'EC2 Instance',
  });
  assert.deepEqual(p.arns, ['arn:aws:ec2:eu-west-3:1:instance/i-abc']);
  assert.equal(p.hri_name, 'Idle EC2 instance i-abc');
  assert.equal(p.cost_savings_monthly, 80);
  assert.equal(p.cost_current_monthly, 100);
  for (const derived of ['cost_projected_monthly', 'cost_savings_annual']) {
    assert.ok(!(derived in p), `the CLI computes nothing: the platform derives ${derived}`);
  }
  assert.equal(p.region, 'eu-west-3');
  assert.equal(p.cost_currency_code, 'USD');
});

test('requires arn, title, analysis', () => {
  assert.throws(() => buildOpportunityPayload({ title: 't', analysis: 'a' }));
  assert.throws(() => buildOpportunityPayload({ arns: ['x'], analysis: 'a' }));
  assert.throws(() => buildOpportunityPayload({ arns: ['x'], title: 't' }));
});

test('omits unset optional fields', () => {
  const p = buildOpportunityPayload({ arns: ['x'], title: 't', analysis: 'a' });
  assert.ok(!('region' in p));
  assert.ok(!('cost_savings_monthly' in p));
});

test('a saving needs the current cost it comes off, and cannot exceed it', () => {
  const base = { arns: ['x'], title: 't', analysis: 'a' };
  for (const currentMonthly of [undefined, 0, -5, NaN, Infinity]) {
    assert.throws(() => buildOpportunityPayload({ ...base, savingsMonthly: 70, currentMonthly }), /needs --current-monthly/);
  }
  for (const savingsMonthly of [0, -1, NaN, 120]) {
    assert.throws(() => buildOpportunityPayload({ ...base, savingsMonthly, currentMonthly: 100 }), /above 0 and at most/);
  }
  assert.equal(buildOpportunityPayload({ ...base, savingsMonthly: 100, currentMonthly: 100 }).cost_savings_monthly, 100);
});
