package com.dsc.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ReportProblem
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.SwapVert
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
import androidx.compose.ui.text.style.TextOverflow
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
import com.dsc.android.UpdateInfoDto
import com.dsc.android.collectAttention
import com.dsc.android.percentOf
import com.dsc.android.seriesStats
import com.dsc.android.ui.oneui.OneUiActionModel
import com.dsc.android.ui.oneui.OneUiActionSheet
import com.dsc.android.ui.oneui.OneUiButton
import com.dsc.android.ui.oneui.OneUiButtonSize
import com.dsc.android.ui.oneui.OneUiButtonVariant
import com.dsc.android.ui.oneui.OneUiCheckbox
import com.dsc.android.ui.oneui.OneUiCompactSearchBar
import com.dsc.android.ui.oneui.OneUiDialog
import com.dsc.android.ui.oneui.OneUiDuration
import com.dsc.android.ui.oneui.OneUiEasing
import com.dsc.android.ui.oneui.OneUiEmptyState
import com.dsc.android.ui.oneui.OneUiExpandable
import com.dsc.android.ui.oneui.OneUiFilterChip
import com.dsc.android.ui.oneui.OneUiGroup
import com.dsc.android.ui.oneui.OneUiGroupHeader
import com.dsc.android.ui.oneui.OneUiHaptics
import com.dsc.android.ui.oneui.OneUiIcon
import com.dsc.android.ui.oneui.OneUiIconButton
import com.dsc.android.ui.oneui.OneUiIconTone
import com.dsc.android.ui.oneui.OneUiInlineChevron
import com.dsc.android.ui.oneui.OneUiLeadingIcon
import com.dsc.android.ui.oneui.OneUiLinearProgress
import com.dsc.android.ui.oneui.OneUiListDivider
import com.dsc.android.ui.oneui.OneUiListItem
import com.dsc.android.ui.oneui.OneUiMiniFleetMatrix
import com.dsc.android.ui.oneui.OneUiPill
import com.dsc.android.ui.oneui.OneUiPillTone
import com.dsc.android.ui.oneui.OneUiPooledMetricCell
import com.dsc.android.ui.oneui.OneUiSegmentedRow
import com.dsc.android.ui.oneui.OneUiSheet
import com.dsc.android.ui.oneui.OneUiSkeleton
import com.dsc.android.ui.oneui.OneUiSparkline
import com.dsc.android.ui.oneui.OneUiStatusDot
import com.dsc.android.ui.oneui.OneUiStatusPill
import com.dsc.android.ui.oneui.OneUiStatusPillBar
import com.dsc.android.ui.oneui.OneUiStatusPillItem
import com.dsc.android.ui.oneui.OneUiSurfaceLevel
import com.dsc.android.ui.oneui.OneUiSwitch
import com.dsc.android.ui.oneui.OneUiSyncProgress
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextField
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme
import com.dsc.android.ui.oneui.OneUiTopBar
import com.dsc.android.ui.oneui.OneUiTrendChart
import com.dsc.android.ui.oneui.formatBytes
import com.dsc.android.ui.oneui.formatPercent
import com.dsc.android.ui.oneui.formatSpeed
import com.dsc.android.ui.oneui.formatTime
import com.dsc.android.ui.oneui.oneUiContentWidth
import com.dsc.android.ui.oneui.oneUiHorizontalFadingEdge
import com.dsc.android.ui.oneui.oneUiListContentPadding
import com.dsc.android.ui.oneui.oneUiListPlacementSpec
import com.dsc.android.ui.oneui.oneUiPressable
import com.dsc.android.ui.oneui.oneUiSurface
import com.dsc.android.ui.oneui.relativeTimeLabel
import com.dsc.android.ui.oneui.rememberNowMillis
import com.dsc.android.ui.oneui.rememberOneUiCollapse
import com.dsc.android.ui.shell.GuanlanActions
import kotlinx.coroutines.launch

