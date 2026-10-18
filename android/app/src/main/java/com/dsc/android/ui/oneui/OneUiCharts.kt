@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.dsc.android.ui.oneui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.dsc.android.ChartAxis
import com.dsc.android.ChartWindow
import com.dsc.android.SamplePointDto
import com.dsc.android.SeriesStats
import com.dsc.android.niceAxis
import com.dsc.android.parseTimestampMillis
import com.dsc.android.resolveChartIndex
import com.dsc.android.seriesStats
import com.dsc.android.splitSamplePointSegments
import kotlin.math.max

/**
 * 图表（件）：数据可读性是这个应用的第一优先级，图表因此要做到
 * 1. 能直接读出量级——纵轴有整齐刻度，横轴有起止与中点时间；
 * 2. 能对比——同一量纲的成对指标（接收/发送、读取/写入、物理/虚拟内存）画在同一张图里；
 * 3. 能判断好坏——告警/临界阈值画成虚线，超线一眼可见；
 * 4. 不和页面滚动抢手势——只响应点按和横向拖动，竖向滑动始终交给列表。
 *
 * 取数与缺测语义沿用 ChartWindow / splitSamplePointSegments / resolveChartIndex。
 */

@Immutable
internal data class ChartSeriesModel(
  val label: String,
  val points: List<SamplePointDto>,
  /** OneUiColors.chartSeries 的下标；成对指标固定用 0（蓝）与 2（青），避开像告警色的橙红。 */
  val colorIndex: Int = 0
)

internal enum class ChartThresholdTone { Warning, Critical }

@Immutable
internal data class ChartThreshold(val value: Double, val label: String, val tone: ChartThresholdTone)

/** 卡片在宽度允许时并排，手机竖屏单列——两列 150dp 宽的图在手机上看不清。 */
internal val ChartCardMinWidth: Dp = 300.dp

