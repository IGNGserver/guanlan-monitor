@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package com.dsc.android.ui.oneui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.Dp

/**
 * 交互状态层（交）。
 *
 * One UI 的可交互表面有 6 个状态：普通 / hover / pressed / selected / disabled / focus，
 * 并且表现方式统一——同一支墨色（ink）只改透明度，再加极轻的整体缩放，
 * 不用 Material 那种从触点扩散的水波。这里把规则收敛成一层，
 * 所有可交互组件必须走它，避免每个组件各自发明状态。
 */
@Immutable
data class OneUiInteraction(
  val pressed: Boolean,
  val hovered: Boolean,
  val focused: Boolean,
  val enabled: Boolean
) {
  /** 叠加墨色的透明度：pressed > hovered > selected。 */
  fun overlayAlpha(selected: Boolean, metrics: OneUiMetrics): Float = when {
    !enabled -> 0f
    pressed -> metrics.pressedOverlay
    hovered -> metrics.hoverOverlay
    selected -> metrics.selectedOverlay
    else -> 0f
  }

  fun scale(metrics: OneUiMetrics, motion: OneUiMotion): Float = when {
    !enabled || motion.isReduced -> 1f
    pressed -> metrics.pressedScale
    else -> 1f
  }
}

@Composable
fun rememberOneUiInteractionSource(): MutableInteractionSource = remember { MutableInteractionSource() }

/** 订阅 pressed / hovered / focused；hover 由 [Modifier.oneUiHoverable] 供给。 */
@Composable
fun oneUiInteraction(
  interactionSource: MutableInteractionSource,
  enabled: Boolean
): OneUiInteraction {
  val pressed by interactionSource.collectIsPressedAsState()
  val hovered by interactionSource.collectIsHoveredAsState()
  val focused by interactionSource.collectIsFocusedAsState()
  return OneUiInteraction(
    pressed = pressed,
    hovered = hovered,
    focused = focused,
    enabled = enabled
  )
}

/** 让 hover 进入同一个 interactionSource；触屏设备上永远为 false，因此不需要判定“是否接了鼠标”。 */
@Composable
fun Modifier.oneUiHoverable(interactionSource: MutableInteractionSource): Modifier =
  this.hoverable(interactionSource = interactionSource)

@Immutable
enum class OneUiHaptics {
  /** 轻触：按钮、chip、tab */
  Tap,

  /** 开关 / 勾选的确认感 */
  Toggle,

  /** 长按唤出操作面板 */
  LongPress,

  /** 无反馈（高频自动刷新区域） */
  None
}

/**
 * 统一的“可按”实现：墨色叠加 + 轻微缩放 + 焦点框 + 触觉 + 无障碍角色（件 + 交 + 适）。
 *
 * `indication = null` 是有意为之：不使用 Material 水波，状态由本层的墨色表达。
 */
@Composable
fun Modifier.oneUiPressable(
  onClick: (() -> Unit)? = null,
  enabled: Boolean = true,
  selected: Boolean = false,
  shape: Shape = OneUiTheme.shapes.group,
  colors: OneUiColors = OneUiTheme.colors,
  metrics: OneUiMetrics = OneUiTheme.metrics,
  motion: OneUiMotion = OneUiTheme.motion,
  interactionSource: MutableInteractionSource = rememberOneUiInteractionSource(),
  haptics: OneUiHaptics = OneUiHaptics.Tap,
  onLongClick: (() -> Unit)? = null,
  role: Role = Role.Button,
  minHeight: Dp? = null,
  stateLabel: String? = null
): Modifier {
  val interaction = oneUiInteraction(interactionSource, enabled = enabled)
  val performHaptic = rememberOneUiHaptic()

  val inkAlpha = animateFloatAsState(
    targetValue = interaction.overlayAlpha(selected = selected, metrics = metrics),
    animationSpec = motion.tween(
      if (interaction.pressed) OneUiDuration.Press else OneUiDuration.Content
    ),
    label = "oneui_ink"
  )
  val layerScale = animateFloatAsState(
    targetValue = interaction.scale(metrics, motion),
    animationSpec = motion.spring(),
    label = "oneui_scale"
  )

  return this
    .semantics { stateLabel?.let { this.stateDescription = it } }
    .graphicsLayer {
      scaleX = layerScale.value
      scaleY = layerScale.value
      alpha = if (enabled) 1f else metrics.disabledContent
    }
    .clip(shape)
    .background(colors.ink.copy(alpha = inkAlpha.value), shape)
    // 焦点框画在墨色与容器底色之上：放在 background 之前会被自己那层墨色盖住，
    // 键盘/遥控器/DeX 下等于没有焦点态（交 + 适）
    .then(
      if (interaction.focused) Modifier.border(metrics.focusStroke, colors.focusRing, shape) else Modifier
    )
    .then(if (minHeight != null) Modifier.defaultMinSize(minHeight = minHeight) else Modifier)
    .oneUiHoverable(interactionSource)
    .then(
      if (onClick == null && onLongClick == null) {
        Modifier
      } else {
        Modifier.combinedClickable(
          onClick = {
            performHaptic(haptics)
            onClick?.invoke()
          },
          onLongClick = onLongClick?.let { callback ->
            {
              performHaptic(OneUiHaptics.LongPress)
              callback()
            }
          },
          enabled = enabled,
          interactionSource = interactionSource,
          indication = null,
          role = role
        )
      }
    )
}

/** 开关/勾选状态的语言化描述：TalkBack 下颜色不是唯一信息载体（适）。 */
fun oneUiToggleDescription(state: ToggleableState): String = when (state) {
  ToggleableState.On -> "已开启"
  ToggleableState.Off -> "已关闭"
  ToggleableState.Indeterminate -> "部分开启"
}

/**
 * 触觉反馈（交）。
 *
 * One UI 的反馈是分档的：点按是一下轻击，开关/勾选是更脆的一下，长按是确认。
 * 这一档 Compose 的 HapticFeedbackType 只暴露了 LongPress 与 TextHandleMove，
 * 所以直接走平台的 HapticFeedbackConstants（VIRTUAL_KEY / CLOCK_TICK / LONG_PRESS），
 * 拿不到 View 或系统拒绝时回落 Compose 的 LongPress，绝不静默丢掉反馈。
 */
@Composable
fun rememberOneUiHaptic(): (OneUiHaptics) -> Unit {
  val view = LocalView.current
  val fallback = LocalHapticFeedback.current
  val action: (OneUiHaptics) -> Unit = haptic@{ type ->
    val constant = when (type) {
      OneUiHaptics.Tap -> android.view.HapticFeedbackConstants.VIRTUAL_KEY
      OneUiHaptics.Toggle -> android.view.HapticFeedbackConstants.CLOCK_TICK
      OneUiHaptics.LongPress -> android.view.HapticFeedbackConstants.LONG_PRESS
      OneUiHaptics.None -> null
    }
    if (constant == null) return@haptic
    val performed = runCatching { view.performHapticFeedback(constant) }.getOrDefault(false)
    if (!performed) {
      fallback.performHapticFeedback(HapticFeedbackType.LongPress)
    }
  }
  return remember(view, fallback) { action }
}
