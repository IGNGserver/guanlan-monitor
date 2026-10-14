package com.dsc.android

import com.dsc.android.ui.oneui.displayWindowFor
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

  @Test
  fun keepsTheSnapshotWindowWhileAVisibleLoadRuns() {
    // 可见加载中：屏上旧快照按自己的粒度渲染，避免把旧样本塞进新时间窗（交）
    assertEquals(MetricWindow.FiveMinutes, displayWindowFor("5m", MetricWindow.OneHour, loading = true))
    // 加载结束后回到请求的粒度
    assertEquals(MetricWindow.OneHour, displayWindowFor("5m", MetricWindow.OneHour, loading = false))
    // 快照粒度缺失或未知时回落请求粒度
    assertEquals(MetricWindow.OneHour, displayWindowFor(null, MetricWindow.OneHour, loading = true))
    assertEquals(MetricWindow.OneHour, displayWindowFor("nope", MetricWindow.OneHour, loading = true))
  }

  @Test
  fun mapsServerWindowValues() {
    MetricWindow.entries.forEach { window ->
      assertEquals(window, MetricWindow.fromValue(window.value))
    }
    assertEquals(null, MetricWindow.fromValue("30s"))
    assertEquals(null, MetricWindow.fromValue(null))
  }
}
