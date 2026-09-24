# Unified Desktop: security model

## Trust boundaries

| Boundary | Threat | Control |
| --- | --- | --- |
| Hub ↔ main | key theft, downgrade, unsafe transport | HTTPS for non-private endpoints, global key only, strict update/version handling, safe error codes |
| Main ↔ local backend | local process injection/control | loopback-only listener, per-run random port/token, main-only access, parent PID/job supervision |
| Main ↔ renderer | XSS/renderer compromise reaching OS | `contextIsolation: true`, `nodeIntegration: false`, sandbox where compatible, typed allowlisted preload bridge |
| Config/cache/log files | secret leakage or tampering | user-data permissions, atomic writes, additive migration, redaction, no key in diagnostic export |
| Packaged binaries | path traversal/incorrect executable | resolve under packaged resources, verify expected file names and platform, no shell string concatenation |

## Key handling

The global access key is retained as the only credential. The renderer can submit a new key through a one-purpose save operation and can receive only `accessKeyConfigured`; the local Agent state similarly exposes only `secretConfigured`. Main does not log credential values or arbitrary Hub response bodies, and no real key is committed.

## Remote write prohibition

The renderer does not receive a generic Hub client or arbitrary URL fetch. The typed main service exposes remote reads, one narrow fan-note metadata write, and local config writes as separate capabilities. `cloudPush` derives the device id from the local config and refuses a caller-supplied remote id. Remote device details have no generic configuration editor.

## Content and navigation

The renderer loads packaged local assets only. External links open through an explicit main-process handler after URL allowlisting. No Hub page is embedded in a WebView. CSP disallows inline/eval script in production renderer output.

## Diagnostics

Diagnostics include stable error categories, process state, cache state, and paths, but not authorization headers, key values, cookies, or arbitrary response bodies. Support bundles are generated from a redacted snapshot with an explicit size limit.
