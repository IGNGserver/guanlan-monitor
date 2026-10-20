package com.dsc.android

import android.os.SystemClock
import android.util.Log

internal enum class LoadingMilestone(val label: String) {
  Shell("shell-committed"), Cache("cache-committed"), Summary("hub-summary-committed"), Charts("hub-charts-committed")
}

/** Activity-instance elapsed time; fixed labels only, no remote telemetry. */
internal class LoadingPerformance(
  private val now: () -> Long = { SystemClock.elapsedRealtime() },
  private val publish: (String, Long) -> Unit = { name, elapsed -> Log.i("GuanlanLoading", "$name ${elapsed}ms") }
) {
  private val startedAt = now()
  private val recorded = mutableSetOf<LoadingMilestone>()

  fun mark(milestone: LoadingMilestone) {
    if (recorded.add(milestone)) publish(milestone.label, (now() - startedAt).coerceAtLeast(0))
  }
}
