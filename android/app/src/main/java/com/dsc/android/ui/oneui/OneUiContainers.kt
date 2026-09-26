package com.dsc.android.ui.oneui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * One UI 的容器与指示器（构 + 件 + 交）。
 *
 * 页面骨架、分组列表、弹层与空/错/加载态都在这里，页面只负责表达业务结构，
 * 不再自己决定“卡片该多大、组与组之间留多少”（构）。
 */

/**
 * 大标题随列表滚动折叠的比例：由调用方把 LazyListState 传进来。
 *
 * 按比例而不是「能不能往上滚」：滚过 1px 就整段塌缩会让正文跟着跳一下，
 * One UI 的实际表现是标题随滚动距离连续上移淡出，滚满一条大标题的高度后收完（动）。
 */
@Composable
fun rememberOneUiCollapse(listState: LazyListState): Float {
  val motion = OneUiTheme.motion
  val density = LocalDensity.current
  val largeTitleHeight = OneUiTheme.metrics.topBarLargeHeight
  val thresholdPx = remember(density, largeTitleHeight) {
    with(density) { largeTitleHeight.toPx() }.coerceAtLeast(1f)
  }
  val raw = if (listState.firstVisibleItemIndex > 0) {
    1f
  } else {
    (listState.firstVisibleItemScrollOffset / thresholdPx).coerceIn(0f, 1f)
  }
  val progress by animateFloatAsState(
    targetValue = raw,
    animationSpec = motion.tween(OneUiDuration.Press, OneUiEasing.EmphasizedDecelerate),
    label = "oneui_collapse"
  )
  return progress
}

/**
 * 顶部标题栏（构）。
 *
 * One UI 的组织方式：动作按钮永远贴顶，大标题在它们下方生长；
 * 滚动时标题块整体上移并淡出，折叠后由同一行的紧凑标题接手——
 * 所以导航、标题、动作三者始终不会同时占两行高度。
 */
@Composable
fun OneUiTopBar(
  title: String,
  modifier: Modifier = Modifier,
  subtitle: String? = null,
  collapse: Float = 0f,
  navigationIcon: @Composable (() -> Unit)? = null,
  actions: @Composable RowScope.() -> Unit = {},
  large: Boolean = true,
  onCollapsedTitleClick: (() -> Unit)? = null,
  colors: OneUiColors = OneUiTheme.colors,
  metrics: OneUiMetrics = OneUiTheme.metrics
) {
  val effectiveLarge = large && !OneUiTheme.window.useCompactTopBar
  val barHeight = if (effectiveLarge) {
    metrics.topBarLargeHeight * (1f - collapse) + metrics.topBarSmallHeight * collapse
  } else {
    metrics.topBarSmallHeight
  }

  Column(
    modifier = modifier
      .fillMaxWidth()
      // 边到边下由顶栏自己吃掉状态栏高度，并把底色铺到状态栏后面；
      // 底色必须先于 padding，否则挖孔/通知栏区域会露出上一层页面的颜色（适）
      .background(colors.canvas)
      .statusBarsPadding()
      .height(barHeight)
      .padding(horizontal = metrics.screenMargin)
  ) {
    // 贴顶的一行：导航 + 紧凑标题（仅折叠后可见）+ 动作
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .height(metrics.topBarSmallHeight),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
    ) {
      navigationIcon?.invoke()
      if (effectiveLarge) {
        // 折叠后可点紧凑标题回到大标题：One UI 的大标题页都能这样展开（构 + 交）
        val expandClick: (() -> Unit)? = if (collapse > 0.5f) onCollapsedTitleClick else null
        Box(
          modifier = Modifier
            .weight(1f)
            .graphicsLayerAlpha(collapse)
            .then(
              if (expandClick != null) {
                Modifier.oneUiPressable(
                  onClick = expandClick,
                  haptics = OneUiHaptics.Toggle,
                  minHeight = metrics.topBarSmallHeight
                )
              } else {
                Modifier
              }
            ),
          contentAlignment = Alignment.CenterStart
        ) {
          OneUiText(
            text = title,
            role = OneUiTextRole.TopBarCollapsed,
            maxLines = 1,
            overflow = TextOverflow.Clip
          )
        }
      } else {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
          OneUiText(
            text = title,
            role = OneUiTextRole.TopBarCollapsed,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
          if (!subtitle.isNullOrBlank()) {
            OneUiText(
              text = subtitle,
              role = OneUiTextRole.Caption,
              color = colors.textSecondary,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis
            )
          }
        }
      }
      actions()
    }

    if (effectiveLarge) {
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .weight(1f)
          .padding(bottom = metrics.spaceXs)
          .graphicsLayerAlpha((1f - collapse * 1.5f).coerceIn(0f, 1f)),
        verticalArrangement = Arrangement.Bottom
      ) {
        OneUiText(
          text = title,
          role = OneUiTextRole.TopBarLarge,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        if (!subtitle.isNullOrBlank()) {
          OneUiText(
            text = subtitle,
            role = OneUiTextRole.RowSubtitle,
            color = colors.textSecondary,
            maxLines = 2,
            modifier = Modifier.padding(top = 2.dp)
          )
        }
      }
    }
  }
}

