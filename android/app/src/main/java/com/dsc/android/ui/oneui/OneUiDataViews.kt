@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.dsc.android.ui.oneui

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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
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

/**
 * 数据呈现组件（件）：图表、指标块、元信息表、粒度选择器。
 *
 * 图表保持原有取数与缺测语义（同一套 ChartWindow / splitSamplePointSegments /
 * resolveChartIndex），只改表现与交互：一次性描线动画、更明确的十字准线、
 * 以及可被朗读的序列摘要（适）。
 */

@Composable
internal fun OneUiLineChart(
  points: List<SamplePointDto>,
  chartWindow: ChartWindow,
  valueFormatter: (Double?) -> String,
  title: String,
  modifier: Modifier = Modifier,
  fixedMaxValue: Double? = null,
  height: Dp = OneUiTheme.metrics.chartHeight,
  seriesIndex: Int = 0,
  animationKey: Any? = chartWindow
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  val lineColor = colors.seriesColor(seriesIndex)

  val chartPoints = remember(points) {
    points.sortedBy { parseTimestampMillis(it.timestamp) ?: Long.MIN_VALUE }
  }
  var selectedIndex by remember(chartPoints, chartWindow) {
    mutableIntStateOf(chartPoints.lastIndex.coerceAtLeast(0))
  }
  val selectedPoint = chartPoints.getOrNull(selectedIndex.coerceIn(0, (chartPoints.size - 1).coerceAtLeast(0)))

  // 动：序列首次出现或切换粒度时描线一次；15 秒自动刷新不重播。
  val reveal = remember(animationKey, motion.isReduced) {
    androidx.compose.animation.core.Animatable(if (motion.isReduced) 1f else 0f)
  }
  LaunchedEffect(reveal, motion.isReduced, chartPoints.isEmpty()) {
    if (motion.isReduced || chartPoints.isEmpty()) {
      reveal.snapTo(1f)
    } else {
      reveal.snapTo(0f)
      reveal.animateTo(
        targetValue = 1f,
        animationSpec = motion.tween(OneUiDuration.ChartDraw, OneUiEasing.EmphasizedDecelerate)
      )
    }
  }

  val summary = remember(chartPoints) { chartSummary(chartPoints, valueFormatter) }

  Column(
    modifier = modifier
      .semantics {
        contentDescription = buildString {
          append(title)
          append("，")
          append(summary)
          if (selectedPoint != null) {
            append("；当前选中 ")
            append(valueFormatter(selectedPoint.value))
          }
        }
      }
  ) {
    if (chartPoints.isNotEmpty() && selectedPoint != null) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
      ) {
        OneUiText(
          text = chartTimeLabel(selectedPoint.timestamp, chartWindow.window),
          role = OneUiTextRole.ChartLabel,
          color = colors.textSecondary
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
          Box(
            modifier = Modifier
              .size(width = 10.dp, height = 2.5.dp)
              .background(lineColor, RoundedCornerShapeTiny)
          )
          OneUiText(
            text = valueFormatter(selectedPoint.value),
            role = OneUiTextRole.ChartLabel,
            color = colors.textPrimary,
            weight = FontWeight.SemiBold
          )
        }
      }
      Spacer(Modifier.height(6.dp))
    }

    Box(
      modifier = Modifier
        .fillMaxWidth()
        .height(height)
        .clip(OneUiTheme.shapes.tile)
        .background(colors.chartTrack)
        .border(metrics.hairline, colors.hairline, OneUiTheme.shapes.tile)
    ) {
      Canvas(
        modifier = Modifier
          .fillMaxWidth()
          .height(height)
          .pointerInput(chartPoints, chartWindow) {
            if (chartPoints.isEmpty()) return@pointerInput
            detectTapGestures { offset ->
              selectedIndex = resolveChartIndex(offset.x, size.width.toFloat(), chartPoints, chartWindow)
            }
          }
          .pointerInput(chartPoints, chartWindow) {
            if (chartPoints.isEmpty()) return@pointerInput
            detectDragGestures(
              onDragStart = { offset ->
                selectedIndex = resolveChartIndex(offset.x, size.width.toFloat(), chartPoints, chartWindow)
              },
              onDrag = { change, _ ->
                selectedIndex = resolveChartIndex(change.position.x, size.width.toFloat(), chartPoints, chartWindow)
                change.consume()
              }
            )
          }
      ) {
        if (chartPoints.isEmpty()) return@Canvas
        val stroke = 2.6.dp.toPx()
        val maxValue = fixedMaxValue ?: max(chartPoints.maxOf { it.value }, 1.0)
        val yFor: (Double) -> Float = { value ->
          (size.height - (value / maxValue).toFloat() * (size.height - stroke) - stroke / 2f).coerceIn(0f, size.height)
        }

        // 4 条网格线：One UI 的图表底纹极浅，只做读数参照
        repeat(4) { index ->
          val y = size.height * index / 3f
          drawLine(
            color = colors.chartGrid,
            start = Offset(0f, y),
            end = Offset(size.width, y),
            strokeWidth = 1f
          )
        }

        clipRect(right = size.width * reveal.value) {
          splitSamplePointSegments(chartPoints, chartWindow).forEach { segment ->
            if (segment.isEmpty()) return@forEach
            val path = Path()
            val fillPath = Path()
            segment.forEachIndexed { index, point ->
              val x = chartWindow.xFor(point.timestamp, size.width)
              val y = yFor(point.value)
              if (index == 0) {
                path.moveTo(x, y)
                fillPath.moveTo(x, size.height)
                fillPath.lineTo(x, y)
              } else {
                path.lineTo(x, y)
                fillPath.lineTo(x, y)
              }
            }
            val lastX = chartWindow.xFor(segment.last().timestamp, size.width)
            fillPath.lineTo(lastX, size.height)
            fillPath.close()
            drawPath(
              path = fillPath,
              brush = Brush.verticalGradient(
                listOf(lineColor.copy(alpha = 0.22f), lineColor.copy(alpha = 0f))
              )
            )
            drawPath(
              path = path,
              color = lineColor,
              style = Stroke(width = stroke, cap = StrokeCap.Round)
            )
          }
        }

        // 准线与游标：十字线 + 空心点，One UI 在读数时把上下文留住（交）
        val point = chartPoints[selectedIndex.coerceIn(0, chartPoints.lastIndex)]
        val x = chartWindow.xFor(point.timestamp, size.width)
        val y = yFor(point.value)
        drawLine(
          color = colors.chartCrosshair,
          start = Offset(x, 0f),
          end = Offset(x, size.height),
          strokeWidth = 1.4f
        )
        drawCircle(color = colors.group, radius = 7.dp.toPx(), center = Offset(x, y))
        drawCircle(
          color = lineColor,
          radius = 4.4.dp.toPx(),
          center = Offset(x, y),
          style = Stroke(width = 2.2.dp.toPx(), cap = StrokeCap.Round)
        )
      }
    }

    if (chartPoints.isNotEmpty()) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(top = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween
      ) {
        OneUiText(
          text = chartTimeLabel(chartWindow.startMillis.toString(), chartWindow.window),
          role = OneUiTextRole.ChartLabel,
          color = colors.textTertiary
        )
        OneUiText(
          text = chartTimeLabel(chartWindow.endMillis.toString(), chartWindow.window),
          role = OneUiTextRole.ChartLabel,
          color = colors.textTertiary
        )
      }
    } else {
      OneUiText(
        text = "该粒度下暂无样本",
        role = OneUiTextRole.RowSubtitle,
        color = colors.textTertiary,
        modifier = Modifier.padding(top = 6.dp)
      )
    }
  }
}

