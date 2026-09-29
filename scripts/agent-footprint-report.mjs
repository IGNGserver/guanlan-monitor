#!/usr/bin/env node
/**
 * Agent footprint report.
 *
 * Reads the ingest capture written by `headless-hub-stub.mjs --capture` and turns
 * the collector's own counters into measured numbers: how many external probe
 * processes it started per cycle and per minute, whether the fast path stayed
 * probe-free, and how a candidate compares with a baseline ref.
 *
 * Design invariants are asserted; rates and wall times are reported as
 * observations. That split is deliberate: the repo's existing performance harness
 * asserts structure and reports timings, because a shared CI runner cannot make a
 * timing claim that holds on a user's machine.
 *
 * Usage:
 *   node scripts/agent-footprint-report.mjs \
 *     --capture run/candidate.jsonl --label candidate \
 *     --output artifacts/agent-footprint.json \
 *     [--baseline-capture run/baseline.jsonl] \
 *     [--max-spawns-per-minute N]
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

export function parseArguments(argv) {
  const options = {
    capture: "",
    baselineCapture: "",
    label: "candidate",
    output: "",
    maxSpawnsPerMinute: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--capture") options.capture = value;
    else if (flag === "--baseline-capture") options.baselineCapture = value;
    else if (flag === "--label") options.label = value;
    else if (flag === "--output") options.output = value;
    else if (flag === "--max-spawns-per-minute") options.maxSpawnsPerMinute = Number(value);
    else continue;
    index += 1;
  }
  if (!options.capture) throw new Error("--capture is required");
  return options;
}

export function readCapture(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function totalSpawns(entries) {
  return entries.reduce((sum, entry) => {
    const spawns = entry.probeSpawns ?? {};
    return sum + Object.values(spawns).reduce((count, value) => count + (Number.isFinite(value) ? value : 0), 0);
  }, 0);
}

export function spawnsByExecutable(entries) {
  const totals = {};
  for (const entry of entries) {
    for (const [name, value] of Object.entries(entry.probeSpawns ?? {})) {
      totals[name] = (totals[name] ?? 0) + (Number.isFinite(value) ? value : 0);
    }
  }
  return Object.fromEntries(Object.entries(totals).sort((left, right) => right[1] - left[1]));
}

export function minutesBetween(first, last, extraMillis = 0) {
  const start = Date.parse(first?.sampledAt ?? "");
  const end = Date.parse(last?.sampledAt ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start + extraMillis) / 60_000;
}

/**
 * Median gap between consecutive samples, used to attribute the last sample to a
 * full cycle. Without it a run's measured window stops one interval short and
 * every rate is inflated.
 */
function medianIntervalMillis(entries) {
  const deltas = [];
  for (let index = 1; index < entries.length; index += 1) {
    const previous = Date.parse(entries[index - 1]?.sampledAt ?? "");
    const current = Date.parse(entries[index]?.sampledAt ?? "");
    if (Number.isFinite(previous) && Number.isFinite(current) && current > previous) {
      deltas.push(current - previous);
    }
  }
  if (!deltas.length) return 0;
  deltas.sort((left, right) => left - right);
  return deltas[Math.floor(deltas.length / 2)];
}

/**
 * Split a capture into warm-up and steady state.
 *
 * The first slow collection has no cached hardware inventory and no sensor cache,
 * so it is strictly more expensive than the cycles that follow. Warm-up is
 * everything up to and including that first slow cycle; steady state is the rest.
 * A payload belongs to a slow cycle when `collectorStats.slowRuns` grew since the
 * previous payload.
 */
export function splitPhases(entries) {
  const withStats = entries.map((entry) => {
    const slowRuns = entry.collectorStats?.slowRuns ?? 0;
    const spawns = Object.values(entry.probeSpawns ?? {}).reduce((sum, value) => sum + value, 0);
    return { entry, slowRuns, spawns };
  });
  let firstSlowIndex = -1;
  for (let index = 0; index < withStats.length; index += 1) {
    const previous = index === 0 ? 0 : withStats[index - 1].slowRuns;
    if (withStats[index].slowRuns > previous) { firstSlowIndex = index; break; }
  }
  if (firstSlowIndex < 0) {
    return { warmup: withStats, steady: [], slowCycles: [], fastCycles: [], steadySlowRuns: 0 };
  }
  const warmup = withStats.slice(0, firstSlowIndex + 1);
  const steady = withStats.slice(firstSlowIndex + 1);
  const slowCycles = [];
  const fastCycles = [];
  for (let index = 0; index < steady.length; index += 1) {
    const previous = index === 0 ? warmup[warmup.length - 1].slowRuns : steady[index - 1].slowRuns;
    if (steady[index].slowRuns > previous) slowCycles.push(steady[index]);
    else fastCycles.push(steady[index]);
  }
  return { warmup, steady, slowCycles, fastCycles, steadySlowRuns: slowCycles.length };
}

