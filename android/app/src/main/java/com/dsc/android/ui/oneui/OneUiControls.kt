package com.dsc.android.ui.oneui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * One UI 控件层（件 + 交）。
 *
 * 只实现 One UI 语义下必需的控件：文本角色、胶囊按钮、图标按钮、开关、勾选、
 * 筛选胶囊、分段选择、输入框。开关与勾选自行绘制（One UI 形态与 Material 差别最大），
 * 但点击与无障碍语义仍走官方的 `clickable(role=...)` + semantics（适）。
 */

/** 字阶角色：页面不允许直接写 `fontSize`，只能选角色——这是形落地的约束点。 */
@Immutable
enum class OneUiTextRole {
  Display, DisplaySecondary, Figure, FigureSecondary, TopBarLarge, TopBarCollapsed,
  Headline, Title, Subtitle, Body, BodySecondary, Caption, Chip, Metric, MetricUnit,
  RowTitle, RowSubtitle, SectionHeader, ChartLabel, Mono
}

@Composable
fun OneUiText(
  text: String,
  role: OneUiTextRole = OneUiTextRole.Body,
  modifier: Modifier = Modifier,
  color: Color? = null,
  weight: FontWeight? = null,
  maxLines: Int = when (role) {
    OneUiTextRole.Body, OneUiTextRole.BodySecondary, OneUiTextRole.RowSubtitle, OneUiTextRole.Caption -> 4
    else -> 2
  },
  textAlign: TextAlign? = null,
  overflow: TextOverflow = TextOverflow.Ellipsis
) {
  val type = OneUiTheme.type
  val colors = OneUiTheme.colors
  val style: TextStyle = when (role) {
    OneUiTextRole.Display -> type.displayLarge
    OneUiTextRole.DisplaySecondary -> type.displayMedium
    OneUiTextRole.Figure -> type.figureLarge
    OneUiTextRole.FigureSecondary -> type.figureMedium
    OneUiTextRole.TopBarLarge -> type.topBarLarge
    OneUiTextRole.TopBarCollapsed -> type.topBarSmall
    OneUiTextRole.Headline -> type.headline
    OneUiTextRole.Title -> type.title
    OneUiTextRole.Subtitle -> type.subtitle
    OneUiTextRole.Body -> type.body
    OneUiTextRole.BodySecondary -> type.bodySmall
    OneUiTextRole.Caption -> type.caption
    OneUiTextRole.Chip -> type.chipLabel
    OneUiTextRole.Metric -> type.metricValue
    OneUiTextRole.MetricUnit -> type.metricUnit
    OneUiTextRole.RowTitle -> type.rowTitle
    OneUiTextRole.RowSubtitle -> type.rowSubtitle
    OneUiTextRole.SectionHeader -> type.sectionHeader
    OneUiTextRole.ChartLabel -> type.chartLabel
    OneUiTextRole.Mono -> type.monoFigure
  }
  Text(
    text = text,
    modifier = modifier,
    color = color ?: colors.textPrimary,
    style = weight?.let { style.copy(fontWeight = it) } ?: style,
    maxLines = maxLines,
    textAlign = textAlign,
    overflow = overflow
  )
}

/** 次要文字色，页面不再各自挑 onSurfaceVariant。 */
@Composable
fun oneUiSecondaryColor(highlight: Boolean = false): Color =
  if (highlight) OneUiTheme.colors.textPrimary else OneUiTheme.colors.textSecondary

@Immutable
enum class OneUiButtonVariant { Filled, Tonal, Outlined, Text }

@Immutable
enum class OneUiButtonSize(val height: Dp) {
  /** 48dp：对话框、通知条与卡片里的次要动作也必须满足最小命中区（适） */
  Compact(48.dp),
  Regular(52.dp),
  Large(60.dp)
}

/**
 * 胶囊按钮（件）。One UI 的主行动按钮始终全圆角、中等字重、高度 52dp 起，
 * 并且 loading 时保留文案宽度，避免按钮在加载过程中跳动（交）。
 */
