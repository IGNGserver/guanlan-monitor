import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMetricsPayload, MetricQuality, SamplePoint } from "@dsc/shared";
import { createHubContractPayload, HUB_CONTRACT_TIMESTAMP } from "./hub-contract-fixtures.js";
import { agentMetricsPayloadSchema } from "./metrics-schema.js";
import { averageRecord } from "./services/metrics.js";
import type { TimeSeriesRecord } from "./types.js";
import { payloadToTimeSeries, timeSeriesToMetricSeries } from "./utils.js";

const epoch = Date.parse(HUB_CONTRACT_TIMESTAMP);
const iso = (offset: number) => new Date(epoch + offset).toISOString();
const values = (points: SamplePoint[]) => points.map((point) => point.value);
const aggregate = (payloads: AgentMetricsPayload[]) => averageRecord(payloads.map((payload) => payloadToTimeSeries(payload)));

test("synthetic payloads are deterministic, independently mutable and schema-valid at every supported scale", (t) => {
  // The ingestion schema has a rolling age gate; fixture data must not depend on
  // the wall clock or start failing when this test is run a week later.
  t.mock.method(Date, "now", () => epoch);
  for (const hardware of [
    {},
    { cpuPackages: 0, disks: 0, networkInterfaces: 0, gpus: 0, fans: 0, temperatureSensors: 0 },
    { cpuPackages: 8, disks: 32, networkInterfaces: 16, gpus: 4, fans: 16, temperatureSensors: 64 },
    { cpuPackages: 256, disks: 2_048, networkInterfaces: 256, gpus: 128, fans: 256, temperatureSensors: 1_024 }
  ]) {
    const options = {
      deviceId: "synthetic-scale",
      timestamp: epoch,
      hardware,
      metricQuality: { cpuUsage: { state: "direct" as const, observedAt: HUB_CONTRACT_TIMESTAMP } },
      unavailableMetrics: ["gpuDecode" as const]
    };
    const first = createHubContractPayload(options);
    const second = createHubContractPayload(options);
    assert.deepEqual(first, second);
    assert.deepEqual(agentMetricsPayloadSchema.parse(first), first);
    assert.equal(first.identity.deviceId, options.deviceId);
    assert.equal(first.timestamp, HUB_CONTRACT_TIMESTAMP);
    for (const [key, count] of Object.entries(hardware)) {
      assert.equal(first[key as keyof typeof hardware]?.length, count, key);
    }
    first.memory.usedBytes = 0;
    first.metricQuality!.cpuUsage!.state = "unavailable";
    first.unavailableMetrics!.push("cpuUsage");
    if (first.disks?.length) first.disks[0].name = "changed";
    if (first.networkInterfaces?.length) first.networkInterfaces[0].ipv4!.push("192.0.2.254");
    assert.deepEqual(second, createHubContractPayload(options));
    assert.equal(options.metricQuality.cpuUsage.state, "direct");
    assert.deepEqual(options.unavailableMetrics, ["gpuDecode"]);
  }
});

test("fixture scale rejects invalid counts rather than silently truncating or producing schema-invalid arrays", () => {
  for (const disks of [-1, 1.5, NaN, Infinity, 2_049]) {
    assert.throws(() => createHubContractPayload({ hardware: { disks } }), RangeError);
  }
  assert.throws(() => createHubContractPayload({ deviceId: " " }), RangeError);
  assert.throws(() => createHubContractPayload({ timestamp: "not-a-date" }), RangeError);
});

