import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { openBrowser } from '../lib/browser.js';
import { clientHeaders } from '../lib/client.js';
import { loadConfig, saveConfig } from '../lib/config.js';
import { emit } from '../lib/telemetry.js';
import { mergeConfig, parseHostFlags } from '../lib/host-flags.js';
import { createPkcePair, randomState } from '../lib/pkce.js';
import { confirmBaseUrl, DEFAULT_BASE_URL } from '../lib/prompt.js';
import { deriveHosts } from '../lib/urls.js';

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>CloudExMachina</title></head>
<body style="font-family:system-ui;text-align:center;padding-top:80px;color:#2f3238">
<h2>You're connected to CloudExMachina.</h2><p>Return to your terminal — you can close this tab.</p></body></html>`;

// Wait for the browser to hit the loopback with ?code (or ?error), then shut the server down.
function waitForCallback(server, expectedState) {
  return new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      // Connection: close + closeAllConnections so the browser's keep-alive socket dies and the loop
      // can drain — otherwise `cxm login` prints "Signed in" but the process never exits.
      res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' }).end(SUCCESS_HTML);
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      server.close();
      server.closeAllConnections?.();
      if (error) return reject(new Error(`Authorization was denied (${error}).`));
      if (state !== expectedState) return reject(new Error('State mismatch — aborting for safety.'));
      if (!code) return reject(new Error('No authorization code returned.'));
      resolve(code);
    });
  });
}

export async function login(argv) {
  const parsed = parseHostFlags(argv);
  const config = mergeConfig(loadConfig() ?? {}, parsed);
  // Confirm the URL interactively on setup; skip when --url was given or when non-interactive.
  if (!parsed.url && process.stdin.isTTY) {
    config.baseUrl = await confirmBaseUrl(config.baseUrl);
  }
  config.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const hosts = deriveHosts(config);
  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = randomState();

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authorizeUrl =
    `${hosts.website}/oauth/authorize?` +
    new URLSearchParams({
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    }).toString();

  console.log(`Opening your browser to sign in to CloudExMachina…\nIf it does not open, visit:\n  ${authorizeUrl}\n`);
  openBrowser(authorizeUrl);

  const code = await waitForCallback(server, state);

  const res = await fetch(`${hosts.tenantApi}/oauth/token`, {
    method: 'POST',
    headers: { ...clientHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}). ${detail}`);
  }
  const token = await res.json();

  // Fresh session id per login — groups the commands that follow until the next sign-in.
  saveConfig({
    ...config,
    organizationId: token.organization_id,
    organizations: token.organizations,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (token.expires_in ?? 0),
    sessionId: randomUUID(),
  });

  await emit('plugin.login', { organization_id: token.organization_id });
  console.log(`Signed in. Active organization: ${token.organization_id}`);
}
