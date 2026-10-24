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
| 0 | Isolated baseline, reusable payload/golden contracts, resource accounting | paired smoke verified; some block IO unavailable |
| 1 | Session expiry, timeout ownership, queue/timer lifecycle and scan reentry | local + CI verify + paired functional smoke passed |
| 2 | Configuration snapshots, registration fast path, dirty aggregate flush | local + CI + paired smoke passed |
| 3 | Atomic bounded Redis append, narrow summary and expiry read models | real Redis + CI + paired smoke passed |
| 4 | Overview projection, bounded query concurrency and shared historical reads | real SQL + CI passed; image browser gate not yet passed |
| 5 | Static Web, fixed-upstream proxy, security/PWA/deep-link parity | local contracts passed; actual image CI pending |
| 6 | Incremental aggregation, versioned hardware storage and bounded maintenance | off-path snapshot/metadata prototypes only; no production replacement |
| 7 | Failure/recovery, rollback, resource comparisons and long-running soak | isolated restart gates added; long-running soak pending |
| Go decision | Fixed-input prototype and whole-stack benefit gate | Node/Go and separate SQLite prototypes; measured decision pending |
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

### CI evidence and open gates

- [CI 40089367490](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40089367490)
  passed all jobs, including `verify` (1m45s, build/typecheck/server tests), Web
  visual/PWA/loading (5m39s) and Electron visual (55s), for `5b439435`.
- [Hub baseline 40089367503](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40089367503)
  built all four application images but **failed** before either workload:
  `compose_command_failed`; both scoped cleanups succeeded. Runtime performance
  remains unmeasured. The follow-up retains bounded, credential-redacted startup
  diagnostics rather than retrying the same opaque failure.
- Follow-up [40090060653](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40090060653)
  identified the exact startup blocker: Docker does not publish the Web port
  when it is connected only to an internal bridge. The dedicated Compose now
  adds a Web-only ingress bridge (outbound masquerading disabled); API, Redis
  and MySQL remain internal-only and unpublished. This is a benchmark network
  correction, not a production Compose change. Measurements still pending.
- [Hub baseline 40090468775](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40090468775)
  **passed** (`baseline`, 5m45s) for `f363632f`. Both sides completed all 240
  measured ingests and 200 queries, no failed/skipped requests, and verified
  the known old historical bucket, 216 minute rows and 12 hour rows. Scoped
  cleanup succeeded on both sides. CPU/memory were available for all services;
  candidate Web/API block counters were unavailable, so the report correctly
  labels overall resource evidence partial. No IO savings are inferred there.
- Same revision's [CI verify job](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40090468773)
  passed (1m54s), including complete workspace build and required server/static
  checks. Other platform jobs were passing; Web smoke was still running when
  this evidence was recorded. Stage 1 query p95 was 55.16ms vs base 53.68ms;
  this small single-run difference is descriptive, not a regression conclusion.
- PR repository is public: these GitHub-hosted runs consume no private monthly
  Actions minute allowance. Builds remain in CI; local scratch grew to 1.8 GiB
  including baseline/candidate dependencies, with 102 GiB still available.

### Stage 1 correctness work

- Added chunked long-session timers and joined maintenance operations.
- Queue ownership now lasts until the underlying database operation settles;
  no uncancelled ten-second timeout can release it early. Settled keys are
  removed; admission is bounded to 32 per key / 1,024 total per queue. Rejected
  ingests receive retryable HTTP 503, not a success acknowledgement.
- Flush/offline work uses at most eight workers; MySQL waiting is bounded at
  128. Concurrent flush callers join the actual operation.
- Registration, ingest and administrative removal share the device ingest
  ordering boundary. Already admitted work finishes before removal; later
  authoritative ingest may reopen the device as before.
- Local candidate server typecheck and **120 tests passed**, including removal,
  overload-before-side-effects and final-flush device-set race regressions.
  Whole-workspace lint/typecheck passed with existing warnings; new baseline
  harness tests are **30/30**. The production-path changes subsequently passed
  CI verify and the paired functional smoke linked above.
