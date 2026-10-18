package com.dsc.android

import java.time.Instant

/**
 * 「需要关注」规则（纯函数，单测覆盖）。
 *
 * 中枢不下发告警，这里只用已经拿到的数据做客户端判定：
 * - 设备摘要（所有设备都有）：离线、上报中断、CPU / 内存 / 硬盘占用、GPU 内存；
 * - 设备指标快照（打开过或在关注页里拉取过的设备）：温度、硬盘健康、存储池、Swap。
 *
 * 阈值写在 [AttentionThresholds]，规则只比较「当前值」，不做持续时间推断——
 * 一次 15 秒快照撞线就报，读者点进去看图就能判断是不是尖峰。
 */
enum class AttentionSeverity(val rank: Int, val label: String) {
  Critical(0, "严重"),
  Warning(1, "警告"),
  Offline(2, "离线")
}

data class AttentionItem(
  val deviceId: String,
  val hostname: String,
  val severity: AttentionSeverity,
  /** 点按后在设备页里展开的类别；为空表示打开设备概览。 */
  val block: DeviceBlockKey?,
  /** 稳定键：同一设备同一问题只出现一次，也用于列表 key。 */
  val key: String,
  val title: String,
  val detail: String
)

object AttentionThresholds {
  const val CPU_WARNING = 85.0
  const val CPU_CRITICAL = 95.0
  const val MEMORY_WARNING = 88.0
  const val MEMORY_CRITICAL = 95.0
  const val DISK_WARNING = 85.0
  const val DISK_CRITICAL = 95.0
  const val GPU_MEMORY_WARNING = 95.0
  const val SWAP_WARNING = 80.0
  const val POOL_WARNING = 85.0
  const val POOL_CRITICAL = 95.0
  const val THIN_META_WARNING = 80.0
  const val THIN_META_CRITICAL = 90.0
  /** 设备标为在线但超过这么久没有新上报，视为上报中断。 */
  const val STALE_REPORT_MILLIS = 3 * 60_000L

  // 传感器没有给出自身阈值时的兜底（按角色）
  const val CPU_TEMP_WARNING = 85.0
  const val CPU_TEMP_CRITICAL = 95.0
  const val GPU_TEMP_WARNING = 83.0
  const val GPU_TEMP_CRITICAL = 90.0
  const val DISK_TEMP_WARNING = 55.0
  const val DISK_TEMP_CRITICAL = 65.0
}

private fun pct(value: Double) = "%.1f%%".format(value)
private fun celsius(value: Double) = "%.1f °C".format(value)

private fun tiered(value: Double?, warning: Double, critical: Double): AttentionSeverity? = when {
  value == null || !value.isFinite() -> null
  value >= critical -> AttentionSeverity.Critical
  value >= warning -> AttentionSeverity.Warning
  else -> null
}

/** 摘要层规则：首页与关注页对所有设备都能算。 */
fun summaryAttention(device: DeviceSummaryDto, nowMillis: Long = System.currentTimeMillis()): List<AttentionItem> = buildList {
  val host = device.hostname
  fun item(severity: AttentionSeverity, block: DeviceBlockKey?, key: String, title: String, detail: String) =
    add(AttentionItem(device.deviceId, host, severity, block, "${device.deviceId}:$key", title, detail))

  if (device.status != "online") {
    item(AttentionSeverity.Offline, null, "offline", "设备离线", lastSeenDetail(device.lastSeenAt, nowMillis))
    return@buildList
  }
  val seen = device.lastSeenAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
  if (seen != null && nowMillis - seen > AttentionThresholds.STALE_REPORT_MILLIS) {
    item(AttentionSeverity.Warning, null, "stale", "上报中断", lastSeenDetail(device.lastSeenAt, nowMillis) + "，数据可能已过期")
  }
  tiered(device.cpuUsagePercent, AttentionThresholds.CPU_WARNING, AttentionThresholds.CPU_CRITICAL)?.let {
    item(it, DeviceBlockKey.Cpu, "cpu", "CPU 占用 ${pct(device.cpuUsagePercent!!)}", "高于 ${pct(if (it == AttentionSeverity.Critical) AttentionThresholds.CPU_CRITICAL else AttentionThresholds.CPU_WARNING)}")
  }
  tiered(device.memoryUsagePercent, AttentionThresholds.MEMORY_WARNING, AttentionThresholds.MEMORY_CRITICAL)?.let {
    item(it, DeviceBlockKey.Memory, "memory", "内存占用 ${pct(device.memoryUsagePercent!!)}", "高于 ${pct(if (it == AttentionSeverity.Critical) AttentionThresholds.MEMORY_CRITICAL else AttentionThresholds.MEMORY_WARNING)}")
  }
  tiered(device.diskUsagePercent, AttentionThresholds.DISK_WARNING, AttentionThresholds.DISK_CRITICAL)?.let {
    item(it, DeviceBlockKey.Disk, "disk", "硬盘占用 ${pct(device.diskUsagePercent!!)}", "可用空间不足，高于 ${pct(if (it == AttentionSeverity.Critical) AttentionThresholds.DISK_CRITICAL else AttentionThresholds.DISK_WARNING)}")
  }
  device.gpuMemoryUsagePercent?.takeIf { it >= AttentionThresholds.GPU_MEMORY_WARNING }?.let {
    item(AttentionSeverity.Warning, DeviceBlockKey.Gpu, "gpu-memory", "GPU 内存占用 ${pct(it)}", "接近显存上限")
  }
}

