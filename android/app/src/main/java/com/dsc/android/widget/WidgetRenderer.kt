package com.dsc.android.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import com.dsc.android.R
import kotlin.math.roundToInt

/**
 * 三款组件的唯一绘制入口。
 *
 * 布局只负责结构与默认文字；所有会变的读数、状态色、图表位图都在这里覆盖。
 * 空数据时宁可隐藏图表，也不让 XML 里的示意占位被误读成真实读数。
 */
internal object WidgetRenderer {
  fun render(
    context: Context,
    kind: WidgetKind,
    appWidgetId: Int,
    snapshot: WidgetSnapshot,
    preferences: WidgetPreferences,
    options: Bundle
  ): RemoteViews {
    val scope = RenderScope(context, kind, appWidgetId, snapshot, preferences, options)
    return when (kind) {
      WidgetKind.Fleet -> renderFleet(scope)
      WidgetKind.Device -> renderDevice(scope)
      WidgetKind.Traffic -> renderTraffic(scope)
    }
  }

  private fun renderFleet(scope: RenderScope): RemoteViews {
    val compact = scope.heightDp < 100
    val views = RemoteViews(scope.context.packageName, if (compact) R.layout.widget_fleet_compact else R.layout.widget_fleet)
    val devices = scope.snapshot.devices
    val total = devices.size
    val online = devices.count { it.online }
    val offline = total - online
    val error = scope.snapshot.lastError
    val firstOffline = devices.firstOrNull { !it.online }
    val updatedText = if (scope.snapshot.updatedAt > 0L) {
      "更新 ${WidgetFormat.updated(scope.snapshot.updatedAt)}"
    } else {
      "尚未同步"
    }
    val onlineText = when {
      total == 0 -> "未连接"
      else -> "$online/$total 在线"
    }
    val stateText = when {
      total == 0 && error == null -> "点按连接中枢"
      error != null -> error
      offline > 0 -> "$offline 台离线" + (firstOffline?.let { " · ${WidgetFormat.lastSeen(it.lastSeenAt)}" } ?: "")
      else -> "全部设备在线"
    }
    val stateColor = when {
      error != null || offline > 0 -> scope.color(R.color.widget_warn)
      total == 0 -> scope.color(R.color.widget_accent)
      else -> scope.color(R.color.widget_online)
    }
    val hasOnline = total > 0 && online > 0
    val pillRes = if (hasOnline) R.drawable.widget_pill_online else R.drawable.widget_pill
    val pillDotRes = if (hasOnline) R.drawable.widget_dot_online else R.drawable.widget_dot_offline
    val pillTextColor = if (hasOnline) R.color.widget_online else R.color.widget_offline

    views.setOnClickPendingIntent(R.id.widget_root, WidgetIntents.open(scope.context, scope.appWidgetId, WidgetDestination.TARGET_FLEET))
    views.setContentDescription(
      R.id.widget_root,
      buildString {
        append("观澜，").append(onlineText)
        if (offline > 0) append("，").append(offline).append(" 台离线")
        if (error != null) append("，").append(error)
      }
    )

    if (compact) {
      views.setTextViewText(R.id.fleet_compact_online, onlineText)
      views.setTextColor(R.id.fleet_compact_online, scope.color(pillTextColor))
      views.setInt(R.id.fleet_compact_online_pill, "setBackgroundResource", pillRes)
      views.setImageViewResource(R.id.fleet_compact_dot, pillDotRes)
      val compactState = when {
        total == 0 && error == null -> "点按连接中枢"
        error != null -> error
        offline > 0 -> "$offline 台离线" + (firstOffline?.let { " · ${WidgetFormat.lastSeen(it.lastSeenAt)}" } ?: "")
        else -> "全部在线 · $updatedText"
      }
      views.setTextViewText(R.id.fleet_compact_state, compactState)
      views.setTextColor(R.id.fleet_compact_state, stateColor)
      views.setTextViewText(R.id.fleet_compact_updated, updatedText)
      views.setOnClickPendingIntent(R.id.fleet_compact_refresh, WidgetIntents.refresh(scope.context, scope.appWidgetId))
      return views
    }

    views.setOnClickPendingIntent(R.id.fleet_refresh, WidgetIntents.refresh(scope.context, scope.appWidgetId))
    views.setTextViewText(R.id.fleet_online, onlineText)
    views.setTextColor(R.id.fleet_online, scope.color(pillTextColor))
    views.setInt(R.id.fleet_online_pill, "setBackgroundResource", pillRes)
    views.setImageViewResource(R.id.fleet_online_dot, pillDotRes)
    views.setTextViewText(R.id.fleet_state, stateText)
    views.setTextColor(R.id.fleet_state, stateColor)
    views.setTextViewText(R.id.fleet_updated, updatedText)

    val rowIds = intArrayOf(R.id.fleet_row_1, R.id.fleet_row_2, R.id.fleet_row_3, R.id.fleet_row_4)
    val dividerIds = intArrayOf(0, R.id.fleet_divider_2, R.id.fleet_divider_3, R.id.fleet_divider_4)
    val dotIds = intArrayOf(R.id.fleet_dot_1, R.id.fleet_dot_2, R.id.fleet_dot_3, R.id.fleet_dot_4)
    val nameIds = intArrayOf(R.id.fleet_name_1, R.id.fleet_name_2, R.id.fleet_name_3, R.id.fleet_name_4)
    val cpuIds = intArrayOf(R.id.fleet_cpu_1, R.id.fleet_cpu_2, R.id.fleet_cpu_3, R.id.fleet_cpu_4)
    val memIds = intArrayOf(R.id.fleet_mem_1, R.id.fleet_mem_2, R.id.fleet_mem_3, R.id.fleet_mem_4)
    val diskIds = intArrayOf(R.id.fleet_disk_1, R.id.fleet_disk_2, R.id.fleet_disk_3, R.id.fleet_disk_4)
    val offlineIds = intArrayOf(R.id.fleet_offline_1, R.id.fleet_offline_2, R.id.fleet_offline_3, R.id.fleet_offline_4)
    val hidden = View.GONE
    for (index in 0 until 4) {
      val device = devices.getOrNull(index)
      views.setViewVisibility(rowIds[index], if (device == null) hidden else View.VISIBLE)
      if (dividerIds[index] != 0) {
        views.setViewVisibility(dividerIds[index], if (device == null) hidden else View.VISIBLE)
      }
      if (device == null) continue

      views.setImageViewResource(dotIds[index], if (device.online) R.drawable.widget_dot_online else R.drawable.widget_dot_offline)
      views.setTextViewText(nameIds[index], device.hostname)
      views.setTextColor(nameIds[index], scope.color(if (device.online) R.color.widget_text_primary else R.color.widget_text_secondary))
      views.setOnClickPendingIntent(
        rowIds[index],
        WidgetIntents.open(scope.context, scope.appWidgetId, WidgetDestination.TARGET_DEVICE, device.id)
      )

      if (device.online) {
        views.setViewVisibility(offlineIds[index], hidden)
        intArrayOf(cpuIds[index], memIds[index], diskIds[index]).forEach {
          views.setViewVisibility(it, View.VISIBLE)
        }
        val cpuText = WidgetFormat.percent(device.cpuPercent)
        val memText = WidgetFormat.percent(device.memoryPercent)
        val diskText = WidgetFormat.percent(device.diskPercent)
        views.setTextViewText(cpuIds[index], cpuText)
        views.setTextViewText(memIds[index], memText)
        views.setTextViewText(diskIds[index], diskText)
        views.setTextColor(cpuIds[index], scope.color(valueColor(device.cpuPercent, warnAt = 75.0)))
        views.setTextColor(memIds[index], scope.color(valueColor(device.memoryPercent, warnAt = 80.0)))
        views.setTextColor(diskIds[index], scope.color(valueColor(device.diskPercent, warnAt = 80.0)))
        views.setContentDescription(
          rowIds[index],
          "${device.hostname}，在线，CPU $cpuText，内存 $memText，磁盘 $diskText。点按查看详情"
        )
      } else {
        views.setViewVisibility(offlineIds[index], View.VISIBLE)
        intArrayOf(cpuIds[index], memIds[index], diskIds[index]).forEach {
          views.setViewVisibility(it, hidden)
        }
        views.setTextViewText(offlineIds[index], "离线 · ${WidgetFormat.lastSeen(device.lastSeenAt)}")
        views.setContentDescription(
          rowIds[index],
          "${device.hostname}，离线，最后一次在线 ${WidgetFormat.lastSeen(device.lastSeenAt)}。点按查看详情"
        )
      }
    }

    if (devices.size > 4) {
      views.setTextViewText(R.id.fleet_updated, "$updatedText · 另有 ${devices.size - 4} 台")
    }
    return views
  }

