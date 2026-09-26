package com.dsc.android.ui.oneui

import androidx.annotation.ColorInt
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * One UI 颜色 token（形）。
 *
 * 取值来源分三档，务必区分：
 * 1. `官方口径`：Samsung 公开说明的设计原则（One UI 官网 / Wikipedia 对 One UI 的描述）——
 *    深色降低视觉负担、One UI Sans 字体、内容靠上控件靠下。
 * 2. `实测取值`：从 One UI 界面渲染结果量取/取样的近似值。Samsung 不公开 One UI 设计 token，
 *    因此这些十六进制值是工程可实现的对齐结果，不是官方数值。
 * 3. `本产品推导`：观澜作为监控类应用需要的语义色（在线/离线/告警/图表系列色），
 *    Samsung 规范里没有对应条目，按 One UI 的色彩使用习惯（低饱和底 + 高饱和前景）推导。
 *
 * 所有颜色只在此文件定义；改主题=改这里，页面里不允许出现字面色值。
 */
@Immutable
data class OneUiColors(
  // ---- Surface 层级（实测取值）----
  val canvas: Color,
  val group: Color,
  val raised: Color,
  val sunken: Color,
  val hairline: Color,
  val outline: Color,
  // ---- 文字层级（实测取值）----
  val textPrimary: Color,
  val textSecondary: Color,
  val textTertiary: Color,
  val textDisabled: Color,
  val textOnAccent: Color,
  // ---- 强调色（实测取值：Samsung 蓝）----
  val accent: Color,
  val accentPressed: Color,
  val accentSoft: Color,
  val accentSoftContent: Color,
  val accentOutline: Color,
  // ---- 状态语义（本产品推导）----
  val online: Color,
  val onlineSoft: Color,
  val onlineContent: Color,
  val offline: Color,
  val offlineSoft: Color,
  val offlineContent: Color,
  val warning: Color,
  val warningSoft: Color,
  val warningContent: Color,
  val critical: Color,
  val criticalSoft: Color,
  val criticalContent: Color,
  // ---- 图表（本产品推导）----
  val chartGrid: Color,
  val chartTrack: Color,
  val chartCrosshair: Color,
  /** 0=接收/主指标，1=发送/次指标，其余用于多实例序列。 */
  val chartSeries: List<Color>,
  // ---- 交互叠加（实测取值）----
  val ink: Color,
  val focusRing: Color,
  val scrim: Color,
  val isDark: Boolean,
  /** One UI “额外暗色”：纯黑、去掉投影与色层，只保留分隔线。 */
  val isExtraDark: Boolean
) {
  /** 按下/悬停用同一支笔着色，只差 alpha。 */
  fun inkOverlay(alpha: Float): Color = ink.copy(alpha = alpha)

  fun seriesColor(index: Int): Color = chartSeries[index.mod(chartSeries.size)]
}

@ColorInt
private fun hex(rgb: Long): Color = Color(0xFF000000 or rgb)

/** One UI 浅色：冷白底 + 纯白分组容器，靠色层而不是投影分层。 */
val OneUiLightColors = OneUiColors(
  canvas = hex(0xF2F3F6),
  group = hex(0xFFFFFF),
  raised = hex(0xFFFFFF),
  sunken = hex(0xEBEDF1),
  hairline = hex(0xE4E6EA),
  outline = hex(0xD3D7DD),
  textPrimary = hex(0x191B1F),
  textSecondary = hex(0x5B6069),
  textTertiary = hex(0x838993),
  textDisabled = hex(0xA6ACB5),
  textOnAccent = hex(0xFFFFFF),
  accent = hex(0x1B76FD),
  accentPressed = hex(0x1560D4),
  accentSoft = hex(0xE6F0FE),
  accentSoftContent = hex(0x1258B8),
  accentOutline = hex(0xA9CBF7),
  online = hex(0x1AA35A),
  onlineSoft = hex(0xE3F6EA),
  onlineContent = hex(0x0E7239),
  offline = hex(0x838993),
  offlineSoft = hex(0xEBEDF1),
  offlineContent = hex(0x5B6069),
  warning = hex(0xC87100),
  warningSoft = hex(0xFBEEDC),
  warningContent = hex(0x8C4E00),
  critical = hex(0xD93B3B),
  criticalSoft = hex(0xFBE7E6),
  criticalContent = hex(0xA62A28),
  chartGrid = hex(0xE4E6EA),
  chartTrack = hex(0xF2F3F6),
  chartCrosshair = hex(0xB5BAC3),
  chartSeries = listOf(
    hex(0x1B76FD),
    hex(0x7B4DDB),
    hex(0x0FA3A3),
    hex(0xC87100),
    hex(0xD93B3B),
    hex(0x1AA35A)
  ),
  ink = hex(0x191B1F),
  focusRing = hex(0x1B76FD),
  scrim = Color(0x59000000),
  isDark = false,
  isExtraDark = false
)

