package com.dsc.android

import android.app.Application
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import java.time.Instant
import java.time.ZonedDateTime
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.OkHttpClient
import retrofit2.HttpException

class MainViewModel(application: Application) : AndroidViewModel(application) {
  private val settingsRepository = SettingsRepository(application)
  private val apiFactory = ApiFactory(application)
  private val remoteSnapshotCache = RemoteSnapshotCache(application)
  // 按设备缓存指标与流量：离线切换设备时，设备页/流量页仍能展示最近一次成功读到的数据（交）
  private val deviceMetricsCache = mutableMapOf<String, MetricsDto>()
  private val deviceTrafficCache = mutableMapOf<String, TrafficCalendarDto>()
  private val refreshMutex = Mutex()

  private val _state = MutableStateFlow(AppState())
  val state: StateFlow<AppState> = _state.asStateFlow()

  private var api: DeviceStateApi? = null
  private var httpClient: OkHttpClient? = null
  private var refreshLoopJob: Job? = null
  private var metricsLoadJob: Job? = null
  private var trafficLoadJob: Job? = null
  private var overviewLoadJob: Job? = null
  private var attentionLoadJob: Job? = null
  private var refreshTicks = 0
  private var liveJob: Job? = null
  private var livePreviousDocker: LiveDockerDto? = null
  private var cacheWriteJob: Job? = null
  private var trafficAnchor: String = todayAnchor()
  private var trafficSelectedStart: String? = null
  private var lastAutoLoginSignature: String? = null
  private var appInForeground = false

  private val blockMetrics = mapOf(
    DeviceBlockKey.Cpu to listOf("cpuUsage", "cpuFrequency", "cpuTemperature"),
    DeviceBlockKey.Gpu to listOf("gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature"),
    DeviceBlockKey.Memory to listOf("memoryUsage", "swapUsage"),
    DeviceBlockKey.Disk to listOf("diskUsage", "diskRead", "diskWrite"),
    DeviceBlockKey.Storage to listOf("storagePools"),
    DeviceBlockKey.Network to listOf("networkRxRate", "networkTxRate", "networkTraffic"),
    DeviceBlockKey.Temperature to listOf("temperatureSources"),
    DeviceBlockKey.Fan to emptyList()
  )

  init {
    viewModelScope.launch {
      remoteSnapshotCache.read()?.let { cached ->
        applyCachedSnapshot(cached)
      }
    }
    viewModelScope.launch {
      settingsRepository.settings().collectLatest { config ->
        _state.update { current ->
          val targetScreen = when {
            current.authenticated -> current.currentScreen
            config.baseUrl.isNotBlank() && (current.dataSource == RemoteDataSource.Cache || current.devices.isNotEmpty()) -> {
              if (current.currentScreen != AppScreen.Login) current.currentScreen else AppScreen.DeviceList
            }
            config.baseUrl.isNotBlank() -> AppScreen.DeviceList
            else -> AppScreen.Login
          }
          current.copy(
            serverConfig = config,
            loading = false,
            currentScreen = targetScreen
          )
        }
        if (config.baseUrl.isNotBlank()) {
          if (configureApiClient(config.baseUrl)) {
            val signature = "${config.baseUrl}\n${config.accessKey}"
            val shouldAutoLogin =
              config.accessKey.isNotBlank() &&
                signature != lastAutoLoginSignature &&
                !_state.value.savingConfig &&
                !_state.value.loggingIn &&
                !_state.value.authenticated
            if (shouldAutoLogin) {
              lastAutoLoginSignature = signature
              login()
            }
          }
        } else {
          stopRemoteActivity(clearCache = false)
          api = null
          httpClient = null
          lastAutoLoginSignature = null
          clearScreenBackStack()
        }
      }
    }
  }

  fun onAppForeground() {
    appInForeground = true
    if (_state.value.live?.paused == false) launchLiveLoop()
    if (_state.value.serverConfig.baseUrl.isNotBlank() && _state.value.serverConfig.accessKey.isNotBlank()) {
      if (!_state.value.loggingIn && !_state.value.refreshing) {
        login()
      }
    } else if (_state.value.authenticated) {
      startRefreshLoop()
      refresh()
    }
  }

  fun onAppBackground() {
    appInForeground = false
    stopRemoteActivity(clearCache = false)
  }

  /* ---------- 实时查看：只在对应页面可见、应用在前台时轮询 ---------- */

  fun startLive(deviceId: String, topic: LiveTopic) {
    val current = _state.value.live
    if (current != null && current.deviceId == deviceId && current.topic == topic && liveJob?.isActive == true) return
    val interval = if (current?.topic == topic) current.intervalSeconds else defaultLiveInterval(topic)
    livePreviousDocker = null
    _state.update { it.copy(live = LiveUiState(deviceId = deviceId, topic = topic, intervalSeconds = interval)) }
    launchLiveLoop()
  }

  fun stopLive() {
    liveJob?.cancel()
    liveJob = null
    livePreviousDocker = null
    _state.update { it.copy(live = null) }
  }

  fun setLivePaused(paused: Boolean) {
    val live = _state.value.live ?: return
    _state.update { it.copy(live = live.copy(paused = paused)) }
    if (paused) {
      // 暂停就是不发请求，而不是发得慢：最后一次结果留在屏上并标为已暂停
      liveJob?.cancel()
      liveJob = null
    } else {
      launchLiveLoop()
    }
  }

  fun setLiveInterval(seconds: Int) {
    val live = _state.value.live ?: return
    // 改刷新频率不丢已有的两分钟曲线
    _state.update { it.copy(live = live.copy(intervalSeconds = seconds)) }
    if (!live.paused) launchLiveLoop()
  }

  fun resetLiveCredentials() {
    val live = _state.value.live ?: return
    viewModelScope.launch {
      _state.update { state -> state.copy(live = state.live?.copy(resetState = LiveResetState.Pending)) }
      val ok = runCatching { executeWithAuthRetry { it.resetLiveCredentials(live.deviceId) } }.isSuccess
      _state.update { state ->
        state.copy(
          live = state.live?.copy(resetState = if (ok) LiveResetState.Done else LiveResetState.Failed),
          message = if (ok) "已重置实时凭据，设备会在 30 秒内重新登记" else "重置失败，请检查登录状态后重试"
        )
      }
    }
  }

