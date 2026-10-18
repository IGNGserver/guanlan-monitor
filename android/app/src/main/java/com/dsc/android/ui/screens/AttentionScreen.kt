package com.dsc.android.ui.screens

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Error
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ReportProblem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsc.android.AppState
import com.dsc.android.AttentionItem
import com.dsc.android.AttentionSeverity
import com.dsc.android.DeviceSummaryDto
import com.dsc.android.collectAttention
import com.dsc.android.ui.oneui.OneUiEmptyState
import com.dsc.android.ui.oneui.OneUiGroup
import com.dsc.android.ui.oneui.OneUiGroupHeader
import com.dsc.android.ui.oneui.OneUiIcon
import com.dsc.android.ui.oneui.OneUiIconButton
import com.dsc.android.ui.oneui.OneUiIconTone
import com.dsc.android.ui.oneui.OneUiLeadingIcon
import com.dsc.android.ui.oneui.OneUiListDivider
import com.dsc.android.ui.oneui.OneUiListItem
import com.dsc.android.ui.oneui.OneUiSurfaceLevel
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme
import com.dsc.android.ui.oneui.OneUiTopBar
import com.dsc.android.ui.oneui.oneUiContentWidth
import com.dsc.android.ui.oneui.oneUiListContentPadding
import com.dsc.android.ui.oneui.oneUiSurface
import com.dsc.android.ui.oneui.relativeTimeLabel
import com.dsc.android.ui.oneui.rememberNowMillis
import com.dsc.android.ui.oneui.rememberOneUiCollapse
import com.dsc.android.ui.shell.GuanlanActions
import kotlinx.coroutines.launch

/**
 * 关注（构）：把散在各设备里的问题按「严重 → 警告 → 离线」排成一张清单。
 * 每一行回答三件事：哪台、什么、离阈值多远；点一下直达对应类别的图表。
 */
@Composable
fun AttentionScreen(state: AppState, actions: GuanlanActions, embedded: Boolean) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val listState = rememberLazyListState()
  val collapse = rememberOneUiCollapse(listState)
  val scope = rememberCoroutineScope()
  val now = rememberNowMillis()

  val devices = state.devices.sortedWith(compareBy<DeviceSummaryDto> { it.sortOrder ?: Int.MAX_VALUE }.thenBy { it.hostname })
  val items = remember(state.devices, state.attentionMetrics, now / 30_000) { collectAttention(devices, state.attentionMetrics, now) }
  val groups = AttentionSeverity.entries.associateWith { severity -> items.filter { it.severity == severity } }
  val onlineIds = devices.filter { it.status == "online" }.map { it.deviceId }
  val covered = onlineIds.count { it in state.attentionMetrics }

  Box(modifier = Modifier.fillMaxSize().background(colors.canvas)) {
    Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
      OneUiTopBar(
        title = "需要关注",
        subtitle = when {
          items.isEmpty() -> "没有需要处理的问题"
          else -> "${items.size} 项 · 检查于 ${relativeTimeLabel(state.attentionCheckedAt ?: state.cacheSavedAt, now)}"
        },
        collapse = collapse,
        onCollapsedTitleClick = { scope.launch { listState.animateScrollToItem(0) } },
        large = !embedded,
        actions = {
          OneUiIconButton(
            contentDescription = "重新检查",
            onClick = { if (!state.refreshing) actions.onRefresh() },
            enabled = !state.refreshing,
            spinning = state.refreshing
          ) {
            OneUiIcon(Icons.Rounded.Refresh, contentDescription = null, tint = colors.textPrimary)
          }
        }
      )

      LazyColumn(
        state = listState,
        modifier = Modifier
          .weight(1f)
          .fillMaxWidth()
          .oneUiContentWidth(metrics),
        contentPadding = if (embedded) PaddingValues(metrics.spaceS) else oneUiListContentPadding(),
        verticalArrangement = Arrangement.spacedBy(metrics.groupGap)
      ) {
        item(key = "counts") {
          SeverityCounts(
            critical = groups[AttentionSeverity.Critical].orEmpty().size,
            warning = groups[AttentionSeverity.Warning].orEmpty().size,
            offline = groups[AttentionSeverity.Offline].orEmpty().size
          )
        }

        if (items.isEmpty()) {
          item(key = "all-clear") {
            OneUiEmptyState(
              title = if (devices.isEmpty()) "还没有设备" else "一切正常",
              description = if (devices.isEmpty()) {
                "中枢收到设备上报后，这里会汇总离线、高负载、过热和硬盘健康等问题。"
              } else {
                "${devices.size} 台设备都没有触发规则。CPU / 内存 / 硬盘占用每 15 秒检查，温度、硬盘健康与存储池每分钟检查。"
              },
              icon = Icons.Rounded.CheckCircle
            )
          }
        }

        AttentionSeverity.entries.forEach { severity ->
          val group = groups[severity].orEmpty()
          if (group.isEmpty()) return@forEach
          item(key = "group:${severity.name}") {
            Column(verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
              OneUiGroupHeader(label = "${severity.label} · ${group.size}", description = severityHint(severity))
              OneUiGroup {
                group.forEachIndexed { index, issue ->
                  if (index > 0) OneUiListDivider()
                  AttentionRow(issue = issue, onClick = { actions.onOpenDevice(issue.deviceId, issue.block) })
                }
              }
            }
          }
        }

        item(key = "coverage") {
          OneUiText(
            text = buildString {
              append("规则说明：占用率取最新上报值；温度优先用传感器自报阈值，缺省按 CPU 85/95 °C、显卡 83/90 °C、硬盘 55/65 °C 判定。")
              if (onlineIds.isNotEmpty()) append("已取得 $covered/${onlineIds.size} 台在线设备的硬件快照。")
            },
            role = OneUiTextRole.ChartLabel,
            color = colors.textTertiary,
            maxLines = 6,
            modifier = Modifier.padding(horizontal = metrics.spaceXs)
          )
        }
        item(key = "bottom-spacer") { Spacer(Modifier.height(metrics.thumbZone)) }
      }
    }
  }
}

