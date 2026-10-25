package com.dsc.android

import androidx.lifecycle.ViewModelStore
import java.io.File
import java.lang.reflect.Proxy
import java.nio.file.Files
import java.time.Instant
import kotlin.coroutines.Continuation
import kotlin.coroutines.intrinsics.COROUTINE_SUSPENDED
import kotlin.coroutines.resume
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import com.dsc.android.ui.shell.resolvedScreen

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RemoteViewModelTest {
  private class FakeUpdates : DeviceUpdateSource {
    var checks = 0
    override var channel = "preview"
    override val downloadClient = OkHttpClient()
    override suspend fun check(manual: Boolean): UpdateInfoDto { checks++; return UpdateInfoDto(message = "direct feed") }
    override fun validatePackage(file: File, update: UpdateInfoDto) {}
  }
  private class Settings(config: ServerConfig) : ConnectionSettings {
    val values = MutableStateFlow(config)
    override fun settings() = values
    override suspend fun save(config: ServerConfig) { values.value = connectionRecord(values.value, config) }
    override suspend fun clear() { values.value = ServerConfig() }
  }
  private fun api(call: (String, Array<out Any?>) -> Any?): DeviceStateApi = Proxy.newProxyInstance(
    DeviceStateApi::class.java.classLoader, arrayOf(DeviceStateApi::class.java)
  ) { _, method, arguments -> call(method.name, arguments ?: emptyArray()) } as DeviceStateApi

  private val config = ServerConfig("https://hub.example", "fixture-account", "opaque-fixture-id")
  private val device = DeviceSummaryDto("a", "nas", "linux", status = "online")
  private fun metric(id: String = "a") = MetricsDto(status = "online", device = DeviceDetailDto(id, id, "linux", "linux", "amd64", status = "online"), latest = DeviceLatestDto(), series = DeviceMetricSeriesDto())

  @Test fun updateCheckWorksWithoutHubConfiguration() = runTest {
    Dispatchers.setMain(StandardTestDispatcher(testScheduler))
    val dir = Files.createTempDirectory("guanlan-update-no-hub").toFile(); val store = ViewModelStore()
    try {
      val updates = FakeUpdates()
      val vm = MainViewModel(RuntimeEnvironment.getApplication(), Settings(ServerConfig()), RemoteSnapshotCache(File(dir, "cache.json")), updates) { error("updates must not create a Hub API") }
      store.put("vm", vm); runCurrent(); vm.onAppForeground(); runCurrent()
      assertEquals(1, updates.checks)
      assertEquals("direct feed", vm.state.value.updateInfo?.message)
      vm.showSettings()
      assertEquals(AppScreen.Settings, vm.state.value.resolvedScreen())
      vm.setUpdateChannel("stable"); runCurrent()
      assertEquals("stable", vm.state.value.updateChannel)
      assertEquals(2, updates.checks)
    } finally { store.clear(); Dispatchers.resetMain(); dir.deleteRecursively() }
  }

  @Test fun summaryCommitsBeforeHungOverviewAndForegroundDoesNotLogInTwice() = runTest {
    Dispatchers.setMain(StandardTestDispatcher(testScheduler))
    val dir = Files.createTempDirectory("guanlan-viewmodel").toFile(); val store = ViewModelStore()
    var logins = 0; var metrics = 0; var calendars = 0; var overviews = 0
    val overview = CompletableDeferred<OverviewMetricsDto>()
    val fake = api { name, args -> when (name) {
      "login" -> { logins++; LoginResponseDto(true) }
      "devices" -> listOf(device)
      "overviewMetrics" -> {
        overviews++
        @Suppress("UNCHECKED_CAST") val continuation = args.last() as Continuation<Any?>
        backgroundScope.launch { continuation.resume(overview.await()) }
        COROUTINE_SUSPENDED
      }
      "metrics" -> { metrics++; metric() }
      "trafficCalendar" -> { calendars++; error("unexpected calendar") }
      "updateInfo" -> UpdateInfoDto()
      else -> error("unexpected call: $name")
    } }
    try {
      val vm = MainViewModel(RuntimeEnvironment.getApplication(), Settings(config), RemoteSnapshotCache(File(dir, "cache.json")), FakeUpdates()) { Triple(fake, InMemoryCookieJar(), OkHttpClient()) }
      store.put("vm", vm); vm.onAppForeground(); runCurrent()
      assertTrue(vm.state.value.authenticated); assertEquals("a", vm.state.value.devices.single().deviceId)
      assertEquals(1, logins); assertEquals(0, metrics); assertEquals(0, calendars); assertEquals(1, overviews)
      vm.showSettings(); runCurrent(); overview.complete(OverviewMetricsDto("5m")); runCurrent()
      assertNull("cancelled overview must not fill a hidden page", vm.state.value.overviewMetrics)
      vm.onAppBackground(); vm.onAppForeground(); runCurrent()
      assertEquals(1, logins)
    } finally { store.clear(); Dispatchers.resetMain(); dir.deleteRecursively() }
  }

  @Test fun oldLoginCannotPublishAcrossAnIdentityReplacement() = runTest {
    Dispatchers.setMain(StandardTestDispatcher(testScheduler))
    val dir = Files.createTempDirectory("guanlan-identity").toFile(); val store = ViewModelStore()
    val settings = Settings(config); val late = CompletableDeferred<LoginResponseDto>(); var first = true
    val fake = api { name, args -> when (name) {
      "login" -> if (first) {
        first = false
        @Suppress("UNCHECKED_CAST") val continuation = args.last() as Continuation<Any?>
        backgroundScope.launch { continuation.resume(late.await()) }; COROUTINE_SUSPENDED
      } else LoginResponseDto(true)
      "devices" -> listOf(device.copy(deviceId = "new-account"))
      "updateInfo" -> UpdateInfoDto()
      else -> error("unexpected: $name")
    } }
    try {
      val vm = MainViewModel(RuntimeEnvironment.getApplication(), settings, RemoteSnapshotCache(File(dir, "cache.json")), FakeUpdates()) { Triple(fake, InMemoryCookieJar(), OkHttpClient()) }
      store.put("vm", vm); runCurrent()
      settings.save(config.copy(accessKey = "new-fixture-account")); runCurrent()
      repeat(100) { runCurrent(); withContext(Dispatchers.Default) { delay(1) } }
      late.complete(LoginResponseDto(true)); runCurrent()
      assertEquals("new-account", vm.state.value.devices.single().deviceId)
      assertEquals("new-fixture-account", vm.state.value.serverConfig.accessKey)
    } finally { store.clear(); Dispatchers.resetMain(); dir.deleteRecursively() }
  }

  @Test fun attentionIsPageScopedBoundedAndAlwaysFullPrecision() = runTest {
    Dispatchers.setMain(StandardTestDispatcher(testScheduler))
    val dir = Files.createTempDirectory("guanlan-attention").toFile(); val store = ViewModelStore()
    val release = CompletableDeferred<Unit>(); var calls = 0
    val fake = api { name, args -> when (name) {
      "login" -> LoginResponseDto(true)
      "devices" -> (1..20).map { device.copy(deviceId = it.toString()) }
      "overviewMetrics" -> OverviewMetricsDto("5m")
      "metrics" -> {
        calls++; assertNull(args[2])
        @Suppress("UNCHECKED_CAST") val continuation = args.last() as Continuation<Any?>
        backgroundScope.launch { release.await(); continuation.resume(metric(args[0] as String)) }
        COROUTINE_SUSPENDED
      }
      "updateInfo" -> UpdateInfoDto()
      else -> error("unexpected: $name")
    } }
    try {
      val vm = MainViewModel(RuntimeEnvironment.getApplication(), Settings(config.copy(networkMode = "saver")), RemoteSnapshotCache(File(dir, "cache.json")), FakeUpdates()) { Triple(fake, InMemoryCookieJar(), OkHttpClient()) }
      store.put("vm", vm); vm.onAppForeground(); runCurrent(); assertEquals(0, calls)
      vm.showAttention(); runCurrent(); assertEquals(1, calls)
      vm.showSettings(); runCurrent(); release.complete(Unit); runCurrent()
      assertEquals(1, calls); assertTrue(vm.state.value.attentionMetrics.isEmpty())
    } finally { store.clear(); Dispatchers.resetMain(); dir.deleteRecursively() }
  }
}
