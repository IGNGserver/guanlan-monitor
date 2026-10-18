package com.dsc.android.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Air
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ReportProblem
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.SwapHoriz
import androidx.compose.material.icons.rounded.Thermostat
import androidx.compose.material.icons.rounded.Timeline
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.VideogameAsset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsc.android.AppState
import com.dsc.android.AttentionItem
import com.dsc.android.AttentionSeverity
import com.dsc.android.AttentionThresholds
import com.dsc.android.ChartWindow
import com.dsc.android.DeviceBlockKey
import com.dsc.android.DiskDto
import com.dsc.android.DiskMetricSeriesDto
import com.dsc.android.GpuDto
import com.dsc.android.GpuMetricSeriesDto
import com.dsc.android.LiveTopic
import com.dsc.android.MetricWindow
import com.dsc.android.MetricsDto
import com.dsc.android.RemoteDataSource
import com.dsc.android.SamplePointDto
import com.dsc.android.TemperatureMetricSeriesDto
import com.dsc.android.TemperatureSensorDto
import com.dsc.android.metricsAttention
import com.dsc.android.percentOf
import com.dsc.android.summaryAttention
import com.dsc.android.ui.oneui.*
import com.dsc.android.ui.shell.GuanlanActions
import kotlinx.coroutines.launch

/**
 * 设备页（构）。
 *
 * 四个标签页对应读者来这里的四个问题：
 * - 概览：它现在怎么样、最近怎么走——核心图表常驻，不用先点开某一类；
 * - 硬件：某一类（CPU/显卡/内存/硬盘/存储池/网络/温度/风扇）的实例级明细；
 * - 进程 / 容器：此刻是谁在占资源（实时查询，只在页面可见时轮询）。
 * 时间范围是图表的属性，吸附在标签页下方，切换后图表就地重绘。
 */
enum class DetailTab(val label: String) {
  Overview("概览"),
  Hardware("硬件"),
  Processes("进程"),
  Containers("容器")
}

@Composable
fun DeviceDetailScreen(
  state: AppState,
  actions: GuanlanActions,
  embedded: Boolean,
  initialTab: DetailTab = DetailTab.Overview
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val listState = rememberLazyListState()
  val collapse = rememberOneUiCollapse(listState)
  val topBarScope = rememberCoroutineScope()
  val now = rememberNowMillis()
  val data = state.metrics?.takeIf { it.device.deviceId == state.selectedDeviceId }
  val summary = state.devices.firstOrNull { it.deviceId == state.selectedDeviceId }
  val deviceId = state.selectedDeviceId
  // 可见加载进行中且屏上仍有快照：进入陈旧态——交互照常，只有数据本身降存在感（交）
  val stale = state.loadingMetrics && data != null
  val displayWindow = displayWindowFor(data?.window, state.selectedWindow, state.loadingMetrics)
  val syncing = state.refreshing || state.loadingMetrics

  var tabName by rememberSaveable(deviceId) { mutableStateOf(initialTab.name) }
  val tab = DetailTab.entries.firstOrNull { it.name == tabName } ?: DetailTab.Overview
  var openBlock by rememberSaveable(deviceId) { mutableStateOf<DeviceBlockKey?>(null) }
  var openTabId by rememberSaveable(deviceId) { mutableStateOf("total") }
  var liveRange by rememberSaveable(deviceId) { mutableStateOf(false) }
  var switcherOpen by remember { mutableStateOf(false) }

  // 从首页点某个读数进来：直接落到「硬件」里那一类，不让人再找一次（交）
  LaunchedEffect(state.focusedBlock, state.loadingMetrics, data?.device?.deviceId) {
    val blockKey = state.focusedBlock ?: return@LaunchedEffect
    if (data == null && state.loadingMetrics) return@LaunchedEffect
    tabName = DetailTab.Hardware.name
    openBlock = blockKey
    openTabId = "total"
    actions.onClearFocusedBlock()
    listState.scrollToItem(0)
  }

  // 实时查询只在对应内容可见时进行；切走或离开页面立即停（交 + 省电）
  val liveTopic = when {
    tab == DetailTab.Processes -> LiveTopic.Processes
    tab == DetailTab.Containers -> LiveTopic.Docker
    tab == DetailTab.Overview && liveRange -> LiveTopic.Metrics
    else -> null
  }
  DisposableEffect(deviceId, liveTopic) {
    if (deviceId != null && liveTopic != null) actions.onStartLive(deviceId, liveTopic)
    onDispose { if (liveTopic != null) actions.onStopLive() }
  }
  val live = state.live?.takeIf { it.deviceId == deviceId && it.topic == liveTopic }

  val issues = remember(summary, data, now / 60_000) {
    buildList {
      summary?.let { addAll(summaryAttention(it, now)) }
      data?.let { snapshot -> addAll(metricsAttention(snapshot).filter { item -> none { it.key == item.key } }) }
    }.sortedBy { it.severity.rank }
  }

  val tabs = remember(data, openBlock) {
    val block = openBlock
    if (data != null && block != null) buildBlockSheetTabs(data, block) else emptyList()
  }
  val tabIds = tabs.map { it.id }
  val effectiveTab = if (openTabId in tabIds) openTabId else (tabIds.firstOrNull() ?: "total")
  val online = (data?.status ?: summary?.status) == "online"

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.canvas)
  ) {
    Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
      Box {
        OneUiTopBar(
          title = data?.device?.hostname ?: summary?.hostname ?: "设备",
          subtitle = buildString {
            append(if (online) "在线" else "离线")
            append(" · ")
            append(relativeTimeLabel(data?.lastSeenAt ?: summary?.lastSeenAt, now))
            append("上报")
            (data?.device?.os ?: summary?.os)?.let { append(" · ${osLabel(it)}") }
          },
          collapse = collapse,
          onCollapsedTitleClick = { topBarScope.launch { listState.animateScrollToItem(0) } },
          large = !embedded,
          navigationIcon = if (embedded) null else {
            {
              OneUiIconButton(contentDescription = "返回总览", onClick = actions.onShowDeviceList) {
                OneUiIcon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = null, tint = colors.textPrimary)
              }
            }
          },
          actions = {
            if (state.devices.size > 1) {
              OneUiIconButton(contentDescription = "切换设备", onClick = { switcherOpen = true }) {
                OneUiIcon(Icons.Rounded.SwapHoriz, contentDescription = null, tint = colors.textPrimary)
              }
            }
            OneUiIconButton(
              contentDescription = "刷新",
              onClick = { if (!state.refreshing) actions.onRefresh() },
              enabled = !state.refreshing,
              spinning = state.refreshing
            ) {
              OneUiIcon(Icons.Rounded.Refresh, contentDescription = null, tint = colors.textPrimary)
            }
            deviceId?.let { id ->
              OneUiIconButton(contentDescription = "编辑记录项", onClick = { actions.onOpenDeviceEditor(id) }) {
                OneUiIcon(Icons.Rounded.Tune, contentDescription = null, tint = colors.textPrimary)
              }
            }
          }
        )
        OneUiSyncProgress(visible = syncing, modifier = Modifier.align(Alignment.BottomCenter))
      }

      // 吸附区：标签页 + 时间范围。它们决定下面所有内容的口径，所以不随列表滚走（构）
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .oneUiContentWidth(metrics)
          .padding(horizontal = metrics.screenMargin)
          .padding(bottom = metrics.spaceXs),
        verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)
      ) {
        OneUiSegmentedRow(
          options = DetailTab.entries.map { it.label },
          selectedIndex = tab.ordinal,
          onSelect = { index ->
            tabName = DetailTab.entries[index].name
            topBarScope.launch { listState.scrollToItem(0) }
          }
        )
        if (tab == DetailTab.Overview || tab == DetailTab.Hardware) {
          RangeChips(
            selected = displayWindow,
            live = liveRange && tab == DetailTab.Overview,
            allowLive = tab == DetailTab.Overview,
            loading = state.loadingMetrics,
            onSelectLive = { liveRange = true },
            onSelect = { window ->
              liveRange = false
              actions.onSelectWindow(window)
            }
          )
        }
      }

      LazyColumn(
        state = listState,
        modifier = Modifier
          .weight(1f)
          .fillMaxWidth()
          .oneUiContentWidth(metrics),
        contentPadding = oneUiListContentPadding(),
        verticalArrangement = Arrangement.spacedBy(metrics.groupGap)
      ) {
        if (state.dataSource == RemoteDataSource.Cache && !state.loggingIn && !state.refreshing) {
          item(key = "offline-cache") {
            OneUiNotice(
              title = "当前显示离线缓存",
              description = "缓存于 ${formatTime(state.cacheSavedAt)}；数据可能已经过期，进程与容器需要连接中枢才能查看。",
              tone = OneUiNoticeTone.Warning,
              action = {
                OneUiButton(label = "重试", onClick = actions.onRefresh, variant = OneUiButtonVariant.Tonal, size = OneUiButtonSize.Compact)
              }
            )
          }
        }

        when (tab) {
          DetailTab.Overview -> overviewItems(
            data = data,
            state = state,
            actions = actions,
            stale = stale,
            displayWindow = displayWindow,
            liveRange = liveRange,
            live = live,
            nowMillis = now,
            issues = issues,
            onOpenBlock = { block ->
              tabName = DetailTab.Hardware.name
              openBlock = block
              openTabId = "total"
              topBarScope.launch { listState.scrollToItem(0) }
            }
          )

          DetailTab.Hardware -> hardwareItems(
            data = data,
            state = state,
            actions = actions,
            stale = stale,
            displayWindow = displayWindow,
            openBlock = openBlock,
            tabs = tabs,
            effectiveTab = effectiveTab,
            onSelectTab = { openTabId = it },
            onOpenBlock = { block ->
              openBlock = block
              openTabId = "total"
              topBarScope.launch { listState.scrollToItem(0) }
            },
            onCloseBlock = { openBlock = null }
          )

          DetailTab.Processes -> liveProcessItems(live = live, nowMillis = now, actions = actions, authenticated = state.authenticated)
          DetailTab.Containers -> liveDockerItems(live = live, nowMillis = now, actions = actions, authenticated = state.authenticated)
        }

        item(key = "bottom-spacer") { Spacer(Modifier.height(metrics.thumbZone)) }
      }
    }
  }

  if (switcherOpen) {
    OneUiActionSheet(
      onDismissRequest = { switcherOpen = false },
      title = "切换设备",
      actions = state.devices
        .sortedWith(compareBy<com.dsc.android.DeviceSummaryDto> { it.sortOrder ?: Int.MAX_VALUE }.thenBy { it.hostname })
        .map { device ->
          OneUiActionModel(
            label = if (device.deviceId == deviceId) "${device.hostname}（当前）" else device.hostname,
            description = "${if (device.status == "online") "在线" else "离线"} · CPU ${formatPercent(device.cpuUsagePercent)} · 内存 ${formatPercent(device.memoryUsagePercent)}",
            icon = deviceIcon(device.os),
            onClick = {
              switcherOpen = false
              // 换设备时保留当前标签页：对比两台机器的进程最常见（交）
              if (device.deviceId != deviceId) actions.onOpenDevice(device.deviceId, null)
            }
          )
        }
    )
  }
}

