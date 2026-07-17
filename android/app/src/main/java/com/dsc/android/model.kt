package com.dsc.android

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ServerConfig(
  val baseUrl: String = "",
  val accessKey: String = ""
)

@Serializable
data class DeviceSummaryDto(
  val deviceId: String,
  val hostname: String,
  val os: String,
  val status: String,
  val lastSeenAt: String? = null,
  val cpuUsagePercent: Double? = null,
  val gpuUsagePercent: Double? = null,
  val gpuMemoryUsagePercent: Double? = null,
  val memoryUsagePercent: Double? = null,
  val diskUsagePercent: Double? = null
)

@Serializable
data class SamplePointDto(
  val timestamp: String,
  val value: Double
)

@Serializable
data class DeviceMetricOptionDto(
  val key: String,
  val available: Boolean
)

@Serializable
data class CpuPackageDto(
  val id: String,
  val name: String,
  val model: String? = null,
  val coreCount: Int? = null,
  val logicalCount: Int? = null,
  val frequencyMHz: Double? = null,
  val usagePercent: Double? = null,
  val temperatureC: Double? = null
)

@Serializable
data class DiskDto(
  val id: String,
  val name: String,
  val mountPoint: String,
  val filesystem: String? = null,
  val model: String? = null,
  val vendor: String? = null,
  val sourceKey: String? = null,
  val totalBytes: Long,
  val usedBytes: Long
)

@Serializable
data class NetworkInterfaceDto(
  val id: String,
  val name: String,
  val macAddress: String? = null,
  val ipv4: List<String> = emptyList(),
  val ipv6: List<String> = emptyList(),
  val rxBytesPerSec: Double? = null,
  val txBytesPerSec: Double? = null,
  val totalRxBytes: Long? = null,
  val totalTxBytes: Long? = null
)

@Serializable
data class GpuDto(
  val id: String,
  val name: String,
  val utilizationPercent: Double,
  val encodeUtilizationPercent: Double? = null,
  val decodeUtilizationPercent: Double? = null,
  val frequencyMHz: Double? = null,
  val memoryUsedBytes: Long,
  val memoryTotalBytes: Long,
  val temperatureC: Double? = null
)

@Serializable
data class FanDto(
  val id: String,
  val label: String,
  val interfaceName: String? = null,
  @SerialName("interface") val interfaceRaw: String? = null,
  val rpm: Int,
  val note: String? = null
)

@Serializable
data class CpuMetricSeriesDto(
  val id: String,
  val name: String,
  val model: String? = null,
  val coreCount: Int? = null,
  val logicalCount: Int? = null,
  val usagePercent: List<SamplePointDto> = emptyList(),
  val frequencyMHz: List<SamplePointDto> = emptyList(),
  val temperatureC: List<SamplePointDto> = emptyList()
)

@Serializable
data class DiskMetricSeriesDto(
  val id: String,
  val name: String,
  val mountPoint: String,
  val filesystem: String? = null,
  val model: String? = null,
  val vendor: String? = null,
  val usagePercent: List<SamplePointDto> = emptyList(),
  val usedBytes: List<SamplePointDto> = emptyList(),
  val readBytesPerSec: List<SamplePointDto> = emptyList(),
  val writeBytesPerSec: List<SamplePointDto> = emptyList(),
  val temperatureC: List<SamplePointDto> = emptyList()
)

@Serializable
data class NetworkMetricSeriesDto(
  val id: String,
  val name: String,
  val macAddress: String? = null,
  val ipv4: List<String> = emptyList(),
  val ipv6: List<String> = emptyList(),
  val rxBytesPerSec: List<SamplePointDto> = emptyList(),
  val txBytesPerSec: List<SamplePointDto> = emptyList(),
  val trafficRxBytes: List<SamplePointDto> = emptyList(),
  val trafficTxBytes: List<SamplePointDto> = emptyList()
)

