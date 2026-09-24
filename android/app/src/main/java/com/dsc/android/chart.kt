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