/** 时间范围胶囊：「实时」只在概览可选（硬件明细只有历史序列）。 */
@Composable
private fun RangeChips(
  selected: MetricWindow,
  live: Boolean,
  allowLive: Boolean,
  loading: Boolean,
  onSelectLive: () -> Unit,
  onSelect: (MetricWindow) -> Unit
) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
  ) {
    if (allowLive) {
      OneUiFilterChip(label = "实时", selected = live, onClick = onSelectLive)
    }
    RangeOptions.forEach { (window, label) ->
      val isSelected = !live && window == selected
      OneUiFilterChip(
        label = label,
        selected = isSelected,
        onClick = { onSelect(window) },
        leadingIcon = if (loading && isSelected) {
          { OneUiSpinner(size = 14.dp, strokeWidth = 2.dp, color = colors.textOnAccent) }
        } else null
      )
    }
  }
}

/** 「1 分钟」被「实时」取代：两者都是看此刻，实时每秒一点、更直观。 */
private val RangeOptions = listOf(
  MetricWindow.FiveMinutes to "5 分钟",
  MetricWindow.OneHour to "1 小时",
  MetricWindow.SixHours to "6 小时",
  MetricWindow.OneDay to "24 小时",
  MetricWindow.SevenDays to "7 天"
)

private fun LazyListScope.loadingOrError(data: MetricsDto?, state: AppState, actions: GuanlanActions): Boolean {
  if (data != null) return false
  val error = state.metricsError
  if (error == null || state.loadingMetrics) {
    item(key = "detail-skeleton") {
      Column(verticalArrangement = Arrangement.spacedBy(OneUiTheme.metrics.cardGap)) {
        OneUiSkeleton(height = 220.dp)
        OneUiSkeleton(height = 220.dp)
      }
    }
  } else {
    item(key = "detail-error") {
      OneUiErrorState(title = "没能读取这台设备的指标", description = error, onRetry = actions.onRefresh)
    }
  }
  return true
}

/* ---------------- 概览 ---------------- */

private fun LazyListScope.overviewItems(
  data: MetricsDto?,
  state: AppState,
  actions: GuanlanActions,
  stale: Boolean,
  displayWindow: MetricWindow,
  liveRange: Boolean,
  live: com.dsc.android.LiveUiState?,
  nowMillis: Long,
  issues: List<AttentionItem>,
  onOpenBlock: (DeviceBlockKey) -> Unit
) {
  if (issues.isNotEmpty()) {
    item(key = "issues") { DeviceIssues(issues = issues, onOpenBlock = onOpenBlock) }
  }

  if (liveRange) {
    liveMetricItems(live = live, nowMillis = nowMillis, actions = actions, authenticated = state.authenticated)
  } else {
    if (loadingOrError(data, state, actions)) return
    val snapshot = data ?: return
    item(key = "overview-charts") {
      OneUiStaleGroup(stale = stale) {
        val chartWindow = remember(snapshot, displayWindow) { chartWindowFor(snapshot, displayWindow) }
        val cards = remember(snapshot) { buildOverviewCards(snapshot) }
        OneUiChartCardGrid(
          cards = cards.map { it.first },
          chartWindow = chartWindow,
          onCardClick = { index -> onOpenBlock(cards[index].second) }
        )
      }
    }
  }

  data?.let { snapshot ->
    item(key = "overview-more") {
      Column(verticalArrangement = Arrangement.spacedBy(OneUiTheme.metrics.cardGap)) {
        OneUiGroup {
          OneUiListItem(
            title = "流量日历",
            subtitle = "按日 / 周 / 月查看接收、发送与明细记录",
            onClick = { actions.onOpenTraffic(snapshot.device.deviceId) },
            leading = { OneUiLeadingIcon(icon = Icons.Rounded.Timeline, contentDescription = null, tone = OneUiIconTone.Accent) },
            trailing = { OneUiIcon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = OneUiTheme.colors.textTertiary) }
          )
        }
        OneUiMetaTable(
          title = "设备信息",
          items = buildList {
            add("设备 ID" to snapshot.device.deviceId)
            add("处理器" to (snapshot.device.cpuModel ?: "未上报"))
            add("系统" to snapshot.device.os)
            add("平台" to "${snapshot.device.platform} / ${snapshot.device.arch}")
            add("上次更新" to formatTime(snapshot.lastSeenAt))
            add("agent" to (snapshot.device.agentVersion ?: "未知"))
            snapshot.device.agentChannel?.takeIf { it.isNotBlank() }?.let { add("渠道" to it) }
          },
          selectable = true,
          collapsible = true,
          defaultExpanded = false
        )
      }
    }
  }
}

