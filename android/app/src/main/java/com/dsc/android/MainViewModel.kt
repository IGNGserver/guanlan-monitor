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
  private val refreshMutex = Mutex()

  private val _state = MutableStateFlow(AppState())
  val state: StateFlow<AppState> = _state.asStateFlow()

  private var api: DeviceStateApi? = null
  private var httpClient: OkHttpClient? = null
  private var refreshLoopJob: Job? = null
  private var metricsLoadJob: Job? = null
  private var trafficLoadJob: Job? = null
  private var overviewLoadJob: Job? = null
  private var cacheWriteJob: Job? = null
  private var trafficAnchor: String = todayAnchor()
  private var trafficSelectedStart: String? = null
  private var lastAutoLoginSignature: String? = null
  private var appInForeground = false
  private val screenBackStack = mutableListOf<AppScreen>()

  private val blockMetrics = mapOf(
    DeviceBlockKey.Cpu to listOf("cpuUsage", "cpuFrequency", "cpuTemperature"),
    DeviceBlockKey.Gpu to listOf("gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature"),
    DeviceBlockKey.Memory to listOf("memoryUsage", "swapUsage"),
    DeviceBlockKey.Disk to listOf("diskUsage", "diskRead", "diskWrite"),
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
          current.copy(
            serverConfig = config,
            loading = false,
            currentScreen = if (current.authenticated) current.currentScreen else AppScreen.Login
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
          screenBackStack.clear()
        }
      }
    }
  }

  fun onAppForeground() {
    appInForeground = true
    if (_state.value.authenticated) {
      startRefreshLoop()
      refresh()
    }
  }

  fun onAppBackground() {
    appInForeground = false
    stopRemoteActivity(clearCache = false)
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
            message = "移动端请填写服务端地址，例如 http://your-server-host:3100"
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
      screenBackStack.clear()
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
          trafficCalendar = null,
          metricConfig = null,
          loadingMetrics = false,
          loadingTraffic = false,
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
        screenBackStack.clear()
        _state.update {
          it.copy(
            authenticated = true,
            loggingIn = false,
            dataSource = RemoteDataSource.Live,
            cacheSavedAt = Instant.now().toString(),
            devices = devices,
            selectedDeviceId = selectedDeviceId,
            currentScreen = AppScreen.DeviceList,
            transitionDirection = ScreenTransitionDirection.None,
            message = null
          )
        }
        checkForUpdate()
        loadOverviewMetrics(current.selectedWindow)
        selectedDeviceId?.let {
          loadMetrics(it, current.selectedWindow, showScreen = false)
          loadTraffic(it, _state.value.trafficMode, showScreen = false)
        }
        startRefreshLoop()
        persistRemoteSnapshot()
      }.onFailure { error ->
        screenBackStack.clear()
        _state.update {
          it.copy(
            loggingIn = false,
            authenticated = false,
            dataSource = if (it.devices.isEmpty()) RemoteDataSource.Empty else RemoteDataSource.Cache,
            currentScreen = AppScreen.Login,
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

  private fun checkForUpdate() {
    val currentApi = api ?: return
    val config = _state.value.serverConfig
    if (config.baseUrl.isBlank()) return
    viewModelScope.launch {
      val update = runCatching {
        currentApi.updateInfo(
          platform = "android",
          currentVersion = BuildConfig.RELEASE_VERSION,
          currentChannel = BuildConfig.RELEASE_CHANNEL,
          arch = "universal"
        )
      }.getOrNull()
      _state.update { it.copy(updateInfo = update?.takeIf { item -> item.available && !item.assetUrl.isNullOrBlank() }) }
    }
  }

  fun openDevice(deviceId: String, focusBlock: DeviceBlockKey? = null) {
    pushCurrentScreen()
    _state.update {
      it.copy(
        selectedDeviceId = deviceId,
        focusedBlock = focusBlock,
        currentScreen = AppScreen.DeviceDetail,
        transitionDirection = ScreenTransitionDirection.Forward,
        message = null
      )
    }
    loadMetrics(deviceId, _state.value.selectedWindow, showScreen = true)
  }

  /** 流量改为整页：One UI 不把一个需要日历与明细的内容塞进半屏面板。 */
  fun openTraffic(deviceId: String) {
    pushCurrentScreen()
    _state.update {
      it.copy(
        selectedDeviceId = deviceId,
        currentScreen = AppScreen.Traffic,
        transitionDirection = ScreenTransitionDirection.Forward,
        trafficSheetRequested = false,
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
      current.trafficSheetRequested -> _state.update { it.copy(trafficSheetRequested = false) }
      current.editingDeviceId != null -> closeMetricConfigEditor()
      screenBackStack.isNotEmpty() -> {
        val previous = screenBackStack.removeAt(screenBackStack.lastIndex)
        _state.update {
          it.copy(
            currentScreen = previous,
            transitionDirection = ScreenTransitionDirection.Backward,
            message = null
          )
        }
      }
    }
  }

  fun closeTrafficSheet() {
    _state.update { it.copy(trafficSheetRequested = false) }
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
    loadOverviewMetrics(window)
    _state.value.selectedDeviceId?.let { loadMetrics(it, window, showScreen = false) }
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
      val overview = try {
        executeWithAuthRetry { it.overviewMetrics(window.value) }
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
          overviewMetrics = overview,
          refreshing = false,
          message = null
        )
      }
      persistRemoteSnapshot()
      val screen = _state.value.currentScreen
      if (selectedDeviceId != null) {
        if (screen == AppScreen.DeviceDetail) loadMetrics(selectedDeviceId, window, showScreen = false)
        if (screen == AppScreen.Traffic) loadTraffic(selectedDeviceId, _state.value.trafficMode, showScreen = false)
      }
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      _state.update {
        it.copy(
          dataSource = if (it.devices.isEmpty()) RemoteDataSource.Empty else RemoteDataSource.Cache,
          refreshing = false,
          message = userFacingError(error, "刷新失败，请检查中枢连接")
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

  private fun loadMetrics(deviceId: String, window: MetricWindow, showScreen: Boolean) {
    metricsLoadJob?.cancel()
    metricsLoadJob = viewModelScope.launch {
      _state.update { it.copy(loadingMetrics = true, message = null) }
      try {
        val metrics = executeWithAuthRetry { it.metrics(deviceId, window.value) }
        val isCurrentRequest = _state.value.selectedDeviceId == deviceId && _state.value.selectedWindow == window
        if (isCurrentRequest) {
          _state.update {
            it.copy(
              loadingMetrics = false,
              dataSource = RemoteDataSource.Live,
              metrics = metrics,
              currentScreen = if (showScreen) AppScreen.DeviceDetail else it.currentScreen,
              message = null
            )
          }
          persistRemoteSnapshot()
        }
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        if (_state.value.selectedDeviceId == deviceId && _state.value.selectedWindow == window) {
          _state.update { it.copy(loadingMetrics = false, message = userFacingError(error, "读取指标失败，请稍后重试")) }
        }
      }
    }
  }

  private fun loadTraffic(deviceId: String, mode: TrafficCalendarMode, showScreen: Boolean) {
    val requestedAnchor = trafficAnchor
    val requestedSelectedStart = trafficSelectedStart
    trafficLoadJob?.cancel()
    trafficLoadJob = viewModelScope.launch {
      _state.update { it.copy(loadingTraffic = true, message = null) }
      try {
        val traffic = executeWithAuthRetry { it.trafficCalendar(deviceId, mode.value, requestedAnchor, requestedSelectedStart) }
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
              message = null
            )
          }
          persistRemoteSnapshot()
        }
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        if (_state.value.selectedDeviceId == deviceId && _state.value.trafficMode == mode) {
          _state.update { it.copy(loadingTraffic = false, message = userFacingError(error, "读取流量失败，请稍后重试")) }
        }
      }
    }
  }

  private fun loadOverviewMetrics(window: MetricWindow) {
    overviewLoadJob?.cancel()
    overviewLoadJob = viewModelScope.launch {
      try {
        val overview = executeWithAuthRetry { it.overviewMetrics(window.value) }
        if (_state.value.selectedWindow == window) {
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
        current.copy(
          dataSource = RemoteDataSource.Cache,
          cacheSavedAt = cached.savedAt,
          devices = cached.devices,
          selectedDeviceId = cached.selectedDeviceId?.takeIf { id -> cached.devices.any { it.deviceId == id } }
            ?: cached.devices.firstOrNull()?.deviceId,
          selectedWindow = metricWindowFor(cached.selectedWindow),
          metrics = cached.metrics,
          overviewMetrics = cached.overviewMetrics,
          trafficCalendar = cached.trafficCalendar,
          trafficMode = trafficModeFor(cached.trafficCalendar?.mode)
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
          trafficCalendar = _state.value.trafficCalendar
        )
      )
    }
  }

  private fun pushCurrentScreen() {
    val currentScreen = _state.value.currentScreen
    if (screenBackStack.lastOrNull() != currentScreen) {
      screenBackStack += currentScreen
    }
  }

  private fun navigateBackTo(screen: AppScreen) {
    if (_state.value.currentScreen == screen) return
    while (screenBackStack.isNotEmpty()) {
      val previous = screenBackStack.removeAt(screenBackStack.lastIndex)
      if (previous == screen) {
        _state.update {
          it.copy(
            currentScreen = previous,
            transitionDirection = ScreenTransitionDirection.Backward,
            message = null
          )
        }
        return
      }
    }
    _state.update {
      it.copy(
        currentScreen = screen,
        transitionDirection = ScreenTransitionDirection.Backward,
        message = null
      )
    }
  }

  private fun getBlockInstanceIds(metrics: MetricsDto?, blockKey: DeviceBlockKey): List<String> {
    if (metrics == null) return emptyList()
    return when (blockKey) {
      DeviceBlockKey.Cpu -> metrics.latest.cpuPackages.map { it.id }
      DeviceBlockKey.Gpu -> metrics.latest.gpus.map { it.id }
      DeviceBlockKey.Disk -> metrics.latest.disks.map { it.id }
      DeviceBlockKey.Network -> metrics.latest.networkInterfaces.map { it.id }
      DeviceBlockKey.Memory, DeviceBlockKey.Temperature, DeviceBlockKey.Fan -> emptyList()
    }
  }

  companion object {
    private const val AUTO_REFRESH_INTERVAL_MS = 15_000L

    private fun metricWindowFor(value: String): MetricWindow =
      MetricWindow.entries.firstOrNull { it.value == value } ?: MetricWindow.FiveMinutes

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
