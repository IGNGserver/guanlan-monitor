import test from "node:test";
import assert from "node:assert/strict";
import { acceptsLiveSnapshot, liveErrorMessage, percentPath } from "./livePresentation.ts";
import type { LiveConnection, LiveSnapshot } from "@dsc/shared";

test("live view refuses mismatched device, topic and reconnected session", () => {
  const connection: LiveConnection = { state: "ready", sessionId: "current", capabilities: ["processes"], connectedAt: null };
  const result: LiveSnapshot = { deviceId: "node", sessionId: "current", requestId: "request", receivedAt: new Date().toISOString(), topic: "processes", data: { observedAt: new Date().toISOString(), cpuScale: "host", memoryKind: "rss", totalCount: 0, truncated: false, items: [] } };
  assert.equal(acceptsLiveSnapshot(connection, result, "node", "processes"), true);
  assert.equal(acceptsLiveSnapshot(connection, result, "other", "processes"), false);
  assert.equal(acceptsLiveSnapshot(connection, result, "node", "docker"), false);
  assert.equal(acceptsLiveSnapshot({ ...connection, sessionId: "replacement" }, result, "node", "processes"), false);
  assert.equal(acceptsLiveSnapshot({ ...connection, state: "disconnected" }, result, "node", "processes"), false);
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