/**
 * 总览与设备组看板（构 + 交）：
 * 1. 顶部通知、超限告警、离线统计与应用更新全部收敛为单行紧凑状态药丸（无事时 0dp），把首屏还给监控数据；
 * 2. 设备组升级为可视化遥测容器：组头常驻池化 CPU/内存/存储水位与微缩负载矩阵，收起即全局组看板，点选单组呈现多机同轴对比曲线；
 * 3. 分组管理采用结构化编辑与专职成员穿梭面板，支持整组排序与双向成员增删同步。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DeviceListScreen(
  state: AppState,
  actions: GuanlanActions,
  embedded: Boolean,
  initialGroupFilter: String = GROUP_FILTER_ALL,
  initialEditMode: Boolean = false
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  val window = OneUiTheme.window
  val listState = rememberLazyListState()
  val collapse = rememberOneUiCollapse(listState)
  val topBarScope = rememberCoroutineScope()
  val now = rememberNowMillis()

  val persisted = remember(state.devices) {
    state.devices.sortedWith(
      compareBy<DeviceSummaryDto> { it.sortOrder ?: Int.MAX_VALUE }.thenBy { it.hostname }
    )
  }
  val persistedIds = remember(persisted) { persisted.map { it.deviceId } }
  val attention = remember(persisted, state.attentionMetrics, now / 60_000) {
    collectAttention(persisted, state.attentionMetrics, now)
  }
  val issuesByDevice = remember(attention) { attention.groupBy { it.deviceId } }
  val overviewById = remember(state.overviewMetrics, state.overviewWindow) {
    state.overviewMetrics
      ?.takeIf { it.window == state.overviewWindow.value }
      ?.instances
      ?.associateBy { it.deviceId }
      .orEmpty()
  }
  val chartWindow = remember(state.overviewWindow, state.overviewMetrics) {
    ChartWindow.from(state.overviewWindow)
  }

  var editMode by rememberSaveable(initialEditMode) { mutableStateOf(initialEditMode) }
  var draftIds by remember { mutableStateOf<List<String>?>(null) }
  var selectedManageIds by remember { mutableStateOf<Set<String>>(emptySet()) }
  var pendingDelete by remember { mutableStateOf<DeviceSummaryDto?>(null) }
  var actionTarget by remember { mutableStateOf<DeviceSummaryDto?>(null) }
  var groupEditTarget by remember { mutableStateOf<DeviceSummaryDto?>(null) }
  var membersSheetGroup by remember { mutableStateOf<String?>(null) }
  var createGroupOpen by remember { mutableStateOf(false) }
  var createGroupPreselected by remember { mutableStateOf<Set<String>>(emptySet()) }
  var groupActionTarget by remember { mutableStateOf<DeviceGroupSectionModel?>(null) }
  var groupRenameTarget by remember { mutableStateOf<DeviceGroupSectionModel?>(null) }
  var groupDissolveTarget by remember { mutableStateOf<DeviceGroupSectionModel?>(null) }
  var viewAndSortSheet by remember { mutableStateOf(false) }
  var updateSheetOpen by remember { mutableStateOf(false) }
  var sortMode by rememberSaveable { mutableStateOf(DeviceSortMode.Custom.name) }
  var groupFilter by rememberSaveable(initialGroupFilter) { mutableStateOf(initialGroupFilter) }
  var onlyOfflineFilter by rememberSaveable { mutableStateOf(false) }
  var searchOpen by rememberSaveable { mutableStateOf(false) }
  var query by rememberSaveable { mutableStateOf("") }
  var comparisonMetricName by rememberSaveable { mutableStateOf(GroupComparisonMetric.Cpu.name) }

  val sort = DeviceSortMode.entries.firstOrNull { it.name == sortMode } ?: DeviceSortMode.Custom
  val comparisonMetric = GroupComparisonMetric.entries.firstOrNull { it.name == comparisonMetricName }
    ?: GroupComparisonMetric.Cpu

  val effectiveManageIds = remember(draftIds, persistedIds) {
    mergeDeviceOrderDraft(draftIds, persistedIds)
  }
  val orderDirty = editMode && draftIds != null && effectiveManageIds != persistedIds

  val allGroupSections = remember(persisted, issuesByDevice, overviewById) {
    buildDeviceGroupSections(persisted, issuesByDevice, overviewById)
  }
  val existingGroupNames = remember(allGroupSections) {
    allGroupSections.filterNot { it.isUngrouped }.map { it.name }
  }
  val hasNamedGroups = existingGroupNames.isNotEmpty()
  val activeGroupFilter = if (groupFilter != GROUP_FILTER_ALL && allGroupSections.none { it.key == groupFilter }) {
    GROUP_FILTER_ALL
  } else {
    groupFilter
  }
  val activeGroupSection = remember(allGroupSections, activeGroupFilter) {
    if (activeGroupFilter == GROUP_FILTER_ALL) null else allGroupSections.firstOrNull { it.key == activeGroupFilter }
  }

  val manageDevices = remember(persisted, effectiveManageIds) {
    val byId = persisted.associateBy { it.deviceId }
    effectiveManageIds.mapNotNull { byId[it] }
  }
  val manageGroupSections = remember(manageDevices, issuesByDevice) {
    buildDeviceGroupSections(manageDevices, issuesByDevice)
  }

  val filteredPersisted = remember(persisted, activeGroupFilter, onlyOfflineFilter, query) {
    persisted.filter { device ->
      device.matchesGroup(activeGroupFilter) &&
        (!onlyOfflineFilter || device.status != "online") &&
        device.matchesQuery(query)
    }
  }

  val useGroupedDisplay = !editMode &&
    hasNamedGroups &&
    activeGroupFilter == GROUP_FILTER_ALL &&
    (sort == DeviceSortMode.Custom || state.groupScopedSort)

  val visibleGroupSections = remember(filteredPersisted, issuesByDevice, overviewById, sort, state.groupScopedSort) {
    val withinSort = if (state.groupScopedSort) sort else DeviceSortMode.Custom
    buildDeviceGroupSections(filteredPersisted, issuesByDevice, overviewById, withinSort)
  }

  val visibleFlatDevices = remember(filteredPersisted, sort, issuesByDevice) {
    sortDevices(filteredPersisted, sort, issuesByDevice)
  }

  val offlineCount = remember(persisted) { persisted.count { it.status != "online" } }

  val statusPills = remember(
    state.authenticated,
    state.serverConfig.baseUrl,
    state.dataSource,
    state.loggingIn,
    state.refreshing,
    state.cacheSavedAt,
    state.updateInfo,
    state.updateDownloading,
    state.updateProgress,
    state.dismissedUpdateVersion,
    offlineCount,
    onlyOfflineFilter,
    sort,
    now / 30_000
  ) {
    buildOverviewStatusPills(
      state = state,
      offlineCount = offlineCount,
      onlyOffline = onlyOfflineFilter,
      sort = sort,
      nowMillis = now,
      colors = colors,
      onRefresh = actions.onRefresh,
      onToggleOffline = { onlyOfflineFilter = !onlyOfflineFilter },
      onOpenSortSheet = { viewAndSortSheet = true },
      onResetSort = { sortMode = DeviceSortMode.Custom.name },
      onOpenUpdate = { updateSheetOpen = true },
      onDismissUpdate = { version -> actions.onDismissUpdateNotice(version) }
    )
  }

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.canvas)
  ) {
    Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
      Box {
        OneUiTopBar(
          title = when {
            editMode -> "分组与顺序"
            activeGroupSection != null -> activeGroupSection.name
            else -> "总览"
          },
          subtitle = when {
            editMode -> if (hasNamedGroups) "整组移动、增减成员或勾选机器批量设组" else "创建设备组或调整设备排列顺序"
            activeGroupSection != null -> "${activeGroupSection.online}/${activeGroupSection.total} 台在线 · ${activeGroupSection.glanceSubtitle}"
            else -> connectionSummary(state, persisted)
          },
          collapse = collapse,
          onCollapsedTitleClick = { topBarScope.launch { listState.animateScrollToItem(0) } },
          large = !embedded,
          actions = {
            if (!editMode) {
              if (persisted.isNotEmpty()) {
                OneUiIconButton(
                  contentDescription = if (searchOpen || query.isNotBlank()) "收起搜索" else "搜索设备与分组",
                  selected = searchOpen || query.isNotBlank(),
                  onClick = {
                    if (searchOpen && query.isBlank()) {
                      searchOpen = false
                    } else if (searchOpen) {
                      query = ""
                      searchOpen = false
                    } else {
                      searchOpen = true
                    }
                  }
                ) {
                  OneUiIcon(
                    imageVector = Icons.Rounded.Search,
                    contentDescription = null,
                    tint = if (searchOpen || query.isNotBlank()) colors.accent else colors.textPrimary
                  )
                }
                val viewCustomized = sort != DeviceSortMode.Custom || state.compactDeviceList || !state.groupScopedSort || onlyOfflineFilter
                OneUiIconButton(
                  contentDescription = "视图密度、筛选与排序：${sort.label}",
                  selected = viewCustomized,
                  onClick = { viewAndSortSheet = true }
                ) {
                  OneUiIcon(
                    imageVector = Icons.Rounded.SwapVert,
                    contentDescription = null,
                    tint = if (viewCustomized) colors.accent else colors.textPrimary
                  )
                }
                OneUiIconButton(
                  contentDescription = "管理分组与顺序",
                  onClick = {
                    draftIds = persistedIds
                    selectedManageIds = emptySet()
                    editMode = true
                  }
                ) {
                  OneUiIcon(Icons.Rounded.Edit, contentDescription = null, tint = colors.textPrimary)
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
            }
          }
        )
        OneUiSyncProgress(visible = state.refreshing, modifier = Modifier.align(Alignment.BottomCenter))
      }

      // 唯一吸顶条：按需展开搜索栏 + 标准 38dp 设备组分段导航（状态提示与时间控制移入滚动区，不再锁死首屏）
      if (!editMode) {
        Column(
          modifier = Modifier
            .fillMaxWidth()
            .oneUiContentWidth(metrics)
            .padding(horizontal = metrics.screenMargin)
            .padding(bottom = metrics.spaceXxs),
          verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
          OneUiExpandable(expanded = searchOpen || query.isNotBlank()) {
            OneUiCompactSearchBar(
              value = query,
              onValueChange = { query = it },
              placeholder = "搜索主机名、分组、系统或设备 ID",
              onClearOrClose = {
                if (query.isNotEmpty()) {
                  query = ""
                } else {
                  searchOpen = false
                }
              }
            )
          }

          if (persisted.isNotEmpty()) {
            GroupNavigationStrip(
              totalCount = persisted.size,
              groups = allGroupSections,
              hasNamedGroups = hasNamedGroups,
              selectedKey = activeGroupFilter,
              onSelect = { nextKey ->
                groupFilter = if (nextKey != GROUP_FILTER_ALL && nextKey == activeGroupFilter) {
                  GROUP_FILTER_ALL
                } else {
                  nextKey
                }
                topBarScope.launch { listState.animateScrollToItem(0) }
              },
              onCreateGroup = {
                createGroupPreselected = emptySet()
                createGroupOpen = true
              }
            )
          }
        }
      }

      val itemFadeIn = motion.tween<Float>(OneUiDuration.Content, OneUiEasing.SineInOut90)
      val itemFadeOut = motion.tween<Float>(OneUiDuration.Exit, OneUiEasing.Exit)
      val itemPlacement = oneUiListPlacementSpec(motion)

      LazyColumn(
        state = listState,
        modifier = Modifier
          .weight(1f)
          .fillMaxWidth()
          .oneUiContentWidth(metrics),
        contentPadding = oneUiListContentPadding(),
        verticalArrangement = Arrangement.spacedBy(if (useGroupedDisplay) metrics.groupGap else metrics.cardGap)
      ) {
        if (!editMode && statusPills.isNotEmpty()) {
          item(key = "overview-status-pills") {
            OneUiStatusPillBar(
              pills = statusPills,
              modifier = Modifier.animateItem(
                fadeInSpec = itemFadeIn,
                placementSpec = itemPlacement,
                fadeOutSpec = itemFadeOut
              )
            )
          }
        }

        if (!editMode && persisted.isNotEmpty()) {
          item(key = "overview-controls") {
            OverviewControlRow(
              selectedWindow = state.overviewWindow,
              activeGroup = activeGroupSection,
              showCollapseAll = useGroupedDisplay && visibleGroupSections.size > 1,
              allCollapsed = visibleGroupSections.isNotEmpty() && visibleGroupSections.all { it.key in state.collapsedGroups },
              onSelectWindow = actions.onSelectOverviewWindow,
              onToggleCollapseAll = {
                val allCollapsed = visibleGroupSections.all { it.key in state.collapsedGroups }
                if (allCollapsed) {
                  actions.onSetCollapsedGroups(state.collapsedGroups - visibleGroupSections.map { it.key }.toSet())
                } else {
                  actions.onSetCollapsedGroups(state.collapsedGroups + visibleGroupSections.map { it.key }.toSet())
                }
              },
              onOpenGroupMembers = { group ->
                if (group.isUngrouped) {
                  createGroupPreselected = group.devices.map { it.deviceId }.toSet()
                  createGroupOpen = true
                } else {
                  membersSheetGroup = group.name
                }
              },
              onOpenGroupMenu = { group -> groupActionTarget = group },
              modifier = Modifier.animateItem(
                fadeInSpec = itemFadeIn,
                placementSpec = itemPlacement,
                fadeOutSpec = itemFadeOut
              )
            )
          }
        }
        if (state.loading && persisted.isEmpty()) {
          items(3) { OneUiSkeleton(height = 152.dp) }
        }

        if (!state.loading && persisted.isEmpty()) {
          item(key = "empty") {
            OneUiEmptyState(
              title = "暂未发现设备",
              description = "确认中枢已收到 Agent 上报，或点按刷新重试。",
              icon = Icons.Rounded.Router,
              actionLabel = "刷新",
              onAction = actions.onRefresh
            )
          }
        } else if (!editMode && filteredPersisted.isEmpty() && (query.isNotBlank() || activeGroupFilter != GROUP_FILTER_ALL || onlyOfflineFilter)) {
          item(key = "no-match") {
            OneUiEmptyState(
              title = "没有匹配的设备",
              description = buildString {
                if (query.isNotBlank()) append("没有包含「${query.trim()}」的设备")
                else if (onlyOfflineFilter) append("当前范围内没有离线设备")
                else append("当前分组筛选下暂无设备")
              },
              actionLabel = "清除筛选",
              onAction = {
                query = ""
                onlyOfflineFilter = false
                groupFilter = GROUP_FILTER_ALL
              }
            )
          }
        }

        if (editMode) {
          item(key = "manage-toolbar") {
            ManageToolbarRow(
              totalCount = manageDevices.size,
              selectedCount = selectedManageIds.size,
              onCreateGroup = {
                createGroupPreselected = selectedManageIds
                createGroupOpen = true
              },
              onToggleSelectAll = {
                val allIds = manageDevices.map { it.deviceId }.toSet()
                selectedManageIds = if (selectedManageIds.size == allIds.size) emptySet() else allIds
              },
              onClearGroupForSelected = if (selectedManageIds.isNotEmpty()) {
                {
                  val targets = selectedManageIds.toList()
                  selectedManageIds = emptySet()
                  actions.onUpdateDeviceGroup(targets, null)
                }
              } else null
            )
          }

          if (hasNamedGroups) {
            val namedCount = manageGroupSections.count { !it.isUngrouped }
            manageGroupSections.forEachIndexed { sectionIdx, section ->
              item(key = "manage-group:${section.key}") {
                val namedIdx = if (section.isUngrouped) -1 else sectionIdx
                StructuredEditableGroupCard(
                  section = section,
                  canMoveGroupUp = !section.isUngrouped && namedIdx > 0,
                  canMoveGroupDown = !section.isUngrouped && namedIdx in 0 until (namedCount - 1),
                  selectedIds = selectedManageIds,
                  onToggleSelect = { id ->
                    selectedManageIds = if (id in selectedManageIds) selectedManageIds - id else selectedManageIds + id
                  },
                  onMoveGroup = { delta ->
                    moveDeviceGroupOrder(manageDevices, section.key, delta)?.let { next -> draftIds = next }
                  },
                  onManageMembers = {
                    if (section.isUngrouped) {
                      createGroupPreselected = section.devices.map { it.deviceId }.toSet()
                      createGroupOpen = true
                    } else {
                      membersSheetGroup = section.name
                    }
                  },
                  onRenameGroup = if (!section.isUngrouped) {
                    { groupRenameTarget = section }
                  } else null,
                  onDissolveGroup = if (!section.isUngrouped) {
                    { groupDissolveTarget = section }
                  } else null,
                  onEditDeviceGroup = { device -> groupEditTarget = device },
                  onMoveDevice = { device, delta ->
                    moveDeviceOrder(manageDevices, device.deviceId, delta, withinGroup = true)?.let { next ->
                      draftIds = next
                    }
                  },
                  onRequestDelete = { device -> pendingDelete = device }
                )
              }
            }
          } else {
            items(manageDevices, key = { "edit:${it.deviceId}" }) { device ->
              val index = manageDevices.indexOf(device)
              EditableDeviceRow(
                device = device,
                checked = device.deviceId in selectedManageIds,
                canMoveUp = index > 0,
                canMoveDown = index < manageDevices.lastIndex,
                onToggleCheck = {
                  val id = device.deviceId
                  selectedManageIds = if (id in selectedManageIds) selectedManageIds - id else selectedManageIds + id
                },
                onEditGroup = { groupEditTarget = device },
                onMove = { delta ->
                  moveDeviceOrder(manageDevices, device.deviceId, delta, withinGroup = false)?.let { next ->
                    draftIds = next
                  }
                },
                onRequestDelete = { pendingDelete = device }
              )
            }
          }
        } else if (activeGroupSection != null && filteredPersisted.isNotEmpty()) {
          // 单组聚焦深度视图：组级池化遥测摘要 + 多机同轴趋势对比图 + 组内机器列表（无重复标题）
          val focusedSection = visibleGroupSections.firstOrNull { it.key == activeGroupSection.key } ?: activeGroupSection
          item(key = "focused-group-summary:${focusedSection.key}") {
            GroupFocusSummaryCard(
              section = focusedSection,
              chartWindow = chartWindow,
              modifier = Modifier.animateItem(
                fadeInSpec = itemFadeIn,
                placementSpec = itemPlacement,
                fadeOutSpec = itemFadeOut
              )
            )
          }
          if (focusedSection.devices.isNotEmpty() && overviewById.isNotEmpty()) {
            item(key = "focused-group-comparison:${focusedSection.key}") {
              GroupComparisonChartCard(
                section = focusedSection,
                overviewById = overviewById,
                chartWindow = chartWindow,
                metric = comparisonMetric,
                sampled = state.overviewMetrics?.sampling != null,
                onSelectMetric = { comparisonMetricName = it.name },
                onOpenDevice = { deviceId -> actions.onOpenDevice(deviceId, null) },
                modifier = Modifier.animateItem(
                  fadeInSpec = itemFadeIn,
                  placementSpec = itemPlacement,
                  fadeOutSpec = itemFadeOut
                )
              )
            }
          }
          renderDeviceCollection(
            scopeKey = "focused:${focusedSection.key}",
            devices = focusedSection.devices,
            compact = state.compactDeviceList,
            wideGrid = !embedded && window.isWide,
            selectedDeviceId = if (embedded) state.selectedDeviceId else null,
            showGroupBadge = false,
            overviewById = overviewById,
            chartWindow = chartWindow,
            issuesByDevice = issuesByDevice,
            nowMillis = now,
            onOpen = { id -> actions.onOpenDevice(id, null) },
            onOpenBlock = { id, block -> actions.onOpenDevice(id, block) },
            onEditGroup = { device -> groupEditTarget = device },
            onMore = { device -> actionTarget = device }
          )
        } else if (useGroupedDisplay && visibleGroupSections.isNotEmpty()) {
          // 全部设备分组视图：每个设备组是一张完整的可视化看板卡（收起仍保留池化水位与微缩负载矩阵）
          visibleGroupSections.forEach { groupSection ->
            val isCollapsed = groupSection.key in state.collapsedGroups
            item(key = "group-card:${groupSection.key}") {
              DeviceGroupDashboardCard(
                section = groupSection,
                collapsed = isCollapsed,
                compact = state.compactDeviceList,
                wideGrid = !embedded && window.isWide,
                selectedDeviceId = if (embedded) state.selectedDeviceId else null,
                overviewById = overviewById,
                chartWindow = chartWindow,
                issuesByDevice = issuesByDevice,
                nowMillis = now,
                onToggleCollapse = { actions.onToggleGroupCollapsed(groupSection.key) },
                onFocusGroup = {
                  groupFilter = groupSection.key
                  topBarScope.launch { listState.animateScrollToItem(0) }
                },
                onAssignUngrouped = {
                  createGroupPreselected = groupSection.devices.map { it.deviceId }.toSet()
                  createGroupOpen = true
                },
                onOpenGroupMenu = { groupActionTarget = groupSection },
                onOpenDevice = { id -> actions.onOpenDevice(id, null) },
                onOpenBlock = { id, block -> actions.onOpenDevice(id, block) },
                onEditDeviceGroup = { device -> groupEditTarget = device },
                onMoreDevice = { device -> actionTarget = device },
                modifier = Modifier.animateItem(
                  fadeInSpec = itemFadeIn,
                  placementSpec = itemPlacement,
                  fadeOutSpec = itemFadeOut
                )
              )
            }
          }
        } else if (visibleFlatDevices.isNotEmpty()) {
          renderDeviceCollection(
            scopeKey = "flat",
            devices = visibleFlatDevices,
            compact = state.compactDeviceList,
            wideGrid = !embedded && window.isWide,
            selectedDeviceId = if (embedded) state.selectedDeviceId else null,
            showGroupBadge = activeGroupFilter == GROUP_FILTER_ALL,
            overviewById = overviewById,
            chartWindow = chartWindow,
            issuesByDevice = issuesByDevice,
            nowMillis = now,
            onOpen = { id -> actions.onOpenDevice(id, null) },
            onOpenBlock = { id, block -> actions.onOpenDevice(id, block) },
            onEditGroup = { device -> groupEditTarget = device },
            onMore = { device -> actionTarget = device }
          )
        }

        item(key = "bottom-spacer") { Spacer(Modifier.height(metrics.thumbZone)) }
      }

      if (editMode) {
        EditDock(
          dirty = orderDirty,
          selectedCount = selectedManageIds.size,
          onCancel = {
            editMode = false
            draftIds = null
            selectedManageIds = emptySet()
            pendingDelete = null
          },
          onBatchAssignGroup = {
            createGroupPreselected = selectedManageIds
            createGroupOpen = true
          },
          onSave = {
            if (orderDirty) actions.onReorderDevices(effectiveManageIds)
            editMode = false
            draftIds = null
            selectedManageIds = emptySet()
          }
        )
      }
    }
  }

  if (viewAndSortSheet) {
    ViewAndSortSheet(
      sort = sort,
      compact = state.compactDeviceList,
      groupScopedSort = state.groupScopedSort,
      hasNamedGroups = hasNamedGroups,
      offlineCount = offlineCount,
      onlyOffline = onlyOfflineFilter,
      onSelectSort = { next -> sortMode = next.name },
      onSelectCompact = actions.onSetCompactDeviceList,
      onSelectGroupScopedSort = actions.onSetGroupScopedSort,
      onSelectOnlyOffline = { onlyOfflineFilter = it },
      onDismiss = { viewAndSortSheet = false }
    )
  }

  if (updateSheetOpen) {
    state.updateInfo?.takeIf { it.available }?.let { update ->
      UpdateQuickSheet(
        update = update,
        downloading = state.updateDownloading,
        progress = state.updateProgress,
        onDownload = {
          updateSheetOpen = false
          actions.onDownloadUpdate()
        },
        onOpenSettings = {
          updateSheetOpen = false
          actions.onShowSettings()
        },
        onDismissVersion = {
          update.latestVersion?.let(actions.onDismissUpdateNotice)
          updateSheetOpen = false
        },
        onDismiss = { updateSheetOpen = false }
      )
    }
  }

  actionTarget?.let { device ->
    OneUiActionSheet(
      onDismissRequest = { actionTarget = null },
      title = device.hostname,
      actions = listOf(
        OneUiActionModel(
          label = "打开设备详情",
          description = "查看历史图表、实时进程、容器与硬件实例",
          icon = Icons.Rounded.Computer,
          onClick = {
            actionTarget = null
            actions.onOpenDevice(device.deviceId, null)
          }
        ),
        OneUiActionModel(
          label = "设置所属分组",
          description = device.normalizedGroup()?.let { "当前分组：$it（点按切换或移出）" } ?: "点按一键归入已有分组或新建分组",
          icon = Icons.Rounded.Dns,
          onClick = {
            actionTarget = null
            groupEditTarget = device
          }
        ),
        OneUiActionModel(
          label = "查看流量日历",
          description = "按日 / 周 / 月查看上下行流量统计",
          icon = Icons.Rounded.Timeline,
          onClick = {
            actionTarget = null
            actions.onOpenTraffic(device.deviceId)
          }
        ),
        OneUiActionModel(
          label = "编辑采集记录项",
          description = "配置该设备要上报的指标与硬件实例",
          icon = Icons.Rounded.Tune,
          onClick = {
            actionTarget = null
            actions.onOpenDeviceEditor(device.deviceId)
          }
        ),
        OneUiActionModel(
          label = "从列表隐藏",
          description = "设备下次上报时会自动重新出现",
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

  groupEditTarget?.let { device ->
    DeviceGroupPickerSheet(
      title = "设置「${device.hostname}」的分组",
      subtitle = "点按已有分组立即归入，或输入新名称创建分组",
      currentGroup = device.normalizedGroup(),
      existingGroups = existingGroupNames,
      onDismiss = { groupEditTarget = null },
      onConfirm = { nextGroup ->
        val id = device.deviceId
        groupEditTarget = null
        actions.onUpdateDeviceGroup(listOf(id), nextGroup)
      }
    )
  }

  groupActionTarget?.let { groupSection ->
    OneUiActionSheet(
      onDismissRequest = { groupActionTarget = null },
      title = "设备组 · ${groupSection.name}",
      actions = buildList {
        if (activeGroupFilter != groupSection.key) {
          add(
            OneUiActionModel(
              label = "聚焦查看组内对比曲线",
              description = "同屏对比组内 ${groupSection.total} 台设备的 CPU、内存、硬盘与网速趋势",
              icon = Icons.Rounded.Timeline,
              onClick = {
                groupActionTarget = null
                groupFilter = groupSection.key
                topBarScope.launch { listState.animateScrollToItem(0) }
              }
            )
          )
        }
        if (!groupSection.isUngrouped) {
          add(
            OneUiActionModel(
              label = "增减组内成员",
              description = "勾选加入新设备，或取消勾选将现有设备移出分组",
              icon = Icons.Rounded.Dns,
              onClick = {
                groupActionTarget = null
                membersSheetGroup = groupSection.name
              }
            )
          )
          add(
            OneUiActionModel(
              label = "重命名分组",
              description = "将组内 ${groupSection.total} 台设备统一更新为新组名",
              icon = Icons.Rounded.Edit,
              onClick = {
                groupActionTarget = null
                groupRenameTarget = groupSection
              }
            )
          )
          add(
            OneUiActionModel(
              label = "解散分组",
              description = "组内 ${groupSection.total} 台设备恢复为未分组，不删除设备本身",
              icon = Icons.Rounded.Delete,
              destructive = true,
              onClick = {
                groupActionTarget = null
                groupDissolveTarget = groupSection
              }
            )
          )
        }
      }
    )
  }

  membersSheetGroup?.let { targetGroupName ->
    GroupMembersSheet(
      groupName = targetGroupName,
      devices = persisted,
      onDismiss = { membersSheetGroup = null },
      onConfirmDiff = { addedIds, removedIds ->
        membersSheetGroup = null
        actions.onSyncGroupMembership(targetGroupName, addedIds, removedIds)
      }
    )
  }

  if (createGroupOpen) {
    CreateOrAssignGroupSheet(
      devices = persisted,
      existingGroups = existingGroupNames,
      preselectedIds = createGroupPreselected,
      onDismiss = {
        createGroupOpen = false
        createGroupPreselected = emptySet()
      },
      onConfirm = { targetIds, nextGroup ->
        createGroupOpen = false
        createGroupPreselected = emptySet()
        selectedManageIds = emptySet()
        actions.onUpdateDeviceGroup(targetIds, nextGroup)
      }
    )
  }

  groupRenameTarget?.let { groupSection ->
    var nextName by remember(groupSection.name) { mutableStateOf(groupSection.name) }
    val normalizedNext = normalizeGroupInput(nextName)
    val invalidReserved = nextName.isNotBlank() && isReservedGroupName(nextName)
    OneUiDialog(
      onDismissRequest = { groupRenameTarget = null },
      title = "重命名「${groupSection.name}」",
      description = "组内 ${groupSection.total} 台设备将一并归入新分组名。",
      confirmLabel = "保存名称",
      onConfirm = {
        if (normalizedNext != null && !invalidReserved) {
          val ids = groupSection.devices.map { it.deviceId }
          groupRenameTarget = null
          if (groupFilter == groupSection.key) groupFilter = normalizedNext
          actions.onUpdateDeviceGroup(ids, normalizedNext)
        }
      },
      dismissLabel = "取消",
      onDismiss = { groupRenameTarget = null }
    ) {
      OneUiTextField(
        value = nextName,
        onValueChange = { nextName = it.take(64) },
        label = "新分组名称",
        errorText = if (invalidReserved) "该名称为系统保留标识" else null
      )
    }
  }

  groupDissolveTarget?.let { groupSection ->
    OneUiDialog(
      onDismissRequest = { groupDissolveTarget = null },
      title = "解散分组「${groupSection.name}」？",
      description = "解散后，组内 ${groupSection.total} 台设备将恢复为「未分组」状态，设备监控数据不受影响。",
      confirmLabel = "解散分组",
      onConfirm = {
        val ids = groupSection.devices.map { it.deviceId }
        if (groupFilter == groupSection.key) groupFilter = GROUP_FILTER_ALL
        groupDissolveTarget = null
        actions.onUpdateDeviceGroup(ids, null)
      },
      dismissLabel = "取消",
      onDismiss = { groupDissolveTarget = null },
      destructive = true
    )
  }

  pendingDelete?.let { device ->
    OneUiDialog(
      onDismissRequest = { pendingDelete = null },
      title = "从列表隐藏 ${device.hostname}？",
      description = "它会从当前设备列表移除；如果该机器上的 Agent 仍在运行，下次上报时会自动重新出现。",
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

/* ---------------- 顶部紧凑状态药丸与分组导航栏 ---------------- */

