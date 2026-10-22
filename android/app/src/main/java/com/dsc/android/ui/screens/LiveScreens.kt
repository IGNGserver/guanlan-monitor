package com.dsc.android.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsc.android.ChartWindow
import com.dsc.android.ContainerHealth
import com.dsc.android.LiveContainerDto
import com.dsc.android.LiveProcessDto
import com.dsc.android.LiveResetState
import com.dsc.android.LiveTone
import com.dsc.android.LiveTopic
import com.dsc.android.LiveUiState
import com.dsc.android.MetricWindow
import com.dsc.android.PROCESS_REORDER_MILLIS
import com.dsc.android.ProcessSortKey
import com.dsc.android.containerHealth
import com.dsc.android.containerStateLabel
import com.dsc.android.holdOrder
import com.dsc.android.liveExpired
import com.dsc.android.liveMemoryPercent
import com.dsc.android.liveSeries
import com.dsc.android.liveStatus
import com.dsc.android.matchesProcess
import com.dsc.android.sortProcesses
import com.dsc.android.ui.oneui.*
import com.dsc.android.ui.shell.GuanlanActions

/**
 * 实时视图（件）：数据直接来自设备，经中枢转发，不进入历史时间序列。
 * 页面上方永远有一行状态说明「这些数字是不是现在的」，过期或失败时绝不冒充实时。
 */

private fun liveGate(live: LiveUiState?, authenticated: Boolean): LiveFailureView? = when {
  !authenticated -> LiveFailureView("需要登录中枢", "实时数据直接来自设备，离线缓存不能提供；连接并登录中枢后自动开始。")
  live == null -> null
  else -> null
}

private data class LiveFailureView(val title: String, val detail: String)

/** 状态行 + 暂停/频率 + 身份冲突横幅 + 失败说明。返回结果是否「新鲜」可显示。 */
private fun LazyListScope.liveHeader(live: LiveUiState?, nowMillis: Long, actions: GuanlanActions, authenticated: Boolean, intervals: List<Int>): Boolean {
  liveGate(live, authenticated)?.let { gate ->
    item(key = "live-gate") { OneUiNotice(title = gate.title, description = gate.detail, tone = OneUiNoticeTone.Info) }
    return false
  }
  val hasResult = live != null && (live.metrics != null || live.processes != null || live.docker != null)
  val expired = live != null && liveExpired(live.lastConfirmedMillis, nowMillis, live.intervalSeconds, live.paused)
  val fresh = hasResult && !expired
  item(key = "live-status") {
    LiveStatusBar(live = live, hasResult = hasResult, intervals = intervals, actions = actions)
  }
  live?.conflictAt?.let { conflictAt ->
    item(key = "live-conflict") { LiveConflictBanner(conflictAt = conflictAt, resetState = live.resetState, onReset = actions.onResetLiveCredentials) }
  }
  val failure = live?.failure
  if (failure != null && !fresh && live.conflictAt == null) {
    item(key = "live-failure") { OneUiNotice(title = failure.title, description = failure.detail, tone = OneUiNoticeTone.Warning) }
  }
  if (failure != null && fresh) {
    item(key = "live-stale-note") { OneUiText(text = failure.detail, role = OneUiTextRole.ChartLabel, color = OneUiTheme.colors.warningContent) }
  }
  return fresh
}

