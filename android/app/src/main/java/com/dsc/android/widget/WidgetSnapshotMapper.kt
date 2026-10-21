package com.dsc.android.widget

import com.dsc.android.DeviceSummaryDto
import com.dsc.android.OverviewInstanceSeriesDto
import com.dsc.android.SamplePointDto
import com.dsc.android.TrafficCalendarDto
import java.io.IOException
import java.time.Instant
import java.time.OffsetDateTime
import kotlin.math.roundToInt
import retrofit2.HttpException

internal object WidgetSnapshotMapper {
  const val SERIES_POINTS = 40

  fun devices(values: List<DeviceSummaryDto>): List<WidgetDevice> =
    values
      .sortedWith(compareBy<DeviceSummaryDto> { it.sortOrder ?: Int.MAX_VALUE }.thenBy { it.hostname })
      .map { device ->
        WidgetDevice(
          id = device.deviceId,
          hostname = device.hostname,
          os = device.os,
          status = device.status,
          lastSeenAt = device.lastSeenAt,
          cpuPercent = device.cpuUsagePercent,
          memoryPercent = device.memoryUsagePercent,
          diskPercent = device.diskUsagePercent,
          sortOrder = device.sortOrder
        )
      }

  fun cpuSeries(instances: List<OverviewInstanceSeriesDto>): Map<String, List<Float>> =
    instances.associate { instance ->
      instance.deviceId to downsample(instance.cpuUsagePercent)
    }.filterValues { it.isNotEmpty() }

  fun networks(instances: List<OverviewInstanceSeriesDto>): Map<String, WidgetNetwork> =
    instances.associate { instance ->
      instance.deviceId to WidgetNetwork(
        rxBytesPerSec = instance.networkRxBytesPerSec.lastOrNull()?.value,
        txBytesPerSec = instance.networkTxBytesPerSec.lastOrNull()?.value
      )
    }

  /**
   * 月度总量直接加中枢给的 primary-scope 日格，不在客户端重算时间序列。
   * 未来日期保留空柱位，让“这是本月的哪一天”一眼可见，而不是用假数据补满。
   */
  fun traffic(calendar: TrafficCalendarDto, now: Instant = Instant.now()): WidgetTraffic {
    val primary = calendar.cells
      .filter { it.isInPrimaryScope }
      .sortedBy { runCatching { OffsetDateTime.parse(it.rangeStart).toInstant() }.getOrDefault(Instant.EPOCH) }
    val days = primary.map { cell ->
      val start = runCatching { OffsetDateTime.parse(cell.rangeStart).toInstant() }.getOrNull()
      WidgetTrafficDay(
        label = cell.label,
        rxBytes = cell.totalRxBytes,
        txBytes = cell.totalTxBytes,
        isToday = cell.isCurrentPeriod,
        isFuture = start != null && start.isAfter(now)
      )
    }
    val anchor = runCatching { OffsetDateTime.parse(calendar.anchor) }.getOrNull()
    val selected = runCatching { OffsetDateTime.parse(calendar.rangeStart) }.getOrNull()
    return WidgetTraffic(
      todayRxBytes = calendar.totalRxBytes,
      todayTxBytes = calendar.totalTxBytes,
      monthRxBytes = primary.sumOf { it.totalRxBytes },
      monthTxBytes = primary.sumOf { it.totalTxBytes },
      monthLabel = anchor?.let { "${it.monthValue} 月" }.orEmpty(),
      todayLabel = selected?.let { "${it.monthValue} 月 ${it.dayOfMonth} 日" }.orEmpty(),
      days = days
    )
  }

  fun downsample(points: List<SamplePointDto>, maxPoints: Int = SERIES_POINTS): List<Float> {
    val values = points.mapNotNull { point -> point.value.takeIf { it.isFinite() }?.toFloat() }
    if (values.size <= maxPoints) return values
    if (maxPoints <= 1) return listOf(values.last())
    val step = (values.size - 1).toDouble() / (maxPoints - 1).toDouble()
    return List(maxPoints) { index -> values[(index * step).roundToInt().coerceIn(0, values.lastIndex)] }
  }

  fun friendlyError(error: Throwable): String = when {
    error is WidgetSetupRequiredException -> error.message.orEmpty()
    error is HttpException && error.code() in setOf(401, 403) -> "访问密钥失效，请打开观澜重新连接"
    error is HttpException && error.code() == 404 -> "中枢找不到组件数据，请检查地址与端口"
    error is IOException -> "网络不可达，请检查中枢连接"
    else -> "刷新失败，请稍后重试"
  }

  fun updatedLabel(updatedAt: Long, now: Long = System.currentTimeMillis()): String {
    if (updatedAt <= 0L) return "尚未同步"
    val minutes = ((now - updatedAt).coerceAtLeast(0L) / 60_000L).toInt()
    return when {
      minutes <= 0 -> "刚刚"
      minutes < 60 -> "${minutes} 分钟前"
      minutes < 24 * 60 -> "${minutes / 60} 小时前"
      else -> "${minutes / (24 * 60)} 天前"
    }
  }
}

internal class WidgetSetupRequiredException(message: String) : IllegalStateException(message)
