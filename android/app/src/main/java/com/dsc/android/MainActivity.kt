package com.dsc.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.dsc.android.ui.AppRoot
import com.dsc.android.ui.theme.DeviceStateConsoleTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    setContent {
      val appViewModel: MainViewModel = viewModel(factory = MainViewModel.Factory)
      val state by appViewModel.state.collectAsStateWithLifecycle()

      DeviceStateConsoleTheme {
        AppRoot(
          state = state,
          onSaveServerConfig = appViewModel::saveServerConfig,
          onLogin = appViewModel::login,
          onLogout = appViewModel::logout,
          onSystemBack = appViewModel::handleBack,
          onOpenDevice = appViewModel::openDevice,
          onOpenTraffic = appViewModel::openTraffic,
          onOpenDeviceEditor = appViewModel::openDeviceEditor,
          onShowDeviceList = appViewModel::showDeviceList,
          onSelectWindow = appViewModel::selectWindow,
          onSelectTrafficMode = appViewModel::selectTrafficMode,
          onSelectTrafficCell = appViewModel::selectTrafficCell,
          onShiftTrafficAnchor = appViewModel::shiftTrafficAnchor,
          onOpenBlockEditor = appViewModel::openBlockEditor,
          onOpenInstanceEditor = appViewModel::openInstanceEditor,
          onCloseMetricConfigEditor = appViewModel::closeMetricConfigEditor,
          onToggleMetric = appViewModel::toggleMetric,
          onToggleBlock = appViewModel::toggleBlock,
          onToggleDeviceInstance = appViewModel::toggleDeviceInstance,
          onToggleInstanceMetric = appViewModel::toggleInstanceMetric,
          onSaveMetricConfig = appViewModel::saveMetricConfig,
          onRefresh = appViewModel::refresh
        )
      }
    }
  }
}
