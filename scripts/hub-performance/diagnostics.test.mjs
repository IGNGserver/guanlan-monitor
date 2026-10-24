import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeDiagnostic } from './diagnostics.mjs';

test('startup failures stay actionable while literal synthetic secrets and URLs are removed', () => {
  const error = sanitizeDiagnostic('container mysql unhealthy\npassword=synthetic-only\nmysql://user:password@host/db', ['synthetic-only']);
  assert.match(error, /mysql unhealthy/);
  assert.doesNotMatch(error, /synthetic-only|password@host/);
  assert.match(error, /\[redacted-url\]/);
  assert.equal(sanitizeDiagnostic(null), '');
});

test('redaction precedes bounded truncation and strips ANSI colors', () => {
  const secret = 'x'.repeat(4200);
  const error = sanitizeDiagnostic(`prefix\u001b[31m ${secret}\u001b[0m suffix`, [secret]);
  assert.equal(error, 'prefix [redacted] suffix');
  assert.equal(sanitizeDiagnostic('x'.repeat(5000)).length, 4096);
});
