package com.dsc.android.ui.oneui

import com.dsc.android.AppState
import com.dsc.android.ChartWindow
import com.dsc.android.DeviceBlockKey
import com.dsc.android.DeviceMetricConfigDto
import com.dsc.android.DeviceMetricOptionDto
import com.dsc.android.DeviceSummaryDto
import com.dsc.android.DiskDto
import com.dsc.android.DiskMetricSeriesDto
import com.dsc.android.FanDto
import com.dsc.android.GpuDto
import com.dsc.android.GpuMetricSeriesDto
import com.dsc.android.MetricWindow
import com.dsc.android.MetricsDto
import com.dsc.android.NetworkInterfaceDto
import com.dsc.android.NetworkMetricSeriesDto
import com.dsc.android.SamplePointDto
import com.dsc.android.TemperatureMetricSeriesDto
import com.dsc.android.TemperatureSensorDto
import com.dsc.android.parseTimestampMillis

/**
 * 数据选取、单位格式化与语义映射（与呈现层无关）。
 *
 * 这些成员从旧的 `ui/AppRoot.kt` 原样迁出：One UI 重构改动的是形、构、件、交、动、适，
 * 指标口径、温度源匹配、缺测处理等数据语义必须保持不变，因此集中到本文件单独演进。
 */
internal data class OverviewCapsuleModel(
  val blockKey: DeviceBlockKey,
  val title: String,
  val subtitle: String,
  val metrics: List<Pair<String, String>>
)

internal data class BlockSheetTabModel(
  val id: String,
  val label: String
)

internal fun chartWindowFor(metrics: MetricsDto, selectedWindow: MetricWindow): ChartWindow {
  val hasMatchingServerRange = metrics.window == selectedWindow.value
  return ChartWindow.from(
    window = selectedWindow,
    rangeStart = metrics.rangeStart.takeIf { hasMatchingServerRange },
    rangeEnd = metrics.rangeEnd.takeIf { hasMatchingServerRange }
  )
}

internal fun fanInstancesForDisplay(metrics: MetricsDto): List<FanDto> {
  val fans = metrics.latest.fans.toMutableList()
  val latestIds = fans.map { it.id }.toMutableSet()
  metrics.series.fans.forEach { series ->
    if (series.rpm.isEmpty()) return@forEach
    if (latestIds.add(series.id)) {
      fans += FanDto(
        id = series.id,
        label = series.name,
        interfaceRaw = series.interfaceRaw,
        rpm = series.rpm.lastOrNull()?.value?.toInt() ?: 0
      )
    }
  }
  return fans
}

internal fun buildOverviewCapsules(metrics: MetricsDto, selectedWindow: MetricWindow): List<OverviewCapsuleModel> {
  val fans = fanInstancesForDisplay(metrics)
  return buildList {
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Cpu,
        title = "CPU",
        subtitle = metrics.device.cpuModel ?: "处理器概览",
        metrics = listOf(
          "占用" to metricPoint(metrics.series.cpuUsagePercent, selectedWindow, ::formatPercent),
          "频率" to metricPoint(metrics.series.cpuFrequencyMHz, selectedWindow, ::formatMHz),
          "温度" to metricPoint(cpuTemperaturePoints(metrics), selectedWindow, ::formatCelsius, zeroMeansMissing = true)
        )
      )
    )
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Gpu,
        title = "显卡",
        subtitle = if (metrics.latest.gpus.isEmpty()) "未读取到显卡" else "${metrics.latest.gpus.size} 张显卡 / 适配器",
        metrics = listOf(
          "占用" to metricPoint(metrics.series.gpuUsagePercent, selectedWindow, ::formatPercent),
          "GPU 内存" to formatGpuMemorySummary(metrics.latest.gpus),
          "温度" to metricPoint(gpuTemperaturePoints(metrics), selectedWindow, ::formatCelsius)
        )
      )
    )
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Memory,
        title = "内存",
        subtitle = "物理内存与虚拟内存",
        metrics = listOf(
          "物理" to buildUsage(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes),
          "占用" to metricPoint(metrics.series.memoryUsagePercent, selectedWindow, ::formatPercent),
          "虚拟" to buildUsage(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes)
        )
      )
    )
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Disk,
        title = "硬盘",
        subtitle = "${metrics.latest.disks.size} 个设备 / 分区",
        metrics = listOf(
          "总占用" to buildUsage(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes),
          "读取" to metricPoint(metrics.series.diskReadBytesPerSec, selectedWindow, ::formatSpeed),
          "写入" to metricPoint(metrics.series.diskWriteBytesPerSec, selectedWindow, ::formatSpeed)
        )
      )
    )
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Network,
        title = "网络",
        subtitle = "${metrics.latest.networkInterfaces.size} 个网络接口",
        metrics = listOf(
          "接收" to metricPoint(metrics.series.networkRxBytesPerSec, selectedWindow, ::formatSpeed),
          "发送" to metricPoint(metrics.series.networkTxBytesPerSec, selectedWindow, ::formatSpeed),
          "累计" to formatBytes((metrics.series.trafficRxBytes.lastOrNull()?.value ?: 0.0) + (metrics.series.trafficTxBytes.lastOrNull()?.value ?: 0.0))
        )
      )
    )
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Fan,
        title = "风扇转速",
        subtitle = if (fans.isEmpty()) "未检测到风扇接口" else "${fans.size} 个风扇接口 · 点击查看趋势",
        metrics = listOf(
          "最高" to (fans.maxOfOrNull { it.rpm }?.let { "$it RPM" } ?: "暂无"),
          "平均" to (fans.takeIf { it.isNotEmpty() }?.map { it.rpm }?.average()?.toInt()?.let { "$it RPM" } ?: "暂无"),
          "后端" to if (metrics.latest.sensorBackends.any { it.ok }) "可用" else "不可用"
        )
      )
    )
    if (hasTemperatureData(metrics)) {
      val validSensors = metrics.latest.temperatureSensors.filter { it.status == "valid" }
      val auxiliarySources = buildList<Double> {
        cpuLatestTemperature(metrics)?.let { add(it) }
        metrics.latest.gpus.mapNotNull { validTemperature(it.temperatureC) }.forEach { add(it) }
        metrics.latest.disks.mapNotNull { validDiskTemperature(it.temperatureC) }.forEach { add(it) }
      }
      val sourceCount = validSensors.size + auxiliarySources.size
      add(
        OverviewCapsuleModel(
          blockKey = DeviceBlockKey.Temperature,
          title = "温度",
          subtitle = if (sourceCount == 0) "温度源需要诊断" else "$sourceCount 个温度源",
          metrics = listOf(
            "当前" to temperatureOverviewValue(validSensors, metrics),
            "告警" to validSensors.count { it.alarm == true }.toString()
          )
        )
      )
    }
  }
}