test("the full conversion chain preserves units, instance identity, sourceKey joins and arithmetic means", () => {
  const first = createHubContractPayload();
  const second = createHubContractPayload({ timestamp: iso(1_000) });
  first.cpuUsagePercent = 20;
  second.cpuUsagePercent = 60;
  first.cpuPackages![0].usagePercent = 0;
  second.cpuPackages![0].usagePercent = 80;
  second.diskRate.instances!["block-0"].readBytesPerSec = 3_072;
  second.diskRate.readBytesPerSec += 2_048;
  const snapshot = structuredClone([first, second]);
  const record = aggregate([first, second]);
  const series = timeSeriesToMetricSeries([record]);
  assert.equal(record.timestamp, epoch + 1_000);
  assert.equal(record.sampleCount, 2);
  assert.equal(record.cpuUsagePercent, 40);
  assert.equal(record.cpus![0].usagePercent, 40);
  assert.equal(record.disks![0].readBytesPerSec, 2_048);
  assert.equal(record.diskReadBytesPerSec, 7_168);
  assert.equal(record.disks![0].physicalDevice, "/dev/synthetic-0");
  assert.equal(record.recordedDetails!.memory.usedBytes, 16 * 1024 ** 3);
  assert.deepEqual(values(series.memoryUsagePercent), [50]);
  assert.deepEqual(values(series.diskUsagePercent), [25]);
  assert.deepEqual(values(series.gpuMemoryUsagePercent), [25]);
  assert.deepEqual(values(series.gpuUsagePercent), [10.5]);
  assert.deepEqual(values(series.cpus[0].usagePercent), [40]);
  assert.deepEqual(series.disks.map((disk) => disk.id), ["disk-0", "disk-1", "disk-2"]);
  assert.deepEqual(values(series.disks[0].totalBytes), [100 * 1024 ** 3]);
  assert.deepEqual(values(series.disks[0].readBytesPerSec), [2_048]);
  assert.deepEqual([first, second], snapshot, "conversion and aggregation must not mutate caller payloads");
});

for (const state of ["direct", "derived", "unavailable", "not_applicable", "stale"] as const) {
  test(`explicit ${state} quality keeps real zero distinct from an absent observation throughout the chain`, () => {
    const payload = createHubContractPayload({
      metricQuality: Object.fromEntries(
        ["cpuUsage", "gpuUsage", "diskRead", "networkRxRate", "fanRpm"].map((key) => [key, { state }])
      )
    });
    payload.cpuUsagePercent = 0;
    for (const cpu of payload.cpuPackages!) cpu.usagePercent = 0;
    for (const gpu of payload.gpus) gpu.utilizationPercent = 0;
    payload.diskRate.readBytesPerSec = 0;
    for (const rate of Object.values(payload.diskRate.instances!)) rate.readBytesPerSec = 0;
    payload.networkRate.rxBytesPerSec = 0;
    for (const network of payload.networkInterfaces!) network.rxBytesPerSec = 0;
    for (const fan of payload.fans) fan.rpm = 0;
    const expected = state === "direct" || state === "derived" ? [0] : [];
    const record = aggregate([payload]);
    assert.equal(record.recordedDetails!.metricQuality!.cpuUsage!.state, state);
    for (const point of [payloadToTimeSeries(payload), record]) {
      const series = timeSeriesToMetricSeries([point]);
      for (const samples of [series.cpuUsagePercent, series.gpuUsagePercent, series.diskReadBytesPerSec,
        series.networkRxBytesPerSec, series.cpus[0].usagePercent, series.gpus[0].usagePercent,
        series.disks[0].readBytesPerSec, series.networks[0].rxBytesPerSec, series.fans[0].rpm]) {
        assert.deepEqual(values(samples), expected);
      }
      assert.deepEqual(values(series.memoryUsagePercent), [50], "unrelated complete metrics stay visible");
    }
  });
}

