package com.dsc.android.ui.screens

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ReportProblem
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material.icons.automirrored.rounded.Sort
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.Timeline
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsc.android.AppState
import com.dsc.android.AttentionItem
import com.dsc.android.AttentionSeverity
import com.dsc.android.ChartWindow
import com.dsc.android.DeviceBlockKey
import com.dsc.android.DeviceSummaryDto
import com.dsc.android.MetricWindow
import com.dsc.android.OverviewInstanceSeriesDto
import com.dsc.android.RemoteDataSource
import com.dsc.android.SamplePointDto
import com.dsc.android.collectAttention
import com.dsc.android.percentOf
import com.dsc.android.seriesStats
import com.dsc.android.ui.oneui.OneUiActionModel
import com.dsc.android.ui.oneui.OneUiActionSheet
import com.dsc.android.ui.oneui.OneUiButton
import com.dsc.android.ui.oneui.OneUiButtonSize
import com.dsc.android.ui.oneui.OneUiButtonVariant
import com.dsc.android.ui.oneui.OneUiDialog
import com.dsc.android.ui.oneui.OneUiEmptyState
import com.dsc.android.ui.oneui.OneUiFilterChip
import com.dsc.android.ui.oneui.OneUiGroup
import com.dsc.android.ui.oneui.OneUiGroupHeader
import com.dsc.android.ui.oneui.OneUiHaptics
import com.dsc.android.ui.oneui.OneUiIcon
import com.dsc.android.ui.oneui.OneUiIconButton
import com.dsc.android.ui.oneui.OneUiIconTone
import com.dsc.android.ui.oneui.OneUiLeadingIcon
import com.dsc.android.ui.oneui.OneUiLinearProgress
import com.dsc.android.ui.oneui.OneUiListItem
import com.dsc.android.ui.oneui.OneUiNotice
import com.dsc.android.ui.oneui.OneUiNoticeTone
import com.dsc.android.ui.oneui.OneUiSkeleton
import com.dsc.android.ui.oneui.OneUiSparkline
import com.dsc.android.ui.oneui.OneUiStatusDot
import com.dsc.android.ui.oneui.OneUiSurfaceLevel
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextField
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme
import com.dsc.android.ui.oneui.OneUiTopBar
import com.dsc.android.ui.oneui.formatBytes
import com.dsc.android.ui.oneui.formatPercent
import com.dsc.android.ui.oneui.formatSpeed
import com.dsc.android.ui.oneui.formatTime
import com.dsc.android.ui.oneui.oneUiContentWidth
import com.dsc.android.ui.oneui.oneUiListContentPadding
import com.dsc.android.ui.oneui.oneUiPressable
import com.dsc.android.ui.oneui.oneUiSurface
import com.dsc.android.ui.oneui.relativeTimeLabel
import com.dsc.android.ui.oneui.rememberNowMillis
import com.dsc.android.ui.oneui.rememberOneUiCollapse
import com.dsc.android.ui.shell.GuanlanActions
import kotlinx.coroutines.launch

/**
 * 总览（构）。
 *
 * 视觉重心按优先级排：
 * 1. 设备卡里的趋势——每台设备一张卡，CPU / 内存 / 网络各带一条迷你曲线，硬盘一条容量条，
 *    小倍数（small multiples）排布让多台设备可以直接横向比较；
 * 2. 需要关注——顶部一条汇总，卡片内一行问题提示，详情交给「关注」页；
 * 其余（排序、编辑、隐藏）都收进图标按钮与操作面板，不占读数的位置。
 */
