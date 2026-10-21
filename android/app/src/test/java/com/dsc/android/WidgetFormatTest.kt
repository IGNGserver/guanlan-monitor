package com.dsc.android

import com.dsc.android.widget.WidgetDestination
import com.dsc.android.widget.WidgetFormat
import com.dsc.android.widget.WidgetSnapshotMapper
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class WidgetFormatTest {
  @Test
  fun bytesKeepOneDecimalBelowHundred() {
    assertEquals("1.5" to "KB", WidgetFormat.byteParts(1536.0))
    assertEquals("42.7" to "GB", WidgetFormat.byteParts(42.7 * 1024 * 1024 * 1024))
    assertEquals("0" to "B", WidgetFormat.byteParts(0.0))
    assertEquals("0 B/s", WidgetFormat.speed(null))
  }

  @Test
  fun percentagesRoundAndKeepMissingReadable() {
    assertEquals("42%", WidgetFormat.percent(42.4))
    assertEquals("90%", WidgetFormat.percent(89.6))
    assertEquals("—", WidgetFormat.percent(null))
  }

  @Test
  fun relativeLabelsStayHuman() {
    val now = Instant.parse("2026-10-21T12:10:00Z").toEpochMilli()
    assertEquals("10 分钟前", WidgetFormat.lastSeen("2026-10-21T12:00:00Z", now))
    assertEquals("刚刚", WidgetFormat.lastSeen("2026-10-21T12:10:00Z", now))
    assertEquals("5 分钟前", WidgetSnapshotMapper.updatedLabel(now - 5 * 60_000L, now))
    assertEquals("尚未同步", WidgetSnapshotMapper.updatedLabel(0L, now))
  }

  @Test
  fun widgetDestinationsRejectIncompleteTargets() {
    assertEquals(WidgetDestination.TARGET_FLEET, WidgetDestination.from("fleet", null)?.target)
    assertEquals("device-1", WidgetDestination.from("device", "device-1")?.deviceId)
    assertNull(WidgetDestination.from("device", null))
    assertNull(WidgetDestination.from("unknown", "device-1"))
    assertNotNull(WidgetDestination.from("traffic", "device-1"))
  }
}
