package com.dsc.android.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import kotlin.math.max
import kotlin.math.min

/**
 * 桌面组件的图表只有几十到几百像素宽，用 Compose 画布反而带不起；
 * 这里全部在 Bitmap 上自绘，RemoteViews 只负责把结果贴到 ImageView。
 * 所有尺寸都以传入的像素为准，避免不同 launcher 的密度把描边画成一条糊线。
 */
internal object WidgetCanvas {
  fun gauge(
    sizePx: Int,
    percent: Float,
    color: Int,
    trackColor: Int,
    dashed: Boolean = false
  ): Bitmap {
    val size = sizePx.coerceAtLeast(8)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val stroke = size * .085f
    val inset = stroke / 2f + size * .025f
    val rect = RectF(inset, inset, size - inset, size - inset)

    val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = stroke
      strokeCap = Paint.Cap.ROUND
      this.color = trackColor
    }
    val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = stroke
      strokeCap = Paint.Cap.ROUND
      this.color = color
      if (dashed) pathEffect = DashPathEffect(floatArrayOf(size * .052f, size * .045f), 0f)
    }
    canvas.drawArc(rect, START_ANGLE, SWEEP_ANGLE, false, track)
    val sweep = SWEEP_ANGLE * (percent.coerceIn(0f, 100f) / 100f)
    if (sweep > 0f) canvas.drawArc(rect, START_ANGLE, sweep, false, arc)

    if (!dashed && sweep > 0f) {
      val radians = Math.toRadians((START_ANGLE + sweep).toDouble())
      val radius = rect.width() / 2f
      val cx = rect.centerX() + kotlin.math.cos(radians).toFloat() * radius
      val cy = rect.centerY() + kotlin.math.sin(radians).toFloat() * radius
      canvas.drawCircle(cx, cy, stroke * .34f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        this.color = color
      })
    }
    return bitmap
  }

  fun sparkline(
    widthPx: Int,
    heightPx: Int,
    values: List<Float>,
    lineColor: Int,
    fillColor: Int
  ): Bitmap? {
    if (values.size < 2 || widthPx < 2 || heightPx < 2) return null
    val width = widthPx
    val height = heightPx
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val padTop = height * .08f
    val padBottom = height * .12f
    val usable = height - padTop - padBottom
    val minValue = values.minOrNull() ?: 0f
    val maxValue = values.maxOrNull() ?: 100f
    val margin = max(3f, (maxValue - minValue) * .16f)
    val floor = (minValue - margin).coerceAtLeast(0f)
    val ceiling = (maxValue + margin).coerceAtMost(100f)
    val span = max(1f, ceiling - floor)
    val path = Path()
    val steps = values.size - 1
    values.forEachIndexed { index, value ->
      val x = width * index.toFloat() / steps
      val y = padTop + usable - ((value - floor) / span).coerceIn(0f, 1f) * usable
      if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }

    val area = Path(path).apply {
      lineTo(width.toFloat(), height.toFloat())
      lineTo(0f, height.toFloat())
      close()
    }
    canvas.drawPath(area, Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.FILL
      shader = LinearGradient(
        0f, 0f, 0f, height.toFloat(),
        fillColor,
        fillColor and 0x00FFFFFF,
        Shader.TileMode.CLAMP
      )
    })
    canvas.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = max(1.6f, height * .036f)
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
      color = lineColor
    })
    val lastX = width.toFloat()
    val lastY = padTop + usable - ((values.last() - floor) / span).coerceIn(0f, 1f) * usable
    canvas.drawCircle(lastX - 1.5f, lastY, max(2.4f, height * .048f), Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.FILL
      color = lineColor
    })
    canvas.drawCircle(lastX - 1.5f, lastY, max(1.1f, height * .022f), Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.FILL
      color = 0xFFFFFFFF.toInt()
    })
    return bitmap
  }

  fun trafficBars(
    widthPx: Int,
    heightPx: Int,
    days: List<WidgetTrafficDay>,
    rxColor: Int,
    txColor: Int,
    trackColor: Int
  ): Bitmap? {
    if (days.isEmpty() || widthPx < 4 || heightPx < 4) return null
    val width = widthPx
    val height = heightPx
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val baseline = height - 1f
    val gap = max(1.5f, width * .012f)
    val barWidth = max(1.4f, (width - gap * (days.size - 1)) / days.size)
    val radius = min(barWidth / 2f, max(1.4f, height * .035f))
    val maxTotal = days.filterNot { it.isFuture }
      .maxOfOrNull { it.rxBytes + it.txBytes }
      ?.takeIf { it > 0.0 } ?: 1.0
    val topPadding = height * .14f
    val usable = height - topPadding - 2f

    val baselinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = trackColor
      style = Paint.Style.FILL
    }
    canvas.drawRoundRect(RectF(0f, baseline - 1f, width.toFloat(), baseline), 1f, 1f, baselinePaint)
    val rxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = rxColor
      style = Paint.Style.FILL
    }
    val txPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = txColor
      style = Paint.Style.FILL
      alpha = 205
    }
    val futurePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = trackColor
      style = Paint.Style.FILL
    }

    days.forEachIndexed { index, day ->
      val left = index * (barWidth + gap)
      if (day.isFuture || (day.rxBytes + day.txBytes) <= 0.0) {
        canvas.drawRoundRect(
          RectF(left, baseline - 2f, left + barWidth, baseline),
          radius,
          radius,
          futurePaint
        )
        return@forEachIndexed
      }
      val rxHeight = (day.rxBytes / maxTotal).toFloat().coerceIn(0f, 1f) * usable
      val txHeight = (day.txBytes / maxTotal).toFloat().coerceIn(0f, 1f) * usable
      val bottom = baseline
      val rxTop = bottom - rxHeight
      val txTop = rxTop - txHeight
      if (rxHeight > 0f) {
        canvas.drawRoundRect(RectF(left, rxTop, left + barWidth, bottom), radius, radius, rxPaint)
      }
      if (txHeight > 0f) {
        canvas.drawRoundRect(RectF(left, txTop, left + barWidth, rxTop + 0.5f), radius, radius, txPaint)
      }
      if (day.isToday) {
        canvas.drawCircle(
          left + barWidth / 2f,
          (txTop - max(3f, height * .075f)).coerceAtLeast(2f),
          max(1.6f, width * .008f),
          Paint(Paint.ANTI_ALIAS_FLAG).apply { color = rxColor; style = Paint.Style.FILL }
        )
      }
    }
    return bitmap
  }

  private const val START_ANGLE = 135f
  private const val SWEEP_ANGLE = 270f
}
