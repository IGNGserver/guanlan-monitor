package com.dsc.android

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ServerConfig(
  val baseUrl: String = "",
  val accessKey: String = "",
  val cacheIdentity: String = "",
  val networkMode: String = "auto"
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
  val group: String? = null,
)

@Serializable
data class DeviceReorderPayloadDto(
  val deviceIds: List<String>
)

@Serializable
data class DeviceGroupUpdatePayloadDto(
  val deviceIds: List<String>,
  val group: String? = null
)

@Serializable
data class DeviceGroupUpdateResponseDto(
  val ok: Boolean = true,
  val group: String? = null
)

@Serializable
data class UpdateInfoDto(
  val versionCode: Long? = null,
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
  val rpmStatus: String? = null,
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
data class StoragePoolDto(
  val id: String,
  val name: String,
  val kind: String,
  val source: String? = null,
  val node: String? = null,
  val mountPoint: String? = null,
  val device: String? = null,
  val volumeGroup: String? = null,
  val thinPool: String? = null,
  val physicalDevices: List<String> = emptyList(),
  val content: List<String> = emptyList(),
  val active: Boolean? = null,
  val enabled: Boolean? = null,
  val shared: Boolean? = null,
  val totalBytes: Long = 0,
  val usedBytes: Long = 0,
  val availableBytes: Long? = null,
  val dataPercent: Double? = null,
  val metadataPercent: Double? = null,
  val health: String? = null
)

@Serializable
data class StoragePoolMetricSeriesDto(
  val id: String,
  val name: String,
  val kind: String,
  val node: String? = null,
  val mountPoint: String? = null,
  val active: Boolean = true,
  val shared: Boolean = false,
  val totalBytes: List<SamplePointDto> = emptyList(),
  val usedBytes: List<SamplePointDto> = emptyList(),
  val availableBytes: List<SamplePointDto> = emptyList(),
  val usagePercent: List<SamplePointDto> = emptyList()
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
  val storagePools: List<StoragePoolMetricSeriesDto> = emptyList(),
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
  val group: String? = null,
)

@Serializable
data class DeviceLatestDto(
  val hardwareSampledAt: String? = null,
  val cpuTemperatureSampledAt: String? = null,
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
  val storagePools: List<StoragePoolDto> = emptyList(),
  val networkInterfaces: List<NetworkInterfaceDto> = emptyList(),
  val gpus: List<GpuDto> = emptyList(),
  val sensorBackends: List<SensorBackendDto> = emptyList(),
  val fans: List<FanDto> = emptyList(),
  val temperatureSensors: List<TemperatureSensorDto> = emptyList()
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
  val observedAt: String? = null,
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
  val series: DeviceMetricSeriesDto,
  val sampling: SamplingDto? = null
)

@Serializable
data class OverviewInstanceSeriesDto(
  val deviceId: String,
  val hostname: String,
  val cpuUsagePercent: List<SamplePointDto> = emptyList(),
  val memoryUsedBytes: List<SamplePointDto> = emptyList(),
  val diskUsedBytes: List<SamplePointDto> = emptyList(),
  val networkRxBytesPerSec: List<SamplePointDto> = emptyList(),
  val networkTxBytesPerSec: List<SamplePointDto> = emptyList()
)

@Serializable
data class OverviewMetricsDto(
  val window: String,
  val instances: List<OverviewInstanceSeriesDto> = emptyList(),
  val sampling: SamplingDto? = null
)

@Serializable
data class SamplingDto(val method: String, val targetPoints: Int)

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
  SevenDays("7d", "7 天");

  companion object {
    /** 服务端快照里的粒度值 → 枚举；未知值返回 null，由调用方决定回落策略。 */
    fun fromValue(value: String?): MetricWindow? = entries.firstOrNull { it.value == value }
  }
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
  Storage("storage", "存储池"),
  Network("network", "网络"),
  Temperature("temperature", "温度"),
  Fan("fan", "风扇转速")
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
  Traffic,

  /** One UI 重构新增的一级目的地：登出、外观、版本与更新从设备列表顶栏迁出。 */
  Settings,

  /** 一级目的地：所有设备「需要关注」的问题按严重程度汇总。 */
  Attention
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
  /** 读取失败的原因：错误必须留在页面上并带重试出口，而不是只闪一条 Snackbar（交）。 */
  val metricsError: String? = null,
  val trafficError: String? = null,
  val devices: List<DeviceSummaryDto> = emptyList(),
  val selectedDeviceId: String? = null,
  val focusedBlock: DeviceBlockKey? = null,
  val selectedWindow: MetricWindow = MetricWindow.FiveMinutes,
  /** 首页趋势小图的时间范围：与设备页粒度分开，首页看大势、设备页看细节。 */
  val overviewWindow: MetricWindow = MetricWindow.OneHour,
  val metrics: MetricsDto? = null,
  /**
   * 关注规则用的各设备指标快照（温度、硬盘健康、存储池只在指标里有）。
   * 每分钟后台拉一次，也复用打开设备页时读到的快照。
   */
  val attentionMetrics: Map<String, MetricsDto> = emptyMap(),
  val attentionCheckedAt: String? = null,
  val overviewMetrics: OverviewMetricsDto? = null,
  val trafficCalendar: TrafficCalendarDto? = null,
  val trafficMode: TrafficCalendarMode = TrafficCalendarMode.Day,
  val metricConfig: DeviceMetricConfigDto? = null,
  val metricConfigDraft: List<String> = emptyList(),
  val enabledDeviceIdsDraft: Map<String, List<String>> = emptyMap(),
  val instanceMetricConfigDraft: Map<String, List<String>> = emptyMap(),
  val editingDeviceId: String? = null,
  val editingBlockKey: DeviceBlockKey? = null,
  val editingInstanceId: String? = null,
  val savingMetricConfig: Boolean = false,
  val updateInfo: UpdateInfoDto? = null,
  val updateChannel: String = if (BuildConfig.RELEASE_CHANNEL == "stable") "stable" else "preview",
  val updateDownloading: Boolean = false,
  val updateProgress: Float = 0f,
  val updateInstallerUri: String? = null,
  val currentScreen: AppScreen = AppScreen.Login,
  /**
   * 页面返回栈：预见式返回期间需要先把上一页作为实时底层页面绘制出来，
   * 因此不能只把它保存在 ViewModel 的私有变量里。
   */
  val screenBackStack: List<AppScreen> = emptyList(),
  val transitionDirection: ScreenTransitionDirection = ScreenTransitionDirection.None,
  /** 当前可见的实时视图（进程 / 容器 / 实时曲线）；离开页面即清空，不在后台轮询。 */
  val live: LiveUiState? = null,
  val message: String? = null
)

