package com.dsc.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChartAxisTest {
  @Test
  fun percentAxisIsFixedFromZeroToHundred() {
    val axis = niceAxis(dataMin = 3.0, dataMax = 41.0, fixedMax = 100.0)
    assertEquals(0.0, axis.min, 0.0)
    assertEquals(100.0, axis.max, 0.0)
    assertEquals(listOf(0.0, 50.0, 100.0), axis.ticks)
  }

  @Test
  fun freeAxisRoundsUpToReadableSteps() {
    val axis = niceAxis(dataMin = 0.0, dataMax = 7_340_000.0)
    assertEquals(0.0, axis.min, 0.0)
    assertTrue("上界必须盖住数据：${axis.max}", axis.max >= 7_340_000.0)
    // 步长只能是 1/2/2.5/5×10ⁿ
    val step = axis.ticks[1] - axis.ticks[0]
    val mantissa = step / Math.pow(10.0, kotlin.math.floor(kotlin.math.log10(step)))
    assertTrue("步长 $step 不是整齐值", listOf(1.0, 2.0, 2.5, 5.0).any { kotlin.math.abs(it - mantissa) < 1e-9 })
  }

  @Test
  fun temperatureAxisNeedNotStartAtZero() {
    val axis = niceAxis(dataMin = 41.0, dataMax = 58.0, includeZero = false)
    assertTrue(axis.min > 0.0)
    assertTrue(axis.min <= 41.0 && axis.max >= 58.0)
  }

  @Test
  fun flatSeriesStillGetsAPositiveSpan() {
    val axis = niceAxis(dataMin = 0.0, dataMax = 0.0)
    assertTrue(axis.max > axis.min)
    assertEquals(0.5, axis.fraction((axis.min + axis.max) / 2), 1e-9)
  }

  @Test
  fun statsSeparateLatestFromAverageAndPeak() {
    val stats = seriesStats(
      listOf(
        SamplePointDto("2026-10-18T00:00:00Z", 10.0),
        SamplePointDto("2026-10-18T00:02:00Z", 100.0),
        SamplePointDto("2026-10-18T00:01:00Z", 4.0)
      )
    )!!
    assertEquals("当前值取时间最新的点，而不是列表最后一个", 100.0, stats.latest, 0.0)
    assertEquals(38.0, stats.average, 1e-9)
    assertEquals(100.0, stats.peak, 0.0)
    assertEquals(4.0, stats.low, 0.0)
    assertNull(seriesStats(emptyList()))
  }
}