@Composable
fun DeviceListScreen(
  state: AppState,
  actions: GuanlanActions,
  embedded: Boolean
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val listState = rememberLazyListState()
  val collapse = rememberOneUiCollapse(listState)
  val topBarScope = rememberCoroutineScope()
  val now = rememberNowMillis()

  val persisted = state.devices.sortedWith(
    compareBy<DeviceSummaryDto> { it.sortOrder ?: Int.MAX_VALUE }.thenBy { it.hostname }
  )
  val persistedIds = persisted.map { it.deviceId }
  val attention = remember(state.devices, state.attentionMetrics, now / 60_000) {
    collectAttention(persisted, state.attentionMetrics, now)
  }
  val issuesByDevice = attention.groupBy { it.deviceId }
  val overviewById = state.overviewMetrics
    ?.takeIf { it.window == state.overviewWindow.value }
    ?.instances
    ?.associateBy { it.deviceId }
    .orEmpty()
  val chartWindow = remember(state.overviewWindow, state.overviewMetrics) { ChartWindow.from(state.overviewWindow) }

  var editMode by remember(persistedIds) { mutableStateOf(false) }
  var draftIds by remember(persistedIds) { mutableStateOf<List<String>?>(null) }
  var pendingDelete by remember { mutableStateOf<DeviceSummaryDto?>(null) }
  var actionTarget by remember { mutableStateOf<DeviceSummaryDto?>(null) }
  var sortSheet by remember { mutableStateOf(false) }
  var sortMode by rememberSaveable { mutableStateOf(DeviceSortMode.Custom.name) }
  var query by rememberSaveable { mutableStateOf("") }
  val sort = DeviceSortMode.entries.firstOrNull { it.name == sortMode } ?: DeviceSortMode.Custom

  val draft = draftIds
  val visible = when {
    editMode && draft != null -> {
      val byId = persisted.associateBy { it.deviceId }
      val draftSet = draft.toSet()
      draft.mapNotNull { byId[it] } + persisted.filterNot { it.deviceId in draftSet }
    }
    editMode -> persisted
    else -> sortDevices(persisted, sort, issuesByDevice).filter { it.matches(query) }
  }
  val showSearch = !editMode && persisted.size > SEARCH_THRESHOLD

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.canvas)
  ) {
    Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
      OneUiTopBar(
        title = if (editMode) "编辑设备列表" else "总览",
        subtitle = if (editMode) "调整顺序或从列表隐藏设备" else connectionSummary(state, persisted),
        collapse = collapse,
        onCollapsedTitleClick = { topBarScope.launch { listState.animateScrollToItem(0) } },
        large = !embedded,
        actions = {
          if (!editMode) {
            OneUiIconButton(
              contentDescription = "刷新",
              onClick = { if (!state.refreshing) actions.onRefresh() },
              enabled = !state.refreshing,
              spinning = state.refreshing
            ) {
              OneUiIcon(Icons.Rounded.Refresh, contentDescription = null, tint = colors.textPrimary)
            }
            OneUiIconButton(
              contentDescription = "编辑设备列表",
              onClick = {
                draftIds = persistedIds
                editMode = true
              },
              enabled = persisted.isNotEmpty()
            ) {
              OneUiIcon(Icons.Rounded.Tune, contentDescription = null, tint = colors.textPrimary)
            }
          }
        }
      )

      LazyColumn(
        state = listState,
        modifier = Modifier
          .weight(1f)
          .fillMaxWidth()
          .oneUiContentWidth(metrics),
        contentPadding = if (embedded) {
          PaddingValues(start = metrics.spaceS, end = metrics.spaceS, top = metrics.spaceXs, bottom = metrics.spaceXxl)
        } else {
          oneUiListContentPadding()
        },
        verticalArrangement = Arrangement.spacedBy(metrics.cardGap)
      ) {
        if (!state.authenticated && state.serverConfig.baseUrl.isNotBlank()) {
          item(key = "connecting") {
            OneUiNotice(title = "正在使用已保存配置连接中枢", description = state.serverConfig.baseUrl, tone = OneUiNoticeTone.Info)
          }
        }

        if (state.dataSource == RemoteDataSource.Cache && !state.loggingIn && !state.refreshing) {
          item(key = "offline-cache") {
            OneUiNotice(
              title = "当前显示离线缓存",
              description = "缓存于 ${formatTime(state.cacheSavedAt)}；数据可能已经过期。",
              tone = OneUiNoticeTone.Warning,
              icon = Icons.Rounded.Storage,
              action = {
                OneUiButton(
                  label = "重试",
                  onClick = actions.onRefresh,
                  variant = OneUiButtonVariant.Tonal,
                  size = OneUiButtonSize.Compact
                )
              }
            )
          }
        }

        state.updateInfo?.takeIf { it.available }?.let { update ->
          item(key = "update-available") {
            Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
              OneUiNotice(
                title = "发现 Android 更新 v${update.latestVersion ?: ""}",
                description = "更新与安装入口在「设置 › 版本与更新」。",
                tone = OneUiNoticeTone.Info,
                icon = Icons.Rounded.Computer,
                action = {
                  OneUiButton(label = "前往", onClick = actions.onShowSettings, variant = OneUiButtonVariant.Text, size = OneUiButtonSize.Compact)
                }
              )
              if (state.updateDownloading) OneUiLinearProgress(fraction = state.updateProgress)
            }
          }
        }

        if (!editMode && persisted.isNotEmpty()) {
          item(key = "fleet-status") {
            FleetStatusStrip(
              devices = persisted,
              attention = attention,
              onOpen = actions.onShowAttention
            )
          }
          item(key = "devices-header") {
            Column(
              modifier = Modifier.padding(top = metrics.spaceXs),
              verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)
            ) {
              OneUiGroupHeader(
                label = "设备 · ${sort.label}",
                action = {
                  OneUiIconButton(contentDescription = "排序方式：${sort.label}", onClick = { sortSheet = true }) {
                    OneUiIcon(Icons.AutoMirrored.Rounded.Sort, contentDescription = null, tint = colors.textSecondary, size = metrics.iconFilledSize)
                  }
                }
              )
              TrendWindowRow(selected = state.overviewWindow, onSelect = actions.onSelectOverviewWindow)
              if (showSearch) {
                OneUiTextField(
                  value = query,
                  onValueChange = { query = it },
                  label = "搜索主机名或设备 ID",
                  imeAction = androidx.compose.ui.text.input.ImeAction.Search
                )
              }
            }
          }
        }

        if (state.loading && persisted.isEmpty()) {
          items(3) { OneUiSkeleton(height = 168.dp) }
        }

        if (!state.loading && persisted.isEmpty()) {
          item(key = "empty") {
            OneUiEmptyState(
              title = "暂未发现设备",
              description = "确认中枢已收到该设备的上报，或点按刷新重试。",
              icon = Icons.Rounded.Router,
              actionLabel = "刷新",
              onAction = actions.onRefresh
            )
          }
        } else if (visible.isEmpty() && query.isNotBlank()) {
          item(key = "no-match") {
            OneUiEmptyState(title = "没有匹配的设备", description = "没有主机名或设备 ID 包含「${query.trim()}」的设备。", actionLabel = "清除搜索", onAction = { query = "" })
          }
        }

        if (editMode) {
          items(visible, key = { "edit:${it.deviceId}" }) { device ->
            val index = visible.indexOf(device)
            EditableDeviceRow(
              device = device,
              canMoveUp = index > 0,
              canMoveDown = index < visible.lastIndex,
              onMove = { delta ->
                val ids = visible.map { it.deviceId }.toMutableList()
                val target = index + delta
                if (target in ids.indices) {
                  ids.add(target, ids.removeAt(index))
                  draftIds = ids
                }
              },
              onRequestDelete = { pendingDelete = device }
            )
          }
        } else {
          items(visible, key = { it.deviceId }) { device ->
            DeviceTrendCard(
              device = device,
              overview = overviewById[device.deviceId],
              chartWindow = chartWindow,
              issues = issuesByDevice[device.deviceId].orEmpty(),
              nowMillis = now,
              onOpen = { actions.onOpenDevice(device.deviceId, null) },
              onOpenBlock = { block -> actions.onOpenDevice(device.deviceId, block) },
              onMore = { actionTarget = device }
            )
          }
        }

        item(key = "bottom-spacer") { Spacer(Modifier.height(metrics.thumbZone)) }
      }

      if (editMode) {
        EditDock(
          dirty = draftIds != null && draftIds != persistedIds,
          onCancel = {
            editMode = false
            draftIds = null
            pendingDelete = null
          },
          onSave = {
            val ids = visible.map { it.deviceId }
            if (draftIds != null && ids != persistedIds) actions.onReorderDevices(ids)
            editMode = false
            draftIds = null
          }
        )
      }
    }
  }

  if (sortSheet) {
    OneUiActionSheet(
      onDismissRequest = { sortSheet = false },
      title = "设备排序",
      actions = DeviceSortMode.entries.map { mode ->
        OneUiActionModel(
          label = if (mode == sort) "${mode.label}（当前）" else mode.label,
          description = mode.description,
          icon = Icons.AutoMirrored.Rounded.Sort,
          onClick = {
            sortMode = mode.name
            sortSheet = false
          }
        )
      }
    )
  }

  actionTarget?.let { device ->
    OneUiActionSheet(
      onDismissRequest = { actionTarget = null },
      title = device.hostname,
      actions = listOf(
        OneUiActionModel(
          label = "打开设备",
          description = "查看图表、进程、容器与硬件明细",
          icon = Icons.Rounded.Computer,
          onClick = {
            actionTarget = null
            actions.onOpenDevice(device.deviceId, null)
          }
        ),
        OneUiActionModel(
          label = "查看流量",
          description = "按日/周/月查看接收与发送",
          icon = Icons.Rounded.Timeline,
          onClick = {
            actionTarget = null
            actions.onOpenTraffic(device.deviceId)
          }
        ),
        OneUiActionModel(
          label = "编辑记录项",
          description = "选择这台设备要采集的指标",
          icon = Icons.Rounded.Tune,
          onClick = {
            actionTarget = null
            actions.onOpenDeviceEditor(device.deviceId)
          }
        ),
        OneUiActionModel(
          label = "从列表隐藏",
          description = "设备下次上报时会重新出现",
          icon = Icons.Rounded.Delete,
          destructive = true,
          onClick = {
            actionTarget = null
            pendingDelete = device
          }
        )
      )
    )
  }

  pendingDelete?.let { device ->
    OneUiDialog(
      onDismissRequest = { pendingDelete = null },
      title = "从列表隐藏 ${device.hostname}？",
      description = "它会从当前列表隐藏；设备下次上报时会重新显示。",
      confirmLabel = "隐藏",
      onConfirm = {
        pendingDelete = null
        actions.onDeleteDevice(device.deviceId)
      },
      dismissLabel = "取消",
      onDismiss = { pendingDelete = null },
      destructive = true
    )
  }
}