  private fun renderDevice(scope: RenderScope): RemoteViews {
    val wide = scope.widthDp >= 230
    val views = RemoteViews(scope.context.packageName, if (wide) R.layout.widget_device_wide else R.layout.widget_device)
    val device = scope.preferredDevice()
    val series = device?.let { scope.snapshot.cpuSeries[it.id] }.orEmpty()
    val network = device?.let { scope.snapshot.networks[it.id] }
    val error = scope.snapshot.lastError
    val updatedLabel = if (scope.snapshot.updatedAt > 0L) WidgetFormat.updated(scope.snapshot.updatedAt) else "尚未同步"
    val online = device?.online == true
    val meterText = if (device == null) "选择设备" else if (online) "在线" else "离线"
    val pillRes = if (online) R.drawable.widget_pill_online else R.drawable.widget_pill
    val dotRes = if (online) R.drawable.widget_dot_online else R.drawable.widget_dot_offline

    views.setImageViewResource(R.id.device_dot, dotRes)
    views.setTextViewText(R.id.device_name, device?.hostname ?: "选择设备")
    views.setTextColor(R.id.device_name, scope.color(if (device == null || online) R.color.widget_text_primary else R.color.widget_text_secondary))
    views.setOnClickPendingIntent(R.id.device_refresh, WidgetIntents.refresh(scope.context, scope.appWidgetId))
    if (device == null) {
      views.setOnClickPendingIntent(R.id.widget_root, WidgetIntents.open(scope.context, scope.appWidgetId, WidgetDestination.TARGET_FLEET))
    } else {
      views.setOnClickPendingIntent(
        R.id.widget_root,
        WidgetIntents.open(scope.context, scope.appWidgetId, WidgetDestination.TARGET_DEVICE, device.id)
      )
    }

    val gaugeColor = when {
      device == null -> scope.color(R.color.widget_track)
      !online -> scope.color(R.color.widget_offline)
      else -> scope.color(WidgetFormat.cpuColorRes(device.cpuPercent))
    }
    val gaugeDashed = device != null && !online
    views.setImageViewBitmap(
      R.id.device_gauge,
      WidgetCanvas.gauge(
        sizePx = scope.dp(if (wide) 88f else 70f),
        percent = (device?.cpuPercent ?: 0.0).toFloat().coerceIn(0f, 100f),
        color = gaugeColor,
        trackColor = scope.color(R.color.widget_track),
        dashed = gaugeDashed
      )
    )
    views.setTextViewText(R.id.device_cpu_value, WidgetFormat.number(device?.cpuPercent))
    views.setTextViewText(R.id.device_cpu_unit, if (device?.cpuPercent != null) "%" else "")
    views.setTextColor(R.id.device_cpu_value, scope.color(if (online) R.color.widget_text_primary else R.color.widget_text_secondary))

    bindMeter(
      views,
      barId = R.id.device_memory_bar,
      valueId = R.id.device_memory_value,
      value = device?.memoryPercent,
      scope = scope
    )
    bindMeter(
      views,
      barId = R.id.device_disk_bar,
      valueId = R.id.device_disk_value,
      value = device?.diskPercent,
      scope = scope
    )

    val footerText = when {
      device == null -> "点按选择设备"
      error != null -> "刷新失败 · 保留上次数据"
      !online -> "离线 · ${WidgetFormat.lastSeen(device.lastSeenAt)}"
      else -> WidgetFormat.osLabel(device.os)
    }
    views.setTextViewText(R.id.device_footer, footerText)
    views.setTextColor(
      R.id.device_footer,
      scope.color(if (error != null || (!online && device != null)) R.color.widget_warn else R.color.widget_text_tertiary)
    )

    if (wide) {
      views.setTextViewText(R.id.device_os, when {
        device == null -> "尚未连接中枢"
        error != null -> "刷新失败 · 保留上次数据"
        !online -> "离线 · ${WidgetFormat.lastSeen(device.lastSeenAt)}"
        else -> "${WidgetFormat.osLabel(device.os)} · 6 小时"
      })
      views.setTextViewText(R.id.device_online, meterText)
      views.setTextColor(R.id.device_online, scope.color(if (online) R.color.widget_online else R.color.widget_offline))
      views.setInt(R.id.device_online_pill, "setBackgroundResource", pillRes)
      views.setImageViewResource(R.id.device_online_dot, dotRes)
      val peak = series.maxOrNull()?.roundToInt()
      views.setTextViewText(R.id.device_peak, if (peak != null) "峰值 $peak%" else "峰值 —")
      val spark = if (series.size >= 2) {
        WidgetCanvas.sparkline(
          widthPx = scope.dp((scope.widthDp - 14 * 2 - 88 - 18).coerceAtLeast(72).toFloat()),
          heightPx = scope.dp(32f),
          values = series,
          lineColor = scope.color(R.color.widget_accent),
          fillColor = withAlpha(scope.color(R.color.widget_accent), 0x3D)
        )
      } else {
        null
      }
      if (spark != null) {
        views.setViewVisibility(R.id.device_spark, View.VISIBLE)
        views.setImageViewBitmap(R.id.device_spark, spark)
      } else {
        views.setViewVisibility(R.id.device_spark, View.GONE)
      }
      val rx = if (online) WidgetFormat.speed(network?.rxBytesPerSec) else "—"
      val tx = if (online) WidgetFormat.speed(network?.txBytesPerSec) else "—"
      views.setTextViewText(R.id.device_rx, "↓ $rx")
      views.setTextViewText(R.id.device_tx, "↑ $tx")
      views.setTextViewText(R.id.device_footer, "${device?.let { WidgetFormat.osLabel(it.os) } ?: "打开观澜连接中枢"} · 更新于 $updatedLabel")
      views.setTextColor(R.id.device_footer, scope.color(R.color.widget_text_tertiary))
      views.setContentDescription(
        R.id.widget_root,
        if (device == null) "观澜单机组件，点按打开观澜连接中枢"
        else "${device.hostname}，${if (online) "在线" else "离线"}，CPU ${WidgetFormat.percent(device.cpuPercent)}，内存 ${WidgetFormat.percent(device.memoryPercent)}，磁盘 ${WidgetFormat.percent(device.diskPercent)}。点按查看详情"
      )
    } else {
      views.setTextViewText(R.id.device_updated, updatedLabel)
      views.setContentDescription(
        R.id.widget_root,
        if (device == null) "观澜单机组件，点按选择设备"
        else "${device.hostname}，${if (online) "在线" else "离线"}，CPU ${WidgetFormat.percent(device.cpuPercent)}，内存 ${WidgetFormat.percent(device.memoryPercent)}，磁盘 ${WidgetFormat.percent(device.diskPercent)}。点按查看详情"
      )
    }
    return views
  }

