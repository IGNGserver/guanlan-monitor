package com.dsc.android.ui.shell

import com.dsc.android.DeviceBlockKey
import com.dsc.android.MetricWindow
import com.dsc.android.TrafficCalendarMode
import androidx.compose.runtime.Immutable

/**
 * 界面对外唯一的动作契约。
 *
 * 旧实现把 28 个回调逐个传给 `AppRoot`，页面之间层层转递；改成不可变的动作集合后，
 * 页面只声明自己用到哪些动作（构），新增一级目的地也不再需要改所有中间层签名。
 */
@Immutable
data class GuanlanActions(
  val onSaveServerConfig: (String, String) -> Unit,
  val onLogin: () -> Unit,
  val onLogout: () -> Unit,
  val onSystemBack: () -> Unit,
  val onOpenDevice: (String, DeviceBlockKey?) -> Unit,
  val onDeleteDevice: (String) -> Unit,
  val onReorderDevices: (List<String>) -> Unit,
  val onClearFocusedBlock: () -> Unit,
  val onOpenTraffic: (String) -> Unit,
  val onCloseTrafficSheet: () -> Unit,
  val onOpenDeviceEditor: (String) -> Unit,
  val onShowDeviceList: () -> Unit,
  val onShowSettings: () -> Unit,
  val onSelectWindow: (MetricWindow) -> Unit,
  val onSelectTrafficMode: (TrafficCalendarMode) -> Unit,
  val onSelectTrafficCell: (String) -> Unit,
  val onShiftTrafficAnchor: (Int) -> Unit,
  val onOpenBlockEditor: (String, DeviceBlockKey) -> Unit,
  val onOpenInstanceEditor: (String, DeviceBlockKey, String) -> Unit,
  val onCloseMetricConfigEditor: () -> Unit,
  val onToggleMetric: (String) -> Unit,
  val onToggleBlock: (DeviceBlockKey) -> Unit,
  val onToggleDeviceInstance: (DeviceBlockKey, String) -> Unit,
  val onToggleInstanceMetric: (String, String) -> Unit,
  val onSaveMetricConfig: () -> Unit,
  val onRefresh: () -> Unit,
  val onDownloadUpdate: () -> Unit,
  val onLaunchUpdateInstaller: (String) -> Unit,
  val onUpdateInstallerLaunched: () -> Unit,
  val onConsumeMessage: () -> Unit
)
