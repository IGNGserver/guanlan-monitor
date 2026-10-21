package com.dsc.android.widget

import android.app.Application
import android.content.Context
import com.dsc.android.ApiFactory
import com.dsc.android.LoginRequestDto
import com.dsc.android.SettingsRepository
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

/**
 * 组件专用读路径：登录一次，只拉三款组件真正需要的页面。
 *
 * 不在客户端自己算历史序列，也不请求 metric-config；服务端的
 * traffic-calendar 与 overview/metrics 就是 App 页面使用的同一口径。
 */
class WidgetDataLoader(
  context: Context,
  private val settingsRepository: SettingsRepository = SettingsRepository(context.applicationContext as Application),
  private val preferences: WidgetPreferences = WidgetPreferences(context.applicationContext)
) {
  private val application: Application = context.applicationContext as Application
  suspend fun refresh(inventory: WidgetInventory, previous: WidgetSnapshot): WidgetSnapshot =
    withContext(Dispatchers.IO) {
      val config = settingsRepository.settings().first()
      if (config.baseUrl.isBlank()) {
        throw WidgetSetupRequiredException("尚未连接中枢，请打开观澜完成设置")
      }
      if (config.accessKey.isBlank()) {
        throw WidgetSetupRequiredException("缺少访问密钥，请打开观澜重新连接")
      }

      val (api, _, _) = ApiFactory(application).create(config.baseUrl)
      api.login(LoginRequestDto(config.accessKey))
      val devices = WidgetSnapshotMapper.devices(api.devices())
      val now = Instant.now()
      val deviceIds = devices.map { it.id }.toSet()
      val errors = mutableListOf<String>()

      var cpuSeries = previous.cpuSeries.filterKeys { it in deviceIds }
      var networks = previous.networks.filterKeys { it in deviceIds }
      if (inventory.deviceIds.isNotEmpty()) {
        runCatching {
          val overview = api.overviewMetrics(
            window = "6h",
            pointBudget = WidgetSnapshotMapper.SERIES_POINTS
          )
          cpuSeries = WidgetSnapshotMapper.cpuSeries(overview.instances)
          networks = WidgetSnapshotMapper.networks(overview.instances)
        }.onFailure {
          errors += "趋势数据未刷新"
        }
      }

      val trafficDevices = inventory.trafficIds
        .mapNotNull { widgetId -> preferences.deviceFor(widgetId) ?: devices.firstOrNull()?.id }
        .toSet()
      val traffic = previous.traffic.filterKeys { it in trafficDevices }.toMutableMap()
      trafficDevices.forEach { deviceId ->
        runCatching {
          val calendar = api.trafficCalendar(
            deviceId = deviceId,
            mode = "day",
            anchor = now.toString()
          )
          traffic[deviceId] = WidgetSnapshotMapper.traffic(calendar, now)
        }.onFailure {
          errors += "流量数据未刷新"
        }
      }

      WidgetSnapshot(
        updatedAt = System.currentTimeMillis(),
        lastAttemptAt = System.currentTimeMillis(),
        devices = devices,
        cpuSeries = cpuSeries,
        networks = networks,
        traffic = traffic,
        lastError = errors.distinct().take(2).joinToString("；").ifBlank { null }
      )
    }

  /** 配置页首次添加组件时，不要求先打开 App：直接读一次设备列表。 */
  suspend fun loadDevicesOnly(): List<WidgetDevice> = withContext(Dispatchers.IO) {
    val config = settingsRepository.settings().first()
    if (config.baseUrl.isBlank()) {
      throw WidgetSetupRequiredException("尚未连接中枢，请打开观澜完成设置")
    }
    if (config.accessKey.isBlank()) {
      throw WidgetSetupRequiredException("缺少访问密钥，请打开观澜重新连接")
    }
    val (api, _, _) = ApiFactory(application).create(config.baseUrl)
    api.login(LoginRequestDto(config.accessKey))
    WidgetSnapshotMapper.devices(api.devices())
  }
}