- Queue admission precedes registration, realtime writes and credential
  revocation. Shutdown drains HTTP, waits existing scans/retention, and takes a
  fresh aggregate snapshot after any old periodic flush. No operation is
  reported cancelled while it still owns the database/queue slot.

### Stage 2 verification

- Configuration/note reads use a single lazily loaded committed snapshot and
  clone only their selected value. Successful copy-on-write persistence alone
  publishes updates; failed loads/writes/mutations do not poison the queue or
  publish a draft. This is a single-process/single-store ownership model, not
  a coherent cache for external file writers or multiple Hub processes.
- Authoritative unchanged registration skips SQL (MySQL) or disk writes
  (local). MySQL's successful-record cache is capped at 4,096 FIFO entries;
  delete/reorder invalidate within the same device queue. Non-ingest calls
  retain their original registry touch behavior. `updatedAt` no longer acts
  as a heartbeat for steady ingest; realtime `lastSeenAt` is unchanged.
- Dirty accumulator tracking submits only changed minute/hour buckets, clears
  only after required writes succeed, and retries a failed partner without
  rewriting the successful partner. Rollover skips already-flushed old buckets.
  This does not evict raw accumulator samples prematurely: delayed valid
  reports still need the existing bucket's observations for an exact average.
- Accepted latest timestamps are published after required ingest stages, so a
  storage error cannot cause a retry to be silently discarded as already done.
- Candidate server typecheck and **156/156 tests passed** in local scratch,
  including 100 unchanged registrations with zero registry SQL/disk writes,
  snapshot read-count/rollback tests and storage-failure retry tests.
- [Paired smoke 40091041709](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40091041709)
  passed (`baseline`, 5m35s) for `45c6432f`; [CI 40091041667](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40091041667)
  passed all jobs. [Real SQL](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40091041650)
  and [macOS](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40091041659)
  also passed. Single paired ingest CPU: API 1.108s vs 1.465s base (-24.37%),
  MySQL 0.544s vs 0.941s (-42.16%). API mean memory 69.7MB vs 74.1MB (-6%).
  These are descriptive short-run observations, not a stable percentage promise;
  some block IO remains unavailable and full-scale/soak gates are still open.

### Stage 3 verification

- Ordered raw Redis lists use tail-only decode/append or replacement after an
  independent strict-order certification. Preexisting unordered/duplicate or
  corrupt lists retain first-match legacy behavior. JSON bytes are not encoded
  through Lua, preserving empty arrays. Certification assumes one Hub writer;
  old/new mixed writers are not supported with the marker retained.
- Atomic state/summary/online-expiry updates support narrow inventory reads,
  bounded expiry pages and PING-only readiness, instead of full hardware HVALS.
  Startup backfill uses HSCAN plus compare-before-write and a durable completion
  marker; interrupted migrations retry. A heartbeat accepted between expiry
  selection and state lookup is rechecked before offline CAS.
- The unused Redis 15m aggregate write is retired; public 15m queries continue
  using minute history plus the current accumulator, with unchanged retention.
- Candidate typecheck passed; server suite: **180 passed / 15 real-Redis skipped**.
  Dedicated Redis contract invocation: **7 passed / 26 skipped**, because no
  Redis runs locally. PR query-regression now supplies an isolated Redis service
  and loopback database `/15`; fixtures only delete their own known keys.
- [Real Redis/SQL 40091932662](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40091932662)
  passed **33/33 Redis contracts, none skipped**. [CI 40091932657](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40091932657)
  passed all jobs, and [paired stack 40091932655](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40091932655)
  passed (`baseline`, 4m55s), both scoped cleanups successful. Total stack CPU
  during measured ingestion was 3.074s vs 3.559s base (-13.64%), aligned sampled
  memory peak 678,600,704 vs 693,755,904 bytes. Queries used 3.973s vs 4.078s
  (-2.59%). These remain single short-run observations, with partial block IO.