private const val SEARCH_THRESHOLD = 6

internal enum class DeviceSortMode(val label: String, val description: String) {
  Custom("自定义顺序", "按你在「编辑设备列表」里排好的顺序"),
  Attention("需关注优先", "有严重问题的设备排在最前，离线设备随后"),
  Cpu("CPU 占用", "当前 CPU 占用从高到低"),
  Memory("内存占用", "当前内存占用从高到低")
}

internal fun sortDevices(
  devices: List<DeviceSummaryDto>,
  mode: DeviceSortMode,
  issues: Map<String, List<AttentionItem>>
): List<DeviceSummaryDto> = when (mode) {
  DeviceSortMode.Custom -> devices
  DeviceSortMode.Attention -> devices.sortedWith(
    compareBy<DeviceSummaryDto> { device ->
      issues[device.deviceId]?.minOfOrNull { it.severity.rank } ?: Int.MAX_VALUE
    }.thenByDescending { issues[it.deviceId]?.size ?: 0 }
  )
  DeviceSortMode.Cpu -> devices.sortedByDescending { if (it.status == "online") it.cpuUsagePercent ?: -1.0 else -2.0 }
  DeviceSortMode.Memory -> devices.sortedByDescending { if (it.status == "online") it.memoryUsagePercent ?: -1.0 else -2.0 }
}