private fun Modifier.graphicsLayerAlpha(alpha: Float): Modifier =
  this.then(Modifier.graphicsLayer(alpha = alpha))

/** 底部导航（构）：一级目的地永远在下方拇指区，宽屏换成侧栏。 */
@Immutable
data class OneUiDestination(
  val key: String,
  val label: String,
  val icon: ImageVector,
  val selectedIcon: ImageVector? = null,
  val badge: String? = null
)

@Composable
fun OneUiBottomBar(
  destinations: List<OneUiDestination>,
  selectedKey: String,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier,
  colors: OneUiColors = OneUiTheme.colors
) {
  val metrics = OneUiTheme.metrics
  Row(
    modifier = modifier
      .fillMaxWidth()
      .background(colors.canvas)
      .navigationBarsPadding()
      .heightIn(min = metrics.bottomBarHeight)
      .padding(top = 6.dp, bottom = 6.dp),
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs, Alignment.CenterHorizontally),
    verticalAlignment = Alignment.CenterVertically
  ) {
    destinations.forEach { destination ->
      val selected = destination.key == selectedKey
      OneUiBottomBarItem(
        destination = destination,
        selected = selected,
        onSelect = { onSelect(destination.key) },
        modifier = Modifier.weight(1f, fill = false)
      )
    }
  }
}

@Composable
private fun OneUiBottomBarItem(
  destination: OneUiDestination,
  selected: Boolean,
  onSelect: () -> Unit,
  modifier: Modifier = Modifier
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val motion = OneUiTheme.motion
  val metrics = OneUiTheme.metrics
  val pillAlpha by animateFloatAsState(
    targetValue = if (selected) 1f else 0f,
    animationSpec = motion.tween(OneUiDuration.Content),
    label = "oneui_nav_pill"
  )
  val iconTint = if (selected) colors.accent else colors.textTertiary

  Column(
    modifier = modifier
      .defaultMinSize(minWidth = 76.dp)
      .oneUiPressable(
        onClick = onSelect,
        selected = selected,
        shape = shapes.pill,
        role = androidx.compose.ui.semantics.Role.Tab,
        minHeight = metrics.touchTarget,
        stateLabel = if (selected) "当前页面" else destination.label
      )
      .semantics { if (selected) this.selected = true }
      .padding(horizontal = 14.dp, vertical = 6.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(3.dp)
  ) {
    Box(contentAlignment = Alignment.Center) {
      Box(
        modifier = Modifier
          .size(width = 54.dp, height = 30.dp)
          .background(colors.accent.copy(alpha = metrics.navIndicatorAlpha * pillAlpha), shapes.pill)
      )
      OneUiIcon(
        imageVector = if (selected && destination.selectedIcon != null) destination.selectedIcon else destination.icon,
        contentDescription = destination.label,
        tint = iconTint
      )
    }
    OneUiText(
      text = destination.label,
      role = OneUiTextRole.Caption,
      color = if (selected) colors.accent else colors.textTertiary,
      weight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
      maxLines = 1,
      textAlign = TextAlign.Center
    )
  }
}

/** 宽屏侧栏（构 + 适）：与底部导航同一组目的地，不做两套信息架构。 */
@Composable
fun OneUiNavigationRail(
  destinations: List<OneUiDestination>,
  selectedKey: String,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  Column(
    modifier = modifier
      .width(metrics.navigationRailWidth)
      .fillMaxSize()
      .background(colors.canvas)
      // 侧栏占满整列高度，安全区由它自己消费（边到边）
      .safeDrawingPadding()
      .padding(top = metrics.spaceXl, bottom = metrics.spaceXl),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(metrics.spaceM)
  ) {
    destinations.forEach { destination ->
      val selected = destination.key == selectedKey
      Column(
        modifier = Modifier
          .width(metrics.navigationRailWidth - 20.dp)
          .oneUiPressable(
            onClick = { onSelect(destination.key) },
            selected = selected,
            shape = OneUiTheme.shapes.group,
            role = androidx.compose.ui.semantics.Role.Tab,
            minHeight = null,
            stateLabel = if (selected) "当前页面" else destination.label
          )
          .semantics { if (selected) this.selected = true }
          .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
      ) {
        OneUiIcon(
          imageVector = if (selected && destination.selectedIcon != null) destination.selectedIcon else destination.icon,
          contentDescription = destination.label,
          tint = if (selected) colors.accent else colors.textTertiary
        )
        OneUiText(
          text = destination.label,
          role = OneUiTextRole.Caption,
          color = if (selected) colors.accent else colors.textTertiary,
          weight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
          maxLines = 2,
          textAlign = TextAlign.Center
        )
      }
    }
  }
}

/** 分组：One UI 的层级靠“大留白 + 圆角容器”，不靠阴影（形）。 */
@Composable
fun OneUiGroup(
  modifier: Modifier = Modifier,
  colors: OneUiColors = OneUiTheme.colors,
  shapes: OneUiShapes = OneUiTheme.shapes,
  surface: OneUiSurfaceLevel = OneUiSurfaceLevel.Group,
  content: @Composable ColumnScope.() -> Unit
) {
  val metrics = OneUiTheme.metrics
  Column(
    modifier = modifier
      .fillMaxWidth()
      // 唯一容器实现：额外暗色下靠它补出发丝描边，页面不再自己叠 background
      .oneUiSurface(colors.group, shapes.group, colors = colors, level = surface)
      .padding(vertical = metrics.spaceXs)
  ) { content() }
}

/** 组标题：写在容器上方，而不是容器内部（One UI 设置的分组方式）。 */
@Composable
fun OneUiGroupHeader(
  label: String,
  modifier: Modifier = Modifier,
  action: @Composable (() -> Unit)? = null,
  description: String? = null
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  Column(
    modifier = modifier
      .fillMaxWidth()
      .padding(
        start = metrics.screenMargin + 4.dp,
        end = metrics.screenMargin,
        top = metrics.spaceXs,
        bottom = metrics.spaceXs
      )
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      OneUiText(
        text = label,
        role = OneUiTextRole.SectionHeader,
        color = colors.textPrimary,
        modifier = Modifier.weight(1f)
      )
      action?.invoke()
    }
    if (!description.isNullOrBlank()) {
      OneUiText(
        text = description,
        role = OneUiTextRole.RowSubtitle,
        color = colors.textSecondary,
        modifier = Modifier.padding(top = 2.dp)
      )
    }
  }
}