internal fun hasTemperatureData(metrics: MetricsDto): Boolean =
  metrics.latest.temperatureSensors.isNotEmpty() ||
    metrics.series.temperatureSensors.isNotEmpty() ||
    cpuLatestTemperature(metrics) != null ||
    metrics.latest.gpus.any { validTemperature(it.temperatureC) != null } ||
    metrics.latest.disks.any { validDiskTemperature(it.temperatureC) != null } ||
    cpuTemperaturePoints(metrics).isNotEmpty() ||
    gpuTemperaturePoints(metrics).isNotEmpty() ||
    metrics.series.disks.any { disk -> disk.temperatureC.any { validDiskTemperature(it.value) != null } }

internal fun temperatureOverviewValue(sensors: List<TemperatureSensorDto>, metrics: MetricsDto): String {
  val current = sensors.mapNotNull { validTemperature(it.currentC) }.averageOrNull()
    ?: cpuLatestTemperature(metrics)
    ?: metrics.latest.gpus.mapNotNull { validTemperature(it.temperatureC) }.averageOrNull()
    ?: metrics.latest.disks.mapNotNull { validDiskTemperature(it.temperatureC) }.averageOrNull()
  return current?.let(::formatCelsius) ?: "未知"
}

internal fun List<Double>.averageOrNull(): Double? = takeIf { isNotEmpty() }?.average()

internal fun buildBlockSheetTabs(metrics: MetricsDto, blockKey: DeviceBlockKey): List<BlockSheetTabModel> {
  val tabs = mutableListOf(BlockSheetTabModel("total", "总和"))
  when (blockKey) {
    DeviceBlockKey.Cpu -> metrics.series.cpus.forEach { tabs += BlockSheetTabModel(it.id, it.name) }
    DeviceBlockKey.Gpu -> metrics.latest.gpus.forEach { tabs += BlockSheetTabModel(it.id, it.name) }
    DeviceBlockKey.Memory -> Unit
    DeviceBlockKey.Disk -> {
      metrics.latest.disks.forEach { tabs += BlockSheetTabModel(it.id, it.name) }
    }
    DeviceBlockKey.Network -> metrics.latest.networkInterfaces.forEach { tabs += BlockSheetTabModel(it.id, it.name) }
    DeviceBlockKey.Temperature -> Unit
    DeviceBlockKey.Fan -> fanInstancesForDisplay(metrics).forEach { tabs += BlockSheetTabModel(it.id, it.label) }
  }
  return tabs
}

internal data class DiskTemperatureGroup(
  val key: String,
  val title: String,
  val points: List<SamplePointDto>,
  val latestC: Double?
)

