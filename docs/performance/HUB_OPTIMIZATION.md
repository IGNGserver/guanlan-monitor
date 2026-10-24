# Hub mechanism optimization

## Scope and invariants

Baseline: `7644a3ded587138e89afb86f813bdce00cc47750` (`3.0.166`).
This work changes the Hub, not the installed production deployment. No version
bump, release, production workflow or production data migration is implied.

Performance means the **whole Hub stack**: Web, API, Redis and MySQL. A smaller
image is not a runtime-memory measurement, and moving work to another process
is not a resource saving. Keep configured refresh rates, 90-day minute / 370-day
hour history retention, missing-value and counter semantics, legacy clients,
session security, PWA offline/deep links and durable acceptance behavior.

## Ordered delivery ledger

`pending` means not delivered; a test fixture or planned workflow is not an
acceptance result. Each stage must record actual commands and evidence before
being marked verified.

| Stage | Deliverable | State |
| --- | --- | --- |
| 0 | Isolated baseline, reusable payload/golden contracts, resource accounting | in progress |
| 1 | Session expiry, timeout ownership, queue/timer lifecycle and scan reentry | pending |
| 2 | Configuration snapshots, registration fast path, dirty aggregate flush | pending |
| 3 | Atomic bounded Redis append, narrow summary and expiry read models | pending |
| 4 | Overview projection, bounded query concurrency and shared historical reads | pending |
| 5 | Static Web, fixed-upstream proxy, security/PWA/deep-link parity | pending |
| 6 | Incremental aggregation, versioned hardware storage and bounded maintenance | pending |
| 7 | Failure/recovery, rollback, resource comparisons and long-running soak | pending |
| Go decision | Fixed-input prototype and whole-stack benefit gate | pending |
| Storage decision | Embedded transactional storage prototype and recovery gate | pending |

## Acceptance matrix

Measure no-device idle, normal reporting without viewers, list/history viewers,
and on-demand live viewers separately. Include small/large hardware payloads,
10/100/500 devices, normal 30-second and stress 1-second reporting, same-device
and different-device viewers, replay, slow consumers, 24-hour/year queries,
retention and restart migration. A short CI smoke is not the full matrix or a
24–72-hour soak.

Record elapsed time, accepted/failed samples, response latency distributions,
CPU nanoseconds, resident/cgroup memory, block read/write bytes, Redis script
work, SQL/pool waiting, cache bytes and queue sizes. Missing resource data must
be reported as incomplete rather than zero. Do not use authenticated production
traffic or log payloads, cookies or credentials.

Structural gates:

- Normal raw-series append does not decode the complete historical list.
- An unchanged aggregate causes no repeated history submission.
- Steady ingest does not reread the configuration file.
- Overview does not construct unrelated hardware curves.
- Offline detection does not decode all hardware details.
- Queues, caches and maintenance concurrency have explicit bounds.
- Settled heap/cache usage plateaus for a fixed device population.
- Completed migrations are not rescanned on every restart.

Correctness gates include duplicate/stale replay, timestamp replacement, bucket
boundaries, partial-vs-complete aggregates, real gaps, valid zero RPM, sensor
observation deduplication, interface resets, hardware membership changes,
deletion followed by authoritative reappearance, timeout/late completion,
restart and disk/database failures. Never acknowledge an unaccepted sample just
to improve latency.

## Architecture decision gates

Static Web removes a Node/V8 runtime, not necessarily a process: a mature proxy
can replace Next while Fastify and both databases remain unchanged. Preserve
both Socket.IO and native Agent WebSocket upgrades, fixed upstreams, forwarded
header trust, signed HttpOnly cookies, security/cache headers and atomic PWA
updates. The dynamic `/devices/<id>` route needs a compatible static fallback.

Go and embedded storage are **separate decisions**. First remove redundant
work in the current implementation. Compare deterministic fixtures and total
resources before moving a production path. A Go sidecar can increase memory;
reject it if there is no measured net benefit. Ordinary WebSocket is not a
drop-in Socket.IO replacement; the Agent live protocol is revision 4.

An embedded database must pass concurrency, WAL/checkpoint, crash recovery,
backup/restore, migration and rollback tests on a supported local filesystem.
Do not put its database on a client NFS/SMB mount, disable Redis AOF without an
equivalent durable raw-series path, or reuse the whole-file JSON fallback as a
production storage engine. Do not switch language and storage in one cutover.

## Execution evidence

### Initial local baseline

- Read-only source snapshot: local APFS scratch, no `.git`, no NAS dependencies.
- Scratch root: `$HOME/.build/guanlan-monitor/hub-performance-phases`.
- Initial `df -h`: 103 GiB available; no Docker executable on this host.
- `pnpm install --frozen-lockfile --filter @dsc/server... --filter @dsc/web...`:
  passed; Electron download disabled, no delivery build produced.
- `pnpm --filter @dsc/server typecheck`: passed.
- `pnpm --filter @dsc/server test` with `NODE_ENV=test` and synthetic test-only
  session/access values: **82 passed**. The first attempt without those required
  environment values failed during configuration, not a code regression.
- `pnpm verify:version` with the original repository's read-only `GIT_DIR`:
  passed (`3.0.166`). The archive itself intentionally has no Git metadata.
- Real database/container measurements, full-stack builds and full validation:
  **not yet run**. Existing main CI is green, but is not evidence for these changes.

### Stage 0 implementation (awaiting isolated CI)

- Added 16 deterministic ingestion/aggregation/history compatibility tests;
  the server suite now passes **98 tests** in local scratch.
- Added 17 accounting, safe-target, fixture and incomplete-report tests;
  `pnpm test:hub-performance` passes in local scratch.
- `pnpm lint`, `pnpm typecheck`, all three required UI boundary checks,
  adapter/helpers/workspace/renderer-security/hub-connection/window-material
  tests passed on the baseline snapshot. Existing lint warnings remain; no
  frontend implementation changed in this stage. Candidate server typecheck
  and version consistency passed after adding the fixtures.
- The new PR-only `Hub resource baseline` builds base/head images before
  measurement, then sequentially runs two fresh four-container stacks with
  the same head-side harness. The only published endpoint is a random loopback
  port. Private internal networks, project-scoped volumes and runtime-generated
  synthetic credentials are unrelated to production. Cleanup is project-scoped.
- The 45-second measured smoke contains idle-with-reporting-devices, bounded
  ingest and authenticated query phases; setup seeds real minute/hour buckets
  through HTTP. It does **not** benchmark real Agent live RPC, a full year of
  stored data, the full scale matrix, or long-running behavior.
- Per-container CPU, sampled memory and block-byte counters are reported with
  explicit unavailable reasons. Missing required CPU/memory evidence fails;
  unavailable block counters produce partial evidence, not zero IO. One paired
  run is descriptive and has no uncalibrated performance regression threshold.
