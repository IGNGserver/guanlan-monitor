package com.dsc.android.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsc.android.DeviceSummaryDto
import com.dsc.android.ui.oneui.OneUiButton
import com.dsc.android.ui.oneui.OneUiButtonVariant
import com.dsc.android.ui.oneui.OneUiCheckbox
import com.dsc.android.ui.oneui.OneUiCompactSearchBar
import com.dsc.android.ui.oneui.OneUiFilterChip
import com.dsc.android.ui.oneui.OneUiGroup
import com.dsc.android.ui.oneui.OneUiGroupHeader
import com.dsc.android.ui.oneui.OneUiIcon
import com.dsc.android.ui.oneui.OneUiIconTone
import com.dsc.android.ui.oneui.OneUiLeadingIcon
import com.dsc.android.ui.oneui.OneUiListDivider
import com.dsc.android.ui.oneui.OneUiListItem
import com.dsc.android.ui.oneui.OneUiPill
import com.dsc.android.ui.oneui.OneUiPillTone
import com.dsc.android.ui.oneui.OneUiSheet
import com.dsc.android.ui.oneui.OneUiStatusDot
import com.dsc.android.ui.oneui.OneUiStatusPill
import com.dsc.android.ui.oneui.OneUiStatusPillItem
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextField
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme
import com.dsc.android.ui.oneui.formatPercent
import com.dsc.android.ui.oneui.oneUiHorizontalFadingEdge

private const val SHEET_SEARCH_THRESHOLD = 5

/**
 * 同组设备直达切换条：在设备详情页与流量日历页共用，无需退回总览即可一键平切同组机器。
 */
@Composable
internal fun InGroupPeerSwitcherRow(
  groupLabel: String,
  peers: List<DeviceSummaryDto>,
  currentDeviceId: String?,
  onOpenSwitcher: () -> Unit,
  onSelectDevice: (String) -> Unit,
  showCpuInChip: Boolean = true
) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  val currentIndex = peers.indexOfFirst { it.deviceId == currentDeviceId }
  val scrollState = rememberScrollState()
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .oneUiHorizontalFadingEdge(scrollState)
      .horizontalScroll(scrollState),
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
    verticalAlignment = Alignment.CenterVertically
  ) {
    OneUiStatusPill(
      pill = OneUiStatusPillItem(
        key = "peer-group-switcher",
        label = groupLabel,
        value = if (currentIndex >= 0) "${currentIndex + 1}/${peers.size}" else "${peers.size}台",
        tone = OneUiPillTone.Accent,
        onClick = onOpenSwitcher
      )
    )
    peers.forEach { peer ->
      val isCurrent = peer.deviceId == currentDeviceId
      val online = peer.status == "online"
      OneUiFilterChip(
        label = peer.hostname,
        value = if (showCpuInChip && online && peer.cpuUsagePercent != null) formatPercent(peer.cpuUsagePercent) else null,
        selected = isCurrent,
        onClick = { onSelectDevice(peer.deviceId) },
        leadingIcon = {
          OneUiStatusDot(
            color = if (isCurrent) colors.textOnAccent else if (online) colors.online else colors.offline,
            description = if (online) "在线" else "离线"
          )
        }
      )
    }
  }
}

