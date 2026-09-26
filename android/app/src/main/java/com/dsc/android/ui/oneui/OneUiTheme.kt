package com.dsc.android.ui.oneui

import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bedtime
import androidx.compose.material.icons.rounded.BrightnessAuto
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * 主题装配：把形（颜色/字阶/形状/度量）、动（动效）、适（窗口与输入）一次性注入组合树。
 *
 * 同时提供 Material 3 的 `MaterialTheme`，让必须复用官方 M3 实现的组件
 * （ModalBottomSheet、Snackbar、TextField）天然落在同一套 One UI token 上（件）。
 */
val LocalOneUiColors: ProvidableCompositionLocal<OneUiColors> =
  compositionLocalOf { OneUiLightColors }

val LocalOneUiTypography: ProvidableCompositionLocal<OneUiTypography> =
  compositionLocalOf { DefaultOneUiTypography }

val LocalOneUiShapes: ProvidableCompositionLocal<OneUiShapes> =
  compositionLocalOf { OneUiShapes() }

val LocalOneUiMetrics: ProvidableCompositionLocal<OneUiMetrics> =
  compositionLocalOf { OneUiMetrics() }

val LocalOneUiHighTextContrast: ProvidableCompositionLocal<Boolean> =
  compositionLocalOf { false }

/** 组件与页面取 token 的唯一入口；页面里不再直接读 `MaterialTheme.colorScheme`。 */
object OneUiTheme {
  val colors: OneUiColors
    @Composable get() = LocalOneUiColors.current
  val type: OneUiTypography
    @Composable get() = LocalOneUiTypography.current
  val shapes: OneUiShapes
    @Composable get() = LocalOneUiShapes.current
  val metrics: OneUiMetrics
    @Composable get() = LocalOneUiMetrics.current
  val motion: OneUiMotion
    @Composable get() = LocalOneUiMotion.current
  val window: OneUiWindowLayout
    @Composable get() = LocalOneUiWindowLayout.current
  val highTextContrast: Boolean
    @Composable get() = LocalOneUiHighTextContrast.current
}

@Composable
fun GuanlanTheme(
  appearance: OneUiAppearanceSetting = OneUiAppearanceSetting.FollowSystem,
  reduceMotionOverride: Boolean = false,
  content: @Composable () -> Unit
) {
  val systemDark = isSystemInDarkTheme()
  val dark = when (appearance) {
    OneUiAppearanceSetting.Light -> false
    OneUiAppearanceSetting.Dark, OneUiAppearanceSetting.ExtraDark -> true
    OneUiAppearanceSetting.FollowSystem -> systemDark
  }
  val extraDark = appearance == OneUiAppearanceSetting.ExtraDark

  val windowLayout = rememberOneUiWindowLayout()
  val fontScale = rememberOneUiFontScale()
  val highTextContrast = rememberOneUiHighTextContrast()

  val colors = remember(dark, extraDark, highTextContrast) {
    val base = when {
      extraDark -> OneUiExtraDarkColors
      dark -> OneUiDarkColors
      else -> OneUiLightColors
    }
    if (highTextContrast) base.forHighTextContrast() else base
  }
  val typography = remember(fontScale) { oneUiTypographyFor(fontScale) }
  val metrics = remember(windowLayout, fontScale) { oneUiMetrics(windowLayout, fontScale) }
  val oneUiShapes = remember { OneUiShapes() }
  val systemMotion = rememberOneUiMotion()
  val motion = if (reduceMotionOverride) OneUiMotion.Reduced else systemMotion

  CompositionLocalProvider(
    LocalOneUiColors provides colors,
    LocalOneUiTypography provides typography,
    // 形状表只造一次：每次重组都新建会让所有读 shapes 的组件失效
    LocalOneUiShapes provides oneUiShapes,
    LocalOneUiMetrics provides metrics,
    LocalOneUiWindowLayout provides windowLayout,
    LocalOneUiMotion provides motion,
    LocalOneUiHighTextContrast provides highTextContrast
  ) {
    MaterialTheme(
      colorScheme = colors.toMaterialColorScheme(),
      typography = oneUiMaterialTypography(fontScale),
      // M3 的形状档直接取同一份 One UI 形状表，不再另写一组字面圆角（形）
      shapes = remember(oneUiShapes) {
        Shapes(
          extraSmall = oneUiShapes.tile,
          small = oneUiShapes.control,
          medium = oneUiShapes.card,
          large = oneUiShapes.group,
          extraLarge = oneUiShapes.sheet
        )
      },
      content = content
    )
  }
}

