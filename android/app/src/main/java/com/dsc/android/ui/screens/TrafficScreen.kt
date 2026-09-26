package com.dsc.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.ChevronLeft
import androidx.compose.material.icons.automirrored.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dsc.android.AppState
import com.dsc.android.RemoteDataSource
import com.dsc.android.TrafficCalendarCellDto
import com.dsc.android.TrafficCalendarMode
import com.dsc.android.TrafficRangeRecordDto
import com.dsc.android.ui.oneui.OneUiGroup
import com.dsc.android.ui.oneui.OneUiGroupHeader
import com.dsc.android.ui.oneui.OneUiIconButton
import com.dsc.android.ui.oneui.OneUiListDivider
import com.dsc.android.ui.oneui.OneUiListItem
import com.dsc.android.ui.oneui.OneUiLoadingRow
import com.dsc.android.ui.oneui.OneUiNotice
import com.dsc.android.ui.oneui.OneUiNoticeTone
import com.dsc.android.ui.oneui.OneUiPill
import com.dsc.android.ui.oneui.OneUiReading
import com.dsc.android.ui.oneui.OneUiSegmentedRow
import com.dsc.android.ui.oneui.OneUiSkeleton
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme
import com.dsc.android.ui.oneui.OneUiTopBar
import com.dsc.android.ui.oneui.formatBytes
import com.dsc.android.ui.oneui.formatDate
import com.dsc.android.ui.oneui.formatDateInclusive
import com.dsc.android.ui.oneui.formatTime
import com.dsc.android.ui.oneui.oneUiListContentPadding
import com.dsc.android.ui.oneui.oneUiPressable
import com.dsc.android.ui.oneui.rememberOneUiCollapse
import com.dsc.android.ui.shell.GuanlanActions
import kotlin.math.max

/**
 * 流量日历（构）。
 *
 * 保留原有的区间选择、翻页与记录列表语义，但按 One UI 的日历页重排：
 * 顶部是“周期 + 区间”读数区，日历作为一张热力表，明细作为设置式列表，
 * 日/周/月切换下沉到底部拇指区。
 */
@Composable
fun TrafficScreen(
  state: AppState,
  actions: GuanlanActions,
  embedded: Boolean
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val listState = rememberLazyListState()
  val collapse = rememberOneUiCollapse(listState)
  val selectedDevice = state.devices.find { it.deviceId == state.selectedDeviceId }
  val traffic = state.trafficCalendar
  val modes = TrafficCalendarMode.entries.map { it.label }
  val modeIndex = TrafficCalendarMode.entries.indexOf(state.trafficMode).coerceAtLeast(0)

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.canvas)
  ) {
    Column(modifier = Modifier.fillMaxSize()) {
      OneUiTopBar(
        title = selectedDevice?.hostname ?: "流量记录",
        subtitle = "流量日历",
        collapse = collapse,
        large = !embedded,
        navigationIcon = {
          OneUiIconButton(contentDescription = "返回上一页", onClick = actions.onSystemBack) {
            Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = null, tint = colors.textPrimary)
          }
        },
        actions = {
          OneUiIconButton(
            contentDescription = "刷新",
            onClick = { if (!state.loadingTraffic) actions.onRefresh() },
            enabled = !state.loadingTraffic,
            spinning = state.loadingTraffic
          ) {
            Icon(Icons.Rounded.Refresh, contentDescription = null, tint = colors.textSecondary)
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
              description = "缓存于 ${formatTime(state.cacheSavedAt)}；流量数字可能落后于中枢。",
              tone = OneUiNoticeTone.Warning
            )
          }
        }

        if (traffic == null) {
          if (state.loadingTraffic) {
            item(key = "traffic-loading") { OneUiLoadingRow("正在读取流量数据") }
          }
          item(key = "traffic-skeleton") {
            Column(verticalArrangement = Arrangement.spacedBy(metrics.cardGap)) {
              OneUiSkeleton(height = 108.dp)
              OneUiSkeleton(height = 188.dp)
            }
          }
        } else {
          item(key = "traffic-header") {
            TrafficHeader(traffic.title, traffic.rangeStart, traffic.rangeEnd, traffic, actions.onShiftTrafficAnchor)
          }
          item(key = "traffic-calendar") {
            TrafficCalendar(traffic.cells, state.trafficMode, actions.onSelectTrafficCell)
          }
          item(key = "traffic-records-header") {
            OneUiGroupHeader(label = "范围记录", description = "最多展示最近 36 条上报记录")
          }
          item(key = "traffic-records") {
            TrafficRecords(traffic.records.asReversed().take(36))
          }
        }
      }

      // 统计周期切换属于高频操作，放在底部（构 + 交）
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .background(colors.group)
          .padding(horizontal = metrics.screenMargin, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
      ) {
        OneUiText(
          text = "统计周期",
          role = OneUiTextRole.ChartLabel,
          color = colors.textTertiary,
          weight = FontWeight.SemiBold
        )
        OneUiSegmentedRow(
          options = modes,
          selectedIndex = modeIndex,
          onSelect = { index -> actions.onSelectTrafficMode(TrafficCalendarMode.entries[index]) },
          enabled = !state.loadingTraffic
        )
      }
    }
  }
}

