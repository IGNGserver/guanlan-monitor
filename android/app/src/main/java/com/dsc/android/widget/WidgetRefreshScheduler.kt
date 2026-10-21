package com.dsc.android.widget

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * 15 分钟是 WorkManager 周期任务的下限，也是桌面上“够用”的上限：
 * 再快会变成常驻网络轮询，桌面组件不承担实时告警的责任。
 */
object WidgetRefreshScheduler {
  private const val PERIODIC_WORK = "guanlan-widget-periodic"
  private const val IMMEDIATE_WORK = "guanlan-widget-immediate"
  private const val SCHEDULER_PREFS = "dsc_widget_scheduler"
  private const val LAST_SYNC_KEY = "last_sync_at"

  private val constraints = Constraints.Builder()
    .setRequiredNetworkType(NetworkType.CONNECTED)
    .build()

  fun ensurePeriodic(context: Context) {
    if (!readWidgetInventory(context).hasWidgets) return
    val request = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(15, TimeUnit.MINUTES)
      .setConstraints(constraints)
      .setInitialDelay(15, TimeUnit.MINUTES)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
      PERIODIC_WORK,
      ExistingPeriodicWorkPolicy.UPDATE,
      request
    )
  }

  fun requestImmediate(context: Context, manual: Boolean) {
    if (!readWidgetInventory(context).hasWidgets) return
    val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
      .setConstraints(constraints)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
      IMMEDIATE_WORK,
      if (manual) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
      request
    )
  }

  /**
   * App 在前台每 15 秒会成功刷新一次；组件不必跟着每 15 秒打一次中枢。
   * 用 3 分钟节流，既让桌面尽快追上 App，又不把监控变成第二条轮询链。
   */
  fun requestImmediateIfStale(context: Context, minIntervalMs: Long = 3 * 60_000L) {
    if (!readWidgetInventory(context).hasWidgets) return
    val prefs = context.applicationContext.getSharedPreferences(SCHEDULER_PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    if (now - prefs.getLong(LAST_SYNC_KEY, 0L) < minIntervalMs) return
    prefs.edit().putLong(LAST_SYNC_KEY, now).apply()
    requestImmediate(context, manual = false)
  }

  fun cancelIfNoWidgets(context: Context) {
    if (readWidgetInventory(context).hasWidgets) return
    val workManager = WorkManager.getInstance(context.applicationContext)
    workManager.cancelUniqueWork(PERIODIC_WORK)
    workManager.cancelUniqueWork(IMMEDIATE_WORK)
  }

  fun cancelAll(context: Context) {
    val workManager = WorkManager.getInstance(context.applicationContext)
    workManager.cancelUniqueWork(PERIODIC_WORK)
    workManager.cancelUniqueWork(IMMEDIATE_WORK)
  }
}
