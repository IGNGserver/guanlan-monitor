package com.dsc.android

import org.junit.Assert.assertEquals
import org.junit.Test

class ChartWindowTest {
  @Test
  fun mapsSamplesToTheRequestedTimeRange() {
    val window = ChartWindow.from(
      window = MetricWindow.FiveMinutes,
      rangeStart = "2026-08-22T00:00:00Z",
      rangeEnd = "2026-08-22T00:05:00Z"
    )

    assertEquals(0f, window.xFor("2026-08-22T00:00:00Z", 100f), 0.001f)
    assertEquals(50f, window.xFor("2026-08-22T00:02:30Z", 100f), 0.001f)
    assertEquals(100f, window.xFor("2026-08-22T00:05:00Z", 100f), 0.001f)
  }

  @Test
  fun separatesSegmentsWhenSamplesHaveAGap() {
    val window = ChartWindow.from(
      window = MetricWindow.OneMinute,
      rangeStart = "2026-08-22T00:00:00Z",
      rangeEnd = "2026-08-22T00:01:00Z"
    )
    val points = listOf(
      SamplePointDto("2026-08-22T00:00:00Z", 10.0),
      SamplePointDto("2026-08-22T00:00:01Z", 11.0),
      SamplePointDto("2026-08-22T00:00:02Z", 12.0),
      SamplePointDto("2026-08-22T00:00:05Z", 13.0)
    )

    val segments = splitSamplePointSegments(points, window)

    assertEquals(listOf(3, 1), segments.map { it.size })
  }
}