/** 组内分隔线：从文字起点对齐，One UI 不用通栏线（形）。 */
@Composable
fun OneUiListDivider(
  modifier: Modifier = Modifier,
  indent: Boolean = true,
  colors: OneUiColors = OneUiTheme.colors,
  metrics: OneUiMetrics = OneUiTheme.metrics
) {
  Box(
    modifier = modifier
      .fillMaxWidth()
      .height(metrics.hairline)
      .padding(start = if (indent) metrics.dividerIndent else 0.dp)
      .background(colors.hairline)
  )
}

/**
 * 可折叠面板组（构 + 动）：在同一个页面内就地展开硬件指标详情，
 * 代替频繁呼出 BottomSheet 遮挡视线。
 */
@Composable
fun OneUiExpandableGroup(
  expanded: Boolean,
  onToggle: () -> Unit,
  title: String,
  subtitle: String? = null,
  leading: @Composable (() -> Unit)? = null,
  supporting: @Composable (() -> Unit)? = null,
  actions: @Composable (() -> Unit)? = null,
  colors: OneUiColors = OneUiTheme.colors,
  metrics: OneUiMetrics = OneUiTheme.metrics,
  motion: OneUiMotion = OneUiTheme.motion,
  content: @Composable ColumnScope.() -> Unit
) {
  OneUiGroup(
    modifier = Modifier
      .fillMaxWidth()
      .animateContentSize(
        animationSpec = motion.tween(OneUiDuration.Content, OneUiEasing.EmphasizedDecelerate)
      )
  ) {
    OneUiListItem(
      title = title,
      subtitle = subtitle,
      leading = leading,
      onClick = onToggle,
      supporting = supporting,
      trailing = {
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(metrics.spaceXs)
        ) {
          actions?.invoke()
          OneUiText(
            text = if (expanded) "收起" else "展开",
            role = OneUiTextRole.ChartLabel,
            color = colors.accent,
            weight = FontWeight.SemiBold
          )
        }
      }
    )
    if (expanded) {
      OneUiListDivider(indent = false)
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .padding(horizontal = metrics.groupPadding, vertical = metrics.spaceM),
        verticalArrangement = Arrangement.spacedBy(metrics.spaceM)
      ) {
        content()
      }
    }
  }
}

/**
 * 列表行（件）：One UI 的主力组件。整行可点、命中区不低于 64dp、
 * 支持第二行自由内容与尾部控件，长按唤出操作面板（交）。
 */
@Composable
fun OneUiListItem(
  title: String,
  modifier: Modifier = Modifier,
  subtitle: String? = null,
  overline: String? = null,
  leading: @Composable (() -> Unit)? = null,
  trailing: @Composable (() -> Unit)? = null,
  supporting: @Composable (() -> Unit)? = null,
  onClick: (() -> Unit)? = null,
  onLongClick: (() -> Unit)? = null,
  enabled: Boolean = true,
  selected: Boolean = false,
  role: Role = Role.Button,
  colors: OneUiColors = OneUiTheme.colors,
  metrics: OneUiMetrics = OneUiTheme.metrics,
  contentPadding: PaddingValues = PaddingValues(horizontal = metrics.rowPadding, vertical = 13.dp)
) {
  val shapes = OneUiTheme.shapes
  Row(
    modifier = modifier
      .fillMaxWidth()
      .oneUiPressable(
        onClick = onClick,
        enabled = enabled,
        selected = selected,
        shape = shapes.group,
        onLongClick = onLongClick,
        role = role,
        haptics = if (onLongClick != null) OneUiHaptics.LongPress else OneUiHaptics.Tap,
        minHeight = metrics.rowMinHeight
      )
      .defaultMinSize(minHeight = metrics.rowMinHeight)
      .padding(contentPadding),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(metrics.rowIconGap)
  ) {
    if (leading != null) {
      Box(contentAlignment = Alignment.Center) { leading() }
    }
    Column(
      modifier = Modifier.weight(1f),
      verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
      if (!overline.isNullOrBlank()) {
        OneUiText(text = overline, role = OneUiTextRole.Caption, color = colors.textTertiary)
      }
      OneUiText(
        text = title,
        role = OneUiTextRole.RowTitle,
        color = if (enabled) colors.textPrimary else colors.textDisabled
      )
      if (!subtitle.isNullOrBlank()) {
        OneUiText(
          text = subtitle,
          role = OneUiTextRole.RowSubtitle,
          color = colors.textSecondary
        )
      }
      supporting?.invoke()
    }
    trailing?.invoke()
  }
}

