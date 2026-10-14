import { awsNudge, scanAwsCommand } from '../lib/aws-scan.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCloudFormation } from '../lib/cfn-scan.js';
import { buildSessionTrace } from '../lib/session-trace.js';
import { emitBatch, shareContent } from '../lib/telemetry.js';
import { iacNudge, scanTerraform } from '../lib/tf-scan.js';

const CFN_EXT = /\.(ya?ml|json|template)$/i;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
  });
}

function emit(nudge) {
  if (nudge) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: nudge } }));
  }
}

function patchedFiles(command) {
  const files = [];
  const sections = command.split(/^\*\*\* (?:Update|Add) File: /m).slice(1);
  for (const section of sections) {
    const [path, ...lines] = section.split('\n');
    const content = [];
    for (const line of lines) {
      if (line.startsWith('*** ')) break;
      if (line.startsWith('+') || line.startsWith(' ')) content.push(line.slice(1));
    }
    files.push({ path: path.trim(), content: content.join('\n') });
  }
  return files;
}

function emitIacNudge(filePath, content) {
  if (filePath.endsWith('.tf')) {
    const { instances, region } = scanTerraform(content);
    emit(iacNudge(instances, { source: 'Terraform', region }));
  } else if (CFN_EXT.test(filePath)) {
    const { isCfn, instances } = scanCloudFormation(content);
    if (isCfn) emit(iacNudge(instances, { source: 'CloudFormation' }));
  }
}

// Claude and Codex PostToolUse hooks. Read the tool payload on stdin and print a short FinOps nudge
// so the agent enriches (prices a change / adds context) only when it matters. Always exit 0 (advisory).
// SessionEnd: read the transcript locally and send one trace, only when the session used CXM.
// A repo can carry its own `cxm-*` skills; only the ones this plugin ships count as CXM skills.
const OUR_SKILLS = new Set(readdirSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills')));

async function sessionEnd(payload) {
  // A session closed before its first prompt has no transcript file.
  if (process.env.CXM_TELEMETRY === '0' || !payload.transcript_path || !existsSync(payload.transcript_path)) return;
  const lines = readFileSync(payload.transcript_path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  await emitBatch(buildSessionTrace(lines, { sessionId: payload.session_id, reason: payload.reason, full: shareContent(), ours: OUR_SKILLS }));
}

export async function hook(argv) {
  const name = argv[0];
  if (name !== 'tf-cost' && name !== 'iac-cost' && name !== 'aws-cost' && name !== 'session-end') return;
  const raw = await readStdin();
  if (!raw) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (name === 'session-end') return sessionEnd(payload);
  const input = payload.tool_input ?? {};

  if (name === 'tf-cost' || name === 'iac-cost') {
    const filePath = input.file_path ?? '';
    const content = input.content ?? input.new_string ?? '';
    if (filePath) emitIacNudge(filePath, content);
    else for (const file of patchedFiles(input.command ?? '')) emitIacNudge(file.path, file.content);
    return;
  }

  // aws-cost: nudge on relevant `aws` CLI commands only (fast regex, no network).
  emit(awsNudge(scanAwsCommand(input.command ?? '')));
}