/**
 * 状态提示条（仅承载需要立即注意的系统状态或已激活筛选，常态 0dp）：
 * 告警数量已由底部「关注」Tab 的红色角标常驻展示，不再于顶部重复占行。
 */
private fun buildOverviewStatusPills(
  state: AppState,
  offlineCount: Int,
  onlyOffline: Boolean,
  sort: DeviceSortMode,
  nowMillis: Long,
  colors: com.dsc.android.ui.oneui.OneUiColors,
  onRefresh: () -> Unit,
  onToggleOffline: () -> Unit,
  onOpenSortSheet: () -> Unit,
  onResetSort: () -> Unit,
  onOpenUpdate: () -> Unit,
  onDismissUpdate: (String) -> Unit
): List<OneUiStatusPillItem> = buildList {
  if (!state.authenticated && state.serverConfig.baseUrl.isNotBlank()) {
    add(
      OneUiStatusPillItem(
        key = "connecting",
        label = "正在连接中枢",
        tone = OneUiPillTone.Accent,
        icon = Icons.Rounded.Refresh
      )
    )
  }

  if (state.dataSource == RemoteDataSource.Cache && !state.loggingIn && !state.refreshing) {
    add(
      OneUiStatusPillItem(
        key = "offline-cache",
        label = "缓存",
        value = "${relativeTimeLabel(state.cacheSavedAt, nowMillis)} ↻",
        tone = OneUiPillTone.Warning,
        icon = Icons.Rounded.Storage,
        onClick = onRefresh
      )
    )
  }

  if (onlyOffline) {
    add(
      OneUiStatusPillItem(
        key = "offline-filter",
        label = "仅看离线",
        value = "$offlineCount",
        tone = OneUiPillTone.Offline,
        icon = Icons.Rounded.CloudOff,
        dotColor = colors.offline,
        selected = true,
        onClick = onToggleOffline,
        onDismiss = onToggleOffline,
        dismissDescription = "退出仅看离线筛选"
      )
    )
  }

  if (sort != DeviceSortMode.Custom) {
    add(
      OneUiStatusPillItem(
        key = "sort-active",
        label = sort.shortLabel,
        tone = OneUiPillTone.Accent,
        onClick = onOpenSortSheet,
        onDismiss = onResetSort,
        dismissDescription = "恢复默认顺序"
      )
    )
  }

  val update = state.updateInfo?.takeIf { it.available }
  val latestVersion = update?.latestVersion.orEmpty()
  if (update != null && (state.updateDownloading || latestVersion != state.dismissedUpdateVersion)) {
    add(
      OneUiStatusPillItem(
        key = "app-update",
        label = if (state.updateDownloading) "下载更新" else "发现更新",
        value = if (state.updateDownloading) "${(state.updateProgress * 100).toInt()}%" else "v$latestVersion",
        tone = OneUiPillTone.Accent,
        icon = Icons.Rounded.Download,
        progress = if (state.updateDownloading) state.updateProgress else null,
        onClick = onOpenUpdate,
        onDismiss = if (!state.updateDownloading && latestVersion.isNotBlank()) {
          { onDismissUpdate(latestVersion) }
        } else null,
        dismissDescription = "忽略此版本更新提示"
      )
    )
  }
}

