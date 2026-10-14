// Resolve every backend host. Priority: config.hosts overrides (persisted by init/login) →
// CXM_*_URL env vars → hosts derived from the app base URL.
//   app.cloudexmachina.io -> api.app.…, cubejs.app.…
// The tenant API has no subdomain of its own — it is path-routed under the org API host
// (api.<prefix>.…/v1/tenant), the same host the web app's consent page calls.
// A dev setup can decouple the hosts (and use cube. not cubejs.), so it stores explicit
// overrides instead of deriving.

export function deriveHosts(config) {
  const u = new URL(config.baseUrl);
  const [prefix, ...rest] = u.hostname.split('.');
  const domain = rest.join('.');
  if (!prefix || !domain) {
    throw new Error(`Cannot derive hosts from base URL "${config.baseUrl}" — expected e.g. https://app.cloudexmachina.io`);
  }
  const p = u.protocol;
  const o = config.hosts ?? {};
  const env = process.env;
  return {
    website: o.website || env.CXM_WEBSITE_URL || `${p}//${u.hostname}`,
    tenantApi: o.tenantApi || env.CXM_TENANT_API_URL || `${p}//api.${prefix}.${domain}/v1/tenant`,
    orgApi: o.orgApi || env.CXM_ORG_API_URL || `${p}//api.${prefix}.${domain}/v1`,
    cube: o.cube || env.CXM_CUBE_URL || `${p}//cubejs.${prefix}.${domain}/cubejs-api/v1`,
  };
}