/**
 * 页面唯一可用的图标入口（形）。
 *
 * 尺寸与着色都来自 token：页面不再依赖 Material 的默认 24dp，也不会在同一个顶栏里
 * 把返回键染成 primary、把同级动作染成 secondary。
 */
@Composable
fun OneUiIcon(
  imageVector: ImageVector,
  contentDescription: String?,
  modifier: Modifier = Modifier,
  size: Dp = OneUiTheme.metrics.iconSize,
  tint: Color = OneUiTheme.colors.textSecondary
) {
  Icon(
    imageVector = imageVector,
    contentDescription = contentDescription,
    tint = tint,
    modifier = modifier.size(size)
  )
}

/** 图标起点容器：One UI 用圆形浅色底承载功能图标。 */
@Composable
fun OneUiLeadingIcon(
  icon: ImageVector,
  contentDescription: String? = null,
  tone: OneUiIconTone = OneUiIconTone.Neutral,
  modifier: Modifier = Modifier
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val (container, tint) = when (tone) {
    OneUiIconTone.Neutral -> Pair(colors.sunken, colors.textSecondary)
    OneUiIconTone.Accent -> Pair(colors.accentSoft, colors.accent)
    OneUiIconTone.Online -> Pair(colors.onlineSoft, colors.onlineContent)
    OneUiIconTone.Offline -> Pair(colors.offlineSoft, colors.offlineContent)
    OneUiIconTone.Warning -> Pair(colors.warningSoft, colors.warningContent)
    OneUiIconTone.Critical -> Pair(colors.criticalSoft, colors.criticalContent)
  }
  Box(
    modifier = modifier
      .size(metrics.leadingIconBox)
      .oneUiSurface(container, CircleShape, colors = colors, level = OneUiSurfaceLevel.Group),
    contentAlignment = Alignment.Center
  ) {
    OneUiIcon(
      imageVector = icon,
      contentDescription = contentDescription,
      size = metrics.iconFilledSize,
      tint = tint
    )
  }
}

@Immutable
enum class OneUiIconTone { Neutral, Accent, Online, Offline, Warning, Critical }

/** 状态点：始终与文字一起出现，颜色不作为唯一载体（适）。 */
@Composable
fun OneUiStatusDot(
  color: Color,
  modifier: Modifier = Modifier,
  description: String? = null,
  hollow: Boolean = false
) {
  val label = description
  Box(
    modifier = modifier
      .size(9.dp)
      .then(
        if (hollow) {
          Modifier.border(1.6.dp, color, CircleShape)
        } else {
          Modifier.background(color, CircleShape)
        }
      )
      .then(if (label == null) Modifier else Modifier.semantics { contentDescription = label })
  )
}

