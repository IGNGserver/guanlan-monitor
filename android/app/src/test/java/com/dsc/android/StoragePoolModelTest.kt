package com.dsc.android

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StoragePoolModelTest {
  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
  }

  @Test
  fun decodesCurrentAndHistoricalStoragePoolsFromMetricsPayload() {
    val latest = json.decodeFromString<DeviceLatestDto>(
      """{"storagePools":[{"id":"pve3:pve-ssd","name":"pve-ssd","node":"pve3","type":"lvmthin","active":true,"totalBytes":1000,"usedBytes":400,"availableBytes":600}]}"""
    )
    val series = json.decodeFromString<DeviceMetricSeriesDto>(
      """{"storagePools":[{"id":"pve3:pve-ssd","name":"pve-ssd","node":"pve3","totalBytes":[{"timestamp":"2026-08-24T00:00:00Z","value":1000.0}],"usedBytes":[{"timestamp":"2026-08-24T00:00:00Z","value":400.0}],"availableBytes":[{"timestamp":"2026-08-24T00:00:00Z","value":600.0}],"usagePercent":[{"timestamp":"2026-08-24T00:00:00Z","value":40.0}]}]}"""
    )
    val metrics = MetricsDto(
      status = "online",
      device = DeviceDetailDto("device-1", "pve3", "linux", "proxmox", "x86_64"),
      latest = latest,
      series = series
    )

    val pools = displayableVirtualizationStoragePools(metrics)

    assertEquals(1, pools.size)
    assertEquals("pve3:pve-ssd", pools.single().id)
    assertEquals(400L, pools.single().latest?.usedBytes)
    assertEquals(40.0, pools.single().series?.usagePercent?.single()?.value ?: 0.0, 0.001)
  }

  @Test
  fun hidesInactiveOrCapacitylessPools() {
    val metrics = MetricsDto(
      status = "online",
      device = DeviceDetailDto("device-1", "pve1", "linux", "proxmox", "x86_64"),
      latest = DeviceLatestDto(
        storagePools = listOf(
          VirtualizationStorageDto("pve1:pve-ssd", "pve-ssd", node = "pve3", active = false),
          VirtualizationStorageDto("pve1:nas-pve", "NAS-PVE", active = true)
        )
      ),
      series = DeviceMetricSeriesDto()
    )

    val pools = displayableVirtualizationStoragePools(metrics)

    assertTrue(pools.isEmpty())
    assertFalse(isDisplayableVirtualizationStorage(metrics.latest.storagePools[0]))
    assertFalse(isDisplayableVirtualizationStorage(metrics.latest.storagePools[1]))
  }
}
