package com.dsc.android.ui.oneui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * One UI 的 Shape / Surface / Elevation / Spacing（形）。
 *
 * One UI 的分层逻辑不是 Material 的“越高越投影”，而是
 * “色层递进 + 26dp 同心大圆角 + 极轻投影”，在额外暗色下投影完全取消、只留分隔线。
 */
@Immutable
data class OneUiShapes(
  /** 角标、状态点容器 */
  val badge: RoundedCornerShape = RoundedCornerShape(8.dp),
  /** 图表底、内嵌池化微卡（与 26dp 外卡呈柔和同心圆角） */
  val tile: RoundedCornerShape = RoundedCornerShape(16.dp),
  /** 输入框、小开关 */
  val control: RoundedCornerShape = RoundedCornerShape(16.dp),
  /** 指标卡 */
  val card: RoundedCornerShape = RoundedCornerShape(22.dp),
  /** 分组容器（One UI 6/7/8 标志性 26dp 大圆角） */
  val group: RoundedCornerShape = RoundedCornerShape(26.dp),
  /** 底部工具坞/确认条：只圆上沿两角，下沿贴屏幕边 */
  val dock: Shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp, bottomStart = 0.dp, bottomEnd = 0.dp),
  val dialog: RoundedCornerShape = RoundedCornerShape(28.dp),
  val sheet: RoundedCornerShape = RoundedCornerShape(topStart = 32.dp, topEnd = 32.dp),
  /** 按钮 / 芯片 / 悬浮底栏：One UI 一律是两端全圆的胶囊 */
  val pill: Shape = RoundedCornerShape(999.dp),
  val circle: Shape = CircleShape
)

/** 表面层级，从页面底到模态。 */
enum class OneUiSurfaceLevel {
  Canvas,
  Group,
  Raised,
  Floating,
  Sheet
}

@Immutable
data class OneUiElevationSpec(
  val shadow: Dp,
  val hairline: Boolean,
  /** 该层叠加在 surface 上的亮度增量（正数变亮）。 */
  val tonalLift: Float
)

/**
 * 间距与布局度量（形）。`fun` 而非 `val`，因为宽屏/大字号下取值不同（适）。
 */