@Composable
private fun LiveStatusBar(live: LiveUiState?, hasResult: Boolean, intervals: List<Int>, actions: GuanlanActions) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  // 状态文字每秒在变，自己维护一个 1 秒的钟
  val now = rememberNowMillis(1_000L)
  val expired = live != null && liveExpired(live.lastConfirmedMillis, now, live.intervalSeconds, live.paused)
  val age = if (live == null || live.lastConfirmedMillis == 0L) 0L else ((now - live.lastConfirmedMillis) / 1000).coerceAtLeast(0)
  val status = liveStatus(live?.paused == true, hasResult, expired, live?.failure, age)
  val (dot, text) = when (status.tone) {
    LiveTone.Live -> colors.online to colors.onlineContent
    LiveTone.Stale -> colors.warning to colors.warningContent
    LiveTone.Unavailable -> colors.critical to colors.criticalContent
    LiveTone.Paused, LiveTone.Connecting -> colors.offline to colors.textSecondary
  }
  OneUiGroup {
    Column(
      modifier = Modifier.padding(horizontal = metrics.groupPadding, vertical = metrics.spaceS),
      verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)
    ) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
        OneUiStatusDot(color = dot)
        Column(modifier = Modifier.weight(1f)) {
          OneUiText(
            text = status.label,
            role = OneUiTextRole.RowTitle,
            color = text,
            maxLines = 1,
            // 只播报状态类别的变化，不每秒念一次「N 秒前」（适）
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
          )
          live?.receivedAt?.let { OneUiText(text = "采集于 ${formatTime(it)}", role = OneUiTextRole.ChartLabel, color = colors.textTertiary) }
        }
        if (live != null) {
          OneUiIconButton(
            contentDescription = if (live.paused) "继续实时刷新" else "暂停实时刷新",
            onClick = { actions.onSetLivePaused(!live.paused) }
          ) {
            OneUiIcon(if (live.paused) Icons.Rounded.PlayArrow else Icons.Rounded.Pause, contentDescription = null, tint = colors.textPrimary)
          }
        }
      }
      if (live != null) {
        Row(
          modifier = Modifier.horizontalScroll(rememberScrollState()),
          horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
          verticalAlignment = Alignment.CenterVertically
        ) {
          OneUiText(text = "刷新", role = OneUiTextRole.ChartLabel, color = colors.textTertiary)
          intervals.forEach { seconds ->
            OneUiFilterChip(label = "每 $seconds 秒", selected = live.intervalSeconds == seconds, onClick = { actions.onSetLiveInterval(seconds) })
          }
        }
      }
    }
  }
}

@Composable
private fun LiveConflictBanner(conflictAt: String, resetState: LiveResetState, onReset: () -> Unit) {
  var confirm by remember { mutableStateOf(false) }
  OneUiNotice(
    title = "中枢拒绝了这台设备的实时登记",
    description = "${formatTime(conflictAt)} 登记时，它的安装身份与已登记的不一致，常见原因是重装了 Agent 或删除了 Agent 配置目录。历史上报不受影响。" +
      when (resetState) {
        LiveResetState.Done -> "已重置，设备会在 30 秒内重新登记。"
        LiveResetState.Failed -> "重置失败，请检查登录状态后重试。"
        else -> ""
      },
    tone = OneUiNoticeTone.Critical,
    action = {
      OneUiButton(
        label = if (resetState == LiveResetState.Pending) "正在重置" else "重置凭据",
        onClick = { confirm = true },
        variant = OneUiButtonVariant.Tonal,
        size = OneUiButtonSize.Compact,
        loading = resetState == LiveResetState.Pending,
        enabled = resetState != LiveResetState.Pending
      )
    }
  )
  if (confirm) {
    OneUiDialog(
      onDismissRequest = { confirm = false },
      title = "重置实时凭据？",
      description = "重置后，中枢会接受这台设备下一次以新身份登记的实时连接。仅在确认是你自己重装了 Agent 或丢失了密钥文件时操作。",
      confirmLabel = "重置",
      onConfirm = {
        confirm = false
        onReset()
      },
      onDismiss = { confirm = false },
      destructive = true
    )
  }
}

/* ---------------- 实时曲线 ---------------- */

