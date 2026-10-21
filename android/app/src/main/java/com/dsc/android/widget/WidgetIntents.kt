package com.dsc.android.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.dsc.android.MainActivity

/**
 * 组件上的每一个可点区域都要有唯一 data uri。
 * PendingIntent 的相等性只看 action/data/component，不看 extras；不同设备共用
 * 一个 requestCode 时必须靠 data 区分，否则会被错误复用。
 */
object WidgetIntents {
  const val EXTRA_TARGET = "com.dsc.android.widget.extra.TARGET"
  const val EXTRA_DEVICE_ID = "com.dsc.android.widget.extra.DEVICE_ID"
  private const val SCHEME = "guanlan-widget"

  fun open(
    context: Context,
    appWidgetId: Int,
    target: String,
    deviceId: String? = null
  ): PendingIntent {
    val intent = Intent(context, MainActivity::class.java)
      .setData(uri(appWidgetId, target, deviceId))
      .putExtra(EXTRA_TARGET, target)
      .putExtra(EXTRA_DEVICE_ID, deviceId)
      .addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_SINGLE_TOP
      )
    return PendingIntent.getActivity(
      context,
      appWidgetId,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  fun refresh(context: Context, appWidgetId: Int): PendingIntent {
    val intent = Intent(context, WidgetRefreshReceiver::class.java)
      .setAction(WidgetRefreshReceiver.ACTION_REFRESH)
      .setData(uri(appWidgetId, "refresh", null))
    return PendingIntent.getBroadcast(
      context,
      appWidgetId,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun uri(appWidgetId: Int, target: String, deviceId: String?): Uri =
    Uri.Builder()
      .scheme(SCHEME)
      .authority("widget")
      .appendPath(appWidgetId.toString())
      .appendPath(target)
      .apply { if (!deviceId.isNullOrBlank()) appendPath(deviceId) }
      .build()
}