@Serializable
data class GpuMetricSeriesDto(
  val id: String,
  val name: String,
  val usagePercent: List<SamplePointDto> = emptyList(),
  val encodePercent: List<SamplePointDto> = emptyList(),
  val decodePercent: List<SamplePointDto> = emptyList(),
  val frequencyMHz: List<SamplePointDto> = emptyList(),
  val memoryUsagePercent: List<SamplePointDto> = emptyList(),
  val memoryUsedBytes: List<SamplePointDto> = emptyList(),
  val temperatureC: List<SamplePointDto> = emptyList()
)

@Serializable
data class FanMetricSeriesDto(
  val id: String,
  val name: String,
  @SerialName("interface") val interfaceRaw: String? = null,
  val rpm: List<SamplePointDto> = emptyList()
)

@Serializable
data class DeviceMetricSeriesDto(
  val cpuUsagePercent: List<SamplePointDto> = emptyList(),
  val cpuFrequencyMHz: List<SamplePointDto> = emptyList(),
  val cpuTemperatureC: List<SamplePointDto> = emptyList(),
  val gpuUsagePercent: List<SamplePointDto> = emptyList(),
  val gpuEncodePercent: List<SamplePointDto> = emptyList(),
  val gpuDecodePercent: List<SamplePointDto> = emptyList(),
  val gpuFrequencyMHz: List<SamplePointDto> = emptyList(),
  val gpuMemoryUsagePercent: List<SamplePointDto> = emptyList(),
  val gpuTemperatureC: List<SamplePointDto> = emptyList(),
  val memoryUsagePercent: List<SamplePointDto> = emptyList(),
  val swapUsagePercent: List<SamplePointDto> = emptyList(),
  val diskUsagePercent: List<SamplePointDto> = emptyList(),
  val diskReadBytesPerSec: List<SamplePointDto> = emptyList(),
  val diskWriteBytesPerSec: List<SamplePointDto> = emptyList(),
  val networkRxBytesPerSec: List<SamplePointDto> = emptyList(),
  val networkTxBytesPerSec: List<SamplePointDto> = emptyList(),
  val trafficRxBytes: List<SamplePointDto> = emptyList(),
  val trafficTxBytes: List<SamplePointDto> = emptyList(),
  val cpus: List<CpuMetricSeriesDto> = emptyList(),
  val disks: List<DiskMetricSeriesDto> = emptyList(),
  val networks: List<NetworkMetricSeriesDto> = emptyList(),
  val gpus: List<GpuMetricSeriesDto> = emptyList(),
  val fans: List<FanMetricSeriesDto> = emptyList()
)

@Serializable
data class DeviceDetailDto(
  val deviceId: String,
  val hostname: String,
  val os: String,
  val platform: String,
  val arch: String,
  val cpuModel: String? = null,
  val status: String,
  val lastSeenAt: String? = null,
  val cpuUsagePercent: Double? = null,
  val memoryUsagePercent: Double? = null,
  val diskUsagePercent: Double? = null
)

@Serializable
data class DeviceLatestDto(
  val cpuFrequencyMHz: Double? = null,
  val cpuTemperatureC: Double? = null,
  val memoryUsedBytes: Long = 0,
  val memoryTotalBytes: Long = 0,
  val swapUsedBytes: Long = 0,
  val swapTotalBytes: Long = 0,
  val diskUsedBytes: Long = 0,
  val diskTotalBytes: Long = 0,
  val cpuPackages: List<CpuPackageDto> = emptyList(),
  val disks: List<DiskDto> = emptyList(),
  val networkInterfaces: List<NetworkInterfaceDto> = emptyList(),
  val gpus: List<GpuDto> = emptyList(),
  val sensorBackends: List<SensorBackendDto> = emptyList(),
  val fans: List<FanDto> = emptyList()
)

@Serializable
data class SensorBackendDto(
  val id: String,
  val label: String,
  val ok: Boolean,
  val detail: String? = null
)

@Serializable
data class MetricsDto(
  val status: String,
  val lastSeenAt: String? = null,
  val device: DeviceDetailDto,
  val enabledMetrics: List<String> = emptyList(),
  val enabledDeviceIds: Map<String, List<String>> = emptyMap(),
  val instanceMetricConfig: Map<String, List<String>> = emptyMap(),
  val availableMetrics: List<DeviceMetricOptionDto> = emptyList(),
  val latest: DeviceLatestDto,
  val series: DeviceMetricSeriesDto
)