internal fun LazyListScope.liveMetricItems(live: LiveUiState?, nowMillis: Long, actions: GuanlanActions, authenticated: Boolean) {
  val fresh = liveHeader(live, nowMillis, actions, authenticated, intervals = listOf(1, 2, 5))
  val state = live?.takeIf { it.topic == LiveTopic.Metrics } ?: return
  if (state.samples.isEmpty()) {
    if (state.failure == null) item(key = "live-wait") { OneUiSkeleton(height = 220.dp) }
    return
  }
  item(key = "live-charts") {
    val samples = state.samples
    val end = samples.last().atMillis
    val window = ChartWindow(MetricWindow.OneMinute, end - com.dsc.android.LIVE_WINDOW_MILLIS, end + 1)
    val cards = listOf(
      ChartCardModel(
        title = "CPU 占用",
        series = listOf(ChartSeriesModel("CPU", liveSeries(samples) { it.cpuPercent }, 0)),
        valueFormatter = ::formatPercent,
        fixedMaxValue = 100.0,
        axisFormatter = { "${it.toInt()}%" }
      ),
      ChartCardModel(
        title = "内存占用",
        series = listOf(ChartSeriesModel("内存", liveSeries(samples, ::liveMemoryPercent), 1)),
        valueFormatter = ::formatPercent,
        fixedMaxValue = 100.0,
        headlineCaption = state.metrics?.let { m ->
          if (m.memoryUsedBytes != null && m.memoryTotalBytes != null) "当前 · ${formatBytes(m.memoryUsedBytes)} / ${formatBytes(m.memoryTotalBytes)}" else null
        } ?: "当前",
        axisFormatter = { "${it.toInt()}%" }
      ),
      ChartCardModel(
        title = "硬盘读写",
        series = listOf(
          ChartSeriesModel("读取", liveSeries(samples) { it.diskReadBytesPerSec }, 0),
          ChartSeriesModel("写入", liveSeries(samples) { it.diskWriteBytesPerSec }, 2)
        ),
        valueFormatter = ::formatSpeed,
        headlineCaption = "当前读取 · 写入 ${formatSpeed(state.metrics?.diskWriteBytesPerSec)}"
      ),
      ChartCardModel(
        title = "网络",
        series = listOf(
          ChartSeriesModel("接收", liveSeries(samples) { it.networkRxBytesPerSec }, 0),
          ChartSeriesModel("发送", liveSeries(samples) { it.networkTxBytesPerSec }, 2)
        ),
        valueFormatter = ::formatSpeed,
        headlineCaption = "当前接收 · 发送 ${formatSpeed(state.metrics?.networkTxBytesPerSec)}"
      )
    )
    Box(modifier = Modifier.oneUiStaleDim(!fresh)) {
      OneUiChartCardGrid(cards = cards, chartWindow = window, animationKey = "live:${state.sessionId}")
    }
  }
  item(key = "live-note") {
    OneUiText(
      text = "实时曲线保留最近 2 分钟，离开页面即停止查询；硬件温度等慢速指标仍以历史粒度为准。",
      role = OneUiTextRole.ChartLabel,
      color = OneUiTheme.colors.textTertiary
    )
  }
}

/* ---------------- 进程 ---------------- */

private const val PROCESS_PAGE = 50

/** 屏上顺序的「记忆」：值每次刷新都更新，位置只在没人读的时候、且距上次重排超过 5 秒才换。 */
private class ProcessOrder {
  var ids: List<String> = emptyList()
  var at: Long = 0L
  var signature: String = ""
}

internal fun LazyListScope.liveProcessItems(live: LiveUiState?, nowMillis: Long, actions: GuanlanActions, authenticated: Boolean) {
  val fresh = liveHeader(live, nowMillis, actions, authenticated, intervals = listOf(2, 5, 10))
  val data = live?.takeIf { it.topic == LiveTopic.Processes }?.processes
  if (data == null) {
    if (live != null && live.failure == null) item(key = "process-wait") { OneUiSkeleton(height = 320.dp) }
    return
  }
  item(key = "process-table") {
    Box(modifier = Modifier.oneUiStaleDim(!fresh)) { ProcessTable(data) }
  }
}

