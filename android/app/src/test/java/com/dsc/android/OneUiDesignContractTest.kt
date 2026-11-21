package com.dsc.android

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.dsc.android.ui.oneui.OneUiAppearanceSetting
import com.dsc.android.ui.oneui.OneUiDarkColors
import com.dsc.android.ui.oneui.OneUiDuration
import com.dsc.android.ui.oneui.OneUiExtraDarkColors
import com.dsc.android.ui.oneui.OneUiHeightClass
import com.dsc.android.ui.oneui.OneUiLightColors
import com.dsc.android.ui.oneui.OneUiMetrics
import com.dsc.android.ui.oneui.OneUiMotion
import com.dsc.android.ui.oneui.OneUiShapes
import com.dsc.android.ui.oneui.OneUiSurfaceLevel
import com.dsc.android.ui.oneui.OneUiWidthClass
import com.dsc.android.ui.oneui.OneUiWindowLayout
import com.dsc.android.ui.oneui.chipLabel
import com.dsc.android.ui.oneui.oneUiElevation
import com.dsc.android.ui.oneui.oneUiMetrics
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * One UI 设计契约（防漂移）。
 *
 * 只锁住容易被后续改动破坏的规则：调色板层级不能互相覆盖、外观偏好的落盘键不能重复、
 * 粒度标签不能撞车、度量必须随窗口类别单调变化、额外暗色必须取消投影、
 * 以及「减少动画」下位移与时长必须归零。具体取值见 docs/ONE_UI_DESIGN_SYSTEM.md。
 */
class OneUiDesignContractTest {
  @Test
  fun lightAndDarkKeepDistinctSurfaceLayers() {
    listOf(OneUiLightColors, OneUiDarkColors).forEach { palette ->
      assertNotEquals("页面底与分组必须分层", palette.canvas, palette.group)
      assertNotEquals(palette.textPrimary, palette.textSecondary)
      assertNotEquals(palette.accent, palette.textPrimary)
      assertNotEquals(palette.online, palette.critical)
      assertTrue("图表序列色至少 4 色", palette.chartSeries.size >= 4)
      assertNotEquals(palette.chartSeries[0], palette.chartSeries[1])
    }
  }

  @Test
  fun extraDarkCrushesToPureBlackAndDropsShadows() {
    assertEquals(Color.Black, OneUiExtraDarkColors.canvas)
    assertEquals(Color.Black, OneUiExtraDarkColors.group)
    val spec = oneUiElevation(OneUiSurfaceLevel.Raised, OneUiExtraDarkColors)
    assertTrue("额外暗色取消投影", spec.shadow == 0.dp)
    assertTrue("额外暗色改用发丝描边分层", spec.hairline)
    val darkSpec = oneUiElevation(OneUiSurfaceLevel.Raised, OneUiDarkColors)
    assertTrue("标准深色仍有投影", darkSpec.shadow > 0.dp)
    assertTrue("标准深色不额外描边", !darkSpec.hairline)
  }

  @Test
  fun appearancePreferencesHaveUniqueStorageKeys() {
    val keys = OneUiAppearanceSetting.entries.map { it.storageKey }
    assertEquals(4, keys.size)
    assertEquals(keys.size, keys.distinct().size)
    assertTrue(OneUiAppearanceSetting.entries.all { it.label.isNotBlank() && it.description.isNotBlank() })
  }

  @Test
  fun metricWindowLabelsStayDistinctAndShort() {
    val labels = MetricWindow.entries.map { it.chipLabel }
    assertEquals(MetricWindow.entries.size, labels.size)
    assertEquals(labels.size, labels.distinct().size)
    assertTrue(
      "粒度标签用于底部工具坞，过长会撑破一行",
      labels.all { it.length <= 5 }
    )
  }

  @Test
  fun metricsGrowMonotonicallyWithWindowClass() {
    val compact = oneUiMetrics(windowLayout(OneUiWidthClass.Compact), 1f)
    val medium = oneUiMetrics(windowLayout(OneUiWidthClass.Medium), 1f)
    val expanded = oneUiMetrics(windowLayout(OneUiWidthClass.Expanded), 1f)

    assertTrue("页面留白随屏幕变宽增加", compact.screenMargin < medium.screenMargin)
    assertTrue(medium.screenMargin < expanded.screenMargin)
    assertTrue("紧凑态不限行宽", compact.contentMaxWidth == androidx.compose.ui.unit.Dp.Unspecified)
    assertTrue("宽屏必须限制正文行长", expanded.contentMaxWidth > 0.dp)
    assertTrue("中等与展开态用侧栏释放纵向高度", windowLayout(OneUiWidthClass.Medium).useNavigationRail)
    assertTrue("展开态用侧栏", windowLayout(OneUiWidthClass.Expanded).useNavigationRail)
    assertTrue("紧凑态用底部导航", !windowLayout(OneUiWidthClass.Compact).useNavigationRail)
    assertTrue("双栏内嵌留白比全屏留白更紧凑", expanded.paneMargin < expanded.screenMargin)
    assertTrue("矮窗降级大标题", windowLayout(OneUiWidthClass.Compact, OneUiHeightClass.Short).useCompactTopBar)
    assertTrue("常规竖屏保留大标题", !compactTopBarOf(OneUiHeightClass.Tall))
  }

