import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const { scanRepo } = await import('../src/lib/repo-scan.js');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cxm-scan-'));
  mkdirSync(join(dir, 'infra'));
  writeFileSync(
    join(dir, 'infra', 'main.tf'),
    `
    resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
    resource "aws_subnet" "a" { vpc_id = aws_vpc.main.id }
    data "aws_ami" "ubuntu" { most_recent = true }
    module "cluster" { source = "./modules/ecs" }
    `,
  );
  writeFileSync(join(dir, 'pyproject.toml'), "[project]\nname='x'\n");
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'node_modules', 'ignored.tf'), 'resource "aws_x" "should_not_appear" {}');
  return dir;
}

test('scanRepo extracts terraform + marker nodes, skips ignored dirs', () => {
  const g = scanRepo(fixture());
  const addrs = g.nodes.filter((n) => n.metadata.terraform_address).map((n) => n.metadata.terraform_address);
  assert.ok(addrs.includes('aws_vpc.main'));
  assert.ok(addrs.includes('aws_subnet.a'));
  assert.ok(addrs.includes('data.aws_ami.ubuntu'));
  assert.ok(addrs.includes('module.cluster'));
  assert.ok(!addrs.includes('aws_x.should_not_appear'), 'node_modules must be skipped');
  assert.ok(g.nodes.some((n) => n.metadata.marker === 'python'), 'pyproject marker node');
  // Every node id follows the server grammar repo:path:suffix.
  for (const n of g.nodes) assert.match(n.id, /^[^:]+\/[^:]+:.*:.+$/);
});

test('scanRepo links a reference edge (subnet -> vpc)', () => {
  const g = scanRepo(fixture());
  const byAddr = Object.fromEntries(g.nodes.filter((n) => n.metadata.terraform_address).map((n) => [n.metadata.terraform_address, n.id]));
  const edge = g.edges.find((e) => e.source === byAddr['aws_subnet.a'] && e.target === byAddr['aws_vpc.main']);
  assert.ok(edge, 'aws_subnet.a should reference aws_vpc.main');
  assert.equal(edge.edge_type, 'references');
});