private val RoundedCornerShapeTiny = androidx.compose.foundation.shape.RoundedCornerShape(2.dp)

private fun chartTimeLabel(value: String, window: MetricWindow): String =
  formatChartTime(value, window)

/** 序列摘要：让读屏用户获得与看图等价的信息（适）。 */
private fun chartSummary(points: List<SamplePointDto>, formatter: (Double?) -> String): String {
  if (points.isEmpty()) return "无数据"
  val min = points.minOf { it.value }
  val max = points.maxOf { it.value }
  val avg = points.map { it.value }.average()
  return "共 ${points.size} 个样本，最低 ${formatter(min)}，最高 ${formatter(max)}，平均 ${formatter(avg)}"
}

/** 指标块：标题 + 当前值 + 图表，One UI 的监控卡形态。 */
@Composable
internal fun OneUiMetricTile(
  card: MetricCardModel,
  chartWindow: ChartWindow,
  modifier: Modifier = Modifier,
  seriesIndex: Int = 0,
  onClick: (() -> Unit)? = null
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  Column(
    modifier = modifier
      .defaultMinSize(minHeight = 150.dp)
      .oneUiSurface(colors.group, shapes.card, colors = colors, level = OneUiSurfaceLevel.Group)
      .oneUiPressable(
        onClick = onClick,
        shape = shapes.card,
        minHeight = null
      )
      .padding(metrics.spaceM),
    verticalArrangement = Arrangement.spacedBy(metrics.spaceS)
  ) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)) {
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        OneUiText(
          text = card.title,
          role = OneUiTextRole.RowSubtitle,
          color = colors.textSecondary,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis
        )
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
          OneUiText(
            text = card.value,
            role = OneUiTextRole.Metric,
            color = colors.textPrimary,
            maxLines = 1
          )
        }
      }
      if (onClick != null) {
        OneUiText(
          text = "详情",
          role = OneUiTextRole.ChartLabel,
          color = colors.accent,
          weight = FontWeight.SemiBold
        )
      }
    }
    OneUiLineChart(
      points = card.points,
      chartWindow = chartWindow,
      valueFormatter = card.valueFormatter,
      title = card.title,
      fixedMaxValue = card.fixedMaxValue,
      seriesIndex = seriesIndex,
      height = metrics.chartHeight,
      modifier = Modifier.fillMaxWidth()
    )
  }
}

