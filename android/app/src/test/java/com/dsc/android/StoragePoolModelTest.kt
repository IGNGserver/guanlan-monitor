package com.dsc.android

import com.dsc.android.ui.oneui.blockMetricKeys
import com.dsc.android.ui.oneui.metricLabel
import com.dsc.android.ui.oneui.storagePoolContentLabel
import com.dsc.android.ui.oneui.storagePoolKindLabel
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 存储池（承载虚拟机的整块分区）在 Android 客户端的契约。
 *
 * 采集端与 Hub 早已上报 `storagePools`，但客户端此前不认识它；这组用例锁住
 * 「服务端负载能解出来」「存储池有独立的类别与指标键」「禁用存储不显示占用」。
 */
class StoragePoolModelTest {
  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
  }

  @Test
  fun metricsPayloadCarriesStoragePools() {
    val payload = """
      {
        "status": "online",
        "window": "5m",
        "device": {
          "deviceId": "pve1",
          "hostname": "PVE1",
          "os": "linux",
          "platform": "debian",
          "arch": "amd64",
          "status": "online"
        },
        "latest": {
          "storagePools": [
            {
              "id": "proxmox:pve1/local-lvm",
              "name": "local-lvm",
              "kind": "lvmthin",
              "source": "proxmox",
              "node": "pve1",
              "device": "/dev/mapper/pve-data",
              "volumeGroup": "pve",
              "thinPool": "data",
              "physicalDevices": ["nvme0n1"],
              "content": ["images", "rootdir"],
              "active": true,
              "enabled": true,
              "shared": false,
              "totalBytes": 865763065856,
              "usedBytes": 824119862388,
              "availableBytes": 41643203468
            },
            {
              "id": "proxmox:pve1/pve3-hdd",
              "name": "pve3-hdd",
              "kind": "lvmthin",
              "active": false,
              "enabled": false,
              "totalBytes": 0,
              "usedBytes": 0
            }
          ]
        },
        "series": {
          "storagePools": [
            {
              "id": "proxmox:pve1/local-lvm",
              "name": "local-lvm",
              "kind": "lvmthin",
              "node": "pve1",
              "active": true,
              "shared": false,
              "totalBytes": [{"timestamp": "2026-10-14T12:00:00Z", "value": 865763065856}],
              "usedBytes": [{"timestamp": "2026-10-14T12:00:00Z", "value": 824119862388}],
              "availableBytes": [{"timestamp": "2026-10-14T12:00:00Z", "value": 41643203468}],
              "usagePercent": [{"timestamp": "2026-10-14T12:00:00Z", "value": 95.18}]
            }
          ]
        }
      }
    """.trimIndent()

    val metrics = json.decodeFromString<MetricsDto>(payload)
    assertEquals(2, metrics.latest.storagePools.size)

    val pool = metrics.latest.storagePools.first()
    assertEquals("local-lvm", pool.name)
    assertEquals("lvmthin", pool.kind)
    assertEquals("pve", pool.volumeGroup)
    assertEquals("data", pool.thinPool)
    assertEquals(listOf("nvme0n1"), pool.physicalDevices)
    assertEquals(listOf("images", "rootdir"), pool.content)
    assertEquals(865763065856L, pool.totalBytes)

    val disabled = metrics.latest.storagePools[1]
    assertEquals(false, disabled.active)
    assertEquals(0L, disabled.totalBytes)

    val series = metrics.series.storagePools.single()
    assertEquals(1, series.usagePercent.size)
    assertEquals(95.18, series.usagePercent.single().value, 0.001)
  }

  @Test
  fun storageBlockOwnsTheStoragePoolsMetric() {
    assertEquals(listOf("storagePools"), blockMetricKeys(DeviceBlockKey.Storage))
    assertEquals("存储池", metricLabel("storagePools"))
    assertEquals("存储池", DeviceBlockKey.Storage.label)
    assertEquals("storage", DeviceBlockKey.Storage.value)
  }

  @Test
  fun storageLabelsCoverCollectorKinds() {
    assertEquals("LVM 精简池", storagePoolKindLabel("lvmthin"))
    assertEquals("NFS 共享", storagePoolKindLabel("nfs"))
    assertEquals("ZFS 池", storagePoolKindLabel("zfs"))
    assertEquals("存储池", storagePoolKindLabel("invented-kind"))
    assertEquals("虚拟机磁盘", storagePoolContentLabel("images"))
    assertEquals("备份", storagePoolContentLabel("backup"))
    assertEquals("custom", storagePoolContentLabel("custom"))
  }

  @Test
  fun oldPayloadsWithoutStoragePoolsStillDecode() {
    val payload = """
      {
        "status": "online",
        "device": {"deviceId": "win-1", "hostname": "WIN1", "os": "windows", "platform": "windows", "arch": "amd64", "status": "online"},
        "latest": {},
        "series": {}
      }
    """.trimIndent()

    val metrics = json.decodeFromString<MetricsDto>(payload)
    assertTrue(metrics.latest.storagePools.isEmpty())
    assertTrue(metrics.series.storagePools.isEmpty())
    assertFalse(metrics.latest.disks.isNotEmpty())
  }
}
