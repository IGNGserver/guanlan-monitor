package com.dsc.android.ui.oneui

import android.app.UiModeManager
import android.content.Context
import android.provider.Settings
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * 适配层（适）：窗口尺寸类别、输入方式、字号缩放、高对比文本。
 *
 * 断点沿用 One UI / Android 大屏的 600dp、840dp 分界，另外加一条高度维度：
 * 折叠屏展开、平板横屏与电脑投屏（DeX）都走同一套判断，而不是简单地按“是否平板”。
 */
enum class OneUiWidthClass { Compact, Medium, Expanded }

enum class OneUiHeightClass { Tall, Regular, Short }

@Immutable
data class OneUiWindowLayout(
  val widthClass: OneUiWidthClass,
  val heightClass: OneUiHeightClass,
  val widthDp: Dp,
  val heightDp: Dp
) {
  val isWide: Boolean get() = widthClass != OneUiWidthClass.Compact

  /** 展开态：一级导航用侧栏，且列表-详情双栏（One UI 平板/DeX 的实际布局） */
  val useNavigationRail: Boolean get() = widthClass == OneUiWidthClass.Expanded
  val useTwoPane: Boolean get() = widthClass == OneUiWidthClass.Expanded && heightClass != OneUiHeightClass.Short

  /** 横屏矮窗（折叠屏外层、分屏）：大标题退化为小标题，避免吃掉正文空间 */
  val useCompactTopBar: Boolean get() = heightClass == OneUiHeightClass.Short

  /** 触屏优先还是指针优先：影响命中区与 hover 文案 */
  val coarsePointer: Boolean get() = widthClass == OneUiWidthClass.Compact
}

val LocalOneUiWindowLayout: ProvidableCompositionLocal<OneUiWindowLayout> =
  compositionLocalOf { OneUiWindowLayout(OneUiWidthClass.Compact, OneUiHeightClass.Tall, 411.dp, 891.dp) }

@Composable
fun rememberOneUiWindowLayout(): OneUiWindowLayout {
  val configuration = LocalConfiguration.current
  return remember(configuration.screenWidthDp, configuration.screenHeightDp) {
    val widthDp = configuration.screenWidthDp.dp
    val heightDp = configuration.screenHeightDp.dp
    val w = widthDp.value
    val h = heightDp.value
    OneUiWindowLayout(
      widthClass = when {
        w < 600f -> OneUiWidthClass.Compact
        w < 840f -> OneUiWidthClass.Medium
        else -> OneUiWidthClass.Expanded
      },
      heightClass = when {
        h < 480f -> OneUiHeightClass.Short
        h < w * 1.15f -> OneUiHeightClass.Regular
        else -> OneUiHeightClass.Tall
      },
      widthDp = widthDp,
      heightDp = heightDp
    )
  }
}

/** 系统字号缩放；One UI 最高可放大到 200%，布局必须据此改变排布而不是裁切文字。 */
@Composable
fun rememberOneUiFontScale(): Float = LocalDensity.current.fontScale

/** 无障碍“高对比文本”开关（Android 系统设置），命中时去掉所有半透明文字层级。 */
@Composable
fun rememberOneUiHighTextContrast(): Boolean {
  val context = LocalContext.current
  return remember(context) {
    runCatching {
      Settings.Secure.getInt(context.contentResolver, "accessibility_high_text_contrast_enabled", 0) == 1
    }.getOrDefault(false)
  }
}

@Composable
fun rememberOneUiUiMode(context: Context = LocalContext.current): OneUiUiMode {
  return remember(context) {
    runCatching {
      val manager = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
      when (manager?.nightMode) {
        UiModeManager.MODE_NIGHT_NO -> OneUiUiMode.Light
        UiModeManager.MODE_NIGHT_YES -> OneUiUiMode.Dark
        else -> OneUiUiMode.System
      }
    }.getOrDefault(OneUiUiMode.System)
  }
}

enum class OneUiUiMode { System, Light, Dark, ExtraDark }

/**
 * 宽屏限流：One UI 在大屏上不会把一行文字拉到屏幕两端，
 * 而是保持可读行长并把内容居中。
 */
fun Modifier.oneUiContentWidth(metrics: OneUiMetrics): Modifier =
  if (metrics.contentMaxWidth == Dp.Unspecified) this else this.widthIn(max = metrics.contentMaxWidth)

/** 与 [oneUiContentWidth] 配套的容器：宽屏时居中，紧凑时铺满。 */
@Composable
fun OneUiContentArea(
  metrics: OneUiMetrics,
  modifier: Modifier = Modifier,
  content: @Composable () -> Unit
) {
  if (metrics.contentMaxWidth == Dp.Unspecified) {
    Box(modifier = modifier.fillMaxWidth()) { content() }
  } else {
    Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
      Box(modifier = Modifier.width(metrics.contentMaxWidth)) { content() }
    }
  }
}
