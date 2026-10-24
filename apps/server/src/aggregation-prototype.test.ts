import assert from "node:assert/strict";
import test from "node:test";
import {
  CachedMetricAccumulator, MetadataVersionMissingError, RecordMetadataDictionary,
  hydrateRecordMetadata, splitRecordMetadata, type SplitRecordMetadata
} from "./aggregation-prototype.js";
import { createHubContractPayload } from "./hub-contract-fixtures.js";
import { averageRecord } from "./services/metrics.js";
import type { TimeSeriesRecord } from "./types.js";
import { payloadToTimeSeries } from "./utils.js";

const start = Date.parse("2026-10-24T00:00:00.000Z");
const record = (offset = 0) => payloadToTimeSeries(createHubContractPayload({ timestamp: start + offset }));

// Independent copy of current production replacement/cap semantics, not Map order.
function appendLegacy(samples: TimeSeriesRecord[], point: TimeSeriesRecord, cap: number) {
  const index = samples.findIndex((sample) => sample.timestamp === point.timestamp);
  if (index >= 0) samples[index] = structuredClone(point);
  else {
    if (samples.length >= cap) samples.shift();
    samples.push(structuredClone(point));
  }
}

function assertOracle(accumulator: CachedMetricAccumulator, samples: TimeSeriesRecord[]) {
  const expected = samples.length ? averageRecord(samples, start) : undefined;
  assert.deepStrictEqual(accumulator.read(), expected);
  const count = accumulator.averageComputations;
  assert.deepStrictEqual(accumulator.read(), expected);
  assert.equal(accumulator.averageComputations, count, "unchanged reads must not reaverage");
}

test("empty/lazy/revision behavior and append invalidation, including identical immutable objects", () => {
  const accumulator = new CachedMetricAccumulator(start, "minute");
  assert.equal(accumulator.read(), undefined);
  assert.equal(accumulator.revision, 0);
  assert.equal(accumulator.averageComputations, 0);
  const point = Object.freeze(record());
  accumulator.append(point);
  assert.equal(accumulator.revision, 1);
  assert.equal(accumulator.averageComputations, 0);
  assertOracle(accumulator, [point]);
  assert.equal(accumulator.averageComputations, 1);
  accumulator.append(point);
  assert.equal(accumulator.revision, 2);
  assert.equal(accumulator.size, 1);
  assertOracle(accumulator, [point]);
  assert.equal(accumulator.averageComputations, 2);
});

test("timestamp replacement retains insertion order, duplicates and last-counter semantics", () => {
  const accumulator = new CachedMetricAccumulator(start, "minute");
  const samples: TimeSeriesRecord[] = [];
  for (const [offset, value] of [[20, 10], [0, 20], [10, 30], [0, 999], [20, 777], [10, 42]]) {
    const point = record(offset);
    point.trafficRxBytes = value;
    accumulator.append(point);
    appendLegacy(samples, point, 256);
    assertOracle(accumulator, samples);
  }
  assert.equal(accumulator.size, 3);
  assert.equal(accumulator.read()!.trafficRxBytes, 42);
});

test("caller mutations never change stored inputs, cached outputs or later same-object replacements", () => {
  const accumulator = new CachedMetricAccumulator(start, "minute");
  const point = record();
  const original = structuredClone(point);
  accumulator.append(point);
  point.cpuUsagePercent = 999;
  point.recordedDetails!.memory.totalBytes = 1;
  point.cpus![0].name = "caller changed input";
  assertOracle(accumulator, [original]);
  const output = accumulator.read()!;
  output.cpuUsagePercent = -100;
  output.recordedDetails!.memory.totalBytes = -1;
  output.cpus![0].name = "caller changed output";
  output.recordedDetails!.temperatureSensors!.length = 0;
  assertOracle(accumulator, [original]);
  accumulator.append(point);
  assertOracle(accumulator, [point]);
  assert.equal(accumulator.read()!.cpuUsagePercent, 999);
});