@Composable
internal fun OneUiTrendChart(
  series: List<ChartSeriesModel>,
  chartWindow: ChartWindow,
  valueFormatter: (Double?) -> String,
  title: String,
  modifier: Modifier = Modifier,
  fixedMaxValue: Double? = null,
  includeZero: Boolean = true,
  thresholds: List<ChartThreshold> = emptyList(),
  height: Dp = OneUiTheme.metrics.chartHeight,
  showAxis: Boolean = true,
  showReadout: Boolean = true,
  axisFormatter: (Double) -> String = { valueFormatter(it) },
  animationKey: Any? = chartWindow
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  val type = OneUiTheme.type
  val stale = LocalOneUiStaleState.current
  val textMeasurer = rememberTextMeasurer()

  val sortedSeries = remember(series) {
    series.map { item -> item.copy(points = item.points.sortedBy { parseTimestampMillis(it.timestamp) ?: Long.MIN_VALUE }) }
  }
  val reference = sortedSeries.maxByOrNull { it.points.size }?.points.orEmpty()
  val hasData = sortedSeries.any { it.points.isNotEmpty() }

  val axis = remember(sortedSeries, fixedMaxValue, includeZero, thresholds) {
    val values = sortedSeries.flatMap { item -> item.points.map { it.value } }.filter { it.isFinite() }
    val dataMax = values.maxOrNull() ?: 0.0
    val dataMin = values.minOrNull() ?: 0.0
    // 阈值离数据不远时把轴撑到能看见阈值；离得太远就不画，免得把曲线压成一条线
    val reachable = thresholds.map { it.value }.filter { it <= max(dataMax, 1.0) * 1.35 }
    val top = (reachable + dataMax).max()
    val bottom = if (includeZero) dataMin else (reachable + dataMin).min()
    niceAxis(bottom, top, fixedMaxValue, includeZero)
  }

  var selectedIndex by remember(chartWindow) { mutableIntStateOf(-1) }
  val effectiveIndex = when {
    reference.isEmpty() -> -1
    selectedIndex < 0 -> reference.lastIndex
    else -> selectedIndex.coerceIn(0, reference.lastIndex)
  }
  val cursorTimestamp = reference.getOrNull(effectiveIndex)?.timestamp
  val cursorMillis = cursorTimestamp?.let(::parseTimestampMillis)
  val cursorValues = sortedSeries.map { item -> nearestValue(item.points, cursorMillis) }

  // 动：序列首次出现或切换粒度时描线一次；15 秒自动刷新不重播。
  val reveal = remember(animationKey, motion.isReduced) {
    androidx.compose.animation.core.Animatable(if (motion.isReduced) 1f else 0f)
  }
  LaunchedEffect(reveal, motion.isReduced, hasData) {
    if (motion.isReduced || !hasData) {
      reveal.snapTo(1f)
    } else {
      reveal.snapTo(0f)
      reveal.animateTo(1f, motion.tween(OneUiDuration.ChartDraw, OneUiEasing.EmphasizedDecelerate))
    }
  }

  val summary = remember(sortedSeries) {
    sortedSeries.joinToString("；") { item -> "${item.label} ${seriesSummary(item.points, valueFormatter)}" }
  }

  Column(
    modifier = modifier
      .oneUiStaleDim()
      .semantics(mergeDescendants = true) {
        contentDescription = buildString {
          append(title)
          append("，")
          append(summary)
        }
      }
  ) {
    if (showReadout && hasData) {
      ChartReadout(
        timeLabel = cursorTimestamp?.let { formatChartTime(it, chartWindow.window) } ?: "",
        series = sortedSeries,
        values = cursorValues,
        valueFormatter = valueFormatter,
        live = selectedIndex < 0
      )
      Spacer(Modifier.height(6.dp))
    }

    val labelStyle = type.chartLabel.copy(color = colors.textTertiary)
    Box(
      modifier = Modifier
        .fillMaxWidth()
        .height(height)
        .background(colors.chartTrack, OneUiTheme.shapes.tile)
    ) {
      Canvas(
        modifier = Modifier
          .fillMaxWidth()
          .height(height)
          .pointerInput(reference, chartWindow) {
            if (reference.isEmpty()) return@pointerInput
            detectTapGestures(
              onTap = { offset ->
                selectedIndex = resolveChartIndex(offset.x, size.width.toFloat(), reference, chartWindow)
              },
              // 双击回到「最新」：读完历史点后不必等下一次刷新
              onDoubleTap = { selectedIndex = -1 }
            )
          }
          .pointerInput(reference, chartWindow) {
            if (reference.isEmpty()) return@pointerInput
            // 只吃横向拖动：竖向滑动留给外层列表，长图表页面才不会「划不动」（交）
            detectHorizontalDragGestures(
              onDragStart = { offset ->
                selectedIndex = resolveChartIndex(offset.x, size.width.toFloat(), reference, chartWindow)
              },
              onHorizontalDrag = { change, _ ->
                selectedIndex = resolveChartIndex(change.position.x, size.width.toFloat(), reference, chartWindow)
                change.consume()
              }
            )
          }
      ) {
        val plotTop = 8.dp.toPx()
        val plotBottom = size.height - 6.dp.toPx()
        val plotHeight = (plotBottom - plotTop).coerceAtLeast(1f)
        val yFor: (Double) -> Float = { value -> plotBottom - axis.fraction(value).toFloat() * plotHeight }

        // 刻度线 + 刻度值：刻度值贴着网格线左上方，不额外占横向空间
        axis.ticks.forEach { tick ->
          val y = yFor(tick)
          drawLine(colors.chartGrid, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
          if (showAxis) {
            drawAxisLabel(textMeasurer, axisFormatter(tick), labelStyle, x = 6.dp.toPx(), baselineY = y, top = plotTop)
          }
        }

        thresholds.filter { it.value in axis.min..axis.max }.forEach { threshold ->
          val y = yFor(threshold.value)
          val color = if (threshold.tone == ChartThresholdTone.Critical) colors.critical else colors.warning
          drawLine(
            color = color.copy(alpha = 0.85f),
            start = Offset(0f, y),
            end = Offset(size.width, y),
            strokeWidth = 1.4.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))
          )
          if (showAxis) {
            val measured = textMeasurer.measure(threshold.label, labelStyle.copy(color = color, fontWeight = FontWeight.SemiBold))
            drawText(
              measured,
              topLeft = Offset(size.width - measured.size.width - 6.dp.toPx(), (y - measured.size.height - 2.dp.toPx()).coerceAtLeast(0f))
            )
          }
        }

        if (!hasData) return@Canvas
        val stroke = if (sortedSeries.size > 1) 2.2.dp.toPx() else 2.6.dp.toPx()
        clipRect(right = size.width * reveal.value) {
          sortedSeries.forEachIndexed { seriesPosition, item ->
            val lineColor = colors.seriesColor(item.colorIndex)
            splitSamplePointSegments(item.points, chartWindow).forEach { segment ->
              if (segment.isEmpty()) return@forEach
              val path = Path()
              val fillPath = Path()
              segment.forEachIndexed { index, point ->
                val x = chartWindow.xFor(point.timestamp, size.width)
                val y = yFor(point.value)
                if (index == 0) {
                  path.moveTo(x, y)
                  fillPath.moveTo(x, plotBottom)
                  fillPath.lineTo(x, y)
                } else {
                  path.lineTo(x, y)
                  fillPath.lineTo(x, y)
                }
              }
              if (segment.size == 1) {
                drawCircle(lineColor, radius = stroke, center = Offset(chartWindow.xFor(segment[0].timestamp, size.width), yFor(segment[0].value)))
              }
              fillPath.lineTo(chartWindow.xFor(segment.last().timestamp, size.width), plotBottom)
              fillPath.close()
              // 多序列只给第一条铺底色，叠在一起的半透明面会糊成一片
              if (seriesPosition == 0) {
                val alpha = if (sortedSeries.size > 1) 0.12f else 0.22f
                drawPath(fillPath, Brush.verticalGradient(listOf(lineColor.copy(alpha = alpha), lineColor.copy(alpha = 0f))))
              }
              drawPath(path, lineColor, style = Stroke(width = stroke, cap = StrokeCap.Round))
            }
          }
        }

        if (stale.active) {
          val sweepPhase = stale.phase.value
          val bandWidth = size.width * 0.38f
          val bandX = (size.width + bandWidth) * sweepPhase - bandWidth
          drawRect(
            brush = Brush.horizontalGradient(listOf(Color.Transparent, colors.chartSweep, Color.Transparent), startX = bandX, endX = bandX + bandWidth),
            topLeft = Offset(bandX, 0f),
            size = Size(bandWidth, size.height)
          )
        }

        // 准线与游标：十字线 + 每条序列一个空心点
        val cursor = cursorTimestamp ?: return@Canvas
        val x = chartWindow.xFor(cursor, size.width)
        drawLine(colors.chartCrosshair, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1.4f)
        sortedSeries.forEachIndexed { index, item ->
          val value = cursorValues[index] ?: return@forEachIndexed
          val y = yFor(value)
          val lineColor = colors.seriesColor(item.colorIndex)
          drawCircle(colors.group, radius = 6.dp.toPx(), center = Offset(x, y))
          drawCircle(lineColor, radius = 4.dp.toPx(), center = Offset(x, y), style = Stroke(width = 2.dp.toPx()))
        }
      }
    }

    if (hasData) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(top = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween
      ) {
        val middle = (chartWindow.startMillis + chartWindow.endMillis) / 2
        listOf(chartWindow.startMillis, middle, chartWindow.endMillis).forEach { millis ->
          OneUiText(
            text = formatChartTime(java.time.Instant.ofEpochMilli(millis).toString(), chartWindow.window),
            role = OneUiTextRole.ChartLabel,
            color = colors.textTertiary
          )
        }
      }
    } else {
      OneUiText(
        text = "该时间范围内暂无样本",
        role = OneUiTextRole.RowSubtitle,
        color = colors.textTertiary,
        modifier = Modifier.padding(top = 6.dp)
      )
    }
  }
}