internal fun cpuTemperaturePoints(metrics: MetricsDto): List<SamplePointDto> =
  validTemperaturePoints(metrics.series.cpuTemperatureC)
    .ifEmpty { averageTemperaturePointSeries(metrics.series.cpus.map { it.temperatureC }) }
    .ifEmpty { averageTemperaturePointSeries(temperatureSensorPointSeries(metrics, ::isCpuTemperatureSeries)) }

internal fun gpuTemperaturePoints(metrics: MetricsDto): List<SamplePointDto> =
  validTemperaturePoints(metrics.series.gpuTemperatureC)
    .ifEmpty { averageTemperaturePointSeries(metrics.series.gpus.map { it.temperatureC }) }
    .ifEmpty { averageTemperaturePointSeries(temperatureSensorPointSeries(metrics, ::isGpuTemperatureSeries)) }

internal fun cpuLatestTemperature(metrics: MetricsDto): Double? =
  validTemperature(metrics.latest.cpuTemperatureC)
    ?: metrics.latest.cpuPackages.mapNotNull { validTemperature(it.temperatureC) }.averageOrNull()
    ?: metrics.latest.temperatureSensors.filter(::isCpuTemperatureSensor)
      .mapNotNull { validTemperature(it.currentC) }
      .averageOrNull()

internal fun gpuLatestTemperature(metrics: MetricsDto): Double? =
  metrics.latest.gpus.mapNotNull { validTemperature(it.temperatureC) }.averageOrNull()
    ?: metrics.latest.temperatureSensors.filter(::isGpuTemperatureSensor)
      .mapNotNull { validTemperature(it.currentC) }
      .averageOrNull()

internal fun temperatureSensorPointSeries(
  metrics: MetricsDto,
  predicate: (TemperatureMetricSeriesDto) -> Boolean
): List<List<SamplePointDto>> =
  metrics.series.temperatureSensors.filter(predicate).map { validTemperaturePoints(it.currentC) }

internal fun isCpuTemperatureSensor(sensor: TemperatureSensorDto): Boolean =
  sensor.status == "valid" && isCpuTemperatureRole(sensor.role)

internal fun isCpuTemperatureSeries(sensor: TemperatureMetricSeriesDto): Boolean =
  sensor.status == "valid" && isCpuTemperatureRole(sensor.role)

internal fun isCpuTemperatureRole(role: String): Boolean = role == "cpu_package" || role == "cpu_core" || role == "peci"

internal fun isGpuTemperatureSensor(sensor: TemperatureSensorDto): Boolean =
  sensor.status == "valid" && (
    sensor.role == "gpu_core" ||
      sensor.role == "gpu_hotspot" ||
      (sensor.role == "derived" && (sensor.hardwareType == "gpu" || sensor.source == "cpu-package-shared" || sensor.source == "cpuPackageShared"))
    )

internal fun isGpuTemperatureSeries(sensor: TemperatureMetricSeriesDto): Boolean =
  sensor.status == "valid" && (
    sensor.role == "gpu_core" ||
      sensor.role == "gpu_hotspot" ||
      (sensor.role == "derived" && (sensor.source == "cpu-package-shared" || sensor.source == "cpuPackageShared"))
    )

internal fun buildTemperatureSummaryCards(metrics: MetricsDto, selectedWindow: MetricWindow): List<MetricCardModel> =
  buildList {
    addAll(buildCpuTemperatureCards(metrics, selectedWindow))
    addAll(buildGpuTemperatureCards(metrics, selectedWindow))
    buildDiskTemperatureCards(metrics, selectedWindow).forEach { card ->
      add(card)
    }
  }

internal fun buildDiskTemperatureCards(metrics: MetricsDto, selectedWindow: MetricWindow): List<MetricCardModel> =
  (buildDiskTemperatureGroups(metrics) + buildStorageTemperatureGroups(metrics))
    .distinctBy { it.key }
    .map { disk ->
      MetricCardModel(
        title = "${disk.title} · 温度",
        value = if (disk.points.isNotEmpty()) metricPoint(disk.points, selectedWindow, ::formatCelsius) else formatCelsius(disk.latestC),
        points = disk.points,
        valueFormatter = ::formatCelsius
      )
    }

