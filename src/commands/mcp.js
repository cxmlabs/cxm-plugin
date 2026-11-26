// `cxm mcp`: forwards one call to the hosted CxM MCP with the session of `cxm login`. It prints one JSON object, or fails.
import { requireSession } from '../lib/config.js';
import { RELOGIN, mcpCall, mcpTools } from '../lib/http.js';

// The refusals of the service that need a text for this command. Any other text passes as it is.
const REFUSALS = [
  [/^(?:The CxM MCP refused the request: )?Your CXM session expired/, RELOGIN],
  [/connector is not enabled for this organization/, 'The CxM MCP is not enabled for this organization. Ask your CloudExMachina contact to enable it.'],
  [/^(?:The CxM MCP refused the request: )?CXM is still preparing/, 'CXM is still preparing this data. Try again in a minute.'],
];

function readArguments(json) {
  if (json === undefined) return {};
  let value;
  // A parse error quotes the input.
  try {
    value = JSON.parse(json);
  } catch {
    value = null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error("cxm mcp requires its arguments as one JSON object. Example: cxm mcp <tool> '{\"limit\": 3}'");
  }
  return value;
}

async function unknownTool(config, tool) {
  const names = (await mcpTools(config)).map((t) => t.name).join(', ');
  return new Error(`Unknown tool "${tool}". Tools: ${names}.`);
}

export async function mcp([tool, json, ...more]) {
  if (more.length) throw new Error("cxm mcp takes one tool and one JSON object. Example: cxm mcp <tool> '{\"limit\": 3}'");
  const args = readArguments(json);
  const config = await requireSession();
  // The service can repeat what it received, so the token is hidden in each text that leaves this command.
  const hide = (text) => text.replaceAll(config.accessToken, 'XXX');
  const head = { source: 'CloudExMachina', organization: config.organizationId };
  try {
    const answer = tool === undefined ? { tools: await mcpTools(config) } : { tool, result: await mcpCall(config, tool, args) };
    console.log(hide(JSON.stringify({ ...head, ...answer }, null, 2)));
  } catch (err) {
    const failure = tool !== undefined && /^(The CxM MCP refused the request: )?Unknown tool\b/.test(err.message) ? await unknownTool(config, tool).catch(() => err) : err;
    throw new Error(hide(REFUSALS.find(([refusal]) => refusal.test(failure.message))?.[1] ?? failure.message));
  }
}
