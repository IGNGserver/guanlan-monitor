package com.dsc.android.ui.oneui

import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontSynthesis
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * One UI 字阶（形）。
 *
 * 字体来源：One UI 6.0 起系统字体为 One UI Sans（官方口径）。Samsung 的字体不可随包分发，
 * 因此这里使用平台默认字族——在三星机型上解析结果就是 One UI Sans / SamsungOne，
 * 在其他机型上落到 Noto Sans CJK，中文排版一致。
 * 若拿到授权字体，把文件放进 `res/font/` 并把 [OneUiFontFamily] 换成
 * `FontFamily(Font(R.font.oneui_sans_regular))` 等即可，其余字阶不需要改动。
 *
 * 数值为按 One UI 界面量取的近似值（Samsung 未公开 token）。
 * 中文正文不加负字距，数字统一 tnum 等宽，避免刷新时数字抖动。
 */
val OneUiFontFamily: FontFamily = FontFamily.Default

private val lineHeightStyle = LineHeightStyle(
  alignment = LineHeightStyle.Alignment.Center,
  trim = LineHeightStyle.Trim.None
)

@Immutable
data class OneUiTypography(
  /** 登录/引导页主标题 */
  val displayLarge: TextStyle,
  val displayMedium: TextStyle,
  /** 页面主指标数值（如流量合计） */
  val figureLarge: TextStyle,
  val figureMedium: TextStyle,
  /** large top bar 展开态标题 / 折叠态标题 */
  val topBarLarge: TextStyle,
  val topBarSmall: TextStyle,
  val headline: TextStyle,
  val title: TextStyle,
  val subtitle: TextStyle,
  val body: TextStyle,
  val bodySmall: TextStyle,
  val caption: TextStyle,
  val button: TextStyle,
  val navLabel: TextStyle,
  val chipLabel: TextStyle,
  val metricValue: TextStyle,
  val metricUnit: TextStyle,
  val rowTitle: TextStyle,
  val rowSubtitle: TextStyle,
  val sectionHeader: TextStyle,
  val chartLabel: TextStyle,
  val monoFigure: TextStyle
) {
  /**
   * 适：跟随系统字号缩放。One UI 允许放大到 200%，
   * 组件需要据此把横排信息改成竖排，因此把缩放系数一并暴露出来。
   */
  /** 供 [oneUiTypographyFor] 使用的整体缩放。 */
  fun scaled(scale: Float): OneUiTypography = copy(
    displayLarge = displayLarge.scaled(scale),
    displayMedium = displayMedium.scaled(scale),
    figureLarge = figureLarge.scaled(scale),
    figureMedium = figureMedium.scaled(scale),
    topBarLarge = topBarLarge.scaled(scale),
    topBarSmall = topBarSmall.scaled(scale),
    headline = headline.scaled(scale),
    title = title.scaled(scale),
    subtitle = subtitle.scaled(scale),
    body = body.scaled(scale),
    bodySmall = bodySmall.scaled(scale),
    caption = caption.scaled(scale),
    button = button.scaled(scale),
    navLabel = navLabel.scaled(scale),
    chipLabel = chipLabel.scaled(scale),
    metricValue = metricValue.scaled(scale),
    metricUnit = metricUnit.scaled(scale),
    rowTitle = rowTitle.scaled(scale),
    rowSubtitle = rowSubtitle.scaled(scale),
    sectionHeader = sectionHeader.scaled(scale),
    chartLabel = chartLabel.scaled(scale),
    monoFigure = monoFigure.scaled(scale)
  )
}

private fun TextStyle.scaled(scale: Float): TextStyle {
  val safe = scale.coerceIn(0.5f, 1f)
  if (safe == 1f) return this
  fun TextUnit.times(factor: Float): TextUnit = if (isSp) (value * factor).sp else this
  return copy(
    fontSize = fontSize.times(factor = safe),
    lineHeight = lineHeight.times(factor = safe)
  )
}

private fun TextStyle.oneUiBase() = copy(
  fontFamily = OneUiFontFamily,
  fontStyle = FontStyle.Normal,
  fontSynthesis = FontSynthesis.Weight,
  platformStyle = androidx.compose.ui.text.PlatformTextStyle(includeFontPadding = false),
  lineHeightStyle = lineHeightStyle
)

private val tabularNumber = TextStyle(fontFeatureSettings = "tnum")

