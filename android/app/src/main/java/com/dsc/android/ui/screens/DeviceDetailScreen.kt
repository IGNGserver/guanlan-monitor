package com.dsc.android.ui.screens

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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.Timeline
import androidx.compose.material.icons.rounded.Air
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material.icons.rounded.Thermostat
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.VideogameAsset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsc.android.AppState
import com.dsc.android.ChartWindow
import com.dsc.android.DeviceBlockKey
import com.dsc.android.DiskDto
import com.dsc.android.DiskMetricSeriesDto
import com.dsc.android.FanDto
import com.dsc.android.GpuDto
import com.dsc.android.GpuMetricSeriesDto
import com.dsc.android.MetricWindow
import com.dsc.android.MetricsDto
import com.dsc.android.NetworkInterfaceDto
import com.dsc.android.NetworkMetricSeriesDto
import com.dsc.android.RemoteDataSource
import com.dsc.android.TemperatureMetricSeriesDto
import com.dsc.android.TemperatureSensorDto
import com.dsc.android.ui.oneui.*
import com.dsc.android.ui.shell.GuanlanActions

/**
 * 设备详情（构）。
 *
 * One UI 的组织方式：身份与健康度先说清（概览组），
 * 再按硬件类别列出可下钻的行（点一行看一类指标），
 * 高频切换的时间粒度下沉到底部工具坞（拇指区），
 * 类别内的图表与元信息放在面板里，而不是塞满一屏卡片。
 *
 * 数据语义保持原样：同一套 capsule 构造、同一套实例 tab、同一套缺测与温度匹配规则。
 */