@Immutable
data class OneUiMetrics(
  val spaceXxs: Dp = 4.dp,
  val spaceXs: Dp = 8.dp,
  val spaceS: Dp = 12.dp,
  val spaceM: Dp = 16.dp,
  val spaceL: Dp = 20.dp,
  val spaceXl: Dp = 24.dp,
  val spaceXxl: Dp = 32.dp,
  val spaceXxxl: Dp = 48.dp,
  /** 页面左右留白：One UI 比 Material 明显更宽 */
  val screenMargin: Dp = 20.dp,
  /** 组与组之间：One UI 用大留白而不是分割线区分组 */
  val groupGap: Dp = 20.dp,
  val groupPadding: Dp = 20.dp,
  val cardGap: Dp = 12.dp,
  val rowMinHeight: Dp = 64.dp,
  val rowPadding: Dp = 20.dp,
  val rowIconGap: Dp = 16.dp,
  val hairline: Dp = 0.8.dp,
  val dividerIndent: Dp = 20.dp,
  val iconSize: Dp = 24.dp,
  val iconFilledSize: Dp = 20.dp,
  val leadingIconBox: Dp = 40.dp,
  val touchTarget: Dp = 48.dp,
  val iconButton: Dp = 48.dp,
  /** 非交互状态徽标视觉高度 */
  val pillHeight: Dp = 28.dp,
  /** 可交互筛选/分组胶囊视觉高度（外层保留 48dp 触控热区，视觉轻盈且手指好按） */
  val chipHeight: Dp = 38.dp,
  /** 分段选择器内格子高度：含外轨 3dp 内边距总高 46dp，与 38dp 胶囊和 52dp 主按钮比例协调 */
  val segmentHeight: Dp = 40.dp,
  /** 紧凑行内分段器高度（如总览时间窗 5分/1小时/24小时）：总高 38dp */
  val compactSegmentHeight: Dp = 34.dp,
  val topBarSmallHeight: Dp = 56.dp,
  val topBarLargeHeight: Dp = 136.dp,
  val bottomBarHeight: Dp = 64.dp,
  val dockHeight: Dp = 64.dp,
  val navigationRailWidth: Dp = 88.dp,
  val navigationRailWidthWithLabel: Dp = 108.dp,
  /** 双栏内嵌态下的单栏左右留白，保证顶栏、组标题与卡片列表严丝合缝左对齐 */
  val paneMargin: Dp = 16.dp,
  val paneGroupGap: Dp = 16.dp,
  /** 展开态限制正文行宽，避免 4K/平板上一行文字拉到边 */
  val contentMaxWidth: Dp = Dp.Unspecified,
  /** 对话框与底部面板在中/展开窗口里保持受控宽度，不跟着屏幕无限变宽 */
  val dialogMaxWidth: Dp = 520.dp,
  val sheetMaxWidth: Dp = 560.dp,
  /** One UI 的核心：底部保留拇指区，正文不铺到屏幕最下沿 */
  val thumbZone: Dp = 24.dp,
  val focusStroke: Dp = 3.dp,
  val pressedScale: Float = 0.962f,
  val hoverOverlay: Float = 0.05f,
  val pressedOverlay: Float = 0.11f,
  val selectedOverlay: Float = 0.08f,
  val disabledContent: Float = 0.38f,
  /** 陈旧数据（可见加载期间屏上的旧快照）的存在感：仍要可读，但一眼看出不是当前数据 */
  val staleContent: Float = 0.62f,
  /** 底部导航/侧栏选中态那枚浅色胶囊的透明度 */
  val navIndicatorAlpha: Float = 0.18f,
  /** 日历格高度：非月视图要放下「标签 + 总量」两行 */
  val calendarCellHeight: Dp = 56.dp,
  /** 指标网格在窄屏/大字号下退化为单列的阈值（适） */
  val metricMinCellWidth: Dp = 176.dp,
  val chartHeight: Dp = 148.dp,
  val chartMinHeight: Dp = 104.dp
)

private val OneUiElevations: Map<OneUiSurfaceLevel, OneUiElevationSpec> = mapOf(
  OneUiSurfaceLevel.Canvas to OneUiElevationSpec(shadow = 0.dp, hairline = false, tonalLift = 0f),
  OneUiSurfaceLevel.Group to OneUiElevationSpec(shadow = 0.dp, hairline = false, tonalLift = 0f),
  OneUiSurfaceLevel.Raised to OneUiElevationSpec(shadow = 2.dp, hairline = false, tonalLift = 0.012f),
  OneUiSurfaceLevel.Floating to OneUiElevationSpec(shadow = 10.dp, hairline = false, tonalLift = 0.025f),
  OneUiSurfaceLevel.Sheet to OneUiElevationSpec(shadow = 16.dp, hairline = false, tonalLift = 0.03f)
)

fun oneUiElevation(level: OneUiSurfaceLevel, colors: OneUiColors): OneUiElevationSpec {
  val base = OneUiElevations[level] ?: OneUiElevations.getValue(OneUiSurfaceLevel.Group)
  // 额外暗色：投影取消，改用发丝描边分层（One UI Extra dark 的实际表现）
  return if (colors.isExtraDark) base.copy(shadow = 0.dp, hairline = level != OneUiSurfaceLevel.Canvas) else base
}

/** One UI 表面的统一实现：色层 + 可选投影 + 可选发丝边。所有容器都走这里。 */
fun Modifier.oneUiSurface(
  color: Color,
  shape: Shape,
  colors: OneUiColors,
  level: OneUiSurfaceLevel = OneUiSurfaceLevel.Group,
  hairlineWidth: Dp = 0.8.dp,
  border: Boolean = oneUiElevation(level, colors).hairline
): Modifier {
  val spec = oneUiElevation(level, colors)
  return this
    .then(
      if (spec.shadow > 0.dp && !colors.isDark) {
        Modifier.shadow(spec.shadow, shape, clip = false, ambientColor = colors.ink, spotColor = colors.ink)
      } else if (spec.shadow > 0.dp) {
        // 深色下投影不可见，用抬升的 surface 色表达层级
        Modifier.shadow(spec.shadow, shape, clip = false, ambientColor = Color.Black, spotColor = Color.Black)
      } else {
        Modifier
      }
    )
    .background(if (spec.tonalLift > 0f) color.lift(spec.tonalLift, Color.White) else color, shape)
    .then(if (border) Modifier.border(hairlineWidth, colors.hairline, shape) else Modifier)
    .clip(shape)
}

