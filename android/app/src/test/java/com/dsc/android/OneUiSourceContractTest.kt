package com.dsc.android

import com.dsc.android.ui.oneui.trafficCalendarColumns
import com.dsc.android.ui.oneui.trafficCellAnnouncement
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 源码层契约（防漂移）。
 *
 * 这一批规则靠肉眼 review 守不住：页面哪天顺手 import 回 Material 3、自带一个十六进制色值、
 * 或者把 `groupGap` / `oneUiContentWidth` 这类 token 晾在定义处不用，编译和截图都不会报错，
 * 而 docs/ONE_UI_DESIGN_SYSTEM.md 会悄悄变成一厢情愿。所以直接在单测里扫源码。
 */
class OneUiSourceContractTest {
  private val moduleRoot: File by lazy { findModuleRoot() }

  private val pages: List<File> by lazy {
    val ui = moduleRoot.resolve("src/main/java/com/dsc/android/ui")
    listOf(ui.resolve("screens"), ui.resolve("shell")).flatMap { dir ->
      assertTrue("找不到页面源码目录：$dir", dir.isDirectory)
      dir.listFiles()?.filter { it.extension == "kt" }.orEmpty().sortedBy { it.name }
    }
  }

  /**
   * 页面不得直接使用 Material 3。
   *
   * 唯一的例外是消息条：`SnackbarHost` 这一族是设计文档里点名要复用官方实现的容器
   * （拖拽手势、队列与时长语义自己重写不划算），并且只允许出现在外壳里。
   */
  @Test
  fun pagesNeverReachIntoMaterial3() {
    pages.forEach { file ->
      val bad = file.readLines().filter { it.contains("material3") && !it.contains("compose.material3.Snackbar") }
      assertFalse("${file.name} 直接用到了 Material 3：$bad", bad.isNotEmpty())
      if (file.name != "GuanlanApp.kt") {
        val snackbarUse = file.readText().contains("material3.Snackbar")
        assertFalse("消息条只归外壳（GuanlanApp）承载，${file.name} 不该出现 Snackbar", snackbarUse)
      }
      assertFalse(
        "${file.name} 还挂着 ExperimentalMaterial3Api 授权（面板状态已在设计层内部创建）",
        file.readText().contains("ExperimentalMaterial3Api")
      )
    }
  }

  @Test
  fun pagesCarryNoOwnColorsAndNoHandRolledSurfaces() {
    pages.forEach { file ->
      val text = file.readText()
      listOf("Color(0x", "Color.White", "Color.Black", "hex(0x").forEach { marker ->
        assertFalse("${file.name} 自带字面色值 $marker，请改用 OneUiColors 角色", text.contains(marker))
      }
      listOf(".clickable(", "combinedClickable(", "detectTapGestures", "indication =").forEach { marker ->
        assertFalse("${file.name} 手搓了可点击表面 $marker，六态会漂移，请走 oneUiPressable", text.contains(marker))
      }
    }
  }

  @Test
  fun shapeAndMotionValuesStayInsideTheDesignSystem() {
    val pageText = pages.joinToString("\n") { it.readText() }
    listOf("RoundedCornerShape(", "CubicBezierEasing(", "Animatable(", "InfiniteTransition").forEach { marker ->
      assertFalse("页面里出现 $marker：形/动只能在 ui/oneui 里定义", pageText.contains(marker))
    }
  }

  /** token 定义了却没人用，等于没有——这是「换了组件没换布局」最容易复发的地方。 */
  @Test
  fun layoutTokensAreActuallyUsedByPages() {
    val pageText = pages.joinToString("\n") { it.readText() }
    mapOf(
      "groupGap" to "组与组之间的大留白，One UI 的分组节奏（形）",
      "oneUiContentWidth" to "宽屏限制正文行长（适）",
      "touchTarget" to "最小命中区（适）",
      "shapes.dock" to "底部工具坞只圆上沿两角（形）",
      "iconFilledSize" to "行内图标尺寸（形）",
      "calendarCellHeight" to "日历格高度取自度量而不是写死（适）"
    ).forEach { (token, why) ->
      assertTrue("页面没有引用 $token —— $why，说明这条约定实际没落地", pageText.contains(token))
    }
  }

  @Test
  fun trafficGridUsesModeSpecificColumns() {
    // 日=整月的日历格；周=本月覆盖的周；月=12 个月。统一 7 列会把月视图排成 7+5 的错位
    assertEquals(7, trafficCalendarColumns(TrafficCalendarMode.Day))
    assertEquals(4, trafficCalendarColumns(TrafficCalendarMode.Month))
    assertTrue(trafficCalendarColumns(TrafficCalendarMode.Week) in 2..4)
    assertEquals("月视图 12 格要能整除列数", 0, 12 % trafficCalendarColumns(TrafficCalendarMode.Month))
  }

  @Test
  fun trafficCellAnnouncementKeepsPeriodAndSelectionApart() {
    val both = trafficCellAnnouncement(
      label = "05",
      rangeStart = "2026-09-05T00:00:00+08:00",
      total = "1.2 GB",
      isCurrentPeriod = true,
      isSelected = true
    )
    assertTrue("当前周期与已选中是两件事，不能互相吃掉：$both", both.contains("当前周期") && both.contains("已选中"))

    val selectedOnly = trafficCellAnnouncement("9月", "2026-09-01T00:00:00+08:00", "1 TB", false, true)
    assertTrue(selectedOnly.contains("已选中") && !selectedOnly.contains("当前周期"))

    val plain = trafficCellAnnouncement("9月", "2026-09-01T00:00:00+08:00", "1 TB", false, false)
    assertFalse(plain.contains("已选中"))
    // 播报里必须带日期上下文（只念「05」在月视图里等于没说），但不绑定具体时区换算结果
    assertTrue("播报缺少日期：$plain", Regex("""\d{4}-\d{2}-\d{2}""").containsMatchIn(plain))
    assertTrue(plain.contains("1 TB"))
  }

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
