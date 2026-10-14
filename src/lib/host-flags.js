// Shared parsing of endpoint/CA overrides for init and login. Persisted in the config so
// `cxm` works in any shell without CXM_*_URL env vars (needed for local/hybrid + edge deploys).

const HOST_FLAGS = {
  '--website-url': 'website',
  '--tenant-api-url': 'tenantApi',
  '--org-api-url': 'orgApi',
  '--cube-url': 'cube',
};

export function parseHostFlags(argv) {
  const hosts = {};
  let url;
  let caCert;
  let agent;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') url = argv[++i];
    else if (a === '--ca-cert') caCert = argv[++i];
    else if (a === '--agent') agent = argv[++i];
    else if (HOST_FLAGS[a]) hosts[HOST_FLAGS[a]] = argv[++i];
  }
  return { url, caCert, agent, hosts };
}

// Fold parsed flags onto an existing config, preserving anything not overridden.
export function mergeConfig(existing, { url, caCert, hosts }) {
  const merged = { ...existing };
  if (url) merged.baseUrl = url;
  if (caCert) merged.caCertPath = caCert;
  if (Object.keys(hosts).length) merged.hosts = { ...(existing.hosts ?? {}), ...hosts };
  return merged;
}