  @Test
  fun largeFontScaleLoosensRowAndChartMetrics() {
    val base = oneUiMetrics(windowLayout(OneUiWidthClass.Compact), 1f)
    val large = oneUiMetrics(windowLayout(OneUiWidthClass.Compact), 1.7f)
    assertTrue("字号放大后行高必须放宽，否则文字被裁", large.rowMinHeight > base.rowMinHeight)
    assertTrue("指标块最小宽度同步放宽，否则退化为无法读的窄列", large.metricMinCellWidth > base.metricMinCellWidth)
    assertTrue(large.chartHeight > base.chartHeight)
  }

  @Test
  fun reducedMotionZeroesEveryDurationAndOffset() {
    val reduced = OneUiMotion.Reduced
    assertTrue(reduced.isReduced)
    assertEquals(0, reduced.duration(340))
    assertEquals(0, reduced.offset(400))
    assertEquals(0, reduced.offset(400, 1f))
    val standard = OneUiMotion.Standard
    assertEquals(340, standard.duration(340))
    assertTrue("正常动效必须有位移", standard.offset(400) > 0)
  }

  @Test
  fun interactiveMotionStaysWithinOneUiOfficialWindow() {
    // Samsung One UI 官方规范：交互动效不低于 100ms、不超过 500ms，进场从容、退场更快
    val interactive = listOf(
      OneUiDuration.Press,
      OneUiDuration.Toggle,
      OneUiDuration.TabSwitch,
      OneUiDuration.Content,
      OneUiDuration.Enter,
      OneUiDuration.Exit,
      OneUiDuration.Dialog,
      OneUiDuration.Screen,
      OneUiDuration.ScreenExit,
      OneUiDuration.Sheet,
      OneUiDuration.ValueTick
    )
    assertTrue("所有交互时长必须落在 100..500ms 官方区间", interactive.all { it in 100..500 })
    assertTrue("进场时长应大于退场时长", OneUiDuration.Enter > OneUiDuration.Exit)
    assertTrue("子页转场进场应大于退场", OneUiDuration.Screen > OneUiDuration.ScreenExit)
    assertTrue("切换与展开应大于按压反馈", OneUiDuration.Toggle > OneUiDuration.Press && OneUiDuration.Content >= OneUiDuration.Toggle)
  }

  @Test
  fun controlsFollowBalancedOneUiScaleAndTouchTargets() {
    val metrics = OneUiMetrics()
    assertTrue("最小触控热区不得低于 48dp", metrics.touchTarget >= 48.dp)
    assertTrue("交互胶囊视觉高度应落在 36..44dp，避免 32dp 过小或 48dp 臃肿", metrics.chipHeight in 36.dp..44.dp)
    assertTrue("纯读数徽标应小于交互胶囊", metrics.pillHeight < metrics.chipHeight)
    assertTrue("分段器高度应与胶囊协调，不超过 48dp", metrics.segmentHeight in 38.dp..44.dp)
    assertEquals("分组容器圆角对齐 One UI 26dp", androidx.compose.foundation.shape.RoundedCornerShape(26.dp), OneUiShapes().group)
  }

  @Test
  fun staleTreatmentStaysSubtleAndRegistered() {
    val metrics = oneUiMetrics(windowLayout(OneUiWidthClass.Compact), 1f)
    assertTrue("陈旧内容必须仍然可读", metrics.staleContent in 0.5f..0.8f)
    assertTrue(
      "陈旧内容必须比禁用态更亮，避免被当成不可点",
      metrics.staleContent > metrics.disabledContent
    )
    assertTrue("扫光周期必须够慢，不制造闪烁", OneUiDuration.StaleSweep >= 1_000)
    assertEquals("减少动画下扫光时长归零", 0, OneUiMotion.Reduced.duration(OneUiDuration.StaleSweep))
    listOf(OneUiLightColors, OneUiDarkColors, OneUiExtraDarkColors).forEach { palette ->
      assertNotEquals("扫光必须与图表底可区分", palette.chartTrack, palette.chartSweep)
    }
  }

  private fun windowLayout(
    width: OneUiWidthClass,
    height: OneUiHeightClass = OneUiHeightClass.Tall
  ) = OneUiWindowLayout(
    widthClass = width,
    heightClass = height,
    widthDp = 411.dp,
    heightDp = if (height == OneUiHeightClass.Short) 320.dp else 891.dp
  )

  private fun compactTopBarOf(height: OneUiHeightClass) =
    windowLayout(OneUiWidthClass.Compact, height).useCompactTopBar
}
