package com.dsc.android

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

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
  val agentVersion: String? = null,
  val agentChannel: String? = null,
  val status: String,
  val lastSeenAt: String? = null,
  val cpuUsagePercent: Double? = null,
  val gpuUsagePercent: Double? = null,
  val gpuMemoryUsagePercent: Double? = null,
  val memoryUsagePercent: Double? = null,
  val memoryUsedBytes: Long? = null,
  val memoryTotalBytes: Long? = null,
  val diskUsagePercent: Double? = null,
  val diskUsedBytes: Long? = null,
  val diskTotalBytes: Long? = null,
  val sortOrder: Int? = null,
  val instanceType: String = "device",
  val hostName: String? = null,
  val virtualMachine: VirtualMachineIdentityDto? = null
)

@Serializable
data class VirtualMachineIdentityDto(
  val vmId: String,
  val platform: String,
  val externalId: String? = null,
  val node: String? = null,
  val type: String? = null,
  val powerState: String? = null,
  val hostDeviceId: String? = null,
  val hostName: String? = null
)

@Serializable
data class UpdateInfoDto(
  val currentVersion: String = "dev",
  val currentChannel: String = "test",
  val platform: String = "android",
  val arch: String? = null,
  val available: Boolean = false,
  val latestVersion: String? = null,
  val latestChannel: String? = null,
  val releaseTag: String? = null,
  val releaseUrl: String? = null,
  val notesUrl: String? = null,
  val publishedAt: String? = null,
  val assetName: String? = null,
  val assetUrl: String? = null,
  val assetSize: Long? = null,
  val sha256: String? = null,
  val installMode: String = "apk",
  val message: String? = null
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
  val l3CacheBytes: Long? = null,
  val frequencyMHz: Double? = null,
  val usagePercent: Double? = null,
  val temperatureC: Double? = null
)

@Serializable
data class DiskSmartAttributeDto(
  val id: Int,
  val name: String,
  val value: Double,
  val threshold: Double
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
  val physicalDevice: String? = null,
  val temperatureC: Double? = null,
  val healthStatus: String? = null,
  val healthReason: String? = null,
  val healthPercent: Double? = null,
  val smartAttributes: List<DiskSmartAttributeDto> = emptyList(),
  val activePercent: Double? = null,
  val averageResponseMs: Double? = null,
  val interfaceType: String? = null,
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
  val totalTxBytes: Long? = null,
  val linkSpeedMbps: Double? = null,
  val connectionType: String? = null,
  val signalStrengthPercent: Double? = null
)

@Serializable
data class GpuDto(
  val id: String,
  val name: String,
  val utilizationPercent: Double,
  val encodeUtilizationPercent: Double? = null,
  val decodeUtilizationPercent: Double? = null,
  val frequencyMHz: Double? = null,
  val integrated: Boolean = false,
  val memoryKind: String? = null,
  val memoryUsedBytes: Long,
  val memoryTotalBytes: Long,
  val temperatureC: Double? = null,
  val temperatureSource: String? = null,
  val driverVersion: String? = null
)

@Serializable
data class FanDto(
  val id: String,
  val label: String,
  val interfaceName: String? = null,
  @SerialName("interface") val interfaceRaw: String? = null,
  val rpm: Int,
  val note: String? = null,
  val controlMode: String? = null,
  val targetTemperatureC: Double? = null,
  val minPwmPercent: Double? = null,
  val maxPwmPercent: Double? = null,
  val channelState: String? = null
)