/** 图上方的读数行：游标所在时间 + 每条序列的色标、名称与数值。 */
@Composable
private fun ChartReadout(
  timeLabel: String,
  series: List<ChartSeriesModel>,
  values: List<Double?>,
  valueFormatter: (Double?) -> String,
  live: Boolean
) {
  val colors = OneUiTheme.colors
  Row(
    modifier = Modifier.fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp)
  ) {
    OneUiText(
      text = if (live) "最新 · $timeLabel" else timeLabel,
      role = OneUiTextRole.ChartLabel,
      color = if (live) colors.textTertiary else colors.accent,
      weight = if (live) null else FontWeight.SemiBold,
      modifier = Modifier.weight(1f),
      maxLines = 1
    )
    series.forEachIndexed { index, item ->
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(
          modifier = Modifier
            .size(width = 10.dp, height = 3.dp)
            .background(colors.seriesColor(item.colorIndex), ChartSwatchShape)
        )
        if (series.size > 1) {
          OneUiText(text = item.label, role = OneUiTextRole.ChartLabel, color = colors.textSecondary, maxLines = 1)
        }
        OneUiText(
          text = valueFormatter(values.getOrNull(index)),
          role = OneUiTextRole.ChartLabel,
          color = colors.textPrimary,
          weight = FontWeight.SemiBold,
          maxLines = 1
        )
      }
    }
  }
}

