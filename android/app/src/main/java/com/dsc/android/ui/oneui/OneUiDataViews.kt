@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.dsc.android.ui.oneui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.dsc.android.ChartWindow
import com.dsc.android.MetricWindow
import com.dsc.android.SamplePointDto
import com.dsc.android.parseTimestampMillis
import com.dsc.android.resolveChartIndex
import com.dsc.android.splitSamplePointSegments
import kotlin.math.max

/*
 * 图表与指标卡在 OneUiCharts.kt；这里保留元信息表、粒度选择器与读数等数据呈现组件（件）。
 */

/**
 * 元信息表（件）：One UI 用“左标签 / 右值”的设置式行，
 * 替代原来的药丸云，长值可换行且可复制（适）。
 */
@Composable
fun OneUiMetaTable(
  items: List<Pair<String, String>>,
  modifier: Modifier = Modifier,
  title: String? = null,
  selectable: Boolean = false,
  collapsible: Boolean = false,
  defaultExpanded: Boolean = true
) {
  if (items.isEmpty()) return
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  var expanded by remember(items, collapsible, defaultExpanded) {
    mutableStateOf(if (collapsible) defaultExpanded else true)
  }

  Column(
    modifier = modifier
      .fillMaxWidth()
      .animateContentSize(animationSpec = motion.tween(OneUiDuration.Content, OneUiEasing.EmphasizedDecelerate))
      .oneUiSurface(colors.group, shapes.card, colors = colors, level = OneUiSurfaceLevel.Group)
  ) {
    if (collapsible) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .oneUiPressable(
            onClick = { expanded = !expanded },
            shape = shapes.card,
            minHeight = metrics.rowMinHeight
          )
          .padding(horizontal = metrics.spaceM, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
      ) {
        OneUiText(
          text = title ?: "详细硬件与系统参数",
          role = OneUiTextRole.RowSubtitle,
          color = colors.textSecondary
        )
        OneUiText(
          text = if (expanded) "收起" else "查看详情",
          role = OneUiTextRole.ChartLabel,
          color = colors.accent,
          weight = FontWeight.SemiBold
        )
      }
    } else if (!title.isNullOrBlank()) {
      OneUiText(
        text = title,
        role = OneUiTextRole.RowSubtitle,
        color = colors.textTertiary,
        modifier = Modifier.padding(start = metrics.spaceM, end = metrics.spaceM, top = metrics.spaceM)
      )
    }

    if (expanded) {
      if (collapsible) {
        Spacer(
          modifier = Modifier
            .fillMaxWidth()
            .height(metrics.hairline)
            .background(colors.hairline)
        )
      }
      items.forEachIndexed { index, (label, value) ->
        if (index > 0) {
          Spacer(
            modifier = Modifier
              .fillMaxWidth()
              .height(metrics.hairline)
              .padding(start = metrics.spaceM)
              .background(colors.hairline)
          )
        }
        Row(
          modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = metrics.spaceM, vertical = 12.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(metrics.spaceM)
        ) {
          OneUiText(
            text = label,
            role = OneUiTextRole.RowSubtitle,
            color = colors.textSecondary,
            modifier = Modifier.weight(1f)
          )
          if (selectable) {
            SelectionContainer {
              OneUiText(
                text = value,
                role = OneUiTextRole.RowSubtitle,
                color = colors.textPrimary,
                weight = FontWeight.Medium,
                maxLines = 6,
                textAlign = androidx.compose.ui.text.style.TextAlign.End,
                modifier = Modifier.weight(1.4f, fill = false)
              )
            }
          } else {
            OneUiText(
              text = value,
              role = OneUiTextRole.RowSubtitle,
              color = colors.textPrimary,
              weight = FontWeight.Medium,
              maxLines = 6,
              textAlign = androidx.compose.ui.text.style.TextAlign.End,
              modifier = Modifier.weight(1.4f, fill = false)
            )
          }
        }
      }
    }
  }
}