private fun DeviceSummaryDto.matches(query: String): Boolean {
  val needle = query.trim()
  return needle.isEmpty() || hostname.contains(needle, ignoreCase = true) || deviceId.contains(needle, ignoreCase = true)
}

/** 关注汇总条：只占一行，告诉你「有没有事、几件、多严重」，点进去看明细。 */
@Composable
private fun FleetStatusStrip(devices: List<DeviceSummaryDto>, attention: List<AttentionItem>, onOpen: () -> Unit) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val critical = attention.count { it.severity == AttentionSeverity.Critical }
  val warning = attention.count { it.severity == AttentionSeverity.Warning }
  val offline = attention.count { it.severity == AttentionSeverity.Offline }
  val online = devices.count { it.status == "online" }
  val (tone, title) = when {
    critical > 0 -> OneUiIconTone.Critical to "${critical + warning} 项需要关注"
    warning > 0 -> OneUiIconTone.Warning to "$warning 项需要关注"
    offline > 0 -> OneUiIconTone.Offline to "$offline 台设备离线"
    else -> OneUiIconTone.Online to "全部设备运行正常"
  }
  val detail = if (attention.isEmpty()) {
    "${devices.size} 台设备均在线，温度、硬盘与存储池规则每分钟检查"
  } else {
    listOfNotNull(
      critical.takeIf { it > 0 }?.let { "严重 $it" },
      warning.takeIf { it > 0 }?.let { "警告 $it" },
      offline.takeIf { it > 0 }?.let { "离线 $it" },
      "在线 $online/${devices.size}"
    ).joinToString(" · ")
  }
  OneUiGroup {
    OneUiListItem(
      title = title,
      subtitle = detail,
      onClick = onOpen,
      leading = {
        OneUiLeadingIcon(
          icon = if (attention.isEmpty()) Icons.Rounded.CheckCircle else Icons.Rounded.ReportProblem,
          contentDescription = null,
          tone = tone
        )
      },
      trailing = {
        OneUiText(text = "查看 ›", role = OneUiTextRole.ChartLabel, color = colors.accent, weight = FontWeight.SemiBold)
      }
    )
  }
  Spacer(Modifier.height(metrics.spaceXxs))
}

