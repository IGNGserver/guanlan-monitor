package com.dsc.android

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import java.time.Instant
import java.time.ZonedDateTime
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import retrofit2.HttpException

class MainViewModel(application: Application) : AndroidViewModel(application) {
  private val settingsRepository = SettingsRepository(application)
  private val apiFactory = ApiFactory()

  private val _state = MutableStateFlow(AppState())
  val state: StateFlow<AppState> = _state.asStateFlow()

  private var api: DeviceStateApi? = null
  private var cookieJar: InMemoryCookieJar? = null
  private var httpClient: OkHttpClient? = null
  private var socket: DeviceRealtimeSocket? = null
  private var socketReconnectJob: Job? = null
  private var trafficAnchor: String = todayAnchor()
  private var trafficSelectedStart: String? = null
  private var lastAutoLoginSignature: String? = null
  private val screenBackStack = mutableListOf<AppScreen>()

  private val blockMetrics = mapOf(
    DeviceBlockKey.Cpu to listOf("cpuUsage", "cpuFrequency", "cpuTemperature"),
    DeviceBlockKey.Gpu to listOf("gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature"),
    DeviceBlockKey.Memory to listOf("memoryUsage", "swapUsage"),
    DeviceBlockKey.Disk to listOf("diskUsage", "diskRead", "diskWrite"),
    DeviceBlockKey.Network to listOf("networkRxRate", "networkTxRate", "networkTraffic"),
    DeviceBlockKey.Fan to emptyList()
  )