internal fun buildStorageTemperatureGroups(metrics: MetricsDto): List<DiskTemperatureGroup> {
  val latestById = metrics.latest.temperatureSensors.associateBy { it.id }
  val seriesById = metrics.series.temperatureSensors.associateBy { it.id }
  val seriesByKey = linkedMapOf<String, MutableList<TemperatureMetricSeriesDto>>()
  val latestByKey = linkedMapOf<String, MutableList<TemperatureSensorDto>>()

  metrics.series.temperatureSensors
    .filter(::isStorageTemperatureSeries)
    .forEach { sensorSeries ->
      val key = storageTemperatureKey(metrics, latestById[sensorSeries.id], sensorSeries)
      seriesByKey.getOrPut(key) { mutableListOf() }.add(sensorSeries)
    }
  metrics.latest.temperatureSensors
    .filter(::isStorageTemperatureSensor)
    .forEach { sensor ->
      val key = storageTemperatureKey(metrics, sensor, seriesById[sensor.id])
      latestByKey.getOrPut(key) { mutableListOf() }.add(sensor)
    }

  return (seriesByKey.keys + latestByKey.keys)
    .distinct()
    .mapNotNull { key ->
      val seriesItems = seriesByKey[key].orEmpty()
      val latestItems = latestByKey[key].orEmpty()
      val points = averageTemperaturePointSeries(
        seriesItems.map { sensor -> validTemperaturePoints(sensor.currentC) }
      )
      val latestC = latestItems.mapNotNull { validTemperature(it.currentC) }.averageOrNull()
      if (points.isEmpty() && latestC == null) return@mapNotNull null

      val disk = latestItems.asSequence()
        .map { sensor -> findDiskForStorageSensor(metrics, sensor, seriesById[sensor.id]) }
        .filterNotNull()
        .firstOrNull()
        ?: seriesItems.asSequence()
          .map { sensor -> findDiskForStorageSensor(metrics, latestById[sensor.id], sensor) }
          .filterNotNull()
          .firstOrNull()
      val title = disk?.let { physicalDiskTemperatureTitle(diskTemperatureKey(it), it.model, it.name) }
        ?: storageTemperatureTitle(latestItems.firstOrNull(), seriesItems.firstOrNull())
      DiskTemperatureGroup(key = key, title = title, points = points, latestC = latestC)
    }
}

internal fun isStorageTemperatureSensor(sensor: TemperatureSensorDto): Boolean =
  sensor.status == "valid" && isStorageTemperatureRole(sensor.role)

internal fun isStorageTemperatureSeries(sensor: TemperatureMetricSeriesDto): Boolean =
  sensor.status == "valid" && isStorageTemperatureRole(sensor.role)

internal fun isStorageTemperatureRole(role: String): Boolean =
  role == "storage_composite" || role == "storage_sensor"

internal fun storageTemperatureKey(
  metrics: MetricsDto,
  sensor: TemperatureSensorDto?,
  series: TemperatureMetricSeriesDto?
): String =
  findDiskForStorageSensor(metrics, sensor, series)?.let(::diskTemperatureKey)
    ?: "temperature-sensor:${sensor?.id ?: series?.id ?: "unknown"}"

internal fun findDiskForStorageSensor(
  metrics: MetricsDto,
  sensor: TemperatureSensorDto?,
  series: TemperatureMetricSeriesDto?
): DiskDto? {
  val strongSensorIdentities = listOfNotNull(sensor?.instanceId, sensor?.path)
    .mapNotNull(::normalizeTemperatureIdentity)
    .distinct()
  val sensorIdentities = listOfNotNull(
    sensor?.instanceId,
    sensor?.path,
    sensor?.hardware,
    sensor?.displayName,
    sensor?.rawName,
    series?.hardware,
    series?.name,
    series?.rawName
  ).mapNotNull(::normalizeTemperatureIdentity).distinct()
  if (sensorIdentities.isEmpty()) return null

  val disks = metrics.latest.disks
  val strongMatches = disks.filter { disk ->
    diskTemperatureIdentities(disk).any { identity -> identity in strongSensorIdentities }
  }
  if (strongMatches.isNotEmpty()) return strongMatches.first()

  val exactMatches = disks.filter { disk ->
    diskTemperatureIdentities(disk).any { identity -> identity in sensorIdentities }
  }
  if (exactMatches.map(::diskTemperatureKey).distinct().size == 1) return exactMatches.first()

  val containmentMatches = disks.filter { disk ->
    diskTemperatureIdentities(disk).any { diskIdentity ->
      sensorIdentities.any { sensorIdentity ->
        diskIdentity.length >= 4 && sensorIdentity.length >= 4 &&
          (diskIdentity.contains(sensorIdentity) || sensorIdentity.contains(diskIdentity))
      }
    }
  }
  return containmentMatches.takeIf { matches -> matches.map(::diskTemperatureKey).distinct().size == 1 }?.firstOrNull()
}

internal fun diskTemperatureIdentities(disk: DiskDto): List<String> =
  listOfNotNull(disk.physicalDevice, disk.id, disk.name, disk.model, disk.mountPoint)
    .mapNotNull(::normalizeTemperatureIdentity)
    .distinct()

internal fun normalizeTemperatureIdentity(value: String?): String? =
  value?.trim()?.lowercase()?.filter { it.isLetterOrDigit() }?.takeIf { it.length >= 4 }

