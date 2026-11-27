// Credential forms we replace before text leaves the machine. A value with no name and no known prefix still passes.
// A JSON-encoded tool input escapes its quotes and newlines, hence the optional backslashes and the `\\[nrt]` lookbehind.
// A first capture group is kept: the name, the separator or the URL user stay, only the value goes.
const SECRETS = [
  /-----BEGIN [A-Z ]*-----[\s\S]*?(?:-----END [A-Z ]*-----|$)/g,
  /(?<=^|[^A-Za-z0-9]|\\[nrt])(?:(?:AKIA|ASIA)[0-9A-Z]{16}\b|(?:phc_|phx_|whsec_|xapp-|xoxe-|ya29\.|GOCSPX-|gh[pousr]_|github_pat_|xox[abposr]-|sk-|[sr]k_(?:live|test)_|AIza)[\w-]{16,}|eyJ[\w-]+\.[\w-]+\.[\w-]*)/g,
  /(authorization\\*["']?\s*[:=]\s*\\*["']?(?:bearer|basic)\s+)[^\s"'\\,}]+/gi,
  /(\b[a-z][\w+.-]*:\/\/[^\s:@/]*:)[^\s@/]+(?=@)/gi,
  /((?:secret|token|password|passwd|key)\\*["']?\s*[:=]\s*\\*["']?)(?:[^\s"'\\,}]|\\\\|\\(?![nrt"'])){8,}/gi,
  /(\B--?[\w-]*(?:secret|token|password|passwd|key)\s+\\*["']?)[^\s"'\\,}]{8,}/gi,
];

export const redactSecrets = (text, mask = '[REDACTED]') =>
  SECRETS.reduce((s, re) => s.replace(re, (all, kept) => (typeof kept === 'string' ? kept + mask : mask)), text);
