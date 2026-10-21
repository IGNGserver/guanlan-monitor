package com.dsc.android.widget

import android.content.Context

/**
 * 每个组件实例盯住的设备。
 *
 * 这里只放设备 id 与组件偏好，不触碰访问密钥；凭据仍由 SettingsRepository
 * 的 EncryptedSharedPreferences 持有，组件进程读不到第二份明文。
 */
class WidgetPreferences(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences(
    "dsc_android_widgets",
    Context.MODE_PRIVATE
  )

  fun deviceFor(appWidgetId: Int): String? =
    prefs.getString(deviceKey(appWidgetId), null)?.takeIf { it.isNotBlank() }

  fun setDevice(appWidgetId: Int, deviceId: String) {
    prefs.edit().putString(deviceKey(appWidgetId), deviceId).apply()
  }

  fun remove(appWidgetId: Int) {
    prefs.edit().remove(deviceKey(appWidgetId)).apply()
  }

  private fun deviceKey(appWidgetId: Int): String = "device_$appWidgetId"
}