/** One UI 标准深色：接近黑，但容器仍有蓝灰偏移（Samsung 的 dark surface）。 */
val OneUiDarkColors = OneUiColors(
  canvas = hex(0x000000),
  group = hex(0x1B1C1F),
  raised = hex(0x24262B),
  sunken = hex(0x131417),
  hairline = hex(0x2C2E33),
  outline = hex(0x3B3E45),
  textPrimary = hex(0xEDEFF2),
  textSecondary = hex(0xA7ACB5),
  textTertiary = hex(0x7F858F),
  textDisabled = hex(0x5C626B),
  textOnAccent = hex(0xFFFFFF),
  accent = hex(0x4D9BF7),
  accentPressed = hex(0x74B4FA),
  accentSoft = hex(0x17304C),
  accentSoftContent = hex(0xA9CDFB),
  accentOutline = hex(0x2F5788),
  online = hex(0x37D07A),
  onlineSoft = hex(0x11311F),
  onlineContent = hex(0x7EE3AA),
  offline = hex(0x868C96),
  offlineSoft = hex(0x232529),
  offlineContent = hex(0xB0B5BD),
  warning = hex(0xF0A73C),
  warningSoft = hex(0x362712),
  warningContent = hex(0xF8CB82),
  critical = hex(0xF56B66),
  criticalSoft = hex(0x3A1E1F),
  criticalContent = hex(0xFBB2AE),
  chartGrid = hex(0x2C2E33),
  chartTrack = hex(0x17181B),
  chartCrosshair = hex(0x5C626B),
  chartSeries = listOf(
    hex(0x4D9BF7),
    hex(0xA98BF5),
    hex(0x35C8C8),
    hex(0xF0A73C),
    hex(0xF56B66),
    hex(0x37D07A)
  ),
  ink = hex(0xFFFFFF),
  focusRing = hex(0x74B4FA),
  scrim = Color(0x99000000),
  isDark = true,
  isExtraDark = false
)

/**
 * One UI “额外暗色”（官方功能名 Extra dark）：OLED 纯黑、取消投影，
 * 层级只靠分隔线与文字色阶表达。
 */
val OneUiExtraDarkColors = OneUiDarkColors.copy(
  canvas = hex(0x000000),
  group = hex(0x000000),
  raised = hex(0x0A0B0C),
  sunken = hex(0x000000),
  hairline = hex(0x303338),
  chartTrack = hex(0x000000),
  ink = hex(0xFFFFFF),
  isExtraDark = true
)

/**
 * 把 One UI token 反向映射到 Material 3 角色，让 ModalBottomSheet、TextField、Snackbar
 * 等官方组件不必各自覆写颜色（件）。
 */
fun OneUiColors.toMaterialColorScheme(): ColorScheme = if (isDark) {
  darkColorScheme(
    primary = accent,
    onPrimary = textOnAccent,
    primaryContainer = accentSoft,
    onPrimaryContainer = accentSoftContent,
    secondary = textSecondary,
    onSecondary = canvas,
    secondaryContainer = accentSoft,
    onSecondaryContainer = accentSoftContent,
    error = critical,
    onError = textOnAccent,
    errorContainer = criticalSoft,
    onErrorContainer = criticalContent,
    background = canvas,
    onBackground = textPrimary,
    surface = group,
    onSurface = textPrimary,
    surfaceVariant = sunken,
    onSurfaceVariant = textSecondary,
    surfaceContainerLowest = canvas,
    surfaceContainerLow = group,
    surfaceContainer = group,
    surfaceContainerHigh = raised,
    surfaceContainerHighest = raised,
    surfaceBright = raised,
    outline = outline,
    outlineVariant = hairline,
    scrim = scrim,
    inverseSurface = raised,
    inverseOnSurface = textPrimary,
    inversePrimary = accent
  )
} else {
  lightColorScheme(
    primary = accent,
    onPrimary = textOnAccent,
    primaryContainer = accentSoft,
    onPrimaryContainer = accentSoftContent,
    secondary = textSecondary,
    onSecondary = canvas,
    secondaryContainer = accentSoft,
    onSecondaryContainer = accentSoftContent,
    error = critical,
    onError = textOnAccent,
    errorContainer = criticalSoft,
    onErrorContainer = criticalContent,
    background = canvas,
    onBackground = textPrimary,
    surface = group,
    onSurface = textPrimary,
    surfaceVariant = sunken,
    onSurfaceVariant = textSecondary,
    surfaceContainerLowest = canvas,
    surfaceContainerLow = group,
    surfaceContainer = group,
    surfaceContainerHigh = raised,
    surfaceContainerHighest = raised,
    surfaceBright = group,
    outline = outline,
    outlineVariant = hairline,
    scrim = scrim,
    inverseSurface = raised,
    inverseOnSurface = textPrimary,
    inversePrimary = accent
  )
}
