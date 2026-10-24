# Hub optimization rollback and acceptance boundaries

This is a runbook, **not an instruction to change a running deployment**. This
task publishes/deploys nothing. Follow the repository's controlled fixed-version
deployment workflow only when the operator requests a deployment or rollback.

## Before any future installation

- Record both currently installed image digests, application version, Compose
  configuration, backups and the actual TCP peer seen by the Web container.
- The static image fixes its API target to `server:4000`. Custom runtime Web
  `SERVER_API_URL`/`NEXT_PUBLIC_SERVER_URL` values are no longer supported.
- A TLS terminator must overwrite `X-Forwarded-Proto`. Set
  `DSC_TRUSTED_TLS_PROXY_CIDRS` to only its isolated source IP/CIDRs. Empty means
  fail closed. Never whitelist a shared client/NAT subnet. Verify HTTPS-required
  agent enrollment, ingestion, live upgrades and session cookies at that ingress.
- One Hub writer owns each store. Do not roll by temporarily running old and new
  writers against the same data. Snapshot reuse and file snapshots are not
  distributed caches.

## Backward rollback

1. Stop admission and drain the optimized Hub through the controlled deployment
   channel. Stop its writer before starting the old pinned image pair.
2. Restore the recorded old Web/API image pair. The authoritative Redis device
   JSON, raw lists, MySQL historical rows, local config and credentials retain
   their previous formats; no prototype dictionary or SQLite database is in the
   production path. No destructive schema rollback is required.
3. Verify the public health endpoint, authenticated inventory/history, a real
   agent report, both realtime transports and HTTPS-required policy. Record the
   resulting version/digests and deployment checks. A healthy container alone is
   not a completed rollback.

## Re-upgrade after an old writer has run

The old writer does not maintain the new summary/expiry projection, nor invalidate
strict-order certification. **Do not simply reuse completion markers.**

1. Stop every Hub writer. Back up the authoritative stores first.
2. Under explicit maintenance authorization, remove only disposable derived keys:
   `dsc:device-summary:v1`, `dsc:device-last-seen:v1`,
   `dsc:realtime-model:v1` and the `dsc:series-order-v2:*` certifications.
   On a real instance, enumerate the certification namespace in bounded SCAN
   pages with exact prefix/type checks; never use FLUSHDB, KEYS, or delete the
   broader `dsc:*` namespace. This runbook does not execute that maintenance.
3. Start the optimized writer alone. The missing completion marker triggers
   HSCAN/CAS summary backfill. Each raw list re-certifies strict timestamp order
   on use; legacy duplicates/unordered lists keep first-match behavior.
4. Recheck inventory membership/order/notes, online/offline transitions, accepted
   latest values, old historical buckets and live traffic. Re-enable clients only
   when those checks pass.

## What isolated CI does and does not prove

`scripts/hub-performance/run.mjs` uses only CI-created project-scoped volumes,
synthetic credentials, random loopback ports and a private four-container stack.
After resource measurement, its candidate checks exercise static HTTP contracts,
Chromium/WebKit offline/deep-link behavior, two realtime transports, trusted-TLS
boundaries, API SIGKILL and Redis/MySQL restart recovery. The rollback/re-upgrade
gate switches its already built base/head images on those same isolated volumes,
checks a report accepted by the old writer, clears only its known fixture-derived
keys with writers stopped, and validates re-upgrade backfill.

These gates are **pending until their actual CI run passes**. They do not prove
power-loss durability, every unflushed accumulator's reconstruction, full raw
series continuity, production topology, year-history scale, or a 24–72 hour soak.
Keep PR #95 draft while required acceptance evidence remains missing. A short
smoke and a microbenchmark must not be relabeled as those missing results.
