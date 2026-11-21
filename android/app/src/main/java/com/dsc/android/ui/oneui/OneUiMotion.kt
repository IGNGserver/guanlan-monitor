package com.dsc.android.ui.oneui

import android.provider.Settings
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
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
import androidx.compose.ui.unit.IntOffset
import kotlin.math.roundToInt

/**
 * One UI 动效体系（动）。
 *
 * 对齐 Samsung 官方 One UI Motion 规范（developer.samsung.com/one-ui/motion）与 SESL 曲线族：
 * 1. 官方时长铁律：交互动画落在 100ms–500ms 区间，按元素面积分级；进场从容、退场更快；
 * 2. 官方基础曲线 Basic Path Interpolator = (0.22, 0.25, 0.00, 1.00)，辅以 SESL 的
 *    SineInOut90 / 80 / 70 / 33 系列——起势柔和、收尾绵长自然，区别于 Material 3 的急促陡起；
 * 3. 一级底部 Tab 切换使用纯粹跨淡（不纵向推入），子页面才做微移 + 微缩放转场；
 * 4. 系统“动画缩放”为 0（含三星“减少动画”开关）时整套体系降级为瞬时切换（适）。
 */
object OneUiDuration {
  const val Press = 130
  const val Toggle = 280
  const val TabSwitch = 260
  const val Content = 320
  const val Enter = 340
  const val Exit = 220
  const val Dialog = 320
  const val Screen = 420
  const val ScreenExit = 240
  const val Sheet = 380
  const val Stagger = 38
  const val StaggerMax = 6
  const val ValueTick = 480
  const val ChartDraw = 680
  const val Skeleton = 1_050
  const val Toast = 2_400
  /** 常驻指示器的周期：不属于交互动效，但仍只在这里登记 */
  const val SpinnerCycle = 820
  const val SpinFrame = 900
  const val ProgressSlide = 1_100
  /** 陈旧图表的扫光周期：比骨架屏更慢，避免同屏多图一起闪 */
  const val StaleSweep = 1_600
}

object OneUiEasing {
  /** Samsung 官方 One UI Basic Path Interpolator（页面转场、核心形变） */
  val Basic: Easing = CubicBezierEasing(0.22f, 0.25f, 0.00f, 1.00f)

  /** SESL SINE_IN_OUT_90：长尾柔停（面板展开、折叠容器、图表描线、视图切换） */
  val SineInOut90: Easing = CubicBezierEasing(0.33f, 0.00f, 0.10f, 1.00f)

  /** SESL SINE_IN_OUT_80：标准状态过渡（滑块、胶囊变色、数值补间、列表重排） */
  val SineInOut80: Easing = CubicBezierEasing(0.33f, 0.00f, 0.20f, 1.00f)

  /** SESL SINE_IN_OUT_70：敏捷微交互（按压、开关、图标旋转、勾选绘制） */
  val SineInOut70: Easing = CubicBezierEasing(0.33f, 0.00f, 0.30f, 1.00f)

  /** SESL SINE_IN_OUT_33：对称淡入淡出（一级 Tab 跨淡、透明遮罩） */
  val SineInOut33: Easing = CubicBezierEasing(0.33f, 0.00f, 0.67f, 1.00f)

  /** 退场柔和加速曲线：快于进场，但不生硬抽离 */
  val Exit: Easing = CubicBezierEasing(0.33f, 0.00f, 0.60f, 1.00f)

  val Linear: Easing = CubicBezierEasing(0f, 0f, 1f, 1f)

  // ---- 兼容语义别名（映射到 One UI 官方曲线族）----
  val Standard: Easing = SineInOut80
  val EmphasizedDecelerate: Easing = SineInOut90
  val EmphasizedAccelerate: Easing = Exit
  val Emphasized: Easing = Basic
}

@Immutable
data class OneUiMotion(val scale: Float) {
  val isReduced: Boolean get() = scale <= 0.01f

  fun duration(ms: Int): Int = if (isReduced) 0 else (ms * scale).roundToInt().coerceAtLeast(16)

  fun <T> tween(
    durationMs: Int,
    easing: Easing = OneUiEasing.SineInOut80,
    delayMs: Int = 0
  ): FiniteAnimationSpec<T> = androidx.compose.animation.core.tween(
    durationMillis = duration(durationMs),
    easing = easing,
    delayMillis = if (isReduced) 0 else delayMs
  )