@Composable
fun OneUiButton(
  label: String,
  onClick: (() -> Unit)?,
  modifier: Modifier = Modifier,
  variant: OneUiButtonVariant = OneUiButtonVariant.Filled,
  size: OneUiButtonSize = OneUiButtonSize.Regular,
  enabled: Boolean = true,
  loading: Boolean = false,
  selected: Boolean = false,
  destructive: Boolean = false,
  leadingIcon: @Composable (() -> Unit)? = null,
  fillWidth: Boolean = false
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  val interaction = rememberOneUiInteractionSource()
  val visual = oneUiInteraction(interaction, enabled = enabled && !loading && onClick != null)

  val containerBase = when (variant) {
    OneUiButtonVariant.Filled -> colors.accent
    OneUiButtonVariant.Tonal -> colors.accentSoft
    OneUiButtonVariant.Outlined, OneUiButtonVariant.Text -> Color.Transparent
  }
  val contentColor = when {
    destructive -> colors.criticalContent
    variant == OneUiButtonVariant.Filled -> colors.textOnAccent
    variant == OneUiButtonVariant.Tonal -> colors.accentSoftContent
    else -> colors.accent
  }

  Box(
    modifier = modifier
      .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier)
      .defaultMinSize(minHeight = size.height)
      .background(if (variant == OneUiButtonVariant.Filled && visual.pressed) colors.accentPressed else containerBase, shapes.pill)
      .oneUiPressable(
        onClick = if (loading) null else onClick,
        enabled = enabled && !loading,
        shape = shapes.pill,
        colors = colors,
        metrics = metrics,
        motion = motion,
        interactionSource = interaction,
        role = Role.Button,
        minHeight = null,
        stateLabel = when {
          loading -> "处理中"
          selected -> "已选中"
          else -> null
        }
      )
      .then(
        if (variant == OneUiButtonVariant.Outlined) {
          Modifier.border(
            width = 1.6.dp,
            color = when {
              destructive -> colors.critical
              selected -> colors.accent
              else -> colors.outline
            },
            shape = shapes.pill
          )
        } else {
          Modifier
        }
      )
      .semantics { contentDescription = label },
    contentAlignment = Alignment.Center
  ) {
    Row(
      modifier = Modifier.padding(horizontal = if (size == OneUiButtonSize.Compact) 18.dp else 24.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
      if (loading) {
        OneUiSpinner(size = 18.dp, color = contentColor, strokeWidth = 2.2.dp)
      } else if (leadingIcon != null) {
        leadingIcon()
      }
      OneUiText(
        text = label,
        role = OneUiTextRole.Body,
        color = contentColor,
        weight = FontWeight.SemiBold,
        maxLines = 1
      )
    }
  }
}

/** 图标按钮：48dp 命中区，常态无可见容器，选中态用浅底（交）。 */
@Composable
fun OneUiIconButton(
  contentDescription: String,
  onClick: (() -> Unit)?,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  selected: Boolean = false,
  spinning: Boolean = false,
  size: Dp = OneUiTheme.metrics.iconButton,
  haptics: OneUiHaptics = OneUiHaptics.Tap,
  content: @Composable () -> Unit
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val rotation = oneUiSpinDegrees(active = spinning, motion = OneUiTheme.motion)

  Box(
    modifier = modifier
      .size(size)
      // 选中态的浅底必须在墨色之下，否则按下去什么反馈都看不到（交）
      .then(if (selected) Modifier.background(colors.accentSoft, shapes.circle) else Modifier)
      .oneUiPressable(
        onClick = onClick,
        enabled = enabled,
        selected = selected,
        shape = shapes.circle,
        haptics = haptics,
        role = Role.Button,
        minHeight = null
      )
      .semantics {
        this.contentDescription = contentDescription
        if (selected) this.selected = true
      },
    contentAlignment = Alignment.Center
  ) {
    Box(modifier = if (spinning) Modifier.rotate(rotation) else Modifier) { content() }
  }
}