test("all fixed scalar means preserve exact oracle order, not sampleCount weighting or rolling sums", () => {
  const accumulator = new CachedMetricAccumulator(start, "minute");
  const samples: TimeSeriesRecord[] = [];
  const base = record() as unknown as Record<string, unknown>;
  const numericKeys = Object.keys(base).filter((key) => typeof base[key] === "number" && key !== "timestamp" && key !== "sampleCount");
  for (const [index, value] of [1e308, -1e308, 1, 1e-300, -0, Number.MAX_VALUE, Number.MAX_VALUE].entries()) {
    const point = record(index);
    for (const key of numericKeys) (point as unknown as Record<string, unknown>)[key] = value;
    point.sampleCount = index ? 9_999 : 1;
    accumulator.append(point);
    appendLegacy(samples, point, 256);
    assertOracle(accumulator, samples);
  }
  for (const value of [3, -1e308, 0]) {
    const point = record(0);
    point.cpuUsagePercent = value;
    accumulator.append(point);
    appendLegacy(samples, point, 256);
    assertOracle(accumulator, samples);
  }
  assert.equal(accumulator.read()!.sampleCount, 7);
  const simple = new CachedMetricAccumulator(start, "minute");
  simple.append({ ...record(), cpuUsagePercent: 10, sampleCount: 100 });
  simple.append({ ...record(1), cpuUsagePercent: 30, sampleCount: 1 });
  assert.equal(simple.read()!.cpuUsagePercent, 20);
});

test("full fixture pipeline matches oracle across membership changes, duplicate observations, zero RPM and bad quality", () => {
  const accumulator = new CachedMetricAccumulator(start, "minute");
  const dictionary = new RecordMetadataDictionary(64);
  const samples: TimeSeriesRecord[] = [];
  const original = record();
  const sameObservation = record(1);
  sameObservation.hardwareSampledAt = original.hardwareSampledAt;
  sameObservation.cpuTemperatureSampledAt = original.cpuTemperatureSampledAt;
  sameObservation.cpuTemperatureC = 91;
  sameObservation.gpuTemperatureC = 92;
  sameObservation.cpus![0].temperatureC = 93;
  sameObservation.fans![0].rpm = 1_234;
  sameObservation.recordedDetails!.temperatureSensors![0].observedAt = original.recordedDetails!.temperatureSensors![0].observedAt;
  sameObservation.recordedDetails!.temperatureSensors![0].currentC = 94;
  const observationAccumulator = new CachedMetricAccumulator(start, "minute");
  observationAccumulator.append(original);
  observationAccumulator.append(sameObservation);
  assertOracle(observationAccumulator, [original, sameObservation]);
  const observation = observationAccumulator.read()!;
  assert.equal(observation.cpuTemperatureC, 91, "scalar observations retain the last value per observation key");
  assert.equal(observation.gpuTemperatureC, 92);
  assert.equal(observation.cpus![0].temperatureC, original.cpus![0].temperatureC, "instance observations retain the first value per key");
  assert.equal(observation.fans![0].rpm, 0, "zero RPM is a real first observation, not a missing value");
  assert.equal(observation.recordedDetails!.temperatureSensors![0].currentC, 94);
  const changed = payloadToTimeSeries(createHubContractPayload({ timestamp: start + 2,
    hardware: { cpuPackages: 1, disks: 0, networkInterfaces: 3, gpus: 0, fans: 1, temperatureSensors: 1 } }));
  changed.cpus![0].id = "new-cpu";
  changed.networks![0].id = "new-network";
  changed.fans![0].rpm = 0;
  changed.recordedDetails!.temperatureSensors![0].status = "unavailable";
  const bad = record(3);
  bad.recordedDetails!.metricQuality = {
    cpuUsage: { state: "stale" }, memoryUsage: { state: "unavailable" }, fanRpm: { state: "not_applicable" }
  };
  bad.recordedDetails!.unavailableMetrics = ["gpuUsage"];
  const replaced = structuredClone(changed);
  replaced.memoryUsedBytes = 123;
  for (const point of [original, sameObservation, changed, bad, record(4), replaced, replaced]) {
    const split = splitRecordMetadata(point, dictionary);
    const hydrated = hydrateRecordMetadata(split, dictionary);
    assert.deepStrictEqual(hydrated, point);
    accumulator.append(hydrated);
    appendLegacy(samples, point, 256);
    assertOracle(accumulator, samples);
  }
  const result = accumulator.read()!;
  assert.equal(result.recordedDetails!.metricQuality!.cpuUsage!.state, "stale");
  assert.equal(result.fans![0].rpm, averageRecord(samples, start).fans[0].rpm);
  assert.equal(result.recordedDetails!.temperatureSensors![0].currentC, averageRecord(samples, start).recordedDetails!.temperatureSensors[0].currentC);
});

