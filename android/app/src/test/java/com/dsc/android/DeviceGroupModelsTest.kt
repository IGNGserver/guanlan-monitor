package com.dsc.android

import com.dsc.android.ui.oneui.OneUiPillTone
import com.dsc.android.ui.screens.DeviceSortMode
import com.dsc.android.ui.screens.GROUP_KEY_UNGROUPED
import com.dsc.android.ui.screens.GroupComparisonMetric
import com.dsc.android.ui.screens.buildDeviceGroupSections
import com.dsc.android.ui.screens.buildGroupComparisonChart
import com.dsc.android.ui.screens.computeGroupMembershipDiff
import com.dsc.android.ui.screens.isReservedGroupName
import com.dsc.android.ui.screens.mergeDeviceOrderDraft
import com.dsc.android.ui.screens.moveDeviceGroupOrder
import com.dsc.android.ui.screens.moveDeviceOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceGroupModelsTest {
  private val devices = listOf(
    DeviceSummaryDto(
      deviceId = "pve1",
      hostname = "pve-node-1",
      os = "linux",
      status = "online",
      cpuUsagePercent = 30.0,
      memoryUsagePercent = 50.0,
      memoryUsedBytes = 32_000_000_000L,
      memoryTotalBytes = 64_000_000_000L,
      diskUsagePercent = 40.0,
      diskUsedBytes = 1_000_000_000_000L,
      diskTotalBytes = 2_000_000_000_000L,
      sortOrder = 0,
      group = "宿主机"
    ),
    DeviceSummaryDto(
      deviceId = "pve2",
      hostname = "pve-node-2",
      os = "linux",
      status = "online",
      cpuUsagePercent = 70.0,
      memoryUsagePercent = 75.0,
      memoryUsedBytes = 96_000_000_000L,
      memoryTotalBytes = 128_000_000_000L,
      diskUsagePercent = 80.0,
      diskUsedBytes = 3_000_000_000_000L,
      diskTotalBytes = 4_000_000_000_000L,
      sortOrder = 1,
      group = "宿主机"
    ),
    DeviceSummaryDto(
      deviceId = "ws1",
      hostname = "dev-ws",
      os = "windows",
      status = "offline",
      sortOrder = 2,
      group = "开发设备"
    ),
    DeviceSummaryDto(
      deviceId = "pi",
      hostname = "garage-pi",
      os = "linux",
      status = "online",
      cpuUsagePercent = 12.0,
      sortOrder = 3,
      group = null
    )
  )

  @Test
  fun pooledGroupMetricsAggregateCapacityAndPreserveWithinGroupSorting() {
    val overview = mapOf(
      "pve1" to OverviewInstanceSeriesDto(
        deviceId = "pve1",
        hostname = "pve-node-1",
        cpuUsagePercent = listOf(SamplePointDto("2026-11-18T10:00:00Z", 20.0), SamplePointDto("2026-11-18T10:00:30Z", 40.0)),
        networkRxBytesPerSec = listOf(SamplePointDto("2026-11-18T10:00:30Z", 1_500_000.0)),
        networkTxBytesPerSec = listOf(SamplePointDto("2026-11-18T10:00:30Z", 500_000.0))
      ),
      "pve2" to OverviewInstanceSeriesDto(
        deviceId = "pve2",
        hostname = "pve-node-2",
        cpuUsagePercent = listOf(SamplePointDto("2026-11-18T10:00:00Z", 60.0), SamplePointDto("2026-11-18T10:00:30Z", 80.0)),
        networkRxBytesPerSec = listOf(SamplePointDto("2026-11-18T10:00:30Z", 2_500_000.0)),
        networkTxBytesPerSec = listOf(SamplePointDto("2026-11-18T10:00:30Z", 1_000_000.0))
      )
    )

    val sections = buildDeviceGroupSections(
      devices = devices,
      issuesByDevice = emptyMap(),
      overviewById = overview,
      withinGroupSort = DeviceSortMode.Cpu
    )

    assertEquals(listOf("宿主机", "开发设备", GROUP_KEY_UNGROUPED), sections.map { it.key })
    val hosts = sections.first()
    // 组内按 CPU 降序排列，pve2 排在 pve1 前，但分组本身顺序不变
    assertEquals(listOf("pve2", "pve1"), hosts.devices.map { it.deviceId })
    assertEquals(50.0, hosts.avgCpuPercent!!, 0.01)
    assertEquals("pve-node-2", hosts.peakCpuHostname)
    assertEquals(128_000_000_000L, hosts.memoryUsedBytes)
    assertEquals(192_000_000_000L, hosts.memoryTotalBytes)
    assertEquals(66.66, hosts.pooledMemoryPercent!!, 0.1)
    assertEquals(4_000_000.0, hosts.totalRxBytesPerSec!!, 0.1)
    assertEquals(1_500_000.0, hosts.totalTxBytesPerSec!!, 0.1)
    assertEquals(2, hosts.cpuSparkline.size)
    assertEquals(OneUiPillTone.Online, hosts.tone)
    assertEquals(OneUiPillTone.Offline, sections[1].tone)
  }

  @Test
  fun membershipDiffCapturesBothAdditionsAndUncheckedRemovals() {
    // 原属「宿主机」为 pve1 + pve2；取消勾选 pve2、新增勾选 ws1（跨组）与 pi（未分组）
    val diff = computeGroupMembershipDiff(
      devices = devices,
      groupName = "宿主机",
      selectedIds = setOf("pve1", "ws1", "pi")
    )
    assertTrue(diff.hasChanges)
    assertFalse(diff.dissolvesGroup)
    assertEquals(listOf("ws1", "pi"), diff.addedIds)
    assertEquals(listOf("pve2"), diff.removedIds)
    assertEquals(1, diff.transferredCount)

    // 取消勾选全部现有成员时应允许提交并识别为解散分组
    val emptyDiff = computeGroupMembershipDiff(
      devices = devices,
      groupName = "宿主机",
      selectedIds = emptySet()
    )
    assertTrue(emptyDiff.hasChanges)
    assertTrue(emptyDiff.dissolvesGroup)
    assertTrue(emptyDiff.addedIds.isEmpty())
    assertEquals(listOf("pve1", "pve2"), emptyDiff.removedIds)
  }

  @Test
  fun wholeGroupReorderAndWithinGroupMoveKeepUngroupedAnchoredAtTail() {
    val movedDown = moveDeviceGroupOrder(devices, "宿主机", delta = 1)
    assertNotNull(movedDown)
    assertEquals(listOf("ws1", "pve1", "pve2", "pi"), movedDown)

    val byId = devices.associateBy { it.deviceId }
    val rebuilt = buildDeviceGroupSections(movedDown!!.map { byId.getValue(it) }, emptyMap())
    assertEquals(listOf("开发设备", "宿主机", GROUP_KEY_UNGROUPED), rebuilt.map { it.key })

    assertNull("未分组固定在末尾，不参与命名分组移动", moveDeviceGroupOrder(devices, GROUP_KEY_UNGROUPED, delta = -1))

    val swappedInGroup = moveDeviceOrder(devices, "pve2", delta = -1, withinGroup = true)
    assertEquals(listOf("pve2", "pve1", "ws1", "pi"), swappedInGroup)
    assertNull("组首设备在组内不能继续上移跨组", moveDeviceOrder(devices, "ws1", delta = -1, withinGroup = true))
  }

  @Test
  fun comparisonChartNormalizesMemoryShareAndCapsExcessSeries() {
    val manyDevices = (1..8).map { idx ->
      DeviceSummaryDto(
        deviceId = "d$idx",
        hostname = "node-$idx",
        os = "linux",
        status = "online",
        cpuUsagePercent = idx * 10.0,
        memoryTotalBytes = 100_000_000L,
        group = "集群"
      )
    }
    val overview = manyDevices.associate { d ->
      d.deviceId to OverviewInstanceSeriesDto(
        deviceId = d.deviceId,
        hostname = d.hostname,
        memoryUsedBytes = listOf(SamplePointDto("2026-11-18T10:00:00Z", 50_000_000.0))
      )
    }
    val spec = buildGroupComparisonChart(manyDevices, overview, GroupComparisonMetric.Memory)
    assertEquals(6, spec.series.size)
    assertEquals(100.0, spec.fixedMaxValue!!, 0.001)
    assertEquals(50.0, spec.series.first().points.single().value, 0.01)
    assertTrue(spec.note.orEmpty().contains("6/8"))
  }

  @Test
  fun reservedNamesAndDraftMergeStayConsistent() {
    assertTrue(isReservedGroupName("all"))
    assertTrue(isReservedGroupName(" __ALL__ "))
    assertTrue(isReservedGroupName("__ungrouped__"))
    assertFalse(isReservedGroupName("宿主机"))

    val merged = mergeDeviceOrderDraft(
      draftIds = listOf("pve2", "deleted-node", "pve1"),
      persistedIds = listOf("pve1", "pve2", "new-node")
    )
    assertEquals(listOf("pve2", "pve1", "new-node"), merged)
  }
}