@Composable
private fun GroupNavigationStrip(
  totalCount: Int,
  groups: List<DeviceGroupSectionModel>,
  hasNamedGroups: Boolean,
  selectedKey: String,
  onSelect: (String) -> Unit,
  onCreateGroup: () -> Unit
) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  val scrollState = rememberScrollState()
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .oneUiHorizontalFadingEdge(scrollState)
      .horizontalScroll(scrollState),
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
    verticalAlignment = Alignment.CenterVertically
  ) {
    if (hasNamedGroups) {
      OneUiStatusPill(
        pill = OneUiStatusPillItem(
          key = "grp:all",
          label = "全部",
          value = "$totalCount",
          tone = OneUiPillTone.Neutral,
          selected = selectedKey == GROUP_FILTER_ALL,
          onClick = { onSelect(GROUP_FILTER_ALL) }
        )
      )
      groups.forEach { group ->
        val isSelected = selectedKey == group.key
        val dotColor = when {
          group.criticalCount > 0 -> colors.critical
          group.warningCount > 0 -> colors.warning
          group.offline > 0 -> colors.offline
          else -> colors.online
        }
        OneUiStatusPill(
          pill = OneUiStatusPillItem(
            key = "grp:${group.key}",
            label = group.name,
            value = "${group.online}/${group.total}",
            tone = OneUiPillTone.Neutral,
            dotColor = dotColor,
            selected = isSelected,
            onClick = { onSelect(group.key) }
          )
        )
      }
      OneUiStatusPill(
        pill = OneUiStatusPillItem(
          key = "grp:create",
          label = "新建组",
          icon = Icons.Rounded.Add,
          tone = OneUiPillTone.Accent,
          onClick = onCreateGroup
        )
      )
    } else if (totalCount > 1) {
      OneUiStatusPill(
        pill = OneUiStatusPillItem(
          key = "grp:create-empty",
          label = "创建设备组",
          value = "聚合容量与对比曲线",
          icon = Icons.Rounded.Add,
          tone = OneUiPillTone.Accent,
          onClick = onCreateGroup
        )
      )
    }
  }
}

/**
 * 随列表自然滚动的轻量控制行（构 + 件）：
 * 左：紧凑三段式时间窗分段器（38dp 高、滑块弹性滑移，无横滑截断）；
 * 右：仅放当前上下文最核心的一枚 38dp 动作胶囊（单组聚焦看成员 / 全部视图收起大盘）+ 44dp 更多按钮。
 */