@Composable
internal fun GroupedDeviceSwitcherSheet(
  devices: List<DeviceSummaryDto>,
  currentDeviceId: String?,
  currentGroup: String?,
  hasNamedGroups: Boolean,
  onDismiss: () -> Unit,
  onSelectDevice: (String) -> Unit
) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  val initialFilter = remember(currentGroup, hasNamedGroups) {
    if (!hasNamedGroups) GROUP_FILTER_ALL else currentGroup ?: GROUP_KEY_UNGROUPED
  }
  var selectedGroupFilter by remember(initialFilter) { mutableStateOf(initialFilter) }
  var searchQuery by remember { mutableStateOf("") }
  val groupSections = remember(devices) { buildDeviceGroupSections(devices, emptyMap()) }
  val visibleDevices = remember(devices, selectedGroupFilter, searchQuery) {
    devices.filter { device ->
      device.matchesGroup(selectedGroupFilter) && device.matchesQuery(searchQuery)
    }
  }

  OneUiSheet(
    onDismissRequest = onDismiss,
    title = "切换设备",
    subtitle = if (hasNamedGroups) "默认聚焦同组机器，可切组或搜索直达目标设备" else "点按任意设备立即切换，并保持当前子页面"
  ) {
    if (hasNamedGroups) {
      val groupScroll = rememberScrollState()
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .oneUiHorizontalFadingEdge(groupScroll)
          .horizontalScroll(groupScroll),
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
        verticalAlignment = Alignment.CenterVertically
      ) {
        OneUiFilterChip(
          label = "全部 ${devices.size}",
          selected = selectedGroupFilter == GROUP_FILTER_ALL,
          onClick = { selectedGroupFilter = GROUP_FILTER_ALL }
        )
        groupSections.forEach { section ->
          OneUiFilterChip(
            label = "${section.name} ${section.online}/${section.total}",
            selected = selectedGroupFilter == section.key,
            onClick = { selectedGroupFilter = section.key }
          )
        }
      }
    }
    if (devices.size > SHEET_SEARCH_THRESHOLD) {
      OneUiCompactSearchBar(
        value = searchQuery,
        onValueChange = { searchQuery = it },
        placeholder = "搜索主机名、分组或设备 ID",
        onClearOrClose = { searchQuery = "" }
      )
    }
    if (visibleDevices.isEmpty()) {
      OneUiText(
        text = "当前筛选下没有匹配的设备",
        role = OneUiTextRole.RowSubtitle,
        color = colors.textTertiary
      )
    } else {
      OneUiGroup {
        visibleDevices.forEachIndexed { index, device ->
          if (index > 0) OneUiListDivider()
          val isCurrent = device.deviceId == currentDeviceId
          val online = device.status == "online"
          OneUiListItem(
            title = if (isCurrent) "${device.hostname}（当前）" else device.hostname,
            subtitle = buildString {
              append(if (online) "在线" else "离线")
              device.normalizedGroup()?.let { append(" · $it") }
              if (online) {
                append(" · CPU ${formatPercent(device.cpuUsagePercent)} · 内存 ${formatPercent(device.memoryUsagePercent)}")
              }
            },
            onClick = { onSelectDevice(device.deviceId) },
            leading = {
              OneUiLeadingIcon(
                icon = deviceIcon(device.os),
                contentDescription = null,
                tone = if (isCurrent) OneUiIconTone.Accent else if (online) OneUiIconTone.Online else OneUiIconTone.Offline
              )
            },
            trailing = if (isCurrent) {
              { OneUiIcon(Icons.Rounded.Check, contentDescription = "当前设备", tint = colors.accent, size = metrics.iconFilledSize) }
            } else null
          )
        }
      }
    }
  }
}