private val ChartSwatchShape = RoundedCornerShape(2.dp)

private fun DrawScope.drawAxisLabel(
  measurer: TextMeasurer,
  text: String,
  style: TextStyle,
  x: Float,
  baselineY: Float,
  top: Float
) {
  val measured = measurer.measure(text, style)
  val y = (baselineY - measured.size.height - 1.dp.toPx()).coerceAtLeast(top - 6.dp.toPx()).coerceAtLeast(0f)
  drawText(measured, topLeft = Offset(x, y))
}

private fun nearestValue(points: List<SamplePointDto>, millis: Long?): Double? {
  if (points.isEmpty()) return null
  if (millis == null) return points.last().value
  return points.minByOrNull { kotlin.math.abs((parseTimestampMillis(it.timestamp) ?: 0L) - millis) }?.value
}

/** 序列摘要：让读屏用户获得与看图等价的信息（适）。 */
private fun seriesSummary(points: List<SamplePointDto>, formatter: (Double?) -> String): String {
  val stats = seriesStats(points) ?: return "无数据"
  return "当前 ${formatter(stats.latest)}，平均 ${formatter(stats.average)}，峰值 ${formatter(stats.peak)}，最低 ${formatter(stats.low)}"
}

/** 迷你趋势线：列表行内使用，不带坐标与交互，读数由所在行负责。 */
@Composable
internal fun OneUiSparkline(
  points: List<SamplePointDto>,
  chartWindow: ChartWindow,
  modifier: Modifier = Modifier,
  color: Color = OneUiTheme.colors.accent,
  fixedMaxValue: Double? = null,
  height: Dp = 30.dp
) {
  val colors = OneUiTheme.colors
  val sorted = remember(points) { points.sortedBy { parseTimestampMillis(it.timestamp) ?: Long.MIN_VALUE } }
  Canvas(modifier = modifier.height(height)) {
    val baseline = size.height - 1.dp.toPx()
    drawLine(colors.chartGrid, Offset(0f, baseline), Offset(size.width, baseline), strokeWidth = 1f)
    if (sorted.isEmpty()) return@Canvas
    val top = fixedMaxValue ?: max(sorted.maxOf { it.value } * 1.1, 1e-9)
    val stroke = 1.8.dp.toPx()
    val yFor: (Double) -> Float = { value ->
      (baseline - (value / top).toFloat().coerceIn(0f, 1f) * (baseline - stroke)).coerceIn(stroke / 2f, baseline)
    }
    splitSamplePointSegments(sorted, chartWindow).forEach { segment ->
      if (segment.isEmpty()) return@forEach
      val path = Path()
      val fill = Path()
      segment.forEachIndexed { index, point ->
        val x = chartWindow.xFor(point.timestamp, size.width)
        val y = yFor(point.value)
        if (index == 0) {
          path.moveTo(x, y); fill.moveTo(x, baseline); fill.lineTo(x, y)
        } else {
          path.lineTo(x, y); fill.lineTo(x, y)
        }
      }
      fill.lineTo(chartWindow.xFor(segment.last().timestamp, size.width), baseline)
      fill.close()
      drawPath(fill, Brush.verticalGradient(listOf(color.copy(alpha = 0.18f), color.copy(alpha = 0f))))
      drawPath(path, color, style = Stroke(width = stroke, cap = StrokeCap.Round))
    }
  }
}

