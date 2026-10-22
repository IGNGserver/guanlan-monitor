package com.dsc.android

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.dsc.android.ui.oneui.GuanlanTheme
import com.dsc.android.ui.oneui.OneUiAppearanceSetting
import com.dsc.android.ui.screens.AttentionScreen
import com.dsc.android.ui.screens.DetailTab
import com.dsc.android.ui.screens.DeviceDetailScreen
import com.dsc.android.ui.screens.DeviceListScreen
import com.dsc.android.ui.screens.TrafficScreen
import com.dsc.android.ui.shell.GuanlanActions
import com.dsc.android.ui.shell.GuanlanApp
import java.io.File
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * 页面渲染冒烟测试：用假数据把各一级页面真实画一遍（Robolectric 原生图形），
 * 组合期崩溃、布局异常会在这里暴露；截图写到 build/screenshots/ 供人工核对，不做像素比对。
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w400dp-h1500dp-xhdpi")
class ScreenRenderTest {
  @get:Rule
  val compose = createAndroidComposeRule<ComponentActivity>()

  private val now: Instant = Instant.now()
  private fun ago(seconds: Long) = now.minusSeconds(seconds).toString()

  private fun wave(points: Int, stepSeconds: Long, base: Double, amplitude: Double, phase: Double = 0.0): List<SamplePointDto> =
    (0 until points).map { index ->
      val t = index.toDouble() / points * Math.PI * 4 + phase
      SamplePointDto(ago((points - index) * stepSeconds), (base + amplitude * Math.sin(t) + amplitude * 0.3 * Math.sin(t * 3.7)).coerceAtLeast(0.0))
    }

  private val devices = listOf(
    DeviceSummaryDto("nas", "nas-main", "linux", "3.0.158", status = "online", lastSeenAt = ago(8), cpuUsagePercent = 23.4, memoryUsagePercent = 61.0, memoryUsedBytes = 10_000_000_000, memoryTotalBytes = 16_000_000_000, diskUsagePercent = 72.0, diskUsedBytes = 2_900_000_000_000, diskTotalBytes = 4_000_000_000_000, sortOrder = 0),
    DeviceSummaryDto("ws", "workstation", "windows", "3.0.158", status = "online", lastSeenAt = ago(4), cpuUsagePercent = 91.2, gpuUsagePercent = 64.0, memoryUsagePercent = 93.5, memoryUsedBytes = 30_000_000_000, memoryTotalBytes = 32_000_000_000, diskUsagePercent = 48.0, sortOrder = 1),
    DeviceSummaryDto("pi", "pi-garage", "linux", "3.0.150", status = "offline", lastSeenAt = ago(3 * 3600), sortOrder = 2)
  )

  private val overview = OverviewMetricsDto(
    window = MetricWindow.OneHour.value,
    instances = listOf(
      OverviewInstanceSeriesDto("nas", "nas-main", wave(60, 60, 25.0, 12.0), wave(60, 60, 9.8e9, 4e8).map { it }, emptyList(), wave(60, 60, 2.4e6, 1.8e6), wave(60, 60, 6e5, 4e5, 1.0)),
      OverviewInstanceSeriesDto("ws", "workstation", wave(60, 60, 80.0, 15.0, 2.0), wave(60, 60, 2.9e10, 1e9), emptyList(), wave(60, 60, 8e6, 6e6), wave(60, 60, 1e6, 8e5, 2.0))
    )
  )