  private fun launchLiveLoop() {
    liveJob?.cancel()
    val initial = _state.value.live ?: return
    if (!appInForeground || initial.paused) return
    liveJob = viewModelScope.launch {
      var disconnected = false
      while (isActive) {
        val live = _state.value.live ?: break
        if (live.deviceId != initial.deviceId || live.topic != initial.topic || live.paused) break
        try {
          if (!_state.value.authenticated) throw LiveQueryException("hub_login_required")
          if (disconnected) {
            val connection = executeWithAuthRetry { it.liveConnection(live.deviceId) }
            updateLive(live) { it.copy(conflictAt = if (connection.state == "ready") null else connection.identityConflictAt) }
            if (connection.state != "ready") throw LiveQueryException("device_not_connected")
            if (live.topic.value !in connection.capabilities) throw LiveQueryException("device_capability_unavailable")
            disconnected = false
          }
          val snapshot = kotlinx.coroutines.withTimeoutOrNull(LIVE_QUERY_TIMEOUT_MS) {
            executeWithAuthRetry { api ->
              when (live.topic) {
                LiveTopic.Metrics -> api.liveMetrics(live.deviceId)
                LiveTopic.Processes -> api.liveProcesses(live.deviceId)
                LiveTopic.Docker -> api.liveDocker(live.deviceId)
              }
            }
          } ?: throw LiveQueryException("query_expired")
          if (!acceptsLiveSnapshot(snapshot, live.deviceId, live.topic)) throw LiveQueryException("device_disconnected")
          val at = System.currentTimeMillis()
          updateLive(live) { current ->
            val sessionChanged = current.sessionId != snapshot.sessionId
            val base = current.copy(
              sessionId = snapshot.sessionId,
              receivedAt = snapshot.receivedAt,
              lastConfirmedMillis = at,
              failure = null,
              conflictAt = null
            )
            when (val data = snapshot.data) {
              is LiveMetricsDto -> base.copy(metrics = data, samples = appendLiveSample(current.samples, LiveSample(at, data), sessionChanged))
              is LiveProcessesDto -> base.copy(processes = data)
              is LiveDockerDto -> {
                val rates = containerRates(if (sessionChanged) null else livePreviousDocker, data)
                livePreviousDocker = data
                base.copy(docker = data, dockerRates = rates)
              }
              else -> base
            }
          }
        } catch (error: Throwable) {
          if (error is CancellationException) throw error
          val code = liveErrorCode(error)
          val failure = describeLiveFailure(code)
          updateLive(live) { current ->
            // 设备繁忙/超时这类一过性失败保留上次结果（标为未更新）；其它失败立即移除，不拿旧数当新数
            if (failure.transient) current.copy(failure = failure)
            else current.copy(failure = failure, metrics = null, processes = null, docker = null, dockerRates = emptyMap())
          }
          if (!failure.transient) livePreviousDocker = null
          if (code in disconnectedLiveCodes && !disconnected) {
            disconnected = true
            runCatching { executeWithAuthRetry { it.liveConnection(live.deviceId) } }.getOrNull()?.let { connection ->
              updateLive(live) { it.copy(conflictAt = if (connection.state == "ready") null else connection.identityConflictAt) }
            }
          }
        }
        delay((_state.value.live?.intervalSeconds ?: live.intervalSeconds) * 1000L)
      }
    }
  }

  private inline fun updateLive(target: LiveUiState, crossinline transform: (LiveUiState) -> LiveUiState) {
    _state.update { state ->
      val live = state.live
      if (live == null || live.deviceId != target.deviceId || live.topic != target.topic) state else state.copy(live = transform(live))
    }
  }

  private fun liveErrorCode(error: Throwable): String? = when (error) {
    is LiveQueryException -> error.code
    is HttpException -> {
      val body = runCatching { error.response()?.errorBody()?.string() }.getOrNull()
      liveErrorCodeFromBody(body) ?: when (error.code()) {
        401, 403 -> "hub_login_required"
        404 -> "live_hub_upgrade_required"
        408, 504 -> "request_timeout"
        else -> null
      }
    }
    is java.net.SocketTimeoutException -> "request_timeout"
    else -> null
  }

  override fun onCleared() {
    stopRemoteActivity(clearCache = false)
    super.onCleared()
  }

  fun saveServerConfig(baseUrl: String, accessKey: String) {
    viewModelScope.launch {
      _state.update { it.copy(savingConfig = true, message = null) }
      val normalizedBaseUrl = baseUrl.trim()
      if (normalizedBaseUrl.isBlank()) {
        _state.update { it.copy(savingConfig = false, message = "请输入中枢地址") }
        return@launch
      }
      val resolvedBaseUrl = runCatching { apiFactory.resolveApiBaseUrl(normalizedBaseUrl) }
        .getOrElse { error ->
          _state.update {
            it.copy(
              savingConfig = false,
              message = userFacingError(error, "中枢地址格式不正确")
            )
          }
          return@launch
        }
      if (resolvedBaseUrl.contains(":4000/") || resolvedBaseUrl.contains(":3101/")) {
        _state.update {
          it.copy(
            savingConfig = false,
            message = "移动端请填写服务端地址，例如 http://your-server-host:38472"
          )
        }
        return@launch
      }

      val canonicalBaseUrl = resolvedBaseUrl.removeSuffix("/")
      if (runCatching { settingsRepository.save(ServerConfig(baseUrl = canonicalBaseUrl, accessKey = accessKey)) }.isFailure) {
        _state.update { it.copy(savingConfig = false, message = "保存配置失败") }
        return@launch
      }

      if (!configureApiClient(canonicalBaseUrl)) {
        _state.update { it.copy(savingConfig = false) }
        return@launch
      }

      // Login is the meaningful result of this form; a separate saved message
      // made a successful connection look like two unrelated steps.
      _state.update { it.copy(savingConfig = false, message = null) }
      lastAutoLoginSignature = "${canonicalBaseUrl}\n${accessKey}"
      login()
    }
  }

