import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nudgeText, scanTerraform } from '../src/lib/tf-scan.js';

const TF = `
provider "aws" { region = "eu-west-3" }
resource "aws_instance" "web" { instance_type = "m5.large" }
resource "aws_db_instance" "db" { instance_class = "db.r5.large" engine = "postgres" }
resource "aws_elasticache_replication_group" "c" { node_type = "cache.r6g.large" }
`;

test('scan finds ec2 / rds / elasticache instances + region', () => {
  const { instances, region } = scanTerraform(TF);
  assert.equal(region, 'eu-west-3');
  const byType = Object.fromEntries(instances.map((i) => [i.instanceType, i.service]));
  assert.equal(byType['m5.large'], 'ec2');
  assert.equal(byType['db.r5.large'], 'rds');
  assert.equal(byType['cache.r6g.large'], 'elasticache');
});

test('scan dedups and handles empty', () => {
  assert.deepEqual(scanTerraform('').instances, []);
  const dup = scanTerraform('a = "x"\ninstance_type = "m5.large"\ninstance_type = "m5.large"');
  assert.equal(dup.instances.length, 1);
});

test('nudge mentions the instances or is empty', () => {
  assert.equal(nudgeText({ instances: [], region: null }), '');
  const n = nudgeText(scanTerraform(TF));
  assert.match(n, /m5\.large/);
  assert.match(n, /cxm price/);
});