  private fun renderTraffic(scope: RenderScope): RemoteViews {
    val wide = scope.widthDp >= 230
    val views = RemoteViews(scope.context.packageName, if (wide) R.layout.widget_traffic_wide else R.layout.widget_traffic)
    val device = scope.preferredDevice()
    val traffic = device?.let { scope.snapshot.traffic[it.id] }
    val error = scope.snapshot.lastError
    val updatedLabel = if (scope.snapshot.updatedAt > 0L) WidgetFormat.updated(scope.snapshot.updatedAt) else "尚未同步"
    val online = device?.online == true
    val dotRes = if (online) R.drawable.widget_dot_online else R.drawable.widget_dot_offline
    val pillRes = if (online) R.drawable.widget_pill_online else R.drawable.widget_pill

    val (downNumber, downUnit) = traffic?.let { WidgetFormat.byteParts(it.todayRxBytes) } ?: ("—" to "")
    views.setTextViewText(R.id.traffic_down_value, downNumber)
    views.setTextViewText(R.id.traffic_down_unit, downUnit)
    val deviceText = when {
      device == null -> "尚未连接"
      !online -> "${device.hostname} · 离线"
      wide -> traffic?.monthLabel?.let { "${device.hostname} · $it" } ?: device.hostname
      else -> device.hostname
    }
    views.setTextViewText(
      R.id.traffic_device,
      if (!wide && error != null && device != null) "$deviceText · 刷新失败" else deviceText
    )
    if (!wide && error != null) {
      views.setTextColor(R.id.traffic_device, scope.color(R.color.widget_warn))
    } else {
      views.setTextColor(R.id.traffic_device, scope.color(R.color.widget_text_tertiary))
    }
    views.setOnClickPendingIntent(R.id.traffic_refresh, WidgetIntents.refresh(scope.context, scope.appWidgetId))
    views.setOnClickPendingIntent(
      R.id.widget_root,
      if (device != null) WidgetIntents.open(scope.context, scope.appWidgetId, WidgetDestination.TARGET_TRAFFIC, device.id)
      else WidgetIntents.open(scope.context, scope.appWidgetId, WidgetDestination.TARGET_FLEET)
    )

    if (traffic == null) {
      views.setTextViewText(R.id.traffic_up, if (error != null) error else "暂无流量数据")
    } else {
      views.setTextViewText(R.id.traffic_up, "↑ ${WidgetFormat.bytes(traffic.todayTxBytes)} · 今日")
    }

    if (wide) {
      views.setTextViewText(R.id.traffic_online, if (online) "在线" else "离线")
      views.setTextColor(R.id.traffic_online, scope.color(if (online) R.color.widget_online else R.color.widget_offline))
      views.setInt(R.id.traffic_online_pill, "setBackgroundResource", pillRes)
      views.setImageViewResource(R.id.traffic_online_dot, dotRes)
      views.setTextViewText(R.id.traffic_up, if (traffic != null) "今日发送 ↑ ${WidgetFormat.bytes(traffic.todayTxBytes)}" else (error ?: "暂无流量数据"))
      views.setTextViewText(
        R.id.traffic_chart_title,
        traffic?.monthLabel?.takeIf { it.isNotBlank() }?.let { "每日总量 · $it" } ?: "每日总量"
      )
      views.setTextViewText(
        R.id.traffic_checked_at,
        when {
          error != null -> "刷新失败"
          scope.snapshot.updatedAt > 0L -> "更新 $updatedLabel"
          else -> updatedLabel
        }
      )
      views.setTextColor(
        R.id.traffic_checked_at,
        scope.color(if (error != null) R.color.widget_warn else R.color.widget_text_tertiary)
      )
      views.setTextViewText(
        R.id.traffic_month_value,
        traffic?.let { WidgetFormat.bytes(it.monthRxBytes + it.monthTxBytes) } ?: "—"
      )
      views.setTextViewText(R.id.traffic_axis_today, traffic?.days?.firstOrNull { it.isToday }?.label ?: "--")
      val days = traffic?.days.orEmpty()
      val chart = if (days.isNotEmpty()) {
        WidgetCanvas.trafficBars(
          widthPx = scope.dp((scope.widthDp - 28 - 152 - 16).coerceAtLeast(80).toFloat()),
          heightPx = scope.dp(62f),
          days = days,
          rxColor = scope.color(R.color.widget_accent),
          txColor = scope.color(R.color.widget_violet),
          trackColor = scope.color(R.color.widget_track)
        )
      } else null
      if (chart != null) {
        views.setViewVisibility(R.id.traffic_chart, View.VISIBLE)
        views.setImageViewBitmap(R.id.traffic_chart, chart)
      } else {
        views.setViewVisibility(R.id.traffic_chart, View.GONE)
      }
    } else {
      views.setTextViewText(
        R.id.traffic_month_value,
        traffic?.let { WidgetFormat.bytes(it.monthRxBytes + it.monthTxBytes) } ?: "—"
      )
      views.setTextViewText(R.id.traffic_month_label, traffic?.monthLabel.orEmpty())
      val days = traffic?.days.orEmpty().filterNot { it.isFuture }.takeLast(14)
      val chart = if (days.isNotEmpty()) {
        WidgetCanvas.trafficBars(
          widthPx = scope.dp((scope.widthDp - 20).coerceAtLeast(60).toFloat()),
          heightPx = scope.dp(34f),
          days = days,
          rxColor = scope.color(R.color.widget_accent),
          txColor = scope.color(R.color.widget_violet),
          trackColor = scope.color(R.color.widget_track)
        )
      } else null
      if (chart != null) {
        views.setViewVisibility(R.id.traffic_chart, View.VISIBLE)
        views.setImageViewBitmap(R.id.traffic_chart, chart)
      } else {
        views.setViewVisibility(R.id.traffic_chart, View.GONE)
      }
    }

    views.setContentDescription(
      R.id.widget_root,
      when {
        device == null -> "观澜流量组件，点按打开观澜连接中枢"
        traffic == null -> "${device.hostname} 流量组件，暂无数据"
        else -> "${device.hostname}，今日接收 ${WidgetFormat.bytes(traffic.todayRxBytes)}，发送 ${WidgetFormat.bytes(traffic.todayTxBytes)}，本月 ${WidgetFormat.bytes(traffic.monthRxBytes + traffic.monthTxBytes)}。点按查看流量"
      }
    )
    return views
  }

