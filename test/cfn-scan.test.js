import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanCloudFormation } from '../src/lib/cfn-scan.js';

const YAML_CFN = `AWSTemplateFormatVersion: '2010-09-09'
Resources:
  Web:
    Type: AWS::EC2::Instance
    Properties:
      InstanceType: m5.large
  Db:
    Type: AWS::RDS::DBInstance
    Properties:
      DBInstanceClass: db.r6g.large
`;

const JSON_CFN = `{"Resources":{"Web":{"Type":"AWS::EC2::Instance","Properties":{"InstanceType":"c6i.xlarge"}}}}`;

test('YAML CFN → detected + ec2/rds instances', () => {
  const s = scanCloudFormation(YAML_CFN);
  assert.equal(s.isCfn, true);
  const byType = Object.fromEntries(s.instances.map((i) => [i.instanceType, i.service]));
  assert.equal(byType['m5.large'], 'ec2');
  assert.equal(byType['db.r6g.large'], 'rds');
});

test('JSON CFN → detected', () => {
  const s = scanCloudFormation(JSON_CFN);
  assert.equal(s.isCfn, true);
  assert.equal(s.instances[0].instanceType, 'c6i.xlarge');
});

test('ordinary yaml (no CFN markers) → not CFN, silent', () => {
  const s = scanCloudFormation('name: my-app\nreplicas: 3\ninstanceType: not-a-real-field');
  assert.equal(s.isCfn, false);
  assert.deepEqual(s.instances, []);
});