/** 这台设备的问题：最多列 3 条，点一条直达对应类别。 */
@Composable
private fun DeviceIssues(issues: List<AttentionItem>, onOpenBlock: (DeviceBlockKey) -> Unit) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  OneUiGroup {
    issues.take(3).forEachIndexed { index, issue ->
      if (index > 0) OneUiListDivider()
      OneUiListItem(
        title = issue.title,
        subtitle = issue.detail,
        onClick = issue.block?.let { block -> { onOpenBlock(block) } },
        leading = {
          OneUiLeadingIcon(
            icon = Icons.Rounded.ReportProblem,
            contentDescription = issue.severity.label,
            tone = when (issue.severity) {
              AttentionSeverity.Critical -> OneUiIconTone.Critical
              AttentionSeverity.Warning -> OneUiIconTone.Warning
              AttentionSeverity.Offline -> OneUiIconTone.Offline
            }
          )
        },
        trailing = if (issue.block != null) {
          { OneUiIcon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = colors.textTertiary, size = metrics.iconFilledSize) }
        } else null
      )
    }
    if (issues.size > 3) {
      OneUiListDivider()
      OneUiText(
        text = "另有 ${issues.size - 3} 项，完整清单见「关注」",
        role = OneUiTextRole.ChartLabel,
        color = colors.textTertiary,
        modifier = Modifier.padding(horizontal = metrics.groupPadding, vertical = metrics.spaceS)
      )
    }
  }
}

private val percentAxis: (Double) -> String = { "${it.toInt()}%" }

private fun usageThresholds(warning: Double, critical: Double) = listOf(
  ChartThreshold(warning, "${warning.toInt()}%", ChartThresholdTone.Warning),
  ChartThreshold(critical, "${critical.toInt()}%", ChartThresholdTone.Critical)
)

private fun temperatureThresholds(warning: Double, critical: Double) = listOf(
  ChartThreshold(warning, "${warning.toInt()} °C", ChartThresholdTone.Warning),
  ChartThreshold(critical, "${critical.toInt()} °C", ChartThresholdTone.Critical)
)

private fun toneFor(value: Double?, warning: Double, critical: Double): OneUiPillTone = when {
  value == null -> OneUiPillTone.Neutral
  value >= critical -> OneUiPillTone.Critical
  value >= warning -> OneUiPillTone.Warning
  else -> OneUiPillTone.Neutral
}

/** 概览的核心图：CPU、内存、硬盘读写、网络收发，有显卡/温度时再加两张。 */
internal fun buildOverviewCards(data: MetricsDto): List<Pair<ChartCardModel, DeviceBlockKey>> = buildList {
  val series = data.series
  val latest = data.latest
  val cpuNow = com.dsc.android.seriesStats(series.cpuUsagePercent)?.latest
  add(
    ChartCardModel(
      title = "CPU 占用",
      series = listOf(ChartSeriesModel("CPU", series.cpuUsagePercent, 0)),
      valueFormatter = ::formatPercent,
      fixedMaxValue = 100.0,
      thresholds = usageThresholds(AttentionThresholds.CPU_WARNING, AttentionThresholds.CPU_CRITICAL),
      tone = toneFor(cpuNow, AttentionThresholds.CPU_WARNING, AttentionThresholds.CPU_CRITICAL),
      note = listOfNotNull(
        latest.cpuFrequencyMHz?.let { "频率 ${formatMHz(it)}" },
        cpuLatestTemperature(data)?.let { "温度 ${formatCelsius(it)}" },
        "进程 ${latest.system.processCount}"
      ).joinToString(" · "),
      axisFormatter = percentAxis
    ) to DeviceBlockKey.Cpu
  )
  val memNow = com.dsc.android.seriesStats(series.memoryUsagePercent)?.latest
  add(
    ChartCardModel(
      title = "内存占用",
      series = buildList {
        add(ChartSeriesModel("物理", series.memoryUsagePercent, 1))
        if (latest.swapTotalBytes > 0 && series.swapUsagePercent.isNotEmpty()) add(ChartSeriesModel("Swap", series.swapUsagePercent, 3))
      },
      valueFormatter = ::formatPercent,
      fixedMaxValue = 100.0,
      headlineCaption = "当前 · ${buildUsage(latest.memoryUsedBytes, latest.memoryTotalBytes)}",
      thresholds = usageThresholds(AttentionThresholds.MEMORY_WARNING, AttentionThresholds.MEMORY_CRITICAL),
      tone = toneFor(memNow, AttentionThresholds.MEMORY_WARNING, AttentionThresholds.MEMORY_CRITICAL),
      axisFormatter = percentAxis
    ) to DeviceBlockKey.Memory
  )
  val writeNow = com.dsc.android.seriesStats(series.diskWriteBytesPerSec)?.latest
  add(
    ChartCardModel(
      title = "硬盘读写",
      series = listOf(
        ChartSeriesModel("读取", series.diskReadBytesPerSec, 0),
        ChartSeriesModel("写入", series.diskWriteBytesPerSec, 2)
      ),
      valueFormatter = ::formatSpeed,
      headlineCaption = "当前读取 · 写入 ${formatSpeed(writeNow)}",
      note = "容量 ${buildUsage(latest.diskUsedBytes, latest.diskTotalBytes)}"
    ) to DeviceBlockKey.Disk
  )
  val txNow = com.dsc.android.seriesStats(series.networkTxBytesPerSec)?.latest
  add(
    ChartCardModel(
      title = "网络",
      series = listOf(
        ChartSeriesModel("接收", series.networkRxBytesPerSec, 0),
        ChartSeriesModel("发送", series.networkTxBytesPerSec, 2)
      ),
      valueFormatter = ::formatSpeed,
      headlineCaption = "当前接收 · 发送 ${formatSpeed(txNow)}"
    ) to DeviceBlockKey.Network
  )
  if (latest.gpus.isNotEmpty() || series.gpuUsagePercent.isNotEmpty()) {
    add(
      ChartCardModel(
        title = "显卡",
        series = buildList {
          add(ChartSeriesModel("占用", series.gpuUsagePercent, 1))
          if (series.gpuMemoryUsagePercent.isNotEmpty()) add(ChartSeriesModel("显存", series.gpuMemoryUsagePercent, 2))
        },
        valueFormatter = ::formatPercent,
        fixedMaxValue = 100.0,
        note = formatGpuMemorySummary(latest.gpus),
        axisFormatter = percentAxis
      ) to DeviceBlockKey.Gpu
    )
  }
  val cpuTemp = cpuTemperaturePoints(data)
  val gpuTemp = gpuTemperaturePoints(data)
  if (cpuTemp.isNotEmpty() || gpuTemp.isNotEmpty()) {
    add(
      ChartCardModel(
        title = "温度",
        series = buildList {
          if (cpuTemp.isNotEmpty()) add(ChartSeriesModel("CPU", cpuTemp, 3))
          if (gpuTemp.isNotEmpty()) add(ChartSeriesModel("显卡", gpuTemp, 1))
        },
        valueFormatter = ::formatCelsius,
        includeZero = false,
        thresholds = temperatureThresholds(AttentionThresholds.CPU_TEMP_WARNING, AttentionThresholds.CPU_TEMP_CRITICAL),
        tone = toneFor(cpuLatestTemperature(data), AttentionThresholds.CPU_TEMP_WARNING, AttentionThresholds.CPU_TEMP_CRITICAL),
        note = "全部温度源见「硬件 › 温度」"
      ) to DeviceBlockKey.Temperature
    )
  }
}

/* ---------------- 硬件 ---------------- */