/** 指标层规则：需要这台设备的指标快照。 */
fun metricsAttention(metrics: MetricsDto): List<AttentionItem> = buildList {
  if (metrics.status != "online") return@buildList
  val id = metrics.device.deviceId
  val host = metrics.device.hostname
  fun item(severity: AttentionSeverity, block: DeviceBlockKey?, key: String, title: String, detail: String) =
    add(AttentionItem(id, host, severity, block, "$id:$key", title, detail))

  val latest = metrics.latest
  if (latest.swapTotalBytes > 0) {
    val swap = latest.swapUsedBytes.toDouble() / latest.swapTotalBytes * 100
    if (swap >= AttentionThresholds.SWAP_WARNING) {
      item(AttentionSeverity.Warning, DeviceBlockKey.Memory, "swap", "Swap 占用 ${pct(swap)}", "物理内存可能不足，系统在频繁换页")
    }
  }

  latest.temperatureSensors
    .filter { it.status == "valid" }
    .forEach { sensor ->
      val current = sensor.currentC?.takeIf { it.isFinite() && it > 0.0 } ?: return@forEach
      val (warn, crit) = sensorLimits(sensor.role, sensor.highC, sensor.criticalC)
      val severity = tiered(current, warn, crit)
        ?: if (sensor.alarm == true) AttentionSeverity.Warning else null
      severity ?: return@forEach
      val name = sensor.displayName ?: sensor.rawName
      val limit = if (severity == AttentionSeverity.Critical) crit else warn
      item(severity, DeviceBlockKey.Temperature, "temp:${sensor.id}", "$name ${celsius(current)}", "高于 ${celsius(limit)}")
    }

  latest.gpus.forEach { gpu ->
    val temp = gpu.temperatureC?.takeIf { it.isFinite() && it > 0.0 && gpu.temperatureSource != "cpuPackageShared" } ?: return@forEach
    tiered(temp, AttentionThresholds.GPU_TEMP_WARNING, AttentionThresholds.GPU_TEMP_CRITICAL)?.let {
      item(it, DeviceBlockKey.Gpu, "gpu-temp:${gpu.id}", "${gpu.name} ${celsius(temp)}", "显卡温度偏高")
    }
  }

  latest.disks.forEach { disk ->
    when (disk.healthStatus?.lowercase()) {
      "bad" -> item(AttentionSeverity.Critical, DeviceBlockKey.Disk, "disk-health:${disk.id}", "${disk.name} 健康异常", disk.healthReason ?: "SMART 报告异常，建议尽快备份")
      "caution" -> item(AttentionSeverity.Warning, DeviceBlockKey.Disk, "disk-health:${disk.id}", "${disk.name} 健康需注意", disk.healthReason ?: "SMART 报告需注意")
    }
    disk.healthPercent?.let { life ->
      val severity = when {
        life <= 10.0 -> AttentionSeverity.Critical
        life <= 20.0 -> AttentionSeverity.Warning
        else -> null
      }
      severity?.let { item(it, DeviceBlockKey.Disk, "disk-life:${disk.id}", "${disk.name} 剩余寿命 ${pct(life)}", "固态硬盘寿命接近耗尽") }
    }
    disk.temperatureC?.takeIf { it.isFinite() && it > 0.0 }?.let { temp ->
      tiered(temp, AttentionThresholds.DISK_TEMP_WARNING, AttentionThresholds.DISK_TEMP_CRITICAL)?.let {
        item(it, DeviceBlockKey.Disk, "disk-temp:${disk.id}", "${disk.name} ${celsius(temp)}", "硬盘温度偏高")
      }
    }
  }

  latest.storagePools.forEach { pool ->
    if (pool.active == false && pool.enabled != false) {
      item(AttentionSeverity.Warning, DeviceBlockKey.Storage, "pool-inactive:${pool.id}", "存储池 ${pool.name} 未激活", "已启用但当前不可用")
    }
    if (pool.totalBytes > 0 && pool.active != false) {
      val usage = pool.usedBytes.toDouble() / pool.totalBytes * 100
      tiered(usage, AttentionThresholds.POOL_WARNING, AttentionThresholds.POOL_CRITICAL)?.let {
        item(it, DeviceBlockKey.Storage, "pool:${pool.id}", "存储池 ${pool.name} 占用 ${pct(usage)}", "剩余空间不足")
      }
    }
    tiered(pool.metadataPercent, AttentionThresholds.THIN_META_WARNING, AttentionThresholds.THIN_META_CRITICAL)?.let {
      item(it, DeviceBlockKey.Storage, "pool-meta:${pool.id}", "${pool.name} 元数据 ${pct(pool.metadataPercent!!)}", "精简池元数据写满会导致整个池只读")
    }
    val health = pool.health?.lowercase().orEmpty()
    if (listOf("degraded", "faulted", "unavail", "error", "bad", "suspended").any { it in health }) {
      item(AttentionSeverity.Critical, DeviceBlockKey.Storage, "pool-health:${pool.id}", "存储池 ${pool.name} 状态 ${pool.health}", "存储池降级或故障")
    }
  }
}

