package com.dsc.android

import android.app.ActivityManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.core.graphics.drawable.toBitmap
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.dsc.android.ui.AppRoot
import com.dsc.android.ui.theme.DeviceStateConsoleTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    applyThemedTaskDescription()

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
          onClearFocusedBlock = appViewModel::clearFocusedBlock,
          onOpenTraffic = appViewModel::openTraffic,
          onCloseTrafficSheet = appViewModel::closeTrafficSheet,
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

  /**
   * Desktop/launcher uses the fixed universal @mipmap/ic_launcher.
   * Recents and other task surfaces prefer the light/dark themed asset.
   */
  private fun applyThemedTaskDescription() {
    val label = getString(R.string.app_name)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      setTaskDescription(
        ActivityManager.TaskDescription.Builder()
          .setLabel(label)
          .setIcon(R.mipmap.ic_launcher_themed)
          .build()
      )
      return
    }

    val themedIcon = getDrawable(R.mipmap.ic_launcher_themed)?.toBitmap()
    @Suppress("DEPRECATION")
    setTaskDescription(ActivityManager.TaskDescription(label, themedIcon))
  }
}