@Composable
private fun TrendWindowRow(selected: MetricWindow, onSelect: (MetricWindow) -> Unit) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
    verticalAlignment = Alignment.CenterVertically
  ) {
    OneUiText(text = "趋势", role = OneUiTextRole.ChartLabel, color = colors.textTertiary, weight = FontWeight.SemiBold)
    listOf(
      MetricWindow.FiveMinutes to "5 分钟",
      MetricWindow.OneHour to "1 小时",
      MetricWindow.OneDay to "24 小时"
    ).forEach { (window, label) ->
      OneUiFilterChip(label = label, selected = window == selected, onClick = { onSelect(window) })
    }
  }
}

/**
 * 设备趋势卡：一眼读出这台机器「现在多忙、最近怎么走、有没有事」。
 * 读数用中性色，越线才上警告/临界色——颜色只在有信息时出现。
 */
@Composable
private fun DeviceTrendCard(
  device: DeviceSummaryDto,
  overview: OverviewInstanceSeriesDto?,
  chartWindow: ChartWindow,
  issues: List<AttentionItem>,
  nowMillis: Long,
  onOpen: () -> Unit,
  onOpenBlock: (DeviceBlockKey) -> Unit,
  onMore: () -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val shapes = OneUiTheme.shapes
  val online = device.status == "online"
  val issueSeverity = issues.minByOrNull { it.severity.rank }?.severity

  Column(
    modifier = Modifier
      .fillMaxWidth()
      .oneUiSurface(colors.group, shapes.card, colors = colors, level = OneUiSurfaceLevel.Group)
      .oneUiPressable(onClick = onOpen, onLongClick = onMore, shape = shapes.card, minHeight = null)
      .padding(start = metrics.spaceM, end = metrics.spaceXs, top = metrics.spaceS, bottom = metrics.spaceM),
    verticalArrangement = Arrangement.spacedBy(metrics.spaceS)
  ) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(metrics.spaceS)) {
      OneUiLeadingIcon(
        icon = deviceIcon(device.os),
        contentDescription = null,
        tone = when {
          !online -> OneUiIconTone.Offline
          issueSeverity == AttentionSeverity.Critical -> OneUiIconTone.Critical
          issueSeverity == AttentionSeverity.Warning -> OneUiIconTone.Warning
          else -> OneUiIconTone.Accent
        }
      )
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        OneUiText(text = device.hostname, role = OneUiTextRole.RowTitle, maxLines = 1)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          OneUiStatusDot(color = if (online) colors.online else colors.offline, description = if (online) "在线" else "离线")
          OneUiText(
            text = buildString {
              append(if (online) "在线" else "离线")
              append(" · ")
              append(relativeTimeLabel(device.lastSeenAt, nowMillis))
              append(" · ")
              append(osLabel(device.os))
            },
            role = OneUiTextRole.ChartLabel,
            color = colors.textSecondary,
            maxLines = 1
          )
        }
      }
      OneUiIconButton(contentDescription = "${device.hostname} 的更多操作", onClick = onMore) {
        OneUiIcon(Icons.Rounded.MoreVert, contentDescription = null, tint = colors.textSecondary, size = metrics.iconFilledSize)
      }
    }

    issues.firstOrNull { it.severity != AttentionSeverity.Offline }?.let { first ->
      IssueLine(first = first, more = issues.count { it.severity != AttentionSeverity.Offline } - 1) {
        first.block?.let(onOpenBlock) ?: onOpen()
      }
    }

    if (online) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(end = metrics.spaceXs),
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
      ) {
        val memoryTotal = device.memoryTotalBytes?.toDouble() ?: 0.0
        MetricCell(
          label = "CPU",
          value = formatPercent(device.cpuUsagePercent),
          tone = percentTone(device.cpuUsagePercent, 85.0, 95.0),
          points = overview?.cpuUsagePercent.orEmpty(),
          chartWindow = chartWindow,
          fixedMax = 100.0,
          color = colors.seriesColor(0),
          onClick = { onOpenBlock(DeviceBlockKey.Cpu) },
          modifier = Modifier.weight(1f)
        )
        MetricCell(
          label = "内存",
          value = formatPercent(device.memoryUsagePercent),
          tone = percentTone(device.memoryUsagePercent, 88.0, 95.0),
          points = percentOf(overview?.memoryUsedBytes.orEmpty(), memoryTotal),
          chartWindow = chartWindow,
          fixedMax = 100.0,
          color = colors.seriesColor(1),
          onClick = { onOpenBlock(DeviceBlockKey.Memory) },
          modifier = Modifier.weight(1f)
        )
        val rx = overview?.networkRxBytesPerSec.orEmpty()
        val tx = overview?.networkTxBytesPerSec.orEmpty()
        MetricCell(
          label = "网络",
          value = "↓ ${formatSpeed(seriesStats(rx)?.latest)}",
          secondary = "↑ ${formatSpeed(seriesStats(tx)?.latest)}",
          tone = null,
          points = rx,
          secondaryPoints = tx,
          chartWindow = chartWindow,
          fixedMax = null,
          color = colors.seriesColor(0),
          secondaryColor = colors.seriesColor(2),
          onClick = { onOpenBlock(DeviceBlockKey.Network) },
          modifier = Modifier.weight(1f)
        )
      }
      CapacityLine(device = device, onClick = { onOpenBlock(DeviceBlockKey.Disk) }, onGpu = { onOpenBlock(DeviceBlockKey.Gpu) })
    } else {
      OneUiText(
        text = "设备离线，最后一次上报于 ${formatTime(device.lastSeenAt)}。恢复上报后这里会重新显示趋势。",
        role = OneUiTextRole.RowSubtitle,
        color = colors.textTertiary
      )
    }
  }
}