internal fun storageTemperatureTitle(
  sensor: TemperatureSensorDto?,
  series: TemperatureMetricSeriesDto?
): String {
  val hardware = sensor?.hardware?.trim()?.takeIf { it.isNotEmpty() } ?: series?.hardware?.trim()?.takeIf { it.isNotEmpty() }
  val sensorName = sensor?.rawName?.trim()?.takeIf { it.isNotEmpty() }
    ?: series?.rawName?.trim()?.takeIf { it.isNotEmpty() }
    ?: sensor?.displayName?.trim()?.takeIf { it.isNotEmpty() }
    ?: series?.name?.trim()?.takeIf { it.isNotEmpty() }
  val identity = listOfNotNull(hardware, sensorName).distinct().joinToString(" · ").ifBlank { "未知型号" }
  return "硬盘 · $identity"
}

internal fun buildCpuTemperatureCards(metrics: MetricsDto, selectedWindow: MetricWindow): List<MetricCardModel> {
  val latestById = metrics.latest.cpuPackages.associateBy { it.id }
  val instanceIds = (metrics.series.cpus.map { it.id } + metrics.latest.cpuPackages.map { it.id }).toSet()
  val singleInstanceFallback = if (instanceIds.size == 1) cpuTemperaturePoints(metrics) else emptyList()
  val singleInstanceLatest = if (instanceIds.size == 1) cpuLatestTemperature(metrics) else null
  val cards = buildList {
    val seenIds = mutableSetOf<String>()
    metrics.series.cpus.forEach { cpu ->
      val latest = latestById[cpu.id]
      val points = validTemperaturePoints(cpu.temperatureC).ifEmpty { singleInstanceFallback }
      val temperature = validTemperature(latest?.temperatureC) ?: singleInstanceLatest
      buildTemperatureInstanceCard(
        kind = "CPU",
        name = cpu.name,
        model = cpu.model ?: latest?.model ?: metrics.device.cpuModel,
        points = points,
        latestC = temperature,
        selectedWindow = selectedWindow
      )?.let { card ->
        add(card)
        seenIds += cpu.id
      }
    }
    metrics.latest.cpuPackages.forEach { cpu ->
      if (cpu.id in seenIds) return@forEach
      buildTemperatureInstanceCard(
        kind = "CPU",
        name = cpu.name,
        model = cpu.model ?: metrics.device.cpuModel,
        points = singleInstanceFallback,
        latestC = validTemperature(cpu.temperatureC) ?: singleInstanceLatest,
        selectedWindow = selectedWindow
      )?.let(::add)
    }
  }
  return cards
}

internal fun buildGpuTemperatureCards(metrics: MetricsDto, selectedWindow: MetricWindow): List<MetricCardModel> {
  val latestById = metrics.latest.gpus.associateBy { it.id }
  val instanceIds = (metrics.series.gpus.map { it.id } + metrics.latest.gpus.map { it.id }).toSet()
  val singleInstanceFallback = if (instanceIds.size == 1) gpuTemperaturePoints(metrics) else emptyList()
  val singleInstanceLatest = if (instanceIds.size == 1) gpuLatestTemperature(metrics) else null
  val cards = buildList {
    val seenIds = mutableSetOf<String>()
    metrics.series.gpus.forEach { gpu ->
      val latest = latestById[gpu.id]
      val points = validTemperaturePoints(gpu.temperatureC).ifEmpty { singleInstanceFallback }
      val temperature = validTemperature(latest?.temperatureC) ?: singleInstanceLatest
      buildTemperatureInstanceCard(
        kind = "显卡",
        name = gpu.name,
        model = latest?.name,
        points = points,
        latestC = temperature,
        selectedWindow = selectedWindow
      )?.let { card ->
        add(card)
        seenIds += gpu.id
      }
    }
    metrics.latest.gpus.forEach { gpu ->
      if (gpu.id in seenIds) return@forEach
      buildTemperatureInstanceCard(
        kind = "显卡",
        name = gpu.name,
        model = gpu.name,
        points = singleInstanceFallback,
        latestC = validTemperature(gpu.temperatureC) ?: singleInstanceLatest,
        selectedWindow = selectedWindow
      )?.let(::add)
    }
  }
  return cards
}

internal fun buildTemperatureInstanceCard(
  kind: String,
  name: String?,
  model: String?,
  points: List<SamplePointDto>,
  latestC: Double?,
  selectedWindow: MetricWindow
): MetricCardModel? {
  if (points.isEmpty() && latestC == null) return null
  return MetricCardModel(
    title = temperatureInstanceTitle(kind, name, model),
    value = if (points.isNotEmpty()) metricPoint(points, selectedWindow, ::formatCelsius) else formatCelsius(latestC),
    points = points,
    valueFormatter = ::formatCelsius
  )
}

internal fun temperatureInstanceTitle(kind: String, name: String?, model: String?): String {
  val normalizedModel = model?.trim()?.takeIf { it.isNotEmpty() }
  val normalizedName = name?.trim()?.takeIf { it.isNotEmpty() && !it.equals(normalizedModel, ignoreCase = true) }
  val identity = listOfNotNull(normalizedModel, normalizedName).joinToString(" · ").ifBlank { "未知型号" }
  return "$kind · $identity 温度"
}