  private val metrics = MetricsDto(
    status = "online",
    lastSeenAt = ago(4),
    window = MetricWindow.OneHour.value,
    device = DeviceDetailDto("ws", "workstation", "windows", "win32", "x64", cpuModel = "AMD Ryzen 9 7950X", agentVersion = "3.0.158", status = "online", lastSeenAt = ago(4)),
    latest = DeviceLatestDto(
      cpuUsagePercent = 91.2,
      cpuFrequencyMHz = 4870.0,
      cpuTemperatureC = 88.0,
      memoryUsedBytes = 30_000_000_000,
      memoryTotalBytes = 32_000_000_000,
      memoryAvailableBytes = 2_000_000_000,
      memoryCachedBytes = 4_000_000_000,
      memoryCommittedBytes = 38_000_000_000,
      memoryCommitLimitBytes = 42_000_000_000,
      swapUsedBytes = 3_000_000_000,
      swapTotalBytes = 10_000_000_000,
      diskUsedBytes = 960_000_000_000,
      diskTotalBytes = 2_000_000_000_000,
      system = SystemStatsDto(processCount = 312, threadCount = 4820, handleCount = 182000),
      gpus = listOf(GpuDto("gpu0", "RTX 4080", 64.0, memoryUsedBytes = 9_000_000_000, memoryTotalBytes = 16_000_000_000, temperatureC = 71.0)),
      disks = listOf(DiskDto("c", "C:", "C:\\", temperatureC = 44.0, healthStatus = "caution", healthReason = "重映射扇区计数上升", totalBytes = 2_000_000_000_000, usedBytes = 960_000_000_000))
    ),
    series = DeviceMetricSeriesDto(
      cpuUsagePercent = wave(60, 60, 80.0, 15.0, 2.0),
      cpuFrequencyMHz = wave(60, 60, 4600.0, 300.0),
      cpuTemperatureC = wave(60, 60, 82.0, 6.0, 2.0),
      gpuUsagePercent = wave(60, 60, 55.0, 25.0),
      gpuMemoryUsagePercent = wave(60, 60, 56.0, 3.0),
      gpuTemperatureC = wave(60, 60, 68.0, 4.0),
      memoryUsagePercent = wave(60, 60, 90.0, 4.0),
      swapUsagePercent = wave(60, 60, 28.0, 6.0),
      memoryUsedBytes = wave(60, 60, 2.9e10, 1e9),
      memoryCachedBytes = wave(60, 60, 4e9, 3e8),
      memoryAvailableBytes = wave(60, 60, 2e9, 8e8),
      memoryCommittedBytes = wave(60, 60, 3.8e10, 1e9),
      systemProcessCount = wave(60, 60, 310.0, 6.0),
      diskReadBytesPerSec = wave(60, 60, 4e7, 3e7),
      diskWriteBytesPerSec = wave(60, 60, 1.2e7, 9e6, 1.5),
      networkRxBytesPerSec = wave(60, 60, 8e6, 6e6),
      networkTxBytesPerSec = wave(60, 60, 1e6, 8e5, 2.0)
    )
  )

  private val processes = LiveUiState(
    deviceId = "ws",
    topic = LiveTopic.Processes,
    intervalSeconds = 2,
    sessionId = "s1",
    receivedAt = ago(1),
    lastConfirmedMillis = System.currentTimeMillis(),
    processes = LiveProcessesDto(
      observedAt = ago(1),
      totalCount = 312,
      truncated = true,
      items = listOf(
        LiveProcessDto("1", 4120, 1, "blender.exe", cpuPercent = 62.3, gpuPercent = 81.0, memoryBytes = 6.2e9, threads = 96),
        LiveProcessDto("2", 1880, 1, "chrome.exe", cpuPercent = 8.4, gpuPercent = 3.0, memoryBytes = 2.1e9, threads = 44),
        LiveProcessDto("3", 920, 1, "MsMpEng.exe", cpuPercent = 4.1, gpuPercent = null, memoryBytes = 3.4e8, threads = 61),
        LiveProcessDto("4", 7, 0, "System", cpuPercent = null, gpuPercent = null, memoryBytes = 1.2e8, threads = 280)
      )
    )
  )

  private val baseState = AppState(
    serverConfig = ServerConfig("http://nas:38472", "key"),
    loading = false,
    authenticated = true,
    dataSource = RemoteDataSource.Live,
    devices = devices,
    overviewMetrics = overview,
    overviewWindow = MetricWindow.OneHour,
    selectedWindow = MetricWindow.OneHour,
    selectedDeviceId = "ws",
    metrics = metrics,
    attentionMetrics = mapOf("ws" to metrics),
    attentionCheckedAt = ago(20),
    currentScreen = AppScreen.DeviceList
  )

  private val actions = GuanlanActions(
    onSaveServerConfig = { _, _ -> }, onLogin = {}, onLogout = {}, onSystemBack = {}, onOpenDevice = { _, _ -> },
    onDeleteDevice = {}, onReorderDevices = {}, onClearFocusedBlock = {}, onOpenTraffic = {}, onOpenDeviceEditor = {},
    onShowDeviceList = {}, onShowSettings = {}, onShowAttention = {}, onSelectOverviewWindow = {}, onSelectWindow = {},
    onSelectTrafficMode = {}, onSelectTrafficCell = {}, onShiftTrafficAnchor = {}, onOpenBlockEditor = { _, _ -> },
    onOpenInstanceEditor = { _, _, _ -> }, onCloseMetricConfigEditor = {}, onToggleMetric = {}, onToggleBlock = {},
    onToggleDeviceInstance = { _, _ -> }, onToggleInstanceMetric = { _, _ -> }, onSaveMetricConfig = {}, onRefresh = {},
    onCheckUpdate = {}, onDownloadUpdate = {}, onLaunchUpdateInstaller = {}, onUpdateInstallerLaunched = {}, onConsumeMessage = {}
  )

