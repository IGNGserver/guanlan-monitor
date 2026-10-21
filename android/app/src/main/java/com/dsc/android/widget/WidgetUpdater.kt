package com.dsc.android.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.os.Bundle
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 把同一份快照映射到三套布局。缓存为空时也照常画空状态，
 * 这样 launcher 在第一次刷新前不会留一块空白卡片。
 */
object WidgetUpdater {
  private const val TAG = "GuanlanWidget"

  suspend fun updateAll(context: Context) = withContext(Dispatchers.Default) {
    val appContext = context.applicationContext
    val snapshot = WidgetSnapshotStore(appContext).read() ?: WidgetSnapshot()
    val preferences = WidgetPreferences(appContext)
    val inventory = readWidgetInventory(appContext)
    val manager = AppWidgetManager.getInstance(appContext)
    renderAll(manager, appContext, inventory.fleetIds, WidgetKind.Fleet, snapshot, preferences)
    renderAll(manager, appContext, inventory.deviceIds, WidgetKind.Device, snapshot, preferences)
    renderAll(manager, appContext, inventory.trafficIds, WidgetKind.Traffic, snapshot, preferences)
  }

  suspend fun updateIds(context: Context, kind: WidgetKind, ids: List<Int>) = withContext(Dispatchers.Default) {
    if (ids.isEmpty()) return@withContext
    val appContext = context.applicationContext
    val snapshot = WidgetSnapshotStore(appContext).read() ?: WidgetSnapshot()
    val preferences = WidgetPreferences(appContext)
    renderAll(AppWidgetManager.getInstance(appContext), appContext, ids, kind, snapshot, preferences)
  }

  private fun renderAll(
    manager: AppWidgetManager,
    context: Context,
    ids: List<Int>,
    kind: WidgetKind,
    snapshot: WidgetSnapshot,
    preferences: WidgetPreferences
  ) {
    ids.forEach { id ->
      runCatching {
        val options = manager.getAppWidgetOptions(id) ?: Bundle()
        val views = WidgetRenderer.render(context, kind, id, snapshot, preferences, options)
        manager.updateAppWidget(id, views)
      }.onFailure { error ->
        Log.w(TAG, "failed to render ${kind.name} widget $id", error)
      }
    }
  }
}
