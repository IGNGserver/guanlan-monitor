import type { LiveDocker, LiveSnapshot, LiveTopic } from "@dsc/shared";

/**
 * Every failure has a short title for the status pill and banner heading, and
 * the sentence that says what it does and does not mean. The title alone must
 * never read as "empty": a denied Docker socket is not a host without containers.
 */
const messages: Record<string, { title: string; detail: string }> = {
  device_not_connected: { title: "设备未连接", detail: "设备没有可用的实时连接；历史在线状态不会用于下发请求。" },
  device_disconnected: { title: "连接已断开", detail: "设备连接已断开，本次查询未完成。" },
  device_ack_timeout: { title: "设备没有响应", detail: "设备未确认收到请求，不能确认目标可达。" },
  device_response_timeout: { title: "设备响应超时", detail: "设备已接收请求，但未在时限内返回采集结果。" },
  device_capability_unavailable: { title: "设备端不支持", detail: "当前 Agent 不支持这项能力，请升级设备端。" },
  docker_unavailable: { title: "无法访问 Docker", detail: "当前 Agent 无法访问 Docker；请检查是否安装、启动，以及服务账户的 Docker 环境。" },
  docker_permission_denied: { title: "没有 Docker 读取权限", detail: "Agent 没有读取 Docker 的权限，不代表没有容器。" },
  collection_busy: { title: "设备繁忙", detail: "设备正在采集上一批数据，稍后重试。" },
  collection_disabled: { title: "设备已关闭采集", detail: "设备已关闭采集或云同步。" },
  collection_failed: { title: "采集失败", detail: "设备采集失败，不能将失败当作空列表。" },
  query_expired: { title: "本次查询超时", detail: "本次采集已超时；过期结果不会补发。" },
  invalid_result: { title: "结果未通过校验", detail: "设备返回的数据未通过校验（可能是设备端与中枢版本不一致），本次结果已丢弃。" },
  live_query_capacity_exceeded: { title: "中枢繁忙", detail: "中枢实时查询已达到并发上限。" },
  live_agent_upgrade_required: { title: "需要升级客户端", detail: "当前桌面桥接不支持实时查看，请升级客户端。" },
  live_view_hidden: { title: "已暂停", detail: "窗口隐藏时暂停实时查询，回到窗口后自动继续。" },
  live_session_required: { title: "需要登录中枢", detail: "请先连接并登录中枢，离线缓存不能提供实时能力。" },
  hub_login_required: { title: "需要登录中枢", detail: "请先连接并登录中枢，离线缓存不能提供实时能力。" },
  request_timeout: { title: "中枢响应超时", detail: "中枢没有在时限内响应本次查询。" }
};
const unknownFailure = { title: "查询未完成", detail: "实时查询未完成，请检查中枢连接和登录状态；这里不会用历史缓存替代实时结果。" };

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

export interface LiveFailure { title: string; detail: string; transient: boolean }

export function describeLiveError(error: unknown): LiveFailure {
  const code = liveErrorCode(error);
  return { ...(code ? messages[code] : unknownFailure), transient: code !== null && transientCodes.has(code) };
}

export function liveErrorMessage(error: unknown): string {
  return describeLiveError(error).detail;
}

export type LiveStatusTone = "connecting" | "live" | "stale" | "paused" | "unavailable";

/**
 * The one line that says whether what is on screen is current. It is derived
 * here, not in the view, so "live" can only be claimed for a confirmed result
 * that has not expired.
 */
export function liveStatus({ paused, hasResult, expired, failure, ageSeconds }: { paused: boolean; hasResult: boolean; expired: boolean; failure: LiveFailure | null; ageSeconds: number }): { tone: LiveStatusTone; label: string } {
  if (paused) return { tone: "paused", label: "已暂停" };
  const age = ageSeconds <= 1 ? "刚刚" : `${ageSeconds} 秒前`;
  if (hasResult && !expired) return failure ? { tone: "stale", label: `${failure.title} · 显示${ageSeconds <= 1 ? "刚才" : ` ${ageSeconds} 秒前`}的结果` } : { tone: "live", label: `实时 · ${age}` };
  if (failure) return { tone: "unavailable", label: failure.title };
  if (expired) return { tone: "stale", label: "结果已过期，等待设备确认" };
  return { tone: "connecting", label: "正在连接设备" };
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
