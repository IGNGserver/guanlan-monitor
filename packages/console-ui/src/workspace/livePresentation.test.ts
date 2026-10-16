import test from "node:test";
import assert from "node:assert/strict";
import { acceptsLiveSnapshot, containerRates, describeLiveError, isDisconnectedLiveError, isTransientLiveError, liveErrorCode, liveErrorMessage, liveStatus } from "./livePresentation.ts";
import type { LiveContainer, LiveDocker, LiveSnapshot } from "@dsc/shared";

test("live view refuses an answer for another device, topic or without a session", () => {
  const result: LiveSnapshot = { deviceId: "node", sessionId: "current", requestId: "request", receivedAt: new Date().toISOString(), topic: "processes", data: { observedAt: new Date().toISOString(), cpuScale: "host", memoryKind: "rss", totalCount: 0, truncated: false, items: [] } };
  assert.equal(acceptsLiveSnapshot(result, "node", "processes"), true);
  assert.equal(acceptsLiveSnapshot(result, "other", "processes"), false);
  assert.equal(acceptsLiveSnapshot(result, "node", "docker"), false);
  assert.equal(acceptsLiveSnapshot({ ...result, sessionId: "" }, "node", "processes"), false);
});

test("error codes are read from Hub, IPC and API error shapes and classified", () => {
  assert.equal(liveErrorCode(new Error("Error invoking remote method 'dsc:read-live': Error: hub_504:device_ack_timeout")), "device_ack_timeout");
  assert.equal(liveErrorCode(new Error("api_error:502")), null);
  assert.equal(isTransientLiveError(new Error("collection_busy")), true);
  assert.equal(isTransientLiveError(new Error("hub_502:invalid_result")), true);
  assert.equal(isTransientLiveError(new Error("docker_permission_denied")), false, "a permission change must not keep showing old containers");
  assert.equal(isTransientLiveError(new Error("device_disconnected")), false);
  assert.equal(isDisconnectedLiveError(new Error("hub_503:device_not_connected")), true);
  assert.equal(isDisconnectedLiveError(new Error("query_expired")), false);
  assert.match(liveErrorMessage(new Error("live_view_hidden")), /窗口隐藏/);
});

test("container rates come from consecutive snapshots of one Engine and never go negative", () => {
  const container = (patch: Partial<LiveContainer>): LiveContainer => ({ id: "c1", name: "c1", image: "i", state: "running", status: "Up", project: null, cpuPercent: null, memoryBytes: null, memoryLimitBytes: null, networkRxBytes: 1000, networkTxBytes: 500, blockReadBytes: null, blockWriteBytes: 0, ...patch });
  const snapshot = (at: string, items: LiveContainer[], engineId = "engine"): LiveDocker => ({ observedAt: at, engineId, totalCount: items.length, truncated: false, items });
  const first = snapshot("2026-10-16T00:00:00.000Z", [container({})]);
  assert.equal(containerRates(null, first).get("c1")?.networkRx, null, "the first snapshot has no rate");
  const second = snapshot("2026-10-16T00:00:02.000Z", [container({ networkRxBytes: 3000, networkTxBytes: 100, blockWriteBytes: 4096 })]);
  const rates = containerRates(first, second).get("c1");
  assert.equal(rates?.networkRx, 1000);
  assert.equal(rates?.networkTx, null, "a counter that went backwards (restart) is not a negative rate");
  assert.equal(rates?.blockRead, null);
  assert.equal(rates?.blockWrite, 2048);
  assert.equal(containerRates(first, { ...second, engineId: "other" }).get("c1")?.networkRx, null, "rates never cross Engines");
});

test("unavailable Docker is not presented as an empty container list", () => {
  assert.match(liveErrorMessage(new Error("hub_502:docker_permission_denied")), /不代表没有容器/);
  assert.match(liveErrorMessage(new Error("device_ack_timeout")), /未确认收到/);
  assert.match(liveErrorMessage(new Error("device_response_timeout")), /已接收/);
});

test("every failure has a short title and keeps the sentence that says what it does not mean", () => {
  const denied = describeLiveError(new Error("hub_502:docker_permission_denied"));
  assert.equal(denied.title, "没有 Docker 读取权限");
  assert.match(denied.detail, /不代表没有容器/);
  assert.equal(denied.transient, false);
  assert.equal(describeLiveError(new Error("collection_busy")).transient, true);
  const unknown = describeLiveError(new Error("api_error:500"));
  assert.equal(unknown.title, "查询未完成");
  assert.match(unknown.detail, /不会用历史缓存替代/);
});

test("the status pill only claims live for a confirmed, unexpired result", () => {
  const busy = describeLiveError(new Error("collection_busy"));
  const gone = describeLiveError(new Error("device_not_connected"));
  assert.deepEqual(liveStatus({ paused: false, hasResult: false, expired: false, failure: null, ageSeconds: 0 }), { tone: "connecting", label: "正在连接设备" });
  assert.deepEqual(liveStatus({ paused: false, hasResult: true, expired: false, failure: null, ageSeconds: 0 }), { tone: "live", label: "实时 · 刚刚" });
  assert.deepEqual(liveStatus({ paused: false, hasResult: true, expired: false, failure: null, ageSeconds: 4 }), { tone: "live", label: "实时 · 4 秒前" });
  assert.deepEqual(liveStatus({ paused: false, hasResult: true, expired: false, failure: busy, ageSeconds: 3 }), { tone: "stale", label: "设备繁忙 · 显示 3 秒前的结果" });
  assert.equal(liveStatus({ paused: false, hasResult: true, expired: true, failure: null, ageSeconds: 9 }).tone, "stale", "an expired result is never live");
  assert.deepEqual(liveStatus({ paused: false, hasResult: false, expired: false, failure: gone, ageSeconds: 0 }), { tone: "unavailable", label: "设备未连接" });
  assert.equal(liveStatus({ paused: true, hasResult: true, expired: false, failure: null, ageSeconds: 30 }).tone, "paused", "pausing wins over every other state");
});