/* ---------- 实时查询（只读、临时，不进历史时间序列；与 packages/shared/src/live.ts 对齐） ---------- */

enum class LiveTopic(val value: String) {
  Metrics("metrics"),
  Processes("processes"),
  Docker("docker")
}

@Serializable
data class LiveConnectionDto(
  val state: String = "disconnected",
  val sessionId: String? = null,
  val capabilities: List<String> = emptyList(),
  val connectedAt: String? = null,
  val identityConflictAt: String? = null
)

@Serializable
data class LiveMetricsDto(
  val observedAt: String,
  val cpuPercent: Double? = null,
  val memoryUsedBytes: Double? = null,
  val memoryTotalBytes: Double? = null,
  val diskReadBytesPerSec: Double? = null,
  val diskWriteBytesPerSec: Double? = null,
  val networkRxBytesPerSec: Double? = null,
  val networkTxBytesPerSec: Double? = null
)

@Serializable
data class LiveProcessDto(
  val id: String,
  val pid: Long,
  val parentPid: Long? = null,
  val name: String,
  val startedAt: String? = null,
  /** 按整机逻辑 CPU 总量归一化，满载为 100%，不是 top 的单核刻度。 */
  val cpuPercent: Double? = null,
  /** 该进程最繁忙的 GPU 引擎占用；平台读不到时为 null，不等于空闲。 */
  val gpuPercent: Double? = null,
  val memoryBytes: Double? = null,
  val threads: Int? = null,
  val status: String? = null
)

@Serializable
data class LiveProcessesDto(
  val observedAt: String,
  val cpuScale: String = "host",
  val memoryKind: String = "rss",
  val totalCount: Int = 0,
  val truncated: Boolean = false,
  val items: List<LiveProcessDto> = emptyList()
)

@Serializable
data class LiveContainerDto(
  val id: String,
  val name: String,
  val image: String = "",
  val state: String = "",
  val status: String = "",
  val project: String? = null,
  val cpuPercent: Double? = null,
  val memoryBytes: Double? = null,
  val memoryLimitBytes: Double? = null,
  val networkRxBytes: Double? = null,
  val networkTxBytes: Double? = null,
  val blockReadBytes: Double? = null,
  val blockWriteBytes: Double? = null
)

@Serializable
data class LiveDockerDto(
  val observedAt: String,
  val engineId: String = "",
  val totalCount: Int = 0,
  val truncated: Boolean = false,
  val items: List<LiveContainerDto> = emptyList(),
  val statsCandidates: Int? = null,
  val statsRead: Int? = null
)

@Serializable
data class LiveSnapshotDto<T>(
  val deviceId: String,
  val sessionId: String,
  val requestId: String = "",
  val topic: String,
  val receivedAt: String,
  val data: T
)

data class LiveSample(val atMillis: Long, val data: LiveMetricsDto)

data class LiveFailure(val code: String?, val title: String, val detail: String, val transient: Boolean)

enum class LiveResetState { Idle, Pending, Done, Failed }

/** 一个设备、一个主题的实时视图状态；只在对应页面可见时存在。 */
data class LiveUiState(
  val deviceId: String,
  val topic: LiveTopic,
  val intervalSeconds: Int,
  val paused: Boolean = false,
  val sessionId: String? = null,
  val receivedAt: String? = null,
  val lastConfirmedMillis: Long = 0L,
  val metrics: LiveMetricsDto? = null,
  val samples: List<LiveSample> = emptyList(),
  val processes: LiveProcessesDto? = null,
  val docker: LiveDockerDto? = null,
  val dockerRates: Map<String, ContainerRates> = emptyMap(),
  val failure: LiveFailure? = null,
  val conflictAt: String? = null,
  val resetState: LiveResetState = LiveResetState.Idle
)

data class ContainerRates(
  val networkRx: Double? = null,
  val networkTx: Double? = null,
  val blockRead: Double? = null,
  val blockWrite: Double? = null
)