@Serializable
data class TrafficCalendarCellDto(
  val key: String,
  val label: String,
  val rangeStart: String,
  val rangeEnd: String,
  val totalRxBytes: Double,
  val totalTxBytes: Double,
  val isSelected: Boolean,
  val isCurrentPeriod: Boolean,
  val isInPrimaryScope: Boolean
)

@Serializable
data class TrafficRangeRecordDto(
  val timestamp: String,
  val rxBytes: Double,
  val txBytes: Double,
  val totalBytes: Double
)

@Serializable
data class TrafficCalendarDto(
  val mode: String,
  val anchor: String,
  val title: String,
  val rangeStart: String,
  val rangeEnd: String,
  val cells: List<TrafficCalendarCellDto> = emptyList(),
  val records: List<TrafficRangeRecordDto> = emptyList(),
  val totalRxBytes: Double = 0.0,
  val totalTxBytes: Double = 0.0
)

@Serializable
data class LoginRequestDto(
  val accessKey: String
)

@Serializable
data class LoginResponseDto(
  val ok: Boolean
)

enum class MetricWindow(val value: String, val label: String) {
  OneMinute("1m", "1 分钟"),
  FifteenMinutes("15m", "15 分钟"),
  OneDay("1d", "1 天")
}

enum class TrafficCalendarMode(val value: String, val label: String) {
  Day("day", "日"),
  Week("week", "周"),
  Month("month", "月")
}

enum class DeviceBlockKey(val value: String, val label: String) {
  Cpu("cpu", "CPU"),
  Gpu("gpu", "显卡"),
  Memory("memory", "内存"),
  Disk("disk", "硬盘"),
  Network("network", "网络"),
  Fan("fan", "风扇")
}

@Serializable
data class DeviceMetricConfigDto(
  val deviceId: String,
  val availableMetrics: List<DeviceMetricOptionDto> = emptyList(),
  val enabledMetrics: List<String> = emptyList(),
  val enabledDeviceIds: Map<String, List<String>> = emptyMap(),
  val instanceMetricConfig: Map<String, List<String>> = emptyMap()
)

@Serializable
data class DeviceMetricConfigPayloadDto(
  val enabledMetrics: List<String>,
  val enabledDeviceIds: Map<String, List<String>> = emptyMap(),
  val instanceMetricConfig: Map<String, List<String>> = emptyMap()
)

enum class AppScreen {
  Login,
  DeviceList,
  DeviceDetail,
  Traffic
}

enum class ScreenTransitionDirection {
  Forward,
  Backward,
  None
}

data class AppState(
  val serverConfig: ServerConfig = ServerConfig(),
  val loading: Boolean = true,
  val authenticated: Boolean = false,
  val savingConfig: Boolean = false,
  val loggingIn: Boolean = false,
  val refreshing: Boolean = false,
  val loadingMetrics: Boolean = false,
  val loadingTraffic: Boolean = false,
  val devices: List<DeviceSummaryDto> = emptyList(),
  val selectedDeviceId: String? = null,
  val focusedBlock: DeviceBlockKey? = null,
  val selectedWindow: MetricWindow = MetricWindow.OneMinute,
  val metrics: MetricsDto? = null,
  val trafficCalendar: TrafficCalendarDto? = null,
  val trafficSheetRequested: Boolean = false,
  val trafficMode: TrafficCalendarMode = TrafficCalendarMode.Day,
  val metricConfig: DeviceMetricConfigDto? = null,
  val metricConfigDraft: List<String> = emptyList(),
  val enabledDeviceIdsDraft: Map<String, List<String>> = emptyMap(),
  val instanceMetricConfigDraft: Map<String, List<String>> = emptyMap(),
  val editingDeviceId: String? = null,
  val editingBlockKey: DeviceBlockKey? = null,
  val editingInstanceId: String? = null,
  val savingMetricConfig: Boolean = false,
  val currentScreen: AppScreen = AppScreen.Login,
  val transitionDirection: ScreenTransitionDirection = ScreenTransitionDirection.None,
  val message: String? = null
)
