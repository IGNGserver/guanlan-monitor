package com.dsc.android.ui.oneui

import android.provider.Settings
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import kotlin.math.roundToInt

/**
 * One UI 动效体系（动）。
 *
 * One UI 的动画特征：进场比退场长、退场更快且提前结束（避免等待感）、
 * 位移幅度小（不超过 1/4 屏）、配合轻微缩放；交互反馈用带轻微回弹的 spring。
 * 时长/曲线为按 One UI 观测量取的近似值。
 *
 * 系统“动画缩放”为 0（含三星的“减少动画”开关）时整套体系降级为瞬时切换（适）。
 */
object OneUiDuration {
  const val Press = 110
  const val Toggle = 190
  const val Content = 220
  const val Enter = 260
  const val Exit = 170
  const val Screen = 340
  const val Sheet = 390
  const val Stagger = 34
  const val StaggerMax = 6
  const val ValueTick = 420
  const val ChartDraw = 620
  const val Skeleton = 1_050
  const val Toast = 2_400
  /** 常驻指示器的周期：不属于交互动效，但仍只在这里登记 */
  const val SpinnerCycle = 820
  const val SpinFrame = 900
  const val ProgressSlide = 1_100
}

object OneUiEasing {
  /** 通用 */
  val Standard: Easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)

  /** 进场收尾：One UI 的减速尾段很长 */
  val EmphasizedDecelerate: Easing = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)

  /** 退场起始：几乎立刻离开，不在退场上花时间 */
  val EmphasizedAccelerate: Easing = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)

  /** 形变/共享元素 */
  val Emphasized: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)

  val Linear: Easing = CubicBezierEasing(0f, 0f, 1f, 1f)
}

@Immutable
data class OneUiMotion(val scale: Float) {
  val isReduced: Boolean get() = scale <= 0.01f

  fun duration(ms: Int): Int = if (isReduced) 0 else (ms * scale).roundToInt().coerceAtLeast(16)

  fun <T> tween(
    durationMs: Int,
    easing: Easing = OneUiEasing.Standard,
    delayMs: Int = 0
  ): FiniteAnimationSpec<T> = androidx.compose.animation.core.tween(
    durationMillis = duration(durationMs),
    easing = easing,
    delayMillis = if (isReduced) 0 else delayMs
  )

  /** 位移：减弱动效时为 0，避免任何滑动 */
  fun offset(fullWidth: Int, fraction: Float = 0.24f): Int = if (isReduced) 0 else (fullWidth * fraction).roundToInt()

  fun <T> spring(
    dampingRatio: Float = Spring.DampingRatioNoBouncy,
    stiffness: Float = Spring.StiffnessMediumLow
  ): AnimationSpec<T> = if (isReduced) {
    androidx.compose.animation.core.tween(durationMillis = 0)
  } else {
    androidx.compose.animation.core.spring(dampingRatio = dampingRatio, stiffness = stiffness)
  }

  companion object {
    val Reduced = OneUiMotion(0f)
    val Standard = OneUiMotion(1f)
  }
}

val LocalOneUiMotion: ProvidableCompositionLocal<OneUiMotion> =
  compositionLocalOf { OneUiMotion.Standard }

@Composable
fun rememberOneUiMotion(): OneUiMotion {
  val context = LocalContext.current
  return remember(context) {
    OneUiMotion(
      scale = runCatching {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
      }.getOrDefault(1f).coerceIn(0f, 2f)
    )
  }
}

/**
 * 页面转场（动）：前进=新页从底部轻微上移 + 放大 1.5% + 淡入，旧页只做淡出；
 * 后退=镜像。这是 One UI 打开子页面的实际组织方式，比纯横向推入更稳，
 * 也不会让一级页面（设备列表）左右晃动。
 */
