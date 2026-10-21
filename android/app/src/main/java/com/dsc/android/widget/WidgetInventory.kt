package com.dsc.android.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context

/**
 * 以 launcher 实际持有的组件 id 为准，而不是“用户添加过”的偏好记录。
 * 删除组件后 WorkManager 会据此停止周期刷新，不会在后台空转。
 */
fun readWidgetInventory(context: Context): WidgetInventory {
  val manager = AppWidgetManager.getInstance(context.applicationContext)
  fun ids(provider: Class<*>) = manager.getAppWidgetIds(ComponentName(context.applicationContext, provider)).toList()

  return WidgetInventory(
    fleetIds = ids(FleetWidgetProvider::class.java),
    deviceIds = ids(DeviceWidgetProvider::class.java),
    trafficIds = ids(TrafficWidgetProvider::class.java)
  )
}
