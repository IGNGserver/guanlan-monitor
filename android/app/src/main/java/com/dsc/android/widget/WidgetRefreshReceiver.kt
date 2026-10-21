package com.dsc.android.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 组件上的刷新按钮只负责入队，真正的网络与重绘由 WorkManager 承担。 */
class WidgetRefreshReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_REFRESH) return
    WidgetRefreshScheduler.requestImmediate(context.applicationContext, manual = true)
  }

  companion object {
    const val ACTION_REFRESH = "com.dsc.android.widget.action.REFRESH"
  }
}