/**
 * 图表卡（件）：标题 → 当前值（大字）+ 口径说明 → 图 → 区间均值/峰值。
 * 大数字永远是「当前」，口径写在它旁边，不再让读者猜这是均值还是最新值。
 */
@Immutable
internal data class ChartCardModel(
  val title: String,
  val series: List<ChartSeriesModel>,
  val valueFormatter: (Double?) -> String,
  val fixedMaxValue: Double? = null,
  /** 覆盖标题位读数（例如「12.3 GB / 32 GB」）；为空时取首条序列的最新值。 */
  val headline: String? = null,
  val headlineCaption: String = "当前",
  val thresholds: List<ChartThreshold> = emptyList(),
  val includeZero: Boolean = true,
  /** 读数的状态色：只在越过阈值时上色，平时保持中性，颜色才有信息量。 */
  val tone: OneUiPillTone = OneUiPillTone.Neutral,
  val note: String? = null,
  val axisFormatter: ((Double) -> String)? = null
)

@Composable
internal fun OneUiChartCard(
  card: ChartCardModel,
  chartWindow: ChartWindow,
  modifier: Modifier = Modifier,
  onClick: (() -> Unit)? = null,
  actionLabel: String = "详情"
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  val primary = card.series.firstOrNull()
  val primaryStats = remember(primary) { primary?.points?.let(::seriesStats) }
  val headline = card.headline ?: card.valueFormatter(primaryStats?.latest)
  val headlineColor = when (card.tone) {
    OneUiPillTone.Critical -> colors.criticalContent
    OneUiPillTone.Warning -> colors.warningContent
    else -> colors.textPrimary
  }

  Column(
    modifier = modifier
      .oneUiSurface(colors.group, shapes.card, colors = colors, level = OneUiSurfaceLevel.Group)
      .oneUiPressable(onClick = onClick, shape = shapes.card, minHeight = null)
      .padding(metrics.spaceM),
    verticalArrangement = Arrangement.spacedBy(metrics.spaceS)
  ) {
    Row(verticalAlignment = Alignment.Top) {
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        OneUiText(text = card.title, role = OneUiTextRole.RowSubtitle, color = colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          OneUiText(text = headline, role = OneUiTextRole.Metric, color = headlineColor, maxLines = 1, modifier = Modifier.oneUiStaleDim())
          OneUiText(
            text = card.headlineCaption,
            role = OneUiTextRole.ChartLabel,
            color = colors.textTertiary,
            modifier = Modifier.padding(bottom = 3.dp)
          )
        }
      }
      if (onClick != null) {
        OneUiText(text = "$actionLabel ›", role = OneUiTextRole.ChartLabel, color = colors.accent, weight = FontWeight.SemiBold)
      }
    }
    OneUiTrendChart(
      series = card.series,
      chartWindow = chartWindow,
      valueFormatter = card.valueFormatter,
      title = card.title,
      fixedMaxValue = card.fixedMaxValue,
      includeZero = card.includeZero,
      thresholds = card.thresholds,
      axisFormatter = card.axisFormatter ?: { compactAxisLabel(it, card.valueFormatter) },
      modifier = Modifier.fillMaxWidth()
    )
    ChartStatsRow(series = card.series, valueFormatter = card.valueFormatter)
    card.note?.let { OneUiText(text = it, role = OneUiTextRole.ChartLabel, color = colors.textTertiary) }
  }
}