export function summarise(entries, label) {
  const phases = splitPhases(entries);
  const steadyEntries = phases.steady.map((item) => item.entry);
  const windowMinutes = minutesBetween(
    steadyEntries[0],
    steadyEntries[steadyEntries.length - 1],
    medianIntervalMillis(steadyEntries)
  );
  // Collectors older than the probe-counter addition report neither field, so a
  // capture from one cannot be summarised as "zero probes" — that would read as a
  // perfect result instead of "not measurable".
  const countersAvailable = entries.some((entry) => entry.collectorStats);
  const steadySpawns = phases.steady.reduce((sum, item) => sum + item.spawns, 0);
  const warmupSpawns = phases.warmup.reduce((sum, item) => sum + item.spawns, 0);
  const lastStats = entries.length ? entries[entries.length - 1].collectorStats : null;
  const firstSteadyStats = phases.steady.length ? phases.steady[0].entry.collectorStats : null;
  return {
    label,
    countersAvailable,
    ingests: entries.length,
    warmupCycles: phases.warmup.length,
    warmupSpawns,
    steadyCycles: phases.steady.length,
    steadySlowCycles: phases.steadySlowRuns,
    steadyFastCycles: phases.fastCycles.length,
    steadyWindowMinutes: Number(windowMinutes.toFixed(3)),
    steadySpawns,
    steadySpawnsPerMinute: windowMinutes > 0 ? Number((steadySpawns / windowMinutes).toFixed(3)) : null,
    steadyFastCycleSpawns: phases.fastCycles.reduce((sum, item) => sum + item.spawns, 0),
    // The design quantities: how much work one collection of each kind costs.
    spawnsPerSlowCycle: phases.steadySlowRuns > 0
      ? Number((phases.slowCycles.reduce((sum, item) => sum + item.spawns, 0) / phases.steadySlowRuns).toFixed(3))
      : null,
    spawnsPerFastCycle: phases.fastCycles.length > 0
      ? Number((phases.fastCycles.reduce((sum, item) => sum + item.spawns, 0) / phases.fastCycles.length).toFixed(3))
      : null,
    spawnsByExecutable: spawnsByExecutable(phases.steady.map((item) => item.entry)),
    lastSlowMillis: lastStats?.lastSlowMillis ?? null,
    slowOverruns: lastStats?.slowOverruns ?? null,
    slowOverrunsInSteady: lastStats && firstSteadyStats
      ? lastStats.slowOverruns - firstSteadyStats.slowOverruns
      : null
  };
}

export function formatTable(summary) {
  const lines = [
    `agent footprint (${summary.label})`,
    `  counters reported:       ${summary.countersAvailable ? "yes" : "NO (collector predates the probe counters; not measurable)"}`,
    `  ingests:                 ${summary.ingests}`,
    `  warm-up cycles:          ${summary.warmupCycles} (${summary.warmupSpawns} probes)`,
    `  steady cycles:           ${summary.steadyCycles} (${summary.steadySlowCycles} slow, ${summary.steadyFastCycles} fast)`,
    `  steady window:           ${summary.steadyWindowMinutes} min`,
    `  steady probe spawns:     ${summary.steadySpawns}`,
    `  steady spawns/minute:    ${summary.steadySpawnsPerMinute ?? "n/a"}`,
    `  probes per slow cycle:   ${summary.spawnsPerSlowCycle ?? "n/a"}`,
    `  probes per fast cycle:   ${summary.spawnsPerFastCycle ?? "n/a"} (must be 0)`,
    `  fast-cycle spawns:       ${summary.steadyFastCycleSpawns} (must be 0)`,
    `  last slow collection:    ${summary.lastSlowMillis ?? "n/a"} ms`,
    `  slow overruns (steady):  ${summary.slowOverrunsInSteady ?? "n/a"}`
  ];
  const byExecutable = Object.entries(summary.spawnsByExecutable);
  lines.push(`  by executable (steady):  ${byExecutable.length ? byExecutable.map(([name, count]) => `${name}=${count}`).join(", ") : "none"}`);
  return lines.join("\n");
}

