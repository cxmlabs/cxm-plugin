import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { clientHeaders } from '../src/lib/client.js';

test('requests name the plugin and its package version', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(clientHeaders(), { 'User-Agent': `cxm-plugin/${version}`, 'X-CXM-Client': `plugin/${version}` });
});
