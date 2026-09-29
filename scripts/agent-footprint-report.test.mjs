import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildReport, isMainModule, splitPhases, summarise } from "./agent-footprint-report.mjs";

const scriptPath = fileURLToPath(new URL("./agent-footprint-report.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const T0 = Date.parse("2026-09-29T00:00:00Z");

/** `slowAt` lists the cycle indices that ran a slow collection. */
function capture({ cycles = 13, slowEvery = 4, slowSpawns = 4, fastSpawns = 0, firstSpawns = 20, overruns = 0 } = {}) {
  const entries = [];
  let time = T0;
  let slowRuns = 0;
  for (let index = 0; index < cycles; index += 1) {
    const isSlow = index === 0 || (slowEvery > 0 && index % slowEvery === 0);
    if (isSlow) slowRuns += 1;
    const spawns = isSlow ? (index === 0 ? firstSpawns : slowSpawns) : fastSpawns;
    entries.push({
      at: new Date(time).toISOString(),
      sampledAt: new Date(time).toISOString(),
      probeSpawns: spawns ? { powershell: spawns } : null,
      collectorStats: { slowRuns, slowOverruns: overruns, lastSlowMillis: isSlow ? 1200 : 1200 }
    });
    time += 5_000;
  }
  return entries;
}

function writeCaptureFile(dir, name, entries) {
  const file = path.join(dir, name);
  writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  return file;
}

test("splitPhases treats the first slow cycle as warm-up and the rest as steady state", () => {
  const entries = capture();
  const phases = splitPhases(entries);
  assert.equal(phases.warmup.length, 1, "warm-up ends after the first slow cycle");
  assert.equal(phases.steady.length, 12);
  assert.equal(phases.steadySlowRuns, 3);
  assert.equal(phases.fastCycles.length, 9);
});

test("summarise reports per-minute spawns and keeps warm-up out of the rate", () => {
  const summary = summarise(capture({ slowSpawns: 4, fastSpawns: 0, firstSpawns: 20 }), "candidate");
  assert.equal(summary.warmupSpawns, 20);
  assert.equal(summary.steadySpawns, 12);
  assert.equal(summary.steadyFastCycleSpawns, 0);
  // 12 spawns over a 60 second steady window.
  assert.equal(summary.steadySpawnsPerMinute, 12);
  assert.deepEqual(summary.spawnsByExecutable, { powershell: 12 });
});

test("a probe-spawning fast cycle is rejected", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "footprint-"));
  try {
    // A missing capture is the "agent never reached the hub" failure.
    assert.throws(
      () => buildReport({ capture: path.join(dir, "missing.jsonl"), label: "candidate", baselineCapture: "", output: "", maxSpawnsPerMinute: null }),
      /no ingest payloads/
    );
    // A fast cycle that spawned probes is counted, not hidden.
    const summary = summarise(capture({ fastSpawns: 1 }), "bad");
    assert.equal(summary.steadyFastCycleSpawns, 9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a spawn-rate ceiling is enforced when supplied", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "footprint-"));
  try {
    const captureFile = writeCaptureFile(dir, "candidate.jsonl", capture({ slowSpawns: 4 }));
    assert.throws(
      () => buildReport({ capture: captureFile, label: "candidate", baselineCapture: "", output: "", maxSpawnsPerMinute: 6 }),
      /exceeds the 6\/min budget/
    );
    const report = buildReport({ capture: captureFile, label: "candidate", baselineCapture: "", output: "", maxSpawnsPerMinute: 20 });
    assert.equal(report.candidate.steadyFastCycleSpawns, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a baseline capture produces a candidate-to-baseline ratio", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "footprint-"));
  try {
    const candidateFile = writeCaptureFile(dir, "candidate.jsonl", capture({ slowSpawns: 4 }));
    const baselineFile = writeCaptureFile(dir, "baseline.jsonl", capture({ slowSpawns: 16 }));
    const report = buildReport({
      capture: candidateFile, label: "candidate", baselineCapture: baselineFile, output: "", maxSpawnsPerMinute: null
    });
    assert.equal(report.baseline.steadySpawnsPerMinute, 48);
    assert.equal(report.candidate.steadySpawnsPerMinute, 12);
    assert.equal(report.delta.ratio, 0.25);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a baseline without probe counters is refused instead of reported as zero", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "footprint-"));
  try {
    const candidateFile = writeCaptureFile(dir, "candidate.jsonl", capture());
    // A pre-optimization collector emits no probeSpawns/collectorStats at all.
    const legacy = capture().map(({ probeSpawns, collectorStats, ...rest }) => rest);
    const baselineFile = writeCaptureFile(dir, "baseline.jsonl", legacy);
    assert.throws(
      () => buildReport({ capture: candidateFile, label: "candidate", baselineCapture: baselineFile, output: "", maxSpawnsPerMinute: null }),
      /predates the probe counters and cannot be compared/
    );
    assert.equal(summarise(legacy, "baseline").countersAvailable, false);
    assert.equal(summarise(legacy, "baseline").steadySpawns, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isMainModule decodes the module URL instead of using its raw pathname", () => {
  // The Windows failure mode was comparing `process.argv[1]` against
  // `new URL(url).pathname`, which is not a native path (it keeps `/D:/` and
  // percent-escapes). A percent-encoded space distinguishes the two on every
  // platform: fileURLToPath decodes it, `.pathname` does not.
  assert.equal(isMainModule("file:///tmp/a%20b/report.mjs", "/tmp/a b/report.mjs"), true);
  assert.equal(isMainModule("file:///tmp/a%20b/report.mjs", "/tmp/a%20b/report.mjs"), false);
  assert.equal(isMainModule("file:///tmp/x/report.mjs", "/tmp/x/report.mjs"), true);
  assert.equal(isMainModule("file:///tmp/x/report.mjs", "/tmp/x/other.mjs"), false);
  assert.equal(isMainModule("file:///tmp/x/report.mjs", ""), false);
});

test("the CLI treats this file as the main module when invoked directly", () => {
  assert.equal(isMainModule(new URL(import.meta.url).href, fileURLToPath(import.meta.url)), true);
});

test("the CLI exits non-zero when the fast path spawns a probe", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "footprint-"));
  try {
    const good = writeCaptureFile(dir, "good.jsonl", capture());
    const bad = writeCaptureFile(dir, "bad.jsonl", capture({ fastSpawns: 2 }));

    const ok = execFileSync(process.execPath, [scriptPath, "--capture", good, "--label", "candidate"], { cwd: repoRoot, encoding: "utf8" });
    assert.match(ok, /fast-cycle spawns:\s+0/);

    assert.throws(
      () => execFileSync(process.execPath, [scriptPath, "--capture", bad, "--label", "candidate"], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" }),
      (error) => /fast path must stay probe-free/.test(String(error.stderr ?? ""))
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
