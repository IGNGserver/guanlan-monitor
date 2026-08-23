@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.dsc.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material.icons.rounded.Timeline
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.unit.dp
import com.dsc.android.AppScreen
import com.dsc.android.AppState
import com.dsc.android.ChartWindow
import com.dsc.android.DeviceBlockKey
import com.dsc.android.DeviceSummaryDto
import com.dsc.android.DiskDto
import com.dsc.android.DiskMetricSeriesDto
import com.dsc.android.FanDto
import com.dsc.android.GpuDto
import com.dsc.android.GpuMetricSeriesDto
import com.dsc.android.MetricWindow
import com.dsc.android.MetricsDto
import com.dsc.android.NetworkInterfaceDto
import com.dsc.android.NetworkMetricSeriesDto
import com.dsc.android.parseTimestampMillis
import com.dsc.android.RemoteDataSource
import com.dsc.android.ScreenTransitionDirection
import com.dsc.android.SamplePointDto
import com.dsc.android.TrafficCalendarDto
import com.dsc.android.TrafficCalendarMode
import com.dsc.android.TemperatureMetricSeriesDto
import com.dsc.android.TemperatureSensorDto
import com.dsc.android.resolveChartIndex
import com.dsc.android.splitSamplePointSegments
import kotlin.math.max

@Composable
fun AppRoot(
  state: AppState,
  onSaveServerConfig: (String, String) -> Unit,
  onLogin: () -> Unit,
  onLogout: () -> Unit,
  onSystemBack: () -> Unit,
  onOpenDevice: (String, DeviceBlockKey?) -> Unit,
  onSelectInstanceType: (String) -> Unit,
  onDeleteDevice: (String) -> Unit,
  onReorderDevices: (List<String>) -> Unit,
  onClearFocusedBlock: () -> Unit,
  onOpenTraffic: (String) -> Unit,
  onCloseTrafficSheet: () -> Unit,
  onOpenDeviceEditor: (String) -> Unit,
  onShowDeviceList: () -> Unit,
  onSelectWindow: (MetricWindow) -> Unit,
  onSelectTrafficMode: (TrafficCalendarMode) -> Unit,
  onSelectTrafficCell: (String) -> Unit,
  onShiftTrafficAnchor: (Int) -> Unit,
  onOpenBlockEditor: (String, DeviceBlockKey) -> Unit,
  onOpenInstanceEditor: (String, DeviceBlockKey, String) -> Unit,
  onCloseMetricConfigEditor: () -> Unit,
  onToggleMetric: (String) -> Unit,
  onToggleBlock: (DeviceBlockKey) -> Unit,
  onToggleDeviceInstance: (DeviceBlockKey, String) -> Unit,
  onToggleInstanceMetric: (String, String) -> Unit,
  onSaveMetricConfig: () -> Unit,
  onSaveFanNote: (String, String, String) -> Unit,
  onRefresh: () -> Unit,
  onDownloadUpdate: () -> Unit,
  onLaunchUpdateInstaller: (String) -> Unit,
  onUpdateInstallerLaunched: () -> Unit
) {
  val snackbarHostState = remember { SnackbarHostState() }
  var showLogoutConfirm by remember { mutableStateOf(false) }
  val canHandleBack =
    showLogoutConfirm ||
      state.editingDeviceId != null ||
      (state.authenticated && state.currentScreen != AppScreen.DeviceList)

  LaunchedEffect(state.message) {
    state.message?.let { snackbarHostState.showSnackbar(it) }
  }

  LaunchedEffect(state.updateInstallerUri) {
    state.updateInstallerUri?.let { uri ->
      onLaunchUpdateInstaller(uri)
      onUpdateInstallerLaunched()
    }
  }

  BackHandler(enabled = canHandleBack) {
    if (showLogoutConfirm) {
      showLogoutConfirm = false
    } else {
      onSystemBack()
    }
  }

  Scaffold(
    snackbarHost = { SnackbarHost(snackbarHostState) }
  ) { paddingValues ->
    Box(
      modifier = Modifier
        .fillMaxSize()
        .background(MaterialTheme.colorScheme.surface)
        .padding(paddingValues)
    ) {
      AnimatedContent(
        targetState = when {
          state.loading -> AppScreen.Login
          !state.authenticated && state.serverConfig.baseUrl.isBlank() -> AppScreen.Login
          !state.authenticated || state.currentScreen == AppScreen.DeviceList -> AppScreen.DeviceList
          else -> state.currentScreen
        },
        transitionSpec = { screenTransition(state.transitionDirection) },
        label = "screen_transition"
      ) { screen ->
        when (screen) {
          AppScreen.Login -> {
            if (state.loading) LoadingScreen() else LoginScreen(state, onSaveServerConfig)
          }
          AppScreen.DeviceList -> DeviceListScreen(state, onOpenDevice, onOpenTraffic, onOpenDeviceEditor, onSelectInstanceType, onDeleteDevice, onReorderDevices, onRequestLogout = { showLogoutConfirm = true }, onRefresh = onRefresh, onDownloadUpdate = onDownloadUpdate)
          AppScreen.Traffic -> TrafficScreen(state, onShowDeviceList, onSelectTrafficMode, onSelectTrafficCell, onShiftTrafficAnchor, onRefresh)
          AppScreen.DeviceDetail -> DeviceDetailScreen(state, onShowDeviceList, onSelectWindow, onOpenTraffic, onCloseTrafficSheet, onSelectTrafficCell, onOpenBlockEditor, onOpenInstanceEditor, onSaveFanNote, onRefresh, onClearFocusedBlock)
        }
      }

      if (state.editingDeviceId != null && state.metricConfig != null) {
        MetricConfigDialog(
          state = state,
          onDismiss = onCloseMetricConfigEditor,
          onToggleMetric = onToggleMetric,
          onToggleBlock = onToggleBlock,
          onToggleDeviceInstance = onToggleDeviceInstance,
          onToggleInstanceMetric = onToggleInstanceMetric,
          onSave = onSaveMetricConfig
        )
      }

      if (showLogoutConfirm) {
        AlertDialog(
          onDismissRequest = { showLogoutConfirm = false },
          title = { Text("确认登出") },
          text = { Text("登出后会清空当前中枢配置，需要重新输入中枢服务器信息。") },
          confirmButton = {
            Button(onClick = {
              showLogoutConfirm = false
              onLogout()
            }) {
              Text("登出")
            }
          },
          dismissButton = {
            OutlinedButton(onClick = { showLogoutConfirm = false }) {
              Text("取消")
            }
          }
        )
      }
    }
  }
}

private fun screenTransition(direction: ScreenTransitionDirection): ContentTransform {
  return when (direction) {
    ScreenTransitionDirection.Forward ->
      (slideInHorizontally { it / 3 } + fadeIn()).togetherWith(
        slideOutHorizontally { -it / 3 } + fadeOut()
      )

    ScreenTransitionDirection.Backward ->
      (slideInHorizontally { -it / 3 } + fadeIn()).togetherWith(
        slideOutHorizontally { it / 3 } + fadeOut()
      )

    ScreenTransitionDirection.None ->
      fadeIn().togetherWith(fadeOut())
  }
}

@Composable
private fun LoadingScreen() {
  Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    CircularProgressIndicator()
  }
}

@Composable
private fun LoginScreen(
  state: AppState,
  onSaveServerConfig: (String, String) -> Unit
) {
  val haptic = LocalHapticFeedback.current
  var baseUrl by remember(state.serverConfig.baseUrl) { mutableStateOf(state.serverConfig.baseUrl) }
  var accessKey by remember(state.serverConfig.accessKey) { mutableStateOf(state.serverConfig.accessKey) }

  Column(
    modifier = Modifier
      .fillMaxSize()
      .padding(24.dp),
    verticalArrangement = Arrangement.Center
  ) {
    Text("连接中枢", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(8.dp))
    Text("输入中枢地址和访问密钥后连接，界面自动使用系统 Material 3 动态配色。", color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.height(24.dp))
    OutlinedTextField(
      value = baseUrl,
      onValueChange = { baseUrl = it },
      modifier = Modifier.fillMaxWidth(),
      label = { Text("中枢地址") },
      supportingText = { Text("例如 http://服务器IP:3100 或 https://你的域名") },
      singleLine = true
    )
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
      value = accessKey,
      onValueChange = { accessKey = it },
      modifier = Modifier.fillMaxWidth(),
      label = { Text("访问密钥") },
      visualTransformation = PasswordVisualTransformation(),
      keyboardOptions = KeyboardOptions(
        keyboardType = KeyboardType.Password,
        imeAction = ImeAction.Done
      ),
      singleLine = true
    )
    Spacer(Modifier.height(20.dp))
    Button(onClick = {
      haptic.performHapticFeedback(HapticFeedbackType.LongPress)
      onSaveServerConfig(baseUrl, accessKey)
    }, enabled = !state.savingConfig && !state.loggingIn, modifier = Modifier.fillMaxWidth()) {
      Text(
        when {
          state.savingConfig -> "保存中"
          state.loggingIn -> "连接中"
          else -> "保存并连接"
        }
      )
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeviceListScreen(
  state: AppState,
  onOpenDevice: (String, DeviceBlockKey?) -> Unit,
  onOpenTraffic: (String) -> Unit,
  onOpenDeviceEditor: (String) -> Unit,
  onSelectInstanceType: (String) -> Unit,
  onDeleteDevice: (String) -> Unit,
  onReorderDevices: (List<String>) -> Unit,
  onRequestLogout: () -> Unit,
  onRefresh: () -> Unit,
  onDownloadUpdate: () -> Unit
) {
  val haptic = LocalHapticFeedback.current
  var pendingDeleteDevice by remember(state.instanceType) { mutableStateOf<DeviceSummaryDto?>(null) }
  var editMode by remember(state.instanceType) { mutableStateOf(false) }
  val visibleDevices = state.devices
    .filter { it.instanceType == state.instanceType }
    .sortedWith(compareBy<DeviceSummaryDto> { it.sortOrder ?: Int.MAX_VALUE }.thenBy { it.hostname })
  Scaffold(
    topBar = {
      TopAppBar(
        title = {
          Column {
            Text("设备状态控制台")
            Text("设备列表", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("版本 v${com.dsc.android.BuildConfig.RELEASE_VERSION}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        },
        actions = {
          IconButton(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            editMode = !editMode
            if (!editMode) pendingDeleteDevice = null
          }) {
            if (editMode) {
              Text("完成", style = MaterialTheme.typography.labelLarge)
            } else {
              Icon(Icons.Rounded.Edit, contentDescription = "编辑设备列表")
            }
          }
          IconButton(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onRefresh()
          }) { Icon(Icons.Rounded.Refresh, contentDescription = "刷新") }
          IconButton(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onRequestLogout()
          }) { Icon(Icons.Rounded.Logout, contentDescription = "登出") }
        }
      )
    }
  ) { innerPadding ->
    LazyColumn(
      modifier = Modifier
        .fillMaxSize()
        .padding(innerPadding),
      contentPadding = PaddingValues(16.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      if (!state.authenticated && state.serverConfig.baseUrl.isNotBlank()) {
        item {
          ElevatedCard(
            colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)
          ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
              Text("正在使用已保存配置连接中枢", fontWeight = FontWeight.SemiBold)
              Text(
                state.serverConfig.baseUrl,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer
              )
              if (state.message != null) {
                Text(
                  state.message,
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onSecondaryContainer
                )
              }
            }
          }
        }
      }
      state.updateInfo?.let { update ->
        item {
          ElevatedCard(
            colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
          ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
              Text("发现 Android 更新 v${update.latestVersion ?: ""}", fontWeight = FontWeight.SemiBold)
              Text("点击后下载 APK，并交给系统安装器完成授权。", style = MaterialTheme.typography.bodySmall)
              if (state.updateDownloading) {
                LinearProgressIndicator(
                  progress = { state.updateProgress },
                  modifier = Modifier.fillMaxWidth()
                )
                Text("下载进度 ${(state.updateProgress * 100).toInt()}%", style = MaterialTheme.typography.labelSmall)
              }
              Button(onClick = onDownloadUpdate, enabled = !state.updateDownloading) {
                Text(if (state.updateDownloading) "下载中…" else "下载并安装")
              }
            }
          }
        }
      }
      item(key = "instance-tabs") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          listOf("device" to "普通设备", "virtual_machine" to "虚拟机").forEach { (type, label) ->
            FilterChip(
              selected = state.instanceType == type,
              onClick = {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                onSelectInstanceType(type)
              },
              label = { Text(label) }
            )
          }
        }
      }
      if (state.dataSource == RemoteDataSource.Cache) {
        item(key = "connection-status") {
          ConnectionStatusCard(state = state, onRefresh = onRefresh)
        }
      }
      if (editMode) {
        item(key = "device-list-edit-mode") {
          Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.secondaryContainer
          ) {
            Text(
              "编辑设备列表：可调整顺序或删除设备；完成后点击右上角“完成”。",
              modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSecondaryContainer
            )
          }
        }
      }
      if (visibleDevices.isEmpty()) {
        item(key = "empty-instance-list") {
          InlineLoadingCard(if (state.instanceType == "virtual_machine") "暂未发现虚拟机" else "暂未发现普通设备")
        }
      }
      items(visibleDevices.size, key = { index -> visibleDevices[index].deviceId }) { index ->
        val device = visibleDevices[index]
        DeviceListCard(
          device,
          editMode = editMode,
          onOpenDevice = { onOpenDevice(device.deviceId, null) },
          onOpenBlock = { blockKey -> onOpenDevice(device.deviceId, blockKey) },
          onOpenTraffic = { onOpenTraffic(device.deviceId) },
          onOpenEditor = { onOpenDeviceEditor(device.deviceId) },
          onMove = { direction ->
            if (editMode) {
              val targetIndex = index + direction
              if (targetIndex in visibleDevices.indices) {
                val reordered = visibleDevices.toMutableList()
                val moved = reordered.removeAt(index)
                reordered.add(targetIndex, moved)
                onReorderDevices(reordered.map { it.deviceId })
              }
            }
          },
          canMoveUp = index > 0,
          canMoveDown = index < visibleDevices.lastIndex,
          onRequestDelete = { if (editMode) pendingDeleteDevice = device }
        )
      }
    }
  }
  pendingDeleteDevice?.let { device ->
    AlertDialog(
      onDismissRequest = { pendingDeleteDevice = null },
      title = { Text("删除${if (device.instanceType == "virtual_machine") "虚拟机" else "设备"}实例？") },
      text = { Text("删除后它会从当前列表隐藏；宿主机/Agent下次上报时会自动重新显示。") },
      confirmButton = {
        Button(onClick = {
          pendingDeleteDevice = null
          onDeleteDevice(device.deviceId)
        }) { Text("删除") }
      },
      dismissButton = { OutlinedButton(onClick = { pendingDeleteDevice = null }) { Text("取消") } }
    )
  }
}