/**
 * One UI 开关：描边空轨道 + 大圆滑块，开启时轨道被强调色填满。
 * 点击走统一状态层，语义用 `Role.Switch` + `stateDescription`（适）。
 */
@Composable
fun OneUiSwitch(
  checked: Boolean,
  onCheckedChange: ((Boolean) -> Unit)?,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  label: String? = null
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val motion = OneUiTheme.motion
  val metrics = OneUiTheme.metrics
  val trackWidth = 52.dp
  val trackHeight = 32.dp
  val thumbSize = 24.dp
  val travel = trackWidth - thumbSize - 8.dp

  val thumbProgress by animateFloatAsState(
    targetValue = if (checked) 1f else 0f,
    animationSpec = motion.pressSpring(),
    label = "oneui_switch_thumb"
  )
  val borderColor by animateColorAsState(
    targetValue = if (checked) Color.Transparent else colors.outline,
    animationSpec = motion.tween(OneUiDuration.Toggle, OneUiEasing.SineInOut70),
    label = "oneui_switch_border"
  )

  Box(
    modifier = modifier
      .defaultMinSize(minWidth = trackWidth, minHeight = metrics.touchTarget)
      .oneUiPressable(
        onClick = onCheckedChange?.let { callback -> { callback(!checked) } },
        enabled = enabled,
        shape = shapes.pill,
        role = Role.Switch,
        minHeight = null,
        haptics = OneUiHaptics.Toggle,
        stateLabel = oneUiToggleDescription(
          if (checked) androidx.compose.ui.state.ToggleableState.On else androidx.compose.ui.state.ToggleableState.Off
        )
      )
      .semantics { label?.let { this.contentDescription = it } },
    contentAlignment = Alignment.CenterStart
  ) {
    Box(
      modifier = Modifier
        .size(width = trackWidth, height = trackHeight)
        .background(
          color = lerp(Color.Transparent, colors.accent, thumbProgress),
          shape = shapes.pill
        )
        .border(
          width = 1.6.dp,
          color = borderColor,
          shape = shapes.pill
        )
    ) {
      Box(
        modifier = Modifier
          .padding(4.dp)
          .offset(x = travel * thumbProgress)
          .size(thumbSize)
          .background(if (enabled) Color.White else colors.textDisabled, shapes.circle)
      )
    }
  }
}