for (const [window, cap] of [["minute", 256], ["hour", 4_096]] as const) {
  test(`${window} cap ${cap} matches legacy eviction/replacement exactly, without changing any production retention`, () => {
    const accumulator = new CachedMetricAccumulator(start, window);
    const dictionary = new RecordMetadataDictionary(1);
    const samples: TimeSeriesRecord[] = [];
    const base = record();
    delete base.recordedDetails;
    for (const key of ["cpus", "disks", "networks", "gpus", "fans"] as const) delete base[key];
    for (let index = 0; index < cap + 3; index += 1) {
      const point = { ...base, timestamp: start + index, cpuUsagePercent: index % 100, trafficRxBytes: index };
      const hydrated = hydrateRecordMetadata(splitRecordMetadata(point, dictionary), dictionary);
      assert.deepStrictEqual(hydrated, point);
      accumulator.append(hydrated);
      appendLegacy(samples, point, cap);
      if (index === cap - 1 || index >= cap) assertOracle(accumulator, samples);
    }
    assert.equal(accumulator.maxSamples, cap);
    assert.equal(accumulator.size, cap);
    for (const index of [3, cap, 0, cap + 3]) {
      const point = { ...base, timestamp: start + index, cpuUsagePercent: -99, trafficRxBytes: index };
      accumulator.append(point);
      appendLegacy(samples, point, cap);
      assertOracle(accumulator, samples);
      assert.equal(accumulator.size, cap);
    }
  });
}

test("metadata hashes are canonical/versioned and reused when only dynamic readings/capacities/quality/time change", () => {
  const dictionary = new RecordMetadataDictionary(4);
  const first = record();
  const second = record(1);
  second.disks![0].totalBytes = 7;
  second.recordedDetails!.memory.totalBytes = 11;
  second.recordedDetails!.disks![0].totalBytes = 13;
  second.recordedDetails!.gpus![0].memoryTotalBytes = 17;
  second.cpus![0].coreCount = 1;
  second.cpus![0].usagePercent = 99;
  second.fans![0].rpm = 0;
  second.recordedDetails!.metricQuality = { fanRpm: { state: "stale", reason: "synthetic", observedAt: "synthetic" } };
  second.recordedDetails!.temperatureSensors![0].currentC = null;
  second.recordedDetails!.temperatureSensors![0].status = "unavailable";
  const a = splitRecordMetadata(first, dictionary);
  const b = splitRecordMetadata(second, dictionary);
  const reordered = structuredClone(first);
  reordered.cpus![0] = Object.fromEntries(Object.entries(reordered.cpus![0]).reverse()) as NonNullable<TimeSeriesRecord["cpus"]>[number];
  const c = splitRecordMetadata(reordered, dictionary);
  assert.match(a.metadataVersion, /^v1:sha256:[a-f0-9]{64}$/);
  assert.equal(a.metadataVersion, b.metadataVersion);
  assert.equal(a.metadataVersion, c.metadataVersion);
  assert.equal(dictionary.size, 1);
  for (const [split, input] of [[a, first], [b, second], [c, reordered]] as const) assert.deepStrictEqual(hydrateRecordMetadata(split, dictionary), input);
  assert.equal(b.dynamicRecord.disks![0].totalBytes, 7);
  assert.equal(b.dynamicRecord.recordedDetails!.gpus![0].memoryTotalBytes, 17);
  assert.deepStrictEqual(b.dynamicRecord.recordedDetails!.metricQuality, second.recordedDetails!.metricQuality);
  assert.equal(Object.hasOwn(b.dynamicRecord.cpus![0], "name"), false);
  assert.equal(Object.hasOwn(b.dynamicRecord.recordedDetails!.temperatureSensors![0], "source"), false);
});

test("hardware changes and array order have distinct versions; old snapshots still hydrate", () => {
  const dictionary = new RecordMetadataDictionary(10);
  const points = [record(), record(), record(), record(), record()];
  points[1].cpus![0].name = "renamed";
  points[2].disks!.pop();
  points[3].networks!.reverse();
  points[4].gpus![0].model = "different-model";
  const splits = points.map((point) => splitRecordMetadata(point, dictionary));
  assert.equal(new Set(splits.map((split) => split.metadataVersion)).size, points.length);
  splits.forEach((split, index) => assert.deepStrictEqual(hydrateRecordMetadata(split, dictionary), points[index]));
});