@Composable
fun DeviceDetailScreen(
  state: AppState,
  actions: GuanlanActions,
  embedded: Boolean
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  val listState = rememberLazyListState()
  val collapse = rememberOneUiCollapse(listState)
  val data = state.metrics

  var openBlock by remember(state.selectedDeviceId) { mutableStateOf<DeviceBlockKey?>(null) }
  var openTabId by remember(state.selectedDeviceId) { mutableStateOf("total") }

  LaunchedEffect(state.focusedBlock, state.loadingMetrics, data?.device?.deviceId) {
    val blockKey = state.focusedBlock ?: return@LaunchedEffect
    if (state.loadingMetrics) return@LaunchedEffect
    openBlock = blockKey
    openTabId = "total"
    actions.onClearFocusedBlock()
  }

  // 双栏的右栏不提供「返回设备列表」：换设备回到左栏点选（构）
  val backIcon: @Composable () -> Unit = {
    OneUiIconButton(
      contentDescription = "返回设备列表",
      onClick = actions.onShowDeviceList
    ) {
      OneUiIcon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = null, tint = colors.textPrimary)
    }
  }

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.canvas)
  ) {
    Column(modifier = Modifier.fillMaxSize()) {
      OneUiTopBar(
        title = data?.device?.hostname ?: "设备",
        subtitle = if (data == null) {
          "正在读取指标"
        } else {
          "${data.device.os} · ${data.device.platform} · ${if (data.status == "online") "在线" else "离线"}"
        },
        collapse = collapse,
        large = !embedded,
        navigationIcon = if (embedded) null else backIcon,
        actions = {
          OneUiIconButton(
            contentDescription = "刷新",
            onClick = { if (!state.refreshing) actions.onRefresh() },
            enabled = !state.refreshing,
            spinning = state.refreshing
          ) {
            OneUiIcon(Icons.Rounded.Refresh, contentDescription = null, tint = colors.textPrimary)
          }
          if (data != null) {
            OneUiIconButton(
              contentDescription = "查看流量",
              onClick = { actions.onOpenTraffic(data.device.deviceId) }
            ) {
              OneUiIcon(Icons.Rounded.Timeline, contentDescription = null, tint = colors.textPrimary)
            }
          }
        }
      )

      LazyColumn(
        state = listState,
        modifier = Modifier
          .weight(1f)
          .fillMaxWidth(),
        contentPadding = oneUiListContentPadding(),
        verticalArrangement = Arrangement.spacedBy(metrics.cardGap)
      ) {
        if (state.dataSource == RemoteDataSource.Cache) {
          item(key = "offline-cache") {
            OneUiNotice(
              title = "当前显示离线缓存",
              description = "缓存于 ${formatTime(state.cacheSavedAt)}；数据可能已经过期。",
              tone = OneUiNoticeTone.Warning,
              action = {
                OneUiButton(
                  label = if (state.refreshing) "刷新中" else "重试",
                  onClick = actions.onRefresh,
                  variant = OneUiButtonVariant.Tonal,
                  size = OneUiButtonSize.Compact,
                  loading = state.refreshing
                )
              }
            )
          }
        }

        if (data == null) {
          val error = state.metricsError
          if (error == null || state.loadingMetrics) {
            item(key = "detail-skeleton") {
              Column(verticalArrangement = Arrangement.spacedBy(metrics.cardGap)) {
                OneUiSkeleton(height = 132.dp)
                OneUiSkeleton(height = 96.dp)
                OneUiSkeleton(height = 96.dp)
              }
            }
          } else {
            // 读不到指标时不能永远停在骨架屏上（交：错误态必须带重试出口）
            item(key = "detail-error") {
              OneUiErrorState(
                title = "没能读取这台设备的指标",
                description = error,
                onRetry = actions.onRefresh
              )
            }
          }
        }

        data?.let { snapshot ->
          item(key = "overview") {
            OverviewGroup(data = snapshot, state = state)
          }
        }

        item(key = "blocks-header") {
          OneUiGroupHeader(
            label = "硬件类别",
            description = "点按任一类查看图表与实例明细；长按不可用，请使用行尾编辑按钮选择记录项"
          )
        }

        data?.let { snapshot ->
          item(key = "blocks") {
            BlockGroup(
              data = snapshot,
              selectedWindow = state.selectedWindow,
              loading = state.loadingMetrics,
              onOpenBlock = { block -> openBlock = block },
              onOpenTraffic = { actions.onOpenTraffic(snapshot.device.deviceId) },
              onEditDeviceMetrics = { actions.onOpenDeviceEditor(snapshot.device.deviceId) }
            )
          }
        }

        if (state.loadingMetrics) {
          item(key = "metrics-loading") {
            OneUiLoadingRow("正在切换 ${state.selectedWindow.label} 粒度")
          }
        }
      }

      // 底部工具坞：时间粒度属于高频切换，放在拇指区（构 + 交）
      WindowDock(
        selected = state.selectedWindow,
        enabled = !state.loadingMetrics,
        onSelect = actions.onSelectWindow
      )
    }
  }

  data?.let { snapshot ->
    openBlock?.let { blockKey ->
      val tabs = remember(snapshot, blockKey) { buildBlockSheetTabs(snapshot, blockKey) }
      val tabIds = tabs.map { it.id }
      val effectiveTab = if (openTabId in tabIds) openTabId else (tabIds.firstOrNull() ?: "total")
      BlockSheet(
        data = snapshot,
        blockKey = blockKey,
        selectedWindow = state.selectedWindow,
        tabs = tabs,
        selectedTabId = effectiveTab,
        onSelectTab = { openTabId = it },
        onDismiss = { openBlock = null },
        onEditBlock = { actions.onOpenBlockEditor(snapshot.device.deviceId, blockKey) },
        onEditInstance = { instanceId ->
          actions.onOpenInstanceEditor(snapshot.device.deviceId, blockKey, instanceId)
        }
      )
    }
  }
}

/** 概览组：设备身份与在线状态（保留旧 OverviewCard 的全部字段）。 */
@Composable
private fun OverviewGroup(data: MetricsDto, state: AppState) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val online = data.status == "online"
  Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
    OneUiGroup {
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .padding(horizontal = metrics.groupPadding, vertical = metrics.spaceS),
        verticalArrangement = Arrangement.spacedBy(metrics.spaceS)
      ) {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(modifier = Modifier.weight(1f)) {
              OneUiText(text = data.device.hostname, role = OneUiTextRole.Headline)
              OneUiText(
                text = data.device.cpuModel ?: "处理器信息未上报",
                role = OneUiTextRole.RowSubtitle,
                color = colors.textSecondary,
                modifier = Modifier.padding(top = 2.dp)
              )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              OneUiStatusDot(color = if (online) colors.online else colors.offline)
              OneUiText(
                text = if (online) "在线" else "离线",
                role = OneUiTextRole.ChartLabel,
                color = if (online) colors.onlineContent else colors.offlineContent,
                weight = FontWeight.SemiBold
              )
            }
          }
          OneUiReading(
            value = metricPoint(data.series.cpuUsagePercent, state.selectedWindow, ::formatPercent),
            unit = "CPU 占用",
            label = "当前粒度 ${state.selectedWindow.label}",
            color = if (online) colors.accent else colors.textSecondary
          )
      }
    }
    OneUiMetaTable(
      items = buildList {
        add("设备 ID" to data.device.deviceId)
        add("系统" to data.device.os)
        add("平台" to "${data.device.platform} / ${data.device.arch}")
        add("上次更新" to formatTime(data.lastSeenAt))
        add("agent" to (data.device.agentVersion ?: "未知"))
        data.device.agentChannel?.takeIf { it.isNotBlank() }?.let { add("渠道" to it) }
      },
      selectable = true
    )
  }
}

