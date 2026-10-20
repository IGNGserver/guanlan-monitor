package com.dsc.android

import org.junit.Assert.assertEquals
import org.junit.Test

class LoadingPerformanceTest {
  @Test fun milestonesAreBoundedAndUseMonotonicElapsedTime() {
    var time = 10L
    val events = mutableListOf<Pair<String, Long>>()
    val timing = LoadingPerformance(now = { time }, publish = { name, elapsed -> events.add(name to elapsed) })
    time = 25L
    repeat(100) { timing.mark(LoadingMilestone.Summary) }
    time = 30L
    timing.mark(LoadingMilestone.Charts)
    assertEquals(listOf("hub-summary-committed" to 15L, "hub-charts-committed" to 20L), events)
  }
}