@Serializable
data class CpuMetricSeriesDto(
  val id: String,
  val name: String,
  val model: String? = null,
  val coreCount: Int? = null,
  val logicalCount: Int? = null,
  val l3CacheBytes: Long? = null,
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
  val physicalDevice: String? = null,
  val usagePercent: List<SamplePointDto> = emptyList(),
  val activePercent: List<SamplePointDto> = emptyList(),
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
  val integrated: Boolean = false,
  val memoryKind: String? = null,
  val usagePercent: List<SamplePointDto> = emptyList(),
  val encodePercent: List<SamplePointDto> = emptyList(),
  val decodePercent: List<SamplePointDto> = emptyList(),
  val frequencyMHz: List<SamplePointDto> = emptyList(),
  val memoryUsagePercent: List<SamplePointDto> = emptyList(),
  val memoryUsedBytes: List<SamplePointDto> = emptyList(),
  val temperatureC: List<SamplePointDto> = emptyList(),
  val temperatureSource: String? = null
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
  val memoryUsedBytes: List<SamplePointDto> = emptyList(),
  val swapUsedBytes: List<SamplePointDto> = emptyList(),
  val memoryAvailableBytes: List<SamplePointDto> = emptyList(),
  val memoryCachedBytes: List<SamplePointDto> = emptyList(),
  val memoryCommittedBytes: List<SamplePointDto> = emptyList(),
  val memoryCommitLimitBytes: List<SamplePointDto> = emptyList(),
  val systemProcessCount: List<SamplePointDto> = emptyList(),
  val systemThreadCount: List<SamplePointDto> = emptyList(),
  val systemHandleCount: List<SamplePointDto> = emptyList(),
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
  val fans: List<FanMetricSeriesDto> = emptyList(),
  val temperatureSensors: List<TemperatureMetricSeriesDto> = emptyList()
)

@Serializable
data class TemperatureMetricSeriesDto(
  val id: String,
  val name: String,
  val rawName: String,
  val source: String,
  val backend: String? = null,
  val hardware: String? = null,
  val role: String,
  val confidence: String,
  val status: String,
  val currentC: List<SamplePointDto> = emptyList(),
  val highC: Double? = null,
  val criticalC: Double? = null,
  val emergencyC: Double? = null
)

@Serializable
data class DeviceDetailDto(
  val deviceId: String,
  val hostname: String,
  val os: String,
  val platform: String,
  val arch: String,
  val cpuModel: String? = null,
  val agentVersion: String? = null,
  val agentChannel: String? = null,
  val status: String,
  val lastSeenAt: String? = null,
  val cpuUsagePercent: Double? = null,
  val memoryUsagePercent: Double? = null,
  val memoryUsedBytes: Long? = null,
  val memoryTotalBytes: Long? = null,
  val diskUsagePercent: Double? = null,
  val diskUsedBytes: Long? = null,
  val diskTotalBytes: Long? = null,
  val sortOrder: Int? = null,
  val instanceType: String = "device",
  val hostName: String? = null,
  val virtualMachine: VirtualMachineIdentityDto? = null
)

@Serializable
data class DeviceLatestDto(
  val system: SystemStatsDto = SystemStatsDto(),
  val cpuUsagePercent: Double = 0.0,
  val cpuFrequencyMHz: Double? = null,
  val cpuTemperatureC: Double? = null,
  val memoryUsedBytes: Long = 0,
  val memoryTotalBytes: Long = 0,
  val memoryAvailableBytes: Long = 0,
  val memoryCachedBytes: Long = 0,
  val memoryCommittedBytes: Long = 0,
  val memoryCommitLimitBytes: Long = 0,
  val memorySpeedMHz: Double? = null,
  val memorySlotCount: Int? = null,
  val memoryFormFactor: String? = null,
  val swapUsedBytes: Long = 0,
  val swapTotalBytes: Long = 0,
  val diskUsedBytes: Long = 0,
  val diskTotalBytes: Long = 0,
  val networkRxBytesPerSec: Double = 0.0,
  val networkTxBytesPerSec: Double = 0.0,
  val cpuPackages: List<CpuPackageDto> = emptyList(),
  val disks: List<DiskDto> = emptyList(),
  val networkInterfaces: List<NetworkInterfaceDto> = emptyList(),
  val gpus: List<GpuDto> = emptyList(),
  val sensorBackends: List<SensorBackendDto> = emptyList(),
  val fans: List<FanDto> = emptyList(),
  val temperatureSensors: List<TemperatureSensorDto> = emptyList(),
  val virtualization: JsonObject? = null
)

