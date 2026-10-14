import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awsNudge, scanAwsCommand } from '../src/lib/aws-scan.js';

test('run-instances → create action with ec2 instance + region', () => {
  const s = scanAwsCommand('aws ec2 run-instances --image-id ami-123 --instance-type m5.large --region eu-west-3');
  assert.equal(s.action, 'create');
  assert.deepEqual(s.instances[0], { service: 'ec2', instanceType: 'm5.large' });
  assert.equal(s.region, 'eu-west-3');
  assert.match(awsNudge(s), /m5\.large/);
  assert.match(awsNudge(s), /cxm price/);
});

test('rds create → db-instance-class as rds', () => {
  const s = scanAwsCommand('aws rds create-db-instance --db-instance-class db.r6g.large --engine postgres --region us-east-1');
  assert.equal(s.instances[0].service, 'rds');
  assert.equal(s.instances[0].instanceType, 'db.r6g.large');
});

test('describe → describe action + finops-context nudge', () => {
  const s = scanAwsCommand('aws ec2 describe-instances --instance-ids i-abc');
  assert.equal(s.action, 'describe');
  assert.match(awsNudge(s), /cost, opportunity and commitment context/);
});

test('non-aws or irrelevant aws command → no nudge', () => {
  assert.equal(scanAwsCommand('ls -la'), null);
  assert.equal(scanAwsCommand('aws s3 ls'), null); // no create/describe-instance, no instance flag
  assert.equal(scanAwsCommand('aws ec2 run-instances --image-id ami-1'), null); // create but no instance type
  assert.equal(awsNudge(null), '');
});

test('a billing or tagging read nudges toward CXM, even after cd', () => {
  for (const cmd of ['aws ce get-cost-and-usage --time-period X', 'cd /x; aws ce list-cost-allocation-tags', 'aws organizations list-accounts']) {
    assert.match(awsNudge(scanAwsCommand(cmd)), /cxm-cloud-context/, cmd);
  }
  assert.equal(scanAwsCommand('echo aws-ce'), null);
});