/** 硬件类别列表：每个类别一行，行内直接给出该类别的关键读数（构）。 */
@Composable
private fun BlockGroup(
  data: MetricsDto,
  selectedWindow: MetricWindow,
  loading: Boolean,
  onOpenBlock: (DeviceBlockKey) -> Unit,
  onOpenTraffic: () -> Unit,
  onEditDeviceMetrics: () -> Unit
) {
  val colors = OneUiTheme.colors
  val capsules = remember(data, selectedWindow) { buildOverviewCapsules(data, selectedWindow) }

  OneUiGroup {
    capsules.forEachIndexed { index, capsule ->
      if (index > 0) OneUiListDivider()
      OneUiListItem(
        title = capsule.title,
        subtitle = capsule.subtitle,
        onClick = { onOpenBlock(capsule.blockKey) },
        enabled = !loading,
        leading = {
          OneUiLeadingIcon(
            icon = blockIcon(capsule.blockKey),
            contentDescription = null,
            tone = if (capsule.blockKey == DeviceBlockKey.Temperature) OneUiIconTone.Warning else OneUiIconTone.Neutral
          )
        },
        supporting = {
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .padding(top = 8.dp)
              .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
          ) {
            capsule.metrics.forEach { (label, value) ->
              OneUiPill(label = label, value = value)
            }
          }
        },
        trailing = {
          OneUiText(
            text = "明细",
            role = OneUiTextRole.ChartLabel,
            color = colors.accent,
            weight = FontWeight.SemiBold
          )
        }
      )
    }
    OneUiListDivider()
    OneUiListItem(
      title = "流量",
      subtitle = "按日/周/月查看接收、发送与明细记录",
      onClick = onOpenTraffic,
      leading = {
        OneUiLeadingIcon(icon = Icons.Rounded.Timeline, contentDescription = null, tone = OneUiIconTone.Accent)
      },
      trailing = {
        OneUiText(text = "日历", role = OneUiTextRole.ChartLabel, color = colors.accent, weight = FontWeight.SemiBold)
      }
    )
    OneUiListDivider()
    OneUiListItem(
      title = "编辑记录项",
      subtitle = "选择这台设备要采集的指标与实例",
      onClick = onEditDeviceMetrics,
      leading = {
        OneUiLeadingIcon(icon = Icons.Rounded.Tune, contentDescription = null, tone = OneUiIconTone.Neutral)
      }
    )
  }
}

@Composable
private fun WindowDock(selected: MetricWindow, enabled: Boolean, onSelect: (MetricWindow) -> Unit) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  Column(
    modifier = Modifier
      .fillMaxWidth()
      .oneUiSurface(
        colors.raised,
        OneUiTheme.shapes.dock,
        colors = colors,
        level = OneUiSurfaceLevel.Raised
      )
      // 工具坞贴在屏幕下沿，必须自己让开手势条/三键栏（适）
      .navigationBarsPadding()
      .padding(horizontal = metrics.screenMargin, vertical = metrics.spaceS),
    verticalArrangement = Arrangement.spacedBy(6.dp)
  ) {
    OneUiText(
      text = "时间粒度",
      role = OneUiTextRole.ChartLabel,
      color = colors.textTertiary,
      weight = FontWeight.SemiBold
    )
    OneUiWindowSelector(selected = selected, onSelect = onSelect, enabled = enabled)
  }
}