private fun LazyListScope.hardwareItems(
  data: MetricsDto?,
  state: AppState,
  actions: GuanlanActions,
  stale: Boolean,
  displayWindow: MetricWindow,
  openBlock: DeviceBlockKey?,
  tabs: List<BlockSheetTabModel>,
  effectiveTab: String,
  onSelectTab: (String) -> Unit,
  onOpenBlock: (DeviceBlockKey) -> Unit,
  onCloseBlock: () -> Unit
) {
  if (loadingOrError(data, state, actions)) return
  val snapshot = data ?: return
  if (openBlock == null) {
    item(key = "categories") {
      val capsules = remember(snapshot, displayWindow) { buildOverviewCapsules(snapshot, displayWindow) }
      OneUiStaleGroup(stale = stale) {
        OneUiGroup {
          capsules.forEachIndexed { index, capsule ->
            if (index > 0) OneUiListDivider()
            OneUiListItem(
              title = capsule.title,
              subtitle = capsule.metrics.joinToString(" · ") { (label, value) -> if (value.startsWith(label)) value else "$label $value" },
              overline = capsule.subtitle,
              onClick = { onOpenBlock(capsule.blockKey) },
              leading = { OneUiLeadingIcon(icon = blockIcon(capsule.blockKey), contentDescription = null, tone = OneUiIconTone.Neutral) },
              trailing = { OneUiIcon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = OneUiTheme.colors.textTertiary) }
            )
          }
        }
      }
    }
    return
  }

  item(key = "block-header:${openBlock.name}") {
    val colors = OneUiTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
      OneUiIconButton(contentDescription = "返回全部类别", onClick = onCloseBlock) {
        OneUiIcon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = null, tint = colors.textPrimary)
      }
      Column(modifier = Modifier.weight(1f)) {
        OneUiText(text = openBlock.label, role = OneUiTextRole.Title)
        OneUiText(text = "读数为当前值；图下为所选时间范围内的均值与峰值", role = OneUiTextRole.ChartLabel, color = colors.textTertiary)
      }
      if (openBlock != DeviceBlockKey.Fan) {
        OneUiIconButton(contentDescription = "编辑${openBlock.label}的记录项", onClick = { actions.onOpenBlockEditor(snapshot.device.deviceId, openBlock) }) {
          OneUiIcon(Icons.Rounded.Tune, contentDescription = null, tint = colors.textSecondary, size = OneUiTheme.metrics.iconFilledSize)
        }
      }
    }
  }
  item(key = "block-detail:${openBlock.name}") {
    OneUiStaleGroup(stale = stale) {
      BlockDetail(
        data = snapshot,
        blockKey = openBlock,
        tabs = tabs,
        tabId = effectiveTab,
        selectedWindow = displayWindow,
        onSelectTab = onSelectTab,
        onEditInstance = { instanceId -> actions.onOpenInstanceEditor(snapshot.device.deviceId, openBlock, instanceId) }
      )
    }
  }
}

private fun blockIcon(block: DeviceBlockKey) = when (block) {
  DeviceBlockKey.Cpu -> Icons.Rounded.Memory
  DeviceBlockKey.Gpu -> Icons.Rounded.VideogameAsset
  DeviceBlockKey.Memory -> Icons.Rounded.Storage
  DeviceBlockKey.Disk -> Icons.Rounded.Dns
  DeviceBlockKey.Storage -> Icons.Rounded.Layers
  DeviceBlockKey.Network -> Icons.Rounded.Router
  DeviceBlockKey.Temperature -> Icons.Rounded.Thermostat
  DeviceBlockKey.Fan -> Icons.Rounded.Air
}


/**
 * 类别明细本体（件）：实例胶囊行 + 图表与元信息。
 *
 * 底部面板与双栏右栏共用它——同一套内容不该有两个版本，
 * 否则宽屏下的明细永远比手机上少一层交互（构 + 适）。
 */
@Composable
private fun BlockDetail(
  data: MetricsDto,
  blockKey: DeviceBlockKey,
  tabs: List<BlockSheetTabModel>,
  tabId: String,
  selectedWindow: MetricWindow,
  onSelectTab: (String) -> Unit,
  onEditInstance: (String) -> Unit
) {
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  val chartWindow = remember(data, selectedWindow) { chartWindowFor(data, selectedWindow) }

  Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceM)) {
    if (tabs.size > 1) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
      ) {
        tabs.forEach { tab ->
          OneUiFilterChip(
            label = tab.label,
            selected = tab.id == tabId,
            onClick = { onSelectTab(tab.id) }
          )
        }
      }
    }
    // 同页切换（总和/实例）=横向轻推 + 淡入淡出，而不是整块闪现（动）
    AnimatedContent(
      targetState = tabId,
      transitionSpec = {
        oneUiSlideSwitch(
          forwardToRight = tabs.indexOfFirst { it.id == targetState } >= tabs.indexOfFirst { it.id == initialState },
          motion = motion
        )
      },
      label = "oneui_block_tab"
    ) { currentTab ->
      // AnimatedContent 的内容是 Box：图表网格与参数表必须包进 Column，否则会叠在一起
      Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceM)) {
        BlockTabContent(
          data = data,
          blockKey = blockKey,
          tabId = currentTab,
          selectedWindow = selectedWindow,
          chartWindow = chartWindow,
          onEditInstance = onEditInstance
        )
      }
    }
  }
}

@Composable
private fun BlockTabContent(
  data: MetricsDto,
  blockKey: DeviceBlockKey,
  tabId: String,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow,
  onEditInstance: (String) -> Unit
) {
  when (blockKey) {
    DeviceBlockKey.Cpu -> CpuTab(data, tabId, selectedWindow, chartWindow, onEditInstance)
    DeviceBlockKey.Memory -> MemoryTab(data, selectedWindow, chartWindow)
    DeviceBlockKey.Disk -> DiskTab(data, tabId, selectedWindow, chartWindow, onEditInstance)
    DeviceBlockKey.Storage -> StorageTab(data, selectedWindow, chartWindow)
    DeviceBlockKey.Network -> NetworkTab(data, tabId, selectedWindow, chartWindow, onEditInstance)
    DeviceBlockKey.Gpu -> GpuTab(data, tabId, selectedWindow, chartWindow, onEditInstance)
    DeviceBlockKey.Temperature -> TemperatureTab(data, selectedWindow, chartWindow)
    DeviceBlockKey.Fan -> FanTab(data, tabId, chartWindow)
  }
}

@Composable
private fun CpuTab(
  data: MetricsDto,
  tabId: String,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow,
  onEditInstance: (String) -> Unit
) {
  val colors = OneUiTheme.colors
  if (tabId == "total") {
    val temperature = cpuTemperaturePoints(data)
    OneUiChartCardGrid(
      cards = buildList {
        add(cpuUsageCard("CPU 占用", data.series.cpuUsagePercent))
        add(ChartCardModel(title = "CPU 频率", series = listOf(ChartSeriesModel("频率", data.series.cpuFrequencyMHz, 1)), valueFormatter = ::formatMHz, includeZero = false))
        if (temperature.isNotEmpty()) add(cpuTemperatureCard("CPU 温度", temperature))
      },
      chartWindow = chartWindow
    )
    if (!isMetricAvailable(data, "cpuTemperature")) {
      OneUiText(text = "当前设备未提供 CPU 温度传感器。", role = OneUiTextRole.RowSubtitle, color = colors.textSecondary)
    }
    OneUiMetaTable(
      items = listOf(
        "处理器" to (data.device.cpuModel ?: "未知"),
        "包数量" to data.latest.cpuPackages.size.toString(),
        "L3 缓存" to formatOptionalBytes(data.latest.cpuPackages.mapNotNull { it.l3CacheBytes }.takeIf { it.isNotEmpty() }?.sum()),
        "进程 / 线程 / 句柄" to "${data.latest.system.processCount} / ${data.latest.system.threadCount} / ${data.latest.system.handleCount}",
        "平台" to "${data.device.platform} / ${data.device.arch}"
      ),
      collapsible = true,
      defaultExpanded = false
    )
    return
  }

  val cpu = data.series.cpus.firstOrNull { it.id == tabId } ?: return
  InstanceGroup(
    title = cpu.name,
    subtitle = listOfNotNull(cpu.model, cpu.coreCount?.let { "$it 核" }, cpu.logicalCount?.let { "$it 线程" }).joinToString(" · "),
    onEdit = { onEditInstance(cpu.id) }
  ) {
    OneUiChartCardGrid(
      cards = buildList {
        add(cpuUsageCard("占用", cpu.usagePercent))
        add(ChartCardModel(title = "频率", series = listOf(ChartSeriesModel("频率", cpu.frequencyMHz, 1)), valueFormatter = ::formatMHz, includeZero = false))
        validTemperaturePoints(cpu.temperatureC).takeIf { it.isNotEmpty() }?.let { add(cpuTemperatureCard("温度", it)) }
      },
      chartWindow = chartWindow
    )
    OneUiMetaTable(
      items = listOf(
        "型号" to (cpu.model ?: "未知"),
        "核心 / 线程" to "${cpu.coreCount ?: "--"} / ${cpu.logicalCount ?: "--"}",
        "L3 缓存" to formatOptionalBytes(cpu.l3CacheBytes)
      ),
      collapsible = true,
      defaultExpanded = false
    )
  }
}