private val OneUiTypographyDefaults = OneUiTypography(
  displayLarge = TextStyle(fontSize = 34.sp, lineHeight = 44.sp, fontWeight = FontWeight.Bold)
    .oneUiBase(),
  displayMedium = TextStyle(fontSize = 29.sp, lineHeight = 38.sp, fontWeight = FontWeight.Bold)
    .oneUiBase(),
  figureLarge = TextStyle(fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.Bold)
    .oneUiBase().merge(tabularNumber),
  figureMedium = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold)
    .oneUiBase().merge(tabularNumber),
  topBarLarge = TextStyle(fontSize = 26.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold)
    .oneUiBase(),
  topBarSmall = TextStyle(fontSize = 19.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold)
    .oneUiBase(),
  headline = TextStyle(fontSize = 21.sp, lineHeight = 29.sp, fontWeight = FontWeight.Bold)
    .oneUiBase(),
  title = TextStyle(fontSize = 17.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)
    .oneUiBase(),
  subtitle = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium)
    .oneUiBase(),
  body = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal)
    .oneUiBase(),
  bodySmall = TextStyle(fontSize = 13.5.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal)
    .oneUiBase(),
  caption = TextStyle(fontSize = 12.5.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal)
    .oneUiBase(),
  button = TextStyle(fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold)
    .oneUiBase(),
  navLabel = TextStyle(fontSize = 11.5.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium)
    .oneUiBase(),
  chipLabel = TextStyle(fontSize = 13.5.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium)
    .oneUiBase(),
  metricValue = TextStyle(fontSize = 21.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold)
    .oneUiBase().merge(tabularNumber),
  metricUnit = TextStyle(fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.Medium)
    .oneUiBase(),
  rowTitle = TextStyle(fontSize = 16.5.sp, lineHeight = 23.sp, fontWeight = FontWeight.Medium)
    .oneUiBase(),
  rowSubtitle = TextStyle(fontSize = 13.5.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal)
    .oneUiBase(),
  sectionHeader = TextStyle(fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold)
    .oneUiBase(),
  chartLabel = TextStyle(fontSize = 11.5.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium)
    .oneUiBase().merge(tabularNumber),
  monoFigure = TextStyle(
    fontSize = 13.5.sp,
    lineHeight = 20.sp,
    fontWeight = FontWeight.Medium,
    fontFamily = FontFamily.Monospace
  ).oneUiBase().merge(tabularNumber)
)

/**
 * 适：字号缩放策略。正文、行副标题、按钮、芯片这类“必须读得清”的字型全量跟随系统字号；
 * 装饰性的大标题与大数字在 130% 之后不再线性放大（否则 One UI 的 200% 字号会让仪表盘
 * 一页只剩两个数字），改为靠换行与纵向堆叠继续提供可读性。
 */
internal fun oneUiTypographyFor(fontScale: Float): OneUiTypography {
  val base = DefaultOneUiTypography
  if (fontScale <= 1.02f) return base
  val decorative = (1f / (fontScale / 1.3f)).coerceIn(0.5f, 1f)
  return base.copy(
    displayLarge = base.displayLarge.scaled(decorative),
    displayMedium = base.displayMedium.scaled(decorative),
    figureLarge = base.figureLarge.scaled(decorative),
    figureMedium = base.figureMedium.scaled(decorative),
    topBarLarge = base.topBarLarge.scaled(decorative),
    headline = base.headline.scaled(decorative),
    metricValue = base.metricValue.scaled(decorative),
    title = base.title.scaled((decorative + 1f) / 2f),
    rowTitle = base.rowTitle.scaled((decorative + 1f) / 2f)
  )
}

/**
 * 供 Material 3 官方组件（sheet / dialog / text field / snackbar）使用的字阶映射。
 * 组件内部一律读 [OneUiTypography] 的语义字段，只有回落 M3 组件时才用这份映射。
 */
internal fun oneUiMaterialTypography(fontScale: Float): androidx.compose.material3.Typography {
  val t = oneUiTypographyFor(fontScale)
  return androidx.compose.material3.Typography(
    displayLarge = t.displayLarge,
    displayMedium = t.displayMedium,
    headlineLarge = t.headline,
    headlineMedium = t.figureMedium,
    titleLarge = t.title,
    titleMedium = t.rowTitle,
    titleSmall = t.sectionHeader,
    bodyLarge = t.body,
    bodyMedium = t.bodySmall,
    bodySmall = t.caption,
    labelLarge = t.button,
    labelMedium = t.chipLabel,
    labelSmall = t.chartLabel
  )
}

internal val DefaultOneUiTypography: OneUiTypography = OneUiTypographyDefaults
