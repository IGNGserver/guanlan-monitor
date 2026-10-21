package com.dsc.android.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 三个 provider 的共同壳：先画缓存，再交给 WorkManager 拉新数据。
 * 不在 onUpdate 里同步读网络，否则桌面会因为中枢慢而显示空白。
 */
abstract class MonitoringWidgetProvider : AppWidgetProvider() {
  protected abstract val kind: WidgetKind
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    WidgetRefreshScheduler.ensurePeriodic(context)
    updateAsync(context, appWidgetIds.toList())
    WidgetRefreshScheduler.requestImmediate(context, manual = false)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle
  ) {
    updateAsync(context, listOf(appWidgetId))
  }

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    WidgetRefreshScheduler.ensurePeriodic(context)
    WidgetRefreshScheduler.requestImmediate(context, manual = false)
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    WidgetRefreshScheduler.cancelIfNoWidgets(context)
  }

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    super.onDeleted(context, appWidgetIds)
    val preferences = WidgetPreferences(context)
    appWidgetIds.forEach(preferences::remove)
  }

  private fun updateAsync(context: Context, appWidgetIds: List<Int>) {
    if (appWidgetIds.isEmpty()) return
    val pending = goAsync()
    val appContext = context.applicationContext
    scope.launch {
      try {
        WidgetUpdater.updateIds(appContext, kind, appWidgetIds)
      } finally {
        pending.finish()
      }
    }
  }
}

class FleetWidgetProvider : MonitoringWidgetProvider() {
  override val kind: WidgetKind = WidgetKind.Fleet
}

class DeviceWidgetProvider : MonitoringWidgetProvider() {
  override val kind: WidgetKind = WidgetKind.Device
}

class TrafficWidgetProvider : MonitoringWidgetProvider() {
  override val kind: WidgetKind = WidgetKind.Traffic
}