private fun cpuUsageCard(title: String, points: List<SamplePointDto>): ChartCardModel = ChartCardModel(
  title = title,
  series = listOf(ChartSeriesModel(title, points, 0)),
  valueFormatter = ::formatPercent,
  fixedMaxValue = 100.0,
  thresholds = usageThresholds(AttentionThresholds.CPU_WARNING, AttentionThresholds.CPU_CRITICAL),
  tone = toneFor(com.dsc.android.seriesStats(points)?.latest, AttentionThresholds.CPU_WARNING, AttentionThresholds.CPU_CRITICAL),
  axisFormatter = percentAxis
)

private fun cpuTemperatureCard(title: String, points: List<SamplePointDto>): ChartCardModel = ChartCardModel(
  title = title,
  series = listOf(ChartSeriesModel(title, points, 3)),
  valueFormatter = ::formatCelsius,
  includeZero = false,
  thresholds = temperatureThresholds(AttentionThresholds.CPU_TEMP_WARNING, AttentionThresholds.CPU_TEMP_CRITICAL),
  tone = toneFor(com.dsc.android.seriesStats(points)?.latest, AttentionThresholds.CPU_TEMP_WARNING, AttentionThresholds.CPU_TEMP_CRITICAL)
)

/**
 * 内存：旧版 11 张同质小图（物理/虚拟/可用/缓存/已提交/上限/已用/Swap/进程/线程/句柄）合并成三个问题——
 * 占用多少（物理 + Swap 同图）、被谁占（已用 / 缓存 / 可用同图）、会不会提交满（已提交 vs 上限）。
 */
@Composable
private fun MemoryTab(data: MetricsDto, selectedWindow: MetricWindow, chartWindow: ChartWindow) {
  val latest = data.latest
  val series = data.series
  val bytes: (Double?) -> String = { formatBytes(it ?: 0.0) }
  val memNow = com.dsc.android.seriesStats(series.memoryUsagePercent)?.latest
  OneUiChartCardGrid(
    cards = buildList {
      add(
        ChartCardModel(
          title = "占用率",
          series = buildList {
            add(ChartSeriesModel("物理", series.memoryUsagePercent, 1))
            if (latest.swapTotalBytes > 0) add(ChartSeriesModel("Swap", series.swapUsagePercent, 3))
          },
          valueFormatter = ::formatPercent,
          fixedMaxValue = 100.0,
          headlineCaption = "当前 · ${buildUsage(latest.memoryUsedBytes, latest.memoryTotalBytes)}",
          thresholds = usageThresholds(AttentionThresholds.MEMORY_WARNING, AttentionThresholds.MEMORY_CRITICAL),
          tone = toneFor(memNow, AttentionThresholds.MEMORY_WARNING, AttentionThresholds.MEMORY_CRITICAL),
          axisFormatter = percentAxis,
          note = if (latest.swapTotalBytes > 0) "Swap ${buildUsage(latest.swapUsedBytes, latest.swapTotalBytes)}" else "未配置 Swap"
        )
      )
      if (series.memoryAvailableBytes.isNotEmpty() || series.memoryCachedBytes.isNotEmpty()) {
        add(
          ChartCardModel(
            title = "构成",
            series = listOf(
              ChartSeriesModel("已用", series.memoryUsedBytes, 1),
              ChartSeriesModel("缓存", series.memoryCachedBytes, 2),
              ChartSeriesModel("可用", series.memoryAvailableBytes, 5)
            ),
            valueFormatter = bytes,
            headline = formatBytes(latest.memoryAvailableBytes.toDouble()),
            headlineCaption = "当前可用",
            fixedMaxValue = latest.memoryTotalBytes.takeIf { it > 0 }?.toDouble()
          )
        )
      }
      if (series.memoryCommittedBytes.isNotEmpty() && latest.memoryCommitLimitBytes > 0) {
        val limit = latest.memoryCommitLimitBytes.toDouble()
        add(
          ChartCardModel(
            title = "已提交",
            series = listOf(ChartSeriesModel("已提交", series.memoryCommittedBytes, 0)),
            valueFormatter = bytes,
            headlineCaption = "当前 · 上限 ${formatBytes(limit)}",
            thresholds = listOf(ChartThreshold(limit, "上限", ChartThresholdTone.Critical)),
            note = "提交量逼近上限时新的内存申请会失败"
          )
        )
      }
      if (series.systemProcessCount.isNotEmpty()) {
        add(
          ChartCardModel(
            title = "进程数",
            series = listOf(ChartSeriesModel("进程", series.systemProcessCount, 4)),
            valueFormatter = { it?.toInt()?.toString() ?: "--" },
            includeZero = false,
            note = "线程 ${latest.system.threadCount} · 句柄 ${latest.system.handleCount}"
          )
        )
      }
    },
    chartWindow = chartWindow
  )
  OneUiMetaTable(
    items = listOf(
      "物理内存" to buildUsage(latest.memoryUsedBytes, latest.memoryTotalBytes),
      "可用" to formatBytes(latest.memoryAvailableBytes.toDouble()),
      "缓存" to formatBytes(latest.memoryCachedBytes.toDouble()),
      "Swap" to buildUsage(latest.swapUsedBytes, latest.swapTotalBytes),
      "已提交 / 上限" to "${formatBytes(latest.memoryCommittedBytes.toDouble())} / ${formatOptionalBytes(latest.memoryCommitLimitBytes)}",
      "频率" to (latest.memorySpeedMHz?.let { formatMHz(it) } ?: "未知"),
      "插槽" to (latest.memorySlotCount?.toString() ?: "未知"),
      "形态" to (latest.memoryFormFactor ?: "未知")
    ),
    collapsible = true,
    defaultExpanded = false
  )
}

private fun ioCard(title: String, read: List<SamplePointDto>, write: List<SamplePointDto>): ChartCardModel = ChartCardModel(
  title = title,
  series = listOf(ChartSeriesModel("读取", read, 0), ChartSeriesModel("写入", write, 2)),
  valueFormatter = ::formatSpeed,
  headlineCaption = "当前读取 · 写入 ${formatSpeed(com.dsc.android.seriesStats(write)?.latest)}"
)

private fun capacityCard(title: String, points: List<SamplePointDto>, usage: String): ChartCardModel = ChartCardModel(
  title = title,
  series = listOf(ChartSeriesModel("占用", points, 2)),
  valueFormatter = ::formatPercent,
  fixedMaxValue = 100.0,
  headlineCaption = "当前 · $usage",
  thresholds = usageThresholds(AttentionThresholds.DISK_WARNING, AttentionThresholds.DISK_CRITICAL),
  tone = toneFor(com.dsc.android.seriesStats(points)?.latest, AttentionThresholds.DISK_WARNING, AttentionThresholds.DISK_CRITICAL),
  axisFormatter = percentAxis
)