/**
 * 指标块网格（适）：宽度自适应列数，大字号/窄屏自动退化为单列，
 * 而不是把卡片挤到看不清。
 */
@Composable
internal fun OneUiMetricTileGrid(
  cards: List<MetricCardModel>,
  chartWindow: ChartWindow,
  modifier: Modifier = Modifier,
  onTileClick: ((MetricCardModel) -> Unit)? = null
) {
  if (cards.isEmpty()) return
  val metrics = OneUiTheme.metrics
  BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
    val spacing = metrics.cardGap
    val columns = max(1, ((maxWidth + spacing) / (metrics.metricMinCellWidth + spacing)).toInt())
    val cellWidth = (maxWidth - spacing * (columns - 1)) / columns
    androidx.compose.foundation.layout.FlowRow(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(spacing),
      verticalArrangement = Arrangement.spacedBy(spacing)
    ) {
      cards.forEachIndexed { index, card ->
        OneUiMetricTile(
          card = card,
          chartWindow = chartWindow,
          seriesIndex = index,
          onClick = onTileClick?.let { callback -> { callback(card) } },
          modifier = Modifier.width(cellWidth)
        )
      }
    }
  }
}

/**
 * 元信息表（件）：One UI 用“左标签 / 右值”的设置式行，
 * 替代原来的药丸云，长值可换行且可复制（适）。
 */
@Composable
fun OneUiMetaTable(
  items: List<Pair<String, String>>,
  modifier: Modifier = Modifier,
  title: String? = null,
  selectable: Boolean = false
) {
  if (items.isEmpty()) return
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  Column(
    modifier = modifier
      .fillMaxWidth()
      .oneUiSurface(colors.group, shapes.card, colors = colors, level = OneUiSurfaceLevel.Group)
  ) {
    if (!title.isNullOrBlank()) {
      OneUiText(
        text = title,
        role = OneUiTextRole.RowSubtitle,
        color = colors.textTertiary,
        modifier = Modifier.padding(start = metrics.spaceM, end = metrics.spaceM, top = metrics.spaceM)
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
  labels: List<Pair<MetricWindow, String>> = MetricWindow.entries.map { it to it.chipLabel }
) {
  val metrics = OneUiTheme.metrics
  val window = OneUiTheme.window
  val keys = labels.map { it.second }
  val index = labels.indexOfFirst { it.first == selected }.coerceAtLeast(0)

  if (window.isWide && labels.size <= 4) {
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
      OneUiFilterChip(
        label = label,
        selected = window == selected,
        onClick = { onSelect(window) },
        enabled = enabled
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
