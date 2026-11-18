package com.dsc.android.ui.screens

import androidx.compose.runtime.Immutable
import com.dsc.android.AttentionItem
import com.dsc.android.AttentionSeverity
import com.dsc.android.AttentionThresholds
import com.dsc.android.DeviceSummaryDto
import com.dsc.android.OverviewInstanceSeriesDto
import com.dsc.android.SamplePointDto
import com.dsc.android.parseTimestampMillis
import com.dsc.android.percentOf
import com.dsc.android.seriesStats
import com.dsc.android.ui.oneui.ChartSeriesModel
import com.dsc.android.ui.oneui.ChartThreshold
import com.dsc.android.ui.oneui.ChartThresholdTone
import com.dsc.android.ui.oneui.OneUiFleetDotSpec
import com.dsc.android.ui.oneui.OneUiPillTone
import com.dsc.android.ui.oneui.formatBytes
import com.dsc.android.ui.oneui.formatPercent
import com.dsc.android.ui.oneui.formatSpeed
import java.text.Normalizer

internal const val GROUP_FILTER_ALL = "__all__"
internal const val GROUP_KEY_UNGROUPED = "__ungrouped__"
internal val RECOMMENDED_GROUPS = listOf("宿主机", "虚拟机", "存储与网络", "开发设备", "办公终端")
private val RESERVED_GROUP_NAMES = setOf("all", "__all__", "__ungrouped__")

internal fun normalizeGroupInput(raw: String?): String? {
  val normalized = raw?.let { Normalizer.normalize(it, Normalizer.Form.NFC) }?.trim().orEmpty()
  if (normalized.isEmpty()) return null
  return normalized.codePoints().limit(64).collect(
    ::StringBuilder,
    StringBuilder::appendCodePoint,
    StringBuilder::append
  ).toString()
}

internal fun isReservedGroupName(raw: String?): Boolean {
  val normalized = raw?.let { Normalizer.normalize(it, Normalizer.Form.NFC) }?.trim()?.lowercase() ?: return false
  return normalized in RESERVED_GROUP_NAMES
}

internal fun DeviceSummaryDto.normalizedGroup(): String? =
  normalizeGroupInput(group)?.takeUnless(::isReservedGroupName)

internal fun DeviceSummaryDto.matchesGroup(filter: String): Boolean {
  if (filter == GROUP_FILTER_ALL) return true
  val g = normalizedGroup()
  return if (filter == GROUP_KEY_UNGROUPED) g == null else g == filter
}

internal fun DeviceSummaryDto.matchesQuery(query: String): Boolean {
  val needle = query.trim()
  return needle.isEmpty() ||
    hostname.contains(needle, ignoreCase = true) ||
    deviceId.contains(needle, ignoreCase = true) ||
    os.contains(needle, ignoreCase = true) ||
    group.orEmpty().contains(needle, ignoreCase = true)
}

internal enum class DeviceSortMode(val label: String, val shortLabel: String, val description: String) {
  Custom("自定义顺序", "默认顺序", "按中枢保存的组与设备排列顺序"),
  Attention("需关注优先", "关注优先", "有严重与警告问题的设备排在最前，离线次之"),
  Cpu("CPU 占用", "按 CPU", "当前在线设备的 CPU 占用从高到低"),
  Memory("内存占用", "按内存", "当前在线设备的内存占用从高到低")
}

internal fun sortDevices(
  devices: List<DeviceSummaryDto>,
  mode: DeviceSortMode,
  issues: Map<String, List<AttentionItem>>
): List<DeviceSummaryDto> = when (mode) {
  DeviceSortMode.Custom -> devices
  DeviceSortMode.Attention -> devices.sortedWith(
    compareBy<DeviceSummaryDto> { device ->
      issues[device.deviceId]?.minOfOrNull { it.severity.rank } ?: Int.MAX_VALUE
    }.thenByDescending { issues[it.deviceId]?.size ?: 0 }
      .thenBy { it.sortOrder ?: Int.MAX_VALUE }
      .thenBy { it.hostname }
  )
  DeviceSortMode.Cpu -> devices.sortedByDescending { if (it.status == "online") it.cpuUsagePercent ?: -1.0 else -2.0 }
  DeviceSortMode.Memory -> devices.sortedByDescending { if (it.status == "online") it.memoryUsagePercent ?: -1.0 else -2.0 }
}

/**
 * 合并未保存顺序草稿与最新服务端设备清单：
 * 后台轮询或改组刷新到达时保留用户已调整的顺序，新出现的设备追加在末尾。
 */
