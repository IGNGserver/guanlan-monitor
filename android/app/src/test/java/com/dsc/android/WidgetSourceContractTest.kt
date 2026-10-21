package com.dsc.android

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 小组件的跨文件契约：provider 信息、manifest、颜色 token 与刷新节奏。
 * 这些内容编译期不会互相校验，靠 review 很容易漏；这里直接扫源码与资源。
 */
class WidgetSourceContractTest {
  private val moduleRoot: File by lazy { findModuleRoot() }

  @Test
  fun providersDeclareResizableHomeWidgetsWithPreview() {
    listOf("fleet", "device", "traffic").forEach { name ->
      val info = moduleRoot.resolve("src/main/res/xml/widget_${name}_info.xml").readText()
      assertTrue("$name 缺少 previewLayout", info.contains("android:previewLayout"))
      assertTrue("$name 必须可横向纵向缩放", info.contains("android:resizeMode=\"horizontal|vertical\""))
      assertTrue("$name 不能依赖系统 updatePeriodMillis", info.contains("android:updatePeriodMillis=\"0\""))
      assertTrue("$name 缺少 description", info.contains("android:description="))
      assertTrue("$name 缺少 targetCell 尺寸", info.contains("android:targetCellWidth"))
      if (name != "fleet") {
        assertTrue("$name 缺少每实例配置入口", info.contains("android:configure=\"com.dsc.android.widget.WidgetConfigureActivity\""))
        assertTrue("$name 不能长按重配", info.contains("android:widgetFeatures=\"reconfigurable\""))
      }
    }
  }

  @Test
  fun manifestRegistersProvidersAndSingleTopMainActivity() {
    val manifest = moduleRoot.resolve("src/main/AndroidManifest.xml").readText()
    listOf("FleetWidgetProvider", "DeviceWidgetProvider", "TrafficWidgetProvider").forEach { provider ->
      assertTrue("manifest 未注册 $provider", manifest.contains(".widget.$provider"))
    }
    assertTrue("缺少 APPWIDGET_UPDATE", manifest.contains("android.appwidget.action.APPWIDGET_UPDATE"))
    assertTrue("缺少组件刷新 receiver", manifest.contains(".widget.WidgetRefreshReceiver"))
    assertTrue("配置页必须导出给 launcher", manifest.contains("WidgetConfigureActivity"))
    assertTrue("MainActivity 必须 singleTop 才能复用实例", manifest.contains("android:launchMode=\"singleTop\""))
  }

  @Test
  fun widgetColorsStayAlignedWithOneUiPalette() {
    val light = parseColors(moduleRoot.resolve("src/main/res/values/colors.xml"))
    val dark = parseColors(moduleRoot.resolve("src/main/res/values-night/colors.xml"))
    val oneUi = moduleRoot.resolve("src/main/java/com/dsc/android/ui/oneui/OneUiColor.kt").readText()

    val expectedLight = mapOf(
      "widget_surface" to "FFFFFF",
      "widget_canvas" to "F2F3F6",
      "widget_hairline" to "E4E6EA",
      "widget_text_primary" to "191B1F",
      "widget_text_secondary" to "5B6069",
      "widget_text_tertiary" to "838993",
      "widget_accent" to "1B76FD",
      "widget_accent_soft" to "E6F0FE",
      "widget_online" to "1AA35A",
      "widget_online_soft" to "E3F6EA",
      "widget_offline" to "838993",
      "widget_warn" to "C87100",
      "widget_critical" to "D93B3B",
      "widget_track" to "F2F3F6",
      "widget_violet" to "7B4DDB"
    )
    val expectedDark = mapOf(
      "widget_surface" to "1B1C1F",
      "widget_canvas" to "000000",
      "widget_hairline" to "2C2E33",
      "widget_text_primary" to "EDEFF2",
      "widget_text_secondary" to "A7ACB5",
      "widget_text_tertiary" to "7F858F",
      "widget_accent" to "4D9BF7",
      "widget_accent_soft" to "17304C",
      "widget_online" to "37D07A",
      "widget_online_soft" to "11311F",
      "widget_offline" to "868C96",
      "widget_warn" to "F0A73C",
      "widget_critical" to "F56B66",
      "widget_track" to "2C2E33",
      "widget_violet" to "A98BF5"
    )
    expectedLight.forEach { (name, value) ->
      assertEquals("浅色 $name 与 One UI token 漂移", value, light[name])
      assertTrue("OneUiColor.kt 找不到浅色 $name 的 $value", oneUi.contains("hex(0x$value)"))
    }
    expectedDark.forEach { (name, value) ->
      assertEquals("深色 $name 与 One UI token 漂移", value, dark[name])
      assertTrue("OneUiColor.kt 找不到深色 $name 的 $value", oneUi.contains("hex(0x$value)"))
    }
  }

  @Test
  fun layoutsUseTheSharedWidgetSurface() {
    listOf("widget_fleet.xml", "widget_fleet_compact.xml", "widget_device.xml", "widget_device_wide.xml", "widget_traffic.xml", "widget_traffic_wide.xml").forEach { name ->
      val layout = moduleRoot.resolve("src/main/res/layout/$name").readText()
      assertTrue("$name 没有使用统一的组件背景", layout.contains("@drawable/widget_background"))
      assertFalse("$name 出现字面色值", layout.contains("android:background=\"#"))
    }
  }

  @Test
  fun schedulerRunsAtFifteenMinutesAndManualRefreshIsWired() {
    val scheduler = moduleRoot.resolve("src/main/java/com/dsc/android/widget/WidgetRefreshScheduler.kt").readText()
    assertTrue("周期刷新不再是 15 分钟", scheduler.contains("15, TimeUnit.MINUTES"))
    assertTrue("周期任务没有网络约束", scheduler.contains("NetworkType.CONNECTED"))
    val receiver = moduleRoot.resolve("src/main/java/com/dsc/android/widget/WidgetRefreshReceiver.kt").readText()
    assertTrue("刷新按钮没有入队", receiver.contains("requestImmediate"))
    val activity = moduleRoot.resolve("src/main/java/com/dsc/android/MainActivity.kt").readText()
    assertTrue("MainActivity 没有消费组件跳转", activity.contains("handleWidgetIntent"))
    assertNotNull(moduleRoot.resolve("src/main/java/com/dsc/android/widget/WidgetConfigureActivity.kt").takeIf { it.isFile })
  }

  private fun parseColors(file: File): Map<String, String> =
    Regex("""<color\s+name="([^"]+)">#([0-9A-Fa-f]+)</color>""")
      .findAll(file.readText())
      .associate { it.groupValues[1] to it.groupValues[2].uppercase() }

  private fun findModuleRoot(): File {
    var dir: File? = File("").absoluteFile
    while (dir != null) {
      if (dir.resolve("src/main/AndroidManifest.xml").isFile) return dir
      val app = dir.resolve("app")
      if (app.resolve("src/main/AndroidManifest.xml").isFile) return app
      dir = dir.parentFile
    }
    throw IllegalStateException("无法定位 android 模块根目录（当前 ${File("").absolutePath}）")
  }
}