  /** 位移：减弱动效时为 0，避免任何滑动 */
  fun offset(fullWidth: Int, fraction: Float = 0.24f): Int = if (isReduced) 0 else (fullWidth * fraction).roundToInt()

  fun <T> spring(
    dampingRatio: Float = 0.84f,
    stiffness: Float = 380f
  ): AnimationSpec<T> = if (isReduced) {
    androidx.compose.animation.core.tween(durationMillis = 0)
  } else {
    androidx.compose.animation.core.spring(dampingRatio = dampingRatio, stiffness = stiffness)
  }

  /** One UI 7/8 按压与回弹弹簧：柔和有韧性，不过度回弹 */
  fun <T> pressSpring(): AnimationSpec<T> = spring(dampingRatio = 0.78f, stiffness = 380f)

  /** One UI 7/8 指示胶囊与底栏滑移弹簧 */
  fun <T> tabSpring(): AnimationSpec<T> = spring(dampingRatio = 0.82f, stiffness = 340f)

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
 * 一级底部导航 Tab 切换（动）：同级目的地使用纯净跨淡 + 极微缩放，
 * 不做子页面的纵向推入，避免“切个 Tab 像进了二级页”的层级错觉。
 */
fun oneUiTabTransition(motion: OneUiMotion): ContentTransform {
  val dur = motion.duration(OneUiDuration.TabSwitch)
  return ContentTransform(
    targetContentEnter = fadeIn(
      animationSpec = tween(dur, easing = OneUiEasing.SineInOut33)
    ) + scaleIn(
      animationSpec = tween(dur, easing = OneUiEasing.SineInOut80),
      initialScale = if (motion.isReduced) 1f else 0.988f
    ),
    initialContentExit = fadeOut(
      animationSpec = tween(motion.duration(OneUiDuration.Exit), easing = OneUiEasing.SineInOut33)
    ),
    sizeTransform = null
  )
}

/**
 * 同页内容形态切换（切换设备组、切换趋势卡/紧凑行）：柔和淡入淡出 + 极轻浮现。
 */
fun oneUiFadeScaleSwitch(motion: OneUiMotion): ContentTransform {
  val enter = motion.duration(OneUiDuration.Content)
  val exit = motion.duration(OneUiDuration.Exit)
  return ContentTransform(
    targetContentEnter = fadeIn(
      animationSpec = tween(enter, easing = OneUiEasing.SineInOut90)
    ) + scaleIn(
      animationSpec = tween(enter, easing = OneUiEasing.SineInOut90),
      initialScale = if (motion.isReduced) 1f else 0.986f
    ),
    initialContentExit = fadeOut(
      animationSpec = tween(exit, easing = OneUiEasing.Exit)
    ),
    sizeTransform = null
  )
}

/** LazyColumn 列表项重排/增删过渡规格（动）。 */
fun oneUiListPlacementSpec(motion: OneUiMotion): FiniteAnimationSpec<IntOffset> =
  motion.tween(OneUiDuration.Content, OneUiEasing.SineInOut80)

/**
 * 子页面转场（动）：前进=新页从底部轻微上移 + 微缩放 + 淡入（One UI Basic 曲线 420ms），
 * 旧页更快淡出（240ms）；后退=镜像。
 */
fun oneUiScreenTransition(forward: Boolean, motion: OneUiMotion): ContentTransform {
  val enterDuration = motion.duration(OneUiDuration.Screen)
  val exitDuration = motion.duration(OneUiDuration.ScreenExit)
  val offsetY = motion.offset(88) * 3
  val slideX = motion.offset(520)
  return if (forward) {
    ContentTransform(
      targetContentEnter = slideInVertically(
        animationSpec = tween(enterDuration, easing = OneUiEasing.Basic),
        initialOffsetY = { offsetY }
      ) + scaleIn(
        animationSpec = tween(enterDuration, easing = OneUiEasing.Basic),
        initialScale = if (motion.isReduced) 1f else 0.98f
      ) + fadeIn(tween(motion.duration(OneUiDuration.Enter), easing = OneUiEasing.SineInOut80)),
      initialContentExit = fadeOut(tween(exitDuration, easing = OneUiEasing.Exit)),
      sizeTransform = null
    )
  } else {
    ContentTransform(
      targetContentEnter = slideInHorizontally(
        animationSpec = tween(enterDuration, easing = OneUiEasing.Basic),
        initialOffsetX = { -slideX / 2 }
      ) + fadeIn(tween(motion.duration(OneUiDuration.Enter), delayMillis = motion.duration(40), easing = OneUiEasing.SineInOut80)),
      initialContentExit = slideOutVertically(
        animationSpec = tween(exitDuration, easing = OneUiEasing.Exit),
        targetOffsetY = { offsetY }
      ) + scaleOut(
        animationSpec = tween(exitDuration, easing = OneUiEasing.Exit),
        targetScale = if (motion.isReduced) 1f else 0.978f
      ) + fadeOut(tween(exitDuration, easing = OneUiEasing.Exit)),
      sizeTransform = null
    )
  }
}

/** 同一页面内切换内容（时间粒度、tab、实例）：横向轻推 + 淡入淡出（One UI SineInOut90）。 */
fun oneUiSlideSwitch(forwardToRight: Boolean, motion: OneUiMotion, distancePx: Int = 56): ContentTransform {
  val enter = motion.duration(OneUiDuration.Content)
  val exit = motion.duration(OneUiDuration.Exit)
  val delta = if (forwardToRight) 1 else -1
  val shift = motion.offset(distancePx) * delta
  return ContentTransform(
    targetContentEnter = slideInHorizontally(
      animationSpec = tween(enter, easing = OneUiEasing.SineInOut90),
      initialOffsetX = { shift }
    ) + fadeIn(tween(enter, delayMillis = motion.duration(36), easing = OneUiEasing.SineInOut80)),
    initialContentExit = slideOutHorizontally(
      animationSpec = tween(exit, easing = OneUiEasing.Exit),
      targetOffsetX = { -shift }
    ) + fadeOut(tween(exit, easing = OneUiEasing.Exit)),
    sizeTransform = null
  )
}

/** 数值刷新时的补间（动）：旧值滑向新值，而不是硬跳。 */
@Composable
fun oneUiAnimatedValue(target: Float, motion: OneUiMotion, durationMs: Int = OneUiDuration.ValueTick): Float =
  animateFloatAsState(
    targetValue = target,
    animationSpec = motion.tween(durationMs, OneUiEasing.SineInOut80),
    label = "oneui_value"
  ).value

/** 列表逐项入场（动）：One UI 的交错很短，只用于首次出现，滚动时不会重复播放。 */
fun oneUiListEnter(motion: OneUiMotion, index: Int): EnterTransition {
  if (motion.isReduced) return EnterTransition.None
  val delay = motion.duration(OneUiDuration.Stagger * index.coerceAtMost(OneUiDuration.StaggerMax))
  return fadeIn(
    animationSpec = tween(motion.duration(OneUiDuration.Enter), delayMillis = delay, easing = OneUiEasing.SineInOut90)
  ) + slideInVertically(
    animationSpec = tween(motion.duration(OneUiDuration.Enter), delayMillis = delay, easing = OneUiEasing.SineInOut90)
  ) { offset -> (offset * 0.05f).roundToInt() }
}

fun oneUiListExit(motion: OneUiMotion): ExitTransition =
  if (motion.isReduced) ExitTransition.None else fadeOut(tween(motion.duration(OneUiDuration.Exit), easing = OneUiEasing.Exit))

/** 面板内容出现（动）：先容器后面板内元素，避免整块一起闪现。 */
fun oneUiSheetContentEnter(motion: OneUiMotion): EnterTransition =
  if (motion.isReduced) EnterTransition.None else fadeIn(
    tween(motion.duration(OneUiDuration.Content), delayMillis = motion.duration(60), easing = OneUiEasing.SineInOut80)
  )

/**
 * 预见式返回手势进度映射状态（动）。
 *
 * 在 Android 14+ / One UI 6+ / 7+ 上，用户从侧边滑入返回时提供实时位移与缩放，
 * 带来如同原生系统级别的弹性跟手感。
 */
@Immutable
data class OneUiPredictiveBackProgress(
  val progress: Float = 0f,
  val swipeEdge: Int = 0
) {
  val scale: Float
    get() = 1f - (progress * 0.08f).coerceIn(0f, 0.08f)

  val translationX: Float
    get() = (if (swipeEdge == 0) 1f else -1f) * progress * 48f

  /** 当前页面略微透出，让应用内实时绘制的上一页可见（交）。 */
  val contentAlpha: Float
    get() = (1f - progress * 0.18f).coerceIn(0.82f, 1f)
}
