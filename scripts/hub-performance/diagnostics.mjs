/** Keep actionable synthetic CI startup errors without retaining credentials. */
export function sanitizeDiagnostic(text, secrets = []) {
  let value = typeof text === 'string' ? text : '';
  // Redact before truncating: a clipped secret must not survive at the boundary.
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length) value = value.split(secret).join('[redacted]');
  }
  value = value.replace(/\b(?:mysql|rediss?|https?):\/\/[^\s'"<>]+/gi, '[redacted-url]');
  return value.replace(/\x1b\[[0-9;]*m/g, '').slice(-4096);
}