@Composable
private fun OverviewControlRow(
  selectedWindow: MetricWindow,
  activeGroup: DeviceGroupSectionModel?,
  showCollapseAll: Boolean,
  allCollapsed: Boolean,
  onSelectWindow: (MetricWindow) -> Unit,
  onToggleCollapseAll: () -> Unit,
  onOpenGroupMembers: (DeviceGroupSectionModel) -> Unit,
  onOpenGroupMenu: (DeviceGroupSectionModel) -> Unit,
  modifier: Modifier = Modifier
) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  val windowOptions = remember {
    listOf(
      MetricWindow.FiveMinutes to "5分",
      MetricWindow.OneHour to "1小时",
      MetricWindow.OneDay to "24小时"
    )
  }
  val selectedWindowIndex = windowOptions.indexOfFirst { it.first == selectedWindow }.coerceAtLeast(0)

  Row(
    modifier = modifier.fillMaxWidth(),
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
    verticalAlignment = Alignment.CenterVertically
  ) {
    OneUiSegmentedRow(
      options = windowOptions.map { it.second },
      selectedIndex = selectedWindowIndex,
      onSelect = { idx -> onSelectWindow(windowOptions[idx].first) },
      compact = true,
      modifier = Modifier.weight(1f)
    )

    if (activeGroup != null) {
      OneUiStatusPill(
        pill = OneUiStatusPillItem(
          key = "group-members",
          label = if (activeGroup.isUngrouped) "设组" else "成员",
          value = if (activeGroup.isUngrouped) null else "${activeGroup.total}",
          tone = OneUiPillTone.Accent,
          onClick = { onOpenGroupMembers(activeGroup) }
        )
      )
      if (!activeGroup.isUngrouped) {
        OneUiIconButton(
          contentDescription = "管理分组 ${activeGroup.name}",
          onClick = { onOpenGroupMenu(activeGroup) },
          size = 44.dp
        ) {
          OneUiIcon(
            imageVector = Icons.Rounded.MoreVert,
            contentDescription = null,
            tint = colors.textSecondary,
            size = metrics.iconFilledSize
          )
        }
      }
    } else if (showCollapseAll) {
      OneUiStatusPill(
        pill = OneUiStatusPillItem(
          key = "collapse-all",
          label = if (allCollapsed) "展开各组" else "收起大盘",
          tone = OneUiPillTone.Neutral,
          onClick = onToggleCollapseAll
        )
      )
    }
  }
}

/* ---------------- 设备组可视化看板卡与单组聚焦对比视图 ---------------- */

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DeviceGroupDashboardCard(
  section: DeviceGroupSectionModel,
  collapsed: Boolean,
  compact: Boolean,
  wideGrid: Boolean,
  selectedDeviceId: String?,
  overviewById: Map<String, OverviewInstanceSeriesDto>,
  chartWindow: ChartWindow,
  issuesByDevice: Map<String, List<AttentionItem>>,
  nowMillis: Long,
  onToggleCollapse: () -> Unit,
  onFocusGroup: () -> Unit,
  onAssignUngrouped: () -> Unit,
  onOpenGroupMenu: () -> Unit,
  onOpenDevice: (String) -> Unit,
  onOpenBlock: (String, DeviceBlockKey) -> Unit,
  onEditDeviceGroup: (DeviceSummaryDto) -> Unit,
  onMoreDevice: (DeviceSummaryDto) -> Unit,
  modifier: Modifier = Modifier
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val shapes = OneUiTheme.shapes

  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
    // 组级遥测看板头：无论收起还是展开都呈现微缩机器点阵与池化资源水位
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .oneUiSurface(colors.group, shapes.group, colors = colors, level = OneUiSurfaceLevel.Group)
        .oneUiPressable(
          onClick = onToggleCollapse,
          onLongClick = if (section.isUngrouped) onAssignUngrouped else onOpenGroupMenu,
          shape = shapes.group,
          minHeight = null
        )
        .padding(horizontal = metrics.spaceM, vertical = metrics.spaceS),
      verticalArrangement = Arrangement.spacedBy(metrics.spaceS)
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
      ) {
        Row(
          modifier = Modifier.weight(1f),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
          OneUiInlineChevron(expanded = !collapsed, tint = colors.textSecondary)
          OneUiStatusDot(
            color = when (section.tone) {
              OneUiPillTone.Critical -> colors.critical
              OneUiPillTone.Warning -> colors.warning
              OneUiPillTone.Offline -> colors.offline
              else -> colors.online
            },
            description = null
          )
          OneUiText(
            text = section.name,
            role = OneUiTextRole.Title,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false)
          )
          OneUiStatusPill(
            pill = OneUiStatusPillItem(
              key = "count:${section.key}",
              label = "${section.online}/${section.total}",
              tone = section.tone
            )
          )
        }
        OneUiMiniFleetMatrix(
          items = section.fleetDots,
          maxVisible = 6,
          summaryDescription = "${section.name} 共 ${section.total} 台设备，${section.online} 台在线"
        )
        if (section.isUngrouped) {
          OneUiStatusPill(
            pill = OneUiStatusPillItem(
              key = "assign-ungrouped",
              label = "设组",
              tone = OneUiPillTone.Accent,
              onClick = onAssignUngrouped
            )
          )
        } else {
          OneUiStatusPill(
            pill = OneUiStatusPillItem(
              key = "focus:${section.key}",
              label = "对比 ›",
              tone = OneUiPillTone.Accent,
              onClick = onFocusGroup
            )
          )
          OneUiIconButton(
            contentDescription = "管理分组 ${section.name}",
            onClick = onOpenGroupMenu,
            size = 44.dp
          ) {
            OneUiIcon(Icons.Rounded.MoreVert, contentDescription = null, tint = colors.textSecondary, size = metrics.iconFilledSize)
          }
        }
      }

      if (section.online > 0) {
        Row(
          modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min),
          horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
        ) {
          OneUiPooledMetricCell(
            label = "组 CPU",
            value = formatPercent(section.avgCpuPercent),
            caption = section.peakCpuHostname?.let { "峰 $it" },
            tone = percentPillTone(section.avgCpuPercent, 85.0, 95.0),
            barColorIndex = 0,
            sparklinePoints = section.cpuSparkline.takeIf { it.isNotEmpty() },
            chartWindow = chartWindow,
            fraction = if (section.cpuSparkline.isEmpty()) ((section.avgCpuPercent ?: 0.0) / 100.0).toFloat() else null,
            onClick = onFocusGroup,
            modifier = Modifier.weight(1f).fillMaxHeight()
          )
          OneUiPooledMetricCell(
            label = "内存池",
            value = section.memorySummaryLabel,
            sublabel = section.effectiveMemoryPercent?.let(::formatPercent),
            tone = percentPillTone(section.effectiveMemoryPercent, 88.0, 95.0),
            barColorIndex = 1,
            fraction = ((section.effectiveMemoryPercent ?: 0.0) / 100.0).toFloat(),
            onClick = onFocusGroup,
            modifier = Modifier.weight(1f).fillMaxHeight()
          )
          if (wideGrid) {
            OneUiPooledMetricCell(
              label = "存储池",
              value = section.diskSummaryLabel,
              sublabel = section.effectiveDiskPercent?.let(::formatPercent),
              tone = percentPillTone(section.effectiveDiskPercent, 85.0, 95.0),
              barColorIndex = 2,
              fraction = ((section.effectiveDiskPercent ?: 0.0) / 100.0).toFloat(),
              onClick = onFocusGroup,
              modifier = Modifier.weight(1f).fillMaxHeight()
            )
          }
        }
      } else {
        OneUiText(
          text = "本组 ${section.total} 台设备当前均离线，点按可展开查看最后上报时间",
          role = OneUiTextRole.ChartLabel,
          color = colors.textTertiary
        )
      }
    }

    // 组内设备列表平滑展开/折叠
    OneUiExpandable(expanded = !collapsed) {
      Column(verticalArrangement = Arrangement.spacedBy(metrics.cardGap)) {
        if (compact) {
          OneUiGroup {
            section.devices.forEachIndexed { index, device ->
              if (index > 0) OneUiListDivider()
              CompactDeviceRow(
                device = device,
                overview = overviewById[device.deviceId],
                issues = issuesByDevice[device.deviceId].orEmpty(),
                nowMillis = nowMillis,
                selected = device.deviceId == selectedDeviceId,
                showGroupBadge = false,
                onOpen = { onOpenDevice(device.deviceId) },
                onEditGroup = { onEditDeviceGroup(device) },
                onMore = { onMoreDevice(device) }
              )
            }
          }
        } else if (wideGrid && section.devices.size > 1) {
          BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            val spacing = metrics.cardGap
            val columns = if (maxWidth >= 660.dp) 2 else 1
            val cellWidth = (maxWidth - spacing * (columns - 1)) / columns
            FlowRow(
              modifier = Modifier.fillMaxWidth(),
              horizontalArrangement = Arrangement.spacedBy(spacing),
              verticalArrangement = Arrangement.spacedBy(spacing)
            ) {
              section.devices.forEach { device ->
                DeviceTrendCard(
                  device = device,
                  overview = overviewById[device.deviceId],
                  chartWindow = chartWindow,
                  issues = issuesByDevice[device.deviceId].orEmpty(),
                  nowMillis = nowMillis,
                  selected = device.deviceId == selectedDeviceId,
                  showGroupBadge = false,
                  onOpen = { onOpenDevice(device.deviceId) },
                  onOpenBlock = { block -> onOpenBlock(device.deviceId, block) },
                  onEditGroup = { onEditDeviceGroup(device) },
                  onMore = { onMoreDevice(device) },
                  modifier = Modifier.width(cellWidth)
                )
              }
            }
          }
        } else {
          section.devices.forEach { device ->
            DeviceTrendCard(
              device = device,
              overview = overviewById[device.deviceId],
              chartWindow = chartWindow,
              issues = issuesByDevice[device.deviceId].orEmpty(),
              nowMillis = nowMillis,
              selected = device.deviceId == selectedDeviceId,
              showGroupBadge = false,
              onOpen = { onOpenDevice(device.deviceId) },
              onOpenBlock = { block -> onOpenBlock(device.deviceId, block) },
              onEditGroup = { onEditDeviceGroup(device) },
              onMore = { onMoreDevice(device) }
            )
          }
        }
      }
    }
  }
}