/** 轻量标签（原 StatChip 的替代品）：One UI 的浅底胶囊。 */
@Composable
fun OneUiPill(
  label: String,
  value: String? = null,
  modifier: Modifier = Modifier,
  tone: OneUiPillTone = OneUiPillTone.Neutral,
  onClick: (() -> Unit)? = null,
  enabled: Boolean = true
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  val (container, content) = when (tone) {
    OneUiPillTone.Neutral -> Pair(colors.sunken, colors.textSecondary)
    OneUiPillTone.Accent -> Pair(colors.accentSoft, colors.accentSoftContent)
    OneUiPillTone.Online -> Pair(colors.onlineSoft, colors.onlineContent)
    OneUiPillTone.Offline -> Pair(colors.offlineSoft, colors.offlineContent)
    OneUiPillTone.Warning -> Pair(colors.warningSoft, colors.warningContent)
    OneUiPillTone.Critical -> Pair(colors.criticalSoft, colors.criticalContent)
  }
  Row(
    modifier = modifier
      // 只有真的可点的胶囊才需要 48dp 命中区；纯读数的胶囊保持视觉高度（适）
      .defaultMinSize(minHeight = if (onClick != null) metrics.touchTarget else metrics.pillHeight)
      .oneUiSurface(container, shapes.pill, colors = colors, level = OneUiSurfaceLevel.Group)
      .oneUiPressable(
        onClick = onClick,
        enabled = enabled && onClick != null,
        shape = shapes.pill,
        haptics = OneUiHaptics.Tap,
        minHeight = null
      )
      .padding(horizontal = 11.dp, vertical = 5.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(5.dp)
  ) {
    OneUiText(
      text = label,
      role = OneUiTextRole.ChartLabel,
      color = content,
      weight = FontWeight.Medium,
      maxLines = 1
    )
    if (!value.isNullOrBlank()) {
      OneUiText(
        text = value,
        role = OneUiTextRole.ChartLabel,
        color = if (tone == OneUiPillTone.Neutral) colors.textPrimary else content,
        weight = FontWeight.Bold,
        maxLines = 1
      )
    }
  }
}

@Immutable
enum class OneUiPillTone { Neutral, Accent, Online, Offline, Warning, Critical }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OneUiPillRow(
  pills: List<OneUiPillModel>,
  modifier: Modifier = Modifier,
  spacing: Dp = 8.dp
) {
  FlowRow(
    modifier = modifier.fillMaxWidth(),
    horizontalArrangement = Arrangement.spacedBy(spacing),
    verticalArrangement = Arrangement.spacedBy(spacing)
  ) {
    pills.forEach { pill ->
      OneUiPill(
        label = pill.label,
        value = pill.value,
        tone = pill.tone,
        onClick = pill.onClick
      )
    }
  }
}

@Immutable
data class OneUiPillModel(
  val label: String,
  val value: String? = null,
  val tone: OneUiPillTone = OneUiPillTone.Neutral,
  val onClick: (() -> Unit)? = null
)

/** 通知条：缓存状态、更新提示、模式说明共用一种组件（件）。 */
@Composable
fun OneUiNotice(
  title: String,
  description: String? = null,
  tone: OneUiNoticeTone = OneUiNoticeTone.Info,
  modifier: Modifier = Modifier,
  icon: ImageVector? = null,
  action: @Composable (() -> Unit)? = null
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  val (container, content, accentColor) = when (tone) {
    OneUiNoticeTone.Info -> Triple(colors.accentSoft, colors.accentSoftContent, colors.accent)
    OneUiNoticeTone.Online -> Triple(colors.onlineSoft, colors.onlineContent, colors.online)
    OneUiNoticeTone.Warning -> Triple(colors.warningSoft, colors.warningContent, colors.warning)
    OneUiNoticeTone.Critical -> Triple(colors.criticalSoft, colors.criticalContent, colors.critical)
    OneUiNoticeTone.Neutral -> Triple(colors.sunken, colors.textSecondary, colors.textTertiary)
  }

  Row(
    modifier = modifier
      .fillMaxWidth()
      .oneUiSurface(container, shapes.card, colors = colors, level = OneUiSurfaceLevel.Group)
      .padding(horizontal = metrics.spaceM, vertical = 14.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceS)
  ) {
    if (icon != null) {
      OneUiIcon(
        imageVector = icon,
        contentDescription = null,
        tint = accentColor,
        size = metrics.iconFilledSize
      )
    }
    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
      OneUiText(text = title, role = OneUiTextRole.Subtitle, color = content)
      if (!description.isNullOrBlank()) {
        OneUiText(text = description, role = OneUiTextRole.RowSubtitle, color = content)
      }
    }
    action?.invoke()
  }
}

@Immutable
enum class OneUiNoticeTone { Info, Neutral, Online, Warning, Critical }

/** 环形进度指示（One UI 的加载环是锥形收尾，这里用不等长弧线近似）。 */
@Composable
fun OneUiSpinner(
  modifier: Modifier = Modifier,
  size: Dp = 26.dp,
  color: Color = OneUiTheme.colors.accent,
  strokeWidth: Dp = 2.6.dp,
  spinning: Boolean = true
) {
  val motion = OneUiTheme.motion
  val animate = spinning && !motion.isReduced
  val transition = rememberInfiniteTransition(label = "oneui_spinner")
  val sweep by transition.animateFloat(
    initialValue = 0f,
    targetValue = if (animate) 360f else 0f,
    animationSpec = infiniteRepeatable(
      animation = tween(if (animate) OneUiDuration.SpinnerCycle else 1, easing = LinearEasing),
      repeatMode = RepeatMode.Restart
    ),
    label = "oneui_spinner_sweep"
  )
  Canvas(modifier = modifier.size(size)) {
    val stroke = strokeWidth.toPx()
    val inset = stroke / 2f
    drawArc(
      color = color.copy(alpha = 0.22f),
      startAngle = 0f,
      sweepAngle = 360f,
      useCenter = false,
      style = Stroke(width = stroke, cap = StrokeCap.Round),
      topLeft = androidx.compose.ui.geometry.Offset(inset, inset),
      size = androidx.compose.ui.geometry.Size(this.size.width - stroke, this.size.height - stroke)
    )
    drawArc(
      color = color,
      startAngle = if (motion.isReduced) 250f else sweep,
      sweepAngle = if (motion.isReduced) 120f else 96f,
      useCenter = false,
      style = Stroke(width = stroke, cap = StrokeCap.Round),
      topLeft = androidx.compose.ui.geometry.Offset(inset, inset),
      size = androidx.compose.ui.geometry.Size(this.size.width - stroke, this.size.height - stroke)
    )
  }
}

