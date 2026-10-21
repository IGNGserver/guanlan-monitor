package com.dsc.android.widget

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class WidgetConfigUiState(
  val devices: List<WidgetDevice> = emptyList(),
  val selectedDeviceId: String? = null,
  val loading: Boolean = true,
  val saving: Boolean = false,
  val error: String? = null
)

class WidgetConfigViewModel(application: Application) : AndroidViewModel(application) {
  private val store = WidgetSnapshotStore(application)
  private val loader = WidgetDataLoader(application)

  private val _state = MutableStateFlow(WidgetConfigUiState())
  val state: StateFlow<WidgetConfigUiState> = _state.asStateFlow()

  init {
    loadDevices()
  }

  fun loadDevices() {
    viewModelScope.launch {
      _state.update { it.copy(loading = true, error = null) }
      val cached = store.read()?.devices.orEmpty()
      if (cached.isNotEmpty()) {
        _state.update { current ->
          current.copy(
            devices = cached,
            selectedDeviceId = current.selectedDeviceId?.takeIf { id -> cached.any { it.id == id } } ?: cached.first().id,
            loading = false
          )
        }
        return@launch
      }
      runCatching { loader.loadDevicesOnly() }
        .onSuccess { devices ->
          if (devices.isNotEmpty()) {
            store.update { snapshot ->
              snapshot.copy(
                devices = devices,
                updatedAt = snapshot.updatedAt.takeIf { it > 0L } ?: System.currentTimeMillis(),
                lastAttemptAt = System.currentTimeMillis(),
                lastError = null
              )
            }
          }
          _state.update {
            it.copy(
              devices = devices,
              selectedDeviceId = it.selectedDeviceId?.takeIf { id -> devices.any { device -> device.id == id } } ?: devices.firstOrNull()?.id,
              loading = false,
              error = null
            )
          }
        }
        .onFailure { error ->
          _state.update {
            it.copy(
              loading = false,
              error = WidgetSnapshotMapper.friendlyError(error)
            )
          }
        }
    }
  }

  fun select(deviceId: String) {
    _state.update { it.copy(selectedDeviceId = deviceId) }
  }

  fun save(appWidgetId: Int, kind: WidgetKind, onSaved: () -> Unit) {
    val deviceId = _state.value.selectedDeviceId ?: return
    if (_state.value.saving) return
    _state.update { it.copy(saving = true, error = null) }
    WidgetPreferences(getApplication()).setDevice(appWidgetId, deviceId)
    viewModelScope.launch {
      runCatching { WidgetUpdater.updateIds(getApplication(), kind, listOf(appWidgetId)) }
      WidgetRefreshScheduler.ensurePeriodic(getApplication())
      WidgetRefreshScheduler.requestImmediate(getApplication(), manual = true)
      _state.update { it.copy(saving = false) }
      onSaved()
    }
  }

  companion object {
    val Factory: ViewModelProvider.Factory = object : ViewModelProvider.Factory {
      @Suppress("UNCHECKED_CAST")
      override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
        val application = checkNotNull(extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY])
        return WidgetConfigViewModel(application) as T
      }
    }
  }
}