@Composable
private fun DiskTab(
  data: MetricsDto,
  tabId: String,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow,
  onEditInstance: (String) -> Unit
) {
  if (tabId == "total") {
    OneUiChartCardGrid(
      cards = listOf(
        capacityCard("总占用", data.series.diskUsagePercent, buildUsage(data.latest.diskUsedBytes, data.latest.diskTotalBytes)),
        ioCard("总读写", data.series.diskReadBytesPerSec, data.series.diskWriteBytesPerSec)
      ),
      chartWindow = chartWindow
    )
    if (data.latest.disks.isNotEmpty()) {
      OneUiMetaTable(
        title = "各分区",
        items = data.latest.disks.map { disk ->
          val percent = if (disk.totalBytes > 0) disk.usedBytes.toDouble() / disk.totalBytes * 100 else null
          "${disk.name} ${disk.mountPoint}".trim() to "${formatPercent(percent)} · ${buildUsage(disk.usedBytes, disk.totalBytes)}"
        }
      )
    }
    return
  }

  val disk = data.latest.disks.firstOrNull { it.id == tabId } ?: return
  val series = data.series.disks.firstOrNull { it.id == tabId }
  InstanceGroup(
    title = disk.name,
    subtitle = listOfNotNull(disk.mountPoint, disk.filesystem, disk.model?.takeIf { it.isNotBlank() }).joinToString(" · "),
    onEdit = { onEditInstance(disk.id) }
  ) {
    DiskTiles(disk, series, chartWindow)
    OneUiMetaTable(
      items = buildList {
        add("接口" to (disk.interfaceType ?: "未知"))
        add("温度" to (validDiskTemperature(disk.temperatureC)?.let(::formatCelsius) ?: "未知"))
        add("活动" to (disk.activePercent?.let { formatPercent(it) } ?: "未知"))
        add("响应" to (disk.averageResponseMs?.let { String.format("%.1f ms", it) } ?: "未知"))
        disk.healthStatus?.let { add("健康" to formatDiskHealth(it)) }
        disk.healthPercent?.let { add("寿命" to formatPercent(it)) }
        disk.healthReason?.let { add("健康来源" to it) }
        disk.smartAttributes.forEach { attribute ->
          add("SMART ${attribute.id}" to "${attribute.name}: ${attribute.value.toInt()} / 阈值 ${attribute.threshold.toInt()}")
        }
      },
      collapsible = true,
      defaultExpanded = false
    )
  }
}

@Composable
private fun DiskTiles(disk: DiskDto, series: DiskMetricSeriesDto?, chartWindow: ChartWindow) {
  val temperaturePoints = series?.temperatureC.orEmpty().filter { validDiskTemperature(it.value) != null }
  OneUiChartCardGrid(
    cards = buildList {
      add(capacityCard("容量", series?.usagePercent.orEmpty(), buildUsage(disk.usedBytes, disk.totalBytes)))
      add(ioCard("读写", series?.readBytesPerSec.orEmpty(), series?.writeBytesPerSec.orEmpty()))
      if (temperaturePoints.isNotEmpty()) {
        add(
          ChartCardModel(
            title = "温度",
            series = listOf(ChartSeriesModel("温度", temperaturePoints, 3)),
            valueFormatter = ::formatCelsius,
            includeZero = false,
            thresholds = temperatureThresholds(AttentionThresholds.DISK_TEMP_WARNING, AttentionThresholds.DISK_TEMP_CRITICAL),
            tone = toneFor(validDiskTemperature(disk.temperatureC), AttentionThresholds.DISK_TEMP_WARNING, AttentionThresholds.DISK_TEMP_CRITICAL)
          )
        )
      }
    },
    chartWindow = chartWindow
  )
}

@Composable
private fun StorageTab(
  data: MetricsDto,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val pools = data.latest.storagePools
  if (pools.isEmpty()) {
    OneUiText(
      text = "未检测到存储池；Proxmox 存储、LVM 精简池、ZFS 池与网络共享会显示在这里。",
      role = OneUiTextRole.RowSubtitle,
      color = colors.textSecondary
    )
    return
  }
  val seriesById = data.series.storagePools.associateBy { it.id }
  val activePools = pools.filter { it.active != false && it.totalBytes > 0 }
  val fullest = activePools.maxByOrNull { it.usedBytes.toDouble() / it.totalBytes.coerceAtLeast(1) }
  Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceM)) {
    OneUiMetricTileGrid(
      cards = listOf(
        MetricCardModel(
          "最高占用",
          fullest?.let { "${it.name} ${formatPercent(it.usedBytes.toDouble() / it.totalBytes * 100)}" } ?: "暂无",
          fullest?.let { seriesById[it.id]?.usagePercent.orEmpty() } ?: emptyList(),
          ::formatPercent,
          100.0
        ),
        MetricCardModel(
          "总容量",
          formatBytes(pools.sumOf { it.totalBytes }.toDouble()),
          emptyList(),
          { formatBytes(it ?: 0.0) }
        ),
        MetricCardModel(
          "已用",
          formatBytes(pools.sumOf { it.usedBytes }.toDouble()),
          emptyList(),
          { formatBytes(it ?: 0.0) }
        )
      ),
      chartWindow = chartWindow
    )
    pools.forEach { pool ->
      val poolSeries = seriesById[pool.id]
      val subtitle = listOfNotNull(
        storagePoolKindLabel(pool.kind),
        pool.node?.takeIf { it.isNotBlank() },
        pool.mountPoint?.takeIf { it.isNotBlank() } ?: pool.device?.takeIf { it.isNotBlank() }
      ).joinToString(" · ")
      InstanceGroup(title = pool.name, subtitle = subtitle, onEdit = null) {
        OneUiMetricTileGrid(
          cards = listOf(
            MetricCardModel(
              "容量",
              buildUsage(pool.usedBytes, pool.totalBytes),
              poolSeries?.usagePercent.orEmpty(),
              ::formatPercent,
              100.0
            ),
            MetricCardModel(
              "可用",
              formatOptionalBytes(pool.availableBytes),
              poolSeries?.availableBytes.orEmpty(),
              ::formatOptionalBytes
            )
          ),
          chartWindow = chartWindow
        )
        OneUiMetaTable(
          items = buildList {
            add("类型" to storagePoolKindLabel(pool.kind))
            pool.node?.takeIf { it.isNotBlank() }?.let { add("节点" to it) }
            pool.mountPoint?.takeIf { it.isNotBlank() }?.let { add("挂载点" to it) }
            pool.device?.takeIf { it.isNotBlank() }?.let { add("设备" to it) }
            pool.volumeGroup?.takeIf { it.isNotBlank() }?.let { add("卷组" to it) }
            pool.thinPool?.takeIf { it.isNotBlank() }?.let { add("精简池" to it) }
            pool.physicalDevices.takeIf { it.isNotEmpty() }?.let { add("所在磁盘" to it.joinToString("、")) }
            pool.content.takeIf { it.isNotEmpty() }?.let { add("用途" to it.joinToString(" / ", transform = ::storagePoolContentLabel)) }
            pool.dataPercent?.let { add("精简池分配" to formatPercent(it)) }
            pool.metadataPercent?.let { add("精简池元数据" to formatPercent(it)) }
            add(
              "状态" to when {
                pool.active == false || pool.enabled == false -> "未启用"
                pool.shared == true -> "共享存储"
                else -> "活动"
              }
            )
            pool.health?.takeIf { it.isNotBlank() }?.let { add("健康" to it) }
          },
          collapsible = true,
          defaultExpanded = false
        )
      }
    }
  }
}

@Composable
private fun NetworkTab(
  data: MetricsDto,
  tabId: String,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow,
  onEditInstance: (String) -> Unit
) {
  val bytes: (Double?) -> String = { formatBytes(it ?: 0.0) }
  if (tabId == "total") {
    OneUiChartCardGrid(
      cards = listOf(
        rateCard("速率", data.series.networkRxBytesPerSec, data.series.networkTxBytesPerSec),
        ChartCardModel(
          title = "累计流量",
          series = listOf(
            ChartSeriesModel("接收", data.series.trafficRxBytes, 0),
            ChartSeriesModel("发送", data.series.trafficTxBytes, 2)
          ),
          valueFormatter = bytes,
          headlineCaption = "累计接收 · 发送 ${bytes(data.series.trafficTxBytes.lastOrNull()?.value)}",
          includeZero = false
        )
      ),
      chartWindow = chartWindow
    )
    return
  }

  val nic = data.latest.networkInterfaces.firstOrNull { it.id == tabId } ?: return
  val series = data.series.networks.firstOrNull { it.id == tabId }
  InstanceGroup(
    title = nic.name,
    subtitle = listOfNotNull(nic.ipv4.firstOrNull(), nic.macAddress?.takeIf { it.isNotBlank() }).joinToString(" · "),
    onEdit = { onEditInstance(nic.id) }
  ) {
    OneUiChartCardGrid(
      cards = listOf(
        rateCard("速率", series?.rxBytesPerSec.orEmpty(), series?.txBytesPerSec.orEmpty(), nic.linkSpeedMbps),
        ChartCardModel(
          title = "累计流量",
          series = listOf(
            ChartSeriesModel("接收", series?.trafficRxBytes.orEmpty(), 0),
            ChartSeriesModel("发送", series?.trafficTxBytes.orEmpty(), 2)
          ),
          valueFormatter = bytes,
          headline = formatBytes(nic.totalRxBytes?.toDouble() ?: 0.0),
          headlineCaption = "累计接收 · 发送 ${formatBytes(nic.totalTxBytes?.toDouble() ?: 0.0)}",
          includeZero = false
        )
      ),
      chartWindow = chartWindow
    )
    OneUiMetaTable(
      items = listOfNotNull(
        "IPv4" to nic.ipv4.joinToString(", ").ifBlank { "未知" },
        "IPv6" to nic.ipv6.joinToString(", ").ifBlank { "未知" },
        "链路" to (nic.linkSpeedMbps?.let { String.format("%.0f Mbps", it) } ?: "未知"),
        "连接" to (nic.connectionType ?: "未知"),
        "信号" to (nic.signalStrengthPercent?.let { formatPercent(it) } ?: "未知")
      )
    )
  }
}