/**
 * 单台设备快速改组面板：
 * - 已有分组支持点按一键直接归入（一步完成，无需选完再找底部确认按钮）；
 * - 已在组内的设备支持一键移出为「未分组」；
 * - 同时保留输入新分组名或选用推荐分组名创建新组的能力。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DeviceGroupPickerSheet(
  title: String,
  subtitle: String,
  currentGroup: String?,
  existingGroups: List<String>,
  onDismiss: () -> Unit,
  onConfirm: (String?) -> Unit
) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  var customText by remember(currentGroup) { mutableStateOf("") }
  val trimmedCustom = normalizeGroupInput(customText)
  val reservedError = customText.isNotBlank() && isReservedGroupName(customText)
  val recommended = remember(existingGroups) {
    RECOMMENDED_GROUPS.filterNot { it in existingGroups }
  }

  OneUiSheet(
    onDismissRequest = onDismiss,
    title = title,
    subtitle = subtitle,
    confirmBar = {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceS),
        verticalAlignment = Alignment.CenterVertically
      ) {
        OneUiButton(
          label = "取消",
          onClick = onDismiss,
          variant = OneUiButtonVariant.Text,
          modifier = Modifier.weight(1f)
        )
        OneUiButton(
          label = if (trimmedCustom != null) "归入「$trimmedCustom」" else "保存新分组",
          enabled = trimmedCustom != null && !reservedError,
          onClick = { if (trimmedCustom != null && !reservedError) onConfirm(trimmedCustom) },
          modifier = Modifier.weight(1.3f)
        )
      }
    }
  ) {
    if (existingGroups.isNotEmpty() || !currentGroup.isNullOrBlank()) {
      Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
        OneUiText(
          text = "点按立即归入已有分组",
          role = OneUiTextRole.ChartLabel,
          color = colors.textSecondary,
          weight = FontWeight.SemiBold
        )
        OneUiGroup {
          existingGroups.forEachIndexed { index, group ->
            if (index > 0) OneUiListDivider()
            val isCurrent = currentGroup == group
            OneUiListItem(
              title = group,
              subtitle = if (isCurrent) "当前所在分组" else "点按立即归入此组",
              selected = isCurrent,
              onClick = { onConfirm(group) },
              trailing = if (isCurrent) {
                { OneUiIcon(Icons.Rounded.Check, contentDescription = "当前分组", tint = colors.accent, size = metrics.iconFilledSize) }
              } else null
            )
          }
          if (!currentGroup.isNullOrBlank()) {
            if (existingGroups.isNotEmpty()) OneUiListDivider()
            OneUiListItem(
              title = "设为未分组",
              subtitle = "从「$currentGroup」移出，保留设备监控数据",
              onClick = { onConfirm(null) },
              trailing = {
                OneUiIcon(Icons.Rounded.Close, contentDescription = null, tint = colors.textTertiary, size = metrics.iconFilledSize)
              }
            )
          }
        }
      }
    }

    Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
      OneUiTextField(
        value = customText,
        onValueChange = { customText = it.take(64) },
        label = if (existingGroups.isEmpty()) "新建分组名称" else "或新建其他分组",
        supportingText = "输入名称或点选下方推荐词后，点底部按钮创建并归入",
        errorText = if (reservedError) "该名称为系统保留标识，请换一个名称" else null
      )
      if (recommended.isNotEmpty()) {
        FlowRow(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
          verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)
        ) {
          recommended.forEach { group ->
            OneUiFilterChip(
              label = "+ $group",
              selected = trimmedCustom == group,
              onClick = { onConfirm(group) }
            )
          }
        }
      }
    }
  }
}

/**
 * 专职「组成员穿梭面板」：
 * 针对已存在的某个设备组，清晰区分「组内现有成员（取消勾选即移出）」与「可加入的其他设备（勾选即转入）」，
 * 底部确认按钮实时展示双向增删差集并原子化提交，彻底解决原版取消勾选无法移出分组的问题。
 */
