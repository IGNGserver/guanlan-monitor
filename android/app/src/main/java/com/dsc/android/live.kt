package com.dsc.android

import java.time.Instant

/**
 * 实时查看的呈现规则（纯函数）。与 Web / 桌面端 packages/console-ui/src/workspace/livePresentation.ts
 * 保持同一套语义：每种失败都有一句「它意味着什么、不意味着什么」，例如
 * 读不到 Docker 权限 ≠ 没有容器；「实时」只能用于已确认且未过期的结果。
 */
private data class LiveMessage(val title: String, val detail: String)

private val liveMessages: Map<String, LiveMessage> = mapOf(
  "device_not_connected" to LiveMessage("设备未连接", "设备没有可用的实时连接；历史在线状态不会用于下发请求。"),
  "device_disconnected" to LiveMessage("连接已断开", "设备连接已断开，本次查询未完成。"),
  "device_ack_timeout" to LiveMessage("设备没有响应", "设备未确认收到请求，不能确认目标可达。"),
  "device_response_timeout" to LiveMessage("设备响应超时", "设备已接收请求，但未在时限内返回采集结果。"),
  "device_capability_unavailable" to LiveMessage("设备端不支持", "当前 Agent 不支持这项能力，请升级设备端。"),
  "docker_unavailable" to LiveMessage("无法访问 Docker", "当前 Agent 无法访问 Docker；请检查是否安装、启动，以及服务账户的 Docker 环境。"),
  "docker_permission_denied" to LiveMessage("没有 Docker 读取权限", "Agent 没有读取 Docker 的权限，不代表没有容器。"),
  "collection_busy" to LiveMessage("设备繁忙", "设备正在采集上一批数据，稍后重试。"),
  "collection_disabled" to LiveMessage("设备已关闭采集", "设备已关闭采集或云同步。"),
  "collection_failed" to LiveMessage("采集失败", "设备采集失败，不能将失败当作空列表。"),
  "query_expired" to LiveMessage("本次查询超时", "本次采集已超时；过期结果不会补发。"),
  "invalid_result" to LiveMessage("结果未通过校验", "设备返回的数据未通过校验（可能是设备端与中枢版本不一致），本次结果已丢弃。"),
  "live_query_capacity_exceeded" to LiveMessage("中枢繁忙", "中枢实时查询已达到并发上限。"),
  "live_hub_upgrade_required" to LiveMessage("中枢版本过旧", "当前中枢没有实时查询接口，请先升级中枢。"),
  "hub_login_required" to LiveMessage("需要登录中枢", "请先连接并登录中枢，离线缓存不能提供实时能力。"),
  "request_timeout" to LiveMessage("中枢响应超时", "中枢没有在时限内响应本次查询。"),
  "hub_shutting_down" to LiveMessage("中枢正在重启", "中枢正在关闭或重启，稍后会自动恢复。")
)

private val unknownLiveFailure = LiveMessage("查询未完成", "实时查询未完成，请检查中枢连接和登录状态；这里不会用历史缓存替代实时结果。")

/** 这些失败之后，上一次结果可以带着「未更新」标记留在屏上，直到过期。 */
internal val transientLiveCodes = setOf(
  "collection_busy", "query_expired", "device_response_timeout", "invalid_result", "live_query_capacity_exceeded", "request_timeout"
)

/** 这些失败表示没有可用通道：接下来轮询连接状态，而不是继续向设备发查询。 */
internal val disconnectedLiveCodes = setOf("device_not_connected", "device_disconnected", "device_capability_unavailable")

fun describeLiveFailure(code: String?): LiveFailure {
  val message = code?.let(liveMessages::get) ?: unknownLiveFailure
  return LiveFailure(code = code?.takeIf { it in liveMessages }, title = message.title, detail = message.detail, transient = code in transientLiveCodes)
}

