import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveHosts } from '../src/lib/urls.js';

// The derivation tests must ignore any CXM_*_URL overrides present in the ambient shell.
for (const key of ['CXM_WEBSITE_URL', 'CXM_TENANT_API_URL', 'CXM_ORG_API_URL', 'CXM_CUBE_URL']) {
  delete process.env[key];
}

test('derives prod hosts from the app base URL', () => {
  const h = deriveHosts({ baseUrl: 'https://app.cloudexmachina.io' });
  assert.equal(h.website, 'https://app.cloudexmachina.io');
  assert.equal(h.tenantApi, 'https://api.app.cloudexmachina.io/v1/tenant');
  assert.equal(h.orgApi, 'https://api.app.cloudexmachina.io/v1');
  assert.equal(h.cube, 'https://cubejs.app.cloudexmachina.io/cubejs-api/v1');
});

test('derives hosts from a non-prod subdomain prefix', () => {
  const h = deriveHosts({ baseUrl: 'https://staging.cloudexmachina.io' });
  assert.equal(h.tenantApi, 'https://api.staging.cloudexmachina.io/v1/tenant');
  assert.equal(h.orgApi, 'https://api.staging.cloudexmachina.io/v1');
  assert.equal(h.cube, 'https://cubejs.staging.cloudexmachina.io/cubejs-api/v1');
});

test('rejects a base URL with no subdomain prefix', () => {
  assert.throws(() => deriveHosts({ baseUrl: 'https://cloudexmachina' }));
});

test('config.hosts overrides win over derivation', () => {
  const h = deriveHosts({
    baseUrl: 'https://app.cxm.dev',
    hosts: { tenantApi: 'https://tenant-api.custom.cxm.dev/v1/tenant', cube: 'https://cube.custom.cxm.dev/cubejs-api/v1' },
  });
  assert.equal(h.tenantApi, 'https://tenant-api.custom.cxm.dev/v1/tenant');
  assert.equal(h.cube, 'https://cube.custom.cxm.dev/cubejs-api/v1');
  assert.equal(h.website, 'https://app.cxm.dev'); // not overridden → derived
});

test('env vars override individual derived hosts', () => {
  process.env.CXM_TENANT_API_URL = 'https://tenant-api.custom.cxm.dev/v1/tenant';
  process.env.CXM_CUBE_URL = 'https://cube.custom.cxm.dev/cubejs-api/v1';
  try {
    const h = deriveHosts({ baseUrl: 'https://app.cxm.dev' });
    assert.equal(h.website, 'https://app.cxm.dev'); // derived (no override)
    assert.equal(h.tenantApi, 'https://tenant-api.custom.cxm.dev/v1/tenant'); // overridden
    assert.equal(h.cube, 'https://cube.custom.cxm.dev/cubejs-api/v1'); // overridden
  } finally {
    delete process.env.CXM_TENANT_API_URL;
    delete process.env.CXM_CUBE_URL;
  }
});