private fun blockIcon(block: DeviceBlockKey) = when (block) {
  DeviceBlockKey.Cpu -> Icons.Rounded.Memory
  DeviceBlockKey.Gpu -> Icons.Rounded.VideogameAsset
  DeviceBlockKey.Memory -> Icons.Rounded.Storage
  DeviceBlockKey.Disk -> Icons.Rounded.Dns
  DeviceBlockKey.Network -> Icons.Rounded.Router
  DeviceBlockKey.Temperature -> Icons.Rounded.Thermostat
  DeviceBlockKey.Fan -> Icons.Rounded.Air
}

/** 类别面板（件 + 动）：实例切换用胶囊行，图表与元信息按 One UI 的层级重排。 */
@Composable
private fun BlockSheet(
  data: MetricsDto,
  blockKey: DeviceBlockKey,
  selectedWindow: MetricWindow,
  tabs: List<BlockSheetTabModel>,
  selectedTabId: String,
  onSelectTab: (String) -> Unit,
  onDismiss: () -> Unit,
  onEditBlock: () -> Unit,
  onEditInstance: (String) -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val chartWindow = remember(data, selectedWindow) { chartWindowFor(data, selectedWindow) }
  val editAction: @Composable () -> Unit = {
    OneUiIconButton(contentDescription = "编辑记录项", onClick = onEditBlock) {
      OneUiIcon(Icons.Rounded.Tune, contentDescription = null, tint = colors.textPrimary)
    }
  }

  OneUiSheet(
    onDismissRequest = onDismiss,
    title = blockKey.label,
    subtitle = if (selectedWindow == MetricWindow.OneMinute) "当前显示实时值" else "当前显示 ${selectedWindow.label} 区间平均值",
    headerAction = if (blockKey == DeviceBlockKey.Fan) null else editAction
  ) {
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
            selected = tab.id == selectedTabId,
            onClick = { onSelectTab(tab.id) }
          )
        }
      }
    }
    AnimatedVisibility(visible = true, enter = oneUiSheetContentEnter(OneUiTheme.motion)) {
      BlockTabContent(
        data = data,
        blockKey = blockKey,
        tabId = selectedTabId,
        selectedWindow = selectedWindow,
        chartWindow = chartWindow,
        onEditInstance = onEditInstance
      )
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
    if (!isMetricAvailable(data, "cpuTemperature")) {
      OneUiText(
        text = "当前设备未提供 CPU 温度传感器。",
        role = OneUiTextRole.RowSubtitle,
        color = colors.textSecondary
      )
    }
    OneUiMetricTileGrid(
      cards = listOf(
        MetricCardModel("CPU 占用", metricPoint(data.series.cpuUsagePercent, selectedWindow, ::formatPercent), data.series.cpuUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("CPU 频率", metricPoint(data.series.cpuFrequencyMHz, selectedWindow, ::formatMHz), data.series.cpuFrequencyMHz, ::formatMHz),
        MetricCardModel(
          "CPU 温度",
          metricPoint(cpuTemperaturePoints(data), selectedWindow, ::formatCelsius, zeroMeansMissing = true),
          cpuTemperaturePoints(data),
          ::formatCelsius
        )
      ),
      chartWindow = chartWindow
    )
    OneUiMetaTable(
      items = listOf(
        "处理器" to (data.device.cpuModel ?: "未知"),
        "包数量" to data.latest.cpuPackages.size.toString(),
        "L3 缓存" to formatOptionalBytes(data.latest.cpuPackages.mapNotNull { it.l3CacheBytes }.takeIf { it.isNotEmpty() }?.sum()),
        "进程" to data.latest.system.processCount.toString(),
        "线程" to data.latest.system.threadCount.toString(),
        "句柄" to data.latest.system.handleCount.toString(),
        "平台" to "${data.device.platform} / ${data.device.arch}"
      )
    )
    return
  }

  val cpu = data.series.cpus.firstOrNull { it.id == tabId } ?: return
  InstanceGroup(
    title = cpu.name,
    subtitle = listOfNotNull(
      cpu.model,
      cpu.coreCount?.let { "$it 核" },
      cpu.logicalCount?.let { "$it 线程" }
    ).joinToString(" · "),
    onEdit = { onEditInstance(cpu.id) }
  ) {
    OneUiMetricTileGrid(
      cards = listOf(
        MetricCardModel("占用", metricPoint(cpu.usagePercent, selectedWindow, ::formatPercent), cpu.usagePercent, ::formatPercent, 100.0),
        MetricCardModel("频率", metricPoint(cpu.frequencyMHz, selectedWindow, ::formatMHz), cpu.frequencyMHz, ::formatMHz),
        MetricCardModel(
          "温度",
          metricPoint(cpu.temperatureC, selectedWindow, ::formatCelsius, zeroMeansMissing = true),
          cpu.temperatureC,
          ::formatCelsius
        )
      ),
      chartWindow = chartWindow
    )
    OneUiMetaTable(
      items = listOf(
        "型号" to (cpu.model ?: "未知"),
        "核心 / 线程" to "${cpu.coreCount ?: "--"} / ${cpu.logicalCount ?: "--"}",
        "L3 缓存" to formatOptionalBytes(cpu.l3CacheBytes)
      )
    )
  }
}