  private fun configureApiClient(baseUrl: String): Boolean {
    stopRemoteActivity(clearCache = false)
    return runCatching { apiFactory.create(baseUrl) }
      .onSuccess { created ->
        api = created.first
        httpClient = created.third
      }
      .onFailure {
        api = null
        httpClient = null
        _state.update {
          it.copy(
            authenticated = false,
            loggingIn = false,
            message = "中枢地址格式不正确"
          )
        }
      }
      .isSuccess
  }

  fun logout() {
    viewModelScope.launch {
      runCatching { api?.logout() }
      stopRemoteActivity(clearCache = true)
      settingsRepository.clear()
      clearScreenBackStack()
      api = null
      httpClient = null
      _state.update {
        it.copy(
          serverConfig = ServerConfig(),
          authenticated = false,
          dataSource = RemoteDataSource.Empty,
          cacheSavedAt = null,
          devices = emptyList(),
          selectedDeviceId = null,
          metrics = null,
          overviewMetrics = null,
          attentionMetrics = emptyMap(),
          attentionCheckedAt = null,
          live = null,
          trafficCalendar = null,
          metricConfig = null,
          loadingMetrics = false,
          loadingTraffic = false,
          metricsError = null,
          trafficError = null,
          loggingIn = false,
          currentScreen = AppScreen.Login,
          transitionDirection = ScreenTransitionDirection.None,
          message = "已登出"
        )
      }
    }
  }

  fun login() {
    val current = _state.value
    val currentApi = api ?: run {
      _state.update { it.copy(message = "请先填写中枢地址") }
      return
    }

    if (current.serverConfig.accessKey.isBlank()) {
      _state.update { it.copy(message = "请输入访问密钥") }
      return
    }

    viewModelScope.launch {
      _state.update { it.copy(loggingIn = true, message = null) }
      runCatching {
        currentApi.login(LoginRequestDto(current.serverConfig.accessKey))
        currentApi.devices()
      }.onSuccess { devices ->
        val visibleDevices = devices
          .sortedWith(compareBy<DeviceSummaryDto> { it.sortOrder ?: Int.MAX_VALUE }.thenBy { it.hostname })
        val selectedDeviceId = current.selectedDeviceId?.takeIf { id -> visibleDevices.any { it.deviceId == id } }
          ?: visibleDevices.firstOrNull()?.deviceId
        val hasCache = _state.value.devices.isNotEmpty() || _state.value.dataSource == RemoteDataSource.Cache
        if (!hasCache) {
          clearScreenBackStack()
        }
        _state.update {
          it.copy(
            authenticated = true,
            loggingIn = false,
            dataSource = RemoteDataSource.Live,
            cacheSavedAt = Instant.now().toString(),
            devices = devices,
            selectedDeviceId = selectedDeviceId,
            currentScreen = if (it.currentScreen != AppScreen.Login) it.currentScreen else AppScreen.DeviceList,
            transitionDirection = ScreenTransitionDirection.None,
            message = null
          )
        }
        checkForUpdate()
        loadOverviewMetrics(_state.value.overviewWindow)
        loadAttentionMetrics()
        selectedDeviceId?.let {
          loadMetrics(it, current.selectedWindow, showScreen = false)
          loadTraffic(it, _state.value.trafficMode, showScreen = false)
        }
        startRefreshLoop()
        persistRemoteSnapshot()
      }.onFailure { error ->
        val hasCache = _state.value.devices.isNotEmpty() || _state.value.dataSource == RemoteDataSource.Cache
        if (!hasCache) {
          clearScreenBackStack()
        }
        _state.update {
          it.copy(
            loggingIn = false,
            authenticated = false,
            dataSource = if (it.devices.isEmpty()) RemoteDataSource.Empty else RemoteDataSource.Cache,
            currentScreen = if (hasCache) it.currentScreen else AppScreen.Login,
            transitionDirection = ScreenTransitionDirection.None,
            message = loginErrorMessage(error)
          )
        }
      }
    }
  }