@Composable
private fun SeverityCounts(critical: Int, warning: Int, offline: Int) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  Row(horizontalArrangement = Arrangement.spacedBy(metrics.cardGap)) {
    listOf(
      Triple("严重", critical, if (critical > 0) colors.criticalContent else colors.textTertiary),
      Triple("警告", warning, if (warning > 0) colors.warningContent else colors.textTertiary),
      Triple("离线", offline, if (offline > 0) colors.offlineContent else colors.textTertiary)
    ).forEach { (label, count, tint) ->
      Column(
        modifier = Modifier
          .weight(1f)
          .oneUiSurface(colors.group, OneUiTheme.shapes.card, colors = colors, level = OneUiSurfaceLevel.Group)
          .padding(horizontal = metrics.spaceM, vertical = metrics.spaceS),
        verticalArrangement = Arrangement.spacedBy(2.dp)
      ) {
        OneUiText(text = count.toString(), role = OneUiTextRole.Figure, color = tint, maxLines = 1)
        OneUiText(text = label, role = OneUiTextRole.ChartLabel, color = colors.textSecondary)
      }
    }
  }
}

@Composable
private fun AttentionRow(issue: AttentionItem, onClick: () -> Unit) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  OneUiListItem(
    title = issue.title,
    subtitle = "${issue.hostname} · ${issue.detail}",
    onClick = onClick,
    leading = {
      OneUiLeadingIcon(
        icon = when (issue.severity) {
          AttentionSeverity.Critical -> Icons.Rounded.Error
          AttentionSeverity.Warning -> Icons.Rounded.ReportProblem
          AttentionSeverity.Offline -> Icons.Rounded.CloudOff
        },
        contentDescription = issue.severity.label,
        tone = when (issue.severity) {
          AttentionSeverity.Critical -> OneUiIconTone.Critical
          AttentionSeverity.Warning -> OneUiIconTone.Warning
          AttentionSeverity.Offline -> OneUiIconTone.Offline
        }
      )
    },
    trailing = {
      Row(verticalAlignment = Alignment.CenterVertically) {
        OneUiText(
          text = issue.block?.label ?: "概览",
          role = OneUiTextRole.ChartLabel,
          color = colors.accent,
          weight = FontWeight.SemiBold
        )
        OneUiIcon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = colors.accent, size = metrics.iconFilledSize)
      }
    }
  )
}

private fun severityHint(severity: AttentionSeverity): String = when (severity) {
  AttentionSeverity.Critical -> "已越过临界值，建议立即处理"
  AttentionSeverity.Warning -> "接近上限或状态需注意"
  AttentionSeverity.Offline -> "没有新的上报；恢复后自动消失"
}