@Composable
private fun MemoryTab(data: MetricsDto, selectedWindow: MetricWindow, chartWindow: ChartWindow) {
  OneUiMetricTileGrid(
    cards = listOf(
      MetricCardModel("物理内存", buildUsage(data.latest.memoryUsedBytes, data.latest.memoryTotalBytes), data.series.memoryUsagePercent, ::formatPercent, 100.0),
      MetricCardModel("虚拟内存", buildUsage(data.latest.swapUsedBytes, data.latest.swapTotalBytes), data.series.swapUsagePercent, ::formatPercent, 100.0),
      MetricCardModel("可用内存", formatBytes(data.latest.memoryAvailableBytes.toDouble()), data.series.memoryAvailableBytes, { formatBytes(it ?: 0.0) }),
      MetricCardModel("缓存内存", formatBytes(data.latest.memoryCachedBytes.toDouble()), data.series.memoryCachedBytes, { formatBytes(it ?: 0.0) }),
      MetricCardModel("已提交", formatBytes(data.latest.memoryCommittedBytes.toDouble()), data.series.memoryCommittedBytes, { formatBytes(it ?: 0.0) }),
      MetricCardModel("提交上限", formatOptionalBytes(data.latest.memoryCommitLimitBytes), data.series.memoryCommitLimitBytes, ::formatOptionalBytes),
      MetricCardModel("已用字节", formatBytes(data.latest.memoryUsedBytes.toDouble()), data.series.memoryUsedBytes, { formatBytes(it ?: 0.0) }),
      MetricCardModel("Swap 已用", formatBytes(data.latest.swapUsedBytes.toDouble()), data.series.swapUsedBytes, { formatBytes(it ?: 0.0) }),
      MetricCardModel("进程数", data.latest.system.processCount.toString(), data.series.systemProcessCount, { it?.toInt()?.toString() ?: "--" }),
      MetricCardModel("线程数", data.latest.system.threadCount.toString(), data.series.systemThreadCount, { it?.toInt()?.toString() ?: "--" }),
      MetricCardModel("句柄数", data.latest.system.handleCount.toString(), data.series.systemHandleCount, { it?.toInt()?.toString() ?: "--" })
    ),
    chartWindow = chartWindow
  )
  OneUiMetaTable(
    items = listOf(
      "物理内存" to buildUsage(data.latest.memoryUsedBytes, data.latest.memoryTotalBytes),
      "虚拟内存" to buildUsage(data.latest.swapUsedBytes, data.latest.swapTotalBytes),
      "提交上限" to formatOptionalBytes(data.latest.memoryCommitLimitBytes),
      "频率" to (data.latest.memorySpeedMHz?.let { formatMHz(it) } ?: "未知"),
      "插槽" to (data.latest.memorySlotCount?.toString() ?: "未知"),
      "形态" to (data.latest.memoryFormFactor ?: "未知")
    )
  )
}