@Composable
private fun GroupFocusSummaryCard(
  section: DeviceGroupSectionModel,
  chartWindow: ChartWindow,
  modifier: Modifier = Modifier
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val shapes = OneUiTheme.shapes

  Column(
    modifier = modifier
      .fillMaxWidth()
      .oneUiSurface(colors.group, shapes.group, colors = colors, level = OneUiSurfaceLevel.Group)
      .padding(metrics.spaceM),
    verticalArrangement = Arrangement.spacedBy(metrics.spaceS)
  ) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.SpaceBetween
    ) {
      OneUiText(
        text = "组级资源池化水位",
        role = OneUiTextRole.SectionHeader,
        color = colors.textPrimary
      )
      OneUiMiniFleetMatrix(
        items = section.fleetDots,
        maxVisible = 12,
        summaryDescription = "${section.name} 设备负载分布"
      )
    }

    Row(
      modifier = Modifier
        .fillMaxWidth()
        .height(IntrinsicSize.Min),
      horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
    ) {
      OneUiPooledMetricCell(
        label = "CPU 均值",
        value = formatPercent(section.avgCpuPercent),
        caption = section.peakCpuHostname?.let { "峰 $it · ${formatPercent(section.peakCpuPercent)}" },
        tone = percentPillTone(section.avgCpuPercent, 85.0, 95.0),
        barColorIndex = 0,
        sparklinePoints = section.cpuSparkline.takeIf { it.isNotEmpty() },
        chartWindow = chartWindow,
        fraction = if (section.cpuSparkline.isEmpty()) ((section.avgCpuPercent ?: 0.0) / 100.0).toFloat() else null,
        modifier = Modifier
          .weight(1f)
          .fillMaxHeight()
      )
      OneUiPooledMetricCell(
        label = "内存池",
        value = section.memorySummaryLabel,
        sublabel = section.effectiveMemoryPercent?.let(::formatPercent),
        tone = percentPillTone(section.effectiveMemoryPercent, 88.0, 95.0),
        barColorIndex = 1,
        fraction = ((section.effectiveMemoryPercent ?: 0.0) / 100.0).toFloat(),
        modifier = Modifier
          .weight(1f)
          .fillMaxHeight()
      )
    }
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .height(IntrinsicSize.Min),
      horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
    ) {
      OneUiPooledMetricCell(
        label = "存储池",
        value = section.diskSummaryLabel,
        sublabel = section.effectiveDiskPercent?.let(::formatPercent),
        tone = percentPillTone(section.effectiveDiskPercent, 85.0, 95.0),
        barColorIndex = 2,
        fraction = ((section.effectiveDiskPercent ?: 0.0) / 100.0).toFloat(),
        modifier = Modifier
          .weight(1f)
          .fillMaxHeight()
      )
      OneUiPooledMetricCell(
        label = "汇总吞吐",
        sublabel = "实时",
        value = "↓ ${formatSpeed(section.totalRxBytesPerSec)}",
        secondaryValue = "↑ ${formatSpeed(section.totalTxBytesPerSec)}",
        secondaryValueColor = colors.seriesColor(0),
        barColorIndex = 2,
        modifier = Modifier
          .weight(1f)
          .fillMaxHeight()
      )
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GroupComparisonChartCard(
  section: DeviceGroupSectionModel,
  overviewById: Map<String, OverviewInstanceSeriesDto>,
  chartWindow: ChartWindow,
  metric: GroupComparisonMetric,
  sampled: Boolean,
  onSelectMetric: (GroupComparisonMetric) -> Unit,
  onOpenDevice: (String) -> Unit,
  modifier: Modifier = Modifier
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val shapes = OneUiTheme.shapes
  val spec = remember(section.devices, overviewById, metric) {
    buildGroupComparisonChart(section.devices, overviewById, metric)
  }
  var cursorValues by remember(section.key, metric, chartWindow) { mutableStateOf<List<Double?>>(emptyList()) }
  var cursorLive by remember(section.key, metric, chartWindow) { mutableStateOf(true) }

  Column(
    modifier = modifier
      .fillMaxWidth()
      .oneUiSurface(colors.group, shapes.group, colors = colors, level = OneUiSurfaceLevel.Group)
      .padding(metrics.spaceM),
    verticalArrangement = Arrangement.spacedBy(metrics.spaceS)
  ) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.SpaceBetween
    ) {
      OneUiText(
        text = spec.metric.chartTitle,
        role = OneUiTextRole.Title,
        modifier = Modifier.weight(1f)
      )
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
      ) {
        if (sampled) {
          OneUiStatusPill(
            pill = OneUiStatusPillItem(
              key = "chart-sampled",
              label = "省流抽样",
              tone = OneUiPillTone.Neutral
            )
          )
        }
        OneUiText(
          text = "${section.online}/${section.total} 在线",
          role = OneUiTextRole.ChartLabel,
          color = colors.textTertiary,
          maxLines = 1
        )
      }
    }

    OneUiSegmentedRow(
      options = GroupComparisonMetric.entries.map { it.label },
      selectedIndex = GroupComparisonMetric.entries.indexOf(metric).coerceAtLeast(0),
      onSelect = { idx -> onSelectMetric(GroupComparisonMetric.entries[idx]) }
    )

    OneUiTrendChart(
      series = spec.series,
      chartWindow = chartWindow,
      valueFormatter = spec.valueFormatter,
      title = "${section.name} · ${spec.metric.chartTitle}",
      fixedMaxValue = spec.fixedMaxValue,
      thresholds = spec.thresholds,
      height = 152.dp,
      axisFormatter = { com.dsc.android.ui.oneui.compactAxisLabel(it, spec.valueFormatter) },
      showReadout = true,
      showReadoutSeries = false,
      animationKey = "${section.key}:${metric.name}:${chartWindow.window.value}",
      onCursorChange = { _, values, live ->
        cursorValues = values
        cursorLive = live
      },
      modifier = Modifier.fillMaxWidth()
    )

    if (spec.peers.isNotEmpty()) {
      FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
        verticalArrangement = Arrangement.spacedBy(2.dp)
      ) {
        spec.peers.forEachIndexed { index, peer ->
          val displayValue = if (!cursorLive && index < cursorValues.size) {
            spec.valueFormatter(cursorValues[index])
          } else {
            peer.latestText
          }
          OneUiStatusPill(
            pill = OneUiStatusPillItem(
              key = "peer:${peer.deviceId}",
              label = peer.hostname,
              value = displayValue,
              tone = if (peer.online) OneUiPillTone.Neutral else OneUiPillTone.Offline,
              dotColor = colors.seriesColor(peer.colorIndex),
              onClick = { onOpenDevice(peer.deviceId) }
            )
          )
        }
      }
    }

    spec.note?.let {
      OneUiText(text = it, role = OneUiTextRole.ChartLabel, color = colors.textTertiary)
    }
  }
}

/* ---------------- 设备列表渲染（标准趋势卡 vs 紧凑对比行） ---------------- */

@OptIn(ExperimentalLayoutApi::class)
private fun androidx.compose.foundation.lazy.LazyListScope.renderDeviceCollection(
  scopeKey: String,
  devices: List<DeviceSummaryDto>,
  compact: Boolean,
  wideGrid: Boolean,
  selectedDeviceId: String?,
  showGroupBadge: Boolean,
  overviewById: Map<String, OverviewInstanceSeriesDto>,
  chartWindow: ChartWindow,
  issuesByDevice: Map<String, List<AttentionItem>>,
  nowMillis: Long,
  onOpen: (String) -> Unit,
  onOpenBlock: (String, DeviceBlockKey) -> Unit,
  onEditGroup: (DeviceSummaryDto) -> Unit,
  onMore: (DeviceSummaryDto) -> Unit
) {
  if (compact) {
    item(key = "$scopeKey:compact-group") {
      val motion = OneUiTheme.motion
      OneUiGroup(
        modifier = Modifier.animateItem(
          fadeInSpec = motion.tween(OneUiDuration.Content, OneUiEasing.SineInOut90),
          placementSpec = oneUiListPlacementSpec(motion),
          fadeOutSpec = motion.tween(OneUiDuration.Exit, OneUiEasing.Exit)
        )
      ) {
        devices.forEachIndexed { index, device ->
          if (index > 0) OneUiListDivider()
          CompactDeviceRow(
            device = device,
            overview = overviewById[device.deviceId],
            issues = issuesByDevice[device.deviceId].orEmpty(),
            nowMillis = nowMillis,
            selected = device.deviceId == selectedDeviceId,
            showGroupBadge = showGroupBadge,
            onOpen = { onOpen(device.deviceId) },
            onEditGroup = { onEditGroup(device) },
            onMore = { onMore(device) }
          )
        }
      }
    }
  } else if (wideGrid && devices.size > 1) {
    item(key = "$scopeKey:grid") {
      val metrics = OneUiTheme.metrics
      val motion = OneUiTheme.motion
      BoxWithConstraints(
        modifier = Modifier
          .fillMaxWidth()
          .animateItem(
            fadeInSpec = motion.tween(OneUiDuration.Content, OneUiEasing.SineInOut90),
            placementSpec = oneUiListPlacementSpec(motion),
            fadeOutSpec = motion.tween(OneUiDuration.Exit, OneUiEasing.Exit)
          )
      ) {
        val spacing = metrics.cardGap
        val columns = if (maxWidth >= 660.dp) 2 else 1
        val cellWidth = (maxWidth - spacing * (columns - 1)) / columns
        FlowRow(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(spacing),
          verticalArrangement = Arrangement.spacedBy(spacing)
        ) {
          devices.forEach { device ->
            DeviceTrendCard(
              device = device,
              overview = overviewById[device.deviceId],
              chartWindow = chartWindow,
              issues = issuesByDevice[device.deviceId].orEmpty(),
              nowMillis = nowMillis,
              selected = device.deviceId == selectedDeviceId,
              showGroupBadge = showGroupBadge,
              onOpen = { onOpen(device.deviceId) },
              onOpenBlock = { block -> onOpenBlock(device.deviceId, block) },
              onEditGroup = { onEditGroup(device) },
              onMore = { onMore(device) },
              modifier = Modifier.width(cellWidth)
            )
          }
        }
      }
    }
  } else {
    items(devices, key = { "$scopeKey:${it.deviceId}" }) { device ->
      val motion = OneUiTheme.motion
      DeviceTrendCard(
        device = device,
        overview = overviewById[device.deviceId],
        chartWindow = chartWindow,
        issues = issuesByDevice[device.deviceId].orEmpty(),
        nowMillis = nowMillis,
        selected = device.deviceId == selectedDeviceId,
        showGroupBadge = showGroupBadge,
        onOpen = { onOpen(device.deviceId) },
        onOpenBlock = { block -> onOpenBlock(device.deviceId, block) },
        onEditGroup = { onEditGroup(device) },
        onMore = { onMore(device) },
        modifier = Modifier.animateItem(
          fadeInSpec = motion.tween(OneUiDuration.Content, OneUiEasing.SineInOut90),
          placementSpec = oneUiListPlacementSpec(motion),
          fadeOutSpec = motion.tween(OneUiDuration.Exit, OneUiEasing.Exit)
        )
      )
    }
  }
}

/**
 * 紧凑对比行（件）：
 * 单行呈现主机状态、CPU/内存/硬盘三项关键占用条与实时下行速率，适合设备较多时在一屏内快速横向比对。
 */
