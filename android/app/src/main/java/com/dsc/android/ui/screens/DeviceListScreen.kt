package com.dsc.android.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.Timeline
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsc.android.AppState
import com.dsc.android.DeviceBlockKey
import com.dsc.android.DeviceSummaryDto
import com.dsc.android.RemoteDataSource
import com.dsc.android.ui.oneui.OneUiActionModel
import com.dsc.android.ui.oneui.OneUiActionSheet
import com.dsc.android.ui.oneui.OneUiButton
import com.dsc.android.ui.oneui.OneUiButtonSize
import com.dsc.android.ui.oneui.OneUiButtonVariant
import com.dsc.android.ui.oneui.OneUiDialog
import com.dsc.android.ui.oneui.OneUiEmptyState
import com.dsc.android.ui.oneui.OneUiGroup
import com.dsc.android.ui.oneui.OneUiGroupHeader
import com.dsc.android.ui.oneui.OneUiHaptics
import com.dsc.android.ui.oneui.OneUiIcon
import com.dsc.android.ui.oneui.OneUiIconButton
import com.dsc.android.ui.oneui.OneUiIconTone
import com.dsc.android.ui.oneui.OneUiLeadingIcon
import com.dsc.android.ui.oneui.OneUiLinearProgress
import com.dsc.android.ui.oneui.OneUiListDivider
import com.dsc.android.ui.oneui.OneUiListItem
import com.dsc.android.ui.oneui.OneUiNotice
import com.dsc.android.ui.oneui.OneUiNoticeTone
import com.dsc.android.ui.oneui.OneUiPillModel
import com.dsc.android.ui.oneui.OneUiPillRow
import com.dsc.android.ui.oneui.OneUiPillTone
import com.dsc.android.ui.oneui.OneUiSkeleton
import com.dsc.android.ui.oneui.OneUiStatusDot
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme
import com.dsc.android.ui.oneui.OneUiTopBar
import com.dsc.android.ui.oneui.OneUiSurfaceLevel
import com.dsc.android.ui.oneui.formatPercent
import com.dsc.android.ui.oneui.oneUiListContentPadding
import com.dsc.android.ui.oneui.oneUiSurface
import com.dsc.android.ui.oneui.oneUiListEnter
import com.dsc.android.ui.oneui.rememberOneUiCollapse
import com.dsc.android.ui.shell.GuanlanActions

/**
 * 设备列表（构）。
 *
 * 结构上按 One UI 的“列表 + 分组 + 底部上下文操作”组织：
 * 大标题留在上方，设备按分组行呈现，长按进入操作面板，排序/删除进入编辑态并
 * 把确认动作下沉到底部上下文条（拇指区），而不是塞进顶栏文字按钮。
 */
