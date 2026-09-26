package com.dsc.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import com.dsc.android.ui.oneui.OneUiButton
import com.dsc.android.ui.oneui.OneUiButtonSize
import com.dsc.android.ui.oneui.OneUiButtonVariant
import com.dsc.android.ui.oneui.OneUiCheckbox
import com.dsc.android.ui.oneui.OneUiDialog
import com.dsc.android.ui.oneui.OneUiListDivider
import com.dsc.android.ui.oneui.OneUiListItem
import com.dsc.android.ui.oneui.OneUiSheet
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme
import com.dsc.android.ui.oneui.blockInstances
import com.dsc.android.ui.oneui.blockMetricKeys
import com.dsc.android.ui.oneui.metricLabel
import com.dsc.android.ui.shell.GuanlanActions

/**
 * 记录项配置面板（构 + 件）。
 *
 * 旧实现是一个带滚动列表的 AlertDialog，属于 Material 习惯；
 * One UI 对这种“多选 + 分组”的配置用底部面板 + 设置式行 + 底部确认条。
 * 三层配置语义完全保留：设备级勾选类别、类别级勾选指标与实例、实例级勾选指标。
 */
@Composable
fun MetricConfigSheet(
  state: AppState,
  actions: GuanlanActions,
  onDismiss: () -> Unit
) {
  val config = state.metricConfig ?: return
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val editingBlockKey = state.editingBlockKey
  val editingInstanceId = state.editingInstanceId
  val enabledSet = state.metricConfigDraft.toSet()
  val availableMap = config.availableMetrics.associate { it.key to it.available }
  val savedDeviceIds = config.enabledDeviceIds.mapValues { (_, values) -> values.toSet() }
  val draftDeviceIds = state.enabledDeviceIdsDraft.mapValues { (_, values) -> values.toSet() }
  val savedInstanceMetrics = config.instanceMetricConfig.mapValues { (_, values) -> values.toSet() }
  val draftInstanceMetrics = state.instanceMetricConfigDraft.mapValues { (_, values) -> values.toSet() }
  val hasUnsavedChanges = config.enabledMetrics.toSet() != enabledSet ||
    savedDeviceIds != draftDeviceIds ||
    savedInstanceMetrics != draftInstanceMetrics

  var discardConfirm by remember(config.deviceId, editingBlockKey, editingInstanceId) { mutableStateOf(false) }
  val requestDismiss: () -> Unit = {
    if (!state.savingMetricConfig) {
      if (hasUnsavedChanges) discardConfirm = true else onDismiss()
    }
  }

  val title = when {
    editingInstanceId != null -> "编辑实例记录项"
    editingBlockKey != null -> "编辑 ${editingBlockKey.label}"
    else -> "编辑设备记录项"
  }
  val subtitle = when {
    editingInstanceId != null -> "只影响该实例的采集项"
    editingBlockKey != null -> "选择该类别要采集的指标与实例"
    else -> "取消勾选后中枢仍会收到数据，但客户端不再展示该类别"
  }

  OneUiSheet(
    onDismissRequest = requestDismiss,
    title = title,
    subtitle = subtitle,
    // 确认条在滚动区之外：勾选列表一长，「保存」不再被顶到折叠线以外（交 + 适）
    confirmBar = {
      Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)
      ) {
        OneUiText(
          text = if (hasUnsavedChanges) "有未保存的修改" else "保存后立即生效，图表在下一次刷新时重算",
          role = OneUiTextRole.RowSubtitle,
          color = if (hasUnsavedChanges) colors.warningContent else colors.textSecondary
        )
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(metrics.spaceS),
          verticalAlignment = Alignment.CenterVertically
        ) {
          OneUiButton(
            label = "取消",
            onClick = requestDismiss,
            variant = OneUiButtonVariant.Text,
            modifier = Modifier.weight(1f),
            enabled = !state.savingMetricConfig
          )
          OneUiButton(
            label = if (state.savingMetricConfig) "保存中" else "保存",
            onClick = actions.onSaveMetricConfig,
            modifier = Modifier.weight(1f),
            loading = state.savingMetricConfig
          )
        }
      }
    }
  ) {
    if (editingInstanceId == null && editingBlockKey == null) {
      DeviceBlockKey.entries.filter { it != DeviceBlockKey.Fan }.forEachIndexed { index, block ->
        if (index > 0) OneUiListDivider()
        val blockMetrics = blockMetricKeys(block)
        val fullyEnabled = blockMetrics.all { it in enabledSet }
        OneUiListItem(
          title = block.label,
          subtitle = blockMetrics.joinToString(" / ") { metricLabel(it) },
          onClick = { actions.onToggleBlock(block) },
          trailing = {
            OneUiCheckbox(checked = fullyEnabled, onCheckedChange = { actions.onToggleBlock(block) }, label = block.label)
          }
        )
      }
    } else if (editingInstanceId == null && editingBlockKey != null) {
      blockMetricKeys(editingBlockKey).forEachIndexed { index, metric ->
        if (index > 0) OneUiListDivider()
        val available = availableMap[metric] ?: false
        OneUiListItem(
          title = metricLabel(metric),
          subtitle = if (available) "可检测" else "当前设备不支持检测",
          enabled = available,
          onClick = if (available) {
            { actions.onToggleMetric(metric) }
          } else {
            null
          },
          trailing = {
            OneUiCheckbox(
              checked = metric in enabledSet,
              onCheckedChange = if (available) ({ actions.onToggleMetric(metric) }) else null,
              enabled = available,
              label = metricLabel(metric)
            )
          }
        )
      }

      val instances = blockInstances(state, editingBlockKey)
      if (instances.isNotEmpty()) {
        Spacer(Modifier.height(metrics.spaceS))
        OneUiText(
          text = "实例",
          role = OneUiTextRole.ChartLabel,
          color = colors.textTertiary,
          weight = FontWeight.SemiBold
        )
        instances.forEachIndexed { index, instance ->
          if (index > 0) OneUiListDivider()
          val enabledIds = state.enabledDeviceIdsDraft[editingBlockKey.value]
          val checked = enabledIds.isNullOrEmpty() || enabledIds.contains(instance.id)
          OneUiListItem(
            title = instance.title,
            subtitle = instance.subtitle.ifBlank { "默认采集" },
            onClick = { actions.onToggleDeviceInstance(editingBlockKey, instance.id) },
            trailing = {
              OneUiCheckbox(
                checked = checked,
                onCheckedChange = { actions.onToggleDeviceInstance(editingBlockKey, instance.id) },
                label = instance.title
              )
            }
          )
        }
      }
    } else if (editingBlockKey != null && editingInstanceId != null) {
      blockMetricKeys(editingBlockKey).forEachIndexed { index, metric ->
        if (index > 0) OneUiListDivider()
        val available = availableMap[metric] ?: false
        val enabled = (state.instanceMetricConfigDraft[editingInstanceId]
          ?: blockMetricKeys(editingBlockKey)).contains(metric)
        OneUiListItem(
          title = metricLabel(metric),
          subtitle = if (available) "可检测" else "当前设备不支持检测",
          enabled = available,
          onClick = if (available) {
            { actions.onToggleInstanceMetric(editingInstanceId, metric) }
          } else {
            null
          },
          trailing = {
            OneUiCheckbox(
              checked = enabled,
              onCheckedChange = if (available) ({ actions.onToggleInstanceMetric(editingInstanceId, metric) }) else null,
              enabled = available,
              label = metricLabel(metric)
            )
          }
        )
      }
    }

  }

  if (discardConfirm) {
    OneUiDialog(
      onDismissRequest = { discardConfirm = false },
      title = "放弃未保存修改？",
      description = "当前记录项配置尚未保存，放弃后本次勾选和实例选择都会丢失。",
      confirmLabel = "放弃修改",
      onConfirm = {
        discardConfirm = false
        onDismiss()
      },
      dismissLabel = "继续编辑",
      onDismiss = { discardConfirm = false },
      destructive = true
    )
  }
}
