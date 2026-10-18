package com.dsc.android

import java.time.Instant
import kotlin.math.abs
import kotlin.math.max

internal data class ChartWindow(
  val window: MetricWindow,
  val startMillis: Long,
  val endMillis: Long
) {
  init {
    require(endMillis > startMillis) { "chart window must have a positive duration" }
  }

  fun xFor(timestamp: String, width: Float): Float {
    if (width <= 0f) return 0f
    val timestampMillis = parseTimestampMillis(timestamp) ?: startMillis
    val ratio = ((timestampMillis - startMillis).toDouble() / (endMillis - startMillis).toDouble())
      .coerceIn(0.0, 1.0)
    return (ratio * width).toFloat()
  }

  companion object {
    fun from(
      window: MetricWindow,
      rangeStart: String? = null,
      rangeEnd: String? = null,
      nowMillis: Long = System.currentTimeMillis()
    ): ChartWindow {
      val parsedStart = rangeStart?.let(::parseTimestampMillis)
      val parsedEnd = rangeEnd?.let(::parseTimestampMillis)
      if (parsedStart != null && parsedEnd != null && parsedEnd > parsedStart) {
        return ChartWindow(window, parsedStart, parsedEnd)
      }
      val end = nowMillis
      return ChartWindow(window, end - window.durationMillis(), end)
    }
  }
}

internal fun MetricWindow.durationMillis(): Long = when (this) {
  MetricWindow.OneMinute -> 60_000L
  MetricWindow.FiveMinutes -> 5 * 60_000L
  MetricWindow.OneHour -> 60 * 60_000L
  MetricWindow.SixHours -> 6 * 60 * 60_000L
  MetricWindow.OneDay -> 24 * 60 * 60_000L
  MetricWindow.SevenDays -> 7 * 24 * 60 * 60_000L
}

internal fun parseTimestampMillis(value: String): Long? = runCatching {
  Instant.parse(value).toEpochMilli()
}.getOrNull()

internal fun resolveChartIndex(
  x: Float,
  width: Float,
  points: List<SamplePointDto>,
  chartWindow: ChartWindow
): Int {
  if (points.size <= 1 || width <= 0f) return 0
  var nearestIndex = 0
  var nearestDistance = Float.MAX_VALUE
  points.forEachIndexed { index, point ->
    val distance = abs(chartWindow.xFor(point.timestamp, width) - x)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }
  return nearestIndex
}

internal fun splitSamplePointSegments(
  points: List<SamplePointDto>,
  chartWindow: ChartWindow
): List<List<SamplePointDto>> {
  val sorted = points
    .sortedBy { parseTimestampMillis(it.timestamp) ?: Long.MIN_VALUE }
  if (sorted.isEmpty()) return emptyList()
  if (sorted.size == 1) return listOf(sorted)

  val deltas = sorted.zipWithNext()
    .mapNotNull { (left, right) ->
      val leftMillis = parseTimestampMillis(left.timestamp)
      val rightMillis = parseTimestampMillis(right.timestamp)
      if (leftMillis == null || rightMillis == null || rightMillis <= leftMillis) null else rightMillis - leftMillis
    }
  val medianDelta = deltas.sorted().getOrNull(deltas.size / 2) ?: chartWindow.window.durationMillis()
  val expectedBucket = when (chartWindow.window) {
    MetricWindow.OneHour, MetricWindow.SixHours, MetricWindow.OneDay -> 60_000L
    MetricWindow.SevenDays -> 60 * 60_000L
    MetricWindow.OneMinute, MetricWindow.FiveMinutes -> medianDelta
  }
  val gapThreshold = max(expectedBucket * 2L, 1_000L)

  val segments = mutableListOf<MutableList<SamplePointDto>>()
  var current = mutableListOf(sorted.first())
  sorted.zipWithNext().forEach { (left, right) ->
    val leftMillis = parseTimestampMillis(left.timestamp)
    val rightMillis = parseTimestampMillis(right.timestamp)
    val gap = leftMillis != null && rightMillis != null && rightMillis - leftMillis >= gapThreshold
    if (gap) {
      segments += current
      current = mutableListOf(right)
    } else {
      current += right
    }
  }
  segments += current
  return segments
}