@Composable
private fun ConnectionStatusCard(state: AppState, onRefresh: () -> Unit) {
  val cached = state.dataSource == RemoteDataSource.Cache
  ElevatedCard(
    colors = CardDefaults.elevatedCardColors(
      containerColor = if (cached) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh
    )
  ) {
    Row(
      modifier = Modifier.fillMaxWidth().padding(16.dp),
      horizontalArrangement = Arrangement.spacedBy(12.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
          if (cached) "当前显示离线缓存" else "正在自动同步",
          fontWeight = FontWeight.SemiBold
        )
        Text(
          if (cached) {
            "缓存于 ${formatTime(state.cacheSavedAt)}；数据可能已经过期。"
          } else {
            "前台每 15 秒通过 HTTP 同步一次，也可以手动刷新。"
          },
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
      }
      OutlinedButton(onClick = onRefresh, enabled = !state.refreshing) {
        Text(if (state.refreshing) "刷新中" else "重试")
      }
    }
  }
}

@Composable
private fun DeviceListCard(
  device: DeviceSummaryDto,
  editMode: Boolean,
  onOpenDevice: () -> Unit,
  onOpenBlock: (DeviceBlockKey) -> Unit,
  onOpenTraffic: () -> Unit,
  onOpenEditor: () -> Unit,
  onMove: (Int) -> Unit,
  canMoveUp: Boolean,
  canMoveDown: Boolean,
  onRequestDelete: () -> Unit
) {
  val haptic = LocalHapticFeedback.current
  val statusIndicatorModifier =
    if (device.status == "online") {
      Modifier.background(MaterialTheme.colorScheme.primary, CircleShape)
    } else {
      Modifier.border(1.5.dp, MaterialTheme.colorScheme.error, CircleShape)
    }
  ElevatedCard(
    modifier = Modifier.fillMaxWidth().clickable {
      haptic.performHapticFeedback(HapticFeedbackType.LongPress)
      onOpenDevice()
    },
    colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
          modifier = Modifier
            .size(10.dp)
            .then(statusIndicatorModifier)
        )
        Column(modifier = Modifier.weight(1f)) {
          Text(device.hostname, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          Text(device.deviceId, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          if (device.instanceType == "virtual_machine") {
            Text("宿主机：${device.hostName ?: "未知"}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
          }
        }
        Text(if (device.instanceType == "virtual_machine") "VM" else device.os.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (editMode) {
          IconButton(onClick = { onMove(-1) }, enabled = canMoveUp) { Text("↑") }
          IconButton(onClick = { onMove(1) }, enabled = canMoveDown) { Text("↓") }
          IconButton(onClick = onRequestDelete) { Text("×", color = MaterialTheme.colorScheme.error) }
        }
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        StatChip("CPU", formatPercent(device.cpuUsagePercent), onClick = { onOpenBlock(DeviceBlockKey.Cpu) })
        StatChip("GPU", formatPercent(device.gpuUsagePercent), onClick = { onOpenBlock(DeviceBlockKey.Gpu) })
        StatChip("GPU 内存", formatPercent(device.gpuMemoryUsagePercent), onClick = { onOpenBlock(DeviceBlockKey.Gpu) })
        StatChip("内存", formatPercent(device.memoryUsagePercent), onClick = { onOpenBlock(DeviceBlockKey.Memory) })
        StatChip("硬盘", formatPercent(device.diskUsagePercent), onClick = { onOpenBlock(DeviceBlockKey.Disk) })
        StatChip("流量", "查看", onClick = onOpenTraffic)
      }
      OutlinedButton(onClick = {
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        onOpenEditor()
      }, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Rounded.Edit, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text("编辑记录项")
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeviceDetailScreen(
  state: AppState,
  onBack: () -> Unit,
  onSelectWindow: (MetricWindow) -> Unit,
  onOpenTraffic: (String) -> Unit,
  onCloseTrafficSheet: () -> Unit,
  onSelectTrafficCell: (String) -> Unit,
  onOpenBlockEditor: (String, DeviceBlockKey) -> Unit,
  onOpenInstanceEditor: (String, DeviceBlockKey, String) -> Unit,
  onSaveFanNote: (String, String, String) -> Unit,
  onRefresh: () -> Unit,
  onClearFocusedBlock: () -> Unit
) {
  val haptic = LocalHapticFeedback.current
  val metrics = state.metrics ?: return
  var openBlock by remember(metrics.device.deviceId) { mutableStateOf<DeviceBlockKey?>(null) }
  var openTabId by remember(metrics.device.deviceId) { mutableStateOf("total") }

  LaunchedEffect(state.focusedBlock, state.loadingMetrics, metrics.device.deviceId) {
    val blockKey = state.focusedBlock ?: return@LaunchedEffect
    if (state.loadingMetrics) return@LaunchedEffect
    openBlock = blockKey
    openTabId = "total"
    onClearFocusedBlock()
  }

  Scaffold(
    topBar = {
      TopAppBar(
        navigationIcon = {
          IconButton(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onBack()
          }) { Icon(Icons.Rounded.ArrowBack, contentDescription = "返回") }
        },
        title = {
          Column {
            Text(metrics.device.hostname)
            Text(
              if (metrics.device.instanceType == "virtual_machine") {
                "虚拟机 · 宿主机：${metrics.device.hostName ?: "未知"} · ${metrics.status}"
              } else {
                "${metrics.device.os} · ${metrics.device.platform} · ${metrics.status}"
              },
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
          }
        },
        actions = {
          IconButton(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onRefresh()
          }) { Icon(Icons.Rounded.Refresh, contentDescription = "刷新") }
          IconButton(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onOpenTraffic(metrics.device.deviceId)
          }) { Icon(Icons.Rounded.Router, contentDescription = "流量") }
        }
      )
    }
  ) { innerPadding ->
    LazyColumn(
      modifier = Modifier
        .fillMaxSize()
        .padding(innerPadding),
      contentPadding = PaddingValues(16.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
      if (state.dataSource == RemoteDataSource.Cache) {
        item(key = "connection-status") {
          ConnectionStatusCard(state = state, onRefresh = onRefresh)
        }
      }
      item(key = "overview") {
        OverviewCard(
          metrics = metrics,
          selectedWindow = state.selectedWindow,
          onOpenBlock = { blockKey ->
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            openBlock = blockKey
            openTabId = "total"
          },
          onOpenTraffic = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onOpenTraffic(metrics.device.deviceId)
          }
        )
      }
      item(key = "window-strip") {
        WindowStrip(
          selectedWindow = state.selectedWindow,
          loading = state.loadingMetrics,
          onSelectWindow = onSelectWindow
        )
      }
      if (state.loadingMetrics) {
        item(key = "metrics-loading") {
          InlineLoadingCard("正在加载当前粒度数据")
        }
      }
      item(key = "sheet-hint") {
        Surface(
          shape = RoundedCornerShape(20.dp),
          color = MaterialTheme.colorScheme.surfaceContainerLow
        ) {
          Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
          ) {
            Text("总览模式", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
              "点击上方胶囊查看图表详情。1 分钟显示实时值，其余粒度显示区间平均值。",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
          }
        }
      }
    }
  }

  openBlock?.let { blockKey ->
    val tabs = remember(metrics, blockKey) { buildBlockSheetTabs(metrics, blockKey) }
    val tabIds = tabs.map { it.id }
    if (openTabId !in tabIds) {
      openTabId = tabIds.firstOrNull() ?: "total"
    }
    BlockSheet(
      metrics = metrics,
      blockKey = blockKey,
      selectedWindow = state.selectedWindow,
      selectedTabId = openTabId,
      tabs = tabs,
      onSelectTab = { openTabId = it },
      onDismiss = { openBlock = null },
      onEditBlock = { onOpenBlockEditor(metrics.device.deviceId, blockKey) },
      onEditInstance = { instanceId -> onOpenInstanceEditor(metrics.device.deviceId, blockKey, instanceId) },
      onSaveFanNote = onSaveFanNote,
      savingFanNote = state.savingFanNote
    )
  }
  if (state.trafficSheetRequested) {
    ModalBottomSheet(onDismissRequest = onCloseTrafficSheet) {
      LazyColumn(
        modifier = Modifier.fillMaxWidth().fillMaxHeight(0.72f),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
      ) {
        item { Text("流量", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) }
        state.trafficCalendar?.let { traffic ->
          item { TrafficSelectedSummary(traffic) }
          item { TrafficCalendarGrid(traffic, onSelectTrafficCell) }
          item { TrafficStats(traffic) }
          item { TrafficRecords(traffic) }
        } ?: item { InlineLoadingCard("正在读取流量数据") }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TrafficScreen(
  state: AppState,
  onBack: () -> Unit,
  onSelectMode: (TrafficCalendarMode) -> Unit,
  onSelectCell: (String) -> Unit,
  onShiftAnchor: (Int) -> Unit,
  onRefresh: () -> Unit
) {
  val haptic = LocalHapticFeedback.current
  val selectedDevice = state.devices.find { it.deviceId == state.selectedDeviceId }
  val traffic = state.trafficCalendar

  Scaffold(
    topBar = {
      TopAppBar(
        navigationIcon = {
          IconButton(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onBack()
          }) { Icon(Icons.Rounded.ArrowBack, contentDescription = "返回") }
        },
        title = {
          Column {
            Text(selectedDevice?.hostname ?: "流量记录")
            Text("流量日历", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        },
        actions = {
          IconButton(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onRefresh()
          }) { Icon(Icons.Rounded.Refresh, contentDescription = "刷新") }
        }
      )
    }
  ) { innerPadding ->
    LazyColumn(
      modifier = Modifier
        .fillMaxSize()
        .padding(innerPadding),
      contentPadding = PaddingValues(16.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
      if (state.dataSource == RemoteDataSource.Cache) {
        item(key = "connection-status") {
          ConnectionStatusCard(state = state, onRefresh = onRefresh)
        }
      }
      item {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          TrafficCalendarMode.entries.forEach { mode ->
            FilterChip(
              selected = state.trafficMode == mode,
              onClick = {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                onSelectMode(mode)
              },
              enabled = !state.loadingTraffic,
              label = { Text(mode.label) }
            )
          }
        }
      }
      item {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          Button(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onShiftAnchor(-1)
          }, modifier = Modifier.weight(1f)) { Text("上一页") }
          Button(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onShiftAnchor(1)
          }, modifier = Modifier.weight(1f)) { Text("下一页") }
        }
      }
      if (state.loadingTraffic && traffic == null) {
        item { InlineLoadingCard("正在加载流量数据") }
      }
      traffic?.let {
        item { TrafficHeader(it) }
        item { TrafficSelectedSummary(it) }
        item { TrafficCalendarGrid(it, onSelectCell) }
        item { TrafficStats(it) }
        item { TrafficRecords(it) }
      }
    }
  }
}

private data class OverviewCapsuleModel(
  val blockKey: DeviceBlockKey,
  val title: String,
  val subtitle: String,
  val metrics: List<Pair<String, String>>
)

private data class BlockSheetTabModel(
  val id: String,
  val label: String
)

private fun chartWindowFor(metrics: MetricsDto, selectedWindow: MetricWindow): ChartWindow {
  val hasMatchingServerRange = metrics.window == selectedWindow.value
  return ChartWindow.from(
    window = selectedWindow,
    rangeStart = metrics.rangeStart.takeIf { hasMatchingServerRange },
    rangeEnd = metrics.rangeEnd.takeIf { hasMatchingServerRange }
  )
}

@Composable
private fun OverviewCard(metrics: MetricsDto, selectedWindow: MetricWindow, onOpenBlock: (DeviceBlockKey) -> Unit, onOpenTraffic: () -> Unit) {
  val capsules = remember(metrics, selectedWindow) { buildOverviewCapsules(metrics, selectedWindow) }
  ElevatedCard(
    colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(metrics.device.hostname, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
      Text(
        if (metrics.device.instanceType == "virtual_machine") "宿主机：${metrics.device.hostName ?: "未知"} · ${metrics.device.cpuModel ?: "虚拟 CPU"}"
        else metrics.device.cpuModel ?: "--",
        color = MaterialTheme.colorScheme.onSurfaceVariant
      )
      HorizontalDivider()
      Text("上次更新 ${formatTime(metrics.lastSeenAt)}", style = MaterialTheme.typography.bodySmall)
      StatChip("在线状态", if (metrics.status == "online") "在线" else "离线")
      FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        capsules.forEach { capsule ->
          SummaryCapsule(capsule = capsule, onClick = { onOpenBlock(capsule.blockKey) })
        }
        TrafficCapsule(onOpenTraffic)
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BlockSheet(
  metrics: MetricsDto,
  blockKey: DeviceBlockKey,
  selectedWindow: MetricWindow,
  selectedTabId: String,
  tabs: List<BlockSheetTabModel>,
  onSelectTab: (String) -> Unit,
  onDismiss: () -> Unit,
  onEditBlock: () -> Unit,
  onEditInstance: (String) -> Unit,
  onSaveFanNote: (String, String, String) -> Unit,
  savingFanNote: Boolean
) {
  val haptic = LocalHapticFeedback.current
  val chartWindow = remember(metrics, selectedWindow) { chartWindowFor(metrics, selectedWindow) }
  ModalBottomSheet(
    onDismissRequest = onDismiss
  ) {
    LazyColumn(
      modifier = Modifier.fillMaxWidth(),
      contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 32.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
      item("header") {
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically
        ) {
          Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(blockKey.label, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
              if (selectedWindow == MetricWindow.OneMinute) "当前显示实时值" else "当前显示该粒度区间平均值",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
          }
          if (blockKey != DeviceBlockKey.Fan) {
            IconButton(onClick = {
              haptic.performHapticFeedback(HapticFeedbackType.LongPress)
              onEditBlock()
            }) {
              Icon(Icons.Rounded.Edit, contentDescription = "编辑")
            }
          }
        }
      }
      item("tabs") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          tabs.forEach { tab ->
            FilterChip(
              selected = selectedTabId == tab.id,
              onClick = {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                onSelectTab(tab.id)
              },
              label = { Text(tab.label) }
            )
          }
        }
      }
      item("content") {
        val selectedIndex = tabs.indexOfFirst { it.id == selectedTabId }.coerceAtLeast(0)
        AnimatedContent(
          targetState = selectedTabId,
          transitionSpec = {
            val initialIndex = tabs.indexOfFirst { it.id == initialState }.coerceAtLeast(0)
            val targetIndex = tabs.indexOfFirst { it.id == targetState }.coerceAtLeast(0)
            if (targetIndex >= initialIndex) {
              (slideInHorizontally { it / 3 } + fadeIn()).togetherWith(slideOutHorizontally { -it / 3 } + fadeOut())
            } else {
              (slideInHorizontally { -it / 3 } + fadeIn()).togetherWith(slideOutHorizontally { it / 3 } + fadeOut())
            }
          },
          label = "block_sheet_pages"
        ) { tabId ->
          BlockSheetTabContent(
            metrics = metrics,
            blockKey = blockKey,
            tabId = tabId,
            selectedWindow = selectedWindow,
            chartWindow = chartWindow,
            selectedTabIndex = selectedIndex,
            onEditInstance = onEditInstance,
            onSaveFanNote = onSaveFanNote,
            savingFanNote = savingFanNote
          )
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TemperatureSourcesCard(
  deviceId: String,
  sensors: List<TemperatureSensorDto>,
  series: List<TemperatureMetricSeriesDto>,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow
) {
  var showDiagnostics by remember(deviceId) { mutableStateOf(false) }
  var selectedId by remember(deviceId) { mutableStateOf<String?>(null) }
  val chartableSeries = series.filter { showDiagnostics || it.status == "valid" }
  val latestById = sensors.associateBy { it.id }
  val displaySensors = buildList {
    sensors.forEach { sensor ->
      if (showDiagnostics || sensor.status == "valid") add(sensor)
    }
    series
      .filter { it.id !in latestById }
      .filter { showDiagnostics || it.status == "valid" }
      .forEach { sensorSeries ->
        add(
          TemperatureSensorDto(
            id = sensorSeries.id,
            source = sensorSeries.source,
            backend = sensorSeries.backend,
            hardware = sensorSeries.hardware,
            rawName = sensorSeries.rawName,
            displayName = sensorSeries.name,
            role = sensorSeries.role,
            currentC = sensorSeries.currentC.lastOrNull()?.value,
            highC = sensorSeries.highC,
            criticalC = sensorSeries.criticalC,
            emergencyC = sensorSeries.emergencyC,
            status = sensorSeries.status,
            confidence = sensorSeries.confidence
          )
        )
      }
  }
  val selectedSeries = selectedId?.let { id -> chartableSeries.firstOrNull { it.id == id } }

  LaunchedEffect(chartableSeries, selectedId) {
    if (selectedId != null && chartableSeries.none { it.id == selectedId }) {
      selectedId = null
    }
  }

  ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text("温度源", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
          Text(
            "点击温度源打开半屏图表；按传感器原始名称和采集后端展示。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
          )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text("诊断", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Checkbox(checked = showDiagnostics, onCheckedChange = { showDiagnostics = it })
        }
      }

      if (displaySensors.isEmpty()) {
        Text(
          if (sensors.isEmpty() && chartableSeries.isEmpty()) "当前没有独立温度源" else "当前只有无效或诊断温度通道",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
      } else {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          displaySensors.forEach { sensor ->
            val hasChart = chartableSeries.any { it.id == sensor.id }
            Surface(
              modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = hasChart) { selectedId = sensor.id },
              shape = RoundedCornerShape(16.dp),
              color = MaterialTheme.colorScheme.surface
            ) {
              Row(
                Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
              ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                  Text(sensor.displayName ?: sensor.rawName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                  Text(
                    listOfNotNull(
                      temperatureRoleLabel(sensor.role),
                      temperatureSourceLabel(sensor.source),
                      sensor.backend?.takeIf { it.isNotBlank() }
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                  )
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                  Text(temperatureValueLabel(sensor), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                  Text(
                    if (hasChart) "查看图表 · ${temperatureStatusLabel(sensor.status)}" else temperatureStatusLabel(sensor.status),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                  )
                  temperatureLimitsLabel(sensor)?.let { limits ->
                    Text(limits, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  selectedSeries?.let { sensorSeries ->
    ModalBottomSheet(
      onDismissRequest = { selectedId = null }
    ) {
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .fillMaxHeight(0.52f)
          .padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
      ) {
        Text("温度源图表", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text(
          listOfNotNull(
            sensorSeries.name,
            temperatureRoleLabel(sensorSeries.role),
            temperatureSourceLabel(sensorSeries.source)
          ).joinToString(" · "),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        MetricCardGrid(
          cards = listOf(
            MetricCardModel(
              title = sensorSeries.name,
              value = metricPoint(sensorSeries.currentC, selectedWindow, ::formatCelsius),
              points = sensorSeries.currentC,
              valueFormatter = ::formatCelsius
            )
          ),
          chartWindow = chartWindow
        )
      }
    }
  }
}

@Composable
private fun SummaryCapsule(capsule: OverviewCapsuleModel, onClick: () -> Unit) {
  val haptic = LocalHapticFeedback.current
  Surface(
    modifier = Modifier
      .fillMaxWidth()
      .clickable {
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        onClick()
      },
    shape = RoundedCornerShape(24.dp),
    color = MaterialTheme.colorScheme.surface
  ) {
    Column(
      modifier = Modifier.padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(capsule.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(capsule.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        capsule.metrics.forEach { (label, value) ->
          StatChip(label, value)
        }
      }
    }
  }
}

private fun buildOverviewCapsules(metrics: MetricsDto, selectedWindow: MetricWindow): List<OverviewCapsuleModel> {
  return buildList {
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Cpu,
        title = "CPU",
        subtitle = metrics.device.cpuModel ?: "处理器概览",
        metrics = listOf(
          "占用" to metricPoint(metrics.series.cpuUsagePercent, selectedWindow, ::formatPercent),
          "频率" to metricPoint(metrics.series.cpuFrequencyMHz, selectedWindow, ::formatMHz),
          "温度" to metricPoint(cpuTemperaturePoints(metrics), selectedWindow, ::formatCelsius, zeroMeansMissing = true)
        )
      )
    )
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Gpu,
        title = "显卡",
        subtitle = if (metrics.latest.gpus.isEmpty()) "未读取到显卡" else "${metrics.latest.gpus.size} 张显卡 / 适配器",
        metrics = listOf(
          "占用" to metricPoint(metrics.series.gpuUsagePercent, selectedWindow, ::formatPercent),
          "GPU 内存" to formatGpuMemorySummary(metrics.latest.gpus),
          "温度" to metricPoint(gpuTemperaturePoints(metrics), selectedWindow, ::formatCelsius)
        )
      )
    )
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Memory,
        title = "内存",
        subtitle = "物理内存与虚拟内存",
        metrics = listOf(
          "物理" to buildUsage(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes),
          "占用" to metricPoint(metrics.series.memoryUsagePercent, selectedWindow, ::formatPercent),
          "虚拟" to buildUsage(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes)
        )
      )
    )
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Disk,
        title = "硬盘",
        subtitle = "${metrics.latest.disks.size} 个设备 / 分区",
        metrics = listOf(
          "总占用" to buildUsage(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes),
          "读取" to metricPoint(metrics.series.diskReadBytesPerSec, selectedWindow, ::formatSpeed),
          "写入" to metricPoint(metrics.series.diskWriteBytesPerSec, selectedWindow, ::formatSpeed)
        )
      )
    )
    add(
      OverviewCapsuleModel(
        blockKey = DeviceBlockKey.Network,
        title = "网络",
        subtitle = "${metrics.latest.networkInterfaces.size} 个网络接口",
        metrics = listOf(
          "接收" to metricPoint(metrics.series.networkRxBytesPerSec, selectedWindow, ::formatSpeed),
          "发送" to metricPoint(metrics.series.networkTxBytesPerSec, selectedWindow, ::formatSpeed),
          "累计" to formatBytes((metrics.series.trafficRxBytes.lastOrNull()?.value ?: 0.0) + (metrics.series.trafficTxBytes.lastOrNull()?.value ?: 0.0))
        )
      )
    )
    if (metrics.latest.fans.isNotEmpty()) {
      add(
        OverviewCapsuleModel(
          blockKey = DeviceBlockKey.Fan,
          title = "风扇",
          subtitle = "${metrics.latest.fans.size} 个风扇接口",
          metrics = listOf(
            "最高" to "${metrics.latest.fans.maxOf { it.rpm }} RPM",
            "平均" to "${metrics.latest.fans.map { it.rpm }.average().toInt()} RPM",
            "后端" to if (metrics.latest.sensorBackends.any { it.ok }) "可用" else "不可用"
          )
        )
      )
    }
    if (hasTemperatureData(metrics)) {
      val validSensors = metrics.latest.temperatureSensors.filter { it.status == "valid" }
      val auxiliarySources = buildList<Double> {
        cpuLatestTemperature(metrics)?.let { add(it) }
        metrics.latest.gpus.mapNotNull { validTemperature(it.temperatureC) }.forEach { add(it) }
        metrics.latest.disks.mapNotNull { validDiskTemperature(it.temperatureC) }.forEach { add(it) }
      }
      val sourceCount = validSensors.size + auxiliarySources.size
      add(
        OverviewCapsuleModel(
          blockKey = DeviceBlockKey.Temperature,
          title = "温度",
          subtitle = if (sourceCount == 0) "温度源需要诊断" else "$sourceCount 个温度源",
          metrics = listOf(
            "当前" to temperatureOverviewValue(validSensors, metrics),
            "告警" to validSensors.count { it.alarm == true }.toString()
          )
        )
      )
    }
  }
}

private fun hasTemperatureData(metrics: MetricsDto): Boolean =
  metrics.latest.temperatureSensors.isNotEmpty() ||
    metrics.series.temperatureSensors.isNotEmpty() ||
    cpuLatestTemperature(metrics) != null ||
    metrics.latest.gpus.any { validTemperature(it.temperatureC) != null } ||
    metrics.latest.disks.any { validDiskTemperature(it.temperatureC) != null } ||
    cpuTemperaturePoints(metrics).isNotEmpty() ||
    gpuTemperaturePoints(metrics).isNotEmpty() ||
    metrics.series.disks.any { disk -> disk.temperatureC.any { validDiskTemperature(it.value) != null } }

private fun temperatureOverviewValue(sensors: List<TemperatureSensorDto>, metrics: MetricsDto): String {
  val current = sensors.mapNotNull { validTemperature(it.currentC) }.averageOrNull()
    ?: cpuLatestTemperature(metrics)
    ?: metrics.latest.gpus.mapNotNull { validTemperature(it.temperatureC) }.averageOrNull()
    ?: metrics.latest.disks.mapNotNull { validDiskTemperature(it.temperatureC) }.averageOrNull()
  return current?.let(::formatCelsius) ?: "未知"
}

private fun List<Double>.averageOrNull(): Double? = takeIf { isNotEmpty() }?.average()

private fun buildBlockSheetTabs(metrics: MetricsDto, blockKey: DeviceBlockKey): List<BlockSheetTabModel> {
  val tabs = mutableListOf(BlockSheetTabModel("total", "总和"))
  when (blockKey) {
    DeviceBlockKey.Cpu -> metrics.series.cpus.forEach { tabs += BlockSheetTabModel(it.id, it.name) }
    DeviceBlockKey.Gpu -> metrics.latest.gpus.forEach { tabs += BlockSheetTabModel(it.id, it.name) }
    DeviceBlockKey.Memory -> Unit
    DeviceBlockKey.Disk -> metrics.latest.disks.forEach { tabs += BlockSheetTabModel(it.id, it.name) }
    DeviceBlockKey.Network -> metrics.latest.networkInterfaces.forEach { tabs += BlockSheetTabModel(it.id, it.name) }
    DeviceBlockKey.Temperature -> Unit
    DeviceBlockKey.Fan -> metrics.latest.fans.forEach { tabs += BlockSheetTabModel(it.id, it.label) }
  }
  return tabs
}

@Composable
private fun BlockSheetTabContent(
  metrics: MetricsDto,
  blockKey: DeviceBlockKey,
  tabId: String,
  selectedWindow: MetricWindow,
  chartWindow: ChartWindow,
  selectedTabIndex: Int,
  onEditInstance: (String) -> Unit,
  onSaveFanNote: (String, String, String) -> Unit,
  savingFanNote: Boolean
) {
  Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
    when (blockKey) {
      DeviceBlockKey.Cpu -> CpuSheetContent(metrics, tabId, selectedWindow, chartWindow, onEditInstance)
      DeviceBlockKey.Memory -> MemorySheetContent(metrics, selectedWindow, chartWindow)
      DeviceBlockKey.Disk -> DiskSheetContent(metrics, tabId, selectedWindow, chartWindow, onEditInstance)
      DeviceBlockKey.Network -> NetworkSheetContent(metrics, tabId, selectedWindow, chartWindow, onEditInstance)
      DeviceBlockKey.Temperature -> TemperatureSheetContent(metrics, selectedWindow, chartWindow)
      DeviceBlockKey.Gpu -> GpuSheetContent(metrics, tabId, selectedWindow, chartWindow, onEditInstance)
      DeviceBlockKey.Fan -> FanSheetContent(metrics, tabId, chartWindow, onSaveFanNote, savingFanNote)
    }
  }
}

@Composable
private fun CpuSheetContent(metrics: MetricsDto, tabId: String, selectedWindow: MetricWindow, chartWindow: ChartWindow, onEditInstance: (String) -> Unit) {
  if (tabId == "total") {
    val temperaturePoints = cpuTemperaturePoints(metrics)
    if (!isMetricAvailable(metrics, "cpuTemperature")) {
      Text("当前设备未提供 CPU 温度传感器，虚拟机环境下较常见。", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("CPU 占用", metricPoint(metrics.series.cpuUsagePercent, selectedWindow, ::formatPercent), metrics.series.cpuUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("CPU 频率", metricPoint(metrics.series.cpuFrequencyMHz, selectedWindow, ::formatMHz), metrics.series.cpuFrequencyMHz, ::formatMHz),
        MetricCardModel("CPU 温度", metricPoint(temperaturePoints, selectedWindow, ::formatCelsius, zeroMeansMissing = true), temperaturePoints, ::formatCelsius)
      ),
      chartWindow = chartWindow
    )
    MetaGrid(
      listOf(
        "处理器" to (metrics.device.cpuModel ?: "未知"),
        "包数量" to metrics.latest.cpuPackages.size.toString(),
        "L3 缓存" to formatOptionalBytes(metrics.latest.cpuPackages.mapNotNull { it.l3CacheBytes }.takeIf { it.isNotEmpty() }?.sum()),
        "进程" to metrics.latest.system.processCount.toString(),
        "线程" to metrics.latest.system.threadCount.toString(),
        "句柄" to metrics.latest.system.handleCount.toString(),
        "平台" to "${metrics.device.platform} / ${metrics.device.arch}"
      )
    )
    return
  }

  val cpu = metrics.series.cpus.firstOrNull { it.id == tabId } ?: return
  InstanceCard(
    title = cpu.name,
    subtitle = listOfNotNull(cpu.model, cpu.coreCount?.let { "${it} 核" }, cpu.logicalCount?.let { "${it} 线程" }).joinToString(" · "),
    onEdit = { onEditInstance(cpu.id) }
  ) {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("占用", metricPoint(cpu.usagePercent, selectedWindow, ::formatPercent), cpu.usagePercent, ::formatPercent, 100.0),
        MetricCardModel("频率", metricPoint(cpu.frequencyMHz, selectedWindow, ::formatMHz), cpu.frequencyMHz, ::formatMHz),
        MetricCardModel("温度", metricPoint(cpu.temperatureC, selectedWindow, ::formatCelsius, zeroMeansMissing = true), cpu.temperatureC, ::formatCelsius)
      ),
      chartWindow = chartWindow
    )
    MetaGrid(
      listOf(
        "型号" to (cpu.model ?: "未知"),
        "核心 / 线程" to "${cpu.coreCount ?: "--"} / ${cpu.logicalCount ?: "--"}",
        "L3 缓存" to formatOptionalBytes(cpu.l3CacheBytes)
      )
    )
  }
}

@Composable
private fun MemorySheetContent(metrics: MetricsDto, selectedWindow: MetricWindow, chartWindow: ChartWindow) {
  MetricCardGrid(
    cards = listOf(
      MetricCardModel("物理内存", buildUsage(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes), metrics.series.memoryUsagePercent, ::formatPercent, 100.0),
      MetricCardModel("虚拟内存", buildUsage(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes), metrics.series.swapUsagePercent, ::formatPercent, 100.0),
      MetricCardModel("可用内存", formatBytes(metrics.latest.memoryAvailableBytes.toDouble()), metrics.series.memoryAvailableBytes, { value -> formatBytes(value ?: 0.0) }),
      MetricCardModel("缓存内存", formatBytes(metrics.latest.memoryCachedBytes.toDouble()), metrics.series.memoryCachedBytes, { value -> formatBytes(value ?: 0.0) }),
      MetricCardModel("已提交", formatBytes(metrics.latest.memoryCommittedBytes.toDouble()), metrics.series.memoryCommittedBytes, { value -> formatBytes(value ?: 0.0) }),
      MetricCardModel("提交上限", formatOptionalBytes(metrics.latest.memoryCommitLimitBytes), metrics.series.memoryCommitLimitBytes, ::formatOptionalBytes),
      MetricCardModel("已用字节", formatBytes(metrics.latest.memoryUsedBytes.toDouble()), metrics.series.memoryUsedBytes, { value -> formatBytes(value ?: 0.0) }),
      MetricCardModel("Swap 已用", formatBytes(metrics.latest.swapUsedBytes.toDouble()), metrics.series.swapUsedBytes, { value -> formatBytes(value ?: 0.0) }),
      MetricCardModel("进程数", metrics.latest.system.processCount.toString(), metrics.series.systemProcessCount, { value -> value?.toInt()?.toString() ?: "--" }),
      MetricCardModel("线程数", metrics.latest.system.threadCount.toString(), metrics.series.systemThreadCount, { value -> value?.toInt()?.toString() ?: "--" }),
      MetricCardModel("句柄数", metrics.latest.system.handleCount.toString(), metrics.series.systemHandleCount, { value -> value?.toInt()?.toString() ?: "--" })
    ),
    chartWindow = chartWindow
  )
  MetaGrid(
    listOf(
      "物理内存" to buildUsage(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes),
      "虚拟内存" to buildUsage(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes),
      "提交上限" to formatOptionalBytes(metrics.latest.memoryCommitLimitBytes),
      "频率" to (metrics.latest.memorySpeedMHz?.let { formatMHz(it) } ?: "未知"),
      "插槽" to (metrics.latest.memorySlotCount?.toString() ?: "未知"),
      "形态" to (metrics.latest.memoryFormFactor ?: "未知")
    )
  )
}

@Composable
private fun DiskSheetContent(metrics: MetricsDto, tabId: String, selectedWindow: MetricWindow, chartWindow: ChartWindow, onEditInstance: (String) -> Unit) {
  if (tabId == "total") {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("总占用", buildUsage(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes), metrics.series.diskUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("总读取", metricPoint(metrics.series.diskReadBytesPerSec, selectedWindow, ::formatSpeed), metrics.series.diskReadBytesPerSec, ::formatSpeed),
        MetricCardModel("总写入", metricPoint(metrics.series.diskWriteBytesPerSec, selectedWindow, ::formatSpeed), metrics.series.diskWriteBytesPerSec, ::formatSpeed)
      ),
      chartWindow = chartWindow
    )
    MetaGrid(listOf("总容量" to buildUsage(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes)))
    return
  }

  val disk = metrics.latest.disks.firstOrNull { it.id == tabId } ?: return
  val series = metrics.series.disks.firstOrNull { it.id == tabId }
  DiskInstanceCard(disk, series, onEdit = { onEditInstance(disk.id) }, chartWindow = chartWindow)
  MetaGrid(
    buildList {
      add("接口" to (disk.interfaceType ?: "未知"))
      add("温度" to (validDiskTemperature(disk.temperatureC)?.let(::formatCelsius) ?: "未知"))
      add("活动" to (disk.activePercent?.let { formatPercent(it) } ?: "未知"))
      add("响应" to (disk.averageResponseMs?.let { "%.1f ms".format(it) } ?: "未知"))
      disk.healthStatus?.let { add("健康" to formatDiskHealth(it)) }
      disk.healthPercent?.let { add("寿命" to formatPercent(it)) }
      disk.healthReason?.let { add("健康来源" to it) }
      disk.smartAttributes.forEach { attribute ->
        add("SMART ${attribute.id}" to "${attribute.name}: ${attribute.value.toInt()} / 阈值 ${attribute.threshold.toInt()}")
      }
    }
  )
}

@Composable
private fun NetworkSheetContent(metrics: MetricsDto, tabId: String, selectedWindow: MetricWindow, chartWindow: ChartWindow, onEditInstance: (String) -> Unit) {
  if (tabId == "total") {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("总接收", metricPoint(metrics.series.networkRxBytesPerSec, selectedWindow, ::formatSpeed), metrics.series.networkRxBytesPerSec, ::formatSpeed),
        MetricCardModel("总发送", metricPoint(metrics.series.networkTxBytesPerSec, selectedWindow, ::formatSpeed), metrics.series.networkTxBytesPerSec, ::formatSpeed),
        MetricCardModel("累计接收", formatBytes(metrics.series.trafficRxBytes.lastOrNull()?.value ?: 0.0), metrics.series.trafficRxBytes, { value -> formatBytes(value ?: 0.0) }),
        MetricCardModel("累计发送", formatBytes(metrics.series.trafficTxBytes.lastOrNull()?.value ?: 0.0), metrics.series.trafficTxBytes, { value -> formatBytes(value ?: 0.0) })
      ),
      chartWindow = chartWindow
    )
    return
  }

  val nic = metrics.latest.networkInterfaces.firstOrNull { it.id == tabId } ?: return
  val series = metrics.series.networks.firstOrNull { it.id == tabId }
  NetworkInstanceCard(nic, series, onEdit = { onEditInstance(nic.id) }, chartWindow = chartWindow)
  MetaGrid(
    listOfNotNull(
      "IPv4" to nic.ipv4.joinToString(", ").ifBlank { "未知" },
      "IPv6" to nic.ipv6.joinToString(", ").ifBlank { "未知" },
      "链路" to (nic.linkSpeedMbps?.let { "%.0f Mbps".format(it) } ?: "未知"),
      "连接" to (nic.connectionType ?: "未知"),
      "信号" to (nic.signalStrengthPercent?.let { formatPercent(it) } ?: "未知"),
      "累计接收" to formatBytes((nic.totalRxBytes ?: 0L).toDouble()),
      "累计发送" to formatBytes((nic.totalTxBytes ?: 0L).toDouble())
    )
  )
}

@Composable
private fun GpuSheetContent(metrics: MetricsDto, tabId: String, selectedWindow: MetricWindow, chartWindow: ChartWindow, onEditInstance: (String) -> Unit) {
  if (tabId == "total") {
    val temperaturePoints = gpuTemperaturePoints(metrics)
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("总占用", metricPoint(metrics.series.gpuUsagePercent, selectedWindow, ::formatPercent), metrics.series.gpuUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("总 GPU 内存", formatGpuMemorySummary(metrics.latest.gpus), metrics.series.gpuMemoryUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("总温度", metricPoint(temperaturePoints, selectedWindow, ::formatCelsius), temperaturePoints, ::formatCelsius)
      ),
      chartWindow = chartWindow
    )
    MetaGrid(listOf("总 GPU 内存" to formatGpuMemorySummary(metrics.latest.gpus)))
    return
  }

  val gpu = metrics.latest.gpus.firstOrNull { it.id == tabId } ?: return
  val series = metrics.series.gpus.firstOrNull { it.id == tabId }
  GpuInstanceCard(gpu, series, onEdit = { onEditInstance(gpu.id) }, chartWindow = chartWindow)
  MetaGrid(
    listOfNotNull(
      "驱动" to (gpu.driverVersion ?: "未知"),
      "类型" to if (gpu.integrated) "集成显卡" else "独立显卡",
      "显存类型" to gpuMemoryLabel(gpu.memoryKind ?: series?.memoryKind),
      "温度源" to gpuTemperatureSourceLabel(gpu.temperatureSource ?: series?.temperatureSource),
      gpuMemoryLabel(gpu.memoryKind) to buildGpuUsage(gpu.memoryUsedBytes, gpu.memoryTotalBytes)
    )
  )
}

@Composable
private fun TemperatureSheetContent(metrics: MetricsDto, selectedWindow: MetricWindow, chartWindow: ChartWindow) {
  val summaryCards = buildTemperatureSummaryCards(metrics, selectedWindow)
  if (summaryCards.isNotEmpty()) {
    Text("设备温度（按实例）", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    MetricCardGrid(cards = summaryCards, chartWindow = chartWindow)
  }

  if (metrics.latest.temperatureSensors.isNotEmpty() || metrics.series.temperatureSensors.isNotEmpty()) {
    Text("全部温度源", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    TemperatureSourcesCard(
      deviceId = metrics.device.deviceId,
      sensors = metrics.latest.temperatureSensors,
      series = metrics.series.temperatureSensors,
      selectedWindow = selectedWindow,
      chartWindow = chartWindow
    )
  } else {
    Text(
      "当前没有独立温度源；CPU、显卡或硬盘温度仍会在对应类别中显示。",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant
    )
  }
}

private data class DiskTemperatureGroup(
  val key: String,
  val title: String,
  val points: List<SamplePointDto>,
  val latestC: Double?
)

private fun cpuTemperaturePoints(metrics: MetricsDto): List<SamplePointDto> =
  validTemperaturePoints(metrics.series.cpuTemperatureC)
    .ifEmpty { averageTemperaturePointSeries(metrics.series.cpus.map { it.temperatureC }) }
    .ifEmpty { averageTemperaturePointSeries(temperatureSensorPointSeries(metrics, ::isCpuTemperatureSeries)) }

private fun gpuTemperaturePoints(metrics: MetricsDto): List<SamplePointDto> =
  validTemperaturePoints(metrics.series.gpuTemperatureC)
    .ifEmpty { averageTemperaturePointSeries(metrics.series.gpus.map { it.temperatureC }) }
    .ifEmpty { averageTemperaturePointSeries(temperatureSensorPointSeries(metrics, ::isGpuTemperatureSeries)) }

private fun cpuLatestTemperature(metrics: MetricsDto): Double? =
  validTemperature(metrics.latest.cpuTemperatureC)
    ?: metrics.latest.cpuPackages.mapNotNull { validTemperature(it.temperatureC) }.averageOrNull()
    ?: metrics.latest.temperatureSensors.filter(::isCpuTemperatureSensor)
      .mapNotNull { validTemperature(it.currentC) }
      .averageOrNull()

private fun gpuLatestTemperature(metrics: MetricsDto): Double? =
  metrics.latest.gpus.mapNotNull { validTemperature(it.temperatureC) }.averageOrNull()
    ?: metrics.latest.temperatureSensors.filter(::isGpuTemperatureSensor)
      .mapNotNull { validTemperature(it.currentC) }
      .averageOrNull()

private fun temperatureSensorPointSeries(
  metrics: MetricsDto,
  predicate: (TemperatureMetricSeriesDto) -> Boolean
): List<List<SamplePointDto>> =
  metrics.series.temperatureSensors.filter(predicate).map { validTemperaturePoints(it.currentC) }

private fun isCpuTemperatureSensor(sensor: TemperatureSensorDto): Boolean =
  sensor.status == "valid" && isCpuTemperatureRole(sensor.role)

private fun isCpuTemperatureSeries(sensor: TemperatureMetricSeriesDto): Boolean =
  sensor.status == "valid" && isCpuTemperatureRole(sensor.role)

private fun isCpuTemperatureRole(role: String): Boolean = role == "cpu_package" || role == "cpu_core" || role == "peci"

private fun isGpuTemperatureSensor(sensor: TemperatureSensorDto): Boolean =
  sensor.status == "valid" && (
    sensor.role == "gpu_core" ||
      sensor.role == "gpu_hotspot" ||
      (sensor.role == "derived" && (sensor.hardwareType == "gpu" || sensor.source == "cpu-package-shared" || sensor.source == "cpuPackageShared"))
    )

private fun isGpuTemperatureSeries(sensor: TemperatureMetricSeriesDto): Boolean =
  sensor.status == "valid" && (
    sensor.role == "gpu_core" ||
      sensor.role == "gpu_hotspot" ||
      (sensor.role == "derived" && (sensor.source == "cpu-package-shared" || sensor.source == "cpuPackageShared"))
    )

private fun buildTemperatureSummaryCards(metrics: MetricsDto, selectedWindow: MetricWindow): List<MetricCardModel> =
  buildList {
    addAll(buildCpuTemperatureCards(metrics, selectedWindow))
    addAll(buildGpuTemperatureCards(metrics, selectedWindow))
    buildDiskTemperatureGroups(metrics).forEach { disk ->
      add(
        MetricCardModel(
          title = "${disk.title} · 温度",
          value = if (disk.points.isNotEmpty()) metricPoint(disk.points, selectedWindow, ::formatCelsius) else formatCelsius(disk.latestC),
          points = disk.points,
          valueFormatter = ::formatCelsius
        )
      )
    }
  }

private fun buildCpuTemperatureCards(metrics: MetricsDto, selectedWindow: MetricWindow): List<MetricCardModel> {
  val latestById = metrics.latest.cpuPackages.associateBy { it.id }
  val instanceIds = (metrics.series.cpus.map { it.id } + metrics.latest.cpuPackages.map { it.id }).toSet()
  val singleInstanceFallback = if (instanceIds.size == 1) cpuTemperaturePoints(metrics) else emptyList()
  val singleInstanceLatest = if (instanceIds.size == 1) cpuLatestTemperature(metrics) else null
  val cards = buildList {
    val seenIds = mutableSetOf<String>()
    metrics.series.cpus.forEach { cpu ->
      val latest = latestById[cpu.id]
      val points = validTemperaturePoints(cpu.temperatureC).ifEmpty { singleInstanceFallback }
      val temperature = validTemperature(latest?.temperatureC) ?: singleInstanceLatest
      buildTemperatureInstanceCard(
        kind = "CPU",
        name = cpu.name,
        model = cpu.model ?: latest?.model ?: metrics.device.cpuModel,
        points = points,
        latestC = temperature,
        selectedWindow = selectedWindow
      )?.let { card ->
        add(card)
        seenIds += cpu.id
      }
    }
    metrics.latest.cpuPackages.forEach { cpu ->
      if (cpu.id in seenIds) return@forEach
      buildTemperatureInstanceCard(
        kind = "CPU",
        name = cpu.name,
        model = cpu.model ?: metrics.device.cpuModel,
        points = singleInstanceFallback,
        latestC = validTemperature(cpu.temperatureC) ?: singleInstanceLatest,
        selectedWindow = selectedWindow
      )?.let(::add)
    }
  }
  return cards
}

private fun buildGpuTemperatureCards(metrics: MetricsDto, selectedWindow: MetricWindow): List<MetricCardModel> {
  val latestById = metrics.latest.gpus.associateBy { it.id }
  val instanceIds = (metrics.series.gpus.map { it.id } + metrics.latest.gpus.map { it.id }).toSet()
  val singleInstanceFallback = if (instanceIds.size == 1) gpuTemperaturePoints(metrics) else emptyList()
  val singleInstanceLatest = if (instanceIds.size == 1) gpuLatestTemperature(metrics) else null
  val cards = buildList {
    val seenIds = mutableSetOf<String>()
    metrics.series.gpus.forEach { gpu ->
      val latest = latestById[gpu.id]
      val points = validTemperaturePoints(gpu.temperatureC).ifEmpty { singleInstanceFallback }
      val temperature = validTemperature(latest?.temperatureC) ?: singleInstanceLatest
      buildTemperatureInstanceCard(
        kind = "显卡",
        name = gpu.name,
        model = latest?.name,
        points = points,
        latestC = temperature,
        selectedWindow = selectedWindow
      )?.let { card ->
        add(card)
        seenIds += gpu.id
      }
    }
    metrics.latest.gpus.forEach { gpu ->
      if (gpu.id in seenIds) return@forEach
      buildTemperatureInstanceCard(
        kind = "显卡",
        name = gpu.name,
        model = gpu.name,
        points = singleInstanceFallback,
        latestC = validTemperature(gpu.temperatureC) ?: singleInstanceLatest,
        selectedWindow = selectedWindow
      )?.let(::add)
    }
  }
  return cards
}

private fun buildTemperatureInstanceCard(
  kind: String,
  name: String?,
  model: String?,
  points: List<SamplePointDto>,
  latestC: Double?,
  selectedWindow: MetricWindow
): MetricCardModel? {
  if (points.isEmpty() && latestC == null) return null
  return MetricCardModel(
    title = temperatureInstanceTitle(kind, name, model),
    value = if (points.isNotEmpty()) metricPoint(points, selectedWindow, ::formatCelsius) else formatCelsius(latestC),
    points = points,
    valueFormatter = ::formatCelsius
  )
}

private fun temperatureInstanceTitle(kind: String, name: String?, model: String?): String {
  val normalizedModel = model?.trim()?.takeIf { it.isNotEmpty() }
  val normalizedName = name?.trim()?.takeIf { it.isNotEmpty() && !it.equals(normalizedModel, ignoreCase = true) }
  val identity = listOfNotNull(normalizedModel, normalizedName).joinToString(" · ").ifBlank { "未知型号" }
  return "$kind · $identity 温度"
}

private fun averageTemperaturePointSeries(series: List<List<SamplePointDto>>): List<SamplePointDto> {
  val valuesByTimestamp = linkedMapOf<String, MutableList<Double>>()
  series.flatten().forEach { point ->
    validTemperature(point.value)?.let { value ->
      valuesByTimestamp.getOrPut(point.timestamp) { mutableListOf() }.add(value)
    }
  }
  return valuesByTimestamp
    .map { (timestamp, values) -> SamplePointDto(timestamp, values.average()) }
    .sortedBy { parseTimestampMillis(it.timestamp) ?: Long.MIN_VALUE }
}

private fun buildDiskTemperatureGroups(metrics: MetricsDto): List<DiskTemperatureGroup> {
  val seriesByKey = linkedMapOf<String, MutableList<DiskMetricSeriesDto>>()
  metrics.series.disks
    .filter { it.temperatureC.any { point -> validDiskTemperature(point.value) != null } }
    .forEach { disk ->
      seriesByKey.getOrPut(diskTemperatureKey(disk)) { mutableListOf() }.add(disk)
    }
  val latestByKey = metrics.latest.disks
    .filter { validDiskTemperature(it.temperatureC) != null }
    .groupBy(::diskTemperatureKey)

  return (seriesByKey.keys + latestByKey.keys)
    .distinct()
    .mapNotNull { key ->
      val seriesItems = seriesByKey[key].orEmpty()
      val latestItems = latestByKey[key].orEmpty()
      val points = averageTemperaturePointSeries(
        seriesItems.map { disk -> disk.temperatureC.filter { validDiskTemperature(it.value) != null } }
      )
      val latestC = latestItems.mapNotNull { validDiskTemperature(it.temperatureC) }.averageOrNull()
      if (points.isEmpty() && latestC == null) return@mapNotNull null
      val model = seriesItems.mapNotNull { it.model?.takeIf(String::isNotBlank) }.firstOrNull()
        ?: latestItems.mapNotNull { it.model?.takeIf(String::isNotBlank) }.firstOrNull()
      val name = seriesItems.mapNotNull { it.name.takeIf(String::isNotBlank) }.firstOrNull()
        ?: latestItems.mapNotNull { it.name.takeIf(String::isNotBlank) }.firstOrNull()
      DiskTemperatureGroup(
        key = key,
        title = physicalDiskTemperatureTitle(key, model, name),
        points = points,
        latestC = latestC
      )
    }
}

private fun diskTemperatureKey(disk: DiskMetricSeriesDto): String =
  disk.physicalDevice?.trim()?.takeIf { it.isNotEmpty() } ?: disk.id

private fun diskTemperatureKey(disk: DiskDto): String =
  disk.physicalDevice?.trim()?.takeIf { it.isNotEmpty() } ?: disk.id

private fun physicalDiskTemperatureTitle(key: String, model: String?, name: String?): String {
  val physicalLabel = when {
    key.contains("PhysicalDrive", ignoreCase = true) -> "硬盘 ${key.substringAfterLast("PhysicalDrive", key)}"
    key.startsWith("/dev/") -> "硬盘 ${key.substringAfterLast('/')}"
    key.startsWith("sd") || key.startsWith("nvme") || key.startsWith("mmcblk") || key.startsWith("vd") || key.startsWith("xvd") -> "硬盘 $key"
    key.matches(Regex("[a-zA-Z]+[0-9]+")) -> "硬盘 $key"
    else -> null
  }
  return listOfNotNull(model, physicalLabel).joinToString(" · ").ifBlank {
    name?.takeIf { it.isNotBlank() }?.let { "硬盘 · $it" } ?: "硬盘"
  }
}

@Composable
private fun FanSheetContent(
  metrics: MetricsDto,
  tabId: String,
  chartWindow: ChartWindow,
  onSaveFanNote: (String, String, String) -> Unit,
  savingFanNote: Boolean
) {
  if (tabId == "total") {
    if (metrics.latest.sensorBackends.isNotEmpty()) {
      MetaGrid(
        metrics.latest.sensorBackends.map {
          "后端 · ${it.label}" to "${if (it.ok) "可用" else "不可用"}${it.detail?.let { detail -> " · $detail" } ?: ""}"
        }
      )
    }
    MetricCardGrid(
      cards = metrics.latest.fans.mapNotNull { fan ->
        val series = metrics.series.fans.firstOrNull { it.id == fan.id } ?: return@mapNotNull null
        MetricCardModel("风扇转速", "${fan.rpm} RPM", series.rpm, valueFormatter = { value ->
          if (value == null) "--" else "${value.toInt()} RPM"
        })
      },
      chartWindow = chartWindow
    )
    return
  }

  val fan = metrics.latest.fans.firstOrNull { it.id == tabId } ?: return
  val series = metrics.series.fans.firstOrNull { it.id == fan.id }
  var noteDraft by remember(fan.id, fan.note) { mutableStateOf(fan.note.orEmpty()) }
  InstanceCard(
    title = fan.label,
    subtitle = fan.interfaceName ?: fan.interfaceRaw ?: "风扇实例"
  ) {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel(
          title = "风扇转速",
          value = "${fan.rpm} RPM",
          points = series?.rpm.orEmpty(),
          valueFormatter = { value ->
          if (value == null) "--" else "${value.toInt()} RPM"
        })
      ),
      chartWindow = chartWindow
    )
    MetaGrid(listOf("转速" to "${fan.rpm} RPM", "备注" to (fan.note ?: "未备注")))
    MetaGrid(
      listOfNotNull(
        "控制" to (fan.controlMode ?: "未知"),
        "目标温度" to (fan.targetTemperatureC?.let { formatCelsius(it) } ?: "未知"),
        "PWM" to if (fan.minPwmPercent != null || fan.maxPwmPercent != null) "${fan.minPwmPercent ?: "--"}-${fan.maxPwmPercent ?: "--"}%" else "未知",
        "通道" to (fan.channelState ?: "未知")
      )
    )
    OutlinedTextField(
      value = noteDraft,
      onValueChange = { value -> if (value.length <= 100) noteDraft = value },
      modifier = Modifier.fillMaxWidth(),
      label = { Text("风扇备注") },
      placeholder = { Text("例如：前置进风风扇") },
      minLines = 2,
      maxLines = 3
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
      Text("${noteDraft.length}/100", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Button(
        onClick = { onSaveFanNote(metrics.device.deviceId, fan.id, noteDraft) },
        enabled = !savingFanNote
      ) {
        Text(if (savingFanNote) "保存中" else "保存备注")
      }
    }
  }
}

@Composable
private fun CpuSection(metrics: MetricsDto, onEditBlock: () -> Unit, onEditInstance: (String) -> Unit) {
  Section(title = "CPU", onEdit = onEditBlock) {
    if (!isMetricAvailable(metrics, "cpuTemperature")) {
      Text("当前设备未提供 CPU 温度传感器，虚拟机环境下较常见。", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("总占用", formatPercent(metrics.series.cpuUsagePercent.lastOrNull()?.value), metrics.series.cpuUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("频率", formatMHz(metrics.latest.cpuFrequencyMHz), metrics.series.cpuFrequencyMHz, ::formatMHz),
        MetricCardModel("温度", formatCelsius(metrics.latest.cpuTemperatureC), metrics.series.cpuTemperatureC, ::formatCelsius)
      )
    )
    metrics.series.cpus.forEach { cpu ->
      InstanceCard(title = cpu.name, subtitle = listOfNotNull(cpu.model, cpu.coreCount?.let { "核心 $it" }, cpu.logicalCount?.let { "线程 $it" }).joinToString(" · "), onEdit = { onEditInstance(cpu.id) }) {
        MetricCardGrid(
          cards = listOf(
            MetricCardModel("占用", formatPercent(cpu.usagePercent.lastOrNull()?.value), cpu.usagePercent, ::formatPercent, 100.0),
            MetricCardModel("频率", formatMHz(cpu.frequencyMHz.lastOrNull()?.value), cpu.frequencyMHz, ::formatMHz),
            MetricCardModel("温度", formatCelsius(cpu.temperatureC.lastOrNull()?.value), cpu.temperatureC, ::formatCelsius)
          )
        )
      }
    }
  }
}

@Composable
private fun MemorySection(metrics: MetricsDto, onEditBlock: () -> Unit) {
  Section(title = "内存", onEdit = onEditBlock) {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("物理内存", buildUsage(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes), metrics.series.memoryUsagePercent, { value ->
          formatPercent(value)
        }, 100.0),
        MetricCardModel("虚拟内存", buildUsage(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes), metrics.series.swapUsagePercent, { value ->
          formatPercent(value)
        }, 100.0)
      )
    )
  }
}

@Composable
private fun DiskSection(metrics: MetricsDto, onEditBlock: () -> Unit, onEditInstance: (String) -> Unit) {
  Section(title = "硬盘", onEdit = onEditBlock) {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("总占用", buildUsage(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes), metrics.series.diskUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("读取", formatSpeed(metrics.series.diskReadBytesPerSec.lastOrNull()?.value), metrics.series.diskReadBytesPerSec, ::formatSpeed),
        MetricCardModel("写入", formatSpeed(metrics.series.diskWriteBytesPerSec.lastOrNull()?.value), metrics.series.diskWriteBytesPerSec, ::formatSpeed)
      )
    )
    metrics.latest.disks.forEach { disk ->
      val series = metrics.series.disks.find { it.id == disk.id }
      DiskInstanceCard(disk, series, onEdit = { onEditInstance(disk.id) })
    }
  }
}

@Composable
private fun NetworkSection(metrics: MetricsDto, onEditBlock: () -> Unit, onEditInstance: (String) -> Unit) {
  Section(title = "网络", onEdit = onEditBlock) {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("总接收", formatSpeed(metrics.series.networkRxBytesPerSec.lastOrNull()?.value), metrics.series.networkRxBytesPerSec, ::formatSpeed),
        MetricCardModel("总发送", formatSpeed(metrics.series.networkTxBytesPerSec.lastOrNull()?.value), metrics.series.networkTxBytesPerSec, ::formatSpeed),
        MetricCardModel(
          title = "累计流量",
          value = formatBytes((metrics.series.trafficRxBytes.lastOrNull()?.value ?: 0.0) + (metrics.series.trafficTxBytes.lastOrNull()?.value ?: 0.0)),
          points = metrics.series.trafficRxBytes,
          valueFormatter = { value -> formatBytes(value ?: 0.0) }
        )
      )
    )
    metrics.latest.networkInterfaces.forEach { nic ->
      val series = metrics.series.networks.find { it.id == nic.id }
      NetworkInstanceCard(nic, series, onEdit = { onEditInstance(nic.id) })
    }
  }
}

@Composable
private fun GpuSection(metrics: MetricsDto, onEditBlock: () -> Unit, onEditInstance: (String) -> Unit) {
  if (metrics.latest.gpus.isEmpty()) return
  Section(title = "显卡", onEdit = onEditBlock) {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("总占用", formatPercent(metrics.series.gpuUsagePercent.lastOrNull()?.value), metrics.series.gpuUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("编码", formatPercent(metrics.series.gpuEncodePercent.lastOrNull()?.value), metrics.series.gpuEncodePercent, ::formatPercent, 100.0),
        MetricCardModel("解码", formatPercent(metrics.series.gpuDecodePercent.lastOrNull()?.value), metrics.series.gpuDecodePercent, ::formatPercent, 100.0),
        MetricCardModel("频率", formatMHz(metrics.series.gpuFrequencyMHz.lastOrNull()?.value), metrics.series.gpuFrequencyMHz, ::formatMHz),
        MetricCardModel("GPU 内存", formatGpuMemorySummary(metrics.latest.gpus), metrics.series.gpuMemoryUsagePercent, ::formatPercent, 100.0),
        MetricCardModel("温度", formatCelsius(metrics.series.gpuTemperatureC.lastOrNull()?.value), metrics.series.gpuTemperatureC, ::formatCelsius)
      )
    )
    metrics.latest.gpus.forEach { gpu ->
      val series = metrics.series.gpus.find { it.id == gpu.id }
      GpuInstanceCard(gpu, series, onEdit = { onEditInstance(gpu.id) })
    }
  }
}

@Composable
private fun FanSection(metrics: MetricsDto) {
  if (metrics.latest.fans.isEmpty()) return
  Section(title = "风扇") {
    if (metrics.latest.sensorBackends.isNotEmpty()) {
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        metrics.latest.sensorBackends.forEach { backend ->
          Text(
            "${backend.label}: ${if (backend.ok) "可用" else "不可用"}${backend.detail?.let { " · $it" } ?: ""}",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall
          )
        }
      }
    }
    metrics.latest.fans.forEach { fan ->
      val series = metrics.series.fans.find { it.id == fan.id }
      ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(fan.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          Text(
            listOfNotNull(fan.interfaceName ?: fan.interfaceRaw, fan.note?.takeIf { it.isNotBlank() }).joinToString(" · "),
            color = MaterialTheme.colorScheme.onSurfaceVariant
          )
          Text("${fan.rpm} RPM", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
          if (series != null) {
            MetricCardGrid(
              cards = listOf(
                MetricCardModel(
                  title = "风扇转速",
                  value = "${fan.rpm} RPM",
                  points = series.rpm,
                  valueFormatter = { value -> if (value == null) "--" else "${value.toInt()} RPM" }
                )
              )
            )
          }
        }
      }
    }
  }
}

@Composable
private fun DiskInstanceCard(
  disk: DiskDto,
  series: DiskMetricSeriesDto?,
  onEdit: () -> Unit,
  chartWindow: ChartWindow = ChartWindow.from(MetricWindow.OneMinute)
) {
  InstanceCard(
    title = disk.name,
    subtitle = listOfNotNull(disk.mountPoint, disk.filesystem, disk.model?.takeIf { it.isNotBlank() }).joinToString(" · "),
    onEdit = onEdit
  ) {
    val temperaturePoints = series?.temperatureC.orEmpty().filter { validDiskTemperature(it.value) != null }
    MetricCardGrid(
      cards = buildList {
        add(MetricCardModel("容量", buildUsage(disk.usedBytes, disk.totalBytes), series?.usagePercent.orEmpty(), ::formatPercent, 100.0))
        add(MetricCardModel("读取", formatSpeed(series?.readBytesPerSec?.lastOrNull()?.value), series?.readBytesPerSec.orEmpty(), ::formatSpeed))
        add(MetricCardModel("写入", formatSpeed(series?.writeBytesPerSec?.lastOrNull()?.value), series?.writeBytesPerSec.orEmpty(), ::formatSpeed))
        add(MetricCardModel("温度", formatCelsius(validDiskTemperature(disk.temperatureC)), temperaturePoints, ::formatCelsius))
      },
      chartWindow = chartWindow
    )
  }
}

@Composable
private fun NetworkInstanceCard(
  network: NetworkInterfaceDto,
  series: NetworkMetricSeriesDto?,
  onEdit: () -> Unit,
  chartWindow: ChartWindow = ChartWindow.from(MetricWindow.OneMinute)
) {
  InstanceCard(
    title = network.name,
    subtitle = listOfNotNull(network.ipv4.firstOrNull(), network.macAddress?.takeIf { it.isNotBlank() }).joinToString(" · "),
    onEdit = onEdit
  ) {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("接收速率", formatSpeed(network.rxBytesPerSec), series?.rxBytesPerSec.orEmpty(), ::formatSpeed),
        MetricCardModel("发送速率", formatSpeed(network.txBytesPerSec), series?.txBytesPerSec.orEmpty(), ::formatSpeed),
        MetricCardModel("累计接收", formatBytes(network.totalRxBytes?.toDouble() ?: 0.0), series?.trafficRxBytes.orEmpty(), { value -> formatBytes(value ?: 0.0) }),
        MetricCardModel("累计发送", formatBytes(network.totalTxBytes?.toDouble() ?: 0.0), series?.trafficTxBytes.orEmpty(), { value -> formatBytes(value ?: 0.0) })
      ),
      chartWindow = chartWindow
    )
  }
}