@Composable
private fun IssueLine(first: AttentionItem, more: Int, onClick: () -> Unit) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val critical = first.severity == AttentionSeverity.Critical
  val soft = if (critical) colors.criticalSoft else colors.warningSoft
  val content = if (critical) colors.criticalContent else colors.warningContent
  Row(
    modifier = Modifier
      .padding(end = metrics.spaceXs)
      .fillMaxWidth()
      .background(soft, OneUiTheme.shapes.tile)
      .oneUiPressable(onClick = onClick, shape = OneUiTheme.shapes.tile, minHeight = metrics.touchTarget)
      .padding(horizontal = metrics.spaceS, vertical = 6.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
  ) {
    OneUiIcon(Icons.Rounded.ReportProblem, contentDescription = null, tint = content, size = metrics.iconFilledSize)
    OneUiText(
      text = if (more > 0) "${first.title}（另有 $more 项）" else first.title,
      role = OneUiTextRole.RowSubtitle,
      color = content,
      weight = FontWeight.SemiBold,
      modifier = Modifier.weight(1f),
      maxLines = 1
    )
    OneUiText(text = first.severity.label, role = OneUiTextRole.ChartLabel, color = content)
  }
}

/** 读数格：标签 / 当前值（可带第二行）/ 迷你趋势。整格可点，直达该类别明细。 */
@Composable
private fun MetricCell(
  label: String,
  value: String,
  tone: AttentionSeverity?,
  points: List<SamplePointDto>,
  chartWindow: ChartWindow,
  fixedMax: Double?,
  color: Color,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  secondary: String? = null,
  secondaryPoints: List<SamplePointDto> = emptyList(),
  secondaryColor: Color = color
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val valueColor = when (tone) {
    AttentionSeverity.Critical -> colors.criticalContent
    AttentionSeverity.Warning -> colors.warningContent
    else -> colors.textPrimary
  }
  Column(
    modifier = modifier
      .background(colors.sunken.copy(alpha = 0.55f), OneUiTheme.shapes.tile)
      .oneUiPressable(onClick = onClick, shape = OneUiTheme.shapes.tile, minHeight = metrics.touchTarget)
      .semantics(mergeDescendants = true) { contentDescription = "$label $value${secondary?.let { "，$it" } ?: ""}，查看明细" }
      .padding(horizontal = 10.dp, vertical = metrics.spaceXs),
    verticalArrangement = Arrangement.spacedBy(2.dp)
  ) {
    OneUiText(text = label, role = OneUiTextRole.ChartLabel, color = colors.textTertiary, maxLines = 1)
    OneUiText(text = value, role = OneUiTextRole.Subtitle, color = valueColor, weight = FontWeight.SemiBold, maxLines = 1)
    if (secondary != null) {
      OneUiText(text = secondary, role = OneUiTextRole.ChartLabel, color = colors.textSecondary, maxLines = 1)
    }
    Box(modifier = Modifier.fillMaxWidth().padding(top = 2.dp)) {
      val sharedMax = fixedMax ?: (points + secondaryPoints).maxOfOrNull { it.value }?.let { it * 1.1 }
      if (secondaryPoints.isNotEmpty()) {
        OneUiSparkline(points = secondaryPoints, chartWindow = chartWindow, color = secondaryColor, fixedMaxValue = sharedMax, modifier = Modifier.fillMaxWidth())
      }
      OneUiSparkline(points = points, chartWindow = chartWindow, color = color, fixedMaxValue = sharedMax, modifier = Modifier.fillMaxWidth())
    }
  }
}