/** 从中枢的错误体（{"error":"device_not_connected"}）里取错误码。 */
fun liveErrorCodeFromBody(body: String?): String? =
  body?.let { Regex(""""error"\s*:\s*"([a-z]+(?:_[a-z]+)+)"""").find(it)?.groupValues?.getOrNull(1) }

enum class LiveTone { Connecting, Live, Stale, Paused, Unavailable }

data class LiveStatus(val tone: LiveTone, val label: String)

/** 屏上数字是否「当前」的那一行。只有确认过、未过期的结果才能叫「实时」。 */
fun liveStatus(paused: Boolean, hasResult: Boolean, expired: Boolean, failure: LiveFailure?, ageSeconds: Long): LiveStatus {
  if (paused) return LiveStatus(LiveTone.Paused, "已暂停")
  val age = if (ageSeconds <= 1) "刚刚" else "$ageSeconds 秒前"
  if (hasResult && !expired) {
    return if (failure != null) {
      LiveStatus(LiveTone.Stale, "${failure.title} · 显示${if (ageSeconds <= 1) "刚才" else " $ageSeconds 秒前"}的结果")
    } else {
      LiveStatus(LiveTone.Live, "实时 · $age")
    }
  }
  if (failure != null) return LiveStatus(LiveTone.Unavailable, failure.title)
  if (expired) return LiveStatus(LiveTone.Stale, "结果已过期，等待设备确认")
  return LiveStatus(LiveTone.Connecting, "正在连接设备")
}

/** 结果超过 max(6 秒, 两个刷新周期) 没被确认，就不能再当作当前值。 */
fun liveExpired(lastConfirmedMillis: Long, nowMillis: Long, intervalSeconds: Int, paused: Boolean): Boolean =
  !paused && lastConfirmedMillis > 0 && nowMillis - lastConfirmedMillis > maxOf(6_000L, intervalSeconds * 2_000L)

fun acceptsLiveSnapshot(snapshot: LiveSnapshotDto<*>, deviceId: String, topic: LiveTopic): Boolean =
  snapshot.deviceId == deviceId && snapshot.topic == topic.value && snapshot.sessionId.isNotEmpty()

const val LIVE_WINDOW_MILLIS = 120_000L
const val LIVE_SAMPLE_LIMIT = 150

/** 追加一个实时样本：会话变了就从头画（曲线不能跨过没人观测的时间）。 */
fun appendLiveSample(previous: List<LiveSample>, sample: LiveSample, sessionChanged: Boolean): List<LiveSample> =
  ((if (sessionChanged) emptyList() else previous.filter { it.atMillis >= sample.atMillis - LIVE_WINDOW_MILLIS }) + sample)
    .takeLast(LIVE_SAMPLE_LIMIT)

fun liveSeries(samples: List<LiveSample>, pick: (LiveMetricsDto) -> Double?): List<SamplePointDto> =
  samples.mapNotNull { sample ->
    pick(sample.data)?.takeIf { it.isFinite() }?.let { SamplePointDto(Instant.ofEpochMilli(sample.atMillis).toString(), it) }
  }

fun liveMemoryPercent(data: LiveMetricsDto): Double? {
  val used = data.memoryUsedBytes ?: return null
  val total = data.memoryTotalBytes?.takeIf { it > 0 } ?: return null
  return used / total * 100.0
}

/* ---------- 容器 ---------- */

/** 同一 Engine 两次快照之间的每秒速率；计数器缺失或回退（容器重启）时为 null。 */
fun containerRates(previous: LiveDockerDto?, current: LiveDockerDto): Map<String, ContainerRates> {
  val seconds = if (previous == null) 0.0 else {
    val before = runCatching { Instant.parse(previous.observedAt).toEpochMilli() }.getOrNull()
    val after = runCatching { Instant.parse(current.observedAt).toEpochMilli() }.getOrNull()
    if (before == null || after == null) 0.0 else (after - before) / 1000.0
  }
  val old = if (previous != null && previous.engineId == current.engineId && seconds > 0) previous.items.associateBy { it.id } else emptyMap()
  fun rate(from: Double?, to: Double?): Double? = if (from == null || to == null || to < from) null else (to - from) / seconds
  return current.items.associate { item ->
    val before = old[item.id]
    item.id to ContainerRates(
      networkRx = rate(before?.networkRxBytes, item.networkRxBytes),
      networkTx = rate(before?.networkTxBytes, item.networkTxBytes),
      blockRead = rate(before?.blockReadBytes, item.blockReadBytes),
      blockWrite = rate(before?.blockWriteBytes, item.blockWriteBytes)
    )
  }
}

enum class ContainerHealth(val label: String) { Problem("需要关注"), Running("运行中"), Stopped("未运行") }

private val unhealthy = Regex("""\(unhealthy\)""", RegexOption.IGNORE_CASE)

/** 「(unhealthy)」或反复重启的容器在 Docker 看来是 running，但它正是读者要找的那个。 */
fun containerHealth(container: LiveContainerDto): ContainerHealth {
  val state = container.state.lowercase()
  return when {
    state == "restarting" || state == "dead" || state == "removing" || unhealthy.containsMatchIn(container.status) -> ContainerHealth.Problem
    state == "running" -> ContainerHealth.Running
    else -> ContainerHealth.Stopped
  }
}

fun containerStateLabel(container: LiveContainerDto): String {
  if (unhealthy.containsMatchIn(container.status)) return "不健康"
  return when (container.state.lowercase()) {
    "running" -> "运行中"
    "exited" -> "已停止"
    "restarting" -> "重启中"
    "paused" -> "已暂停"
    "created" -> "已创建"
    "dead" -> "已失效"
    "removing" -> "删除中"
    else -> container.state
  }
}

/* ---------- 进程 ---------- */

enum class ProcessSortKey(val label: String, val descendingByDefault: Boolean) {
  Cpu("CPU", true),
  Gpu("GPU", true),
  Memory("内存", true),
  Threads("线程", true),
  Name("名称", false),
  Pid("PID", false)
}

/** 未知值（—）无论升降序都排在已知值之后：读不到不等于小。 */
fun sortProcesses(items: List<LiveProcessDto>, key: ProcessSortKey, descending: Boolean): List<LiveProcessDto> {
  fun numeric(item: LiveProcessDto): Double? = when (key) {
    ProcessSortKey.Pid -> item.pid.toDouble()
    ProcessSortKey.Cpu -> item.cpuPercent
    ProcessSortKey.Gpu -> item.gpuPercent
    ProcessSortKey.Memory -> item.memoryBytes
    ProcessSortKey.Threads -> item.threads?.toDouble()
    ProcessSortKey.Name -> null
  }
  return items.sortedWith { left, right ->
    if (key == ProcessSortKey.Name) {
      val order = left.name.lowercase().compareTo(right.name.lowercase())
      val directed = if (descending) -order else order
      if (directed != 0) directed else left.pid.compareTo(right.pid)
    } else {
      val a = numeric(left)
      val b = numeric(right)
      when {
        a == null && b == null -> left.pid.compareTo(right.pid)
        a == null -> 1
        b == null -> -1
        else -> {
          val order = a.compareTo(b)
          val directed = if (descending) -order else order
          if (directed != 0) directed else left.pid.compareTo(right.pid)
        }
      }
    }
  }
}

/** 正在读的行不能跳：保持原位置，新行追加到末尾，消失的行移除。 */
fun holdOrder(previous: List<String>, next: List<String>): List<String> {
  val present = next.toSet()
  val kept = previous.filter { it in present }
  val known = kept.toSet()
  return kept + next.filter { it !in known }
}

/** 新排序最多每 5 秒替换一次屏上顺序；改排序或搜索时立即生效。 */
const val PROCESS_REORDER_MILLIS = 5_000L

fun matchesProcess(item: LiveProcessDto, query: String): Boolean {
  val needle = query.trim().lowercase()
  return needle.isEmpty() || "${item.name} ${item.pid}".lowercase().contains(needle)
}
