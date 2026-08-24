package com.dsc.android

import android.app.ActivityManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.core.graphics.drawable.toBitmap
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dsc.android.ui.AppRoot
import com.dsc.android.ui.theme.DeviceStateConsoleTheme

class MainActivity : ComponentActivity() {
  private val appViewModel: MainViewModel by viewModels { MainViewModel.Factory }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    applyThemedTaskDescription()

    setContent {
      val state by appViewModel.state.collectAsStateWithLifecycle()

      DeviceStateConsoleTheme {
        AppRoot(
          state = state,
          onSaveServerConfig = appViewModel::saveServerConfig,
          onLogin = appViewModel::login,
          onLogout = appViewModel::logout,
          onSystemBack = appViewModel::handleBack,
          onOpenDevice = appViewModel::openDevice,
          onSelectInstanceType = appViewModel::selectInstanceType,
          onDeleteDevice = appViewModel::deleteDevice,
          onReorderDevices = appViewModel::reorderDevices,
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
          onRefresh = appViewModel::refresh,
          onDownloadUpdate = appViewModel::downloadUpdate,
          onLaunchUpdateInstaller = ::launchUpdateInstaller,
          onUpdateInstallerLaunched = appViewModel::clearUpdateInstallerUri
        )
      }
    }
  }

  override fun onStart() {
    super.onStart()
    appViewModel.onAppForeground()
  }

  override fun onStop() {
    appViewModel.onAppBackground()
    super.onStop()
  }

  private fun launchUpdateInstaller(uriString: String) {
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(Uri.parse(uriString), "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching { startActivity(intent) }
      .onFailure { Toast.makeText(this, "无法打开系统安装器：${it.message}", Toast.LENGTH_LONG).show() }
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