/** One UI 勾选框：圆角方框，勾选后平滑填色 + 路径描勾 + 轻弹反馈。 */
@Composable
fun OneUiCheckbox(
  checked: Boolean,
  onCheckedChange: ((Boolean) -> Unit)?,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  indeterminate: Boolean = false,
  label: String? = null
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  val box = 24.dp
  val filled = checked || indeterminate

  val fillColor by animateColorAsState(
    targetValue = if (filled) colors.accent else Color.Transparent,
    animationSpec = motion.tween(OneUiDuration.Toggle, OneUiEasing.SineInOut80),
    label = "oneui_checkbox_fill"
  )
  val strokeColor by animateColorAsState(
    targetValue = if (filled) Color.Transparent else colors.textTertiary,
    animationSpec = motion.tween(OneUiDuration.Toggle, OneUiEasing.SineInOut80),
    label = "oneui_checkbox_stroke"
  )
  val checkProgress by animateFloatAsState(
    targetValue = if (checked) 1f else 0f,
    animationSpec = motion.tween(OneUiDuration.Toggle, OneUiEasing.SineInOut70),
    label = "oneui_checkbox_mark"
  )
  val checkScale by animateFloatAsState(
    targetValue = if (filled) 1f else 0.94f,
    animationSpec = motion.pressSpring(),
    label = "oneui_checkbox_scale"
  )

  Box(
    modifier = modifier
      .defaultMinSize(minWidth = metrics.touchTarget, minHeight = metrics.touchTarget)
      .oneUiPressable(
        onClick = onCheckedChange?.let { callback -> { callback(!checked) } },
        enabled = enabled,
        shape = shapes.control,
        role = Role.Checkbox,
        minHeight = null,
        haptics = OneUiHaptics.Toggle,
        stateLabel = oneUiToggleDescription(
          when {
            indeterminate && !checked -> androidx.compose.ui.state.ToggleableState.Indeterminate
            checked -> androidx.compose.ui.state.ToggleableState.On
            else -> androidx.compose.ui.state.ToggleableState.Off
          }
        )
      )
      .semantics { label?.let { this.contentDescription = it } },
    contentAlignment = Alignment.Center
  ) {
    Box(
      modifier = Modifier
        .size(box)
        .graphicsLayer {
          scaleX = checkScale
          scaleY = checkScale
        }
        .background(fillColor, shapes.badge)
        .border(
          width = 1.8.dp,
          color = strokeColor,
          shape = shapes.badge
        ),
      contentAlignment = Alignment.Center
    ) {
      if (indeterminate && !checked) {
        Box(
          modifier = Modifier
            .width(12.dp)
            .height(2.4.dp)
            .background(colors.textOnAccent, shapes.badge)
        )
      } else if (checkProgress > 0.01f) {
        Canvas(modifier = Modifier.size(box)) {
          val side = size.minDimension
          val firstEnd = (checkProgress / 0.42f).coerceIn(0f, 1f)
          val secondEnd = ((checkProgress - 0.36f) / 0.64f).coerceIn(0f, 1f)
          val p0 = Offset(side * 0.24f, side * 0.52f)
          val p1 = Offset(side * 0.43f, side * 0.71f)
          val p2 = Offset(side * 0.78f, side * 0.30f)
          if (firstEnd > 0f) {
            drawLine(
              color = colors.textOnAccent,
              start = p0,
              end = Offset(p0.x + (p1.x - p0.x) * firstEnd, p0.y + (p1.y - p0.y) * firstEnd),
              strokeWidth = side * 0.105f,
              cap = StrokeCap.Round
            )
          }
          if (secondEnd > 0f) {
            drawLine(
              color = colors.textOnAccent,
              start = p1,
              end = Offset(p1.x + (p2.x - p1.x) * secondEnd, p1.y + (p2.y - p1.y) * secondEnd),
              strokeWidth = side * 0.105f,
              cap = StrokeCap.Round
            )
          }
        }
      }
    }
  }
}