/** 线性进度：圆头、轨道浅色、已完成用强调色（交：下载/同步可见进度）。 */
@Composable
fun OneUiLinearProgress(
  fraction: Float,
  modifier: Modifier = Modifier,
  color: Color = OneUiTheme.colors.accent,
  track: Color = OneUiTheme.colors.sunken,
  indeterminate: Boolean = false,
  height: Dp = 6.dp
) {
  val motion = OneUiTheme.motion
  val transition = rememberInfiniteTransition(label = "oneui_progress")
  val slide by transition.animateFloat(
    initialValue = 0f,
    targetValue = if (indeterminate && !motion.isReduced) 1f else 0f,
    animationSpec = infiniteRepeatable(
      tween(OneUiDuration.ProgressSlide, easing = LinearEasing),
      repeatMode = RepeatMode.Restart
    ),
    label = "oneui_progress_slide"
  )
  // 数值变化统一走 oneUiAnimatedValue（动），页面与组件不再各写一份补间
  val animated = oneUiAnimatedValue(fraction.coerceIn(0f, 1f), motion)
  val effective = if (indeterminate) 0.28f else animated
  Box(
    modifier = modifier
      .fillMaxWidth()
      .height(height)
      .background(track, RoundedCornerShape(999.dp))
  ) {
    Box(
      modifier = Modifier
        .fillMaxWidth(effective)
        // 相对位移而不是绝对 dp：写死 340dp 在平板上会把指示段推出轨道。
        // 指示段宽 effective×轨道宽，走完轨道对应的位移就是 size.width * (1/effective - 1)
        .let {
          if (indeterminate) {
            val travel = 1f / effective - 1f
            it.graphicsLayer { translationX = size.width * travel * slide }
          } else {
            it
          }
        }
        .height(height)
        .background(color, RoundedCornerShape(999.dp))
    )
  }
}