/** 收发同图；已知链路速率时注明占满带宽是多少，读者才知道 80 MB/s 算不算快。 */
private fun rateCard(title: String, rx: List<SamplePointDto>, tx: List<SamplePointDto>, linkMbps: Double? = null): ChartCardModel = ChartCardModel(
  title = title,
  series = listOf(ChartSeriesModel("接收", rx, 0), ChartSeriesModel("发送", tx, 2)),
  valueFormatter = ::formatSpeed,
  headlineCaption = "当前接收 · 发送 ${formatSpeed(com.dsc.android.seriesStats(tx)?.latest)}",
  note = linkMbps?.takeIf { it > 0 }?.let { "链路 ${String.format("%.0f", it)} Mbps，满速约 ${formatSpeed(it * 1_000_000 / 8)}" }
)

@Composable
private fun GpuTab(
  data: MetricsDto,
  tabId: String,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow,
  onEditInstance: (String) -> Unit
) {
  if (tabId == "total") {
    val temperaturePoints = gpuTemperaturePoints(data)
    OneUiChartCardGrid(
      cards = buildList {
        add(
          ChartCardModel(
            title = "占用与显存",
            series = listOf(
              ChartSeriesModel("占用", data.series.gpuUsagePercent, 1),
              ChartSeriesModel("显存", data.series.gpuMemoryUsagePercent, 2)
            ),
            valueFormatter = ::formatPercent,
            fixedMaxValue = 100.0,
            note = formatGpuMemorySummary(data.latest.gpus),
            axisFormatter = percentAxis
          )
        )
        if (temperaturePoints.isNotEmpty()) add(gpuTemperatureCard("温度", temperaturePoints))
      },
      chartWindow = chartWindow
    )
    return
  }

  val gpu = data.latest.gpus.firstOrNull { it.id == tabId } ?: return
  val series = data.series.gpus.firstOrNull { it.id == tabId }
  InstanceGroup(title = gpu.name, subtitle = if (gpu.integrated) "集成显卡" else "独立显卡", onEdit = { onEditInstance(gpu.id) }) {
    GpuTiles(gpu, series, chartWindow, selectedWindow)
    OneUiMetaTable(
      items = listOfNotNull(
        "驱动" to (gpu.driverVersion ?: "未知"),
        "类型" to if (gpu.integrated) "集成显卡" else "独立显卡",
        "显存类型" to gpuMemoryLabel(gpu.memoryKind ?: series?.memoryKind),
        "温度源" to gpuTemperatureSourceLabel(gpu.temperatureSource ?: series?.temperatureSource),
        gpuMemoryLabel(gpu.memoryKind) to buildGpuUsage(gpu.memoryUsedBytes, gpu.memoryTotalBytes),
        "设备 ID" to gpu.id
      ),
      collapsible = true,
      defaultExpanded = false
    )
  }
}

private fun gpuTemperatureCard(title: String, points: List<SamplePointDto>): ChartCardModel = ChartCardModel(
  title = title,
  series = listOf(ChartSeriesModel(title, points, 3)),
  valueFormatter = ::formatCelsius,
  includeZero = false,
  thresholds = temperatureThresholds(AttentionThresholds.GPU_TEMP_WARNING, AttentionThresholds.GPU_TEMP_CRITICAL),
  tone = toneFor(com.dsc.android.seriesStats(points)?.latest, AttentionThresholds.GPU_TEMP_WARNING, AttentionThresholds.GPU_TEMP_CRITICAL)
)

@Composable
private fun GpuTiles(
  gpu: GpuDto,
  series: GpuMetricSeriesDto?,
  chartWindow: ChartWindow,
  selectedWindow: MetricWindow
) {
  val memoryLabel = gpuMemoryLabel(gpu.memoryKind)
  OneUiChartCardGrid(
    cards = buildList {
      add(
        ChartCardModel(
          title = "引擎占用",
          series = buildList {
            add(ChartSeriesModel("3D/计算", series?.usagePercent.orEmpty(), 1))
            if (series?.encodePercent?.isNotEmpty() == true) add(ChartSeriesModel("编码", series.encodePercent, 0))
            if (series?.decodePercent?.isNotEmpty() == true) add(ChartSeriesModel("解码", series.decodePercent, 2))
          },
          valueFormatter = ::formatPercent,
          fixedMaxValue = 100.0,
          headline = formatPercent(gpu.utilizationPercent),
          axisFormatter = percentAxis
        )
      )
      add(
        ChartCardModel(
          title = memoryLabel,
          series = listOf(ChartSeriesModel(memoryLabel, series?.memoryUsagePercent.orEmpty(), 2)),
          valueFormatter = ::formatPercent,
          fixedMaxValue = 100.0,
          headlineCaption = "当前 · ${buildGpuUsage(gpu.memoryUsedBytes, gpu.memoryTotalBytes)}",
          thresholds = listOf(ChartThreshold(AttentionThresholds.GPU_MEMORY_WARNING, "${AttentionThresholds.GPU_MEMORY_WARNING.toInt()}%", ChartThresholdTone.Warning)),
          axisFormatter = percentAxis
        )
      )
      if (series?.frequencyMHz?.isNotEmpty() == true) {
        add(ChartCardModel(title = "频率", series = listOf(ChartSeriesModel("频率", series.frequencyMHz, 4)), valueFormatter = ::formatMHz, includeZero = false))
      }
      val temperature = validTemperaturePoints(series?.temperatureC.orEmpty())
      if (temperature.isNotEmpty()) {
        add(gpuTemperatureCard(if ((gpu.temperatureSource ?: series?.temperatureSource) == "cpuPackageShared") "温度（随 CPU）" else "温度", temperature))
      }
    },
    chartWindow = chartWindow
  )
}

@Composable
private fun FanTab(data: MetricsDto, tabId: String, chartWindow: ChartWindow) {
  val colors = OneUiTheme.colors
  val fans = fanInstancesForDisplay(data)
  if (tabId == "total") {
    if (data.latest.sensorBackends.isNotEmpty()) {
      OneUiMetaTable(
        title = "采集后端",
        items = data.latest.sensorBackends.map {
          it.label to "${if (it.ok) "可用" else "不可用"}${it.detail?.let { detail -> " · $detail" } ?: ""}"
        }
      )
    }
    if (fans.isEmpty()) {
      OneUiNotice(
        title = "尚未收到风扇样本",
        description = "请先在 Agent 设置中重新检测硬件并启动采集。",
        tone = OneUiNoticeTone.Neutral
      )
    } else {
      OneUiMetricTileGrid(
        cards = fans.map { fan ->
          val series = data.series.fans.firstOrNull { it.id == fan.id }
          MetricCardModel(
            "风扇转速 · ${fan.label}",
            fanCurrentLabel(fan),
            series?.rpm.orEmpty(),
            valueFormatter = { if (it == null) "--" else "${it.toInt()} RPM" }
          )
        },
        chartWindow = chartWindow
      )
    }
    return
  }

  val fan = fans.firstOrNull { it.id == tabId } ?: return
  val series = data.series.fans.firstOrNull { it.id == fan.id }
  InstanceGroup(title = fan.label, subtitle = fan.interfaceName ?: fan.interfaceRaw ?: "风扇实例", onEdit = null) {
    OneUiMetricTileGrid(
      cards = listOf(
        MetricCardModel(
          "风扇转速",
          fanCurrentLabel(fan),
          series?.rpm.orEmpty(),
          valueFormatter = { if (it == null) "--" else "${it.toInt()} RPM" }
        )
      ),
      chartWindow = chartWindow
    )
    OneUiMetaTable(
      items = listOfNotNull(
        "转速" to fanCurrentLabel(fan),
        if (data.latest.fans.any { it.id == fan.id }) "采样时间" to formatTime(data.latest.hardwareSampledAt) else null,
        "控制" to (fan.controlMode ?: "未知"),
        "目标温度" to (fan.targetTemperatureC?.let { formatCelsius(it) } ?: "未知"),
        "PWM" to if (fan.minPwmPercent != null || fan.maxPwmPercent != null) {
          "${fan.minPwmPercent ?: "--"}-${fan.maxPwmPercent ?: "--"}%"
        } else {
          "未知"
        },
        "通道" to (fan.channelState ?: "未知")
      )
    )
  }
}