@Composable
private fun GpuInstanceCard(
  gpu: GpuDto,
  series: GpuMetricSeriesDto?,
  onEdit: () -> Unit,
  chartWindow: ChartWindow = ChartWindow.from(MetricWindow.OneMinute)
) {
  InstanceCard(
    title = gpu.name,
    subtitle = gpu.id,
    onEdit = onEdit
  ) {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("占用", formatPercent(gpu.utilizationPercent), series?.usagePercent.orEmpty(), ::formatPercent, 100.0),
        MetricCardModel("编码", formatPercent(gpu.encodeUtilizationPercent), series?.encodePercent.orEmpty(), ::formatPercent, 100.0),
        MetricCardModel("解码", formatPercent(gpu.decodeUtilizationPercent), series?.decodePercent.orEmpty(), ::formatPercent, 100.0),
        MetricCardModel("频率", formatMHz(gpu.frequencyMHz), series?.frequencyMHz.orEmpty(), ::formatMHz),
        MetricCardModel(gpuMemoryLabel(gpu.memoryKind), buildGpuUsage(gpu.memoryUsedBytes, gpu.memoryTotalBytes), series?.memoryUsagePercent.orEmpty(), ::formatPercent, 100.0),
        MetricCardModel("${gpuMemoryLabel(gpu.memoryKind)}已用", formatBytes(gpu.memoryUsedBytes.toDouble()), series?.memoryUsedBytes.orEmpty(), { value -> formatBytes(value ?: 0.0) }),
        MetricCardModel(if ((gpu.temperatureSource ?: series?.temperatureSource) == "cpuPackageShared") "温度（随 CPU）" else "温度", formatCelsius(gpu.temperatureC), series?.temperatureC.orEmpty(), ::formatCelsius)
      ),
      chartWindow = chartWindow
    )
  }
}

