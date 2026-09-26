package com.dsc.android

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.dsc.android.ui.oneui.MetricWindow
import com.dsc.android.ui.oneui.OneUiAppearanceSetting
import com.dsc.android.ui.oneui.OneUiDarkColors
import com.dsc.android.ui.oneui.OneUiExtraDarkColors
import com.dsc.android.ui.oneui.OneUiHeightClass
import com.dsc.android.ui.oneui.OneUiLightColors
import com.dsc.android.ui.oneui.OneUiMotion
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
    assertTrue("展开态用侧栏", windowLayout(OneUiWidthClass.Expanded).useNavigationRail)
    assertTrue("紧凑态用底部导航", !windowLayout(OneUiWidthClass.Compact).useNavigationRail)
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