@Composable
private fun TrafficHeader(
  title: String,
  rangeStart: String,
  rangeEnd: String,
  traffic: com.dsc.android.TrafficCalendarDto,
  onShiftAnchor: (Int) -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  Column(
    modifier = Modifier
      .fillMaxWidth()
      .background(colors.group, OneUiTheme.shapes.group)
      .padding(metrics.groupPadding),
    verticalArrangement = Arrangement.spacedBy(metrics.spaceM)
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Column(modifier = Modifier.weight(1f)) {
        OneUiText(text = title, role = OneUiTextRole.Title)
        OneUiText(
          text = "${formatDate(rangeStart)} 至 ${formatDateInclusive(rangeEnd)}",
          role = OneUiTextRole.RowSubtitle,
          color = colors.textSecondary,
          modifier = Modifier.padding(top = 2.dp)
        )
      }
      // 翻页箭头贴着读数区：One UI 日历的换月操作就在标题右侧（件）
      Row(horizontalArrangement = Arrangement.spacedBy(metrics.spaceXxs)) {
        OneUiIconButton(contentDescription = "上一个区间", onClick = { onShiftAnchor(-1) }) {
          Icon(Icons.AutoMirrored.Rounded.ChevronLeft, contentDescription = null, tint = colors.textSecondary)
        }
        OneUiIconButton(contentDescription = "下一个区间", onClick = { onShiftAnchor(1) }) {
          Icon(Icons.AutoMirrored.Rounded.ChevronRight, contentDescription = null, tint = colors.textSecondary)
        }
      }
    }
    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(metrics.spaceL),
      verticalAlignment = Alignment.Bottom
    ) {
      OneUiReading(value = formatBytes(traffic.totalRxBytes + traffic.totalTxBytes), unit = "合计", label = "区间总量")
      OneUiReading(value = formatBytes(traffic.totalRxBytes), unit = "接收", label = "下行")
      OneUiReading(value = formatBytes(traffic.totalTxBytes), unit = "发送", label = "上行")
    }
  }
}

@Composable
private fun TrafficCalendar(
  cells: List<TrafficCalendarCellDto>,
  mode: TrafficCalendarMode,
  onSelectCell: (String) -> Unit
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  if (cells.isEmpty()) return
  val maxValue = max(cells.maxOf { it.totalRxBytes + it.totalTxBytes }, 1.0)
  val columns = 7

  OneUiGroup {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 10.dp, vertical = 10.dp),
      verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
      cells.chunked(columns).forEach { rowCells ->
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
          rowCells.forEach { cell ->
            val ratio = ((cell.totalRxBytes + cell.totalTxBytes) / maxValue).toFloat()
            val selected = cell.isSelected
            val label = dayLabel(cell, mode)
            val total = formatBytes(cell.totalRxBytes + cell.totalTxBytes)
            Box(
              modifier = Modifier
                .weight(1f)
                .height(if (mode == TrafficCalendarMode.Month) 46.dp else 56.dp)
                .background(
                  color = if (selected) colors.accent else colors.sunken,
                  shape = shapes.tile
                )
                .then(
                  if (cell.isCurrentPeriod && !selected) {
                    Modifier.border(2.dp, colors.accent, shapes.tile)
                  } else {
                    Modifier
                  }
                )
                .semantics {
                  contentDescription = "$label $total" +
                    if (cell.isCurrentPeriod) "，当前周期" else "" +
                    if (selected) "，已选中" else ""
                }
                .oneUiPressable(
                  onClick = { onSelectCell(cell.rangeStart) },
                  shape = shapes.tile,
                  minHeight = null,
                  selected = selected,
                  stateLabel = if (selected) "已选中" else null
                ),
              contentAlignment = Alignment.Center
            ) {
              Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp)
              ) {
                OneUiText(
                  text = label,
                  role = OneUiTextRole.ChartLabel,
                  color = when {
                    selected -> colors.textOnAccent
                    cell.isInPrimaryScope -> colors.textPrimary
                    else -> colors.textTertiary
                  },
                  weight = if (selected || cell.isCurrentPeriod) FontWeight.SemiBold else FontWeight.Medium,
                  maxLines = 1
                )
                if (mode == TrafficCalendarMode.Month) {
                  Box(
                    modifier = Modifier
                      .width((8 + 24 * ratio.coerceIn(0f, 1f)).dp)
                      .height(3.dp)
                      .background(
                        if (cell.isInPrimaryScope) {
                          colors.accent.copy(alpha = 0.30f + 0.70f * ratio)
                        } else {
                          colors.hairline
                        },
                        shapes.badge
                      )
                  )
                } else {
                  OneUiText(
                    text = total,
                    role = OneUiTextRole.ChartLabel,
                    color = if (selected) colors.textOnAccent else colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center
                  )
                }
              }
            }
          }
          repeat((columns - rowCells.size).coerceAtLeast(0)) {
            Spacer(Modifier.weight(1f))
          }
        }
      }
    }
  }
}

private fun dayLabel(cell: TrafficCalendarCellDto, mode: TrafficCalendarMode): String {
  if (mode != TrafficCalendarMode.Month) return cell.label
  return runCatching {
    java.time.OffsetDateTime.parse(cell.rangeStart)
      .atZoneSameInstant(java.time.ZoneId.systemDefault())
      .dayOfMonth
      .toString()
  }.getOrDefault(cell.label)
}

@Composable
private fun TrafficRecords(records: List<TrafficRangeRecordDto>) {
  if (records.isEmpty()) {
    OneUiGroup {
      OneUiListItem(
        title = "该区间暂无记录",
        subtitle = "换一个日期或统计周期试试。"
      )
    }
    return
  }
  OneUiGroup {
    records.forEachIndexed { index, record ->
      if (index > 0) OneUiListDivider()
      OneUiListItem(
        title = formatTime(record.timestamp),
        subtitle = "接收 ${formatBytes(record.rxBytes)} · 发送 ${formatBytes(record.txBytes)}",
        trailing = { OneUiPill(label = "合计", value = formatBytes(record.totalBytes)) }
      )
    }
  }
}