@Composable
private fun Section(title: String, onEdit: (() -> Unit)? = null, content: @Composable ColumnScopeScope.() -> Unit) {
  ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        if (onEdit != null) {
          IconButton(onClick = onEdit) {
            Icon(Icons.Rounded.Edit, contentDescription = "编辑")
          }
        }
      }
      ColumnScopeScope.content()
    }
  }
}

private object ColumnScopeScope

@Composable
private fun InstanceCard(title: String, subtitle: String, onEdit: (() -> Unit)? = null, content: @Composable () -> Unit) {
  val haptic = LocalHapticFeedback.current
  ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (onEdit != null) {
          IconButton(onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onEdit()
          }) {
            Icon(Icons.Rounded.Edit, contentDescription = "编辑")
          }
        }
      }
      if (subtitle.isNotBlank()) {
        Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      content()
    }
  }
}

@Composable
private fun MetaGrid(items: List<Pair<String, String>>) {
  FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    items.forEach { (label, value) ->
      Surface(
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface
      ) {
        Column(
          modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
          verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
          Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
        }
      }
    }
  }
}

@Composable
private fun MetricConfigDialog(
  state: AppState,
  onDismiss: () -> Unit,
  onToggleMetric: (String) -> Unit,
  onToggleBlock: (DeviceBlockKey) -> Unit,
  onToggleDeviceInstance: (DeviceBlockKey, String) -> Unit,
  onToggleInstanceMetric: (String, String) -> Unit,
  onSave: () -> Unit
) {
  val config = state.metricConfig ?: return
  val editingBlockKey = state.editingBlockKey
  val editingInstanceId = state.editingInstanceId
  val enabledSet = state.metricConfigDraft.toSet()
  val availableMap = config.availableMetrics.associate { it.key to it.available }

  AlertDialog(
    onDismissRequest = onDismiss,
    title = {
      Text(
        when {
          editingInstanceId != null -> "编辑实例记录项"
          editingBlockKey != null -> "编辑 ${editingBlockKey.label}"
          else -> "编辑设备记录项"
        }
      )
    },
    text = {
      LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (editingInstanceId == null && editingBlockKey == null) {
          items(DeviceBlockKey.entries.size) { index ->
            val block = DeviceBlockKey.entries[index]
            if (block == DeviceBlockKey.Fan) return@items
            val metrics = blockMetricKeys(block)
            val fullyEnabled = metrics.all(enabledSet::contains)
            Row(
              modifier = Modifier
                .fillMaxWidth()
                .clickable { onToggleBlock(block) }
                .padding(vertical = 6.dp),
              verticalAlignment = Alignment.CenterVertically
            ) {
              Checkbox(checked = fullyEnabled, onCheckedChange = { onToggleBlock(block) })
              Column(Modifier.weight(1f)) {
                Text(block.label, fontWeight = FontWeight.SemiBold)
                Text(metrics.joinToString(" / "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }
          }
        } else if (editingInstanceId == null && editingBlockKey != null) {
          blockMetricKeys(editingBlockKey).forEach { metric ->
            item("metric-$metric") {
              val available = availableMap[metric] ?: false
              Row(
                modifier = Modifier
                  .fillMaxWidth()
                  .clickable(enabled = available) { onToggleMetric(metric) }
                  .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
              ) {
                Checkbox(checked = enabledSet.contains(metric), onCheckedChange = if (available) ({ onToggleMetric(metric) }) else null, enabled = available)
                Column(Modifier.weight(1f)) {
                  Text(metricLabel(metric), fontWeight = FontWeight.SemiBold)
                  Text(if (available) "可检测" else "当前设备不支持检测", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
              }
            }
          }
          val instances = blockInstances(state, editingBlockKey)
          if (instances.isNotEmpty()) {
            item("divider") { HorizontalDivider() }
            items(instances.size) { index ->
              val instance = instances[index]
              val enabledIds = state.enabledDeviceIdsDraft[editingBlockKey.value]
              val checked = enabledIds.isNullOrEmpty() || enabledIds.contains(instance.id)
              Row(
                modifier = Modifier
                  .fillMaxWidth()
                  .clickable { onToggleDeviceInstance(editingBlockKey, instance.id) }
                  .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
              ) {
                Checkbox(checked = checked, onCheckedChange = { onToggleDeviceInstance(editingBlockKey, instance.id) })
                Column(Modifier.weight(1f)) {
                  Text(instance.title, fontWeight = FontWeight.SemiBold)
                  if (instance.subtitle.isNotBlank()) {
                    Text(instance.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                  }
                }
              }
            }
          }
        } else if (editingBlockKey != null && editingInstanceId != null) {
          blockMetricKeys(editingBlockKey).forEach { metric ->
            item("instance-metric-$metric") {
              val available = availableMap[metric] ?: false
              val enabled = (state.instanceMetricConfigDraft[editingInstanceId] ?: blockMetricKeys(editingBlockKey)).contains(metric)
              Row(
                modifier = Modifier
                  .fillMaxWidth()
                  .clickable(enabled = available) { onToggleInstanceMetric(editingInstanceId, metric) }
                  .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
              ) {
                Checkbox(checked = enabled, onCheckedChange = if (available) ({ onToggleInstanceMetric(editingInstanceId, metric) }) else null, enabled = available)
                Column(Modifier.weight(1f)) {
                  Text(metricLabel(metric), fontWeight = FontWeight.SemiBold)
                  Text(if (available) "可检测" else "当前设备不支持检测", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
              }
            }
          }
        }
      }
    },
    confirmButton = {
      Button(onClick = onSave, enabled = !state.savingMetricConfig) {
        Text(if (state.savingMetricConfig) "保存中" else "保存")
      }
    },
    dismissButton = {
      OutlinedButton(onClick = onDismiss, enabled = !state.savingMetricConfig) {
        Text("关闭")
      }
    }
  )
}

private data class InstanceOption(val id: String, val title: String, val subtitle: String)

private fun blockMetricKeys(block: DeviceBlockKey): List<String> = when (block) {
  DeviceBlockKey.Cpu -> listOf("cpuUsage", "cpuFrequency", "cpuTemperature")
  DeviceBlockKey.Gpu -> listOf("gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature")
  DeviceBlockKey.Memory -> listOf("memoryUsage", "swapUsage")
  DeviceBlockKey.Disk -> listOf("diskUsage", "diskRead", "diskWrite")
  DeviceBlockKey.Network -> listOf("networkRxRate", "networkTxRate", "networkTraffic")
  DeviceBlockKey.Temperature -> listOf("temperatureSources")
  DeviceBlockKey.Fan -> emptyList()
}

private fun metricLabel(metric: String): String = when (metric) {
  "cpuUsage" -> "CPU 占用"
  "cpuFrequency" -> "CPU 频率"
  "cpuTemperature" -> "CPU 温度"
  "gpuUsage" -> "GPU 占用"
  "gpuEncode" -> "GPU 编码"
  "gpuDecode" -> "GPU 解码"
  "gpuFrequency" -> "GPU 频率"
  "gpuMemory" -> "GPU 内存"
  "gpuTemperature" -> "GPU 温度"
  "memoryUsage" -> "内存"
  "swapUsage" -> "虚拟内存"
  "diskUsage" -> "硬盘占用"
  "diskRead" -> "硬盘读取"
  "diskWrite" -> "硬盘写入"
  "networkRxRate" -> "网络接收"
  "networkTxRate" -> "网络发送"
  "networkTraffic" -> "网络流量"
  "temperatureSources" -> "温度源"
  else -> metric
}

private fun blockInstances(state: AppState, block: DeviceBlockKey): List<InstanceOption> {
  val metrics = state.metrics ?: return emptyList()
  return when (block) {
    DeviceBlockKey.Cpu -> metrics.latest.cpuPackages.map {
      InstanceOption(it.id, it.name, listOfNotNull(it.model, it.logicalCount?.let { c -> "${c}线程" }).joinToString(" · "))
    }
    DeviceBlockKey.Gpu -> metrics.latest.gpus.map {
      InstanceOption(it.id, it.name, it.id)
    }
    DeviceBlockKey.Disk -> metrics.latest.disks.map {
      InstanceOption(it.id, it.name, it.mountPoint)
    }
    DeviceBlockKey.Network -> metrics.latest.networkInterfaces.map {
      InstanceOption(it.id, it.name, it.ipv4.firstOrNull() ?: it.macAddress.orEmpty())
    }
    DeviceBlockKey.Memory, DeviceBlockKey.Temperature, DeviceBlockKey.Fan -> emptyList()
  }
}

private fun isMetricAvailable(metrics: MetricsDto, key: String): Boolean {
  return metrics.availableMetrics.firstOrNull { it.key == key }?.available ?: true
}

@Composable
private fun MetricCardGrid(
  cards: List<MetricCardModel>,
  chartWindow: ChartWindow = ChartWindow.from(MetricWindow.OneMinute)
) {
  BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
    val minCardWidth = 220.dp
    val spacing = 12.dp
    val columns = max(1, ((maxWidth + spacing) / (minCardWidth + spacing)).toInt())
    val cardWidth = (maxWidth - spacing * (columns - 1)) / columns

    FlowRow(horizontalArrangement = Arrangement.spacedBy(spacing), verticalArrangement = Arrangement.spacedBy(spacing)) {
      cards.forEach { card ->
        Surface(
          modifier = Modifier.width(cardWidth),
          shape = RoundedCornerShape(20.dp),
          color = MaterialTheme.colorScheme.surface
        ) {
          Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
              Text(card.title, style = MaterialTheme.typography.titleSmall)
              Text(card.value, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            MiniLineChart(
              title = card.title,
              valueFormatter = card.valueFormatter,
              points = card.points,
              fixedMaxValue = card.fixedMaxValue,
              chartWindow = chartWindow
            )
            if (card.points.isNotEmpty()) {
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(formatChartTime(java.time.Instant.ofEpochMilli(chartWindow.startMillis).toString(), chartWindow.window), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(formatChartTime(java.time.Instant.ofEpochMilli(chartWindow.endMillis).toString(), chartWindow.window), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }
          }
        }
      }
    }
  }
}

@Composable
private fun WindowStrip(selectedWindow: MetricWindow, loading: Boolean, onSelectWindow: (MetricWindow) -> Unit) {
  val haptic = LocalHapticFeedback.current
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      MetricWindow.entries.forEach { window ->
        FilterChip(
          selected = selectedWindow == window,
          onClick = {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onSelectWindow(window)
          },
          enabled = !loading,
          label = { Text(window.label) }
        )
      }
    }
    if (loading) {
      InlineLoadingCard("正在切换时间范围")
    }
  }
}

@Composable
private fun StatChip(label: String, value: String, onClick: (() -> Unit)? = null) {
  val haptic = LocalHapticFeedback.current
  Surface(
    modifier = if (onClick != null) Modifier.clickable {
      haptic.performHapticFeedback(HapticFeedbackType.LongPress)
      onClick()
    } else Modifier,
    shape = RoundedCornerShape(999.dp),
    color = MaterialTheme.colorScheme.secondaryContainer
  ) {
    Row(
      modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
      Text(value, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSecondaryContainer)
    }
  }
}

@Composable
private fun InlineLoadingCard(label: String) {
  Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp, vertical = 14.dp),
      horizontalArrangement = Arrangement.spacedBy(12.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
      Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun MiniLineChart(
  title: String,
  valueFormatter: (Double?) -> String,
  points: List<SamplePointDto>,
  fixedMaxValue: Double? = null,
  chartWindow: ChartWindow
) {
  val lineColor = MaterialTheme.colorScheme.primary
  val fillColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
  val gridColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f)
  val markerOuterColor = MaterialTheme.colorScheme.surface
  val chartPoints = remember(points) {
    points.sortedBy { parseTimestampMillis(it.timestamp) ?: Long.MIN_VALUE }
  }
  var selectedIndex by remember(chartPoints, chartWindow) { mutableStateOf(chartPoints.lastIndex.coerceAtLeast(0)) }
  val haptic = LocalHapticFeedback.current

  fun updateSelectedIndex(
    nextIndex: Int,
    vibrate: Boolean = true,
    feedbackType: HapticFeedbackType = HapticFeedbackType.LongPress
  ) {
    if (nextIndex != selectedIndex) {
      selectedIndex = nextIndex
      if (vibrate) {
        haptic.performHapticFeedback(feedbackType)
      }
    }
  }

  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (chartPoints.isNotEmpty()) {
      val selectedPoint = chartPoints[selectedIndex.coerceIn(0, chartPoints.lastIndex)]
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(formatChartTime(selectedPoint.timestamp, chartWindow.window), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("${title} ${valueFormatter(selectedPoint.value)}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
      }
    }
    Canvas(
      modifier = Modifier
        .fillMaxWidth()
        .height(120.dp)
        .clip(RoundedCornerShape(16.dp))
        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
        .pointerInput(chartPoints, chartWindow) {
          detectTapGestures { offset ->
            if (chartPoints.isEmpty()) return@detectTapGestures
            updateSelectedIndex(
              resolveChartIndex(offset.x, size.width.toFloat(), chartPoints, chartWindow),
              feedbackType = HapticFeedbackType.LongPress
            )
          }
        }
        .pointerInput(chartPoints, chartWindow) {
          detectDragGestures(
            onDragStart = { offset ->
              if (chartPoints.isEmpty()) return@detectDragGestures
              updateSelectedIndex(
                resolveChartIndex(offset.x, size.width.toFloat(), chartPoints, chartWindow),
                feedbackType = HapticFeedbackType.LongPress
              )
            },
            onDrag = { change, _ ->
              updateSelectedIndex(
                resolveChartIndex(change.position.x, size.width.toFloat(), chartPoints, chartWindow),
                feedbackType = HapticFeedbackType.LongPress
              )
              change.consume()
            }
          )
        }
    ) {
      if (chartPoints.isEmpty()) return@Canvas

      val maxValue = fixedMaxValue ?: max(chartPoints.maxOf { it.value }, 1.0)
      val yFor: (Double) -> Float = { value -> size.height - ((value / maxValue).toFloat() * size.height) }

      repeat(4) { idx ->
        val y = size.height * idx / 3f
        drawLine(gridColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
      }

      splitSamplePointSegments(chartPoints, chartWindow).forEach { segment ->
        val path = Path()
        val fillPath = Path()
        segment.forEachIndexed { index, point ->
          val x = chartWindow.xFor(point.timestamp, size.width)
          val y = yFor(point.value)
          if (index == 0) {
            path.moveTo(x, y)
            fillPath.moveTo(x, size.height)
            fillPath.lineTo(x, y)
          } else {
            path.lineTo(x, y)
            fillPath.lineTo(x, y)
          }
        }
        val lastX = chartWindow.xFor(segment.last().timestamp, size.width)
        fillPath.lineTo(lastX, size.height)
        fillPath.close()
        drawPath(path = fillPath, brush = Brush.verticalGradient(listOf(fillColor, Color.Transparent)))
        drawPath(path = path, color = lineColor, style = Stroke(width = 4f, cap = StrokeCap.Round))
      }

      val selectedPoint = chartPoints[selectedIndex.coerceIn(0, chartPoints.lastIndex)]
      val selectedX = chartWindow.xFor(selectedPoint.timestamp, size.width)
      val selectedY = yFor(selectedPoint.value)
      drawLine(
        color = lineColor.copy(alpha = 0.35f),
        start = Offset(selectedX, 0f),
        end = Offset(selectedX, size.height),
        strokeWidth = 2f
      )
      drawCircle(color = markerOuterColor, radius = 10f, center = Offset(selectedX, selectedY))
      drawCircle(color = lineColor, radius = 6f, center = Offset(selectedX, selectedY))
    }
  }
}

@Composable
private fun TrafficHeader(traffic: TrafficCalendarDto) {
  ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(traffic.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
      Text("${formatDate(traffic.rangeStart)} - ${formatDateInclusive(traffic.rangeEnd)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun TrafficCalendarGrid(traffic: TrafficCalendarDto, onSelectCell: (String) -> Unit) {
  val haptic = LocalHapticFeedback.current
  val maxCellValue = max(traffic.cells.maxOfOrNull { it.totalRxBytes + it.totalTxBytes } ?: 0.0, 1.0)
  val columns = 7
  val rows = ((traffic.cells.size + columns - 1) / columns).coerceAtLeast(2)

  LazyVerticalGrid(
    columns = GridCells.Fixed(columns),
    modifier = Modifier.height(52.dp * rows),
    userScrollEnabled = false,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp)
  ) {
    items(traffic.cells, key = { it.key }) { cell ->
      val ratio = (cell.totalRxBytes + cell.totalTxBytes) / maxCellValue
      val baseColor = MaterialTheme.colorScheme.surfaceContainerLow
      val overlay = if (cell.isInPrimaryScope) ratio.toFloat() else 0.05f
      Surface(
        modifier = Modifier
          .height(44.dp)
          .clickable {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            onSelectCell(cell.rangeStart)
          },
        shape = RoundedCornerShape(18.dp),
        color = baseColor.copy(alpha = 0.65f + overlay * 0.3f)
      ) {
        Box(
          modifier = Modifier
            .size(30.dp)
            .then(if (cell.isCurrentPeriod) Modifier.background(MaterialTheme.colorScheme.primary, CircleShape) else Modifier)
            .then(if (cell.isSelected) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, CircleShape) else Modifier),
          contentAlignment = Alignment.Center
        ) {
          Text(
            trafficDayLabel(cell.rangeStart),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            color = if (cell.isCurrentPeriod) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
          )
        }
      }
    }
  }
}

@Composable
private fun TrafficSelectedSummary(traffic: TrafficCalendarDto) {
  val selected = traffic.cells.firstOrNull { it.isSelected }
  ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Text(selected?.label ?: "所选日期", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
      Text(formatBytes(traffic.totalRxBytes + traffic.totalTxBytes), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
      Text("接收 ${formatBytes(traffic.totalRxBytes)} · 发送 ${formatBytes(traffic.totalTxBytes)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun TrafficCapsule(onClick: () -> Unit) {
  val haptic = LocalHapticFeedback.current
  Surface(
    modifier = Modifier.fillMaxWidth().clickable {
      haptic.performHapticFeedback(HapticFeedbackType.LongPress)
      onClick()
    },
    shape = RoundedCornerShape(24.dp),
    color = MaterialTheme.colorScheme.surface
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text("流量", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
      Text("按日期查看接收、发送与明细", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun TrafficStats(traffic: TrafficCalendarDto) {
  FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    StatChip("范围接收", formatBytes(traffic.totalRxBytes))
    StatChip("范围发送", formatBytes(traffic.totalTxBytes))
    StatChip("总流量", formatBytes(traffic.totalRxBytes + traffic.totalTxBytes))
    StatChip("记录数", traffic.records.size.toString())
  }
}

@Composable
private fun TrafficRecords(traffic: TrafficCalendarDto) {
  ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Text("范围记录", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
      traffic.records.takeLast(36).reversed().forEach { record ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
          Column(modifier = Modifier.weight(1f)) {
            Text(formatTime(record.timestamp), style = MaterialTheme.typography.bodyMedium)
            Text("入 ${formatBytes(record.rxBytes)} / 出 ${formatBytes(record.txBytes)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          Text(formatBytes(record.totalBytes), fontWeight = FontWeight.Bold)
        }
      }
    }
  }
}

private data class MetricCardModel(
  val title: String,
  val value: String,
  val points: List<SamplePointDto>,
  val valueFormatter: (Double?) -> String,
  val fixedMaxValue: Double? = null
)

private fun metricPoint(
  points: List<SamplePointDto>,
  window: MetricWindow,
  formatter: (Double?) -> String,
  zeroMeansMissing: Boolean = false
): String {
  if (zeroMeansMissing && points.isNotEmpty() && points.all { it.value == 0.0 }) {
    return formatter(null)
  }
  val value =
    when {
      points.isEmpty() -> null
      window == MetricWindow.OneMinute -> points.lastOrNull()?.value
      else -> points.map { it.value }.average()
    }
  return formatter(value)
}

private fun temperatureRoleLabel(role: String): String = when (role) {
  "cpu_package" -> "CPU 封装"
  "cpu_core" -> "CPU 核心"
  "gpu_core" -> "GPU 核心"
  "gpu_hotspot" -> "GPU 热点"
  "storage_composite" -> "磁盘综合温度"
  "storage_sensor" -> "磁盘附加传感器"
  "motherboard" -> "主板温度"
  "superio" -> "SuperIO 温度"
  "peci" -> "PECI 温度"
  "acpi_zone" -> "ACPI 热区"
  "threshold" -> "温度阈值"
  "derived" -> "派生温度"
  "unknown" -> "未知温度源"
  else -> role.ifBlank { "未知温度源" }
}

private fun temperatureSourceLabel(source: String): String = when (source) {
  "librehardwaremonitor" -> "LibreHardwareMonitor"
  "linux-hwmon" -> "Linux hwmon"
  "linux-thermal" -> "Linux thermal"
  "smartctl" -> "smartctl / SMART"
  "windows-storage-reliability" -> "Windows 存储可靠性"
  "cpu-package-shared", "cpuPackageShared" -> "CPU Package 共享"
  else -> source.ifBlank { "未知来源" }
}

private fun temperatureStatusLabel(status: String): String = when (status) {
  "valid" -> "正常"
  "threshold" -> "阈值"
  "invalid" -> "无效值"
  else -> "不可用"
}

private fun temperatureValueLabel(sensor: TemperatureSensorDto): String {
  val current = sensor.currentC
  return if (current == null || !current.isFinite()) {
    if (sensor.status == "threshold") "仅阈值" else "—"
  } else {
    formatCelsius(current)
  }
}

private fun temperatureLimitsLabel(sensor: TemperatureSensorDto): String? {
  val limits = listOfNotNull(
    sensor.highC?.let { "高 ${formatCelsius(it)}" },
    sensor.criticalC?.let { "临界 ${formatCelsius(it)}" },
    sensor.emergencyC?.let { "紧急 ${formatCelsius(it)}" }
  )
  return limits.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

private fun gpuTemperatureSourceLabel(source: String?): String = when {
  source.isNullOrBlank() -> "未知"
  source == "cpuPackageShared" || source == "cpu-package-shared" -> "CPU 封装共享"
  else -> temperatureSourceLabel(source)
}

private fun formatPercent(value: Double?): String = if (value == null) "--" else "${"%.1f".format(value)}%"
private fun formatMHz(value: Double?): String = if (value == null) "--" else "${"%.0f".format(value)} MHz"
private fun formatCelsius(value: Double?): String = if (value == null) "--" else "${"%.1f".format(value)} °C"
private fun validTemperature(value: Double?): Double? = value?.takeIf { it.isFinite() && it > 0.0 }
private fun validTemperaturePoints(points: List<SamplePointDto>): List<SamplePointDto> =
  points.filter { validTemperature(it.value) != null }
private fun validDiskTemperature(value: Double?): Double? = validTemperature(value)
private fun formatSpeed(value: Double?): String = formatBytes(value ?: 0.0) + "/s"
private fun formatDiskHealth(value: String): String = when (value.lowercase()) {
  "good" -> "正常"
  "caution" -> "注意"
  "bad" -> "异常"
  else -> value
}
private fun formatDate(value: String): String = runCatching {
  java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDate().toString()
}.getOrDefault(value)
private fun formatDateInclusive(value: String): String = runCatching {
  java.time.OffsetDateTime.parse(value).minusNanos(1).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDate().toString()
}.getOrDefault(value)
private fun trafficDayLabel(value: String): String = runCatching {
  java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault()).dayOfMonth.toString()
}.getOrDefault(value)
private fun formatTime(value: String?): String = if (value.isNullOrBlank()) "--" else runCatching {
  val dt = java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDateTime()
  "%04d-%02d-%02d %02d:%02d:%02d".format(dt.year, dt.monthValue, dt.dayOfMonth, dt.hour, dt.minute, dt.second)
}.getOrDefault(value)
private fun formatChartTime(value: String, window: MetricWindow): String = runCatching {
  val dt = java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault())
  when (window) {
    MetricWindow.OneMinute, MetricWindow.FiveMinutes -> "%02d:%02d:%02d".format(dt.hour, dt.minute, dt.second)
    MetricWindow.OneHour, MetricWindow.SixHours -> "%02d:%02d".format(dt.hour, dt.minute)
    MetricWindow.OneDay, MetricWindow.SevenDays -> "%02d-%02d %02d:%02d".format(dt.monthValue, dt.dayOfMonth, dt.hour, dt.minute)
  }
}.getOrDefault("--")

private fun buildUsage(used: Long, total: Long): String = "${formatBytes(used.toDouble())} / ${formatBytes(total.toDouble())}"

private fun buildGpuUsage(used: Long, total: Long): String = if (total > 0) {
  buildUsage(used, total)
} else if (used > 0) {
  "${formatBytes(used.toDouble())} / 容量未知"
} else {
  "容量暂无"
}

private fun gpuMemoryLabel(memoryKind: String?): String = when (memoryKind) {
  "shared" -> "共享显存"
  "dedicated" -> "独立显存"
  else -> "GPU 内存"
}

private fun formatGpuMemorySummary(gpus: List<GpuDto>): String = gpus
  .groupBy { gpuMemoryLabel(it.memoryKind) }
  .map { (label, items) ->
    val used = items.sumOf { it.memoryUsedBytes }
    val total = items.sumOf { it.memoryTotalBytes }
    "$label：${buildGpuUsage(used, total)}"
  }
  .ifEmpty { listOf("容量暂无") }
  .joinToString(" · ")

private fun formatOptionalBytes(value: Long?): String = value?.takeIf { it > 0 }?.let { formatBytes(it.toDouble()) } ?: "未知"
private fun formatOptionalBytes(value: Double?): String = value?.takeIf { it > 0.0 }?.let(::formatBytes) ?: "未知"

private fun formatBytes(value: Double): String {
  if (value <= 0.0) return "0 B"
  val units = listOf("B", "KB", "MB", "GB", "TB")
  var current = value
  var unitIndex = 0
  while (current >= 1024 && unitIndex < units.lastIndex) {
    current /= 1024
    unitIndex += 1
  }
  val precision = if (current >= 100) 0 else 1
  return "%.${precision}f %s".format(current, units[unitIndex])
}
