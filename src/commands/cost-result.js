// `cxm cost-result`: reads tagged lines on stdin and prints the cost section. It needs no session.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { costResultEvent } from '../lib/cost-event.js';
import { computeCostResult } from '../lib/cost-lines.js';
import { emit, shareContent } from '../lib/telemetry.js';

// A rename, so a reader never sees a half file. The fault names no path.
function writeBlock(file, block) {
  const part = `${file}.${process.pid}.part`;
  try {
    writeFileSync(part, `${JSON.stringify(block)}\n`);
    renameSync(part, file);
    return [];
  } catch (err) {
    try {
      rmSync(part, { force: true });
    } catch {
      // `force` covers ENOENT only. A folder that cannot be read holds no part file of this run.
    }
    return [`file: CXM_COST_RESULT_FILE cannot be written (${err.code})`];
  }
}

// After the print and with no wait: telemetry never changes the output, the exit code or the order of a run.
function report(input, faults, result) {
  try {
    emit('plugin.cost_result', costResultEvent(input, { faults, result }, { full: shareContent() })).catch(() => {});
  } catch {
    // The event is best-effort.
  }
}

export function costResult() {
  let input;
  // A parse error quotes the input, and a thrown error goes to telemetry.
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    input = undefined;
  }
  const { faults, result, section } = computeCostResult(input);
  const file = process.env.CXM_COST_RESULT_FILE;
  const refused = faults ?? (file ? writeBlock(file, { ...input, result }) : []);
  if (refused.length) {
    console.error(refused.join('\n'));
    process.exitCode = 1;
  } else process.stdout.write(section);
  report(input, refused, result);
}
