package com.dsc.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LivePresentationTest {
  private fun process(pid: Long, cpu: Double?, name: String = "p$pid", gpu: Double? = null) =
    LiveProcessDto(id = "$pid", pid = pid, name = name, cpuPercent = cpu, gpuPercent = gpu)

  @Test
  fun errorCodeComesFromHubBody() {
    assertEquals("device_not_connected", liveErrorCodeFromBody("""{"error":"device_not_connected"}"""))
    assertNull(liveErrorCodeFromBody("<html>502</html>"))
    assertNull(liveErrorCodeFromBody(null))
  }

  @Test
  fun failuresSayWhatTheyDoNotMean() {
    val denied = describeLiveFailure("docker_permission_denied")
    assertTrue("权限不足不能读成没有容器：${denied.detail}", denied.detail.contains("不代表没有容器"))
    assertTrue(describeLiveFailure("collection_busy").transient)
    assertFalse(describeLiveFailure("device_not_connected").transient)
    assertEquals("查询未完成", describeLiveFailure("something_new").title)
  }

  @Test
  fun liveIsOnlyClaimedForConfirmedFreshResults() {
    assertEquals(LiveTone.Live, liveStatus(false, hasResult = true, expired = false, failure = null, ageSeconds = 0).tone)
    assertEquals(LiveTone.Stale, liveStatus(false, hasResult = true, expired = false, failure = describeLiveFailure("collection_busy"), ageSeconds = 3).tone)
    assertEquals(LiveTone.Stale, liveStatus(false, hasResult = false, expired = true, failure = null, ageSeconds = 9).tone)
    assertEquals(LiveTone.Unavailable, liveStatus(false, hasResult = false, expired = false, failure = describeLiveFailure("device_not_connected"), ageSeconds = 0).tone)
    assertEquals(LiveTone.Paused, liveStatus(true, hasResult = true, expired = false, failure = null, ageSeconds = 0).tone)
  }

  @Test
  fun resultsExpireAfterTwoIntervalsOrSixSeconds() {
    assertFalse(liveExpired(lastConfirmedMillis = 1_000, nowMillis = 6_500, intervalSeconds = 1, paused = false))
    assertTrue(liveExpired(lastConfirmedMillis = 1_000, nowMillis = 7_500, intervalSeconds = 1, paused = false))
    assertFalse(liveExpired(lastConfirmedMillis = 1_000, nowMillis = 20_000, intervalSeconds = 10, paused = false))
    assertFalse("暂停时不算过期", liveExpired(lastConfirmedMillis = 1_000, nowMillis = 60_000, intervalSeconds = 1, paused = true))
  }

  @Test
  fun unknownValuesSortLastInBothDirections() {
    val items = listOf(process(1, null), process(2, 10.0), process(3, 50.0))
    assertEquals(listOf(3L, 2L, 1L), sortProcesses(items, ProcessSortKey.Cpu, descending = true).map { it.pid })
    assertEquals(listOf(2L, 3L, 1L), sortProcesses(items, ProcessSortKey.Cpu, descending = false).map { it.pid })
  }

  @Test
  fun heldOrderKeepsPositionsAndAppendsNewRows() {
    assertEquals(listOf("a", "c", "d"), holdOrder(listOf("a", "b", "c"), listOf("d", "c", "a")))
  }

  @Test
  fun containerHealthFindsTheOnesWorthLookingAt() {
    fun c(state: String, status: String = "") = LiveContainerDto(id = state, name = state, state = state, status = status)
    assertEquals(ContainerHealth.Problem, containerHealth(c("running", "Up 3 hours (unhealthy)")))
    assertEquals(ContainerHealth.Problem, containerHealth(c("restarting")))
    assertEquals(ContainerHealth.Running, containerHealth(c("running", "Up 3 hours")))
    assertEquals(ContainerHealth.Stopped, containerHealth(c("exited")))
    assertEquals("不健康", containerStateLabel(c("running", "Up (unhealthy)")))
  }

  @Test
  fun containerRatesIgnoreRestartsAndEngineChanges() {
    val before = LiveDockerDto(observedAt = "2026-10-18T00:00:00Z", engineId = "e1", items = listOf(LiveContainerDto(id = "x", name = "x", networkRxBytes = 1_000.0, blockReadBytes = 5_000.0)))
    val after = LiveDockerDto(observedAt = "2026-10-18T00:00:02Z", engineId = "e1", items = listOf(LiveContainerDto(id = "x", name = "x", networkRxBytes = 3_000.0, blockReadBytes = 10.0)))
    val rates = containerRates(before, after).getValue("x")
    assertEquals(1_000.0, rates.networkRx!!, 1e-9)
    assertNull("计数器回退（容器重启）不能算出负速率", rates.blockRead)
    assertNull(containerRates(before.copy(engineId = "e2"), after).getValue("x").networkRx)
  }

  @Test
  fun sessionChangeRestartsTheCurve() {
    val first = appendLiveSample(emptyList(), LiveSample(1_000, LiveMetricsDto(observedAt = "t")), sessionChanged = false)
    val second = appendLiveSample(first, LiveSample(2_000, LiveMetricsDto(observedAt = "t")), sessionChanged = false)
    assertEquals(2, second.size)
    assertEquals(1, appendLiveSample(second, LiveSample(3_000, LiveMetricsDto(observedAt = "t")), sessionChanged = true).size)
    val old = appendLiveSample(second, LiveSample(200_000, LiveMetricsDto(observedAt = "t")), sessionChanged = false)
    assertEquals("超出 2 分钟的点要丢掉", 1, old.size)
  }
}