  private fun render(name: String, appearance: OneUiAppearanceSetting = OneUiAppearanceSetting.Light, content: @androidx.compose.runtime.Composable () -> Unit) {
    compose.setContent { GuanlanTheme(appearance = appearance, reduceMotionOverride = true) { content() } }
    compose.waitForIdle()
    // captureToImage 在 Robolectric 下等不到硬件重绘帧，直接把视图树画到软件 Canvas 上
    val root = compose.activity.window.decorView
    val bitmap = Bitmap.createBitmap(root.width.coerceAtLeast(1), root.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    root.draw(Canvas(bitmap))
    val dir = File("build/screenshots").apply { mkdirs() }
    File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
  }

  @Test
  fun overview() = render("01-overview") { DeviceListScreen(state = baseState, actions = actions, embedded = false) }

  @Test
  fun overviewDark() = render("02-overview-dark", OneUiAppearanceSetting.Dark) { DeviceListScreen(state = baseState, actions = actions, embedded = false) }

  @Test
  fun attention() = render("03-attention") {
    AttentionScreen(state = baseState.copy(currentScreen = AppScreen.Attention), actions = actions, embedded = false)
  }

  @Test
  fun deviceOverview() = render("04-device-overview") {
    DeviceDetailScreen(state = baseState.copy(currentScreen = AppScreen.DeviceDetail), actions = actions, embedded = false)
  }

  @Test
  fun deviceMemory() = render("05-device-memory") {
    DeviceDetailScreen(state = baseState.copy(currentScreen = AppScreen.DeviceDetail, focusedBlock = DeviceBlockKey.Memory), actions = actions, embedded = false)
  }

  @Test
  fun deviceProcesses() = render("06-device-processes") {
    DeviceDetailScreen(
      state = baseState.copy(currentScreen = AppScreen.DeviceDetail, live = processes),
      actions = actions,
      embedded = false,
      initialTab = DetailTab.Processes
    )
  }

  @Test
  fun deviceHardware() = render("07-device-hardware") {
    DeviceDetailScreen(state = baseState.copy(currentScreen = AppScreen.DeviceDetail), actions = actions, embedded = false, initialTab = DetailTab.Hardware)
  }

  @Test
  @Config(sdk = [34], qualifiers = "w1024dp-h768dp-xhdpi")
  fun tabletLandscapeTwoPaneShell() = render("08-tablet-landscape-shell") {
    GuanlanApp(state = baseState.copy(currentScreen = AppScreen.DeviceList), actions = actions)
  }

  @Test
  @Config(sdk = [34], qualifiers = "w1024dp-h768dp-xhdpi")
  fun tabletLandscapeSettings() = render("09-tablet-landscape-settings") {
    GuanlanApp(state = baseState.copy(currentScreen = AppScreen.Settings), actions = actions)
  }

  @Test
  @Config(sdk = [34], qualifiers = "w1024dp-h768dp-xhdpi")
  fun tabletLandscapeTraffic() {
    val traffic = TrafficCalendarDto(
      mode = "day",
      anchor = ago(0),
      title = "2026 年 10 月",
      rangeStart = ago(86400 * 30),
      rangeEnd = ago(0),
      totalRxBytes = 128_000_000_000.0,
      totalTxBytes = 42_000_000_000.0,
      cells = (1..30).map { day ->
        TrafficCalendarCellDto(
          key = "day-$day",
          label = "%02d".format(day),
          rangeStart = ago((30 - day) * 86400L),
          rangeEnd = ago((29 - day) * 86400L),
          totalRxBytes = day * 2_000_000_000.0,
          totalTxBytes = day * 500_000_000.0,
          isInPrimaryScope = true,
          isCurrentPeriod = day == 30,
          isSelected = day == 29
        )
      },
      records = listOf(
        TrafficRangeRecordDto(ago(3600), 1_200_000_000.0, 300_000_000.0, 1_500_000_000.0),
        TrafficRangeRecordDto(ago(7200), 900_000_000.0, 210_000_000.0, 1_110_000_000.0)
      )
    )
    render("10-tablet-landscape-traffic") {
      TrafficScreen(
        state = baseState.copy(currentScreen = AppScreen.Traffic, trafficCalendar = traffic),
        actions = actions,
        embedded = true
      )
    }
  }
}
