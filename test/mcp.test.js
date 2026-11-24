// `cxm mcp` against a local server: a call prints one JSON object, and each failure prints one text and no result.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/cxm.js', import.meta.url));
const TOKEN = 'synthetic-access.token-value.signature';
const NEW_TOKEN = 'synthetic-renewed.token-value.signature';
const REFRESH = 'synthetic-refresh-value';
const JSON_TYPE = { 'content-type': 'application/json' };
const SSE_TYPE = { 'content-type': 'text/event-stream' };
const TOOLS = [{ name: 'top_costs', title: 'Top', description: 'Top costs', inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } } }];

let server;
let requests;
let answer;
before(async () => {
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body, rpc: req.url === '/mcp' ? JSON.parse(body) : null });
    answer(requests.at(-1), res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const origin = () => `http://127.0.0.1:${server.address().port}`;
const reply = (status, headers, body) => (req, res) => res.writeHead(status, headers).end(body);
const rpc = (result) => (req, res) => res.writeHead(200, JSON_TYPE).end(JSON.stringify({ jsonrpc: '2.0', id: req.rpc.id, result }));
const rows = { content: [{ type: 'text', text: 'the rows as text' }], structuredContent: { rows: [{ service: 'a', cost: 5 }] } };
const refused = (text) => rpc({ content: [{ type: 'text', text }], isError: true });

async function run(argv, handler, { config = {}, env = {}, preload } = {}) {
  requests = [];
  answer = handler;
  const dir = mkdtempSync(join(tmpdir(), 'cxm-mcp-'));
  const stored = {
    baseUrl: 'https://app.example.test', organizationId: 'org-a', accessToken: TOKEN, refreshToken: REFRESH, expiresAt: Math.floor(Date.now() / 1000) + 3600,
    latestCheckedAt: Date.now(), hosts: { mcp: `${origin()}/mcp`, tenantApi: `${origin()}/v1/tenant` }, ...config,
  };
  writeFileSync(join(dir, 'credentials.json'), JSON.stringify(stored));
  const { CXM_MCP_URL: _, ...clean } = process.env;
  const child = spawn(process.execPath, [...(preload ? ['--import', `data:text/javascript,${encodeURIComponent(preload)}`] : []), bin, 'mcp', ...argv], {
    env: { ...clean, CXM_CONFIG_DIR: dir, CXM_TELEMETRY: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = { stdout: '', stderr: '', dir };
  for (const name of ['stdout', 'stderr']) child[name].on('data', (chunk) => { out[name] += chunk; });
  const started = Date.now();
  out.status = await new Promise((done) => child.on('close', done));
  out.ms = Date.now() - started;
  return out;
}
const printed = (out) => {
  assert.deepEqual([out.status, out.stderr], [0, '']);
  return JSON.parse(out.stdout);
};
function failed(out, text, name) {
  assert.equal(out.status, 1, name);
  assert.equal(out.stdout, '', name);
  assert.match(out.stderr, text, name);
  assert.equal(out.stderr.trimEnd().split('\n').length, 1, `${name}: one text`);
}

test('lists the tools and calls one, from a JSON body and from an event stream', async () => {
  const list = printed(await run([], rpc({ tools: TOOLS })));
  assert.deepEqual(list, { source: 'CloudExMachina', organization: 'org-a', tools: [{ name: 'top_costs', description: 'Top costs', inputSchema: TOOLS[0].inputSchema }] });
  assert.deepEqual([requests[0].method, requests[0].url, requests[0].rpc.method], ['POST', '/mcp', 'tools/list']);

  const call = printed(await run(['top_costs', '{"limit": 3}'], rpc(rows)));
  assert.deepEqual(call, { source: 'CloudExMachina', organization: 'org-a', tool: 'top_costs', result: rows.structuredContent });
  assert.deepEqual(requests.map((r) => r.rpc), [{ jsonrpc: '2.0', id: requests[0].rpc.id, method: 'tools/call', params: { name: 'top_costs', arguments: { limit: 3 } } }]);
  const text = printed(await run(['top_costs'], rpc({ content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] })));
  assert.equal(text.result, 'one\ntwo');
  assert.deepEqual(requests[0].rpc.params.arguments, {}, 'no JSON means no arguments');

  // A comment, an empty event, a notification and another id come first. The stream stays open after the result.
  const stream = printed(await run(['top_costs'], (req, res) => {
    res.writeHead(200, SSE_TYPE);
    res.write(': hello\r\n\r\ndata:\n\n');
    res.write('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n');
    res.write(`data: {"jsonrpc":"2.0","id":"other","result":{"structuredContent":{"rows":[]}}}\r\n\r\n`);
    const json = JSON.stringify({ jsonrpc: '2.0', id: req.rpc.id, result: { structuredContent: { name: 'é' } } });
    const comma = json.indexOf(',') + 1;
    const bytes = Buffer.from(`event: message\ndata: ${json.slice(0, comma)}\ndata: ${json.slice(comma)}\n\n`);
    const half = bytes.indexOf(0xc3) + 1;
    res.write(bytes.subarray(0, half));
    setTimeout(() => res.write(bytes.subarray(half)), 50);
  }));
  assert.deepEqual(stream.result, { name: 'é' });
  const listed = await run([], (req, res) => {
    res.writeHead(200, SSE_TYPE).write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: req.rpc.id, result: { tools: TOOLS } })}\n\n`);
  });
  assert.equal(printed(listed).tools.length, 1);
  assert.ok(listed.ms < 20_000, 'the command does not wait for the end of the stream');
});

test('each call carries the user agent and the bearer token, and no cookie', async () => {
  for (const argv of [[], ['top_costs', '{}']]) {
    await run(argv, rpc({ tools: TOOLS, ...rows }));
    assert.equal(requests.length, 1);
    const { headers, url } = requests[0];
    assert.match(headers['user-agent'], /^cxm-plugin\//);
    assert.match(headers['x-cxm-client'], /^plugin\//);
    assert.equal(headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(headers.cookie, undefined);
    assert.match(headers.accept, /application\/json/);
    assert.match(headers.accept, /text\/event-stream/);
    assert.equal(url, '/mcp', 'no name and no argument in the URL');
  }
  const hostile = '../x?y=1#z';
  await run([hostile, '{"a":"../b"}'], rpc(rows));
  assert.deepEqual([requests[0].url, requests[0].rpc.params.name], ['/mcp', hostile]);
});

const LOGIN = /^Error: .*Run: cxm login$/m;
const NOT_RPC = /^Error: The CxM MCP gave an answer that is not JSON-RPC \(HTTP \d+\)\.$/m;
const NO_MCP = /^Error: No CxM MCP on this deployment \((HTTP 404|no host)\)\.$/m;
const call = ['top_costs', '{}'];
const asList = (then) => (req, res) => (req.rpc.method === 'tools/list' ? rpc({ tools: [...TOOLS, { name: 'other_tool' }] }) : then)(req, res);
const fakeFetch = (code) => `globalThis.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: '${code}' } }) }`;

test('each failure prints one text, exits with 1 and prints no result', async () => {
  const cases = [
    ['not signed in', call, rpc(rows), /^Error: Not logged in\. Run: cxm login$/m, { config: { accessToken: undefined } }],
    ['a session that cannot renew', call, reply(401, JSON_TYPE, '{}'), /^Error: Session expired\. Run: cxm login$/m, { config: { expiresAt: 1 } }],
    ['401', call, reply(401, JSON_TYPE, '{"error":"invalid_token"}'), LOGIN],
    ['401 on the list', [], reply(401, JSON_TYPE, '{"error":"invalid_token"}'), LOGIN],
    ['the session text of the service', call, refused('Your CXM session expired, reconnect the connector.'), LOGIN],
    ['403 with no JSON', call, reply(403, { 'content-type': 'text/html' }, '<html>403 Forbidden</html>'), /^Error: The request was refused before it reached the CxM MCP \(HTTP 403\)\.$/m],
    ['403 with other JSON', call, reply(403, JSON_TYPE, '{"detail":"x"}'), NOT_RPC],
    ['the connector is not enabled', call, refused('The Claude connector is not enabled for this organization.'), /^Error: The CxM MCP is not enabled for this organization\./m],
    ['still preparing', call, refused('CXM is still preparing this data, try again in a minute.'), /^Error: CXM is still preparing this data\. Try again in a minute\.$/m],
    ['unknown tool', ['nope'], asList(refused('Unknown tool: nope')), /^Error: Unknown tool "nope"\. Tools: top_costs, other_tool\.$/m],
    ['unknown tool as a JSON-RPC error', ['nope'], asList((req, res) => res.writeHead(200, JSON_TYPE).end(JSON.stringify({ jsonrpc: '2.0', id: req.rpc.id, error: { code: -32602, message: 'Unknown tool: nope' } }))), /^Error: Unknown tool "nope"\. Tools: top_costs, other_tool\.$/m],
    ['another isError text', call, refused('No cost data for this period.'), /^Error: No cost data for this period\.$/m],
    ['isError with no text', call, rpc({ content: [], isError: true, structuredContent: { rows: [] } }), /^Error: The tool failed and gave no text\.$/m],
    ['a JSON-RPC error', call, (req, res) => res.writeHead(400, JSON_TYPE).end(JSON.stringify({ jsonrpc: '2.0', id: 'server-error', error: { code: -32600, message: 'bad request' } })), /^Error: The CxM MCP refused the request: bad request$/m],
    ['a JSON-RPC error beside a result', call, (req, res) => res.writeHead(200, JSON_TYPE).end(JSON.stringify({ jsonrpc: '2.0', id: req.rpc.id, result: rows, error: { message: 'broken' } })), /refused the request: broken$/m],
    ['no content', call, rpc({ content: [] }), /^Error: The tool gave no text and no structured content\.$/m],
    ['a list with no tools field', [], rpc({}), NOT_RPC],
    ['a list in parts', [], rpc({ tools: TOOLS, nextCursor: 'x' }), /^Error: The CxM MCP lists its tools in parts, and this command reads one\. Update the plugin\.$/m],
    ['bad JSON', ['top_costs', '{bad'], rpc(rows), /^Error: The arguments are not one JSON object/m],
    ['JSON that is not an object', ['top_costs', '[1]'], rpc(rows), /^Error: The arguments are not one JSON object/m],
    ['one argument too many', ['top_costs', '{}', 'org-b'], rpc(rows), /^Error: cxm mcp takes one tool and one JSON object/m],
    ['HTML with 200', call, reply(200, { 'content-type': 'text/html' }, '<html></html>'), NOT_RPC],
    ['an empty 202', call, reply(202, {}, ''), NOT_RPC],
    ['JSON with no jsonrpc', call, reply(200, JSON_TYPE, JSON.stringify({ id: 1, result: rows })), NOT_RPC],
    ['another id', call, reply(200, JSON_TYPE, JSON.stringify({ jsonrpc: '2.0', id: 99, result: rows })), NOT_RPC],
    ['a stream with no result', call, reply(200, SSE_TYPE, 'data: {"jsonrpc":"2.0","method":"x"}\n\n'), NOT_RPC],
    ['a stream that is cut', call, reply(200, SSE_TYPE, 'data: {"jsonrpc":"2.0","id":1,"resu'), NOT_RPC],
    ['a redirect', call, (req, res) => res.writeHead(307, { location: `${origin()}/stolen`, ...JSON_TYPE }).end(JSON.stringify({ jsonrpc: '2.0', id: req.rpc.id, result: rows })), NOT_RPC],
    ['a gateway error, sent once', call, reply(503, { 'content-type': 'text/html' }, '<html></html>'), NOT_RPC],
    ['a result with a failed status', call, (req, res) => res.writeHead(500, JSON_TYPE).end(JSON.stringify({ jsonrpc: '2.0', id: req.rpc.id, result: rows })), NOT_RPC],
    ['404', call, reply(404, { 'content-type': 'text/html' }, 'x'), NO_MCP],
    ['no host', call, rpc(rows), NO_MCP, { preload: fakeFetch('ENOTFOUND') }],
    ['another network fault', call, rpc(rows), /^Error: The CxM MCP did not answer: network fault \(ECONNRESET\)\.$/m, { preload: fakeFetch('ECONNRESET') }],
    ['a connection that breaks in the answer', call, (req, res) => { res.writeHead(200, JSON_TYPE).write('{"jsonrpc"'); setTimeout(() => res.destroy(), 50); }, /^Error: The CxM MCP did not answer: network fault/m],
    ['a large answer', call, reply(200, JSON_TYPE, `{"jsonrpc":"2.0","id":1,"result":{"structuredContent":"${'x'.repeat(11 * 1024 * 1024)}"}}`), /^Error: The answer of the CxM MCP is larger than 10 MB\.$/m],
  ];
  // The preload makes the 90 seconds of the command short. Another value would not time out here.
  const short = 'const real = AbortSignal.timeout; AbortSignal.timeout = (ms) => real.call(AbortSignal, ms === 90000 ? 300 : 60000)';
  cases.push(['no answer', call, () => {}, /^Error: The CxM MCP did not answer in 90 seconds\.$/m, { preload: short }]);
  cases.push(['a stream with no end', call, (req, res) => res.writeHead(200, SSE_TYPE).write(': wait\n\n'), /^Error: The CxM MCP did not answer in 90 seconds\.$/m, { preload: short }]);
  for (const [name, argv, handler, text, options] of cases) {
    const out = await run(argv, handler, options);
    failed(out, text, name);
    assert.ok(out.ms < 20_000, name);
    assert.ok(requests.filter((r) => r.rpc?.method === 'tools/call').length <= 1, `${name}: a tool call is sent once`);
    assert.ok(!requests.some((r) => r.url === '/stolen'), `${name}: no redirect`);
  }
});

test('a token that expires renews through the session owner before the call', async () => {
  const out = await run(call, (req, res) => {
    if (req.url === '/v1/tenant/oauth/refresh') return reply(200, JSON_TYPE, JSON.stringify({ access_token: NEW_TOKEN, refresh_token: 'next-refresh', expires_in: 3600 }))(req, res);
    return rpc(rows)(req, res);
  }, { config: { expiresAt: Math.floor(Date.now() / 1000) + 5 } });
  assert.deepEqual(printed(out).result, rows.structuredContent);
  assert.deepEqual(requests.map((r) => r.url), ['/v1/tenant/oauth/refresh', '/mcp']);
  assert.equal(requests[1].headers.authorization, `Bearer ${NEW_TOKEN}`);
  assert.equal(JSON.parse(readFileSync(join(out.dir, 'credentials.json'), 'utf8')).refreshToken, 'next-refresh');
});

test('no output and no error holds the token', async () => {
  const echo = (req) => `you sent ${req.headers.authorization}`;
  const outs = [
    await run(call, (req, res) => rpc({ content: [{ type: 'text', text: echo(req) }] })(req, res)),
    await run(call, (req, res) => rpc({ structuredContent: { [echo(req)]: [echo(req)] } })(req, res)),
    await run([], (req, res) => rpc({ tools: [{ name: echo(req), description: echo(req), inputSchema: { title: echo(req) } }] })(req, res)),
    await run(call, (req, res) => refused(echo(req))(req, res)),
    await run(call, (req, res) => res.writeHead(400, JSON_TYPE).end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: echo(req) } }))),
    await run(['nope'], (req, res) => (req.rpc.method === 'tools/list' ? rpc({ tools: [{ name: echo(req) }] }) : refused('Unknown tool: nope'))(req, res)),
    await run(call, (req, res) => reply(403, { 'content-type': 'text/html' }, echo(req))(req, res)),
    await run(call, (req, res) => reply(500, { 'content-type': 'text/html' }, echo(req))(req, res)),
  ];
  for (const [i, out] of outs.entries()) {
    assert.ok(out.stdout + out.stderr, `case ${i} prints`);
    for (const secret of [TOKEN, REFRESH]) assert.ok(!(out.stdout + out.stderr).includes(secret), `case ${i}: ${out.stdout}${out.stderr}`);
  }
  assert.match(outs[0].stdout, /you sent Bearer XXX/);
});

test('telemetry holds the command name, and no tool, argument, result or error text', async () => {
  const sent = [];
  const collect = (mcpAnswer) => (req, res) => {
    if (req.url === '/mcp') return mcpAnswer(req, res);
    sent.push(JSON.parse(req.body));
    return reply(200, JSON_TYPE, '{}')(req, res);
  };
  const env = { CXM_TELEMETRY: '1', POSTHOG_HOST: origin() };
  const argv = ['secret_tool', '{"secret_argument":"secret_value"}'];
  for (const handler of [rpc({ structuredContent: { secret_result: 1 } }), refused('secret_text of the tool'), refused('Unknown tool: secret_tool'), reply(200, JSON_TYPE, 'secret_body')]) await run(argv, collect(handler), { env });
  await run(['secret_tool', '{secret_argument'], collect(rpc(rows)), { env });
  assert.deepEqual(sent.map((e) => [e.event, e.properties.command, e.properties.ok]), [
    ['plugin.command_run', 'mcp', true], ...Array(4).fill(['plugin.command_error', 'mcp', false]),
  ]);
  for (const secret of ['secret_', TOKEN]) assert.ok(!JSON.stringify(sent).includes(secret), secret);
});