internal fun averageTemperaturePointSeries(series: List<List<SamplePointDto>>): List<SamplePointDto> {
  val valuesByTimestamp = linkedMapOf<String, MutableList<Double>>()
  series.flatten().forEach { point ->
    validTemperature(point.value)?.let { value ->
      valuesByTimestamp.getOrPut(point.timestamp) { mutableListOf() }.add(value)
    }
  }
  return valuesByTimestamp
    .map { (timestamp, values) -> SamplePointDto(timestamp, values.average()) }
    .sortedBy { parseTimestampMillis(it.timestamp) ?: Long.MIN_VALUE }
}

internal fun buildDiskTemperatureGroups(metrics: MetricsDto): List<DiskTemperatureGroup> {
  val seriesByKey = linkedMapOf<String, MutableList<DiskMetricSeriesDto>>()
  metrics.series.disks
    .filter { it.temperatureC.any { point -> validDiskTemperature(point.value) != null } }
    .forEach { disk ->
      seriesByKey.getOrPut(diskTemperatureKey(disk)) { mutableListOf() }.add(disk)
    }
  val latestByKey = metrics.latest.disks
    .filter { validDiskTemperature(it.temperatureC) != null }
    .groupBy(::diskTemperatureKey)

  return (seriesByKey.keys + latestByKey.keys)
    .distinct()
    .mapNotNull { key ->
      val seriesItems = seriesByKey[key].orEmpty()
      val latestItems = latestByKey[key].orEmpty()
      val points = averageTemperaturePointSeries(
        seriesItems.map { disk -> disk.temperatureC.filter { validDiskTemperature(it.value) != null } }
      )
      val latestC = latestItems.mapNotNull { validDiskTemperature(it.temperatureC) }.averageOrNull()
      if (points.isEmpty() && latestC == null) return@mapNotNull null
      val model = seriesItems.mapNotNull { it.model?.takeIf(String::isNotBlank) }.firstOrNull()
        ?: latestItems.mapNotNull { it.model?.takeIf(String::isNotBlank) }.firstOrNull()
      val name = seriesItems.mapNotNull { it.name.takeIf(String::isNotBlank) }.firstOrNull()
        ?: latestItems.mapNotNull { it.name.takeIf(String::isNotBlank) }.firstOrNull()
      DiskTemperatureGroup(
        key = key,
        title = physicalDiskTemperatureTitle(key, model, name),
        points = points,
        latestC = latestC
      )
    }
}

internal fun diskTemperatureKey(disk: DiskMetricSeriesDto): String =
  disk.physicalDevice?.trim()?.takeIf { it.isNotEmpty() } ?: disk.id

internal fun diskTemperatureKey(disk: DiskDto): String =
  disk.physicalDevice?.trim()?.takeIf { it.isNotEmpty() } ?: disk.id

internal fun physicalDiskTemperatureTitle(key: String, model: String?, name: String?): String {
  val physicalLabel = when {
    key.contains("PhysicalDrive", ignoreCase = true) -> "硬盘 ${key.substringAfterLast("PhysicalDrive", key)}"
    key.startsWith("/dev/") -> "硬盘 ${key.substringAfterLast('/')}"
    key.startsWith("sd") || key.startsWith("nvme") || key.startsWith("mmcblk") || key.startsWith("vd") || key.startsWith("xvd") -> "硬盘 $key"
    key.matches(Regex("[a-zA-Z]+[0-9]+")) -> "硬盘 $key"
    else -> null
  }
  return listOfNotNull(model, physicalLabel).joinToString(" · ").ifBlank {
    name?.takeIf { it.isNotBlank() }?.let { "硬盘 · $it" } ?: "硬盘"
  }
}

internal data class InstanceOption(val id: String, val title: String, val subtitle: String)

internal fun blockMetricKeys(block: DeviceBlockKey): List<String> = when (block) {
  DeviceBlockKey.Cpu -> listOf("cpuUsage", "cpuFrequency", "cpuTemperature")
  DeviceBlockKey.Gpu -> listOf("gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature")
  DeviceBlockKey.Memory -> listOf("memoryUsage", "swapUsage")
  DeviceBlockKey.Disk -> listOf("diskUsage", "diskRead", "diskWrite")
  DeviceBlockKey.Network -> listOf("networkRxRate", "networkTxRate", "networkTraffic")
  DeviceBlockKey.Temperature -> listOf("temperatureSources")
  DeviceBlockKey.Fan -> emptyList()
}