test("one missing sample conservatively gaps its whole bucket regardless of sample order", () => {
  for (const state of ["unavailable", "not_applicable", "stale", "legacy-list"] as const) {
    const present = createHubContractPayload({ metricQuality: { cpuUsage: { state: "direct" } } });
    const missing = createHubContractPayload({
      timestamp: iso(1_000),
      metricQuality: { cpuUsage: { state: state === "legacy-list" ? "direct" : state } },
      unavailableMetrics: state === "legacy-list" ? ["cpuUsage"] : undefined
    });
    present.cpuUsagePercent = 80;
    missing.cpuUsagePercent = 0;
    for (const samples of [[missing, present], [present, missing]]) {
      const record = aggregate(samples);
      assert.equal(record.cpuUsagePercent, 40, "legacy numeric storage retains its arithmetic placeholder");
      assert.ok(record.recordedDetails!.unavailableMetrics!.includes("cpuUsage"));
      if (state !== "legacy-list") {
        assert.equal(record.recordedDetails!.metricQuality!.cpuUsage!.state, state);
        assert.equal(record.recordedDetails!.metricQuality!.cpuUsage!.reason, "aggregate contains missing or expired observations");
      }
      const series = timeSeriesToMetricSeries([record]);
      assert.deepEqual(series.cpuUsagePercent, []);
      assert.deepEqual(series.cpus.map((cpu) => cpu.usagePercent), [[], []]);
      assert.deepEqual(values(series.memoryUsagePercent), [50]);
    }
  }
});

test("cumulative traffic uses the last counter, resets on rollover or a >50 MB jump, and does not become a rate", () => {
  const counters = [1_000, 1_300, 20, 220, 50_000_221, 50_000_421];
  const records = counters.map((counter, index) => {
    const samples = [counter - 10, counter].map((totalRxBytes, sampleIndex) => {
      const payload = createHubContractPayload({
        timestamp: iso(index * 60_000 + sampleIndex * 1_000), hardware: { networkInterfaces: 1 }
      });
      Object.assign(payload.networkInterfaces![0], { totalRxBytes, totalTxBytes: totalRxBytes, rxBytesPerSec: 100 + sampleIndex * 200 });
      payload.networkRate = { totalRxBytes, totalTxBytes: totalRxBytes, rxBytesPerSec: 100 + sampleIndex * 200, txBytesPerSec: 50 };
      return payload;
    });
    const record = aggregate(samples);
    assert.equal(record.trafficRxBytes, counter);
    assert.equal(record.networks![0].trafficRxBytes, counter);
    assert.equal(record.networkRxBytesPerSec, 200);
    return record;
  });
  const series = timeSeriesToMetricSeries(records);
  const expected = [0, 300, 0, 200, 0, 200];
  assert.deepEqual(values(series.trafficRxBytes), expected);
  assert.deepEqual(values(series.trafficTxBytes), expected);
  assert.deepEqual(values(series.networks[0].trafficRxBytes), expected);
  assert.deepEqual(values(series.networks[0].trafficTxBytes), expected);
  assert.deepEqual(values(series.networks[0].rxBytesPerSec), counters.map(() => 200));
});

test("absent NICs contribute idle zero, not another interface's traffic or a smaller averaging denominator", () => {
  const first = createHubContractPayload();
  const second = createHubContractPayload({ timestamp: iso(1_000) });
  second.networkInterfaces = second.networkInterfaces!.slice(0, 1);
  const record = aggregate([first, second]);
  assert.equal(record.networks![1].rxBytesPerSec, 2_048);
  assert.equal(record.networks![1].txBytesPerSec, 1_024);
  assert.equal(record.networks![1].trafficRxBytes, 2_000_000);
  const raw = timeSeriesToMetricSeries([payloadToTimeSeries(first), payloadToTimeSeries(second)]);
  assert.deepEqual(values(raw.networks[0].rxBytesPerSec), [2_048, 2_048]);
  assert.deepEqual(values(raw.networks[1].rxBytesPerSec), [4_096, 0]);
  assert.deepEqual(values(timeSeriesToMetricSeries([record]).networks[1].rxBytesPerSec), [2_048]);
});