@Composable
private fun ProcessTable(data: com.dsc.android.LiveProcessesDto) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  var query by rememberSaveable { mutableStateOf("") }
  var sortKeyName by rememberSaveable { mutableStateOf(ProcessSortKey.Cpu.name) }
  var descending by rememberSaveable { mutableStateOf(true) }
  var limit by rememberSaveable { mutableIntStateOf(PROCESS_PAGE) }
  var expanded by rememberSaveable { mutableStateOf<String?>(null) }
  val sortKey = ProcessSortKey.entries.firstOrNull { it.name == sortKeyName } ?: ProcessSortKey.Cpu
  val order = remember { ProcessOrder() }

  val matching = data.items.filter { matchesProcess(it, query) }
  val sorted = sortProcesses(matching, sortKey, descending)
  val signature = "${sortKey.name}:$descending:${query.trim().lowercase()}"
  val holding = expanded != null && order.signature == signature
  val now = System.currentTimeMillis()
  if (!holding && (order.signature != signature || now - order.at >= PROCESS_REORDER_MILLIS)) {
    order.ids = sorted.map { it.id }
    order.at = now
    order.signature = signature
  } else {
    order.ids = holdOrder(order.ids, sorted.map { it.id })
  }
  val byId = matching.associateBy { it.id }
  val rows = order.ids.mapNotNull { byId[it] }
  val maxMemory = data.items.maxOfOrNull { it.memoryBytes ?: 0.0 } ?: 0.0
  val maxThreads = data.items.maxOfOrNull { it.threads ?: 0 } ?: 0
  val gpuKnown = data.items.any { it.gpuPercent != null }

  Column(verticalArrangement = Arrangement.spacedBy(metrics.cardGap)) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
      val sortRow: @Composable (Modifier) -> Unit = { rowModifier ->
        Row(
          modifier = rowModifier.horizontalScroll(rememberScrollState()),
          horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
          verticalAlignment = Alignment.CenterVertically
        ) {
          OneUiText(text = "排序", role = OneUiTextRole.ChartLabel, color = colors.textTertiary)
          ProcessSortKey.entries.filter { it != ProcessSortKey.Gpu || gpuKnown }.forEach { key ->
            val active = key == sortKey
            OneUiFilterChip(
              label = if (active) "${key.label} ${if (descending) "↓" else "↑"}" else key.label,
              selected = active,
              onClick = {
                if (active) {
                  descending = !descending
                } else {
                  sortKeyName = key.name
                  descending = key.descendingByDefault
                }
              }
            )
          }
        }
      }
      if (maxWidth >= 600.dp) {
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(metrics.spaceM),
          verticalAlignment = Alignment.Bottom
        ) {
          OneUiTextField(
            value = query,
            onValueChange = {
              query = it
              limit = PROCESS_PAGE
            },
            label = "搜索名称或 PID",
            imeAction = androidx.compose.ui.text.input.ImeAction.Search,
            modifier = Modifier.width(260.dp)
          )
          sortRow(Modifier.weight(1f).padding(bottom = 4.dp))
        }
      } else {
        Column(verticalArrangement = Arrangement.spacedBy(metrics.cardGap)) {
          OneUiTextField(
            value = query,
            onValueChange = {
              query = it
              limit = PROCESS_PAGE
            },
            label = "搜索名称或 PID",
            imeAction = androidx.compose.ui.text.input.ImeAction.Search
          )
          sortRow(Modifier.fillMaxWidth())
        }
      }
    }
    OneUiText(
      text = buildString {
        append("共 ${data.totalCount} 个进程")
        if (data.truncated) append("（设备只返回了占用最高的 ${data.items.size} 个）")
        if (query.isNotBlank()) append(" · 匹配 ${matching.size} 个")
        append(" · CPU 按整机容量计，满载 100%；内存为常驻内存（RSS）；横条表示当前排序指标")
        if (!gpuKnown) append(" · 该设备不提供进程 GPU 占用")
      },
      role = OneUiTextRole.ChartLabel,
      color = colors.textTertiary
    )
    if (rows.isEmpty()) {
      OneUiEmptyState(
        title = if (query.isNotBlank()) "没有匹配的进程" else "本次快照中没有进程",
        description = if (query.isNotBlank()) "没有名称或 PID 包含「${query.trim()}」的进程。" else null
      )
    } else {
      OneUiGroup {
        rows.take(limit).forEachIndexed { index, process ->
          if (index > 0) OneUiListDivider(indent = false)
          ProcessRow(
            process = process,
            sortKey = sortKey,
            maxMemory = maxMemory,
            maxThreads = maxThreads,
            showGpu = gpuKnown,
            expanded = expanded == process.id,
            onToggle = { expanded = if (expanded == process.id) null else process.id }
          )
        }
      }
      if (rows.size > limit) {
        OneUiButton(
          label = "再显示 ${minOf(PROCESS_PAGE, rows.size - limit)} 个（已显示 $limit / ${rows.size}）",
          onClick = { limit += PROCESS_PAGE },
          variant = OneUiButtonVariant.Tonal,
          fillWidth = true
        )
      }
    }
  }
}

