# Hub research prototypes — not production replacements

**Status: research. Production language/storage replacement is not authorized.**
These are two independent experiments, not a combined alternative Hub pipeline.
No external packages, credentials, network connections, production adapters or
production configuration are used. Failure to show net benefit means keeping the
existing Node/MySQL path. No performance numbers have been measured or claimed here.

## Input and deliberately limited contract

`generate.mjs` strips **type-only** TypeScript from the repository's
`apps/server/src/hub-contract-fixtures.ts` using Node's standard library, then calls
`createHubContractPayload`. It does not maintain a substitute telemetry fixture.
Node >=22.13 (24 recommended), Go >=1.24 and Python >=3.10 on Linux/macOS are needed.
The export adds deterministic unknown fields, safe-number boundaries, decimals,
four device identities, ordered observations and a changed out-of-order replay.
`COUNT` is the number of unique points; the exported array has `COUNT+1` elements.

Only well-formed Unicode, canonical UTC millisecond timestamps, finite JSON
numbers in `[-(2^53-1), 2^53-1]`, and ordinary fixture telemetry are in this test
domain. This is **not** a claim of arbitrary precision number preservation. Both
language implementations retain all unknown fields, use binary64 arithmetic and
reject out-of-domain numbers. Encoding differences (key order, HTML escapes,
decimal exponent spelling, negative zero) are compared semantically, not as raw
byte equality. The canonical SHA256 hashes a type-tagged tree with UTF-8 byte
lengths and IEEE754 number bits (`-0` normalized); this is not RFC 8785.

## 1. Go versus Node CPU kernel

`language.mjs` and `go/` implement the same operation on the **same raw JSON bytes**:

1. Parse and validate the entire batch, retaining unknown nested fields.
2. Last-write-wins deduplication by `(deviceId, timestamp)`.
3. Sort by UTF-8 device identity and timestamp; arithmetic mean per device of
   CPU usage, memory usage %, disk usage %, network RX/s and network TX/s.
4. Re-encode surviving full telemetry plus the five-metric summary as UTF-8 JSON bytes.

This is not a Fibonacci surrogate or a production Hub implementation. In
particular its replacement-on-equal-timestamp contract is a kernel experiment,
not the production service's latest-timestamp rejection contract. Quality gaps,
observation clocks, full schema validation and all production aggregation rules
are not reproduced. Both sides do exactly the same reduced work.

Single-run correctness (iterations=0, not a benchmark):

```sh
node scripts/hub-prototypes/generate.mjs "$RUNNER_TEMP/batch.json" 256
node scripts/hub-prototypes/language.mjs "$RUNNER_TEMP/batch.json"
# CI: build go/ in RUNNER_TEMP, then: ingest "$RUNNER_TEMP/batch.json"
```

Both emit `{result, canonicalSha256}`. `go test` runs the real Node generator and
Node baseline, then checks complete decoded output and canonical digest equality;
Node tests independently pin known summary values and unknown-field retention.

CI benchmark command (main Agent wires the workflow; do not run locally):

```sh
python3 scripts/hub-prototypes/run_language.py \
  --out "$RUNNER_TEMP/language-report.json" --count 256 --iterations 100 --rounds 5
```

The runner requires `CI=true`, Linux and a verified local `RUNNER_TEMP`, builds
only in that directory, alternates Node/Go order across fresh-process rounds,
and compares untimed complete results before measuring. Each process performs
three identical warmups. Per-iteration latency covers **UTF-8 decode/parse through encode**;
disk reads, process startup, Go compilation, final digesting and comparison are
outside the timed kernel. User/system CPU deltas cover the measured loop; peak
RSS is the process lifetime high-water mark, including runtime and warmup, not
an allocation delta. Reported output bytes may differ due to JSON spelling.
Median/p95 are nearest-rank batch latency, not per-request latency under load.
All measurements are numeric; versions, digest and research status are metadata.
Keep individual rounds rather than hiding variance behind one speedup ratio.

## 2. Independent SQLite WAL durability experiment