/** 区间统计行：每条序列的均值与峰值（读者最常问的两个问题：平时多少、最高到过多少）。 */
@Composable
internal fun ChartStatsRow(series: List<ChartSeriesModel>, valueFormatter: (Double?) -> String) {
  val colors = OneUiTheme.colors
  val stats: List<Pair<ChartSeriesModel, SeriesStats>> = series.mapNotNull { item -> seriesStats(item.points)?.let { item to it } }
  if (stats.isEmpty()) return
  FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    stats.forEach { (item, value) ->
      val prefix = if (series.size > 1) "${item.label} " else ""
      StatChip(label = "${prefix}均值", value = valueFormatter(value.average), color = colors.textSecondary)
      StatChip(label = "${prefix}峰值", value = valueFormatter(value.peak), color = colors.textSecondary)
    }
  }
}

@Composable
private fun StatChip(label: String, value: String, color: Color) {
  val colors = OneUiTheme.colors
  Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
    OneUiText(text = label, role = OneUiTextRole.ChartLabel, color = colors.textTertiary, maxLines = 1)
    OneUiText(text = value, role = OneUiTextRole.ChartLabel, color = color, weight = FontWeight.SemiBold, maxLines = 1)
  }
}

/** 轴刻度要短：「50.0%」写成「50%」，「12.0 MB/s」写成「12 MB/s」。 */
internal fun compactAxisLabel(value: Double, formatter: (Double?) -> String): String =
  formatter(value).replace(Regex("""(\d)\.0(?=\D|$)"""), "$1")

@Composable
internal fun OneUiChartCardGrid(
  cards: List<ChartCardModel>,
  chartWindow: ChartWindow,
  modifier: Modifier = Modifier,
  onCardClick: ((Int) -> Unit)? = null
) {
  if (cards.isEmpty()) return
  val metrics = OneUiTheme.metrics
  BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
    val spacing = metrics.cardGap
    val columns = max(1, ((maxWidth + spacing) / (ChartCardMinWidth + spacing)).toInt())
    val cellWidth = (maxWidth - spacing * (columns - 1)) / columns
    FlowRow(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(spacing),
      verticalArrangement = Arrangement.spacedBy(spacing)
    ) {
      cards.forEachIndexed { index, card ->
        OneUiChartCard(
          card = card,
          chartWindow = chartWindow,
          onClick = onCardClick?.let { callback -> { callback(index) } },
          modifier = Modifier.width(cellWidth)
        )
      }
    }
  }
}

/* ---------- 兼容层：旧的单序列 MetricCardModel 走同一套新卡片 ---------- */

internal fun MetricCardModel.toChartCard(colorIndex: Int = 0): ChartCardModel = ChartCardModel(
  title = title,
  series = listOf(ChartSeriesModel(title, points, colorIndex)),
  valueFormatter = valueFormatter,
  fixedMaxValue = fixedMaxValue,
  headline = value
)

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
  includeZero: Boolean = true,
  thresholds: List<ChartThreshold> = emptyList()
) {
  OneUiTrendChart(
    series = listOf(ChartSeriesModel(title, points, seriesIndex)),
    chartWindow = chartWindow,
    valueFormatter = valueFormatter,
    title = title,
    modifier = modifier,
    fixedMaxValue = fixedMaxValue,
    includeZero = includeZero,
    thresholds = thresholds,
    height = height,
    axisFormatter = { compactAxisLabel(it, valueFormatter) }
  )
}

@Composable
internal fun OneUiMetricTileGrid(
  cards: List<MetricCardModel>,
  chartWindow: ChartWindow,
  modifier: Modifier = Modifier
) {
  OneUiChartCardGrid(
    cards = cards.map { it.toChartCard() },
    chartWindow = chartWindow,
    modifier = modifier
  )
}