/**
 * 高对比文本：压平成主/次两级文字、加深发丝线，并把靠透明度表达的层级
 * （浅底、墨色、骨架屏脉冲）拉回实色——这类半透明层正是高对比模式下最先看不清的东西（适）。
 */
private fun OneUiColors.forHighTextContrast(): OneUiColors {
  val secondary = if (isDark) Color(0xFFE3E6EA) else Color(0xFF101214)
  return copy(
    textPrimary = if (isDark) Color.White else Color.Black,
    textSecondary = secondary,
    textTertiary = secondary,
    textDisabled = if (isDark) Color(0xFFA7ACB5) else Color(0xFF5B6069),
    hairline = if (isDark) Color(0xFF4A4E55) else Color(0xFFB9BEC6),
    sunken = if (isDark) sunken.lift(0.10f) else sunken,
    chartTrack = if (isDark) chartTrack.lift(0.12f) else chartTrack,
    scrim = if (isDark) Color(0xCC000000) else Color(0x66000000)
  )
}

/**
 * 外观偏好。深浅色本身是系统能力，但 One UI 应用内也允许覆盖，
 * 其中“额外暗色”只存在于应用侧，因此需要落盘。
 */
@Immutable
enum class OneUiAppearanceSetting(val storageKey: String, val label: String, val description: String) {
  FollowSystem("system", "跟随系统", "随系统深浅色与定时切换"),
  Light("light", "浅色", "始终使用浅色表面"),
  Dark("dark", "深色", "始终使用深色表面"),
  ExtraDark("extra_dark", "额外暗色", "纯黑表面并取消投影，适合 OLED");

  /** 设置列表里每项都带图标，整组才有 One UI 的设置感（件）。 */
  val icon: ImageVector
    get() = when (this) {
      FollowSystem -> Icons.Rounded.BrightnessAuto
      Light -> Icons.Rounded.LightMode
      Dark -> Icons.Rounded.DarkMode
      ExtraDark -> Icons.Rounded.Bedtime
    }
}

private val Context.oneUiAppearanceStore: DataStore<Preferences> by preferencesDataStore(name = "oneui_appearance")
private val AppearanceKey = stringPreferencesKey("appearance")
private val ReduceAnimationsKey = booleanPreferencesKey("reduce_animations")

internal fun oneUiAppearanceFromStorage(raw: String?): OneUiAppearanceSetting =
  OneUiAppearanceSetting.entries.firstOrNull { it.storageKey == raw } ?: OneUiAppearanceSetting.FollowSystem

/** 读写外观偏好；读取失败时回落“跟随系统”，不让界面卡在默认值上。 */
@Composable
fun rememberOneUiAppearanceController(): OneUiAppearanceController {
  val context = LocalContext.current
  return remember(context) { OneUiAppearanceController(context) }
}

class OneUiAppearanceController internal constructor(private val context: Context) {
  val settings: Flow<OneUiAppearanceSetting> =
    context.oneUiAppearanceStore.data.map { prefs -> oneUiAppearanceFromStorage(prefs[AppearanceKey]) }

  /** 同步读取一次，用于首帧避免主题闪烁。 */
  suspend fun current(): OneUiAppearanceSetting =
    runCatching { oneUiAppearanceFromStorage(context.oneUiAppearanceStore.data.first()[AppearanceKey]) }
      .getOrDefault(OneUiAppearanceSetting.FollowSystem)

  suspend fun update(setting: OneUiAppearanceSetting) {
    runCatching { context.oneUiAppearanceStore.edit { it[AppearanceKey] = setting.storageKey } }
  }

  /** 应用内“减少动画”：与系统动画缩放同等效果，供不想改系统设置的用户使用（适）。 */
  val reduceAnimations: Flow<Boolean> =
    context.oneUiAppearanceStore.data.map { prefs -> prefs[ReduceAnimationsKey] ?: false }

  suspend fun setReduceAnimations(enabled: Boolean) {
    runCatching { context.oneUiAppearanceStore.edit { it[ReduceAnimationsKey] = enabled } }
  }
}