internal fun metricLabel(metric: String): String = when (metric) {
  "cpuUsage" -> "CPU 占用"
  "cpuFrequency" -> "CPU 频率"
  "cpuTemperature" -> "CPU 温度"
  "gpuUsage" -> "GPU 占用"
  "gpuEncode" -> "GPU 编码"
  "gpuDecode" -> "GPU 解码"
  "gpuFrequency" -> "GPU 频率"
  "gpuMemory" -> "GPU 内存"
  "gpuTemperature" -> "GPU 温度"
  "memoryUsage" -> "内存"
  "swapUsage" -> "虚拟内存"
  "diskUsage" -> "硬盘占用"
  "diskRead" -> "硬盘读取"
  "diskWrite" -> "硬盘写入"
  "networkRxRate" -> "网络接收"
  "networkTxRate" -> "网络发送"
  "networkTraffic" -> "网络流量"
  "temperatureSources" -> "温度源"
  else -> metric
}

internal fun blockInstances(state: AppState, block: DeviceBlockKey): List<InstanceOption> {
  val metrics = state.metrics ?: return emptyList()
  return when (block) {
    DeviceBlockKey.Cpu -> metrics.latest.cpuPackages.map {
      InstanceOption(it.id, it.name, listOfNotNull(it.model, it.logicalCount?.let { c -> "${c}线程" }).joinToString(" · "))
    }
    DeviceBlockKey.Gpu -> metrics.latest.gpus.map {
      InstanceOption(it.id, it.name, it.id)
    }
    DeviceBlockKey.Disk -> metrics.latest.disks.map {
      InstanceOption(it.id, it.name, it.mountPoint)
    }
    DeviceBlockKey.Network -> metrics.latest.networkInterfaces.map {
      InstanceOption(it.id, it.name, it.ipv4.firstOrNull() ?: it.macAddress.orEmpty())
    }
    DeviceBlockKey.Memory, DeviceBlockKey.Temperature, DeviceBlockKey.Fan -> emptyList()
  }
}

internal fun isMetricAvailable(metrics: MetricsDto, key: String): Boolean {
  return metrics.availableMetrics.firstOrNull { it.key == key }?.available ?: true
}

internal data class MetricCardModel(
  val title: String,
  val value: String,
  val points: List<SamplePointDto>,
  val valueFormatter: (Double?) -> String,
  val fixedMaxValue: Double? = null
)

internal fun metricPoint(
  points: List<SamplePointDto>,
  window: MetricWindow,
  formatter: (Double?) -> String,
  zeroMeansMissing: Boolean = false
): String {
  if (zeroMeansMissing && points.isNotEmpty() && points.all { it.value == 0.0 }) {
    return formatter(null)
  }
  return formatter(selectedPointValue(points, window))
}

internal fun selectedPointValue(points: List<SamplePointDto>, window: MetricWindow): Double? = when {
  points.isEmpty() -> null
  window == MetricWindow.OneMinute -> points.lastOrNull()?.value
  else -> points.map { it.value }.average()
}

internal fun temperatureRoleLabel(role: String): String = when (role) {
  "cpu_package" -> "CPU 封装"
  "cpu_core" -> "CPU 核心"
  "gpu_core" -> "GPU 核心"
  "gpu_hotspot" -> "GPU 热点"
  "storage_composite" -> "磁盘综合温度"
  "storage_sensor" -> "磁盘附加传感器"
  "motherboard" -> "主板温度"
  "superio" -> "SuperIO 温度"
  "peci" -> "PECI 温度"
  "acpi_zone" -> "ACPI 热区"
  "threshold" -> "温度阈值"
  "derived" -> "派生温度"
  "unknown" -> "未知温度源"
  else -> role.ifBlank { "未知温度源" }
}

internal fun temperatureSourceLabel(source: String): String = when (source) {
  "librehardwaremonitor" -> "LibreHardwareMonitor"
  "linux-hwmon" -> "Linux hwmon"
  "linux-thermal" -> "Linux thermal"
  "smartctl" -> "smartctl / SMART"
  "windows-storage-reliability" -> "Windows 存储可靠性"
  "cpu-package-shared", "cpuPackageShared" -> "CPU Package 共享"
  else -> source.ifBlank { "未知来源" }
}

internal fun temperatureStatusLabel(status: String): String = when (status) {
  "valid" -> "正常"
  "threshold" -> "阈值"
  "invalid" -> "无效值"
  else -> "不可用"
}

internal fun temperatureValueLabel(sensor: TemperatureSensorDto): String {
  val current = sensor.currentC
  return if (current == null || !current.isFinite()) {
    if (sensor.status == "threshold") "仅阈值" else "—"
  } else {
    formatCelsius(current)
  }
}