@Serializable
data class TemperatureSensorDto(
  val id: String,
  val source: String,
  val backend: String? = null,
  val hardware: String? = null,
  val hardwareType: String? = null,
  val instanceId: String? = null,
  val path: String? = null,
  val rawName: String,
  val displayName: String? = null,
  val role: String,
  val currentC: Double? = null,
  val highC: Double? = null,
  val criticalC: Double? = null,
  val emergencyC: Double? = null,
  val alarm: Boolean? = null,
  val status: String,
  val confidence: String,
  val note: String? = null
)

@Serializable
data class SystemStatsDto(
  val processCount: Int = 0,
  val threadCount: Int = 0,
  val handleCount: Long = 0
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
  val window: String = "5m",
  val rangeStart: String? = null,
  val rangeEnd: String? = null,
  val device: DeviceDetailDto,
  val enabledMetrics: List<String> = emptyList(),
  val enabledDeviceIds: Map<String, List<String>> = emptyMap(),
  val instanceMetricConfig: Map<String, List<String>> = emptyMap(),
  val availableMetrics: List<DeviceMetricOptionDto> = emptyList(),
  val latest: DeviceLatestDto,
  val series: DeviceMetricSeriesDto
)

@Serializable
data class OverviewInstanceSeriesDto(
  val deviceId: String,
  val hostname: String,
  val instanceType: String = "device",
  val cpuUsagePercent: List<SamplePointDto> = emptyList(),
  val memoryUsedBytes: List<SamplePointDto> = emptyList(),
  val diskUsedBytes: List<SamplePointDto> = emptyList(),
  val networkRxBytesPerSec: List<SamplePointDto> = emptyList(),
  val networkTxBytesPerSec: List<SamplePointDto> = emptyList()
)

@Serializable
data class OverviewMetricsDto(
  val window: String,
  val instances: List<OverviewInstanceSeriesDto> = emptyList()
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
  FiveMinutes("5m", "5 分钟"),
  OneHour("1h", "1 小时"),
  SixHours("6h", "6 小时"),
  OneDay("24h", "24 小时"),
  SevenDays("7d", "7 天")
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
  Temperature("temperature", "温度"),
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

@Serializable
data class FanNotePayloadDto(
  val note: String
)

@Serializable
data class FanNoteResponseDto(
  val ok: Boolean = false,
  val deviceId: String = "",
  val fanId: String = "",
  val note: String = ""
)

enum class AppScreen {
  Login,
  DeviceList,
  DeviceDetail,
  Traffic
}

enum class RemoteDataSource {
  Empty,
  Live,
  Cache
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
  val dataSource: RemoteDataSource = RemoteDataSource.Empty,
  val cacheSavedAt: String? = null,
  val savingConfig: Boolean = false,
  val loggingIn: Boolean = false,
  val refreshing: Boolean = false,
  val loadingMetrics: Boolean = false,
  val loadingTraffic: Boolean = false,
  val devices: List<DeviceSummaryDto> = emptyList(),
  val instanceType: String = "device",
  val selectedDeviceId: String? = null,
  val focusedBlock: DeviceBlockKey? = null,
  val selectedWindow: MetricWindow = MetricWindow.OneMinute,
  val metrics: MetricsDto? = null,
  val overviewMetrics: OverviewMetricsDto? = null,
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
  val savingFanNote: Boolean = false,
  val updateInfo: UpdateInfoDto? = null,
  val updateDownloading: Boolean = false,
  val updateProgress: Float = 0f,
  val updateInstallerUri: String? = null,
  val currentScreen: AppScreen = AppScreen.Login,
  val transitionDirection: ScreenTransitionDirection = ScreenTransitionDirection.None,
  val message: String? = null
)
