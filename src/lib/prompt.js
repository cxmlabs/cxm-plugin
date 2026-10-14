import { createInterface } from 'node:readline/promises';

export const DEFAULT_BASE_URL = 'https://app.cloudexmachina.io';

// Confirm the CXM app URL interactively (Enter accepts the suggestion). Callers should skip
// this when --url was passed or when stdin is not a TTY (agents / pipes).
export async function confirmBaseUrl(current) {
  const suggested = current || DEFAULT_BASE_URL;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`CloudExMachina app URL [${suggested}]: `)).trim();
  rl.close();
  return answer || suggested;
}