  fun downloadUpdate() {
    val update = _state.value.updateInfo ?: return
    val assetUrl = update.assetUrl
    val expectedSha256 = update.sha256
    if (!update.available || assetUrl.isNullOrBlank() || expectedSha256.isNullOrBlank()) {
      _state.update { it.copy(message = "更新包校验信息不完整，已阻止安装") }
      return
    }
    val client = httpClient ?: return
    viewModelScope.launch {
      _state.update { it.copy(updateDownloading = true, updateProgress = 0f, message = null) }
      runCatching {
        withContext(Dispatchers.IO) {
          val request = okhttp3.Request.Builder().url(assetUrl).get().build()
          client.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "下载更新失败：HTTP ${response.code}" }
            val body = response.body ?: error("更新响应为空")
            val total = body.contentLength()
            val target = File(getApplication<Application>().cacheDir, "device-state-console-update.apk")
            FileOutputStream(target).use { output ->
              body.byteStream().use { input ->
                val buffer = ByteArray(128 * 1024)
                var copied = 0L
                while (true) {
                  val count = input.read(buffer)
                  if (count <= 0) break
                  output.write(buffer, 0, count)
                  copied += count
                  if (total > 0) {
                    _state.update { it.copy(updateProgress = copied.toFloat() / total.toFloat()) }
                  }
                }
              }
            }
            val digest = MessageDigest.getInstance("SHA-256").digest(target.readBytes())
              .joinToString("") { byte -> "%02x".format(byte) }
            check(digest.equals(expectedSha256, ignoreCase = true)) { "更新包校验失败" }
            val uri = FileProvider.getUriForFile(
              getApplication<Application>(),
              "${getApplication<Application>().packageName}.fileprovider",
              target
            )
            uri.toString()
          }
        }
      }.onSuccess { uri ->
        _state.update { it.copy(updateDownloading = false, updateProgress = 1f, updateInstallerUri = uri, message = "更新包已下载，正在打开系统安装器") }
      }.onFailure { error ->
        _state.update { it.copy(updateDownloading = false, updateProgress = 0f, message = userFacingError(error, "更新失败")) }
      }
    }
  }

  fun clearUpdateInstallerUri() {
    _state.update { it.copy(updateInstallerUri = null) }
  }

  /**
   * 检查中枢上的更新。
   *
   * 登录后的自动检查保持静默（`reportResult = false`）；只有用户在「设置 › 版本与更新」
   * 里主动点「检查更新」时，才把「已是最新 / 检查失败」的结论说出来（交）。
   */
  fun checkForUpdate(reportResult: Boolean = false) {
    val currentApi = api ?: return
    val config = _state.value.serverConfig
    if (config.baseUrl.isBlank()) return
    viewModelScope.launch {
      val result = runCatching {
        currentApi.updateInfo(
          platform = "android",
          currentVersion = BuildConfig.RELEASE_VERSION,
          currentChannel = BuildConfig.RELEASE_CHANNEL,
          arch = "universal"
        )
      }
      val update = result.getOrNull()
      val hasInstallableUpdate = update?.available == true && !update.assetUrl.isNullOrBlank()
      _state.update {
        it.copy(
          updateInfo = update?.takeIf { item -> item.available && !item.assetUrl.isNullOrBlank() },
          message = when {
            !reportResult -> it.message
            result.isFailure -> "检查更新失败，请确认中枢可达"
            hasInstallableUpdate -> "发现新版本 v${update?.latestVersion ?: ""}，可在下方下载"
            else -> "当前已是最新版本（v${BuildConfig.RELEASE_VERSION}）"
          }
        )
      }
    }
  }

  fun openDevice(deviceId: String, focusBlock: DeviceBlockKey? = null) {
    pushCurrentScreen()
    val switchingDevice = _state.value.selectedDeviceId != deviceId
    // 换设备时优先展示这台设备的按设备缓存，读取失败也不会退回骨架屏（交）
    val cachedMetrics = deviceMetricsCache[deviceId]
    _state.update {
      it.copy(
        selectedDeviceId = deviceId,
        focusedBlock = focusBlock,
        currentScreen = AppScreen.DeviceDetail,
        transitionDirection = ScreenTransitionDirection.Forward,
        // 顶栏标题取自已加载的快照，换设备时必须先清掉，否则会短暂显示上一台的名字（交）
        metrics = if (switchingDevice) cachedMetrics else it.metrics,
        metricsError = if (switchingDevice) null else it.metricsError,
        message = null
      )
    }
    loadMetrics(deviceId, _state.value.selectedWindow, showScreen = true)
  }

  /** 流量改为整页：One UI 不把一个需要日历与明细的内容塞进半屏面板。 */
  fun openTraffic(deviceId: String) {
    pushCurrentScreen()
    val switchingDevice = _state.value.selectedDeviceId != deviceId
    val cachedTraffic = deviceTrafficCache[deviceId]
    _state.update {
      it.copy(
        selectedDeviceId = deviceId,
        currentScreen = AppScreen.Traffic,
        transitionDirection = ScreenTransitionDirection.Forward,
        // 换设备时不能把上一台的日历留在屏幕上，否则标题与数字对不上（交）
        trafficCalendar = if (switchingDevice) cachedTraffic else it.trafficCalendar,
        metrics = if (switchingDevice) deviceMetricsCache[deviceId] else it.metrics,
        trafficError = if (switchingDevice) null else it.trafficError,
        message = null
      )
    }
    loadMetrics(deviceId, _state.value.selectedWindow, showScreen = false)
    loadTraffic(deviceId, _state.value.trafficMode, showScreen = true)
  }

  fun showDeviceList() {
    navigateBackTo(AppScreen.DeviceList)
  }

  /** 设置是目的地而不是页面内弹层；已在设置页时不重复入栈。 */
  fun showSettings() {
    if (_state.value.currentScreen == AppScreen.Settings) return
    pushCurrentScreen()
    _state.update {
      it.copy(
        currentScreen = AppScreen.Settings,
        transitionDirection = ScreenTransitionDirection.Forward,
        message = null
      )
    }
  }

  /** Snackbar 展示后回收消息，避免同一条提示在返回上一级时重复播报。 */
  fun clearMessage() {
    if (_state.value.message != null) _state.update { it.copy(message = null) }
  }

  fun clearFocusedBlock() {
    _state.update { it.copy(focusedBlock = null) }
  }

  fun handleBack() {
    val current = _state.value
    when {
      current.editingDeviceId != null -> closeMetricConfigEditor()
      current.screenBackStack.isNotEmpty() -> {
        val previous = current.screenBackStack.last()
        _state.update {
          it.copy(
            currentScreen = previous,
            screenBackStack = it.screenBackStack.dropLast(1),
            transitionDirection = ScreenTransitionDirection.Backward,
            message = null
          )
        }
      }
      current.currentScreen != AppScreen.DeviceList && current.currentScreen != AppScreen.Login -> {
        _state.update {
          it.copy(
            currentScreen = AppScreen.DeviceList,
            transitionDirection = ScreenTransitionDirection.Backward,
            message = null
          )
        }
      }
    }
  }

  fun openDeviceEditor(deviceId: String) {
    openMetricConfig(deviceId, showMessage = false)
  }

  fun openBlockEditor(deviceId: String, blockKey: DeviceBlockKey) {
    openMetricConfig(deviceId, blockKey = blockKey, showMessage = false)
  }

  fun openInstanceEditor(deviceId: String, blockKey: DeviceBlockKey, instanceId: String) {
    openMetricConfig(deviceId, blockKey = blockKey, instanceId = instanceId, showMessage = false)
  }

  fun closeMetricConfigEditor() {
    _state.update {
      it.copy(
        editingDeviceId = null,
        editingBlockKey = null,
        editingInstanceId = null
      )
    }
  }

  fun toggleMetric(metricKey: String) {
    _state.update { current ->
      val enabled = current.metricConfigDraft.toMutableSet()
      if (!enabled.add(metricKey)) enabled.remove(metricKey)
      current.copy(metricConfigDraft = enabled.toList())
    }
  }

  fun toggleBlock(blockKey: DeviceBlockKey) {
    _state.update { current ->
      val enabled = current.metricConfigDraft.toMutableSet()
      val metrics = blockMetrics[blockKey].orEmpty()
      val fullyEnabled = metrics.all(enabled::contains)
      metrics.forEach { key ->
        if (fullyEnabled) enabled.remove(key) else enabled.add(key)
      }
      current.copy(metricConfigDraft = enabled.toList())
    }
  }

  fun toggleDeviceInstance(blockKey: DeviceBlockKey, instanceId: String) {
    _state.update { current ->
      val next = current.enabledDeviceIdsDraft.toMutableMap()
      val enabled = (next[blockKey.value] ?: getBlockInstanceIds(current.metrics, blockKey)).toMutableSet()
      if (!enabled.add(instanceId)) enabled.remove(instanceId)
      next[blockKey.value] = enabled.toList()
      current.copy(enabledDeviceIdsDraft = next)
    }
  }

  fun toggleInstanceMetric(instanceId: String, metricKey: String) {
    _state.update { current ->
      val next = current.instanceMetricConfigDraft.toMutableMap()
      val defaults = current.editingBlockKey?.let { blockMetrics[it] }.orEmpty()
      val enabled = (next[instanceId] ?: defaults).toMutableSet()
      if (!enabled.add(metricKey)) enabled.remove(metricKey)
      next[instanceId] = enabled.toList()
      current.copy(instanceMetricConfigDraft = next)
    }
  }

  fun saveMetricConfig() {
    val editingDeviceId = _state.value.editingDeviceId ?: return
    val currentApi = api ?: return
    viewModelScope.launch {
      _state.update { it.copy(savingMetricConfig = true, message = null) }
      runCatching {
        executeWithAuthRetry {
          it.saveMetricConfig(
            editingDeviceId,
            DeviceMetricConfigPayloadDto(
              enabledMetrics = _state.value.metricConfigDraft,
              enabledDeviceIds = _state.value.enabledDeviceIdsDraft,
              instanceMetricConfig = _state.value.instanceMetricConfigDraft
            )
          )
        }
      }.onSuccess { saved ->
        _state.update {
          it.copy(
            metricConfig = saved,
            metricConfigDraft = saved.enabledMetrics,
            enabledDeviceIdsDraft = saved.enabledDeviceIds,
            instanceMetricConfigDraft = saved.instanceMetricConfig,
            editingDeviceId = null,
            editingBlockKey = null,
            editingInstanceId = null,
            savingMetricConfig = false,
            message = "记录项已保存"
          )
        }
        if (_state.value.selectedDeviceId == editingDeviceId) {
          loadMetrics(editingDeviceId, _state.value.selectedWindow, showScreen = false)
        }
      }.onFailure { error ->
        _state.update {
          it.copy(
            savingMetricConfig = false,
            message = userFacingError(error, "记录项保存失败")
          )
        }
      }
    }
  }

  fun selectWindow(window: MetricWindow) {
    _state.update { it.copy(selectedWindow = window) }
    _state.value.selectedDeviceId?.let { loadMetrics(it, window, showScreen = false) }
  }

  /** 首页趋势范围与设备页粒度互不影响。 */
  fun selectOverviewWindow(window: MetricWindow) {
    if (_state.value.overviewWindow == window) return
    _state.update { it.copy(overviewWindow = window) }
    loadOverviewMetrics(window)
  }

  /** 关注页是一级目的地：进入时顺手刷新一次各设备指标，规则才看得到最新温度与硬盘健康。 */
  fun showAttention() {
    if (_state.value.currentScreen == AppScreen.Attention) return
    pushCurrentScreen()
    _state.update {
      it.copy(
        currentScreen = AppScreen.Attention,
        transitionDirection = ScreenTransitionDirection.Forward,
        message = null
      )
    }
    loadAttentionMetrics()
  }

  fun selectTrafficMode(mode: TrafficCalendarMode) {
    trafficSelectedStart = null
    trafficAnchor = todayAnchor()
    _state.update { it.copy(trafficMode = mode) }
    _state.value.selectedDeviceId?.let { loadTraffic(it, mode, showScreen = false) }
  }

  fun selectTrafficCell(rangeStart: String) {
    trafficSelectedStart = rangeStart
    _state.value.selectedDeviceId?.let { loadTraffic(it, _state.value.trafficMode, showScreen = false) }
  }

  fun shiftTrafficAnchor(direction: Int) {
    trafficAnchor = shiftAnchor(trafficAnchor, _state.value.trafficMode, direction)
    _state.value.selectedDeviceId?.let { loadTraffic(it, _state.value.trafficMode, showScreen = false) }
  }

  fun refresh() {
    viewModelScope.launch { refreshOnce(showIndicator = true) }
  }

  private suspend fun <T> executeWithAuthRetry(block: suspend (DeviceStateApi) -> T): T {
    val currentApi = api ?: throw IllegalStateException("api_not_configured")
    return try {
      block(currentApi)
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      val isUnauthorized = (error as? HttpException)?.code() == 401
      val accessKey = _state.value.serverConfig.accessKey
      if (isUnauthorized && accessKey.isNotBlank()) {
        try {
          currentApi.login(LoginRequestDto(accessKey))
          block(currentApi)
        } catch (retryError: Throwable) {
          if (retryError is CancellationException) throw retryError
          throw retryError
        }
      } else {
        throw error
      }
    }
  }

  private suspend fun refreshOnce(showIndicator: Boolean) = refreshMutex.withLock {
    val currentApi = api ?: return@withLock
    if (showIndicator) {
      _state.update { it.copy(refreshing = true, message = null) }
    }
    try {
      val devices = executeWithAuthRetry { it.devices() }
      val window = _state.value.selectedWindow
      val overviewWindow = _state.value.overviewWindow
      val overview = try {
        executeWithAuthRetry { it.overviewMetrics(overviewWindow.value) }
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        null
      }
      val visibleDevices = devices
        .sortedWith(compareBy<DeviceSummaryDto> { it.sortOrder ?: Int.MAX_VALUE }.thenBy { it.hostname })
      val selectedDeviceId = _state.value.selectedDeviceId?.takeIf { id -> visibleDevices.any { it.deviceId == id } }
        ?: visibleDevices.firstOrNull()?.deviceId
      val savedAt = Instant.now().toString()
      _state.update {
        it.copy(
          dataSource = RemoteDataSource.Live,
          cacheSavedAt = savedAt,
          devices = devices,
          selectedDeviceId = selectedDeviceId,
          overviewMetrics = overview ?: it.overviewMetrics.takeIf { cached -> cached?.window == overviewWindow.value },
          refreshing = false,
          message = null
        )
      }
      persistRemoteSnapshot()
      if (showIndicator) loadAttentionMetrics()
      val screen = _state.value.currentScreen
      if (selectedDeviceId != null) {
        // 后台轮询走静默路径：数据到了直接换，不让页面进加载态；手动刷新才给可见反馈（交）
        if (screen == AppScreen.DeviceDetail) {
          loadMetrics(selectedDeviceId, window, showScreen = false, silent = !showIndicator)
        }
        if (screen == AppScreen.Traffic) {
          loadTraffic(selectedDeviceId, _state.value.trafficMode, showScreen = false, silent = !showIndicator)
        }
      }
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      _state.update {
        it.copy(
          dataSource = if (it.devices.isEmpty()) RemoteDataSource.Empty else RemoteDataSource.Cache,
          refreshing = false,
          // 后台轮询失败不反复弹提示（页面上的离线缓存通知已经说明状态）；手动刷新才播报（交）
          message = if (showIndicator) userFacingError(error, "刷新失败，请检查中枢连接") else it.message
        )
      }
    }
  }

  fun deleteDevice(deviceId: String) {
    viewModelScope.launch {
      runCatching { executeWithAuthRetry { it.deleteDevice(deviceId) } }
        .onSuccess {
          refresh()
        }
        .onFailure { error ->
          _state.update { it.copy(message = userFacingError(error, "删除失败，请稍后重试")) }
        }
    }
  }

  fun reorderDevices(deviceIds: List<String>) {
    viewModelScope.launch {
      runCatching { executeWithAuthRetry { it.reorderDevices(DeviceReorderPayloadDto(deviceIds)) } }
        .onSuccess {
          refresh()
        }
        .onFailure { error ->
          _state.update { it.copy(message = userFacingError(error, "设备顺序保存失败，请稍后重试")) }
        }
    }
  }

  private fun loadMetrics(deviceId: String, window: MetricWindow, showScreen: Boolean, silent: Boolean = false) {
    metricsLoadJob?.cancel()
    metricsLoadJob = viewModelScope.launch {
      // 静默路径（15 秒自动轮询）不进入可见加载态：页面不灰化、不挡交互（交）
      if (!silent) {
        _state.update { it.copy(loadingMetrics = true, message = null, metricsError = null) }
      }
      try {
        val metrics = executeWithAuthRetry { it.metrics(deviceId, window.value) }
        // 记入按设备缓存：离线浏览这台设备时仍能展示最近一次成功的数据（交）
        deviceMetricsCache[deviceId] = metrics
        _state.update { it.copy(attentionMetrics = it.attentionMetrics + (deviceId to metrics)) }
        val isCurrentRequest = _state.value.selectedDeviceId == deviceId && _state.value.selectedWindow == window
        if (isCurrentRequest) {
          _state.update {
            it.copy(
              loadingMetrics = false,
              dataSource = RemoteDataSource.Live,
              metrics = metrics,
              currentScreen = if (showScreen) AppScreen.DeviceDetail else it.currentScreen,
              metricsError = null,
              message = null
            )
          }
          persistRemoteSnapshot()
        }
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        if (_state.value.selectedDeviceId == deviceId && _state.value.selectedWindow == window) {
          val reason = userFacingError(error, "读取指标失败，请稍后重试")
          // 失败原因要留在页面上（而不是只闪一条 3 秒的消息条），否则页面会停在骨架屏上
          // 让人以为还在加载（交：错误态必须带重试出口）。有缓存就展示缓存，只在
          // 没有缓存时才把错误态铺满页面，否则离线换设备会退回骨架屏。
          val cached = deviceMetricsCache[deviceId]
          _state.update {
            it.copy(
              loadingMetrics = false,
              metrics = it.metrics ?: cached,
              metricsError = if (it.metrics != null || cached != null) null else reason,
              // 静默刷新失败不弹提示：页面上的离线缓存通知已经说明了状态（交）
              message = if (silent) it.message else reason
            )
          }
        }
      }
    }
  }

  private fun loadTraffic(deviceId: String, mode: TrafficCalendarMode, showScreen: Boolean, silent: Boolean = false) {
    val requestedAnchor = trafficAnchor
    val requestedSelectedStart = trafficSelectedStart
    trafficLoadJob?.cancel()
    trafficLoadJob = viewModelScope.launch {
      // 静默路径（15 秒自动轮询）不进入可见加载态（交）
      if (!silent) {
        _state.update { it.copy(loadingTraffic = true, message = null, trafficError = null) }
      }
      try {
        val traffic = executeWithAuthRetry { it.trafficCalendar(deviceId, mode.value, requestedAnchor, requestedSelectedStart) }
        // 记入按设备缓存：离线浏览这台设备时仍能展示最近一次成功的数据（交）
        deviceTrafficCache[deviceId] = traffic
        val isCurrentRequest =
          _state.value.selectedDeviceId == deviceId &&
            _state.value.trafficMode == mode &&
            trafficAnchor == requestedAnchor &&
            trafficSelectedStart == requestedSelectedStart
        if (isCurrentRequest) {
          trafficSelectedStart = traffic.cells.find { it.isSelected }?.rangeStart
          _state.update {
            it.copy(
              loadingTraffic = false,
              dataSource = RemoteDataSource.Live,
              trafficCalendar = traffic,
              currentScreen = if (showScreen) AppScreen.Traffic else it.currentScreen,
              trafficError = null,
              message = null
            )
          }
          persistRemoteSnapshot()
        }
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        if (_state.value.selectedDeviceId == deviceId && _state.value.trafficMode == mode) {
          val reason = userFacingError(error, "读取流量失败，请稍后重试")
          // 与指标同理：有缓存就展示缓存，只在没有缓存时才把错误态铺满页面（交）
          val cached = deviceTrafficCache[deviceId]
          _state.update {
            it.copy(
              loadingTraffic = false,
              trafficCalendar = it.trafficCalendar ?: cached,
              trafficError = if (it.trafficCalendar != null || cached != null) null else reason,
              // 静默刷新失败不弹提示：页面上的离线缓存通知已经说明了状态（交）
              message = if (silent) it.message else reason
            )
          }
        }
      }
    }
  }

  private fun loadOverviewMetrics(window: MetricWindow) {
    overviewLoadJob?.cancel()
    overviewLoadJob = viewModelScope.launch {
      try {
        val overview = executeWithAuthRetry { it.overviewMetrics(window.value) }
        if (_state.value.overviewWindow == window) {
          _state.update {
            it.copy(
              dataSource = RemoteDataSource.Live,
              overviewMetrics = overview,
              message = null
            )
          }
          persistRemoteSnapshot()
        }
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
      }
    }
  }

  /**
   * 关注规则需要每台在线设备的指标快照。并发读取、单台失败不影响其它设备；
   * 失败的设备保留上一次的快照，规则宁可用稍旧的数据也不凭空清零。
   */
  private fun loadAttentionMetrics() {
    if (attentionLoadJob?.isActive == true) return
    val online = _state.value.devices.filter { it.status == "online" }.map { it.deviceId }
    if (online.isEmpty()) return
    attentionLoadJob = viewModelScope.launch {
      val results = kotlinx.coroutines.coroutineScope {
        online.map { deviceId ->
          async {
            try {
              deviceId to executeWithAuthRetry { it.metrics(deviceId, MetricWindow.FiveMinutes.value) }
            } catch (error: Throwable) {
              if (error is CancellationException) throw error
              null
            }
          }
        }.awaitAll().filterNotNull()
      }
      if (results.isEmpty()) return@launch
      _state.update { current ->
        val alive = current.devices.map { it.deviceId }.toSet()
        current.copy(
          attentionMetrics = (current.attentionMetrics + results).filterKeys { it in alive },
          attentionCheckedAt = Instant.now().toString()
        )
      }
    }
  }

  private fun openMetricConfig(
    deviceId: String,
    blockKey: DeviceBlockKey? = null,
    instanceId: String? = null,
    showMessage: Boolean
  ) {
    viewModelScope.launch {
      runCatching { executeWithAuthRetry { it.metricConfig(deviceId) } }
        .onSuccess { config ->
          _state.update {
            it.copy(
              metricConfig = config,
              metricConfigDraft = config.enabledMetrics,
              enabledDeviceIdsDraft = config.enabledDeviceIds,
              instanceMetricConfigDraft = config.instanceMetricConfig,
              editingDeviceId = deviceId,
              editingBlockKey = blockKey,
              editingInstanceId = instanceId,
              message = if (showMessage) null else it.message
            )
          }
        }
        .onFailure { error ->
          _state.update { it.copy(message = userFacingError(error, "读取记录项配置失败，请稍后重试")) }
        }
    }
  }

  private fun startRefreshLoop() {
    if (!appInForeground || !_state.value.authenticated || refreshLoopJob?.isActive == true) return
    refreshLoopJob = viewModelScope.launch {
      while (isActive) {
        delay(AUTO_REFRESH_INTERVAL_MS)
        if (appInForeground && _state.value.authenticated) {
          refreshOnce(showIndicator = false)
          refreshTicks += 1
          // 15 秒一轮摘要；各设备指标每 4 轮（约 1 分钟）一次，关注页打开时也是这个节奏
          if (refreshTicks % ATTENTION_REFRESH_TICKS == 0) loadAttentionMetrics()
        }
      }
    }
  }

  private fun stopRemoteActivity(clearCache: Boolean) {
    refreshLoopJob?.cancel()
    refreshLoopJob = null
    metricsLoadJob?.cancel()
    metricsLoadJob = null
    trafficLoadJob?.cancel()
    trafficLoadJob = null
    overviewLoadJob?.cancel()
    overviewLoadJob = null
    attentionLoadJob?.cancel()
    attentionLoadJob = null
    liveJob?.cancel()
    liveJob = null
    _state.update {
      it.copy(
        refreshing = false,
        loadingMetrics = false,
        loadingTraffic = false
      )
    }
    if (clearCache) {
      cacheWriteJob?.cancel()
      cacheWriteJob = viewModelScope.launch { remoteSnapshotCache.clear() }
    }
  }

  private fun applyCachedSnapshot(cached: CachedRemoteSnapshot) {
    _state.update { current ->
      if (current.authenticated || current.dataSource == RemoteDataSource.Live) {
        current
      } else {
        trafficAnchor = cached.trafficCalendar?.anchor ?: todayAnchor()
        trafficSelectedStart = cached.trafficCalendar?.cells?.firstOrNull { it.isSelected }?.rangeStart
        deviceMetricsCache.clear()
        deviceMetricsCache.putAll(cached.deviceMetrics)
        deviceTrafficCache.clear()
        deviceTrafficCache.putAll(cached.deviceTraffic)
        current.copy(
          dataSource = RemoteDataSource.Cache,
          cacheSavedAt = cached.savedAt,
          devices = cached.devices,
          selectedDeviceId = cached.selectedDeviceId?.takeIf { id -> cached.devices.any { it.deviceId == id } }
            ?: cached.devices.firstOrNull()?.deviceId,
          selectedWindow = metricWindowFor(cached.selectedWindow),
          metrics = cached.metrics,
          overviewMetrics = cached.overviewMetrics,
          attentionMetrics = cached.deviceMetrics,
          trafficCalendar = cached.trafficCalendar,
          trafficMode = trafficModeFor(cached.trafficCalendar?.mode),
          currentScreen = if (current.currentScreen == AppScreen.Login && cached.devices.isNotEmpty()) AppScreen.DeviceList else current.currentScreen
        )
      }
    }
  }

  private fun persistRemoteSnapshot() {
    val current = _state.value
    if (current.dataSource != RemoteDataSource.Live || current.devices.isEmpty()) return
    val savedAt = current.cacheSavedAt ?: Instant.now().toString()
    cacheWriteJob?.cancel()
    cacheWriteJob = viewModelScope.launch {
      remoteSnapshotCache.write(
        CachedRemoteSnapshot(
          savedAt = savedAt,
          devices = _state.value.devices,
          selectedDeviceId = _state.value.selectedDeviceId,
          selectedWindow = _state.value.selectedWindow.value,
          metrics = _state.value.metrics,
          overviewMetrics = _state.value.overviewMetrics,
          trafficCalendar = _state.value.trafficCalendar,
          deviceMetrics = deviceMetricsCache.toMap(),
          deviceTraffic = deviceTrafficCache.toMap()
        )
      )
    }
  }

  private fun pushCurrentScreen() {
    _state.update { current ->
      if (current.screenBackStack.lastOrNull() == current.currentScreen) {
        current
      } else {
        current.copy(screenBackStack = current.screenBackStack + current.currentScreen)
      }
    }
  }

  private fun navigateBackTo(screen: AppScreen) {
    val current = _state.value
    if (current.currentScreen == screen) return
    val targetIndex = current.screenBackStack.indexOfLast { it == screen }
    val remainingStack = if (targetIndex >= 0) {
      current.screenBackStack.take(targetIndex)
    } else {
      emptyList()
    }
    _state.update {
      it.copy(
        currentScreen = screen,
        screenBackStack = remainingStack,
        transitionDirection = ScreenTransitionDirection.Backward,
        message = null
      )
    }
  }

  private fun clearScreenBackStack() {
    _state.update { current ->
      if (current.screenBackStack.isEmpty()) current else current.copy(screenBackStack = emptyList())
    }
  }

  private fun getBlockInstanceIds(metrics: MetricsDto?, blockKey: DeviceBlockKey): List<String> {
    if (metrics == null) return emptyList()
    return when (blockKey) {
      DeviceBlockKey.Cpu -> metrics.latest.cpuPackages.map { it.id }
      DeviceBlockKey.Gpu -> metrics.latest.gpus.map { it.id }
      DeviceBlockKey.Disk -> metrics.latest.disks.map { it.id }
      DeviceBlockKey.Network -> metrics.latest.networkInterfaces.map { it.id }
      DeviceBlockKey.Memory, DeviceBlockKey.Storage, DeviceBlockKey.Temperature, DeviceBlockKey.Fan -> emptyList()
    }
  }

  companion object {
    private const val AUTO_REFRESH_INTERVAL_MS = 15_000L
    private const val ATTENTION_REFRESH_TICKS = 4
    /** 与 Web 端一致：超过 6 秒才回来的结果视为过期，不显示。 */
    private const val LIVE_QUERY_TIMEOUT_MS = 6_000L

    /** 曲线每秒一点；进程与容器表每 2 秒一次，排序变化之间要留出读的时间。 */
    private fun defaultLiveInterval(topic: LiveTopic): Int = if (topic == LiveTopic.Metrics) 1 else 2

    // 「1 分钟」已由设备页的「实时」取代；旧缓存里存的 1m 落到最短的历史粒度
    private fun metricWindowFor(value: String): MetricWindow =
      MetricWindow.fromValue(value)?.takeIf { it != MetricWindow.OneMinute } ?: MetricWindow.FiveMinutes

    private fun trafficModeFor(value: String?): TrafficCalendarMode =
      TrafficCalendarMode.entries.firstOrNull { it.value == value } ?: TrafficCalendarMode.Day

    private fun loginErrorMessage(error: Throwable): String = userFacingError(error, "无法连接到中枢")

    private fun userFacingError(error: Throwable, fallback: String): String {
      return when ((error as? HttpException)?.code()) {
        401, 403 -> "访问密钥无效或已过期，请重新输入"
        404 -> "找不到中枢服务，请检查地址和端口"
        408, 504 -> "中枢响应超时，请检查网络后重试"
        500, 502, 503 -> "中枢暂时不可用，请稍后重试"
        else -> {
          val message = error.message.orEmpty().lowercase()
          when {
            "unknownhost" in message || "unable to resolve" in message -> "找不到中枢地址，请检查网络和域名"
            "timeout" in message || "timed out" in message -> "连接中枢超时，请检查网络后重试"
            "api_not_configured" in message -> "请先填写中枢地址"
            else -> fallback
          }
        }
      }
    }

    val Factory: ViewModelProvider.Factory = object : ViewModelProvider.Factory {
      @Suppress("UNCHECKED_CAST")
      override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
        val application = checkNotNull(extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY])
        return MainViewModel(application) as T
      }
    }

    private fun todayAnchor(): String = Instant.now().toString()

    private fun shiftAnchor(anchor: String, mode: TrafficCalendarMode, direction: Int): String {
      return runCatching {
        val date = ZonedDateTime.parse(anchor)
        when (mode) {
          TrafficCalendarMode.Month -> date.plusMonths(direction.toLong())
          TrafficCalendarMode.Week -> date.plusWeeks(direction.toLong())
          TrafficCalendarMode.Day -> date.plusDays(direction.toLong())
        }.toInstant().toString()
      }.getOrElse {
        todayAnchor()
      }
    }
  }
}

private class LiveQueryException(val code: String) : IllegalStateException(code)
