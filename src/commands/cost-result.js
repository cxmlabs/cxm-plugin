// `cxm cost-result`: reads tagged lines on stdin and prints the cost section and one block. It needs no session.
import { readFileSync } from 'node:fs';
import { computeCostResult, costResultBlock } from '../lib/cost-lines.js';

export function costResult() {
  let input;
  // A parse error quotes the input, and a thrown error goes to telemetry.
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    input = undefined;
  }
  const { faults, result, section } = computeCostResult(input);
  if (faults) {
    console.error(faults.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`${section}\n${costResultBlock(input, result)}`);
}
