package com.dsc.android.widget

import java.time.Duration
import java.time.OffsetDateTime
import kotlin.math.roundToInt

internal object WidgetFormat {
  fun percent(value: Double?): String =
    if (value == null || !value.isFinite()) "—" else "${value.roundToInt()}%"

  fun number(value: Double?): String =
    if (value == null || !value.isFinite()) "—" else value.roundToInt().toString()

  fun byteParts(value: Double): Pair<String, String> {
    val safe = value.coerceAtLeast(0.0)
    if (safe <= 0.0) return "0" to "B"
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var current = safe
    var index = 0
    while (current >= 1024 && index < units.lastIndex) {
      current /= 1024
      index += 1
    }
    val precision = if (current >= 100) 0 else 1
    return "%.${precision}f".format(current) to units[index]
  }

  fun bytes(value: Double): String {
    val (number, unit) = byteParts(value)
    return "$number $unit"
  }

  fun speed(value: Double?): String =
    if (value == null || value <= 0.0) "0 B/s" else "${bytes(value)}/s"

  fun lastSeen(value: String?, now: Long = System.currentTimeMillis()): String {
    if (value.isNullOrBlank()) return "未知"
    val instant = runCatching { OffsetDateTime.parse(value).toInstant() }.getOrElse {
      runCatching { java.time.Instant.parse(value) }.getOrNull()
    } ?: return "未知"
    val minutes = (Duration.between(instant, java.time.Instant.ofEpochMilli(now)).toMinutes()).coerceAtLeast(0)
    return when {
      minutes <= 0 -> "刚刚"
      minutes < 60 -> "${minutes} 分钟前"
      minutes < 24 * 60 -> "${minutes / 60} 小时前"
      else -> "${minutes / (24 * 60)} 天前"
    }
  }

  fun updated(updatedAt: Long, now: Long = System.currentTimeMillis()): String =
    WidgetSnapshotMapper.updatedLabel(updatedAt, now)

  fun cpuColorRes(value: Double?): Int {
    val percent = value ?: return com.dsc.android.R.color.widget_accent
    return when {
      percent >= 90 -> com.dsc.android.R.color.widget_critical
      percent >= 75 -> com.dsc.android.R.color.widget_warn
      else -> com.dsc.android.R.color.widget_accent
    }
  }

  fun osLabel(os: String): String = when (os.trim().lowercase()) {
    "windows", "win" -> "Windows"
    "linux" -> "Linux"
    "macos", "darwin", "osx" -> "macOS"
    "android" -> "Android"
    else -> os.trim().ifBlank { "未知系统" }
  }

  fun deviceSubtitle(device: WidgetDevice): String =
    if (device.online) "在线 · ${osLabel(device.os)}" else "离线 · ${lastSeen(device.lastSeenAt)}"
}