/** 行内加载：替代旧的一次性卡片。 */
@Composable
fun OneUiLoadingRow(
  label: String,
  modifier: Modifier = Modifier,
  colors: OneUiColors = OneUiTheme.colors
) {
  val metrics = OneUiTheme.metrics
  Row(
    modifier = modifier
      .fillMaxWidth()
      .oneUiSurface(colors.sunken, OneUiTheme.shapes.card, colors = colors, level = OneUiSurfaceLevel.Group)
      .padding(horizontal = metrics.spaceM, vertical = 14.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(metrics.spaceS)
  ) {
    OneUiSpinner(size = 20.dp, strokeWidth = 2.2.dp, color = colors.accent)
    OneUiText(text = label, role = OneUiTextRole.RowSubtitle, color = colors.textSecondary)
  }
}

/** 骨架屏：形状先行，避免加载时布局跳动（动 + 交）。 */
@Composable
fun OneUiSkeleton(
  modifier: Modifier = Modifier,
  height: Dp = 64.dp,
  shape: Shape = OneUiTheme.shapes.card
) {
  val colors = OneUiTheme.colors
  val motion = OneUiTheme.motion
  val transition = rememberInfiniteTransition(label = "oneui_skeleton")
  val pulse by transition.animateFloat(
    initialValue = 0.5f,
    targetValue = if (motion.isReduced) 0.75f else 1f,
    animationSpec = infiniteRepeatable(
      animation = tween(OneUiDuration.Skeleton, easing = LinearEasing),
      repeatMode = RepeatMode.Reverse
    ),
    label = "oneui_skeleton_pulse"
  )
  Box(
    modifier = modifier
      .fillMaxWidth()
      .height(height)
      .background(colors.sunken.copy(alpha = pulse), shape)
  )
}

/** 空态：One UI 把说明写清楚并给出下一步动作，而不是只留一行小字。 */
@Composable
fun OneUiEmptyState(
  title: String,
  description: String? = null,
  modifier: Modifier = Modifier,
  icon: ImageVector? = null,
  actionLabel: String? = null,
  onAction: (() -> Unit)? = null
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  Column(
    modifier = modifier
      .fillMaxWidth()
      .padding(horizontal = metrics.spaceXl, vertical = metrics.spaceXxl),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(metrics.spaceS)
  ) {
    if (icon != null) {
      OneUiIcon(
        imageVector = icon,
        contentDescription = null,
        tint = colors.textTertiary,
        size = metrics.iconSize * 1.4f
      )
    }
    OneUiText(
      text = title,
      role = OneUiTextRole.Title,
      color = colors.textPrimary,
      textAlign = TextAlign.Center,
      modifier = Modifier.fillMaxWidth()
    )
    if (!description.isNullOrBlank()) {
      OneUiText(
        text = description,
        role = OneUiTextRole.BodySecondary,
        color = colors.textSecondary,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth()
      )
    }
    if (actionLabel != null && onAction != null) {
      OneUiButton(
        label = actionLabel,
        onClick = onAction,
        variant = OneUiButtonVariant.Tonal,
        size = OneUiButtonSize.Compact,
        modifier = Modifier.padding(top = metrics.spaceXs)
      )
    }
  }
}

/** 错误态：错误必须带可执行出口（交）。 */
@Composable
fun OneUiErrorState(
  title: String,
  description: String? = null,
  onRetry: (() -> Unit)?,
  modifier: Modifier = Modifier,
  retryLabel: String = "重试"
) {
  OneUiNotice(
    title = title,
    description = description,
    tone = OneUiNoticeTone.Critical,
    modifier = modifier,
    icon = Icons.Rounded.Refresh,
    action = onRetry?.let { callback ->
      @Composable {
        OneUiButton(
          label = retryLabel,
          onClick = callback,
          variant = OneUiButtonVariant.Tonal,
          size = OneUiButtonSize.Compact
        )
      }
    }
  )
}

/**
 * 对话框（件 + 交）：One UI 的对话框是大圆角、标题左对齐、
 * 右下两个胶囊按钮；这里不使用 M3 AlertDialog，以保证几何与状态一致。
 */
@Composable
fun OneUiDialog(
  onDismissRequest: () -> Unit,
  title: String,
  modifier: Modifier = Modifier,
  description: String? = null,
  confirmLabel: String? = null,
  onConfirm: (() -> Unit)? = null,
  dismissLabel: String = "取消",
  onDismiss: (() -> Unit)? = null,
  destructive: Boolean = false,
  loading: Boolean = false,
  content: @Composable ColumnScope.() -> Unit = {}
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  Dialog(onDismissRequest = onDismissRequest, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Column(
      modifier = modifier
        .widthIn(max = metrics.dialogMaxWidth)
        .padding(horizontal = metrics.spaceXxl)
        .oneUiSurface(colors.raised, shapes.dialog, colors = colors, level = OneUiSurfaceLevel.Floating)
        .padding(top = metrics.spaceXl, bottom = metrics.spaceM, start = metrics.spaceXl, end = metrics.spaceXl),
      verticalArrangement = Arrangement.spacedBy(metrics.spaceS)
    ) {
      OneUiText(text = title, role = OneUiTextRole.Headline)
      if (!description.isNullOrBlank()) {
        OneUiText(
          text = description,
          role = OneUiTextRole.BodySecondary,
          color = colors.textSecondary
        )
      }
      content()
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(top = metrics.spaceM),
        horizontalArrangement = Arrangement.spacedBy(metrics.spaceS, Alignment.End),
        verticalAlignment = Alignment.CenterVertically
      ) {
        if (onDismiss != null) {
          OneUiButton(
            label = dismissLabel,
            onClick = onDismiss,
            variant = OneUiButtonVariant.Text,
            size = OneUiButtonSize.Compact
          )
        }
        if (confirmLabel != null && onConfirm != null) {
          OneUiButton(
            label = confirmLabel,
            onClick = onConfirm,
            variant = if (destructive) OneUiButtonVariant.Outlined else OneUiButtonVariant.Filled,
            size = OneUiButtonSize.Compact,
            destructive = destructive,
            loading = loading
          )
        }
      }
    }
  }
}

