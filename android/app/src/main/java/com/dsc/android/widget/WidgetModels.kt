package com.dsc.android.widget

import kotlinx.serialization.Serializable

/**
 * 桌面组件自己的只读快照。
 *
 * 它和 App 的离线缓存刻意分开：组件没有登录页，也不应该把完整指标库塞进
 * launcher 的更新路径。这里只保留三款组件真正会画的字段。
 */
@Serializable
data class WidgetSnapshot(
  val version: Int = 1,
  val updatedAt: Long = 0L,
  val lastAttemptAt: Long = 0L,
  val devices: List<WidgetDevice> = emptyList(),
  val cpuSeries: Map<String, List<Float>> = emptyMap(),
  val networks: Map<String, WidgetNetwork> = emptyMap(),
  val traffic: Map<String, WidgetTraffic> = emptyMap(),
  val lastError: String? = null
)

@Serializable
data class WidgetDevice(
  val id: String,
  val hostname: String,
  val os: String,
  val status: String,
  val lastSeenAt: String? = null,
  val cpuPercent: Double? = null,
  val memoryPercent: Double? = null,
  val diskPercent: Double? = null,
  val sortOrder: Int? = null
) {
  val online: Boolean get() = status == "online"
}

@Serializable
data class WidgetNetwork(
  val rxBytesPerSec: Double? = null,
  val txBytesPerSec: Double? = null
)

@Serializable
data class WidgetTraffic(
  val todayRxBytes: Double = 0.0,
  val todayTxBytes: Double = 0.0,
  val monthRxBytes: Double = 0.0,
  val monthTxBytes: Double = 0.0,
  val monthLabel: String = "",
  val todayLabel: String = "",
  val days: List<WidgetTrafficDay> = emptyList()
)

@Serializable
data class WidgetTrafficDay(
  val label: String,
  val rxBytes: Double = 0.0,
  val txBytes: Double = 0.0,
  val isToday: Boolean = false,
  val isFuture: Boolean = false
)

/** 当前桌面上真实存在的组件，以及这次刷新需要额外读取的数据。 */
data class WidgetInventory(
  val fleetIds: List<Int> = emptyList(),
  val deviceIds: List<Int> = emptyList(),
  val trafficIds: List<Int> = emptyList()
) {
  val hasWidgets: Boolean get() = fleetIds.isNotEmpty() || deviceIds.isNotEmpty() || trafficIds.isNotEmpty()
  val allIds: List<Int> get() = fleetIds + deviceIds + trafficIds
}

enum class WidgetKind {
  Fleet,
  Device,
  Traffic
}

data class WidgetDestination(
  val target: String,
  val deviceId: String? = null
) {
  companion object {
    const val TARGET_FLEET = "fleet"
    const val TARGET_DEVICE = "device"
    const val TARGET_TRAFFIC = "traffic"

    fun from(target: String?, deviceId: String?): WidgetDestination? =
      when (target) {
        TARGET_FLEET -> WidgetDestination(TARGET_FLEET)
        TARGET_DEVICE -> deviceId?.takeIf { it.isNotBlank() }?.let { WidgetDestination(TARGET_DEVICE, it) }
        TARGET_TRAFFIC -> deviceId?.takeIf { it.isNotBlank() }?.let { WidgetDestination(TARGET_TRAFFIC, it) }
        else -> null
      }
  }
}