/**
 * 筛选胶囊（件 + 交）：
 * 视觉高度 38dp（配 13.5sp Chip 字阶与平滑变色），外层保持 48dp 垂直触控热区，
 * 既摆脱 32dp 迷你豆丁的局促感，又符合 Samsung One UI 的现代舒展比例与无障碍底线。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun OneUiFilterChip(
  label: String,
  selected: Boolean,
  onClick: (() -> Unit)?,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  leadingIcon: @Composable (() -> Unit)? = null,
  value: String? = null
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  val interaction = rememberOneUiInteractionSource()
  val visual = oneUiInteraction(interaction, enabled = enabled && onClick != null)
  val performHaptic = rememberOneUiHaptic()

  val containerColor by animateColorAsState(
    targetValue = if (selected) colors.accent else colors.group,
    animationSpec = motion.tween(OneUiDuration.Toggle, OneUiEasing.SineInOut80),
    label = "oneui_chip_bg"
  )
  val borderColor by animateColorAsState(
    targetValue = if (selected) Color.Transparent else colors.outline.copy(alpha = 0.85f),
    animationSpec = motion.tween(OneUiDuration.Toggle, OneUiEasing.SineInOut80),
    label = "oneui_chip_border"
  )
  val labelColor by animateColorAsState(
    targetValue = if (selected) colors.textOnAccent else colors.textPrimary,
    animationSpec = motion.tween(OneUiDuration.Toggle, OneUiEasing.SineInOut80),
    label = "oneui_chip_label"
  )
  val valueColor by animateColorAsState(
    targetValue = if (selected) colors.textOnAccent.copy(alpha = 0.92f) else colors.textSecondary,
    animationSpec = motion.tween(OneUiDuration.Toggle, OneUiEasing.SineInOut80),
    label = "oneui_chip_value"
  )
  val inkAlpha by animateFloatAsState(
    targetValue = visual.overlayAlpha(selected = false, metrics = metrics),
    animationSpec = motion.tween(
      durationMs = if (visual.pressed) OneUiDuration.Press else OneUiDuration.Toggle,
      easing = if (visual.pressed) OneUiEasing.SineInOut70 else OneUiEasing.SineInOut80
    ),
    label = "oneui_chip_ink"
  )
  val layerScale by animateFloatAsState(
    targetValue = visual.scale(metrics, motion),
    animationSpec = motion.pressSpring(),
    label = "oneui_chip_scale"
  )

  Box(
    modifier = modifier
      .defaultMinSize(minHeight = metrics.touchTarget)
      .semantics {
        contentDescription = value?.let { "$label $it" } ?: label
        stateDescription = if (selected) "已选中" else "未选中"
        if (selected) this.selected = true
      }
      .oneUiHoverable(interaction)
      .then(
        if (onClick != null) {
          Modifier.combinedClickable(
            onClick = {
              performHaptic(OneUiHaptics.Tap)
              onClick()
            },
            enabled = enabled,
            interactionSource = interaction,
            indication = null,
            role = Role.Checkbox
          )
        } else {
          Modifier
        }
      ),
    contentAlignment = Alignment.Center
  ) {
    Box(
      modifier = Modifier
        .defaultMinSize(minHeight = metrics.chipHeight)
        .graphicsLayer {
          scaleX = layerScale
          scaleY = layerScale
          alpha = if (enabled) 1f else metrics.disabledContent
        }
        .clip(shapes.pill)
        .background(containerColor, shapes.pill)
        .background(colors.ink.copy(alpha = inkAlpha), shapes.pill)
        .border(
          width = if (visual.focused) metrics.focusStroke else 1.2.dp,
          color = if (visual.focused) colors.focusRing else borderColor,
          shape = shapes.pill
        ),
      contentAlignment = Alignment.Center
    ) {
      Row(
        modifier = Modifier.padding(horizontal = 15.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
      ) {
        leadingIcon?.invoke()
        OneUiText(
          text = label,
          role = OneUiTextRole.Chip,
          color = labelColor,
          weight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
          maxLines = 1
        )
        if (!value.isNullOrBlank()) {
          OneUiText(
            text = value,
            role = OneUiTextRole.Chip,
            color = valueColor,
            weight = FontWeight.SemiBold,
            maxLines = 1
          )
        }
      }
    }
  }
}

/**
 * 分段选择（One UI 的 pill 指示器 tab，动）：
 * 指示器采用 One UI 7/8 弹簧连续滑移（tabSpring），文字平滑过渡颜色；
 * 支持常规态（46dp）与紧凑行内态（38dp，如总览时间窗 5分/1小时/24小时）。
 */