### Stage 4 verification

- MySQL overview reads five numeric series and selected JSON paths, not entire
  hardware documents. Full detail APIs are unchanged. Legacy local adapters use
  a compatible fallback; current minute/hour overlays retain their old rules.
- Golden comparisons cover valid zero, missing/quality gaps, legacy memory and
  disk fallback, empty versus all-zero disks, aliases/windows and current buckets.
  MySQL still accesses JSON internally: this is a transfer/allocation reduction,
  not a covering-index claim.
- Overview uses at most four workers and the narrow realtime inventory. Distinct
  telemetry queries share a four-worker, 128-admission pool; concurrent identical
  reads coalesce, but no settled TTL cache hides later writes.
- Candidate server typecheck and **194 tests passed / 15 real-Redis skipped**;
  accounting/browser-target/upgrade safety tests **33/33 passed**. An additional
  overview worker-order regression passed after the full-suite run. Real SQL projection
  equivalence and the newly added candidate-image browser/PWA tests still need
  CI. Browser work runs after resource measurements and does not bias them.
- [Real SQL/Redis 40092769516](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40092769516)
  passed **2 SQL + 33 Redis tests, none skipped**. [CI 40092769437](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40092769437)
  passed all eight jobs, including Electron/Web visual checks. Candidate image
  run [40092769538](https://github.com/IGNGserver/guanlan-monitor/actions/runs/40092769538)
  completed its ingest/query workload and cleanup but failed the new browser
  gate, so it is **not** a successful acceptance or performance comparison.
  Review corrected the test's native-WebSocket assumption: unauthenticated
  agent upgrades return HTTP 401 before upgrading, not a WebSocket 4001 close.

### Stages 5–7 and independent research (CI pending)

- Delivery Web exports the public shell and runs nginx without Node/Next. The
  development/old visual-test standalone path is unchanged. Proxy targets are
  fixed to `server:4000`; TLS origin is asserted only by explicitly allowlisted
  TCP peers (`DSC_TRUSTED_TLS_PROXY_CIDRS`), otherwise forwarding headers are
  ignored. Existing TLS deployments must configure this new fail-closed setting
  before installing a future image; this task does not deploy one.
- Actual-image CI gates cover static headers, cache/MIME/404 contracts, native
  agent HTTP-401/authenticated-101 upgrades, Socket.IO, Chromium/WebKit deep links
  and offline shell. Post-measurement tests enable the real HTTPS guard to reject
  an untrusted protocol spoof and accept a loopback trusted TLS ingress. Recovery
  gates restart API/Redis/MySQL and check accepted latest/persisted historical
  buckets; API is SIGKILLed. This is not a power-loss, unflushed-hour recovery or
  24–72h soak claim.
- Stage 6 remains **off production**: bounded memo snapshots preserve the entire
  average oracle, including floating-point reduction order and observation
  winners. Metadata split/hydrate is reversible, versioned and bounded, but has
  no durable dictionary/transactional reference GC. A full incremental sum or
  schema migration is not silently substituted based on unit tests.
- `scripts/hub-prototypes/` independently measures equal-input Node/Go kernels,
  SQLite WAL commit/kill/replay/backup recovery, and aggregation/metadata research
  in CI. None implements the complete Hub or is linked to production adapters.
  No whole-stack Go/storage benefit has been established; retain Node/MySQL
  unless the gate is actually met. Benchmarks reject non-CI/network filesystems.
- Local APFS candidate checks: workspace lint/typecheck and all three boundaries,
  adapter/UI-helper/workspace/renderer-security/hub-connection/window-material
  tests passed; **195 server tests passed / 15 real-Redis skipped**, **13/13**
  aggregation prototype, **10/10** static export, **50/50** PWA and **34/34**
  accounting/HTTP/browser-target tests passed. Existing lint warnings remain.
  Node/Go prototype unit tests **2 + 2 passed**, Python durability/runner tests
  **10 passed**. Builds and benchmarks remain CI-only; Electron visual is CI.
