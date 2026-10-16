import type { LiveDocker, LiveSnapshot, LiveTopic } from "@dsc/shared";

const messages: Record<string, string> = {
  device_not_connected: "设备没有可用的实时连接；历史在线状态不会用于下发请求。",
  device_disconnected: "设备连接已断开，本次查询未完成。",
  device_ack_timeout: "设备未确认收到请求，不能确认目标可达。",
  device_response_timeout: "设备已接收请求，但未在时限内返回采集结果。",
  device_capability_unavailable: "当前 Agent 不支持这项能力，请升级设备端。",
  docker_unavailable: "当前 Agent 无法访问 Docker；请检查是否安装、启动，以及服务账户的 Docker 环境。",
  docker_permission_denied: "Agent 没有读取 Docker 的权限，不代表没有容器。",
  collection_busy: "设备正在采集上一批数据，稍后重试。",
  collection_disabled: "设备已关闭采集或云同步。",
  collection_failed: "设备采集失败，不能将失败当作空列表。",
  query_expired: "本次采集已超时；过期结果不会补发。",
  invalid_result: "设备返回的数据未通过校验（可能是设备端与中枢版本不一致），本次结果已丢弃。",
  live_query_capacity_exceeded: "中枢实时查询已达到并发上限。",
  live_agent_upgrade_required: "当前桌面桥接不支持实时查看，请升级客户端。",
  live_view_hidden: "窗口隐藏时暂停实时查询，回到窗口后自动继续。",
  live_session_required: "请先连接并登录中枢，离线缓存不能提供实时能力。",
  hub_login_required: "请先连接并登录中枢，离线缓存不能提供实时能力。",
  request_timeout: "中枢没有在时限内响应本次查询。"
};

/** Failures after which the last result may stay on screen, marked stale, until it expires. */
const transientCodes = new Set(["collection_busy", "query_expired", "device_response_timeout", "invalid_result", "live_query_capacity_exceeded", "request_timeout"]);
/** Failures meaning there is no usable channel: poll the connection, not the device. */
const disconnectedCodes = new Set(["device_not_connected", "device_disconnected", "device_capability_unavailable"]);

export function liveErrorCode(error: unknown): string | null {
  const text = error instanceof Error ? error.message : "";
  return text.match(/[a-z]+(?:_[a-z]+)+/g)?.find((code) => code in messages) ?? null;
}

export function isTransientLiveError(error: unknown): boolean {
  const code = liveErrorCode(error);
  return code !== null && transientCodes.has(code);
}

export function isDisconnectedLiveError(error: unknown): boolean {
  const code = liveErrorCode(error);
  return code !== null && disconnectedCodes.has(code);
}

export function liveErrorMessage(error: unknown): string {
  const code = liveErrorCode(error);
  return code ? messages[code] : "实时查询未完成，请检查中枢连接和登录状态；这里不会用历史缓存替代实时结果。";
}

/** The Hub only answers from a ready session; the view still refuses an answer for another device or topic. */
export function acceptsLiveSnapshot(result: LiveSnapshot, deviceId: string, topic: LiveTopic): boolean {
  return result.deviceId === deviceId && result.topic === topic && typeof result.sessionId === "string" && result.sessionId.length > 0;
}

export interface ContainerRates { networkRx: number | null; networkTx: number | null; blockRead: number | null; blockWrite: number | null }

/**
 * Per-second rates between two Docker snapshots of the same Engine. Counters
 * that are missing or went backwards (container restarted) stay null.
 */
export function containerRates(previous: LiveDocker | null, current: LiveDocker): Map<string, ContainerRates> {
  const result = new Map<string, ContainerRates>();
  const seconds = previous ? (Date.parse(current.observedAt) - Date.parse(previous.observedAt)) / 1000 : 0;
  const before = new Map(previous && previous.engineId === current.engineId && seconds > 0 ? previous.items.map((item) => [item.id, item]) : []);
  const rate = (from: number | null | undefined, to: number | null) => from === null || from === undefined || to === null || to < from ? null : (to - from) / seconds;
  for (const item of current.items) {
    const old = before.get(item.id);
    result.set(item.id, {
      networkRx: rate(old?.networkRxBytes, item.networkRxBytes), networkTx: rate(old?.networkTxBytes, item.networkTxBytes),
      blockRead: rate(old?.blockReadBytes, item.blockReadBytes), blockWrite: rate(old?.blockWriteBytes, item.blockWriteBytes)
    });
  }
  return result;
}

export function percentPath(points: Array<{ at: number; value: number | null }>, end: number): string {
  let connected = false;
  return points.filter((point) => point.at >= end - 120_000).map((point) => {
    if (point.value === null || !Number.isFinite(point.value)) { connected = false; return ""; }
    const x = Math.max(0, Math.min(600, (point.at - (end - 120_000)) / 200));
    const y = 80 - Math.max(0, Math.min(100, point.value)) * 0.8;
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}
