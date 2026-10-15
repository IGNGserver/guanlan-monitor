import type { LiveConnection, LiveSnapshot, LiveTopic } from "@dsc/shared";

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
  live_query_capacity_exceeded: "中枢实时查询已达到并发上限。",
  live_agent_upgrade_required: "当前桌面桥接不支持实时查看，请升级客户端。"
};

export function liveErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  for (const [code, message] of Object.entries(messages)) if (text.includes(code)) return message;
  return "实时查询未完成，请检查中枢连接和登录状态；这里不会用历史缓存替代实时结果。";
}

export function acceptsLiveSnapshot(connection: LiveConnection, result: LiveSnapshot, deviceId: string, topic: LiveTopic): boolean {
  return connection.state === "ready" && connection.sessionId === result.sessionId && result.deviceId === deviceId && result.topic === topic;
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