@Composable
fun OneUiSegmentedRow(
  options: List<String>,
  selectedIndex: Int,
  onSelect: (Int) -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  compact: Boolean = false
) {
  if (options.isEmpty()) return
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  val motion = OneUiTheme.motion
  val safeIndex = selectedIndex.coerceIn(0, options.lastIndex)
  val indicatorIndex by animateFloatAsState(
    targetValue = safeIndex.toFloat(),
    animationSpec = motion.tabSpring(),
    label = "oneui_segment_indicator"
  )
  val inset = if (compact) 2.dp else 3.dp
  val trackHeight = (if (compact) metrics.compactSegmentHeight else metrics.segmentHeight) + inset * 2

  BoxWithConstraints(
    modifier = modifier
      .then(if (compact) Modifier else Modifier.fillMaxWidth())
      .height(trackHeight)
      .oneUiSurface(
        color = colors.sunken,
        shape = shapes.pill,
        colors = colors,
        level = OneUiSurfaceLevel.Group,
        border = true,
        hairlineWidth = 0.6.dp
      )
      .padding(inset)
  ) {
    val cellWidth = maxWidth / options.size
    Box(
      modifier = Modifier
        .offset(x = cellWidth * indicatorIndex)
        .width(cellWidth)
        .fillMaxSize()
        .background(if (compact) colors.raised else colors.group, shapes.pill)
    )
    Row(modifier = Modifier.fillMaxSize()) {
      options.forEachIndexed { index, option ->
        val isSelected = index == safeIndex
        val textColor by animateColorAsState(
          targetValue = if (isSelected) colors.textPrimary else colors.textSecondary,
          animationSpec = motion.tween(OneUiDuration.Toggle, OneUiEasing.SineInOut80),
          label = "oneui_segment_text"
        )
        Box(
          modifier = Modifier
            .weight(1f)
            .fillMaxSize()
            .oneUiPressable(
              onClick = { onSelect(index) },
              enabled = enabled,
              shape = shapes.pill,
              role = Role.Tab,
              minHeight = null,
              stateLabel = if (isSelected) "已选中" else "未选中"
            ),
          contentAlignment = Alignment.Center
        ) {
          OneUiText(
            text = option,
            role = OneUiTextRole.Chip,
            color = textColor,
            weight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
            maxLines = 1,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = if (compact) 6.dp else 4.dp)
          )
        }
      }
    }
  }
}

/** 输入框：One UI 用浅底 + 无外描边，聚焦时才出现强调色描边（交）。 */
@Composable
fun OneUiTextField(
  value: String,
  onValueChange: (String) -> Unit,
  label: String,
  modifier: Modifier = Modifier,
  supportingText: String? = null,
  password: Boolean = false,
  enabled: Boolean = true,
  errorText: String? = null,
  singleLine: Boolean = true,
  imeAction: androidx.compose.ui.text.input.ImeAction = androidx.compose.ui.text.input.ImeAction.Next,
  trailing: @Composable (() -> Unit)? = null,
  onVisibleToggle: (() -> Unit)? = null
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  val interaction = rememberOneUiInteractionSource()
  val focused by interaction.collectIsFocusedAsState()
  var reveal by remember(password) { mutableStateOf(false) }

  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    OneUiText(
      text = label,
      role = OneUiTextRole.RowSubtitle,
      color = if (focused) colors.accent else colors.textSecondary
    )
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .defaultMinSize(minHeight = 56.dp)
        .background(colors.sunken, shapes.control)
        .border(
          width = if (focused) 2.dp else 1.4.dp,
          color = when {
            errorText != null -> colors.critical
            focused -> colors.accent
            else -> colors.hairline
          },
          shape = shapes.control
        )
        .padding(horizontal = 16.dp, vertical = 12.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
      BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier
          .weight(1f)
          .semantics { contentDescription = label },
        enabled = enabled,
        singleLine = singleLine,
        // 聚焦态必须接到真正的输入框上：不传 interactionSource 时 focused 永远是 false，
        // One UI 的强调色描边与标签变色就根本不会出现（交）
        interactionSource = interaction,
        textStyle = OneUiTheme.type.body.copy(color = if (enabled) colors.textPrimary else colors.textDisabled),
        cursorBrush = SolidColor(colors.accent),
        keyboardOptions = KeyboardOptions(
          keyboardType = if (password) KeyboardType.Password else KeyboardType.Text,
          imeAction = imeAction
        ),
        visualTransformation = if (password && !reveal) {
          PasswordVisualTransformation()
        } else {
          VisualTransformation.None
        }
      )
      if (password && onVisibleToggle != null) {
        OneUiIconButton(
          contentDescription = if (reveal) "隐藏访问密钥" else "显示访问密钥",
          onClick = { reveal = !reveal; onVisibleToggle() },
          size = metrics.touchTarget
        ) {
          OneUiText(
            text = if (reveal) "隐藏" else "显示",
            role = OneUiTextRole.RowSubtitle,
            color = colors.accent
          )
        }
      }
      trailing?.invoke()
    }
    when {
      !errorText.isNullOrBlank() -> OneUiText(
        text = errorText,
        role = OneUiTextRole.RowSubtitle,
        color = colors.criticalContent
      )

      !supportingText.isNullOrBlank() -> OneUiText(
        text = supportingText,
        role = OneUiTextRole.RowSubtitle,
        color = colors.textTertiary
      )
    }
  }
}