/**
 * 横向滚动条边缘柔和淡出（形 + 交）：
 * 当内容超出视口可左右滑动时，在可滚方向末端呈现渐隐遮罩，提示还有更多选项，
 * 避免胶囊与文字在屏幕边缘被一刀生硬截断。
 */
fun Modifier.oneUiHorizontalFadingEdge(
  scrollState: ScrollState,
  edgeWidth: Dp = 18.dp
): Modifier = this
  .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
  .drawWithContent {
    drawContent()
    val fadePx = edgeWidth.toPx().coerceAtMost(size.width * 0.25f)
    if (fadePx <= 1f) return@drawWithContent
    if (scrollState.canScrollBackward) {
      drawRect(
        brush = Brush.horizontalGradient(
          colors = listOf(Color.Transparent, Color.Black),
          startX = 0f,
          endX = fadePx
        ),
        topLeft = Offset.Zero,
        size = Size(fadePx, size.height),
        blendMode = BlendMode.DstIn
      )
    }
    if (scrollState.canScrollForward) {
      drawRect(
        brush = Brush.horizontalGradient(
          colors = listOf(Color.Black, Color.Transparent),
          startX = size.width - fadePx,
          endX = size.width
        ),
        topLeft = Offset(size.width - fadePx, 0f),
        size = Size(fadePx, size.height),
        blendMode = BlendMode.DstIn
      )
    }
  }

/** 向目标色做微量混合，替代 Material 的 tonal blend（One UI 的层级更克制）。 */
internal fun Color.lift(amount: Float, target: Color = Color.White): Color {
  fun mix(from: Float, to: Float): Float = from + (to - from) * amount.coerceIn(0f, 1f)
  return Color(
    red = mix(red, target.red),
    green = mix(green, target.green),
    blue = mix(blue, target.blue),
    alpha = alpha
  )
}

/** 按窗口尺寸类别与字号缩放给出不同的度量（适）。 */
fun oneUiMetrics(window: OneUiWindowLayout, fontScale: Float): OneUiMetrics {
  val base = when (window.widthClass) {
    OneUiWidthClass.Compact -> OneUiMetrics(
      contentMaxWidth = Dp.Unspecified,
      thumbZone = 20.dp
    )

    OneUiWidthClass.Medium -> OneUiMetrics(
      screenMargin = 24.dp,
      groupGap = 20.dp,
      navigationRailWidth = 80.dp,
      contentMaxWidth = 760.dp,
      thumbZone = 20.dp,
      cardGap = 12.dp
    )

    OneUiWidthClass.Expanded -> OneUiMetrics(
      screenMargin = 32.dp,
      groupGap = 24.dp,
      navigationRailWidth = 88.dp,
      contentMaxWidth = 1040.dp,
      thumbZone = 24.dp,
      cardGap = 16.dp,
      topBarLargeHeight = 144.dp
    )
  }
  // 适：字号放大后行高与留白同步放宽，避免文字被固定高度裁掉
  val bump = when {
    fontScale >= 1.9f -> 1.45f
    fontScale >= 1.6f -> 1.28f
    fontScale >= 1.3f -> 1.16f
    else -> 1f
  }
  return if (bump == 1f) base else base.copy(
    rowMinHeight = base.rowMinHeight * bump,
    topBarLargeHeight = base.topBarLargeHeight * bump,
    metricMinCellWidth = base.metricMinCellWidth * bump,
    chartHeight = base.chartHeight * bump
  )
}