test("slow CPU/GPU/fan/sensor observations are deduplicated by observation time, not heartbeat count", () => {
  const payloads = [0, 1_000, 2_000, 30_000].map((offset, index) => {
    const payload = createHubContractPayload({ timestamp: iso(offset), hardware: { cpuPackages: 1, gpus: 1, fans: 1, temperatureSensors: 1 } });
    const next = index === 3;
    const observation = next ? 30_000 : 0;
    payload.hardwareSampledAt = iso(observation + 123);
    payload.cpuTemperatureSampledAt = iso(observation + 456);
    payload.cpuTemperatureC = next ? 60 : 40;
    payload.cpuPackages![0].temperatureC = payload.cpuTemperatureC;
    payload.gpus[0].temperatureC = next ? 80 : 60;
    payload.fans[0].rpm = next ? 1_000 : 0;
    Object.assign(payload.temperatureSensors![0], { currentC: next ? 55 : 35, observedAt: iso(observation + 789) });
    return payload;
  });
  const points = payloads.map((payload) => payloadToTimeSeries(payload));
  const raw = timeSeriesToMetricSeries(points);
  assert.deepEqual(raw.cpuTemperatureC, [{ timestamp: iso(456), value: 40 }, { timestamp: iso(30_456), value: 60 }]);
  assert.deepEqual(raw.cpus[0].temperatureC, raw.cpuTemperatureC);
  assert.deepEqual(raw.gpuTemperatureC, [{ timestamp: iso(123), value: 60 }, { timestamp: iso(30_123), value: 80 }]);
  assert.deepEqual(raw.gpus[0].temperatureC, raw.gpuTemperatureC);
  assert.deepEqual(raw.fans[0].rpm, [{ timestamp: iso(123), value: 0 }, { timestamp: iso(30_123), value: 1_000 }]);
  assert.deepEqual(raw.temperatureSensors[0].currentC, [{ timestamp: iso(789), value: 35 }, { timestamp: iso(30_789), value: 55 }]);
  const record = averageRecord(points);
  assert.equal(record.cpuTemperatureC, 50);
  assert.equal(record.gpuTemperatureC, 70);
  assert.equal(record.cpus[0].temperatureC, 50);
  assert.equal(record.gpus[0].temperatureC, 70);
  assert.equal(record.fans[0].rpm, 500);
  assert.equal(record.recordedDetails!.temperatureSensors![0].currentC, 45);
  const series = timeSeriesToMetricSeries([record]);
  assert.deepEqual(series.cpuTemperatureC, [{ timestamp: iso(30_456), value: 50 }]);
  assert.deepEqual(series.gpus[0].temperatureC, [{ timestamp: iso(30_123), value: 70 }]);
  assert.deepEqual(series.fans[0].rpm, [{ timestamp: iso(30_123), value: 500 }]);
  assert.deepEqual(series.temperatureSensors[0].currentC, [{ timestamp: iso(30_789), value: 45 }]);
});

test("missing temperatures and disabled/unavailable fans remain gaps after averaging, but observed zero RPM survives", () => {
  for (const rpmStatus of ["observed", "disabled", "unavailable"] as const) {
    const payload = createHubContractPayload({ hardware: { cpuPackages: 1, gpus: 1, fans: 1, temperatureSensors: 1 } });
    payload.cpuTemperatureC = null;
    payload.cpuPackages![0].temperatureC = null;
    payload.gpus[0].temperatureC = null;
    Object.assign(payload.temperatureSensors![0], { currentC: null, status: "unavailable" });
    Object.assign(payload.fans[0], { rpm: 0, rpmStatus });
    const series = timeSeriesToMetricSeries([aggregate([payload])]);
    assert.deepEqual(series.cpuTemperatureC, []);
    assert.deepEqual(series.gpuTemperatureC, []);
    assert.deepEqual(series.cpus[0].temperatureC, []);
    assert.deepEqual(series.gpus[0].temperatureC, []);
    assert.deepEqual(series.temperatureSensors[0].currentC, []);
    assert.deepEqual(values(series.fans[0].rpm), rpmStatus === "observed" ? [0] : []);
  }
});

