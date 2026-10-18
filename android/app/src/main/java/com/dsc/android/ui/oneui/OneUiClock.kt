package com.dsc.android.ui.oneui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.dsc.android.relativeAge
import kotlinx.coroutines.delay

/**
 * 「12 秒前」这类相对时间需要一个会走的钟。页面只读它，不自己起协程；
 * 进后台时组合被暂停，钟也随之停下，不额外耗电。
 */
@Composable
fun rememberNowMillis(periodMillis: Long = 5_000L): Long {
  var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
  LaunchedEffect(periodMillis) {
    while (true) {
      delay(periodMillis)
      now = System.currentTimeMillis()
    }
  }
  return now
}

/** ISO 时间 → 相对时间；解析不了时退回绝对时间，绝不显示空白。 */
fun relativeTimeLabel(iso: String?, nowMillis: Long): String {
  if (iso.isNullOrBlank()) return "无上报记录"
  val millis = runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrNull()
    ?: runCatching { java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull()
    ?: return formatTime(iso)
  return relativeAge(nowMillis - millis)
}