@Composable
private fun DiskTab(
  data: MetricsDto,
  tabId: String,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow,
  onEditInstance: (String) -> Unit
) {
  if (tabId == "total") {
    OneUiMetricTileGrid(
      cards = listOf(
        MetricCardModel("总占用", buildUsage(data.latest.diskUsedBytes, data.latest.diskTotalBytes), data.series.diskUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("总读取", metricPoint(data.series.diskReadBytesPerSec, selectedWindow, ::formatSpeed), data.series.diskReadBytesPerSec, ::formatSpeed),
        MetricCardModel("总写入", metricPoint(data.series.diskWriteBytesPerSec, selectedWindow, ::formatSpeed), data.series.diskWriteBytesPerSec, ::formatSpeed)
      ),
      chartWindow = chartWindow
    )
    OneUiMetaTable(items = listOf("总容量" to buildUsage(data.latest.diskUsedBytes, data.latest.diskTotalBytes)))
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
      }
    )
  }
}

@Composable
private fun DiskTiles(disk: DiskDto, series: DiskMetricSeriesDto?, chartWindow: ChartWindow) {
  val temperaturePoints = series?.temperatureC.orEmpty().filter { validDiskTemperature(it.value) != null }
  OneUiMetricTileGrid(
    cards = listOf(
      MetricCardModel("容量", buildUsage(disk.usedBytes, disk.totalBytes), series?.usagePercent.orEmpty(), ::formatPercent, 100.0),
      MetricCardModel("读取", formatSpeed(series?.readBytesPerSec?.lastOrNull()?.value), series?.readBytesPerSec.orEmpty(), ::formatSpeed),
      MetricCardModel("写入", formatSpeed(series?.writeBytesPerSec?.lastOrNull()?.value), series?.writeBytesPerSec.orEmpty(), ::formatSpeed),
      MetricCardModel("温度", formatCelsius(validDiskTemperature(disk.temperatureC)), temperaturePoints, ::formatCelsius)
    ),
    chartWindow = chartWindow
  )
}