private fun sensorLimits(role: String, highC: Double?, criticalC: Double?): Pair<Double, Double> {
  val (defaultWarn, defaultCrit) = when {
    role.startsWith("gpu") -> AttentionThresholds.GPU_TEMP_WARNING to AttentionThresholds.GPU_TEMP_CRITICAL
    role.contains("disk") || role.contains("nvme") || role.contains("storage") || role.contains("drive") ->
      AttentionThresholds.DISK_TEMP_WARNING to AttentionThresholds.DISK_TEMP_CRITICAL
    else -> AttentionThresholds.CPU_TEMP_WARNING to AttentionThresholds.CPU_TEMP_CRITICAL
  }
  // 传感器自报的阈值只在看起来合理时采用（有些主板把 high 报成 0 或 255）
  val warn = highC?.takeIf { it in 30.0..150.0 } ?: defaultWarn
  val crit = criticalC?.takeIf { it in 30.0..150.0 && it > warn } ?: maxOf(defaultCrit, warn + 5.0)
  return warn to crit
}

private fun lastSeenDetail(lastSeenAt: String?, nowMillis: Long): String {
  val seen = lastSeenAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: return "没有上报记录"
  return "最后上报于 ${relativeAge(nowMillis - seen)}"
}

/** 「12 秒前 / 5 分钟前 / 3 小时前 / 2 天前」——比绝对时间更快读懂。 */
fun relativeAge(ageMillis: Long): String {
  val seconds = (ageMillis / 1000).coerceAtLeast(0)
  return when {
    seconds < 5 -> "刚刚"
    seconds < 60 -> "$seconds 秒前"
    seconds < 3600 -> "${seconds / 60} 分钟前"
    seconds < 86_400 -> "${seconds / 3600} 小时前"
    else -> "${seconds / 86_400} 天前"
  }
}

/** 合并两层规则：同键去重、按严重程度再按设备排序。 */
fun collectAttention(
  devices: List<DeviceSummaryDto>,
  metricsByDevice: Map<String, MetricsDto>,
  nowMillis: Long = System.currentTimeMillis()
): List<AttentionItem> {
  val byKey = linkedMapOf<String, AttentionItem>()
  devices.forEach { device ->
    summaryAttention(device, nowMillis).forEach { byKey.putIfAbsent(it.key, it) }
    if (device.status == "online") {
      metricsByDevice[device.deviceId]?.let { metrics ->
        metricsAttention(metrics).forEach { byKey.putIfAbsent(it.key, it) }
      }
    }
  }
  val order = devices.mapIndexed { index, device -> device.deviceId to index }.toMap()
  return byKey.values.sortedWith(compareBy<AttentionItem> { it.severity.rank }.thenBy { order[it.deviceId] ?: Int.MAX_VALUE })
}

fun worstSeverity(items: List<AttentionItem>): AttentionSeverity? = items.minByOrNull { it.severity.rank }?.severity