@Composable
internal fun GroupMembersSheet(
  groupName: String,
  devices: List<DeviceSummaryDto>,
  onDismiss: () -> Unit,
  onConfirmDiff: (addedIds: List<String>, removedIds: List<String>) -> Unit
) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  var searchQuery by remember { mutableStateOf("") }
  var selectedIds by remember(groupName, devices) {
    mutableStateOf(
      devices.filter { it.normalizedGroup() == groupName }.map { it.deviceId }.toSet()
    )
  }

  val diff = remember(devices, groupName, selectedIds) {
    computeGroupMembershipDiff(devices, groupName, selectedIds)
  }
  val filtered = remember(devices, searchQuery) {
    devices.filter { it.matchesQuery(searchQuery) }
  }
  val currentMembers = remember(filtered, groupName) {
    filtered.filter { it.normalizedGroup() == groupName }
  }
  val candidates = remember(filtered, groupName) {
    filtered.filter { it.normalizedGroup() != groupName }
  }

  OneUiSheet(
    onDismissRequest = onDismiss,
    title = "管理「$groupName」成员",
    subtitle = buildString {
      append("勾选设备加入本组，取消勾选现有设备即可移出为未分组")
      if (diff.transferredCount > 0) append(" · 含 ${diff.transferredCount} 台跨组转入")
    },
    confirmBar = {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceS),
        verticalAlignment = Alignment.CenterVertically
      ) {
        OneUiButton(
          label = "取消",
          onClick = onDismiss,
          variant = OneUiButtonVariant.Text,
          modifier = Modifier.weight(0.9f)
        )
        OneUiButton(
          label = diff.confirmButtonLabel,
          enabled = diff.hasChanges,
          destructive = diff.dissolvesGroup,
          onClick = { onConfirmDiff(diff.addedIds, diff.removedIds) },
          modifier = Modifier.weight(1.4f)
        )
      }
    }
  ) {
    if (devices.size > SHEET_SEARCH_THRESHOLD) {
      OneUiCompactSearchBar(
        value = searchQuery,
        onValueChange = { searchQuery = it },
        placeholder = "搜索设备名称或原分组",
        onClearOrClose = { searchQuery = "" }
      )
    }

    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically
    ) {
      OneUiText(
        text = "组内将保留 ${selectedIds.size} 台设备",
        role = OneUiTextRole.ChartLabel,
        color = colors.textSecondary,
        weight = FontWeight.SemiBold
      )
      Row(horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
        val ungroupedIds = devices.filter { it.normalizedGroup() == null }.map { it.deviceId }.toSet()
        if (ungroupedIds.isNotEmpty()) {
          val allUngroupedIncluded = ungroupedIds.all { it in selectedIds }
          OneUiPill(
            label = if (allUngroupedIncluded) "撤回未分组" else "+ 纳入未分组 (${ungroupedIds.size})",
            tone = OneUiPillTone.Accent,
            onClick = {
              selectedIds = if (allUngroupedIncluded) selectedIds - ungroupedIds else selectedIds + ungroupedIds
            }
          )
        }
      }
    }

    if (currentMembers.isNotEmpty()) {
      Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
        OneUiGroupHeader(label = "当前组内成员 · ${currentMembers.size}")
        OneUiGroup {
          currentMembers.forEachIndexed { index, device ->
            if (index > 0) OneUiListDivider()
            val checked = device.deviceId in selectedIds
            val toggle = {
              selectedIds = if (checked) selectedIds - device.deviceId else selectedIds + device.deviceId
            }
            OneUiListItem(
              title = device.hostname,
              subtitle = "${if (device.status == "online") "在线" else "离线"} · ${osLabel(device.os)}",
              onClick = toggle,
              leading = {
                OneUiCheckbox(checked = checked, onCheckedChange = { toggle() }, label = "保留 ${device.hostname}")
              },
              trailing = if (!checked) {
                { OneUiPill(label = "将移出", tone = OneUiPillTone.Warning) }
              } else null
            )
          }
        }
      }
    }

    if (candidates.isNotEmpty()) {
      Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
        OneUiGroupHeader(label = "可加入的其他设备 · ${candidates.size}")
        OneUiGroup {
          candidates.forEachIndexed { index, device ->
            if (index > 0) OneUiListDivider()
            val checked = device.deviceId in selectedIds
            val originGroup = device.normalizedGroup()
            val toggle = {
              selectedIds = if (checked) selectedIds - device.deviceId else selectedIds + device.deviceId
            }
            OneUiListItem(
              title = device.hostname,
              subtitle = buildString {
                append(if (device.status == "online") "在线" else "离线")
                append(" · ")
                append(osLabel(device.os))
                append(" · ")
                append(originGroup?.let { "原属：$it" } ?: "未分组")
              },
              onClick = toggle,
              leading = {
                OneUiCheckbox(checked = checked, onCheckedChange = { toggle() }, label = "加入 ${device.hostname}")
              },
              trailing = if (checked) {
                {
                  OneUiPill(
                    label = if (originGroup != null) "转入本组" else "将加入",
                    tone = OneUiPillTone.Accent
                  )
                }
              } else null
            )
          }
        }
      }
    }
  }
}

