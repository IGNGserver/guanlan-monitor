# Headless agent footprint optimization (2026-10-07)

Round 1 of the headless collector optimization, from the client headless-mode
analysis. The headless data plane is the machine-scope service: the local
backend (`guanlan-agent`, built from `agents/cmd/windows-agent-backend`) plus
the collector (`device-state-console-agent`, built from `agents/main.go`). This
round changes only the Go agent; sampling defaults (30s/60s), the payload
schema and the service lifecycle are unchanged.

## Changes

| Commit | Change |
| --- | --- |
| `fix(agent): count a probe spawn only after the process starts` | `probeSpawns` counted attempts before `exec` (missing nvidia-smi/smartctl inflated it) and double-counted PowerShell; the Linux `smartctl -A` fallback was not counted. |
| `perf(agent): halve Windows steady-state probes` | SYSTEM sensor helper probe interval 30s → 60s (cache accepted for 120s, read once per 60s slow cycle); Win32_Processor L3 fallback cached with the 10 minute inventory instead of per slow cycle. |
| `perf(agent): move Linux walks and smartctl probes to the slow cadence` | Process/thread/fd enumeration 30s → slow interval (60s); per-disk `smartctl -A` fallback shares the 2 minute disk-sensor TTL. |
| `perf(agent): skip collection for metric groups the filter would discard` | `collectionPlan` mirrors `applyRuntimeConfig`'s block/metric/instance conditions and skips the expensive collectors when the runtime filter would zero them. |
| `fix(agent): bound the backend diagnostics log` | Backend diagnostics log capped at 2 MiB with a half-trim, matching the desktop log. |

## Local measurement (Linux, production cadence)

Method: the v3.0.148 release backend spawns a collector against the local stub
hub; sampling 30s/60s; 3.5 minutes; RSS/CPU/threads/FDs sampled from `/proc`
every 2s. "Before" uses the extracted release binaries, "after" a build of the
branch. Same QEMU VM (ubuntu-dev), non-root, no `smartctl`/GPU tools installed.

| Metric | Before (v3.0.148) | After (branch) |
| --- | ---: | ---: |
| Collector RSS (median) | 15,176 KB | 15,000 KB |
| Backend RSS (median) | 8,216 KB | 8,828 KB |
| Collector CPU (average, one core) | 0.291% | 0.056% |
| Collector CPU (2s peak) | 6.0% | 1.5% |
| Steady external probes | 3 counted (nvidia-smi ENOENT attempts) | 0 |
| Fast-cycle probes | 0 | 0 (invariant) |
| Ingest payload (median) | 4,637 B | 4,595 B |
| Ingest cadence | 8 per 3.5 min | 8 per 3.5 min |

The probe drop combines the gating change (the Linux default disables the GPU
block) with the counter fix (a missing binary no longer counts). The CPU
reduction comes from the process walk moving to the slow cadence; this VM has
no `smartctl`, so the smartctl TTL change is not visible here.

## CI audit baseline

`agent-performance-audit.yml` run
[37578174685](https://github.com/IGNGserver/guanlan-monitor/actions/runs/37578174685)
on `main` (v3.0.148), compressed cadence 5s/20s:

| Runner | Spawns per slow cycle | Fast-cycle spawns | spawns/min | by executable |
| --- | ---: | ---: | ---: | --- |
| windows-latest | 8.429 | 0 | 21.455 | powershell×45, netsh×7, nvidia-smi×7 |
| ubuntu-latest | 1.0 | 0 | 2.743 | nvidia-smi×8 |

The Windows PowerShell count is inflated by the double-count defect (~2×) and
the nvidia-smi entries are failed attempts, both fixed by the first commit; the
after-merge run with `baseline_ref` is the comparable measurement.

**The SYSTEM helper is not visible to this harness**: the helper's own probe
counters live in its process and are never uploaded. Its interval change can
only be observed on a real installed machine (for example, by watching the
`hardware-sensors.json` cache mtime refresh every ~60s instead of ~30s).

## Limitations

- Linux numbers come from a VM without hardware sensors or `smartctl`; they are
  a floor, not a representative machine.
- Windows numbers come from a shared GitHub runner; absolute values are not
  guarantees.
- Probe counts are the collector's own counters; after this round they describe
  processes that actually started, so pre/post rates must not be compared
  without accounting for the correction.

## Not in this round

Spool rewrite to append+compaction, slow-collection context cancellation,
splitting a headless-only Linux package, an adaptive/configurable helper
interval, Windows inventory gating, and macOS support.