internal fun mergeDeviceOrderDraft(draftIds: List<String>?, persistedIds: List<String>): List<String> {
  if (draftIds.isNullOrEmpty()) return persistedIds
  val aliveSet = persistedIds.toSet()
  val kept = draftIds.filter { it in aliveSet }.distinct()
  val keptSet = kept.toSet()
  return kept + persistedIds.filterNot { it in keptSet }
}

@Immutable
internal data class DeviceGroupSectionModel(
  val key: String,
  val name: String,
  val isUngrouped: Boolean,
  val devices: List<DeviceSummaryDto>,
  val total: Int,
  val online: Int,
  val offline: Int,
  val criticalCount: Int,
  val warningCount: Int,
  val issueCount: Int,
  val tone: OneUiPillTone,
  val avgCpuPercent: Double?,
  val peakCpuHostname: String?,
  val peakCpuPercent: Double?,
  val cpuSparkline: List<SamplePointDto>,
  val memoryUsedBytes: Long,
  val memoryTotalBytes: Long,
  val pooledMemoryPercent: Double?,
  val avgMemoryPercent: Double?,
  val diskUsedBytes: Long,
  val diskTotalBytes: Long,
  val pooledDiskPercent: Double?,
  val avgDiskPercent: Double?,
  val totalRxBytesPerSec: Double?,
  val totalTxBytesPerSec: Double?,
  val fleetDots: List<OneUiFleetDotSpec>,
  val glanceSubtitle: String
) {
  val memorySummaryLabel: String
    get() = when {
      memoryTotalBytes > 0 -> "${formatBytes(memoryUsedBytes.toDouble())} / ${formatBytes(memoryTotalBytes.toDouble())}"
      avgMemoryPercent != null -> formatPercent(avgMemoryPercent)
      else -> "—"
    }

  val diskSummaryLabel: String
    get() = when {
      diskTotalBytes > 0 -> "${formatBytes(diskUsedBytes.toDouble())} / ${formatBytes(diskTotalBytes.toDouble())}"
      avgDiskPercent != null -> formatPercent(avgDiskPercent)
      else -> "—"
    }

  val effectiveMemoryPercent: Double?
    get() = pooledMemoryPercent ?: avgMemoryPercent

  val effectiveDiskPercent: Double?
    get() = pooledDiskPercent ?: avgDiskPercent
}