@Composable
private fun CompactDeviceRow(
  device: DeviceSummaryDto,
  overview: OverviewInstanceSeriesDto?,
  issues: List<AttentionItem>,
  nowMillis: Long,
  selected: Boolean,
  showGroupBadge: Boolean,
  onOpen: () -> Unit,
  onEditGroup: () -> Unit,
  onMore: () -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val online = device.status == "online"
  val worst = issues.filter { it.severity != AttentionSeverity.Offline }.minByOrNull { it.severity.rank }?.severity
  val groupName = device.normalizedGroup()
  val rxLatest = seriesStats(overview?.networkRxBytesPerSec.orEmpty())?.latest

  Row(
    modifier = Modifier
      .fillMaxWidth()
      .then(
        if (selected) Modifier.background(colors.accentSoft.copy(alpha = 0.45f)) else Modifier
      )
      .oneUiPressable(
        onClick = onOpen,
        onLongClick = onMore,
        selected = selected,
        shape = OneUiTheme.shapes.group,
        minHeight = metrics.rowMinHeight
      )
      .padding(start = metrics.rowPadding, end = metrics.spaceXs, top = 10.dp, bottom = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceS)
  ) {
    OneUiStatusDot(
      color = when {
        !online -> colors.offline
        worst == AttentionSeverity.Critical -> colors.critical
        worst == AttentionSeverity.Warning -> colors.warning
        else -> colors.online
      },
      description = if (online) "在线" else "离线"
    )

    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
      ) {
        OneUiText(
          text = device.hostname,
          role = OneUiTextRole.RowTitle,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.weight(1f, fill = false)
        )
        if (showGroupBadge && groupName != null) {
          OneUiStatusPill(
            pill = OneUiStatusPillItem(
              key = "badge:${device.deviceId}",
              label = groupName,
              tone = OneUiPillTone.Neutral,
              onClick = onEditGroup
            )
          )
        }
      }

      if (online) {
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(metrics.spaceS),
          verticalAlignment = Alignment.CenterVertically
        ) {
          CompactMetricInline(label = "CPU", percent = device.cpuUsagePercent, warn = 85.0, crit = 95.0, modifier = Modifier.weight(1f))
          CompactMetricInline(label = "内存", percent = device.memoryUsagePercent, warn = 88.0, crit = 95.0, modifier = Modifier.weight(1f))
          CompactMetricInline(label = "盘", percent = device.diskUsagePercent, warn = 85.0, crit = 95.0, modifier = Modifier.weight(1f))
        }
      } else {
        OneUiText(
          text = "离线 · 最后上报于 ${relativeTimeLabel(device.lastSeenAt, nowMillis)}",
          role = OneUiTextRole.ChartLabel,
          color = colors.textTertiary,
          maxLines = 1
        )
      }
    }

    if (online && rxLatest != null) {
      OneUiText(
        text = "↓${formatSpeed(rxLatest)}",
        role = OneUiTextRole.ChartLabel,
        color = colors.textSecondary,
        maxLines = 1
      )
    }

    OneUiIconButton(
      contentDescription = "${device.hostname} 的更多操作",
      onClick = onMore,
      size = 44.dp
    ) {
      OneUiIcon(Icons.Rounded.MoreVert, contentDescription = null, tint = colors.textSecondary, size = metrics.iconFilledSize)
    }
  }
}

@Composable
private fun CompactMetricInline(
  label: String,
  percent: Double?,
  warn: Double,
  crit: Double,
  modifier: Modifier = Modifier
) {
  val colors = OneUiTheme.colors
  val tone = percentTone(percent, warn, crit)
  val barColor = when (tone) {
    AttentionSeverity.Critical -> colors.critical
    AttentionSeverity.Warning -> colors.warning
    else -> colors.accent
  }
  val textColor = when (tone) {
    AttentionSeverity.Critical -> colors.criticalContent
    AttentionSeverity.Warning -> colors.warningContent
    else -> colors.textSecondary
  }
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      OneUiText(text = label, role = OneUiTextRole.ChartLabel, color = colors.textTertiary, maxLines = 1)
      OneUiText(text = formatPercent(percent), role = OneUiTextRole.ChartLabel, color = textColor, weight = FontWeight.SemiBold, maxLines = 1)
    }
    OneUiLinearProgress(
      fraction = ((percent ?: 0.0) / 100.0).toFloat().coerceIn(0f, 1f),
      color = barColor,
      height = 4.dp
    )
  }
}

/**
 * 标准设备趋势卡：点按分组胶囊可直接快速改组，无需绕进更多菜单。
 */
@Composable
private fun DeviceTrendCard(
  device: DeviceSummaryDto,
  overview: OverviewInstanceSeriesDto?,
  chartWindow: ChartWindow,
  issues: List<AttentionItem>,
  nowMillis: Long,
  selected: Boolean = false,
  showGroupBadge: Boolean = true,
  onOpen: () -> Unit,
  onOpenBlock: (DeviceBlockKey) -> Unit,
  onEditGroup: () -> Unit,
  onMore: () -> Unit,
  modifier: Modifier = Modifier
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val shapes = OneUiTheme.shapes
  val online = device.status == "online"
  val issueSeverity = issues.minByOrNull { it.severity.rank }?.severity
  val groupName = device.normalizedGroup()

  Column(
    modifier = modifier
      .fillMaxWidth()
      .oneUiSurface(colors.group, shapes.card, colors = colors, level = OneUiSurfaceLevel.Group)
      .then(
        if (selected) {
          Modifier.border(width = 2.dp, color = colors.accent, shape = shapes.card)
        } else {
          Modifier
        }
      )
      .oneUiPressable(onClick = onOpen, onLongClick = onMore, selected = selected, shape = shapes.card, minHeight = null)
      .padding(metrics.spaceM),
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
      if (showGroupBadge && groupName != null) {
        OneUiStatusPill(
          pill = OneUiStatusPillItem(
            key = "card-group:${device.deviceId}",
            label = groupName,
            tone = OneUiPillTone.Neutral,
            onClick = onEditGroup
          )
        )
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
          .height(IntrinsicSize.Min),
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
          modifier = Modifier.weight(1f).fillMaxHeight()
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
          modifier = Modifier.weight(1f).fillMaxHeight()
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
          modifier = Modifier.weight(1f).fillMaxHeight()
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
    Spacer(Modifier.weight(1f))
    Box(modifier = Modifier.fillMaxWidth().padding(top = 2.dp)) {
      val sharedMax = fixedMax ?: (points + secondaryPoints).maxOfOrNull { it.value }?.let { it * 1.1 }
      if (secondaryPoints.isNotEmpty()) {
        OneUiSparkline(points = secondaryPoints, chartWindow = chartWindow, color = secondaryColor, fixedMaxValue = sharedMax, modifier = Modifier.fillMaxWidth())
      }
      OneUiSparkline(points = points, chartWindow = chartWindow, color = color, fixedMaxValue = sharedMax, modifier = Modifier.fillMaxWidth())
    }
  }
}

@Composable
private fun CapacityLine(device: DeviceSummaryDto, onClick: () -> Unit, onGpu: () -> Unit) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val disk = device.diskUsagePercent
  val diskTone = percentTone(disk, 85.0, 95.0)
  Row(
    modifier = Modifier.fillMaxWidth(),
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

/* ---------------- 结构化分组与顺序编辑模式 ---------------- */

@Composable
private fun ManageToolbarRow(
  totalCount: Int,
  selectedCount: Int,
  onCreateGroup: () -> Unit,
  onToggleSelectAll: () -> Unit,
  onClearGroupForSelected: (() -> Unit)?
) {
  val metrics = OneUiTheme.metrics
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
    verticalAlignment = Alignment.CenterVertically
  ) {
    OneUiPill(
      label = "+ 新建设备组",
      tone = OneUiPillTone.Accent,
      onClick = onCreateGroup
    )
    OneUiPill(
      label = if (selectedCount == totalCount && totalCount > 0) "取消全选" else "全选 ($selectedCount/$totalCount)",
      tone = OneUiPillTone.Neutral,
      onClick = onToggleSelectAll
    )
    if (onClearGroupForSelected != null) {
      OneUiPill(
        label = "所选设为未分组",
        tone = OneUiPillTone.Warning,
        onClick = onClearGroupForSelected
      )
    }
  }
}

@Composable
private fun StructuredEditableGroupCard(
  section: DeviceGroupSectionModel,
  canMoveGroupUp: Boolean,
  canMoveGroupDown: Boolean,
  selectedIds: Set<String>,
  onToggleSelect: (String) -> Unit,
  onMoveGroup: (Int) -> Unit,
  onManageMembers: () -> Unit,
  onRenameGroup: (() -> Unit)?,
  onDissolveGroup: (() -> Unit)?,
  onEditDeviceGroup: (DeviceSummaryDto) -> Unit,
  onMoveDevice: (DeviceSummaryDto, Int) -> Unit,
  onRequestDelete: (DeviceSummaryDto) -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
      OneUiText(
        text = "${section.name} (${section.total})",
        role = OneUiTextRole.SectionHeader,
        color = colors.textPrimary,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.weight(1f)
      )
      OneUiStatusPill(
        pill = OneUiStatusPillItem(
          key = "m-members:${section.key}",
          label = if (section.isUngrouped) "分配" else "成员",
          tone = OneUiPillTone.Accent,
          onClick = onManageMembers
        )
      )
      if (onRenameGroup != null) {
        OneUiStatusPill(
          pill = OneUiStatusPillItem(
            key = "m-rename:${section.key}",
            label = "改名",
            tone = OneUiPillTone.Neutral,
            onClick = onRenameGroup
          )
        )
      }
      if (onDissolveGroup != null) {
        OneUiStatusPill(
          pill = OneUiStatusPillItem(
            key = "m-dissolve:${section.key}",
            label = "解散",
            tone = OneUiPillTone.Critical,
            onClick = onDissolveGroup
          )
        )
      }
      if (!section.isUngrouped) {
        OneUiIconButton(
          contentDescription = "整组上移 ${section.name}",
          onClick = { onMoveGroup(-1) },
          enabled = canMoveGroupUp,
          size = 44.dp,
          haptics = OneUiHaptics.Toggle
        ) {
          OneUiIcon(
            Icons.Rounded.ArrowUpward,
            contentDescription = null,
            tint = if (canMoveGroupUp) colors.accent else colors.textDisabled,
            size = metrics.iconFilledSize
          )
        }
        OneUiIconButton(
          contentDescription = "整组下移 ${section.name}",
          onClick = { onMoveGroup(1) },
          enabled = canMoveGroupDown,
          size = 44.dp,
          haptics = OneUiHaptics.Toggle
        ) {
          OneUiIcon(
            Icons.Rounded.ArrowDownward,
            contentDescription = null,
            tint = if (canMoveGroupDown) colors.accent else colors.textDisabled,
            size = metrics.iconFilledSize
          )
        }
      }
    }

    OneUiGroup {
      section.devices.forEachIndexed { index, device ->
        if (index > 0) OneUiListDivider()
        EditableDeviceRowContent(
          device = device,
          checked = device.deviceId in selectedIds,
          insideNamedGroup = true,
          canMoveUp = index > 0,
          canMoveDown = index < section.devices.lastIndex,
          onToggleCheck = { onToggleSelect(device.deviceId) },
          onEditGroup = { onEditDeviceGroup(device) },
          onMove = { delta -> onMoveDevice(device, delta) },
          onRequestDelete = { onRequestDelete(device) }
        )
      }
    }
  }
}