/** 温度类别：设备温度按实例给图，温度源单独成组并支持诊断模式（保留原语义）。 */
@Composable
private fun TemperatureTab(data: MetricsDto, selectedWindow: MetricWindow, chartWindow: ChartWindow) {
  val colors = OneUiTheme.colors
  val summaryCards = buildTemperatureSummaryCards(data, selectedWindow)
  if (summaryCards.isNotEmpty()) {
    OneUiSubHeader("设备温度（按实例）")
    OneUiMetricTileGrid(cards = summaryCards, chartWindow = chartWindow)
  }

  if (data.latest.temperatureSensors.isEmpty() && data.series.temperatureSensors.isEmpty()) {
    OneUiText(
      text = "当前没有独立温度源；CPU、显卡或硬盘温度仍会在对应类别中显示。",
      role = OneUiTextRole.RowSubtitle,
      color = colors.textSecondary
    )
    return
  }

  OneUiSubHeader("全部温度源")
  TemperatureSourcesGroup(
    sensors = data.latest.temperatureSensors,
    series = data.series.temperatureSensors,
    selectedWindow = selectedWindow,
    chartWindow = chartWindow
  )
}

@Composable
private fun TemperatureSourcesGroup(
  sensors: List<TemperatureSensorDto>,
  series: List<TemperatureMetricSeriesDto>,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow
) {
  val colors = OneUiTheme.colors
  var diagnostics by remember { mutableStateOf(false) }
  var expandedId by remember { mutableStateOf<String?>(null) }
  val chartableSeries = series.filter { diagnostics || it.status == "valid" }
  val latestById = sensors.associateBy { it.id }
  val rows = buildTemperatureRows(sensors, series, latestById, diagnostics)

  OneUiGroup {
    OneUiListItem(
      title = "诊断模式",
      subtitle = "显示阈值、无效值与不可用的温度通道",
      trailing = {
        OneUiSwitch(checked = diagnostics, onCheckedChange = { diagnostics = it }, label = "诊断模式")
      },
      onClick = { diagnostics = !diagnostics }
    )
    OneUiListDivider()
    if (rows.isEmpty()) {
      OneUiListItem(
        title = if (sensors.isEmpty() && series.isEmpty()) "当前没有独立温度源" else "当前只有无效或诊断温度通道",
        subtitle = "开启诊断模式可查看被过滤掉的通道。"
      )
    } else {
      rows.forEachIndexed { index, row ->
        if (index > 0) OneUiListDivider()
        val chartable = chartableSeries.any { it.id == row.id }
        val toggleChart: () -> Unit = { expandedId = if (expandedId == row.id) null else row.id }
        OneUiListItem(
          title = row.title,
          subtitle = row.subtitle,
          onClick = if (chartable) toggleChart else null,
          trailing = {
            Column(horizontalAlignment = Alignment.End) {
              OneUiText(text = row.value, role = OneUiTextRole.Metric, color = colors.textPrimary)
              OneUiText(
                text = if (chartable) "图表" else row.status,
                role = OneUiTextRole.ChartLabel,
                color = if (chartable) colors.accent else colors.textTertiary
              )
            }
          },
          supporting = {
            Column(modifier = Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
              row.limits?.let {
                OneUiText(text = it, role = OneUiTextRole.ChartLabel, color = colors.textTertiary)
              }
              AnimatedVisibility(visible = expandedId == row.id) {
                val points = chartableSeries.firstOrNull { it.id == row.id }?.currentC.orEmpty()
                OneUiLineChart(
                  points = points,
                  chartWindow = chartWindow,
                  valueFormatter = ::formatCelsius,
                  title = row.title,
                  height = OneUiTheme.metrics.chartMinHeight,
                  modifier = Modifier.padding(top = 6.dp)
                )
              }
            }
          }
        )
      }
    }
  }
}

private data class TemperatureRow(
  val id: String,
  val title: String,
  val subtitle: String,
  val value: String,
  val status: String,
  val limits: String?
)

private fun buildTemperatureRows(
  sensors: List<TemperatureSensorDto>,
  series: List<TemperatureMetricSeriesDto>,
  latestById: Map<String, TemperatureSensorDto>,
  diagnostics: Boolean
): List<TemperatureRow> = buildList {
  sensors.forEach { sensor ->
    if (!diagnostics && sensor.status != "valid") return@forEach
    add(
      TemperatureRow(
        id = sensor.id,
        title = sensor.displayName ?: sensor.rawName,
        subtitle = listOfNotNull(
          temperatureRoleLabel(sensor.role),
          temperatureSourceLabel(sensor.source),
          sensor.backend?.takeIf { it.isNotBlank() },
          sensor.observedAt?.let { "采样 ${formatTime(it)}" }
        ).joinToString(" · "),
        value = temperatureValueLabel(sensor),
        status = temperatureStatusLabel(sensor.status),
        limits = temperatureLimitsLabel(sensor)
      )
    )
  }
  series
    .filter { it.id !in latestById }
    .filter { diagnostics || it.status == "valid" }
    .forEach { sensorSeries ->
      add(
        TemperatureRow(
          id = sensorSeries.id,
          title = sensorSeries.name,
          subtitle = listOfNotNull(
            temperatureRoleLabel(sensorSeries.role),
            temperatureSourceLabel(sensorSeries.source),
            sensorSeries.backend?.takeIf { it.isNotBlank() },
            sensorSeries.currentC.lastOrNull()?.let { "上次 ${formatCelsius(it.value)} · ${formatTime(it.timestamp)}" }
          ).joinToString(" · "),
          value = "—",
          status = "当前未检测到",
          limits = listOfNotNull(
            sensorSeries.highC?.let { "高 ${formatCelsius(it)}" },
            sensorSeries.criticalC?.let { "临界 ${formatCelsius(it)}" },
            sensorSeries.emergencyC?.let { "紧急 ${formatCelsius(it)}" }
          ).takeIf { it.isNotEmpty() }?.joinToString(" · ")
        )
      )
    }
}

/** 实例分组：标题 + 副标题 + 行尾编辑入口，内部放图表与元信息（件）。 */
@Composable
private fun InstanceGroup(
  title: String,
  subtitle: String,
  onEdit: (() -> Unit)?,
  content: @Composable () -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  OneUiGroup {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = metrics.groupPadding, vertical = metrics.spaceM),
      verticalArrangement = Arrangement.spacedBy(metrics.spaceM)
    ) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          OneUiText(text = title, role = OneUiTextRole.Title)
          if (subtitle.isNotBlank()) {
            OneUiText(text = subtitle, role = OneUiTextRole.RowSubtitle, color = colors.textSecondary)
          }
        }
        if (onEdit != null) {
          OneUiIconButton(contentDescription = "编辑该实例的记录项", onClick = onEdit) {
            // 行内动作：次级色 + 小一号，不与标题抢层级
            OneUiIcon(
              imageVector = Icons.Rounded.Tune,
              contentDescription = null,
              size = metrics.iconFilledSize,
              tint = colors.textSecondary
            )
          }
        }
      }
      content()
    }
  }
}
