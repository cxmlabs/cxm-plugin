import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/cxm.js', import.meta.url));
const run = (stdin) =>
  spawnSync(process.execPath, [bin, 'cost-result'], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, CXM_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'cxm-cost-result-')), CXM_TELEMETRY: '0' },
  });

test('cost-result prints the section and one block, and exits 1 with one fault per line', () => {
  const source = { kind: 'dataset', ref: 'synthetic' };
  const line = {
    id: 'L1', key: 'requests', target: 'job-a', item: 'S3 PUT', at: 'src/job.js:12@0123abc', tag: 'direct', direction: 'add',
    factors: [{ low: 2, high: 4, unit: 'x/mo', grade: 'B', source }, { low: 1, high: 1, unit: '$/x', grade: 'A', source }],
  };
  const input = { schema_version: 2, organization: 'org-a', lines: [line], coverage: [] };
  const good = run(JSON.stringify(input));
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stderr, '');
  assert.match(good.stdout, /^\*\*\$2\.00 to \$4\.00 per month\*\*, grade B\. Uncovered targets: 0\.$/m);
  const blocks = [...good.stdout.matchAll(/^```cxm-cost-result\n([\s\S]*?)\n```$/gm)];
  assert.equal(blocks.length, 1);
  const { result, ...rest } = JSON.parse(blocks[0][1]);
  assert.deepEqual(rest, input);
  assert.equal(result.headline.high, 4);
  assert.equal(run(blocks[0][1]).stdout, good.stdout, 'the block is a valid input and prints the same');

  const bad = run(JSON.stringify({ ...input, lines: [{ ...line, amount: 1 }, { ...line, id: 'L2', tag: 'x' }] }));
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.deepEqual(bad.stderr.trimEnd().split('\n').map((l) => l.split(':')[0]), ['line "L1"', 'line "L2"']);

  for (const stdin of ['', 'not json']) {
    const broken = run(stdin);
    assert.deepEqual([broken.status, broken.stdout, broken.stderr], [1, '', 'input: it is not a JSON object\n']);
  }
});