/** 底部面板：One UI 的快捷操作与次级详情都用它（件）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OneUiSheet(
  onDismissRequest: () -> Unit,
  title: String,
  modifier: Modifier = Modifier,
  subtitle: String? = null,
  headerAction: @Composable (() -> Unit)? = null,
  confirmBar: @Composable (() -> Unit)? = null,
  content: @Composable ColumnScope.() -> Unit
) {
  val colors = OneUiTheme.colors
  val shapes = OneUiTheme.shapes
  val metrics = OneUiTheme.metrics
  // 半屏面板：停在半展开态才能同时看到下面的正文，需要时用户自己上拉（构）。
  // 面板状态在本层内部创建，页面因此不需要再授权 Material 的实验性 API。
  val sheetState = rememberModalBottomSheetState()

  ModalBottomSheet(
    onDismissRequest = onDismissRequest,
    modifier = modifier,
    sheetState = sheetState,
    shape = shapes.sheet,
    containerColor = colors.group,
    contentColor = colors.textPrimary,
    tonalElevation = 0.dp,
    scrimColor = colors.scrim,
    dragHandle = {
      Box(
        modifier = Modifier
          .padding(top = 10.dp, bottom = 6.dp)
          .width(38.dp)
          .height(4.dp)
          .background(colors.outline.copy(alpha = 0.6f), RoundedCornerShape(999.dp))
      )
    }
  ) {
    Column(
      modifier = Modifier.padding(
        bottom = if (confirmBar == null) metrics.spaceXxl else 0.dp
      )
    ) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(horizontal = metrics.screenMargin),
        verticalAlignment = Alignment.CenterVertically
      ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          OneUiText(text = title, role = OneUiTextRole.Headline)
          if (!subtitle.isNullOrBlank()) {
            OneUiText(text = subtitle, role = OneUiTextRole.RowSubtitle, color = colors.textSecondary)
          }
        }
        headerAction?.invoke()
      }
      // 面板内容自身可滚动：长列表不会把确认按钮顶出屏幕（适）
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .weight(1f, fill = false)
          .verticalScroll(rememberScrollState())
          .oneUiContentWidth(metrics)
          .padding(horizontal = metrics.screenMargin, vertical = metrics.spaceM),
        verticalArrangement = Arrangement.spacedBy(metrics.spaceM)
      ) { content() }

      // 确认条留在滚动区之外：列表一长，「保存」不该被顶到折叠线以外（交 + 适）
      confirmBar?.let { bar ->
        Column(
          modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = metrics.screenMargin, vertical = metrics.spaceS),
          verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)
        ) { bar() }
      }
    }
  }
}

/** 长按/更多唤出的操作面板（交）：One UI 用列表项而不是菜单。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OneUiActionSheet(
  onDismissRequest: () -> Unit,
  title: String,
  actions: List<OneUiActionModel>
) {
  OneUiSheet(
    onDismissRequest = onDismissRequest,
    title = title
  ) {
    actions.forEachIndexed { index, action ->
      if (index > 0) {
        OneUiListDivider()
      }
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .oneUiPressable(
            onClick = action.onClick,
            enabled = action.enabled,
            shape = OneUiTheme.shapes.group,
            minHeight = null
          )
          .defaultMinSize(minHeight = OneUiTheme.metrics.rowMinHeight)
          .padding(horizontal = 4.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)
      ) {
        if (action.icon != null) {
          OneUiLeadingIcon(
            icon = action.icon,
            contentDescription = null,
            tone = when {
              action.destructive -> OneUiIconTone.Critical
              else -> OneUiIconTone.Neutral
            }
          )
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          OneUiText(
            text = action.label,
            role = OneUiTextRole.RowTitle,
            color = if (action.destructive) OneUiTheme.colors.criticalContent else OneUiTheme.colors.textPrimary
          )
          if (!action.description.isNullOrBlank()) {
            OneUiText(
              text = action.description,
              role = OneUiTextRole.RowSubtitle,
              color = OneUiTheme.colors.textSecondary
            )
          }
        }
      }
    }
  }
}

@Immutable
data class OneUiActionModel(
  val label: String,
  val onClick: () -> Unit,
  val description: String? = null,
  val icon: ImageVector? = null,
  val destructive: Boolean = false,
  val enabled: Boolean = true
)

/** 屏幕阅读器播报区：刷新结果、错误恢复等状态变化要能被朗读（适）。 */
@Composable
fun OneUiAnnouncer(message: String?, modifier: Modifier = Modifier) {
  if (message.isNullOrBlank()) return
  Box(
    modifier = modifier
      .size(1.dp)
      .semantics {
        liveRegion = LiveRegionMode.Polite
        contentDescription = message
      }
  )
}

/** 展开/收起容器：One UI 的“更多信息”用纵向展开而不是新页面。 */
@Composable
fun OneUiExpandable(
  expanded: Boolean,
  modifier: Modifier = Modifier,
  content: @Composable ColumnScope.() -> Unit
) {
  val motion = OneUiTheme.motion
  AnimatedVisibility(
    visible = expanded,
    modifier = modifier,
    // 时长与曲线仍由 OneUiMotion 决定，不用动画库的默认值（动）
    enter = expandVertically(
      animationSpec = motion.tween<IntSize>(OneUiDuration.Content, OneUiEasing.EmphasizedDecelerate)
    ) + fadeIn(animationSpec = motion.tween(OneUiDuration.Content)),
    exit = shrinkVertically(
      animationSpec = motion.tween<IntSize>(OneUiDuration.Exit, OneUiEasing.EmphasizedAccelerate)
    ) + fadeOut(animationSpec = motion.tween(OneUiDuration.Exit))
  ) {
    Column(modifier = Modifier.fillMaxWidth()) { content() }
  }
}

/** 顶部安全区由 [OneUiTopBar]、[OneUiNavigationRail] 与各级工具坞自己消费，这里只留列表底部留白的统一值。 */
@Composable
fun oneUiNavigationBarPadding(): PaddingValues =
  WindowInsets.navigationBars.asPaddingValues()

/** 供 LazyColumn 底部留白的统一值：内容不铺到屏幕最下沿（构）。 */
@Composable
fun oneUiListContentPadding(): PaddingValues {
  val metrics = OneUiTheme.metrics
  val bottom = oneUiNavigationBarPadding()
  return PaddingValues(
    start = metrics.screenMargin,
    end = metrics.screenMargin,
    top = metrics.spaceXs,
    bottom = metrics.spaceXxl + bottom.calculateBottomPadding() + metrics.thumbZone
  )
}

/** 让组件在禁用时统一降透明度的工具。 */
@Composable
fun oneUiEnabledAlpha(enabled: Boolean): Float = if (enabled) 1f else OneUiTheme.metrics.disabledContent

@Composable
fun oneUiDensityPx(value: Dp): Float = with(LocalDensity.current) { value.toPx() }