@Composable
private fun ProcessRow(
  process: LiveProcessDto,
  sortKey: ProcessSortKey,
  maxMemory: Double,
  maxThreads: Int,
  showGpu: Boolean,
  expanded: Boolean,
  onToggle: () -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val cpu = process.cpuPercent
  // 行尾读数与横条跟随排序指标：按什么排，就最醒目地显示什么（名称 / PID 排序时看 CPU）
  val focus = when (sortKey) {
    ProcessSortKey.Gpu -> Triple("GPU ${process.gpuPercent?.let(::formatPercent) ?: "—"}", process.gpuPercent?.let { (it / 100).toFloat() }, process.gpuPercent?.let { it >= 50 } ?: false)
    ProcessSortKey.Memory -> Triple("内存 ${process.memoryBytes?.let(::formatBytes) ?: "—"}", process.memoryBytes?.takeIf { maxMemory > 0 }?.let { (it / maxMemory).toFloat() }, false)
    ProcessSortKey.Threads -> Triple("线程 ${process.threads ?: "—"}", process.threads?.takeIf { maxThreads > 0 }?.let { it.toFloat() / maxThreads }, false)
    else -> Triple("CPU ${cpu?.let(::formatPercent) ?: "—"}", cpu?.let { (it / 100).toFloat() }, (cpu ?: 0.0) >= 50)
  }
  Column(
    modifier = Modifier
      .fillMaxWidth()
      .oneUiPressable(onClick = onToggle, shape = OneUiTheme.shapes.tile, minHeight = metrics.touchTarget)
      .padding(horizontal = metrics.spaceM, vertical = 10.dp),
    verticalArrangement = Arrangement.spacedBy(4.dp)
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      OneUiText(text = process.name, role = OneUiTextRole.RowTitle, maxLines = 1, modifier = Modifier.weight(1f))
      OneUiText(
        text = focus.first,
        role = OneUiTextRole.RowSubtitle,
        color = when {
          focus.second == null -> colors.textTertiary
          focus.third -> colors.warningContent
          else -> colors.textPrimary
        },
        weight = FontWeight.SemiBold
      )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(metrics.spaceS), verticalAlignment = Alignment.CenterVertically) {
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        OneUiText(
          text = buildList {
            add("PID ${process.pid}")
            if (sortKey != ProcessSortKey.Cpu && sortKey != ProcessSortKey.Name && sortKey != ProcessSortKey.Pid) add("CPU ${cpu?.let(::formatPercent) ?: "—"}")
            if (sortKey != ProcessSortKey.Memory) add("内存 ${process.memoryBytes?.let(::formatBytes) ?: "—"}")
            if (showGpu && sortKey != ProcessSortKey.Gpu) add("GPU ${process.gpuPercent?.let(::formatPercent) ?: "—"}")
          }.joinToString(" · "),
          role = OneUiTextRole.ChartLabel,
          color = colors.textSecondary,
          maxLines = 1
        )
        // CPU / GPU 按满载 100%；内存与线程相对本次列表里最多的那个进程
        BarTrack(fraction = focus.second ?: 0f, color = colors.seriesColor(if (sortKey == ProcessSortKey.Memory) 1 else 0), visible = focus.second != null)
      }
    }
    AnimatedVisibility(visible = expanded) {
      OneUiMetaTable(
        modifier = Modifier.padding(top = 6.dp),
        items = listOf(
          "进程 ID" to process.pid.toString(),
          "父进程" to (process.parentPid?.toString() ?: "—"),
          "启动时间" to (process.startedAt?.let(::formatTime) ?: "—"),
          "线程" to (process.threads?.toString() ?: "—"),
          "状态" to (process.status ?: "—"),
          "GPU" to (process.gpuPercent?.let(::formatPercent) ?: "未读到（平台不支持或无权限，不代表空闲）")
        ),
        selectable = true
      )
    }
  }
}

@Composable
private fun BarTrack(fraction: Float, color: androidx.compose.ui.graphics.Color, visible: Boolean) {
  if (!visible) {
    Box(modifier = Modifier.height(3.dp))
    return
  }
  OneUiLinearProgress(fraction = fraction.coerceIn(0f, 1f), color = color, height = 3.dp)
}

/* ---------------- 容器 ---------------- */