internal fun buildDeviceGroupSections(
  devices: List<DeviceSummaryDto>,
  issuesByDevice: Map<String, List<AttentionItem>>,
  overviewById: Map<String, OverviewInstanceSeriesDto> = emptyMap(),
  withinGroupSort: DeviceSortMode = DeviceSortMode.Custom
): List<DeviceGroupSectionModel> {
  val buckets = linkedMapOf<String, MutableList<DeviceSummaryDto>>()
  for (device in devices) {
    val key = device.normalizedGroup() ?: GROUP_KEY_UNGROUPED
    buckets.getOrPut(key) { mutableListOf() }.add(device)
  }

  val buildSection = { key: String, rawList: List<DeviceSummaryDto> ->
    val list = if (withinGroupSort == DeviceSortMode.Custom) {
      rawList
    } else {
      sortDevices(rawList, withinGroupSort, issuesByDevice)
    }
    val isUngrouped = key == GROUP_KEY_UNGROUPED
    val onlineList = list.filter { it.status == "online" }
    val online = onlineList.size
    val offline = list.size - online

    var criticalCount = 0
    var warningCount = 0
    for (device in list) {
      val nonOffline = issuesByDevice[device.deviceId].orEmpty().filter { it.severity != AttentionSeverity.Offline }
      if (nonOffline.any { it.severity == AttentionSeverity.Critical }) {
        criticalCount += 1
      } else if (nonOffline.isNotEmpty()) {
        warningCount += 1
      }
    }
    val issueCount = criticalCount + warningCount

    val tone = when {
      criticalCount > 0 -> OneUiPillTone.Critical
      warningCount > 0 -> OneUiPillTone.Warning
      offline > 0 -> OneUiPillTone.Offline
      online > 0 -> OneUiPillTone.Online
      else -> OneUiPillTone.Neutral
    }

    val cpuSamples = onlineList.mapNotNull { d -> d.cpuUsagePercent?.takeIf { it.isFinite() }?.let { d to it } }
    val avgCpu = cpuSamples.takeIf { it.isNotEmpty() }?.map { it.second }?.average()
    val peakCpuPair = cpuSamples.maxByOrNull { it.second }

    var memUsed = 0L
    var memTotal = 0L
    onlineList.forEach { d ->
      val used = d.memoryUsedBytes
      val total = d.memoryTotalBytes
      if (used != null && total != null && total > 0 && used >= 0) {
        memUsed += used
        memTotal += total
      }
    }
    val pooledMemPct = if (memTotal > 0) memUsed.toDouble() / memTotal.toDouble() * 100.0 else null
    val avgMemPct = onlineList.mapNotNull { it.memoryUsagePercent?.takeIf(Double::isFinite) }.takeIf { it.isNotEmpty() }?.average()

    var diskUsed = 0L
    var diskTotal = 0L
    onlineList.forEach { d ->
      val used = d.diskUsedBytes
      val total = d.diskTotalBytes
      if (used != null && total != null && total > 0 && used >= 0) {
        diskUsed += used
        diskTotal += total
      }
    }
    val pooledDiskPct = if (diskTotal > 0) diskUsed.toDouble() / diskTotal.toDouble() * 100.0 else null
    val avgDiskPct = onlineList.mapNotNull { it.diskUsagePercent?.takeIf(Double::isFinite) }.takeIf { it.isNotEmpty() }?.average()

    val onlineOverviews = onlineList.mapNotNull { overviewById[it.deviceId] }
    val rxRates = onlineOverviews.mapNotNull { seriesStats(it.networkRxBytesPerSec)?.latest?.takeIf(Double::isFinite) }
    val txRates = onlineOverviews.mapNotNull { seriesStats(it.networkTxBytesPerSec)?.latest?.takeIf(Double::isFinite) }
    val totalRx = rxRates.takeIf { it.isNotEmpty() }?.sum()
    val totalTx = txRates.takeIf { it.isNotEmpty() }?.sum()

    val cpuSparkline = aggregateGroupCpuSeries(onlineOverviews.map { it.cpuUsagePercent })

    val fleetDots = list.map { device ->
      val devIssues = issuesByDevice[device.deviceId].orEmpty().filter { it.severity != AttentionSeverity.Offline }
      val dotTone = when {
        device.status != "online" -> OneUiPillTone.Offline
        devIssues.any { it.severity == AttentionSeverity.Critical } -> OneUiPillTone.Critical
        devIssues.isNotEmpty() -> OneUiPillTone.Warning
        else -> OneUiPillTone.Online
      }
      val load = maxOf(
        device.cpuUsagePercent ?: 0.0,
        (device.memoryUsagePercent ?: 0.0) * 0.85
      ).div(100.0).toFloat().coerceIn(0f, 1f)
      OneUiFleetDotSpec(key = device.deviceId, tone = dotTone, loadFraction = load)
    }

    val subtitle = buildList {
      if (offline > 0) add("$offline 台离线")
      if (issueCount > 0) add("$issueCount 台超限")
      if (avgCpu != null) add("CPU ${formatPercent(avgCpu)}")
      if (memTotal > 0) {
        add("内存 ${formatBytes(memUsed.toDouble())}/${formatBytes(memTotal.toDouble())}")
      } else if (avgMemPct != null) {
        add("内存 ${formatPercent(avgMemPct)}")
      }
      if (isEmpty()) add("全部在线运行正常")
    }.joinToString(" · ")

    DeviceGroupSectionModel(
      key = key,
      name = if (isUngrouped) "未分组" else key,
      isUngrouped = isUngrouped,
      devices = list,
      total = list.size,
      online = online,
      offline = offline,
      criticalCount = criticalCount,
      warningCount = warningCount,
      issueCount = issueCount,
      tone = tone,
      avgCpuPercent = avgCpu,
      peakCpuHostname = peakCpuPair?.first?.hostname,
      peakCpuPercent = peakCpuPair?.second,
      cpuSparkline = cpuSparkline,
      memoryUsedBytes = memUsed,
      memoryTotalBytes = memTotal,
      pooledMemoryPercent = pooledMemPct,
      avgMemoryPercent = avgMemPct,
      diskUsedBytes = diskUsed,
      diskTotalBytes = diskTotal,
      pooledDiskPercent = pooledDiskPct,
      avgDiskPercent = avgDiskPct,
      totalRxBytesPerSec = totalRx,
      totalTxBytesPerSec = totalTx,
      fleetDots = fleetDots,
      glanceSubtitle = subtitle
    )
  }

  val named = buckets.entries
    .filter { it.key != GROUP_KEY_UNGROUPED }
    .map { buildSection(it.key, it.value) }
  val ungrouped = buckets[GROUP_KEY_UNGROUPED]
    ?.takeIf { it.isNotEmpty() }
    ?.let { listOf(buildSection(GROUP_KEY_UNGROUPED, it)) }
    .orEmpty()
  return named + ungrouped
}