/**
 * 纵轴刻度：图表必须能直接读出量级，所以刻度取 1/2/2.5/5×10ⁿ 的整齐值，
 * 而不是把数据最大值原样写在轴上。
 */
internal data class ChartAxis(val min: Double, val max: Double, val ticks: List<Double>) {
  val span: Double get() = (max - min).takeIf { it > 0.0 } ?: 1.0
  fun fraction(value: Double): Double = ((value - min) / span).coerceIn(0.0, 1.0)
}

internal fun niceAxis(
  dataMin: Double,
  dataMax: Double,
  fixedMax: Double? = null,
  includeZero: Boolean = true,
  tickCount: Int = 3,
  /** 字节类数值按 1024 进位显示，刻度也要按 1024 的整倍取，否则会出现「47.7 MB/s」这种刻度。 */
  binary: Boolean = false
): ChartAxis {
  if (binary && fixedMax == null) {
    val magnitude = maxOf(kotlin.math.abs(dataMax), kotlin.math.abs(dataMin))
    var scale = 1.0
    while (magnitude / scale >= 1024.0) scale *= 1024.0
    val scaled = niceAxis(dataMin / scale, dataMax / scale, null, includeZero, tickCount, binary = false)
    return ChartAxis(scaled.min * scale, scaled.max * scale, scaled.ticks.map { it * scale })
  }
  if (fixedMax != null) {
    val step = fixedMax / (tickCount - 1).coerceAtLeast(1)
    return ChartAxis(0.0, fixedMax, List(tickCount) { it * step })
  }
  val low = if (includeZero) minOf(0.0, dataMin) else dataMin
  val high = if (dataMax > low) dataMax else low + 1.0
  val rawStep = (high - low) / (tickCount - 1).coerceAtLeast(1)
  val step = niceStep(rawStep)
  val start = if (includeZero && low >= 0.0) 0.0 else kotlin.math.floor(low / step) * step
  var end = kotlin.math.ceil(high / step) * step
  if (end <= start) end = start + step
  val ticks = buildList {
    var tick = start
    while (tick <= end + step * 1e-6) {
      add(tick)
      tick += step
    }
  }
  return ChartAxis(start, end, ticks)
}

private fun niceStep(raw: Double): Double {
  if (raw <= 0.0 || !raw.isFinite()) return 1.0
  val exponent = kotlin.math.floor(kotlin.math.log10(raw))
  val base = Math.pow(10.0, exponent)
  val fraction = raw / base
  val nice = when {
    fraction <= 1.0 -> 1.0
    fraction <= 2.0 -> 2.0
    fraction <= 2.5 -> 2.5
    fraction <= 5.0 -> 5.0
    else -> 10.0
  }
  return nice * base
}

/**
 * 区间统计：标题位的大数字是「当前」，区间均值和峰值放在图下，
 * 均值单独做标题会把尖峰抹平（24 小时均值 8% 的机器可能每小时都打满过）。
 */
internal data class SeriesStats(
  val latest: Double,
  val average: Double,
  val peak: Double,
  val low: Double,
  val count: Int
)

internal fun seriesStats(points: List<SamplePointDto>): SeriesStats? {
  val values = points.map { it.value }.filter { it.isFinite() }
  if (values.isEmpty()) return null
  val latest = points
    .filter { it.value.isFinite() }
    .maxByOrNull { parseTimestampMillis(it.timestamp) ?: Long.MIN_VALUE }
    ?.value ?: values.last()
  return SeriesStats(
    latest = latest,
    average = values.average(),
    peak = values.max(),
    low = values.min(),
    count = values.size
  )
}

/** 把一组按时间对齐的点换算成百分比（用于把「已用字节」配合总量画成占用率）。 */
internal fun percentOf(points: List<SamplePointDto>, total: Double): List<SamplePointDto> =
  if (total <= 0.0) emptyList() else points.map { SamplePointDto(it.timestamp, it.value / total * 100.0) }