@Composable
private fun EditableDeviceRow(
  device: DeviceSummaryDto,
  checked: Boolean,
  canMoveUp: Boolean,
  canMoveDown: Boolean,
  onToggleCheck: () -> Unit,
  onEditGroup: () -> Unit,
  onMove: (Int) -> Unit,
  onRequestDelete: () -> Unit
) {
  OneUiGroup {
    EditableDeviceRowContent(
      device = device,
      checked = checked,
      insideNamedGroup = false,
      canMoveUp = canMoveUp,
      canMoveDown = canMoveDown,
      onToggleCheck = onToggleCheck,
      onEditGroup = onEditGroup,
      onMove = onMove,
      onRequestDelete = onRequestDelete
    )
  }
}

@Composable
private fun EditableDeviceRowContent(
  device: DeviceSummaryDto,
  checked: Boolean,
  insideNamedGroup: Boolean,
  canMoveUp: Boolean,
  canMoveDown: Boolean,
  onToggleCheck: () -> Unit,
  onEditGroup: () -> Unit,
  onMove: (Int) -> Unit,
  onRequestDelete: () -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val groupName = device.normalizedGroup()
  OneUiListItem(
    title = device.hostname,
    subtitle = "${osLabel(device.os)} · ${if (device.status == "online") "在线" else "离线"}",
    onClick = onToggleCheck,
    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 10.dp),
    leading = {
      OneUiCheckbox(
        checked = checked,
        onCheckedChange = { onToggleCheck() },
        label = "选择 ${device.hostname}"
      )
    },
    trailing = {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        OneUiStatusPill(
          pill = OneUiStatusPillItem(
            key = "edit-grp:${device.deviceId}",
            label = when {
              insideNamedGroup && groupName != null -> "换组"
              groupName != null -> groupName
              else -> "设组"
            },
            tone = if (groupName != null && !insideNamedGroup) OneUiPillTone.Accent else OneUiPillTone.Neutral,
            onClick = onEditGroup
          )
        )
        OneUiIconButton(
          contentDescription = "上移 ${device.hostname}",
          onClick = { onMove(-1) },
          enabled = canMoveUp,
          size = 44.dp,
          haptics = OneUiHaptics.Toggle
        ) {
          OneUiIcon(
            Icons.Rounded.ArrowUpward,
            contentDescription = null,
            tint = if (canMoveUp) colors.textSecondary else colors.textDisabled,
            size = metrics.iconFilledSize
          )
        }
        OneUiIconButton(
          contentDescription = "下移 ${device.hostname}",
          onClick = { onMove(1) },
          enabled = canMoveDown,
          size = 44.dp,
          haptics = OneUiHaptics.Toggle
        ) {
          OneUiIcon(
            Icons.Rounded.ArrowDownward,
            contentDescription = null,
            tint = if (canMoveDown) colors.textSecondary else colors.textDisabled,
            size = metrics.iconFilledSize
          )
        }
        Spacer(Modifier.width(4.dp))
        OneUiIconButton(
          contentDescription = "从列表隐藏 ${device.hostname}",
          onClick = onRequestDelete,
          size = 44.dp
        ) {
          OneUiIcon(Icons.Rounded.Delete, contentDescription = null, tint = colors.criticalContent, size = metrics.iconFilledSize)
        }
      }
    }
  )
}

@Composable
private fun EditDock(
  dirty: Boolean,
  selectedCount: Int,
  onCancel: () -> Unit,
  onBatchAssignGroup: () -> Unit,
  onSave: () -> Unit
) {
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
    OneUiButton(
      label = "取消",
      onClick = onCancel,
      variant = OneUiButtonVariant.Text,
      size = OneUiButtonSize.Compact,
      modifier = Modifier.weight(0.8f)
    )
    if (selectedCount > 0) {
      OneUiButton(
        label = "批量设组 ($selectedCount)",
        onClick = onBatchAssignGroup,
        variant = OneUiButtonVariant.Tonal,
        size = OneUiButtonSize.Compact,
        modifier = Modifier.weight(1.1f)
      )
    }
    OneUiButton(
      label = if (dirty) "保存顺序" else "完成",
      onClick = onSave,
      size = OneUiButtonSize.Compact,
      modifier = Modifier.weight(1f)
    )
  }
}

/* ---------------- 视图密度、排序与轻量更新面板 ---------------- */

@Composable
private fun ViewAndSortSheet(
  sort: DeviceSortMode,
  compact: Boolean,
  groupScopedSort: Boolean,
  hasNamedGroups: Boolean,
  offlineCount: Int,
  onlyOffline: Boolean,
  onSelectSort: (DeviceSortMode) -> Unit,
  onSelectCompact: (Boolean) -> Unit,
  onSelectGroupScopedSort: (Boolean) -> Unit,
  onSelectOnlyOffline: (Boolean) -> Unit,
  onDismiss: () -> Unit
) {
  val metrics = OneUiTheme.metrics
  OneUiSheet(
    onDismissRequest = onDismiss,
    title = "视图、筛选与排序",
    subtitle = "切换设备展示密度、筛选范围、排列顺序与分组保持方式"
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
      OneUiGroupHeader(label = "展示密度")
      OneUiSegmentedRow(
        options = listOf("标准趋势卡", "紧凑对比行"),
        selectedIndex = if (compact) 1 else 0,
        onSelect = { idx -> onSelectCompact(idx == 1) }
      )
    }

    if (offlineCount > 0 || onlyOffline) {
      OneUiGroup {
        OneUiListItem(
          title = "仅看离线设备（$offlineCount 台）",
          subtitle = if (onlyOffline) "当前仅展示离线设备，可在顶部一键清除" else "快速聚焦掉线机器并核对最后上报时间",
          onClick = { onSelectOnlyOffline(!onlyOffline) },
          trailing = {
            OneUiSwitch(
              checked = onlyOffline,
              onCheckedChange = onSelectOnlyOffline,
              label = "仅看离线设备"
            )
          }
        )
      }
    }

    Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
      OneUiGroupHeader(label = "排列方式")
      OneUiGroup {
        DeviceSortMode.entries.forEachIndexed { index, mode ->
          if (index > 0) OneUiListDivider()
          val selected = mode == sort
          OneUiListItem(
            title = if (selected) "${mode.label}（当前）" else mode.label,
            subtitle = mode.description,
            selected = selected,
            onClick = { onSelectSort(mode) }
          )
        }
      }
    }

    if (hasNamedGroups && sort != DeviceSortMode.Custom) {
      OneUiGroup {
        OneUiListItem(
          title = "保持设备组结构（组内排序）",
          subtitle = if (groupScopedSort) "已开启：各分组独立保留看板，组内按所选指标排序" else "已关闭：临时打平所有分组，跨组全局排行",
          onClick = { onSelectGroupScopedSort(!groupScopedSort) },
          trailing = {
            OneUiSwitch(
              checked = groupScopedSort,
              onCheckedChange = onSelectGroupScopedSort,
              label = "保持设备组结构"
            )
          }
        )
      }
    }
  }
}

@Composable
private fun UpdateQuickSheet(
  update: UpdateInfoDto,
  downloading: Boolean,
  progress: Float,
  onDownload: () -> Unit,
  onOpenSettings: () -> Unit,
  onDismissVersion: () -> Unit,
  onDismiss: () -> Unit
) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  val canDirectDownload = !update.assetUrl.isNullOrBlank() && !update.sha256.isNullOrBlank() && (update.assetSize ?: 0L) > 0L

  OneUiSheet(
    onDismissRequest = onDismiss,
    title = "发现新版本 v${update.latestVersion.orEmpty()}",
    subtitle = buildString {
      append("当前版本 v${update.currentVersion}")
      update.assetSize?.takeIf { it > 0 }?.let { append(" · 安装包 ${formatBytes(it.toDouble())}") }
    }
  ) {
    if (downloading) {
      Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
        OneUiLinearProgress(fraction = progress)
        OneUiText(
          text = "正在下载更新包 ${(progress * 100).toInt()}%，校验通过后将拉起系统安装器",
          role = OneUiTextRole.RowSubtitle,
          color = colors.textSecondary
        )
      }
    } else {
      OneUiText(
        text = "可在「设置 › 版本与更新」随时查看更新详情；若暂不升级，可隐藏本版本的顶部药丸提示。",
        role = OneUiTextRole.RowSubtitle,
        color = colors.textSecondary
      )
    }

    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(metrics.spaceS)
    ) {
      OneUiButton(
        label = "暂不提醒此版",
        onClick = onDismissVersion,
        variant = OneUiButtonVariant.Text,
        size = OneUiButtonSize.Compact,
        modifier = Modifier.weight(1f)
      )
      OneUiButton(
        label = when {
          downloading -> "查看进度"
          canDirectDownload -> "下载并安装"
          else -> "前往设置"
        },
        onClick = if (!downloading && canDirectDownload) onDownload else onOpenSettings,
        size = OneUiButtonSize.Compact,
        modifier = Modifier.weight(1.2f)
      )
    }
  }
}

private fun percentTone(value: Double?, warning: Double, critical: Double): AttentionSeverity? = when {
  value == null || !value.isFinite() -> null
  value >= critical -> AttentionSeverity.Critical
  value >= warning -> AttentionSeverity.Warning
  else -> null
}

private fun percentPillTone(value: Double?, warning: Double, critical: Double): OneUiPillTone = when {
  value == null || !value.isFinite() -> OneUiPillTone.Neutral
  value >= critical -> OneUiPillTone.Critical
  value >= warning -> OneUiPillTone.Warning
  else -> OneUiPillTone.Neutral
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