internal fun temperatureLimitsLabel(sensor: TemperatureSensorDto): String? {
  val limits = listOfNotNull(
    sensor.highC?.let { "高 ${formatCelsius(it)}" },
    sensor.criticalC?.let { "临界 ${formatCelsius(it)}" },
    sensor.emergencyC?.let { "紧急 ${formatCelsius(it)}" }
  )
  return limits.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

internal fun gpuTemperatureSourceLabel(source: String?): String = when {
  source.isNullOrBlank() -> "未知"
  source == "cpuPackageShared" || source == "cpu-package-shared" -> "CPU 封装共享"
  else -> temperatureSourceLabel(source)
}

internal fun formatPercent(value: Double?): String = if (value == null) "--" else "${"%.1f".format(value)}%"
internal fun formatMHz(value: Double?): String = if (value == null) "--" else "${"%.0f".format(value)} MHz"
internal fun formatCelsius(value: Double?): String = if (value == null) "--" else "${"%.1f".format(value)} °C"
internal fun validTemperature(value: Double?): Double? = value?.takeIf { it.isFinite() && it > 0.0 }
internal fun validTemperaturePoints(points: List<SamplePointDto>): List<SamplePointDto> =
  points.filter { validTemperature(it.value) != null }
internal fun validDiskTemperature(value: Double?): Double? = validTemperature(value)
internal fun formatSpeed(value: Double?): String = formatBytes(value ?: 0.0) + "/s"
internal fun formatDiskHealth(value: String): String = when (value.lowercase()) {
  "good" -> "正常"
  "caution" -> "注意"
  "bad" -> "异常"
  else -> value
}
internal fun formatDate(value: String): String = runCatching {
  java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDate().toString()
}.getOrDefault(value)
internal fun formatDateInclusive(value: String): String = runCatching {
  java.time.OffsetDateTime.parse(value).minusNanos(1).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDate().toString()
}.getOrDefault(value)
internal fun trafficDayLabel(value: String): String = runCatching {
  java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault()).dayOfMonth.toString()
}.getOrDefault(value)
internal fun formatTime(value: String?): String = if (value.isNullOrBlank()) "--" else runCatching {
  val dt = java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDateTime()
  "%04d-%02d-%02d %02d:%02d:%02d".format(dt.year, dt.monthValue, dt.dayOfMonth, dt.hour, dt.minute, dt.second)
}.getOrDefault(value)
internal fun formatChartTime(value: String, window: MetricWindow): String = runCatching {
  val dt = java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault())
  when (window) {
    MetricWindow.OneMinute, MetricWindow.FiveMinutes -> "%02d:%02d:%02d".format(dt.hour, dt.minute, dt.second)
    MetricWindow.OneHour, MetricWindow.SixHours -> "%02d:%02d".format(dt.hour, dt.minute)
    MetricWindow.OneDay, MetricWindow.SevenDays -> "%02d-%02d %02d:%02d".format(dt.monthValue, dt.dayOfMonth, dt.hour, dt.minute)
  }
}.getOrDefault("--")

internal fun buildUsage(used: Long, total: Long): String = "${formatBytes(used.toDouble())} / ${formatBytes(total.toDouble())}"

internal fun buildGpuUsage(used: Long, total: Long): String = if (total > 0) {
  buildUsage(used, total)
} else if (used > 0) {
  "${formatBytes(used.toDouble())} / 容量未知"
} else {
  "容量暂无"
}

internal fun gpuMemoryLabel(memoryKind: String?): String = when (memoryKind) {
  "shared" -> "共享显存"
  "dedicated" -> "独立显存"
  else -> "GPU 内存"
}

internal fun formatGpuMemorySummary(gpus: List<GpuDto>): String = gpus
  .groupBy { gpuMemoryLabel(it.memoryKind) }
  .map { (label, items) ->
    val used = items.sumOf { it.memoryUsedBytes }
    val total = items.sumOf { it.memoryTotalBytes }
    "$label：${buildGpuUsage(used, total)}"
  }
  .ifEmpty { listOf("容量暂无") }
  .joinToString(" · ")

internal fun formatOptionalBytes(value: Long?): String = value?.takeIf { it > 0 }?.let { formatBytes(it.toDouble()) } ?: "未知"
internal fun formatOptionalBytes(value: Double?): String = value?.takeIf { it > 0.0 }?.let(::formatBytes) ?: "未知"
internal fun formatStorageBytes(value: Long?): String = value?.takeIf { it >= 0L }?.let { formatBytes(it.toDouble()) } ?: "无法获取数据"
internal fun formatStorageBytes(value: Double?): String = value?.takeIf { it.isFinite() && it >= 0.0 }?.let(::formatBytes) ?: "无法获取数据"

internal fun formatBytes(value: Double): String {
  if (value <= 0.0) return "0 B"
  val units = listOf("B", "KB", "MB", "GB", "TB")
  var current = value
  var unitIndex = 0
  while (current >= 1024 && unitIndex < units.lastIndex) {
    current /= 1024
    unitIndex += 1
  }
  val precision = if (current >= 100) 0 else 1
  return "%.${precision}f %s".format(current, units[unitIndex])
}