/** 容量行：硬盘占用条 + 已用/总量；有显卡时在行尾给出 GPU 占用。 */
@Composable
private fun CapacityLine(device: DeviceSummaryDto, onClick: () -> Unit, onGpu: () -> Unit) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val disk = device.diskUsagePercent
  val diskTone = percentTone(disk, 85.0, 95.0)
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .padding(end = metrics.spaceXs),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
  ) {
    Column(
      modifier = Modifier
        .weight(1f)
        .oneUiPressable(onClick = onClick, shape = OneUiTheme.shapes.tile, minHeight = metrics.touchTarget)
        .padding(horizontal = 4.dp, vertical = 4.dp),
      verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
      Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        OneUiText(text = "硬盘", role = OneUiTextRole.ChartLabel, color = colors.textTertiary)
        OneUiText(
          text = buildString {
            append(formatPercent(disk))
            if (device.diskUsedBytes != null && device.diskTotalBytes != null && device.diskTotalBytes > 0) {
              append(" · ")
              append(formatBytes(device.diskUsedBytes.toDouble()))
              append(" / ")
              append(formatBytes(device.diskTotalBytes.toDouble()))
            }
          },
          role = OneUiTextRole.ChartLabel,
          color = when (diskTone) {
            AttentionSeverity.Critical -> colors.criticalContent
            AttentionSeverity.Warning -> colors.warningContent
            else -> colors.textSecondary
          },
          weight = FontWeight.SemiBold
        )
      }
      OneUiLinearProgress(
        fraction = ((disk ?: 0.0) / 100.0).toFloat().coerceIn(0f, 1f),
        color = when (diskTone) {
          AttentionSeverity.Critical -> colors.critical
          AttentionSeverity.Warning -> colors.warning
          else -> colors.seriesColor(2)
        },
        height = 6.dp
      )
    }
    device.gpuUsagePercent?.let { gpu ->
      Column(
        modifier = Modifier
          .oneUiPressable(onClick = onGpu, shape = OneUiTheme.shapes.tile, minHeight = metrics.touchTarget)
          .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.End
      ) {
        OneUiText(text = "GPU", role = OneUiTextRole.ChartLabel, color = colors.textTertiary)
        OneUiText(text = formatPercent(gpu), role = OneUiTextRole.ChartLabel, color = colors.textPrimary, weight = FontWeight.SemiBold)
      }
    }
  }
}

