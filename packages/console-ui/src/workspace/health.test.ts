import assert from "node:assert/strict";
import test from "node:test";
import type { DeviceSummary } from "@dsc/shared";
import { DEFAULT_HEALTH_THRESHOLDS, describeIssue, devicesNeedingAttention, evaluateDevice, evaluateFleet, metricSeverity, parseThresholds } from "./health.ts";

function device(overrides: Partial<DeviceSummary>): DeviceSummary {
  return {
    deviceId: "d", hostname: "host", os: "linux", agentVersion: null, agentChannel: null, status: "online",
    lastSeenAt: "2026-10-04T00:00:00.000Z", cpuUsagePercent: 10, gpuUsagePercent: null, gpuMemoryUsagePercent: null,
    memoryUsagePercent: 20, diskUsagePercent: 30, ...overrides
  };
}

test("a busy, healthy-looking online machine is no longer invisible", () => {
  const issues = evaluateDevice(device({ diskUsagePercent: 97, cpuUsagePercent: 92 }));
  assert.deepEqual(issues.map((issue) => [issue.kind, issue.severity, issue.threshold]), [["cpu", "warning", 90], ["disk", "critical", 95]]);
});

test("an offline machine reports only that it is offline", () => {
  const issues = evaluateDevice(device({ status: "offline", diskUsagePercent: 99 }));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "offline");
  assert.equal(issues[0].severity, "critical");
});

test("metrics the device marks unavailable are never judged", () => {
  assert.deepEqual(evaluateDevice(device({ diskUsagePercent: 99, unavailableMetrics: ["diskUsage"] })), []);
  assert.deepEqual(evaluateDevice(device({ cpuUsagePercent: null })), []);
});

test("thresholds are inclusive and severity escalates", () => {
  assert.equal(metricSeverity(84.9, DEFAULT_HEALTH_THRESHOLDS.disk), null);
  assert.equal(metricSeverity(85, DEFAULT_HEALTH_THRESHOLDS.disk), "warning");
  assert.equal(metricSeverity(95, DEFAULT_HEALTH_THRESHOLDS.disk), "critical");
});

test("the fleet list puts the most urgent first and names each device once", () => {
  const issues = evaluateFleet([
    device({ deviceId: "a", hostname: "warn", diskUsagePercent: 86 }),
    device({ deviceId: "b", hostname: "far", memoryUsagePercent: 99 }),
    device({ deviceId: "c", hostname: "down", status: "offline" }),
    device({ deviceId: "d", hostname: "near", cpuUsagePercent: 98 })
  ]);
  // "far" is 2 points past its critical line, "near" exactly on it.
  assert.deepEqual(issues.map((issue) => issue.hostname), ["down", "far", "near", "warn"]);
  assert.deepEqual(devicesNeedingAttention(issues), ["c", "b", "d", "a"]);
});

test("each issue reads as one sentence with its threshold", () => {
  const [disk] = evaluateDevice(device({ diskUsagePercent: 96.4 }));
  assert.equal(describeIssue(disk, () => ""), "磁盘 96%，超过严重阈值 95%");
  const [offline] = evaluateDevice(device({ status: "offline" }));
  assert.equal(describeIssue(offline, () => "10月4日"), "离线 · 最后在线 10月4日");
});

test("stored thresholds are validated per metric", () => {
  const parsed = parseThresholds(JSON.stringify({ disk: { warning: 70, critical: 90 }, cpu: { warning: 99, critical: 50 }, gpu: "nope" }));
  assert.deepEqual(parsed.disk, { warning: 70, critical: 90 });
  assert.deepEqual(parsed.cpu, DEFAULT_HEALTH_THRESHOLDS.cpu, "warning must stay below critical");
  assert.deepEqual(parsed.gpu, DEFAULT_HEALTH_THRESHOLDS.gpu);
  assert.deepEqual(parseThresholds("{broken"), DEFAULT_HEALTH_THRESHOLDS);
});