fun oneUiScreenTransition(forward: Boolean, motion: OneUiMotion): ContentTransform {
  val enterDuration = motion.duration(OneUiDuration.Screen)
  val exitDuration = motion.duration(OneUiDuration.Exit)
  val offsetY = motion.offset(64) * 3
  val slideX = motion.offset(520)
  return if (forward) {
    ContentTransform(
      targetContentEnter = slideInVertically(
        animationSpec = tween(enterDuration, easing = OneUiEasing.EmphasizedDecelerate),
        initialOffsetY = { offsetY }
      ) + scaleIn(
        // 1.5% 的放大：与按下缩放 0.972 不是一个量，别把进场的“展开”做成“按下”（动）
        animationSpec = tween(enterDuration, easing = OneUiEasing.EmphasizedDecelerate),
        initialScale = if (motion.isReduced) 1f else 0.985f
      ) + fadeIn(tween(motion.duration(OneUiDuration.Enter), easing = OneUiEasing.Standard)),
      initialContentExit = fadeOut(tween(exitDuration, easing = OneUiEasing.EmphasizedAccelerate)),
      sizeTransform = null
    )
  } else {
    ContentTransform(
      targetContentEnter = slideInHorizontally(
        animationSpec = tween(enterDuration, easing = OneUiEasing.EmphasizedDecelerate),
        initialOffsetX = { -slideX / 2 }
      ) + fadeIn(tween(motion.duration(OneUiDuration.Enter), delayMillis = motion.duration(50))),
      initialContentExit = slideOutVertically(
        animationSpec = tween(exitDuration, easing = OneUiEasing.EmphasizedAccelerate),
        targetOffsetY = { offsetY }
      ) + scaleOut(
        animationSpec = tween(exitDuration, easing = OneUiEasing.EmphasizedAccelerate),
        targetScale = if (motion.isReduced) 1f else 0.982f
      ) + fadeOut(tween(exitDuration, easing = OneUiEasing.EmphasizedAccelerate)),
      sizeTransform = null
    )
  }
}

/** 同一页面内切换内容（时间粒度、tab、实例）：横向轻推 + 淡入淡出。 */
fun oneUiSlideSwitch(forwardToRight: Boolean, motion: OneUiMotion, distancePx: Int = 40): ContentTransform {
  val enter = motion.duration(OneUiDuration.Content)
  val exit = motion.duration(OneUiDuration.Exit)
  val delta = if (forwardToRight) 1 else -1
  val shift = motion.offset(distancePx) * delta
  return ContentTransform(
    targetContentEnter = slideInHorizontally(
      animationSpec = tween(enter, easing = OneUiEasing.EmphasizedDecelerate),
      initialOffsetX = { shift }
    ) + fadeIn(tween(enter, delayMillis = motion.duration(40))),
    initialContentExit = slideOutHorizontally(
      animationSpec = tween(exit, easing = OneUiEasing.EmphasizedAccelerate),
      targetOffsetX = { -shift }
    ) + fadeOut(tween(exit, easing = OneUiEasing.EmphasizedAccelerate)),
    sizeTransform = null
  )
}

/** 数值刷新时的补间（动）：旧值滑向新值，而不是硬跳。 */
@Composable
fun oneUiAnimatedValue(target: Float, motion: OneUiMotion, durationMs: Int = OneUiDuration.ValueTick): Float =
  animateFloatAsState(
    targetValue = target,
    animationSpec = motion.tween(durationMs, OneUiEasing.EmphasizedDecelerate),
    label = "oneui_value"
  ).value

/** 列表逐项入场（动）：One UI 的交错很短，只用于首次出现，滚动时不会重复播放。 */
fun oneUiListEnter(motion: OneUiMotion, index: Int): EnterTransition {
  if (motion.isReduced) return EnterTransition.None
  val delay = motion.duration(OneUiDuration.Stagger * index.coerceAtMost(OneUiDuration.StaggerMax))
  return fadeIn(
    animationSpec = tween(motion.duration(OneUiDuration.Enter), delayMillis = delay, easing = OneUiEasing.EmphasizedDecelerate)
  ) + slideInVertically(
    animationSpec = tween(motion.duration(OneUiDuration.Enter), delayMillis = delay, easing = OneUiEasing.EmphasizedDecelerate)
  ) { offset -> (offset * 0.05f).roundToInt() }
}

fun oneUiListExit(motion: OneUiMotion): ExitTransition =
  if (motion.isReduced) ExitTransition.None else fadeOut(tween(motion.duration(OneUiDuration.Exit)))

/** 面板内容出现（动）：先容器后面板内元素，避免整块一起闪现。 */
fun oneUiSheetContentEnter(motion: OneUiMotion): EnterTransition =
  if (motion.isReduced) EnterTransition.None else fadeIn(tween(motion.duration(OneUiDuration.Content), delayMillis = motion.duration(60)))
