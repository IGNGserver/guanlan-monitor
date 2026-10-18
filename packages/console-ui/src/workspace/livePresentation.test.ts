import test from "node:test";
import assert from "node:assert/strict";
import { acceptsLiveSnapshot, containerHealth, containerRates, containerStateLabel, describeLiveError, groupContainers, holdOrder, sortProcesses, isDisconnectedLiveError, isTransientLiveError, liveErrorCode, liveErrorMessage, liveStatus } from "./livePresentation.ts";
import type { LiveContainer, LiveDocker, LiveProcess, LiveSnapshot } from "@dsc/shared";

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

test("containers are read as fine, needing attention, or not running", () => {
  assert.equal(containerHealth({ state: "running", status: "Up 3 days (healthy)" }), "running");
  assert.equal(containerHealth({ state: "running", status: "Up 3 days (unhealthy)" }), "problem", "unhealthy is running but is what the reader came for");
  assert.equal(containerHealth({ state: "restarting", status: "Restarting (1) 5 seconds ago" }), "problem");
  assert.equal(containerHealth({ state: "exited", status: "Exited (0) 2 days ago" }), "stopped");
  assert.equal(containerStateLabel({ state: "running", status: "Up (unhealthy)" }), "不健康");
  assert.equal(containerStateLabel({ state: "exited", status: "Exited (0)" }), "已停止");
  assert.equal(containerStateLabel({ state: "weird", status: "" }), "weird", "an unknown Engine state is shown as reported");
});

test("containers group by Compose project with totals of what was read", () => {
  const container = (id: string, project: string | null, cpuPercent: number | null, memoryBytes: number | null): LiveContainer => ({ id, name: id, image: "i", state: "running", status: "Up", project, cpuPercent, memoryBytes, memoryLimitBytes: null, networkRxBytes: null, networkTxBytes: null, blockReadBytes: null, blockWriteBytes: null });
  const groups = groupContainers([container("a", null, 1, 10), container("b", "web", 2, null), container("c", "app", null, null), container("d", "web", 3, 5)]);
  assert.deepEqual(groups.map((group) => group.project), ["app", "web", null], "named projects first, unassigned last");
  assert.equal(groups[0].cpuPercent, null, "nothing read is not zero");
  assert.equal(groups[1].cpuPercent, 5);
  assert.equal(groups[1].memoryBytes, 5);
});

test("process sorting keeps unknown values last and ties stable", () => {
  const process = (pid: number, cpuPercent: number | null, gpuPercent: number | null = null, diskRead: number | null = null, diskWrite: number | null = null): LiveProcess => ({ id: String(pid), pid, parentPid: null, name: `p${pid}`, startedAt: null, cpuPercent, gpuPercent, memoryBytes: null, threads: null, status: null, diskReadBytesPerSec: diskRead, diskWriteBytesPerSec: diskWrite });
  const items = [process(3, null), process(1, 5), process(2, 9), process(4, 5)];
  assert.deepEqual(sortProcesses(items, "cpu", true).map((item) => item.pid), [2, 1, 4, 3]);
  assert.deepEqual(sortProcesses(items, "cpu", false).map((item) => item.pid), [1, 4, 2, 3], "missing CPU is not the smallest");
  assert.deepEqual(sortProcesses(items, "pid", false).map((item) => item.pid), [1, 2, 3, 4]);
  assert.deepEqual(sortProcesses([process(1, null, null), process(2, null, 60), process(3, null, 10)], "gpu", true).map((item) => item.pid), [2, 3, 1]);
  // Disk sorts by read + write; a process with neither direction read is unknown, not idle.
  assert.deepEqual(sortProcesses([process(1, null, null), process(2, null, null, 100, null), process(3, null, null, 0, 0), process(4, null, null, 50, 80)], "disk", true).map((item) => item.pid), [4, 2, 3, 1]);
});

test("a held order keeps positions, appends newcomers and drops what left", () => {
  assert.deepEqual(holdOrder(["a", "b", "c"], ["c", "d", "a"]), ["a", "c", "d"]);
  assert.deepEqual(holdOrder([], ["x", "y"]), ["x", "y"]);
});