private fun percentTone(value: Double?, warning: Double, critical: Double): AttentionSeverity? = when {
  value == null -> null
  value >= critical -> AttentionSeverity.Critical
  value >= warning -> AttentionSeverity.Warning
  else -> null
}

@Composable
private fun EditableDeviceRow(
  device: DeviceSummaryDto,
  canMoveUp: Boolean,
  canMoveDown: Boolean,
  onMove: (Int) -> Unit,
  onRequestDelete: () -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  OneUiGroup {
    OneUiListItem(
      title = device.hostname,
      subtitle = "${osLabel(device.os)} · ${device.deviceId}",
      enabled = true,
      leading = {
        OneUiLeadingIcon(icon = deviceIcon(device.os), contentDescription = null, tone = OneUiIconTone.Neutral)
      },
      trailing = {
        Row(horizontalArrangement = Arrangement.spacedBy(metrics.spaceXxs)) {
          OneUiIconButton(contentDescription = "上移 ${device.hostname}", onClick = { onMove(-1) }, enabled = canMoveUp, haptics = OneUiHaptics.Toggle) {
            OneUiIcon(Icons.Rounded.ArrowUpward, contentDescription = null, tint = colors.textSecondary, size = metrics.iconFilledSize)
          }
          OneUiIconButton(contentDescription = "下移 ${device.hostname}", onClick = { onMove(1) }, enabled = canMoveDown, haptics = OneUiHaptics.Toggle) {
            OneUiIcon(Icons.Rounded.ArrowDownward, contentDescription = null, tint = colors.textSecondary, size = metrics.iconFilledSize)
          }
          OneUiIconButton(contentDescription = "从列表隐藏 ${device.hostname}", onClick = onRequestDelete) {
            OneUiIcon(Icons.Rounded.Delete, contentDescription = null, tint = colors.criticalContent, size = metrics.iconFilledSize)
          }
        }
      }
    )
  }
}

/** 编辑态的上下文操作条（构）：One UI 把确认/取消放在底部拇指区。 */
@Composable
private fun EditDock(onCancel: () -> Unit, onSave: () -> Unit, dirty: Boolean) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .oneUiSurface(colors.raised, OneUiTheme.shapes.dock, colors = colors, level = OneUiSurfaceLevel.Raised)
      .navigationBarsPadding()
      .padding(horizontal = metrics.screenMargin, vertical = metrics.spaceM),
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceS),
    verticalAlignment = Alignment.CenterVertically
  ) {
    OneUiButton(label = "取消", onClick = onCancel, variant = OneUiButtonVariant.Text, modifier = Modifier.weight(1f))
    OneUiButton(label = if (dirty) "保存顺序" else "完成", onClick = onSave, modifier = Modifier.weight(1f))
  }
}

private fun connectionSummary(state: AppState, devices: List<DeviceSummaryDto>): String {
  val online = devices.count { it.status == "online" }
  return when {
    !state.authenticated && state.serverConfig.baseUrl.isNotBlank() -> "正在连接中枢"
    state.loading && devices.isEmpty() -> "正在读取设备清单"
    else -> "${devices.size} 台设备 · $online 台在线"
  }
}

internal fun osLabel(os: String): String = when {
  os.contains("win", ignoreCase = true) -> "Windows"
  os.contains("darwin", ignoreCase = true) || os.contains("mac", ignoreCase = true) -> "macOS"
  os.contains("linux", ignoreCase = true) -> "Linux"
  os.contains("android", ignoreCase = true) -> "Android"
  else -> os.replaceFirstChar { it.uppercase() }
}

internal fun deviceIcon(os: String) = when {
  os.contains("win", ignoreCase = true) -> Icons.Rounded.Computer
  os.contains("nas", ignoreCase = true) || os.contains("docker", ignoreCase = true) -> Icons.Rounded.Storage
  os.contains("linux", ignoreCase = true) -> Icons.Rounded.Dns
  else -> Icons.Rounded.Router
}
