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
import androidx.compose.runtime.LaunchedEffect
import androidx.core.graphics.drawable.toBitmap
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dsc.android.ui.oneui.GuanlanTheme
import com.dsc.android.ui.shell.GuanlanActions
import com.dsc.android.ui.shell.GuanlanApp
import com.dsc.android.widget.WidgetDestination
import com.dsc.android.widget.WidgetIntents

class MainActivity : ComponentActivity() {
  private val appViewModel: MainViewModel by viewModels { MainViewModel.Factory }
  private val loadingPerformance = LoadingPerformance()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (savedInstanceState == null) handleWidgetIntent(intent)
    enableEdgeToEdge()
    applyThemedTaskDescription()

    setContent {
      val state by appViewModel.state.collectAsStateWithLifecycle()

      LaunchedEffect(state.dataSource, state.metrics != null || state.overviewMetrics != null) {
        loadingPerformance.mark(LoadingMilestone.Shell)
        if (state.dataSource == RemoteDataSource.Cache) loadingPerformance.mark(LoadingMilestone.Cache)
        if (state.dataSource == RemoteDataSource.Live) {
          loadingPerformance.mark(LoadingMilestone.Summary)
          if (state.metrics != null || state.overviewMetrics != null) loadingPerformance.mark(LoadingMilestone.Charts)
        }
        if (state.dataSource != RemoteDataSource.Empty) reportFullyDrawn()
      }

      GuanlanApp(
        state = state,
        actions = GuanlanActions(
          onSaveServerConfig = appViewModel::saveServerConfig,
          onLogin = appViewModel::login,
          onLogout = appViewModel::logout,
          onSystemBack = appViewModel::handleBack,
          onOpenDevice = appViewModel::openDevice,
          onDeleteDevice = appViewModel::deleteDevice,
          onReorderDevices = appViewModel::reorderDevices,
          onClearFocusedBlock = appViewModel::clearFocusedBlock,
          onOpenTraffic = appViewModel::openTraffic,
          onOpenDeviceEditor = appViewModel::openDeviceEditor,
          onShowDeviceList = appViewModel::showDeviceList,
          onShowSettings = appViewModel::showSettings,
          onShowAttention = appViewModel::showAttention,
          onSelectOverviewWindow = appViewModel::selectOverviewWindow,
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
          onSetUpdateChannel = appViewModel::setUpdateChannel,
          onCheckUpdate = { appViewModel.checkForUpdate(reportResult = true) },
          onDownloadUpdate = appViewModel::downloadUpdate,
          onLaunchUpdateInstaller = ::launchUpdateInstaller,
          onUpdateInstallerLaunched = appViewModel::clearUpdateInstallerUri,
          onConsumeMessage = appViewModel::clearMessage,
          onStartLive = appViewModel::startLive,
          onStopLive = appViewModel::stopLive,
          onSetLivePaused = appViewModel::setLivePaused,
          onSetLiveInterval = appViewModel::setLiveInterval,
          onResetLiveCredentials = appViewModel::resetLiveCredentials,
          onSetNetworkMode = appViewModel::setNetworkMode,
          onSetTwoPaneActive = appViewModel::setTwoPaneActive
        )
      )
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleWidgetIntent(intent)
  }

  override fun onStart() {
    super.onStart()
    appViewModel.onAppForeground()
  }

  override fun onStop() {
    appViewModel.onAppBackground()
    super.onStop()
  }

  /**
   * 组件点击与普通启动共用 MainActivity；未认证时先记下目的地，登录成功后再跳。
   * 处理完就移除 extras，配置变更重建时不会再次触发同一次跳转。
   */
  private fun handleWidgetIntent(intent: Intent?) {
    if (intent == null) return
    val target = intent.getStringExtra(WidgetIntents.EXTRA_TARGET)
    val deviceId = intent.getStringExtra(WidgetIntents.EXTRA_DEVICE_ID)
    val destination = WidgetDestination.from(target, deviceId) ?: return
    intent.removeExtra(WidgetIntents.EXTRA_TARGET)
    intent.removeExtra(WidgetIntents.EXTRA_DEVICE_ID)
    appViewModel.handleWidgetDestination(destination)
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
