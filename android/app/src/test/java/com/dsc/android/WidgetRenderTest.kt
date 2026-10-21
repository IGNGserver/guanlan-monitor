package com.dsc.android

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import android.view.ContextThemeWrapper
import com.dsc.android.widget.WidgetKind
import com.dsc.android.widget.WidgetNetwork
import com.dsc.android.widget.WidgetPreferences
import com.dsc.android.widget.WidgetRenderer
import com.dsc.android.widget.WidgetSnapshot
import com.dsc.android.widget.WidgetTraffic
import com.dsc.android.widget.WidgetTrafficDay
import com.dsc.android.widget.WidgetDevice
import java.io.File
import kotlin.math.roundToInt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * 组件 RemoteViews 的真实展开冒烟测试。
 *
 * 这里不是像素比对：它验证所有 setText/setImage/setViewVisibility 的 view id
 * 在对应布局里真实存在，并把展开后的桌面卡片保存到 build/screenshots 供人工看。
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w400dp-h800dp-xhdpi")
class WidgetRenderTest {
  private val appWidgetId = 101
  private val now = System.currentTimeMillis()

  private val snapshot = WidgetSnapshot(
    updatedAt = now,
    lastAttemptAt = now,
    devices = listOf(
      WidgetDevice("nas", "NAS", "linux", "online", cpuPercent = 8.0, memoryPercent = 63.0, diskPercent = 82.0, sortOrder = 0),
      WidgetDevice("station", "工作站", "windows", "online", cpuPercent = 42.0, memoryPercent = 71.0, diskPercent = 54.0, sortOrder = 1),
      WidgetDevice("mac", "Mac mini", "macos", "online", cpuPercent = 3.0, memoryPercent = 38.0, diskPercent = 22.0, sortOrder = 2),
      WidgetDevice("win", "Windows-dev", "windows", "offline", lastSeenAt = "2026-10-21T12:30:00Z", sortOrder = 3)
    ),
    cpuSeries = mapOf(
      "station" to listOf(18f, 24f, 22f, 31f, 42f, 38f, 44f, 58f, 61f, 51f, 47f, 55f, 49f, 42f, 39f, 46f, 52f, 48f, 44f, 42f)
    ),
    networks = mapOf("station" to WidgetNetwork(rxBytesPerSec = 12.4e6, txBytesPerSec = 1.8e6)),
    traffic = mapOf(
      "station" to WidgetTraffic(
        todayRxBytes = 42.7 * 1024 * 1024 * 1024,
        todayTxBytes = 3.1 * 1024 * 1024 * 1024,
        monthRxBytes = 1.24 * 1024 * 1024 * 1024 * 1024,
        monthTxBytes = 80.0 * 1024 * 1024 * 1024,
        monthLabel = "10 月",
        todayLabel = "10 月 21 日",
        days = (1..31).map { day ->
          WidgetTrafficDay(
            label = day.toString().padStart(2, '0'),
            rxBytes = if (day <= 21) (20 + (day * 7) % 31) * 1024.0 * 1024 * 1024 else 0.0,
            txBytes = if (day <= 21) (2 + day % 6) * 1024.0 * 1024 * 1024 else 0.0,
            isToday = day == 21,
            isFuture = day > 21
          )
        }
      )
    )
  )

  @Test
  fun allVariantsExpandWithoutMissingViews() {
    val context = themedContext(night = false)
    WidgetPreferences(context).setDevice(appWidgetId, "station")

    val fleetCompact = render(context, WidgetKind.Fleet, 320, 70, "fleet-compact-light")
    assertEquals("3/4 在线", fleetCompact.findViewById<TextView>(R.id.fleet_compact_online).text.toString())

    val fleet = render(context, WidgetKind.Fleet, 320, 180, "fleet-light")
    assertEquals("NAS", fleet.findViewById<TextView>(R.id.fleet_name_1).text.toString())
    val device = render(context, WidgetKind.Device, 160, 160, "device-light")
    assertEquals("42", device.findViewById<TextView>(R.id.device_cpu_value).text.toString())
    render(context, WidgetKind.Device, 330, 180, "device-wide-light")
    val traffic = render(context, WidgetKind.Traffic, 160, 160, "traffic-light")
    assertEquals("42.7", traffic.findViewById<TextView>(R.id.traffic_down_value).text.toString())
    render(context, WidgetKind.Traffic, 330, 180, "traffic-wide-light")
  }

  @Test
  fun darkVariantsRenderWithNightResources() {
    val context = themedContext(night = true)
    WidgetPreferences(context).setDevice(appWidgetId, "station")
    render(context, WidgetKind.Fleet, 320, 180, "fleet-dark")
    render(context, WidgetKind.Device, 160, 160, "device-dark")
    render(context, WidgetKind.Traffic, 330, 180, "traffic-wide-dark")
  }

  private fun render(
    context: Context,
    kind: WidgetKind,
    widthDp: Int,
    heightDp: Int,
    name: String
  ): View {
    val options = Bundle().apply {
      putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, widthDp)
      putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, heightDp)
    }
    val views = WidgetRenderer.render(context, kind, appWidgetId, snapshot, WidgetPreferences(context), options)
    val parent = FrameLayout(context)
    val content = views.apply(context, parent)
    parent.addView(
      content,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    val density = context.resources.displayMetrics.density
    val width = (widthDp * density).roundToInt()
    val height = (heightDp * density).roundToInt()
    parent.measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
    )
    parent.layout(0, 0, width, height)
    assertNotNull(content)

    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.parseColor("#DDE3EA"))
    parent.draw(canvas)
    val dir = File("build/screenshots").apply { mkdirs() }
    File(dir, "widget-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    return content
  }

  private fun themedContext(night: Boolean): Context {
    val base = RuntimeEnvironment.getApplication()
    val configuration = Configuration(base.resources.configuration)
    configuration.uiMode = if (night) {
      (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or Configuration.UI_MODE_NIGHT_YES
    } else {
      (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or Configuration.UI_MODE_NIGHT_NO
    }
    val configured = base.createConfigurationContext(configuration)
    return ContextThemeWrapper(configured, R.style.Theme_DeviceStateConsole)
  }
}
