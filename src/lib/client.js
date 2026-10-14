// Who is calling: every request to the CXM APIs names the plugin and its version, so the platform can
// attribute what was done through the plugin (for example, an opportunity moved to done).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedVersion;
export function pluginVersion() {
  if (cachedVersion) return cachedVersion;
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  try {
    cachedVersion = JSON.parse(readFileSync(pkg, 'utf8')).version;
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

export const clientHeaders = () => ({ 'User-Agent': `cxm-plugin/${pluginVersion()}`, 'X-CXM-Client': `plugin/${pluginVersion()}` });