/**
 * 时间粒度选择器（构 + 适）：One UI 把这类高频切换放在底部拇指区。
 * 紧凑宽度用可横滑的胶囊行，宽屏用分段控件。
 */
@Composable
fun OneUiWindowSelector(
  selected: MetricWindow,
  onSelect: (MetricWindow) -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  loading: Boolean = false,
  labels: List<Pair<MetricWindow, String>> = MetricWindow.entries.map { it to it.chipLabel }
) {
  val metrics = OneUiTheme.metrics
  val colors = OneUiTheme.colors
  val window = OneUiTheme.window
  val keys = labels.map { it.second }
  val index = labels.indexOfFirst { it.first == selected }.coerceAtLeast(0)

  if (window.isWide) {
    OneUiSegmentedRow(
      options = keys,
      selectedIndex = index,
      onSelect = { onSelect(labels[it].first) },
      modifier = modifier,
      enabled = enabled
    )
    return
  }

  Row(
    modifier = modifier
      .fillMaxWidth()
      .horizontalScroll(rememberScrollState())
      .padding(vertical = 2.dp),
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
  ) {
    labels.forEach { (window, label) ->
      // 正在加载的粒度在手指落点处给出反馈：选中胶囊内嵌小加载环（交）
      val chipLeadingIcon: (@Composable () -> Unit)? = if (loading && window == selected) {
        { OneUiSpinner(size = 14.dp, strokeWidth = 2.dp, color = colors.textOnAccent) }
      } else {
        null
      }
      OneUiFilterChip(
        label = label,
        selected = window == selected,
        onClick = { onSelect(window) },
        enabled = enabled,
        leadingIcon = chipLeadingIcon
      )
    }
  }
}

/** 数值 + 单位 + 说明的一行读数，用于表头与合计。 */
@Composable
fun OneUiReading(
  value: String,
  unit: String? = null,
  label: String? = null,
  modifier: Modifier = Modifier,
  color: Color? = null
) {
  val colors = OneUiTheme.colors
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
    if (!label.isNullOrBlank()) {
      OneUiText(text = label, role = OneUiTextRole.ChartLabel, color = colors.textSecondary)
    }
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
      OneUiText(
        text = value,
        role = OneUiTextRole.Figure,
        color = color ?: colors.textPrimary,
        maxLines = 1
      )
      if (!unit.isNullOrBlank()) {
        OneUiText(
          text = unit,
          role = OneUiTextRole.MetricUnit,
          color = colors.textSecondary,
          modifier = Modifier.padding(bottom = 4.dp)
        )
      }
    }
  }
}

/** 分组内的次级标题（One UI 在组内再分层时用小标题 + 间距，而不是再加一层卡片）。 */
@Composable
fun OneUiSubHeader(label: String, modifier: Modifier = Modifier, trailing: @Composable (() -> Unit)? = null) {
  val colors = OneUiTheme.colors
  Row(
    modifier = modifier
      .fillMaxWidth()
      .padding(horizontal = OneUiTheme.metrics.spaceM, vertical = 6.dp),
    verticalAlignment = Alignment.CenterVertically
  ) {
    OneUiText(
      text = label,
      role = OneUiTextRole.RowSubtitle,
      color = colors.textTertiary,
      weight = FontWeight.SemiBold,
      modifier = Modifier.weight(1f)
    )
    trailing?.invoke()
  }
}

/** 粒度胶囊用的短标签：One UI 的筛选项保持简短，长说明留给选中后的读数区。 */
internal val MetricWindow.chipLabel: String
  get() = when (this) {
    MetricWindow.OneMinute -> "1 分"
    MetricWindow.FiveMinutes -> "5 分"
    MetricWindow.OneHour -> "1 小时"
    MetricWindow.SixHours -> "6 小时"
    MetricWindow.OneDay -> "24 小时"
    MetricWindow.SevenDays -> "7 天"
  }
