package com.dsc.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AttentionRulesTest {
  private val now = java.time.Instant.parse("2026-10-18T08:00:00Z").toEpochMilli()

  private fun device(
    id: String = "d1",
    status: String = "online",
    cpu: Double? = 10.0,
    memory: Double? = 30.0,
    disk: Double? = 40.0,
    lastSeen: String? = "2026-10-18T07:59:50Z"
  ) = DeviceSummaryDto(
    deviceId = id,
    hostname = "host-$id",
    os = "linux",
    status = status,
    lastSeenAt = lastSeen,
    cpuUsagePercent = cpu,
    memoryUsagePercent = memory,
    diskUsagePercent = disk
  )

  @Test
  fun healthyDeviceRaisesNothing() {
    assertTrue(summaryAttention(device(), now).isEmpty())
  }

  @Test
  fun offlineDeviceOnlyReportsOffline() {
    val items = summaryAttention(device(status = "offline", cpu = 99.0), now)
    assertEquals(1, items.size)
    assertEquals(AttentionSeverity.Offline, items.single().severity)
    assertTrue(items.single().detail.contains("10 秒前"))
  }

  @Test
  fun thresholdsSplitWarningFromCritical() {
    val items = summaryAttention(device(cpu = 90.0, memory = 97.0, disk = 50.0), now)
    assertEquals(AttentionSeverity.Warning, items.first { it.block == DeviceBlockKey.Cpu }.severity)
    assertEquals(AttentionSeverity.Critical, items.first { it.block == DeviceBlockKey.Memory }.severity)
    assertTrue(items.none { it.block == DeviceBlockKey.Disk })
  }

  @Test
  fun silentReportingIsFlaggedEvenWhenStatusSaysOnline() {
    val items = summaryAttention(device(lastSeen = "2026-10-18T07:50:00Z"), now)
    assertTrue(items.any { it.title == "上报中断" })
  }

  @Test
  fun collectOrdersBySeverityThenDeviceOrderAndDeduplicates() {
    val devices = listOf(
      device(id = "a", cpu = 88.0),
      device(id = "b", status = "offline"),
      device(id = "c", memory = 99.0)
    )
    val items = collectAttention(devices, emptyMap(), now)
    assertEquals(listOf(AttentionSeverity.Critical, AttentionSeverity.Warning, AttentionSeverity.Offline), items.map { it.severity })
    assertEquals(items.size, items.map { it.key }.distinct().size)
  }

  @Test
  fun sensorTemperatureUsesOwnLimitsWhenSane() {
    val metrics = MetricsDto(
      status = "online",
      device = DeviceDetailDto(deviceId = "d1", hostname = "h", os = "linux", platform = "linux", arch = "x64", status = "online"),
      latest = DeviceLatestDto(
        temperatureSensors = listOf(
          TemperatureSensorDto(id = "s1", source = "hwmon", rawName = "Package", role = "cpu_package", currentC = 72.0, highC = 70.0, criticalC = 90.0, status = "valid", confidence = "direct"),
          TemperatureSensorDto(id = "s2", source = "hwmon", rawName = "Bogus", role = "cpu_core", currentC = 60.0, highC = 0.0, status = "valid", confidence = "direct"),
          TemperatureSensorDto(id = "s3", source = "hwmon", rawName = "Invalid", role = "cpu_core", currentC = 200.0, status = "invalid", confidence = "direct")
        ),
        disks = listOf(DiskDto(id = "sda", name = "sda", mountPoint = "/", healthStatus = "bad", totalBytes = 1, usedBytes = 0))
      ),
      series = DeviceMetricSeriesDto()
    )
    val items = metricsAttention(metrics)
    assertEquals(AttentionSeverity.Warning, items.first { it.key.endsWith("temp:s1") }.severity)
    assertTrue("高温阈值报成 0 的传感器不能被当成过热", items.none { it.key.endsWith("temp:s2") })
    assertTrue("无效通道不参与判定", items.none { it.key.endsWith("temp:s3") })
    assertEquals(AttentionSeverity.Critical, items.first { it.block == DeviceBlockKey.Disk }.severity)
  }

  @Test
  fun relativeAgeReadsNaturally() {
    assertEquals("刚刚", relativeAge(1_000))
    assertEquals("30 秒前", relativeAge(30_000))
    assertEquals("5 分钟前", relativeAge(5 * 60_000L))
    assertEquals("2 天前", relativeAge(2 * 86_400_000L))
  }
}
