package com.dsc.android

import com.dsc.android.widget.WidgetSnapshotMapper
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetSnapshotMapperTest {
  @Test
  fun devicesFollowServerSortOrderThenHostname() {
    val mapped = WidgetSnapshotMapper.devices(
      listOf(
        DeviceSummaryDto(deviceId = "b", hostname = "beta", os = "linux", status = "online", sortOrder = 2),
        DeviceSummaryDto(deviceId = "a", hostname = "zeta", os = "linux", status = "offline", sortOrder = 1),
        DeviceSummaryDto(deviceId = "c", hostname = "alpha", os = "windows", status = "online", sortOrder = 1)
      )
    )
    assertEquals(listOf("c", "a", "b"), mapped.map { it.id })
    assertFalse(mapped.first { it.id == "a" }.online)
  }

  @Test
  fun downsampleKeepsEndpointsAndBudget() {
    val points = (0 until 100).map { index ->
      SamplePointDto(timestamp = "2026-10-21T12:00:00Z", value = index.toDouble())
    }
    val sampled = WidgetSnapshotMapper.downsample(points, maxPoints = 40)
    assertEquals(40, sampled.size)
    assertEquals(0f, sampled.first())
    assertEquals(99f, sampled.last())
    assertTrue(sampled.zipWithNext().all { (left, right) -> left <= right })
  }

  @Test
  fun trafficUsesPrimaryMonthCellsAndMarksFuture() {
    val now = Instant.parse("2026-10-21T04:00:00Z")
    val calendar = TrafficCalendarDto(
      mode = "day",
      anchor = "2026-10-21T08:00:00+08:00",
      title = "2026 年 10 月",
      rangeStart = "2026-10-21T00:00:00+08:00",
      rangeEnd = "2026-10-22T00:00:00+08:00",
      totalRxBytes = 42.7,
      totalTxBytes = 3.1,
      cells = listOf(
        cell("20", "2026-10-20T00:00:00+08:00", rx = 10.0, tx = 1.0),
        cell("21", "2026-10-21T00:00:00+08:00", rx = 42.7, tx = 3.1, today = true),
        cell("22", "2026-10-22T00:00:00+08:00", rx = 0.0, tx = 0.0)
      )
    )

    val mapped = WidgetSnapshotMapper.traffic(calendar, now)
    assertEquals(42.7, mapped.todayRxBytes, 0.001)
    assertEquals(56.8, mapped.monthRxBytes + mapped.monthTxBytes, 0.001)
    assertEquals("10 月", mapped.monthLabel)
    assertEquals("10 月 21 日", mapped.todayLabel)
    assertEquals(3, mapped.days.size)
    assertTrue(mapped.days[1].isToday)
    assertTrue(mapped.days[2].isFuture)
    assertFalse(mapped.days[0].isFuture)
  }

  private fun cell(
    label: String,
    start: String,
    rx: Double,
    tx: Double,
    today: Boolean = false
  ) = TrafficCalendarCellDto(
    key = start,
    label = label,
    rangeStart = start,
    rangeEnd = start,
    totalRxBytes = rx,
    totalTxBytes = tx,
    isSelected = today,
    isCurrentPeriod = today,
    isInPrimaryScope = true
  )
}