  private fun bindMeter(views: RemoteViews, barId: Int, valueId: Int, value: Double?, scope: RenderScope) {
    val progress = (value ?: 0.0).roundToInt().coerceIn(0, 100)
    views.setProgressBar(barId, 100, progress, false)
    views.setTextViewText(valueId, WidgetFormat.percent(value))
    views.setTextColor(valueId, scope.color(valueColor(value, warnAt = 80.0)))
  }

  private fun valueColor(value: Double?, warnAt: Double): Int = when {
    value == null -> R.color.widget_text_tertiary
    value >= 90.0 -> R.color.widget_critical
    value >= warnAt -> R.color.widget_warn
    else -> R.color.widget_text_primary
  }

  private fun withAlpha(color: Int, alpha: Int): Int =
    (color and 0x00FFFFFF) or ((alpha and 0xFF) shl 24)

  private fun RenderScope.preferredDevice(): WidgetDevice? {
    val saved = preferences.deviceFor(appWidgetId)
    return snapshot.devices.firstOrNull { it.id == saved } ?: snapshot.devices.firstOrNull()
  }
}

private class RenderScope(
  val context: Context,
  kind: WidgetKind,
  val appWidgetId: Int,
  val snapshot: WidgetSnapshot,
  val preferences: WidgetPreferences,
  options: Bundle
) {
  private val density = context.resources.displayMetrics.density
  private val fallback = when (kind) {
    WidgetKind.Fleet -> 260 to 110
    WidgetKind.Device, WidgetKind.Traffic -> 160 to 160
  }
  val widthDp: Int = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0).takeIf { it > 0 } ?: fallback.first
  val heightDp: Int = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0).takeIf { it > 0 } ?: fallback.second

  fun dp(value: Float): Int = (value * density).roundToInt().coerceAtLeast(1)

  fun color(resId: Int): Int = ContextCompat.getColor(context, resId)
}