/**
 * 新建分组 / 批量将选中设备归入目标分组面板：
 * 用于「+ 新建组」入口及管理态下多选设备后的「批量归组」。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CreateOrAssignGroupSheet(
  devices: List<DeviceSummaryDto>,
  existingGroups: List<String>,
  preselectedIds: Set<String> = emptySet(),
  onDismiss: () -> Unit,
  onConfirm: (List<String>, String?) -> Unit
) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  var groupText by remember { mutableStateOf("") }
  var searchQuery by remember { mutableStateOf("") }
  var selectedIds by remember(preselectedIds, devices) {
    val defaultSelection = if (preselectedIds.isNotEmpty()) {
      preselectedIds
    } else {
      devices.filter { it.normalizedGroup() == null }.map { it.deviceId }.toSet()
    }
    mutableStateOf(defaultSelection)
  }

  val normalizedTarget = normalizeGroupInput(groupText)
  val reservedError = groupText.isNotBlank() && isReservedGroupName(groupText)
  val recommended = remember(existingGroups) {
    RECOMMENDED_GROUPS.filterNot { it in existingGroups }
  }
  val filteredDevices = remember(devices, searchQuery) {
    devices.filter { it.matchesQuery(searchQuery) }
  }

  OneUiSheet(
    onDismissRequest = onDismiss,
    title = if (preselectedIds.isNotEmpty()) "批量设置分组（已选 ${selectedIds.size} 台）" else "新建或批量分配分组",
    subtitle = "输入新分组名或点选下方分组，勾选要归入的设备后一步生效",
    confirmBar = {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceS),
        verticalAlignment = Alignment.CenterVertically
      ) {
        OneUiButton(
          label = "取消",
          onClick = onDismiss,
          variant = OneUiButtonVariant.Text,
          modifier = Modifier.weight(0.9f)
        )
        OneUiButton(
          label = when {
            normalizedTarget != null -> "归入「$normalizedTarget」(${selectedIds.size})"
            preselectedIds.isNotEmpty() -> "设为未分组 (${selectedIds.size})"
            else -> "请填写分组名"
          },
          enabled = selectedIds.isNotEmpty() && !reservedError && (normalizedTarget != null || preselectedIds.isNotEmpty()),
          onClick = { onConfirm(selectedIds.toList(), normalizedTarget) },
          modifier = Modifier.weight(1.4f)
        )
      }
    }
  ) {
    OneUiTextField(
      value = groupText,
      onValueChange = { groupText = it.take(64) },
      label = "目标分组名称",
      supportingText = if (preselectedIds.isNotEmpty()) "留空保存可将已选设备统一设为未分组" else "支持中文、英文或机房/角色命名（如 PVE 集群、办公端）",
      errorText = if (reservedError) "该名称为系统保留标识，请更换名称" else null
    )

    if (existingGroups.isNotEmpty() || recommended.isNotEmpty()) {
      FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs),
        verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)
      ) {
        existingGroups.forEach { group ->
          OneUiFilterChip(
            label = group,
            selected = normalizedTarget == group,
            onClick = { groupText = group }
          )
        }
        recommended.forEach { group ->
          OneUiFilterChip(
            label = "+ $group",
            selected = normalizedTarget == group,
            onClick = { groupText = group }
          )
        }
      }
    }

    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.SpaceBetween
    ) {
      OneUiText(
        text = "勾选归入设备（${selectedIds.size}/${devices.size} 台）",
        role = OneUiTextRole.ChartLabel,
        color = colors.textSecondary,
        weight = FontWeight.SemiBold
      )
      Row(horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
        val allFilteredSelected = filteredDevices.isNotEmpty() && filteredDevices.all { it.deviceId in selectedIds }
        OneUiPill(
          label = if (allFilteredSelected) "取消全选" else "全选",
          tone = OneUiPillTone.Neutral,
          onClick = {
            val ids = filteredDevices.map { it.deviceId }.toSet()
            selectedIds = if (allFilteredSelected) selectedIds - ids else selectedIds + ids
          }
        )
        if (devices.any { it.normalizedGroup() == null }) {
          OneUiPill(
            label = "仅未分组",
            tone = OneUiPillTone.Neutral,
            onClick = {
              selectedIds = devices.filter { it.normalizedGroup() == null }.map { it.deviceId }.toSet()
            }
          )
        }
      }
    }

    if (devices.size > SHEET_SEARCH_THRESHOLD) {
      OneUiCompactSearchBar(
        value = searchQuery,
        onValueChange = { searchQuery = it },
        placeholder = "筛选设备名称或当前分组",
        onClearOrClose = { searchQuery = "" }
      )
    }

    OneUiGroup {
      filteredDevices.forEachIndexed { index, device ->
        if (index > 0) OneUiListDivider()
        val isChecked = device.deviceId in selectedIds
        val currentGroup = device.normalizedGroup()
        val toggle = {
          selectedIds = if (isChecked) selectedIds - device.deviceId else selectedIds + device.deviceId
        }
        OneUiListItem(
          title = device.hostname,
          subtitle = "${if (device.status == "online") "在线" else "离线"} · ${osLabel(device.os)} · 当前：${currentGroup ?: "未分组"}",
          onClick = toggle,
          leading = {
            OneUiCheckbox(
              checked = isChecked,
              onCheckedChange = { toggle() },
              label = "选择 ${device.hostname}"
            )
          }
        )
      }
    }
  }
}