test("metadata round-trip preserves null/absent/undefined/empty/sparse/unknown fields without recursively extracting them", () => {
  const dictionary = new RecordMetadataDictionary();
  const point = Object.assign(record(), { futureField: { id: "unknown-dynamic-id", timestamp: null, unknownArray: [null, {}, []] } });
  point.cpus = [];
  delete point.networks;
  point.gpus = undefined;
  point.fans = new Array(2);
  point.fans[1] = { id: "sparse-fan", name: "", rpm: 0 };
  const extra = Object.assign(point.disks![0], {
    hardwareId: "hardware-1", unit: "bytes", source: "synthetic", model: undefined,
    future: { id: "do-not-extract", quality: null, capacity: 0 }, empty: [], negativeZero: -0
  });
  extra.interfaceType = null;
  const split = splitRecordMetadata(point, dictionary);
  assert.deepStrictEqual(split.dynamicRecord.futureField, point.futureField);
  assert.deepStrictEqual((split.dynamicRecord.disks![0] as typeof extra).future, extra.future);
  const hydrated = hydrateRecordMetadata(split, dictionary);
  assert.deepStrictEqual(hydrated, point);
  assert.equal(Object.hasOwn(hydrated, "networks"), false);
  assert.equal(Object.hasOwn(hydrated, "gpus"), true);
  assert.equal(Object.hasOwn(hydrated.disks![0], "model"), true);
  assert.equal(0 in hydrated.fans!, false);
  assert.ok(Object.is((hydrated.disks![0] as typeof extra).negativeZero, -0));
  const absent = structuredClone(point);
  delete absent.disks![0].model;
  assert.notEqual(splitRecordMetadata(absent, dictionary).metadataVersion, split.metadataVersion);
  const empty = structuredClone(point);
  empty.disks![0].model = "";
  assert.notEqual(splitRecordMetadata(empty, dictionary).metadataVersion, split.metadataVersion);
  const nullModel = structuredClone(point);
  (nullModel.disks![0] as unknown as Record<string, unknown>).model = null;
  const nullSplit = splitRecordMetadata(nullModel, dictionary);
  assert.notEqual(nullSplit.metadataVersion, split.metadataVersion);
  assert.deepStrictEqual(hydrateRecordMetadata(nullSplit, dictionary), nullModel);
});

test("dictionary owns snapshots and resolved metadata/hydrated records cannot pollute later reads", () => {
  const dictionary = new RecordMetadataDictionary();
  const point = record();
  const expected = structuredClone(point);
  const split = splitRecordMetadata(point, dictionary);
  point.disks![0].name = "changed original";
  point.recordedDetails!.memory.totalBytes = 0;
  const metadata = dictionary.resolve(split.metadataVersion);
  metadata[0].fields.name = "changed resolve";
  metadata[0].path.length = 0;
  const hydrated = hydrateRecordMetadata(split, dictionary);
  hydrated.cpus![0].name = "changed hydrated";
  hydrated.recordedDetails!.memory.totalBytes = -1;
  assert.deepStrictEqual(hydrateRecordMetadata(split, dictionary), expected);
  const second = splitRecordMetadata(expected, dictionary);
  split.dynamicRecord.recordedDetails!.memory.totalBytes = -2;
  assert.deepStrictEqual(hydrateRecordMetadata(second, dictionary), expected);
  assert.equal(dictionary.size, 1);
});

test("bounded dictionary misses fail explicitly; no partial fallback or silent data loss", () => {
  const dictionary = new RecordMetadataDictionary(2);
  const first = splitRecordMetadata(record(), dictionary);
  const next = record();
  next.cpus![0].name = "version-2";
  const second = splitRecordMetadata(next, dictionary);
  assert.equal(splitRecordMetadata(next, dictionary).metadataVersion, second.metadataVersion);
  next.cpus![0].name = "version-3";
  const third = splitRecordMetadata(next, dictionary);
  assert.equal(dictionary.size, 2);
  assert.equal(dictionary.maxVersions, 2);
  assert.throws(() => hydrateRecordMetadata(first, dictionary), MetadataVersionMissingError);
  assert.throws(() => hydrateRecordMetadata(second, new RecordMetadataDictionary()), MetadataVersionMissingError);
  assert.deepStrictEqual(hydrateRecordMetadata(third, dictionary), next);
  assert.equal(hydrateRecordMetadata(second, dictionary).cpus![0].name, "version-2");
});

test("invalid bounds/timestamps, unsupported schema and conflicting or missing metadata targets fail closed", () => {
  for (const bound of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => new RecordMetadataDictionary(bound), RangeError);
  assert.throws(() => new CachedMetricAccumulator(NaN, "minute"), RangeError);
  const accumulator = new CachedMetricAccumulator(start, "minute");
  for (const timestamp of [NaN, Infinity, -Infinity]) assert.throws(() => accumulator.append({ ...record(), timestamp }), RangeError);
  assert.equal(accumulator.revision, 0);
  const dictionary = new RecordMetadataDictionary();
  const split = splitRecordMetadata(record(), dictionary);
  assert.throws(() => hydrateRecordMetadata({ ...split, schemaVersion: 2 } as unknown as SplitRecordMetadata, dictionary), /unsupported metadata schema/);
  split.dynamicRecord.cpus![0].name = "conflict";
  assert.throws(() => hydrateRecordMetadata(split, dictionary), /metadata field conflict/);
  delete split.dynamicRecord.cpus;
  assert.throws(() => hydrateRecordMetadata(split, dictionary), /metadata target/);
});