/**
 * 紧凑型单行胶囊搜索栏（件 + 交）：
 * 默认收进顶栏搜索图标，点按展开后仅占单行 44dp 高度，替代原先常驻占掉 84dp 的双层输入框。
 */
@Composable
fun OneUiCompactSearchBar(
  value: String,
  onValueChange: (String) -> Unit,
  placeholder: String,
  onClearOrClose: () -> Unit,
  modifier: Modifier = Modifier
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val interaction = rememberOneUiInteractionSource()
  val focused by interaction.collectIsFocusedAsState()

  Row(
    modifier = modifier
      .fillMaxWidth()
      .defaultMinSize(minHeight = 44.dp)
      .background(colors.sunken, shapes.pill)
      .border(
        width = if (focused) 1.8.dp else 1.2.dp,
        color = if (focused) colors.accent else colors.hairline,
        shape = shapes.pill
      )
      .padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp)
  ) {
    OneUiIcon(
      imageVector = Icons.Rounded.Search,
      contentDescription = null,
      size = 18.dp,
      tint = if (focused) colors.accent else colors.textTertiary
    )
    Box(
      modifier = Modifier.weight(1f),
      contentAlignment = Alignment.CenterStart
    ) {
      if (value.isEmpty()) {
        OneUiText(
          text = placeholder,
          role = OneUiTextRole.RowSubtitle,
          color = colors.textTertiary,
          maxLines = 1
        )
      }
      BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier
          .fillMaxWidth()
          .semantics { contentDescription = placeholder },
        singleLine = true,
        interactionSource = interaction,
        textStyle = OneUiTheme.type.bodySmall.copy(color = colors.textPrimary),
        cursorBrush = SolidColor(colors.accent),
        keyboardOptions = KeyboardOptions(
          keyboardType = KeyboardType.Text,
          imeAction = androidx.compose.ui.text.input.ImeAction.Search
        )
      )
    }
    OneUiIconButton(
      contentDescription = if (value.isNotEmpty()) "清空搜索" else "收起搜索",
      onClick = onClearOrClose,
      size = 40.dp
    ) {
      OneUiIcon(
        imageVector = Icons.Rounded.Close,
        contentDescription = null,
        size = 18.dp,
        tint = colors.textSecondary
      )
    }
  }
}

/** 刷新中才转，停止后立即归零：One UI 不给常驻的无意义动画（动 + 适）。 */
@Composable
private fun oneUiSpinDegrees(active: Boolean, motion: OneUiMotion): Float {
  val animatable = androidx.compose.runtime.remember { Animatable(0f) }
  LaunchedEffect(active, motion.isReduced) {
    if (!active || motion.isReduced) {
      animatable.snapTo(0f)
      return@LaunchedEffect
    }
    while (true) {
      animatable.animateTo(animatable.value + 360f, tween(OneUiDuration.SpinFrame, easing = LinearEasing))
      delay(16)
    }
  }
  return if (active && !motion.isReduced) animatable.value % 360f else 0f
}