@Composable
private fun NetworkTab(
  data: MetricsDto,
  tabId: String,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow,
  onEditInstance: (String) -> Unit
) {
  if (tabId == "total") {
    OneUiMetricTileGrid(
      cards = listOf(
        MetricCardModel("总接收", metricPoint(data.series.networkRxBytesPerSec, selectedWindow, ::formatSpeed), data.series.networkRxBytesPerSec, ::formatSpeed),
        MetricCardModel("总发送", metricPoint(data.series.networkTxBytesPerSec, selectedWindow, ::formatSpeed), data.series.networkTxBytesPerSec, ::formatSpeed),
        MetricCardModel(
          "累计接收",
          formatBytes(data.series.trafficRxBytes.lastOrNull()?.value ?: 0.0),
          data.series.trafficRxBytes,
          { formatBytes(it ?: 0.0) }
        ),
        MetricCardModel(
          "累计发送",
          formatBytes(data.series.trafficTxBytes.lastOrNull()?.value ?: 0.0),
          data.series.trafficTxBytes,
          { formatBytes(it ?: 0.0) }
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
    OneUiMetricTileGrid(
      cards = listOf(
        MetricCardModel("接收速率", formatSpeed(nic.rxBytesPerSec), series?.rxBytesPerSec.orEmpty(), ::formatSpeed),
        MetricCardModel("发送速率", formatSpeed(nic.txBytesPerSec), series?.txBytesPerSec.orEmpty(), ::formatSpeed),
        MetricCardModel("累计接收", formatBytes(nic.totalRxBytes?.toDouble() ?: 0.0), series?.trafficRxBytes.orEmpty(), { formatBytes(it ?: 0.0) }),
        MetricCardModel("累计发送", formatBytes(nic.totalTxBytes?.toDouble() ?: 0.0), series?.trafficTxBytes.orEmpty(), { formatBytes(it ?: 0.0) })
      ),
      chartWindow = chartWindow
    )
    OneUiMetaTable(
      items = listOfNotNull(
        "IPv4" to nic.ipv4.joinToString(", ").ifBlank { "未知" },
        "IPv6" to nic.ipv6.joinToString(", ").ifBlank { "未知" },
        "链路" to (nic.linkSpeedMbps?.let { String.format("%.0f Mbps", it) } ?: "未知"),
        "连接" to (nic.connectionType ?: "未知"),
        "信号" to (nic.signalStrengthPercent?.let { formatPercent(it) } ?: "未知"),
        "累计接收" to formatBytes((nic.totalRxBytes ?: 0L).toDouble()),
        "累计发送" to formatBytes((nic.totalTxBytes ?: 0L).toDouble())
      )
    )
  }
}

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
    OneUiMetricTileGrid(
      cards = listOf(
        MetricCardModel("总占用", metricPoint(data.series.gpuUsagePercent, selectedWindow, ::formatPercent), data.series.gpuUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("总 GPU 内存", formatGpuMemorySummary(data.latest.gpus), data.series.gpuMemoryUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("总温度", metricPoint(temperaturePoints, selectedWindow, ::formatCelsius), temperaturePoints, ::formatCelsius)
      ),
      chartWindow = chartWindow
    )
    OneUiMetaTable(items = listOf("总 GPU 内存" to formatGpuMemorySummary(data.latest.gpus)))
    return
  }

  val gpu = data.latest.gpus.firstOrNull { it.id == tabId } ?: return
  val series = data.series.gpus.firstOrNull { it.id == tabId }
  InstanceGroup(
    title = gpu.name,
    subtitle = gpu.id,
    onEdit = { onEditInstance(gpu.id) }
  ) {
    GpuTiles(gpu, series, chartWindow, selectedWindow)
    OneUiMetaTable(
      items = listOfNotNull(
        "驱动" to (gpu.driverVersion ?: "未知"),
        "类型" to if (gpu.integrated) "集成显卡" else "独立显卡",
        "显存类型" to gpuMemoryLabel(gpu.memoryKind ?: series?.memoryKind),
        "温度源" to gpuTemperatureSourceLabel(gpu.temperatureSource ?: series?.temperatureSource),
        gpuMemoryLabel(gpu.memoryKind) to buildGpuUsage(gpu.memoryUsedBytes, gpu.memoryTotalBytes)
      )
    )
  }
}

@Composable
private fun GpuTiles(
  gpu: GpuDto,
  series: GpuMetricSeriesDto?,
  chartWindow: ChartWindow,
  selectedWindow: MetricWindow
) {
  OneUiMetricTileGrid(
    cards = listOf(
      MetricCardModel("占用", formatPercent(gpu.utilizationPercent), series?.usagePercent.orEmpty(), ::formatPercent, 100.0),
      MetricCardModel("编码", formatPercent(gpu.encodeUtilizationPercent), series?.encodePercent.orEmpty(), ::formatPercent, 100.0),
      MetricCardModel("解码", formatPercent(gpu.decodeUtilizationPercent), series?.decodePercent.orEmpty(), ::formatPercent, 100.0),
      MetricCardModel("频率", formatMHz(gpu.frequencyMHz), series?.frequencyMHz.orEmpty(), ::formatMHz),
      MetricCardModel(
        gpuMemoryLabel(gpu.memoryKind),
        buildGpuUsage(gpu.memoryUsedBytes, gpu.memoryTotalBytes),
        series?.memoryUsagePercent.orEmpty(),
        ::formatPercent,
        100.0
      ),
      MetricCardModel(
        "${gpuMemoryLabel(gpu.memoryKind)}已用",
        formatBytes(gpu.memoryUsedBytes.toDouble()),
        series?.memoryUsedBytes.orEmpty(),
        { formatBytes(it ?: 0.0) }
      ),
      MetricCardModel(
        if ((gpu.temperatureSource ?: series?.temperatureSource) == "cpuPackageShared") "温度（随 CPU）" else "温度",
        formatCelsius(gpu.temperatureC),
        series?.temperatureC.orEmpty(),
        ::formatCelsius
      )
    ),
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
            "${fan.rpm} RPM",
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
          "${fan.rpm} RPM",
          series?.rpm.orEmpty(),
          valueFormatter = { if (it == null) "--" else "${it.toInt()} RPM" }
        )
      ),
      chartWindow = chartWindow
    )
    OneUiMetaTable(
      items = listOfNotNull(
        "转速" to "${fan.rpm} RPM",
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
          sensor.backend?.takeIf { it.isNotBlank() }
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
            sensorSeries.backend?.takeIf { it.isNotBlank() }
          ).joinToString(" · "),
          value = sensorSeries.currentC.lastOrNull()?.let { formatCelsius(it.value) } ?: "—",
          status = temperatureStatusLabel(sensorSeries.status),
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