  init {
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
          api = null
          cookieJar = null
          httpClient = null
          lastAutoLoginSignature = null
          screenBackStack.clear()
        }
      }
    }
  }

  fun saveServerConfig(baseUrl: String, accessKey: String) {
    viewModelScope.launch {
      _state.update { it.copy(savingConfig = true, message = null) }
      val normalizedBaseUrl = baseUrl.trim()
      if (normalizedBaseUrl.isBlank()) {
        _state.update { it.copy(savingConfig = false, message = "请输入中枢地址") }
        return@launch
      }

      if (runCatching { settingsRepository.save(ServerConfig(baseUrl = normalizedBaseUrl, accessKey = accessKey)) }.isFailure) {
        _state.update { it.copy(savingConfig = false, message = "保存配置失败") }
        return@launch
      }

      if (!configureApiClient(normalizedBaseUrl)) {
        _state.update { it.copy(savingConfig = false) }
        return@launch
      }

      _state.update { it.copy(savingConfig = false, message = "已保存中枢配置") }
      lastAutoLoginSignature = "${normalizedBaseUrl}\n${accessKey}"
      login()
    }
  }

  private fun configureApiClient(baseUrl: String): Boolean {
    return runCatching { apiFactory.create(baseUrl) }
      .onSuccess { created ->
        api = created.first
        cookieJar = created.second
        httpClient = created.third
      }
      .onFailure {
        api = null
        cookieJar = null
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
      socketReconnectJob?.cancel()
      socket?.close()
      settingsRepository.clear()
      screenBackStack.clear()
      api = null
      cookieJar = null
      httpClient = null
      _state.update {
        it.copy(
          serverConfig = ServerConfig(),
          authenticated = false,
          devices = emptyList(),
          selectedDeviceId = null,
          metrics = null,
          trafficCalendar = null,
          metricConfig = null,
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
        val selectedDeviceId = current.selectedDeviceId?.takeIf { id -> devices.any { it.deviceId == id } }
          ?: devices.firstOrNull()?.deviceId
        screenBackStack.clear()
        _state.update {
          it.copy(
            authenticated = true,
            loggingIn = false,
            devices = devices,
            selectedDeviceId = selectedDeviceId,
            currentScreen = AppScreen.DeviceList,
            transitionDirection = ScreenTransitionDirection.None,
            message = null
          )
        }
        selectedDeviceId?.let {
          loadMetrics(it, current.selectedWindow, showScreen = false)
          loadTraffic(it, _state.value.trafficMode, showScreen = false)
        }
        ensureRealtimeSocket()
      }.onFailure { error ->
        screenBackStack.clear()
        _state.update {
          it.copy(
            loggingIn = false,
            authenticated = false,
            currentScreen = AppScreen.Login,
            transitionDirection = ScreenTransitionDirection.None,
            message = loginErrorMessage(error)
          )
        }
      }
    }
  }

  fun openDevice(deviceId: String) {
    pushCurrentScreen()
    _state.update {
      it.copy(
        selectedDeviceId = deviceId,
        currentScreen = AppScreen.DeviceDetail,
        transitionDirection = ScreenTransitionDirection.Forward,
        message = null
      )
    }
    loadMetrics(deviceId, _state.value.selectedWindow, showScreen = true)
  }

  fun openTraffic(deviceId: String) {
    pushCurrentScreen()
    _state.update {
      it.copy(
        selectedDeviceId = deviceId,
        currentScreen = AppScreen.Traffic,
        transitionDirection = ScreenTransitionDirection.Forward,
        message = null
      )
    }
    loadTraffic(deviceId, _state.value.trafficMode, showScreen = true)
  }

  fun showDeviceList() {
    navigateBackTo(AppScreen.DeviceList)
  }

  fun handleBack() {
    val current = _state.value
    when {
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
        currentApi.saveMetricConfig(
          editingDeviceId,
          DeviceMetricConfigPayloadDto(
            enabledMetrics = _state.value.metricConfigDraft,
            enabledDeviceIds = _state.value.enabledDeviceIdsDraft,
            instanceMetricConfig = _state.value.instanceMetricConfigDraft
          )
        )
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
            message = error.message ?: "记录项保存失败"
          )
        }
      }
    }
  }

  fun selectWindow(window: MetricWindow) {
    _state.update { it.copy(selectedWindow = window) }
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
    viewModelScope.launch {
      val currentApi = api ?: return@launch
      _state.update { it.copy(refreshing = true, message = null) }
      runCatching { currentApi.devices() }
        .onSuccess { devices ->
          val selectedDeviceId = _state.value.selectedDeviceId?.takeIf { id -> devices.any { it.deviceId == id } }
            ?: devices.firstOrNull()?.deviceId
          _state.update { it.copy(devices = devices, selectedDeviceId = selectedDeviceId, refreshing = false) }
          val screen = _state.value.currentScreen
          if (selectedDeviceId != null) {
            if (screen == AppScreen.DeviceDetail) loadMetrics(selectedDeviceId, _state.value.selectedWindow, showScreen = false)
            if (screen == AppScreen.Traffic) loadTraffic(selectedDeviceId, _state.value.trafficMode, showScreen = false)
          }
        }
        .onFailure { error ->
          _state.update { it.copy(refreshing = false, message = error.message ?: "刷新失败") }
        }
    }
  }

  private fun loadMetrics(deviceId: String, window: MetricWindow, showScreen: Boolean) {
    val currentApi = api ?: return
    viewModelScope.launch {
      runCatching { currentApi.metrics(deviceId, window.value) }
        .onSuccess { metrics ->
          _state.update {
            it.copy(
              metrics = metrics,
              currentScreen = if (showScreen) AppScreen.DeviceDetail else it.currentScreen,
              message = null
            )
          }
        }
        .onFailure { error ->
          _state.update { it.copy(message = error.message ?: "读取指标失败") }
        }
    }
  }

  private fun loadTraffic(deviceId: String, mode: TrafficCalendarMode, showScreen: Boolean) {
    val currentApi = api ?: return
    viewModelScope.launch {
      runCatching { currentApi.trafficCalendar(deviceId, mode.value, trafficAnchor, trafficSelectedStart) }
        .onSuccess { traffic ->
          trafficSelectedStart = traffic.cells.find { it.isSelected }?.rangeStart
          _state.update {
            it.copy(
              trafficCalendar = traffic,
              currentScreen = if (showScreen) AppScreen.Traffic else it.currentScreen,
              message = null
            )
          }
        }
        .onFailure { error ->
          _state.update { it.copy(message = error.message ?: "读取流量失败") }
        }
    }
  }

  private fun openMetricConfig(
    deviceId: String,
    blockKey: DeviceBlockKey? = null,
    instanceId: String? = null,
    showMessage: Boolean
  ) {
    val currentApi = api ?: return
    viewModelScope.launch {
      runCatching { currentApi.metricConfig(deviceId) }
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
          _state.update { it.copy(message = error.message ?: "读取记录项配置失败") }
        }
    }
  }

  private fun ensureRealtimeSocket() {
    val baseUrl = runCatching { apiFactory.resolveApiBaseUrl(_state.value.serverConfig.baseUrl) }
      .getOrElse {
        _state.update { state -> state.copy(message = "中枢地址格式不正确") }
        return
      }
    val currentCookieJar = cookieJar ?: return
    val currentHttpClient = httpClient ?: return
    if (baseUrl.isBlank() || !_state.value.authenticated) return
    socket?.close()
    runCatching {
      DeviceRealtimeSocket(currentHttpClient, currentCookieJar, baseUrl).also { realtime ->
        realtime.connect(
          onUpdate = { event ->
            _state.update { current ->
              current.copy(
                devices = current.devices.map { device ->
                  if (device.deviceId == event.deviceId) event.summary else device
                }
              )
            }
            val selectedDeviceId = _state.value.selectedDeviceId
            val selectedWindow = _state.value.selectedWindow
            if (selectedDeviceId == event.deviceId && selectedWindow == MetricWindow.OneMinute) {
              loadMetrics(selectedDeviceId, selectedWindow, showScreen = false)
            }
          },
          onFailure = { scheduleRealtimeReconnect() }
        )
      }
    }.onSuccess { createdSocket ->
      socket = createdSocket
    }.onFailure {
      socket = null
      _state.update { state -> state.copy(message = "实时连接初始化失败") }
    }
  }

  private fun scheduleRealtimeReconnect() {
    if (!_state.value.authenticated) return
    socketReconnectJob?.cancel()
    socketReconnectJob = viewModelScope.launch {
      delay(3_000)
      ensureRealtimeSocket()
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
      DeviceBlockKey.Memory, DeviceBlockKey.Fan -> emptyList()
    }
  }

  companion object {
    private fun loginErrorMessage(error: Throwable): String {
      return when ((error as? HttpException)?.code()) {
        401, 403 -> "访问密钥无效"
        else -> "无法连接到中枢"
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
          TrafficCalendarMode.Month -> date.plusYears(direction.toLong())
          TrafficCalendarMode.Day, TrafficCalendarMode.Week -> date.plusMonths(direction.toLong())
        }.toInstant().toString()
      }.getOrElse {
        todayAnchor()
      }
    }
  }
}