/**
 * 将组内多台在线设备的 CPU 序列按 30 秒时间桶对齐求均值，生成平滑的组级趋势迷你线。
 */
internal fun aggregateGroupCpuSeries(seriesList: List<List<SamplePointDto>>): List<SamplePointDto> {
  val nonEmpty = seriesList.filter { it.isNotEmpty() }
  if (nonEmpty.isEmpty()) return emptyList()
  if (nonEmpty.size == 1) return nonEmpty.single()
  val buckets = sortedMapOf<Long, MutableList<Double>>()
  val bucketMillis = 30_000L
  nonEmpty.forEach { points ->
    points.forEach { point ->
      if (!point.value.isFinite()) return@forEach
      val ts = parseTimestampMillis(point.timestamp) ?: return@forEach
      val slot = (ts / bucketMillis) * bucketMillis
      buckets.getOrPut(slot) { mutableListOf() }.add(point.value)
    }
  }
  return buckets.entries.map { (slotMillis, values) ->
    SamplePointDto(
      timestamp = java.time.Instant.ofEpochMilli(slotMillis).toString(),
      value = values.average()
    )
  }
}

internal enum class GroupComparisonMetric(val label: String, val chartTitle: String) {
  Cpu("CPU", "组内 CPU 占用对比"),
  Memory("内存", "组内内存占用对比"),
  Disk("硬盘", "组内硬盘占用对比"),
  Network("网络", "组内网络总吞吐对比")
}

@Immutable
internal data class GroupSeriesPeerItem(
  val deviceId: String,
  val hostname: String,
  val colorIndex: Int,
  val latestText: String,
  val online: Boolean
)

@Immutable
internal data class GroupComparisonChartSpec(
  val metric: GroupComparisonMetric,
  val series: List<ChartSeriesModel>,
  val peers: List<GroupSeriesPeerItem>,
  val valueFormatter: (Double?) -> String,
  val fixedMaxValue: Double?,
  val thresholds: List<ChartThreshold>,
  val note: String?
)

private const val MAX_GROUP_COMPARISON_SERIES = 6

