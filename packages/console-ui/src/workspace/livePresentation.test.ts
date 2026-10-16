import test from "node:test";
import assert from "node:assert/strict";
import { acceptsLiveSnapshot, containerRates, isDisconnectedLiveError, isTransientLiveError, liveErrorCode, liveErrorMessage, percentPath } from "./livePresentation.ts";
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

test("live curves preserve observed zero and gaps without joining across missing samples", () => {
  const path = percentPath([{ at: 1000, value: 0 }, { at: 2000, value: null }, { at: 3000, value: 10 }, { at: 4000, value: 20 }], 120000);
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.equal((path.match(/L/g) ?? []).length, 1);
  assert.ok(path.includes(",80.0"));
  assert.equal(percentPath([{ at: 0, value: 100 }], 121000), "");
});
