/** CI-only research: oracle snapshot memo and reversible metadata split, not a migration. */
import assert from "node:assert/strict";
import { statfs, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { CachedMetricAccumulator, RecordMetadataDictionary, splitRecordMetadata, hydrateRecordMetadata } from "../../apps/server/src/aggregation-prototype.js";
import { createHubContractPayload } from "../../apps/server/src/hub-contract-fixtures.js";
import { averageRecord } from "../../apps/server/src/services/metrics.js";
import { payloadToTimeSeries } from "../../apps/server/src/utils.js";

assert.equal(process.env.CI, "true", "research_benchmark_ci_only");
assert.equal(process.platform, "linux");
const output = resolve(process.argv[2] ?? "");
const root = process.env.RUNNER_TEMP ?? "";
assert.ok(isAbsolute(root));
const local = relative(root, output);
assert.ok(local && !local.startsWith("..") && !isAbsolute(local), "runner_local_output_required");
assert.ok([0xef53, 0x58465342, 0x9123683e, 0x794c7630, 0x2fc12fc1].includes((await statfs(root)).type),
  "research_requires_known_local_filesystem");
const timestamp = Date.parse("2026-10-24T00:00:00Z");
const points = Array.from({ length: 128 }, (_, index) => {
  const payload = createHubContractPayload({ timestamp: timestamp + index * 2000,
    hardware: { cpuPackages: 2, disks: 16, networkInterfaces: 8, gpus: 4, fans: 16, temperatureSensors: 16 } });
  payload.cpuUsagePercent = index % 100;
  return payloadToTimeSeries(payload);
});
const accumulator = new CachedMetricAccumulator(timestamp, "hour");
for (const point of points) accumulator.append(point);
const expected = averageRecord(points, timestamp);
assert.deepEqual(accumulator.read(), expected);
const dictionary = new RecordMetadataDictionary();
const split = points.map((point) => splitRecordMetadata(point, dictionary));
for (let index = 0; index < points.length; index++) assert.deepEqual(hydrateRecordMetadata(split[index], dictionary), points[index]);

function measure(operation: () => unknown) {
  for (let index = 0; index < 5; index++) operation();
  const before = process.cpuUsage(), started = performance.now();
  const durations: number[] = [];
  for (let index = 0; index < 50; index++) {
    const tick = performance.now(); operation(); durations.push(performance.now() - tick);
  }
  const cpu = process.cpuUsage(before);
  durations.sort((a, b) => a - b);
  return { iterations: 50, wallMs: performance.now() - started,
    cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
    p50Ms: durations[24], p95Ms: durations[47] };
}
// Alternate run order; process peak RSS is shared and not attributed to either kernel.
const rounds = Array.from({ length: 5 }, (_, index) => index % 2
  ? { memo: measure(() => accumulator.read()), oracle: measure(() => averageRecord(points, timestamp)) }
  : { oracle: measure(() => averageRecord(points, timestamp)), memo: measure(() => accumulator.read()) });
const versions = [...new Set(split.map((point) => point.metadataVersion))];
const encoded = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const report = { status: "research-only", productionReplacementAuthorized: false,
  method: "same-process alternating oracle/memo snapshot reads, immutable input; not incremental ingest or whole-stack benefit",
  inputPoints: points.length, rounds, processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
  metadata: { versions: dictionary.size, originalBytes: encoded(points),
    dynamicAndDictionaryBytes: encoded(split) + encoded(versions.map((version) => ({ version, entries: dictionary.resolve(version) }))) },
  gates: { exactOracleEquality: true, exactMetadataHydration: true, durableMetadataDictionary: false,
    transactionalReferenceGc: false, productionMigration: false } };
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