internal fun buildGroupComparisonChart(
  devices: List<DeviceSummaryDto>,
  overviewById: Map<String, OverviewInstanceSeriesDto>,
  metric: GroupComparisonMetric
): GroupComparisonChartSpec {
  val formatter: (Double?) -> String = if (metric == GroupComparisonMetric.Network) ::formatSpeed else ::formatPercent
  val thresholds = when (metric) {
    GroupComparisonMetric.Cpu -> listOf(
      ChartThreshold(AttentionThresholds.CPU_WARNING, "${AttentionThresholds.CPU_WARNING.toInt()}%", ChartThresholdTone.Warning),
      ChartThreshold(AttentionThresholds.CPU_CRITICAL, "${AttentionThresholds.CPU_CRITICAL.toInt()}%", ChartThresholdTone.Critical)
    )
    GroupComparisonMetric.Memory -> listOf(
      ChartThreshold(AttentionThresholds.MEMORY_WARNING, "${AttentionThresholds.MEMORY_WARNING.toInt()}%", ChartThresholdTone.Warning),
      ChartThreshold(AttentionThresholds.MEMORY_CRITICAL, "${AttentionThresholds.MEMORY_CRITICAL.toInt()}%", ChartThresholdTone.Critical)
    )
    GroupComparisonMetric.Disk -> listOf(
      ChartThreshold(AttentionThresholds.DISK_WARNING, "${AttentionThresholds.DISK_WARNING.toInt()}%", ChartThresholdTone.Warning),
      ChartThreshold(AttentionThresholds.DISK_CRITICAL, "${AttentionThresholds.DISK_CRITICAL.toInt()}%", ChartThresholdTone.Critical)
    )
    GroupComparisonMetric.Network -> emptyList()
  }

  val missingCapacity = mutableListOf<String>()
  data class Candidate(
    val device: DeviceSummaryDto,
    val points: List<SamplePointDto>,
    val score: Double
  )

  val candidates = devices.mapNotNull { device ->
    val instance = overviewById[device.deviceId]
    val points: List<SamplePointDto> = when (metric) {
      GroupComparisonMetric.Cpu -> instance?.cpuUsagePercent.orEmpty()
      GroupComparisonMetric.Memory -> {
        val total = device.memoryTotalBytes?.toDouble() ?: 0.0
        if (total <= 0.0) {
          if (instance != null && instance.memoryUsedBytes.isNotEmpty()) missingCapacity += device.hostname
          emptyList()
        } else {
          percentOf(instance?.memoryUsedBytes.orEmpty(), total).map { it.copy(value = it.value.coerceIn(0.0, 100.0)) }
        }
      }
      GroupComparisonMetric.Disk -> {
        val total = device.diskTotalBytes?.toDouble() ?: 0.0
        if (total <= 0.0) {
          if (instance != null && instance.diskUsedBytes.isNotEmpty()) missingCapacity += device.hostname
          emptyList()
        } else {
          percentOf(instance?.diskUsedBytes.orEmpty(), total).map { it.copy(value = it.value.coerceIn(0.0, 100.0)) }
        }
      }
      GroupComparisonMetric.Network -> sumThroughputSeries(
        instance?.networkRxBytesPerSec.orEmpty(),
        instance?.networkTxBytesPerSec.orEmpty()
      )
    }
    val stats = seriesStats(points)
    val fallbackScore = when (metric) {
      GroupComparisonMetric.Cpu -> device.cpuUsagePercent ?: -1.0
      GroupComparisonMetric.Memory -> device.memoryUsagePercent ?: -1.0
      GroupComparisonMetric.Disk -> device.diskUsagePercent ?: -1.0
      GroupComparisonMetric.Network -> 0.0
    }
    val score = (if (device.status == "online") 1_000_000.0 else 0.0) + (stats?.peak ?: fallbackScore)
    Candidate(device = device, points = points, score = score)
  }

  val selected = if (candidates.size > MAX_GROUP_COMPARISON_SERIES) {
    candidates.sortedByDescending { it.score }.take(MAX_GROUP_COMPARISON_SERIES)
  } else {
    candidates
  }

  val series = selected.mapIndexed { index, item ->
    val label = if (item.device.status == "online") item.device.hostname else "${item.device.hostname}（离线）"
    ChartSeriesModel(
      label = label,
      points = item.points,
      colorIndex = index
    )
  }

  val peers = selected.mapIndexed { index, item ->
    val latest = seriesStats(item.points)?.latest ?: when (metric) {
      GroupComparisonMetric.Cpu -> item.device.cpuUsagePercent
      GroupComparisonMetric.Memory -> item.device.memoryUsagePercent
      GroupComparisonMetric.Disk -> item.device.diskUsagePercent
      GroupComparisonMetric.Network -> null
    }
    GroupSeriesPeerItem(
      deviceId = item.device.deviceId,
      hostname = item.device.hostname,
      colorIndex = index,
      latestText = if (item.device.status == "online" || latest != null) formatter(latest) else "离线",
      online = item.device.status == "online"
    )
  }

  val notes = buildList {
    if (candidates.size > MAX_GROUP_COMPARISON_SERIES) {
      add("已展示组内负载较高的 $MAX_GROUP_COMPARISON_SERIES/${candidates.size} 台设备曲线")
    }
    if (metric == GroupComparisonMetric.Network) {
      add("每条曲线为该设备的接收与发送速率之和")
    }
    if (missingCapacity.isNotEmpty()) {
      add("${missingCapacity.joinToString("、")} 未上报总容量，未绘制曲线")
    }
  }.takeIf { it.isNotEmpty() }?.joinToString(" · ")

  return GroupComparisonChartSpec(
    metric = metric,
    series = series,
    peers = peers,
    valueFormatter = formatter,
    fixedMaxValue = if (metric == GroupComparisonMetric.Network) null else 100.0,
    thresholds = thresholds,
    note = notes
  )
}

internal fun sumThroughputSeries(
  rx: List<SamplePointDto>,
  tx: List<SamplePointDto>
): List<SamplePointDto> {
  if (rx.isEmpty() && tx.isEmpty()) return emptyList()
  val byTime = linkedMapOf<String, Double>()
  for (p in rx) {
    if (p.value.isFinite()) byTime[p.timestamp] = (byTime[p.timestamp] ?: 0.0) + p.value
  }
  for (p in tx) {
    if (p.value.isFinite()) byTime[p.timestamp] = (byTime[p.timestamp] ?: 0.0) + p.value
  }
  return byTime.entries
    .map { (ts, v) -> SamplePointDto(ts, v) }
    .sortedBy { parseTimestampMillis(it.timestamp) ?: Long.MIN_VALUE }
}