export function buildReport(options) {
  const candidateEntries = readCapture(options.capture);

  assert.ok(candidateEntries.length > 0, `no ingest payloads captured at ${options.capture}; the agent never reached the stub hub`);
  const candidate = summarise(candidateEntries, options.label);

  assert.ok(
    candidate.countersAvailable,
    `the candidate collector did not report probeSpawns/collectorStats; it predates the probe counters and cannot be audited`
  );
  assert.ok(
    candidate.steadyCycles > 0,
    "the run was too short to observe a steady-state cycle after warm-up; increase the duration"
  );
  // The invariant the collector is built around: once hardware inventory and the
  // slow interval are established, a fast cycle must not start any external probe.
  assert.equal(
    candidate.steadyFastCycleSpawns,
    0,
    `a fast cycle started ${candidate.steadyFastCycleSpawns} external probes; the fast path must stay probe-free`
  );
  if (options.maxSpawnsPerMinute != null) {
    assert.ok(
      candidate.steadySpawnsPerMinute != null && candidate.steadySpawnsPerMinute <= options.maxSpawnsPerMinute,
      `steady-state spawn rate ${candidate.steadySpawnsPerMinute}/min exceeds the ${options.maxSpawnsPerMinute}/min budget`
    );
  }

  const baseline = options.baselineCapture ? summarise(readCapture(options.baselineCapture), "baseline") : null;
  if (baseline && !baseline.countersAvailable) {
    throw new Error(
      "the baseline capture has no probeSpawns/collectorStats, so it predates the probe counters and cannot be compared. "
      + "Pass a baseline ref that already reports them, or compare absolute candidate numbers instead."
    );
  }
  const report = {
    measuredAt: new Date().toISOString(),
    limitations: "One shared CI runner; intervals shortened so a few minutes contain many cycles. Probe counts are the collector's own counters, not a process-monitor trace. Rates are observations; only the probe-free fast path and payload arrival are asserted.",
    candidate,
    baseline
  };
  if (baseline) {
    const ratio = baseline.steadySpawnsPerMinute && candidate.steadySpawnsPerMinute != null
      ? candidate.steadySpawnsPerMinute / baseline.steadySpawnsPerMinute
      : null;
    report.delta = {
      steadySpawnsPerMinute: baseline.steadySpawnsPerMinute == null || candidate.steadySpawnsPerMinute == null
        ? null
        : Number((candidate.steadySpawnsPerMinute - baseline.steadySpawnsPerMinute).toFixed(3)),
      ratio: ratio == null ? null : Number(ratio.toFixed(3))
    };
  }
  return report;
}

export function formatMarkdown(report) {
  const rows = [];
  const head = "| metric | " + (report.baseline ? "baseline | candidate | ratio |" : "candidate |");
  const sep = "| --- | " + (report.baseline ? "---: | ---: | ---: |" : "---: |");
  rows.push(head, sep);
  const line = (label, pick) => {
    const candidate = pick(report.candidate);
    if (!report.baseline) return `| ${label} | ${candidate} |`;
    const baseline = pick(report.baseline);
    const ratio = typeof baseline === "number" && baseline !== 0 && typeof candidate === "number"
      ? `${((candidate / baseline) * 100).toFixed(1)}%`
      : "n/a";
    return `| ${label} | ${baseline} | ${candidate} | ${ratio} |`;
  };
  rows.push(line("ingests", (summary) => summary.ingests));
  rows.push(line("warm-up probes", (summary) => summary.warmupSpawns));
  rows.push(line("steady spawns/min", (summary) => summary.steadySpawnsPerMinute ?? "n/a"));
  rows.push(line("probes per slow cycle", (summary) => summary.spawnsPerSlowCycle ?? "n/a"));
  rows.push(line("probes per fast cycle", (summary) => summary.spawnsPerFastCycle ?? "n/a"));
  rows.push(line("fast-cycle spawns (must be 0)", (summary) => summary.steadyFastCycleSpawns));
  rows.push(line("last slow collection (ms)", (summary) => summary.lastSlowMillis ?? "n/a"));
  return [
    `### Agent collector footprint (${process.env.RUNNER_OS ?? process.platform})`,
    "",
    rows.join("\n"),
    "",
    `Steady-state probes by executable: ${Object.entries(report.candidate.spawnsByExecutable).map(([name, count]) => `\`${name}\`×${count}`).join(", ") || "none"}.`,
    "",
    "> Probe counts are the collector's own counters, captured by a local stub hub; rates are observations, not guarantees. Only the probe-free fast path is asserted."
  ].join("\n");
}

export function runAudit(options) {
  const report = buildReport(options);
  if (report.baseline) {
    console.log(formatTable(report.baseline));
    console.log(`\ncandidate vs baseline: ${report.delta.ratio == null ? "n/a" : `${(report.delta.ratio * 100).toFixed(1)}% of baseline spawn rate`}`);
  }
  console.log(`\n${formatTable(report.candidate)}`);
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`\nwrote ${options.output}`);
  }
  // Surface the measurement where a manual audit is actually read.
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${formatMarkdown(report)}\n`, "utf8");
  }
  return report;
}

// Only run as a CLI; importing this module for its pure helpers must not assert.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  runAudit(parseArguments(process.argv.slice(2)));
}