@Composable
fun DeviceListScreen(
  state: AppState,
  actions: GuanlanActions,
  embedded: Boolean
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  val listState = rememberLazyListState()
  val collapse = rememberOneUiCollapse(listState)

  val persisted = state.devices.sortedWith(
    compareBy<DeviceSummaryDto> { it.sortOrder ?: Int.MAX_VALUE }.thenBy { it.hostname }
  )
  val persistedIds = persisted.map { it.deviceId }

  var editMode by remember(persistedIds) { mutableStateOf(false) }
  var draftIds by remember(persistedIds) { mutableStateOf<List<String>?>(null) }
  var pendingDelete by remember { mutableStateOf<DeviceSummaryDto?>(null) }
  var actionTarget by remember { mutableStateOf<DeviceSummaryDto?>(null) }

  // draftIds 是委托属性，不能智能转换：先取本地快照再判空
  val draft = draftIds
  val visible = if (editMode && draft != null) {
    val byId = persisted.associateBy { it.deviceId }
    val draftSet = draft.toSet()
    draft.mapNotNull { byId[it] } + persisted.filterNot { it.deviceId in draftSet }
  } else {
    persisted
  }

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.canvas)
  ) {
    Column(modifier = Modifier.fillMaxSize()) {
      // 双栏的列表栏也用同一条顶栏，只是降级成紧凑高度：
      // 刷新与编辑是这一栏的主动作，嵌入态把它们整个删掉就没有入口了（构）
      OneUiTopBar(
        title = if (editMode) "编辑设备列表" else "观澜",
        subtitle = if (editMode) {
          "调整顺序或删除设备"
        } else {
          connectionSummary(state, persisted)
        },
        collapse = collapse,
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
          .fillMaxWidth(),
        contentPadding = if (embedded) {
          PaddingValues(start = metrics.spaceS, end = metrics.spaceS, top = metrics.spaceXs, bottom = metrics.spaceXxl)
        } else {
          oneUiListContentPadding()
        },
        verticalArrangement = Arrangement.spacedBy(metrics.cardGap)
      ) {
        if (!state.authenticated && state.serverConfig.baseUrl.isNotBlank()) {
          item(key = "connecting") {
            OneUiNotice(
              title = "正在使用已保存配置连接中枢",
              description = state.serverConfig.baseUrl,
              tone = OneUiNoticeTone.Info
            )
          }
        }

        if (state.dataSource == RemoteDataSource.Cache) {
          item(key = "offline-cache") {
            OneUiNotice(
              title = "当前显示离线缓存",
              description = "缓存于 ${com.dsc.android.ui.oneui.formatTime(state.cacheSavedAt)}；数据可能已经过期。",
              tone = OneUiNoticeTone.Warning,
              icon = Icons.Rounded.Storage,
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

        state.updateInfo?.let { update ->
          if (update.available) {
            item(key = "update-available") {
              Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
                OneUiNotice(
                  title = "发现 Android 更新 v${update.latestVersion ?: ""}",
                  description = "更新与安装入口在“设置 › 版本与更新”。",
                  tone = OneUiNoticeTone.Info,
                  icon = Icons.Rounded.Computer,
                  action = {
                    OneUiButton(
                      label = "前往",
                      onClick = actions.onShowSettings,
                      variant = OneUiButtonVariant.Text,
                      size = OneUiButtonSize.Compact
                    )
                  }
                )
                if (state.updateDownloading) {
                  OneUiLinearProgress(fraction = state.updateProgress)
                }
              }
            }
          }
        }

        item(key = "devices-header") {
          OneUiGroupHeader(
            label = "设备",
            description = if (editMode) null else "点击设备查看指标，长按打开操作面板",
          )
        }

        if (state.loading && persisted.isEmpty()) {
          items(3) { index ->
            OneUiSkeleton(height = 104.dp, modifier = Modifier.padding(horizontal = metrics.spaceXs))
          }
        }

        if (!state.loading && visible.isEmpty()) {
          item(key = "empty") {
            OneUiEmptyState(
              title = "暂未发现设备",
              description = "确认中枢已收到该设备的上报，或点按刷新重试。",
              icon = Icons.Rounded.Router,
              actionLabel = "刷新",
              onAction = actions.onRefresh
            )
          }
        }

        visible.forEachIndexed { index, device ->
          item(key = device.deviceId) {
            AnimatedVisibility(visible = true, enter = oneUiListEnter(motion, index)) {
              DeviceRow(
                device = device,
                editMode = editMode,
                canMoveUp = index > 0,
                canMoveDown = index < visible.lastIndex,
                onOpen = { actions.onOpenDevice(device.deviceId, null) },
                onOpenBlock = { block -> actions.onOpenDevice(device.deviceId, block) },
                onOpenTraffic = { actions.onOpenTraffic(device.deviceId) },
                onEditMetrics = { actions.onOpenDeviceEditor(device.deviceId) },
                onLongPress = { actionTarget = device },
                onMove = { delta ->
                  val ids = visible.map { it.deviceId }.toMutableList()
                  val target = index + delta
                  if (target in ids.indices) {
                    val moved = ids.removeAt(index)
                    ids.add(target, moved)
                    draftIds = ids
                  }
                },
                onRequestDelete = { pendingDelete = device }
              )
            }
          }
        }

        item(key = "bottom-spacer") {
          Spacer(Modifier.height(metrics.thumbZone))
        }
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

  actionTarget?.let { device ->
    OneUiActionSheet(
      onDismissRequest = { actionTarget = null },
      title = device.hostname,
      actions = listOf(
        OneUiActionModel(
          label = "打开设备",
          description = "查看 CPU、显卡、内存、硬盘、网络、温度与风扇",
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
      title = "删除设备实例？",
      description = "删除后它会从当前列表隐藏；设备下次上报时会重新显示。",
      confirmLabel = "删除",
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

@Composable
private fun DeviceRow(
  device: DeviceSummaryDto,
  editMode: Boolean,
  canMoveUp: Boolean,
  canMoveDown: Boolean,
  onOpen: () -> Unit,
  onOpenBlock: (DeviceBlockKey) -> Unit,
  onOpenTraffic: () -> Unit,
  onEditMetrics: () -> Unit,
  onLongPress: () -> Unit,
  onMove: (Int) -> Unit,
  onRequestDelete: () -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val online = device.status == "online"
  val pills = buildList {
    add(OneUiPillModel("CPU", formatPercent(device.cpuUsagePercent)))
    if (device.gpuUsagePercent != null) add(OneUiPillModel("GPU", formatPercent(device.gpuUsagePercent)))
    if (device.gpuMemoryUsagePercent != null) {
      add(OneUiPillModel("GPU 内存", formatPercent(device.gpuMemoryUsagePercent)))
    }
    add(OneUiPillModel("内存", formatPercent(device.memoryUsagePercent)))
    add(OneUiPillModel("硬盘", formatPercent(device.diskUsagePercent)))
  }

  OneUiGroup {
    OneUiListItem(
      title = device.hostname,
      subtitle = deviceSubtitle(device, online),
      onClick = if (editMode) null else onOpen,
      onLongClick = if (editMode) null else onLongPress,
      enabled = !editMode,
      leading = {
        OneUiLeadingIcon(
          icon = deviceIcon(device.os),
          contentDescription = null,
          tone = if (online) OneUiIconTone.Accent else OneUiIconTone.Offline
        )
      },
      trailing = {
        if (editMode) {
          Row(horizontalArrangement = Arrangement.spacedBy(metrics.spaceXxs)) {
            OneUiIconButton(
              contentDescription = "上移",
              onClick = { onMove(-1) },
              enabled = canMoveUp,
              size = metrics.iconButton,
              haptics = OneUiHaptics.Toggle
            ) { OneUiIcon(Icons.Rounded.ArrowUpward, contentDescription = null, tint = colors.textSecondary, size = metrics.iconFilledSize) }
            OneUiIconButton(
              contentDescription = "下移",
              onClick = { onMove(1) },
              enabled = canMoveDown,
              size = metrics.iconButton,
              haptics = OneUiHaptics.Toggle
            ) { OneUiIcon(Icons.Rounded.ArrowDownward, contentDescription = null, tint = colors.textSecondary, size = metrics.iconFilledSize) }
            OneUiIconButton(
              contentDescription = "删除设备",
              onClick = onRequestDelete,
              size = 44.dp
            ) { OneUiIcon(Icons.Rounded.Delete, contentDescription = null, tint = colors.criticalContent, size = metrics.iconFilledSize) }
          }
        } else {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OneUiStatusDot(
              color = if (online) colors.online else colors.offline,
              description = if (online) "在线" else "离线"
            )
            OneUiText(
              text = if (online) "在线" else "离线",
              role = OneUiTextRole.ChartLabel,
              color = if (online) colors.onlineContent else colors.offlineContent,
              weight = FontWeight.SemiBold
            )
          }
        }
      },
      supporting = {
        if (!editMode) {
          Column(
            modifier = Modifier.padding(top = metrics.spaceXs),
            verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)
          ) {
            OneUiPillRow(pills = pills)
            Row(horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
              OneUiButton(
                label = "流量",
                onClick = onOpenTraffic,
                variant = OneUiButtonVariant.Tonal,
                size = OneUiButtonSize.Compact
              )
              OneUiButton(
                label = "记录项",
                onClick = onEditMetrics,
                variant = OneUiButtonVariant.Outlined,
                size = OneUiButtonSize.Compact
              )
              OneUiButton(
                label = "全部指标",
                onClick = onOpen,
                variant = OneUiButtonVariant.Text,
                size = OneUiButtonSize.Compact
              )
            }
          }
        }
      }
    )
    if (!editMode) {
      OneUiListDivider()
      // 常用指标直接指向对应类别，符合 One UI“就近进入下一步”的组织方式（构）
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(horizontal = metrics.rowPadding, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
      ) {
        DeviceBlockKey.entries.take(3).forEach { block ->
          OneUiButton(
            label = block.label,
            onClick = { onOpenBlock(block) },
            variant = OneUiButtonVariant.Text,
            size = OneUiButtonSize.Compact
          )
        }
      }
    }
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
      .oneUiSurface(
        colors.raised,
        OneUiTheme.shapes.dock,
        colors = colors,
        level = OneUiSurfaceLevel.Raised
      )
      .navigationBarsPadding()
      .padding(horizontal = metrics.screenMargin, vertical = metrics.spaceM),
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceS),
    verticalAlignment = Alignment.CenterVertically
  ) {
    OneUiButton(
      label = "取消",
      onClick = onCancel,
      variant = OneUiButtonVariant.Text,
      modifier = Modifier.weight(1f)
    )
    OneUiButton(
      label = if (dirty) "保存顺序" else "完成",
      onClick = onSave,
      modifier = Modifier.weight(1f)
    )
  }
}

@Composable
private fun connectionSummary(state: AppState, devices: List<DeviceSummaryDto>): String {
  val online = devices.count { it.status == "online" }
  return when {
    !state.authenticated && state.serverConfig.baseUrl.isNotBlank() -> "正在连接中枢"
    state.loading && devices.isEmpty() -> "正在读取设备清单"
    else -> "${devices.size} 台设备 · $online 台在线"
  }
}

private fun deviceSubtitle(device: DeviceSummaryDto, online: Boolean): String = buildString {
  append(device.os.replaceFirstChar { it.uppercase() })
  append(" · ")
  append(device.deviceId)
  device.agentVersion?.takeIf { it.isNotBlank() }?.let {
    append(" · agent ")
    append(it)
  }
  device.lastSeenAt?.takeIf { it.isNotBlank() }?.let { seen ->
    append(" · 上报 ")
    append(com.dsc.android.ui.oneui.formatTime(seen))
  }
}

private fun deviceIcon(os: String) = when {
  os.contains("win", ignoreCase = true) -> Icons.Rounded.Computer
  os.contains("nas", ignoreCase = true) || os.contains("docker", ignoreCase = true) -> Icons.Rounded.Storage
  os.contains("linux", ignoreCase = true) -> Icons.Rounded.Dns
  else -> Icons.Rounded.Router
}