test("old payloads without optional clocks, instances or quality retain legacy numeric zero and heartbeat timestamps", (t) => {
  t.mock.method(Date, "now", () => epoch);
  const payload = createHubContractPayload();
  delete payload.hardwareSampledAt;
  delete payload.cpuTemperatureSampledAt;
  delete payload.cpuPackages;
  delete payload.disks;
  delete payload.networkInterfaces;
  delete payload.temperatureSensors;
  delete payload.metricQuality;
  delete payload.unavailableMetrics;
  payload.gpus = [];
  payload.fans = [];
  payload.cpuUsagePercent = 0;
  payload.cpuTemperatureC = null;
  assert.deepEqual(agentMetricsPayloadSchema.parse(payload), payload);
  const series = timeSeriesToMetricSeries([aggregate([payload])]);
  assert.deepEqual(series.cpuUsagePercent, [{ timestamp: HUB_CONTRACT_TIMESTAMP, value: 0 }]);
  assert.deepEqual(values(series.gpuUsagePercent), [0]);
  assert.deepEqual(series.cpuTemperatureC, []);
  assert.deepEqual([series.cpus, series.disks, series.networks, series.gpus, series.fans, series.temperatureSensors], [[], [], [], [], [], []]);
});

test("old history rows reconstruct instances from recorded details and tolerate pre-capacity scalar shapes", () => {
  const record: TimeSeriesRecord = payloadToTimeSeries(createHubContractPayload());
  delete record.cpus;
  delete record.disks;
  delete record.networks;
  delete record.gpus;
  delete record.fans;
  const recovered = timeSeriesToMetricSeries([record]);
  assert.deepEqual(values(recovered.cpus[0].usagePercent), [20]);
  assert.deepEqual(values(recovered.disks[0].readBytesPerSec), [1_024]);
  assert.deepEqual(values(recovered.networks[1].rxBytesPerSec), [4_096]);
  assert.deepEqual(values(recovered.gpus[0].usagePercent), [10]);
  assert.deepEqual(values(recovered.fans[0].rpm), [0]);
  const oldScalars = { ...record } as Partial<TimeSeriesRecord>;
  delete oldScalars.recordedDetails;
  delete oldScalars.memoryUsedBytes;
  delete oldScalars.swapUsedBytes;
  delete oldScalars.diskUsedBytes;
  // Deliberately emulate persisted JSON written before those required TS fields
  // existed; ordinary fixture callers always receive the current valid shape.
  const oldSeries = timeSeriesToMetricSeries([oldScalars as TimeSeriesRecord]);
  assert.deepEqual(values(oldSeries.memoryUsedBytes), [0]);
  assert.deepEqual(values(oldSeries.swapUsedBytes), [0]);
  assert.deepEqual(values(oldSeries.diskUsedBytes), [0]);
  assert.equal(JSON.stringify(oldSeries).includes("null"), false);
});

test("a stale hardware heartbeat cannot erase an earlier direct observation at the same sensor timestamp", () => {
  const present = createHubContractPayload({ metricQuality: { cpuTemperature: { state: "direct", observedAt: HUB_CONTRACT_TIMESTAMP } } });
  const stale = structuredClone(present);
  stale.timestamp = iso(1_000);
  stale.metricQuality!.cpuTemperature = { state: "stale", observedAt: HUB_CONTRACT_TIMESTAMP } satisfies MetricQuality;
  const series = timeSeriesToMetricSeries([payloadToTimeSeries(present), payloadToTimeSeries(stale)]);
  assert.deepEqual(series.cpuTemperatureC, [{ timestamp: HUB_CONTRACT_TIMESTAMP, value: 40.5 }]);
  assert.deepEqual(series.cpus[0].temperatureC, [{ timestamp: HUB_CONTRACT_TIMESTAMP, value: 40 }]);
  assert.deepEqual(timeSeriesToMetricSeries([aggregate([present, stale])]).cpuTemperatureC, []);
});
