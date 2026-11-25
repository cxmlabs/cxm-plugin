import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/cxm.js', import.meta.url));
const base = () => mkdtempSync(join(tmpdir(), 'cxm-cost-result-'));
const run = (stdin, file) => {
  const { CXM_COST_RESULT_FILE: _, ...env } = process.env;
  return spawnSync(process.execPath, [bin, 'cost-result'], {
    input: stdin,
    encoding: 'utf8',
    env: { ...env, CXM_CONFIG_DIR: base(), CXM_TELEMETRY: '0', ...(file === undefined ? {} : { CXM_COST_RESULT_FILE: file }) },
  });
};

test('cost-result prints the section, writes one block to the file that the caller names, and exits 1 with one fault per line', () => {
  const source = { kind: 'dataset', ref: 'synthetic' };
  const line = {
    id: 'L1', key: 'requests', target: 'job-a', item: 'S3 PUT', at: 'src/job.js:12@0123abc', tag: 'direct', direction: 'add',
    factors: [{ low: 2, high: 4, unit: 'x/mo', grade: 'B', source }, { low: 1, high: 1, unit: '$/x', grade: 'A', source }],
  };
  const input = { schema_version: 2, organization: 'org-a', lines: [line], coverage: [] };
  const dir = base();
  const file = join(dir, 'block.json');
  const readBlock = () => JSON.parse(readFileSync(file, 'utf8'));

  for (const none of [undefined, '']) {
    const good = run(JSON.stringify(input), none);
    assert.deepEqual([good.status, good.stderr], [0, '']);
    assert.match(good.stdout, /^\*\*\$2\.00 to \$4\.00 per month\*\*, grade B\. Estimated lines: 1 of 1 headline lines\. Uncovered targets: 0\.$/m);
    assert.doesNotMatch(good.stdout, /```|schema_version/, 'no variable: the section only');
  }
  const first = run(JSON.stringify(input), file);
  assert.deepEqual([first.status, first.stderr, first.stdout], [0, '', run(JSON.stringify(input)).stdout]);
  const { result, ...rest } = readBlock();
  assert.deepEqual(rest, input);
  assert.equal(result.headline.high, 4);
  assert.equal(run(readFileSync(file, 'utf8')).stdout, first.stdout, 'the block is a valid input and prints the same');

  assert.equal(run(JSON.stringify({ ...input, organization: 'org-b', lines: [] }), file).status, 0);
  assert.equal(readBlock().organization, 'org-b', 'a second run replaces the file');
  const kept = readFileSync(file, 'utf8');

  const bad = run(JSON.stringify({ ...input, lines: [{ ...line, amount: 1 }, { ...line, id: 'L2', tag: 'x' }] }), file);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.deepEqual(bad.stderr.trimEnd().split('\n').map((l) => l.split(':')[0]), ['line "L1"', 'line "L2"']);
  for (const stdin of ['', 'not json']) {
    const broken = run(stdin, file);
    assert.deepEqual([broken.status, broken.stdout, broken.stderr], [1, '', 'input: it is not a JSON object\n']);
  }
  assert.equal(readFileSync(file, 'utf8'), kept, 'a faulty input does not change the file');

  // A folder that does not exist, a file in place of a folder, and a path that is a folder.
  for (const [path, code] of [[join(dir, 'absent', 'block.json'), 'ENOENT'], [join(file, 'block.json'), 'ENOTDIR'], [dir, '(EISDIR|ENOTEMPTY|EEXIST|EPERM)']]) {
    const refused = run(JSON.stringify(input), path);
    assert.deepEqual([refused.status, refused.stdout], [1, '']);
    assert.match(refused.stderr, new RegExp(`^file: CXM_COST_RESULT_FILE cannot be written \\(${code}\\)\\n$`));
  }
  assert.deepEqual(readdirSync(dir), ['block.json'], 'no part file stays');
  assert.deepEqual(readdirSync(dirname(dir)).filter((name) => name.startsWith(`${basename(dir)}.`)), [], 'no part file stays beside a folder');
});

test('cost-result sends one event after its print, and telemetry never changes its output, its exit code or its end', async (t) => {
  const events = [];
  let hang = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    events.push(JSON.parse(body));
    if (!hang) res.end('{}');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const send = async (stdin, env) => {
    events.length = 0;
    const dir = base();
    const child = spawn(process.execPath, [bin, 'cost-result'], { env: { ...process.env, CXM_CONFIG_DIR: dir, POSTHOG_HOST: `http://127.0.0.1:${server.address().port}`, ...env } });
    const out = { stdout: '', stderr: '' };
    for (const name of ['stdout', 'stderr']) child[name].on('data', (chunk) => { out[name] += chunk; });
    child.stdin.end(stdin);
    const started = Date.now();
    out.status = await new Promise((done) => child.on('close', done));
    return { ...out, ms: Date.now() - started, cost: events.filter((e) => e.event === 'plugin.cost_result') };
  };
  const source = { kind: 'dataset', ref: 'secret-ref' };
  const input = JSON.stringify({ schema_version: 2, organization: 'secret-org', coverage: [], lines: [{ id: 'L1', key: 'aws/amazons3/storage', target: 'secret-target', item: 'secret-item', at: 'secret/path.js:1@0123abc', tag: 'direct', direction: 'add', directive: 'secret-directive', gap: 'other', factors: [{ low: 0, high: 400, unit: '$/mo', grade: 'B', source }] }] });
  const silent = run(input);
  const on = { CXM_TELEMETRY: '1' };
  const good = await send(input, on);
  assert.deepEqual([good.status, good.stdout], [0, silent.stdout]);
  assert.equal(good.cost.length, 1);
  assert.deepEqual([good.cost[0].properties.ok, good.cost[0].properties.open_count], [true, 1]);
  assert.ok(!JSON.stringify(good.cost).includes('secret'));
  assert.deepEqual((await send(input, { CXM_TELEMETRY: 'full' })).cost[0].properties.directives, ['secret-directive']);
  const bad = await send('not json', on);
  assert.deepEqual([bad.status, bad.stdout, bad.cost[0].properties.ok, bad.cost[0].properties.fault_codes], [1, '', false, ['not_an_object']]);
  const unwritten = await send(input, { ...on, CXM_COST_RESULT_FILE: join(base(), 'absent', 'x.json') });
  assert.deepEqual([unwritten.status, unwritten.stdout, unwritten.cost[0].properties.fault_codes], [1, '', ['file_not_written']]);
  const off = await send(input, { CXM_TELEMETRY: '0' });
  assert.deepEqual([off.status, off.stdout, events.length], [0, silent.stdout, 0]);
  hang = true;
  const slow = await send(input, on);
  assert.deepEqual([slow.status, slow.stdout], [0, silent.stdout]);
  // Each event waits 3 seconds at most, and this one does not add to the wait of the command event.
  assert.ok(slow.ms < 5500, `${slow.ms} ms`);
});