/**
 * 整组上下移动：
 * 调整已命名设备组之间的先后次序（未分组始终固定在末尾），并重算全局 deviceIds 顺序，
 * 直接复用现有的 PUT /api/devices/reorder 完成跨端持久化。
 */
internal fun moveDeviceGroupOrder(
  devices: List<DeviceSummaryDto>,
  groupKey: String,
  delta: Int
): List<String>? {
  if (groupKey == GROUP_KEY_UNGROUPED || delta == 0) return null
  val sections = buildDeviceGroupSections(devices, emptyMap())
  val named = sections.filterNot { it.isUngrouped }.toMutableList()
  val ungrouped = sections.filter { it.isUngrouped }
  val index = named.indexOfFirst { it.key == groupKey }
  val target = index + delta
  if (index < 0 || target !in named.indices) return null
  val moved = named.removeAt(index)
  named.add(target, moved)
  return (named + ungrouped).flatMap { section -> section.devices.map { it.deviceId } }
}

/**
 * 单台设备顺序移动：
 * 当处于分组结构编辑态时，在所属设备组内部上下移动，避免跨组窜位破坏分组顺序；
 * 当无已命名分组时，在全局列表中上下移动。
 */
internal fun moveDeviceOrder(
  devices: List<DeviceSummaryDto>,
  deviceId: String,
  delta: Int,
  withinGroup: Boolean
): List<String>? {
  if (delta == 0) return null
  if (!withinGroup) {
    val ids = devices.map { it.deviceId }.toMutableList()
    val index = ids.indexOf(deviceId)
    val target = index + delta
    if (index < 0 || target !in ids.indices) return null
    ids.add(target, ids.removeAt(index))
    return ids
  }
  val sections = buildDeviceGroupSections(devices, emptyMap())
  val sectionIndex = sections.indexOfFirst { sec -> sec.devices.any { it.deviceId == deviceId } }
  if (sectionIndex < 0) return null
  val updatedSections = sections.mapIndexed { idx, sec ->
    if (idx != sectionIndex) {
      sec.devices.map { it.deviceId }
    } else {
      val localIds = sec.devices.map { it.deviceId }.toMutableList()
      val pos = localIds.indexOf(deviceId)
      val target = pos + delta
      if (pos < 0 || target !in localIds.indices) return null
      localIds.add(target, localIds.removeAt(pos))
      localIds
    }
  }
  return updatedSections.flatten()
}

@Immutable
internal data class GroupMembershipDiff(
  val groupName: String,
  val addedIds: List<String>,
  val removedIds: List<String>,
  val transferredCount: Int,
  val finalCount: Int
) {
  val hasChanges: Boolean get() = addedIds.isNotEmpty() || removedIds.isNotEmpty()
  val dissolvesGroup: Boolean get() = finalCount == 0 && removedIds.isNotEmpty()

  val confirmButtonLabel: String
    get() = when {
      !hasChanges -> "未修改成员"
      dissolvesGroup -> "移出全部并解散 (${removedIds.size})"
      addedIds.isNotEmpty() && removedIds.isNotEmpty() -> "保存变更 (+${addedIds.size} / -${removedIds.size})"
      addedIds.isNotEmpty() -> "加入分组 (${addedIds.size})"
      else -> "移出分组 (${removedIds.size})"
    }
}

internal fun computeGroupMembershipDiff(
  devices: List<DeviceSummaryDto>,
  groupName: String,
  selectedIds: Set<String>
): GroupMembershipDiff {
  val canonical = normalizeGroupInput(groupName) ?: groupName.trim()
  val currentMemberIds = devices
    .filter { it.normalizedGroup() == canonical }
    .map { it.deviceId }
    .toSet()
  val added = devices
    .filter { it.deviceId in selectedIds && it.deviceId !in currentMemberIds }
    .map { it.deviceId }
  val removed = devices
    .filter { it.deviceId in currentMemberIds && it.deviceId !in selectedIds }
    .map { it.deviceId }
  val transferred = devices.count {
    it.deviceId in added && it.normalizedGroup() != null && it.normalizedGroup() != canonical
  }
  return GroupMembershipDiff(
    groupName = canonical,
    addedIds = added,
    removedIds = removed,
    transferredCount = transferred,
    finalCount = selectedIds.size
  )
}