`sqlite_wal.py` accepts the **original fixture export**, not the Go/Node summary.
One batch is one `BEGIN IMMEDIATE` transaction with keyed upsert, preserving
complete telemetry JSON. `journal_mode=WAL`, `synchronous=FULL`; acknowledgement
is returned/printed only after COMMIT succeeds. It uses parameterized statements.

```sh
python3 scripts/hub-prototypes/sqlite_wal.py \
  --db "$RUNNER_TEMP/research.db" --input "$RUNNER_TEMP/batch.json"
# -> {"acknowledged": COUNT+1, "rows": COUNT}
python3 scripts/hub-prototypes/run_storage.py \
  --out "$RUNNER_TEMP/sqlite-report.json" --count 256 --iterations 100
```

`run_storage.py` is a separate CI-only command. It reports cold insert separately
from repeated replacement commits; this is **not** a MySQL comparison or a
whole-stack speedup. CPU/RSS methods match the language experiment's definitions.
The SQLite loop includes parse, serialize, transaction and durable commit; it
does not include network acknowledgement latency. Database+WAL bytes are sampled
before close/checkpoint. No storage migration or production fallback is wired.

Filesystem safety is fail-closed: Linux `/proc/mounts` or macOS `/sbin/mount`,
longest matching mount after resolving symlinks, explicit local filesystem
allowlist. NFS/NFS4/CIFS/SMB, unknown filesystems and tmpfs are refused, even if
`CI=true`. A missing database parent is refused. This guard assumes mount topology
does not change during the process; it is not protection against a privileged
concurrent remount. Run only on a known local scratch/runner directory.

Tests SIGKILL a real subprocess at two deterministic barriers: before COMMIT and
after COMMIT but before acknowledgement. Recovery must yield respectively zero
or all rows, `integrity_check=ok`, and unique idempotent replay with replacement.
They also test rollback after a partially applied invalid batch, a denied actual
COMMIT (no ack), backup via SQLite's online backup API, immutable snapshot naming,
and explicit restore/rollback followed by reopen. This proves process-crash
behavior under test, **not** power-loss durability on NAS/controller hardware.
Do not copy only a live WAL database file; use `backup()`. Restore requires all
other clients stopped and is a research/test operation, not production recovery.

## Unit commands and scratch discipline

Copy this directory and the repository fixture into a local scratch snapshot,
preserving their relative paths (or supply the fixture path to the generator).
Set `TMPDIR`, `GOCACHE`, `GOMODCACHE` and `PYTHONPYCACHEPREFIX` below that scratch
(or use `PYTHONDONTWRITEBYTECODE=1` for Python).
No `node_modules`, generated JSON, database files, test binaries or caches belong
in the NAS worktree. Tests are lightweight correctness tests, not benchmarks:

```sh
node --test scripts/hub-prototypes/language.test.mjs
(cd scripts/hub-prototypes/go && GOTOOLCHAIN=local go test ./...)
python3 -m unittest discover -s scripts/hub-prototypes -p 'test_*.py' -v
```

The CI benchmark runners write reports only below `RUNNER_TEMP`; stdout is one
JSON report. A nonzero exit (invalid domain, failed equivalence, unsafe filesystem,
or failed commit) is a failed experiment, not evidence of improvement. The main
Agent owns workflow wiring and artifact retention. No workflow is added here.

## Decision gate: preserve current path until net benefit is demonstrated

Before considering any production proposal, require repeatable equal-work,
equal-input latency, CPU and RSS evidence on representative device/hardware
scales; then measure **whole-stack** API p50/p95/p99, throughput, Hub/MySQL CPU,
RSS, disk writes, recovery time and operational cost against the improved current
baseline. Establish acceptance thresholds before examining results, repeat with
matched runner resources, and report variance and regressions. Kernel-only gains
do not establish whole-stack benefit; no numbers or acceptance claim are invented.

Full auth, HTTP routing, Socket.IO, backpressure, retention/downsampling, metric
quality semantics, schema compatibility, concurrent writers/readers, production
backup/restore orchestration, upgrade/migration and security hardening are **not
implemented**. Neither prototype is a production Hub replacement. If any
compatibility, durability or net-benefit gate fails, keep the existing path.