internal fun LazyListScope.liveDockerItems(live: LiveUiState?, nowMillis: Long, actions: GuanlanActions, authenticated: Boolean) {
  val fresh = liveHeader(live, nowMillis, actions, authenticated, intervals = listOf(2, 5, 10))
  val state = live?.takeIf { it.topic == LiveTopic.Docker }
  val data = state?.docker
  if (data == null) {
    if (live != null && live.failure == null) item(key = "docker-wait") { OneUiSkeleton(height = 240.dp) }
    return
  }
  item(key = "docker-summary") {
    val colors = OneUiTheme.colors
    val counts = data.items.groupingBy { containerHealth(it) }.eachCount()
    OneUiText(
      text = buildString {
        append("共 ${data.totalCount} 个容器 · 运行中 ${counts[ContainerHealth.Running] ?: 0}")
        counts[ContainerHealth.Problem]?.let { append(" · 需要关注 $it") }
        counts[ContainerHealth.Stopped]?.let { append(" · 未运行 $it") }
        if (data.truncated) append("（只返回了前 ${data.items.size} 个）")
        if (data.statsCandidates != null && data.statsRead != null && data.statsRead < data.statsCandidates) {
          append(" · 资源数据读到 ${data.statsRead}/${data.statsCandidates} 个")
        }
      },
      role = OneUiTextRole.ChartLabel,
      color = colors.textTertiary
    )
  }
  if (data.items.isEmpty()) {
    item(key = "docker-empty") { OneUiEmptyState(title = "没有容器", description = "Docker 可以访问，但当前没有任何容器。") }
    return
  }
  ContainerHealth.entries.forEach { health ->
    val group = data.items.filter { containerHealth(it) == health }.sortedBy { it.name.lowercase() }
    if (group.isEmpty()) return@forEach
    item(key = "docker:${health.name}") {
      Column(
        modifier = Modifier.oneUiStaleDim(!fresh),
        verticalArrangement = Arrangement.spacedBy(OneUiTheme.metrics.spaceXs)
      ) {
        OneUiGroupHeader(label = "${health.label} · ${group.size}")
        OneUiGroup {
          group.forEachIndexed { index, container ->
            if (index > 0) OneUiListDivider(indent = false)
            ContainerRow(container = container, rates = state.dockerRates[container.id], health = health)
          }
        }
      }
    }
  }
}

@Composable
private fun ContainerRow(container: LiveContainerDto, rates: com.dsc.android.ContainerRates?, health: ContainerHealth) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val memoryRatio = container.memoryBytes?.let { used -> container.memoryLimitBytes?.takeIf { it > 0 }?.let { used / it } }
  Column(
    modifier = Modifier
      .fillMaxWidth()
      .padding(horizontal = metrics.spaceM, vertical = 10.dp),
    verticalArrangement = Arrangement.spacedBy(4.dp)
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      OneUiText(text = container.name, role = OneUiTextRole.RowTitle, maxLines = 1, modifier = Modifier.weight(1f))
      OneUiText(
        text = containerStateLabel(container),
        role = OneUiTextRole.ChartLabel,
        color = when (health) {
          ContainerHealth.Problem -> colors.criticalContent
          ContainerHealth.Running -> colors.onlineContent
          ContainerHealth.Stopped -> colors.textTertiary
        },
        weight = FontWeight.SemiBold
      )
    }
    OneUiText(
      text = listOfNotNull(container.image.takeIf { it.isNotBlank() }, container.project?.let { "项目 $it" }, container.status.takeIf { it.isNotBlank() }).joinToString(" · "),
      role = OneUiTextRole.ChartLabel,
      color = colors.textTertiary,
      maxLines = 2
    )
    if (health != ContainerHealth.Stopped) {
      OneUiText(
        text = buildString {
          append("CPU ${container.cpuPercent?.let(::formatPercent) ?: "—"}")
          append(" · 内存 ${container.memoryBytes?.let(::formatBytes) ?: "—"}")
          container.memoryLimitBytes?.takeIf { it > 0 }?.let { append(" / ${formatBytes(it)}") }
          rates?.let { r ->
            if (r.networkRx != null || r.networkTx != null) append(" · 网络 ↓${r.networkRx?.let(::formatSpeed) ?: "—"} ↑${r.networkTx?.let(::formatSpeed) ?: "—"}")
            if (r.blockRead != null || r.blockWrite != null) append(" · 磁盘 读${r.blockRead?.let(::formatSpeed) ?: "—"} 写${r.blockWrite?.let(::formatSpeed) ?: "—"}")
          }
        },
        role = OneUiTextRole.ChartLabel,
        color = colors.textSecondary
      )
      memoryRatio?.let { ratio ->
        OneUiLinearProgress(
          fraction = ratio.toFloat().coerceIn(0f, 1f),
          color = if (ratio >= 0.9) colors.warning else colors.seriesColor(1),
          height = 3.dp
        )
      }
    }
  }
}
