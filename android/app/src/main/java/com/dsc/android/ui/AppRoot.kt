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
import com.dsc.android.ScreenTransitionDirection
import com.dsc.android.SamplePointDto
import com.dsc.android.TrafficCalendarDto
import com.dsc.android.TrafficCalendarMode
import kotlin.math.absoluteValue
import kotlin.math.max

@Composable
fun AppRoot(
  state: AppState,
  onSaveServerConfig: (String, String) -> Unit,
  onLogin: () -> Unit,
  onLogout: () -> Unit,
  onSystemBack: () -> Unit,
  onOpenDevice: (String) -> Unit,
  onOpenTraffic: (String) -> Unit,
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
  onRefresh: () -> Unit
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
          AppScreen.DeviceList -> DeviceListScreen(state, onOpenDevice, onOpenTraffic, onOpenDeviceEditor, onRequestLogout = { showLogoutConfirm = true }, onRefresh = onRefresh)
          AppScreen.Traffic -> TrafficScreen(state, onShowDeviceList, onSelectTrafficMode, onSelectTrafficCell, onShiftTrafficAnchor, onRefresh)
          AppScreen.DeviceDetail -> DeviceDetailScreen(state, onShowDeviceList, onSelectWindow, onOpenTraffic, onOpenBlockEditor, onOpenInstanceEditor, onRefresh)
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
      supportingText = { Text("例如 http://192.0.2.28:4000") },
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
  onOpenDevice: (String) -> Unit,
  onOpenTraffic: (String) -> Unit,
  onOpenDeviceEditor: (String) -> Unit,
  onRequestLogout: () -> Unit,
  onRefresh: () -> Unit
) {
  val haptic = LocalHapticFeedback.current
  Scaffold(
    topBar = {
      TopAppBar(
        title = {
          Column {
            Text("设备状态控制台")
            Text("设备列表", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        },
        actions = {
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
      items(state.devices.size) { index ->
        val device = state.devices[index]
        DeviceListCard(
          device,
          onOpenDevice = { onOpenDevice(device.deviceId) },
          onOpenTraffic = { onOpenTraffic(device.deviceId) },
          onOpenEditor = { onOpenDeviceEditor(device.deviceId) }
        )
      }
    }
  }
}

@Composable
private fun DeviceListCard(
  device: DeviceSummaryDto,
  onOpenDevice: () -> Unit,
  onOpenTraffic: () -> Unit,
  onOpenEditor: () -> Unit
) {
  val haptic = LocalHapticFeedback.current
  val statusIndicatorModifier =
    if (device.status == "online") {
      Modifier.background(MaterialTheme.colorScheme.primary, CircleShape)
    } else {
      Modifier.border(1.5.dp, MaterialTheme.colorScheme.error, CircleShape)
    }
  ElevatedCard(
    modifier = Modifier.fillMaxWidth(),
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
        }
        Text(device.os.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        StatChip("CPU", formatPercent(device.cpuUsagePercent))
        StatChip("内存", formatPercent(device.memoryUsagePercent))
        StatChip("硬盘", formatPercent(device.diskUsagePercent))
      }
      Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Button(onClick = {
          haptic.performHapticFeedback(HapticFeedbackType.LongPress)
          onOpenDevice()
        }, modifier = Modifier.weight(1f)) {
          Icon(Icons.Rounded.Timeline, contentDescription = null)
          Spacer(Modifier.width(8.dp))
          Text("监控")
        }
        Button(onClick = {
          haptic.performHapticFeedback(HapticFeedbackType.LongPress)
          onOpenTraffic()
        }, modifier = Modifier.weight(1f)) {
          Icon(Icons.Rounded.Router, contentDescription = null)
          Spacer(Modifier.width(8.dp))
          Text("流量")
        }
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
  onOpenBlockEditor: (String, DeviceBlockKey) -> Unit,
  onOpenInstanceEditor: (String, DeviceBlockKey, String) -> Unit,
  onRefresh: () -> Unit
) {
  val haptic = LocalHapticFeedback.current
  val metrics = state.metrics ?: return

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
              "${metrics.device.os} · ${metrics.device.platform} · ${metrics.status}",
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
      item {
        OverviewCard(metrics)
      }
      item {
        WindowStrip(selectedWindow = state.selectedWindow, onSelectWindow = onSelectWindow)
      }
      item {
        CpuSection(metrics, onEditBlock = { onOpenBlockEditor(metrics.device.deviceId, DeviceBlockKey.Cpu) }, onEditInstance = { onOpenInstanceEditor(metrics.device.deviceId, DeviceBlockKey.Cpu, it) })
      }
      item {
        MemorySection(metrics, onEditBlock = { onOpenBlockEditor(metrics.device.deviceId, DeviceBlockKey.Memory) })
      }
      item {
        DiskSection(metrics, onEditBlock = { onOpenBlockEditor(metrics.device.deviceId, DeviceBlockKey.Disk) }, onEditInstance = { onOpenInstanceEditor(metrics.device.deviceId, DeviceBlockKey.Disk, it) })
      }
      item {
        NetworkSection(metrics, onEditBlock = { onOpenBlockEditor(metrics.device.deviceId, DeviceBlockKey.Network) }, onEditInstance = { onOpenInstanceEditor(metrics.device.deviceId, DeviceBlockKey.Network, it) })
      }
      item {
        GpuSection(metrics, onEditBlock = { onOpenBlockEditor(metrics.device.deviceId, DeviceBlockKey.Gpu) }, onEditInstance = { onOpenInstanceEditor(metrics.device.deviceId, DeviceBlockKey.Gpu, it) })
      }
      item {
        FanSection(metrics.latest.fans)
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
      item {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          TrafficCalendarMode.entries.forEach { mode ->
            FilterChip(
              selected = state.trafficMode == mode,
              onClick = {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                onSelectMode(mode)
              },
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
      traffic?.let {
        item { TrafficHeader(it) }
        item { TrafficCalendarGrid(it, onSelectCell) }
        item { TrafficStats(it) }
        item { TrafficRecords(it) }
      }
    }
  }
}

@Composable
private fun OverviewCard(metrics: MetricsDto) {
  ElevatedCard(
    colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(metrics.device.hostname, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
      Text(metrics.device.cpuModel ?: "--", color = MaterialTheme.colorScheme.onSurfaceVariant)
      HorizontalDivider()
      Text("上次更新 ${formatTime(metrics.lastSeenAt)}", style = MaterialTheme.typography.bodySmall)
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        StatChip("在线状态", if (metrics.status == "online") "在线" else "离线")
        StatChip("CPU", formatPercent(metrics.series.cpuUsagePercent.lastOrNull()?.value))
        StatChip("内存", buildUsage(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes))
        StatChip("虚拟内存", buildUsage(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes))
      }
    }
  }
}

@Composable
private fun CpuSection(metrics: MetricsDto, onEditBlock: () -> Unit, onEditInstance: (String) -> Unit) {
  Section(title = "CPU", onEdit = onEditBlock) {
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
        MetricCardModel("显存", formatPercent(metrics.series.gpuMemoryUsagePercent.lastOrNull()?.value), metrics.series.gpuMemoryUsagePercent, ::formatPercent, 100.0),
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
private fun FanSection(fans: List<FanDto>) {
  if (fans.isEmpty()) return
  Section(title = "风扇") {
    fans.forEach { fan ->
      ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(fan.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          Text(
            listOfNotNull(fan.interfaceName ?: fan.interfaceRaw, fan.note?.takeIf { it.isNotBlank() }).joinToString(" · "),
            color = MaterialTheme.colorScheme.onSurfaceVariant
          )
          Text("${fan.rpm} RPM", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
      }
    }
  }
}

@Composable
private fun DiskInstanceCard(disk: DiskDto, series: DiskMetricSeriesDto?, onEdit: () -> Unit) {
  InstanceCard(
    title = disk.name,
    subtitle = listOfNotNull(disk.mountPoint, disk.filesystem, disk.model?.takeIf { it.isNotBlank() }).joinToString(" · "),
    onEdit = onEdit
  ) {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("容量", buildUsage(disk.usedBytes, disk.totalBytes), series?.usagePercent.orEmpty(), ::formatPercent, 100.0),
        MetricCardModel("读取", formatSpeed(series?.readBytesPerSec?.lastOrNull()?.value), series?.readBytesPerSec.orEmpty(), ::formatSpeed),
        MetricCardModel("写入", formatSpeed(series?.writeBytesPerSec?.lastOrNull()?.value), series?.writeBytesPerSec.orEmpty(), ::formatSpeed)
      )
    )
  }
}

@Composable
private fun NetworkInstanceCard(network: NetworkInterfaceDto, series: NetworkMetricSeriesDto?, onEdit: () -> Unit) {
  InstanceCard(
    title = network.name,
    subtitle = listOfNotNull(network.ipv4.firstOrNull(), network.macAddress?.takeIf { it.isNotBlank() }).joinToString(" · "),
    onEdit = onEdit
  ) {
    MetricCardGrid(
      cards = listOf(
        MetricCardModel("接收速率", formatSpeed(network.rxBytesPerSec), series?.rxBytesPerSec.orEmpty(), ::formatSpeed),
        MetricCardModel("发送速率", formatSpeed(network.txBytesPerSec), series?.txBytesPerSec.orEmpty(), ::formatSpeed),
        MetricCardModel(
          title = "累计接收",
          value = formatBytes((network.totalRxBytes ?: 0).toDouble()),
          points = series?.trafficRxBytes.orEmpty(),
          valueFormatter = { value -> formatBytes(value ?: 0.0) }
        ),
        MetricCardModel(
          title = "累计发送",
          value = formatBytes((network.totalTxBytes ?: 0).toDouble()),
          points = series?.trafficTxBytes.orEmpty(),
          valueFormatter = { value -> formatBytes(value ?: 0.0) }
        )
      )
    )
  }
}

@Composable
private fun GpuInstanceCard(gpu: GpuDto, series: GpuMetricSeriesDto?, onEdit: () -> Unit) {
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
        MetricCardModel("显存", buildUsage(gpu.memoryUsedBytes, gpu.memoryTotalBytes), series?.memoryUsagePercent.orEmpty(), ::formatPercent, 100.0),
        MetricCardModel("温度", formatCelsius(gpu.temperatureC), series?.temperatureC.orEmpty(), ::formatCelsius)
      )
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
  ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (onEdit != null) {
          IconButton(onClick = onEdit) {
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
  "gpuMemory" -> "GPU 显存"
  "gpuTemperature" -> "GPU 温度"
  "memoryUsage" -> "内存"
  "swapUsage" -> "虚拟内存"
  "diskUsage" -> "硬盘占用"
  "diskRead" -> "硬盘读取"
  "diskWrite" -> "硬盘写入"
  "networkRxRate" -> "网络接收"
  "networkTxRate" -> "网络发送"
  "networkTraffic" -> "网络流量"
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
    DeviceBlockKey.Memory, DeviceBlockKey.Fan -> emptyList()
  }
}

@Composable
private fun MetricCardGrid(cards: List<MetricCardModel>) {
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
            MiniLineChart(title = card.title, valueFormatter = card.valueFormatter, points = card.points, fixedMaxValue = card.fixedMaxValue)
            if (card.points.isNotEmpty()) {
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(formatAxisTime(card.points.first().timestamp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(formatAxisTime(card.points.last().timestamp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }
          }
        }
      }
    }
  }
}

@Composable
private fun WindowStrip(selectedWindow: MetricWindow, onSelectWindow: (MetricWindow) -> Unit) {
  val haptic = LocalHapticFeedback.current
  FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    MetricWindow.entries.forEach { window ->
      FilterChip(
        selected = selectedWindow == window,
        onClick = {
          haptic.performHapticFeedback(HapticFeedbackType.LongPress)
          onSelectWindow(window)
        },
        label = { Text(window.label) }
      )
    }
  }
}

@Composable
private fun StatChip(label: String, value: String) {
  Surface(shape = RoundedCornerShape(999.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
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
private fun MiniLineChart(title: String, valueFormatter: (Double?) -> String, points: List<SamplePointDto>, fixedMaxValue: Double? = null) {
  val lineColor = MaterialTheme.colorScheme.primary
  val fillColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
  val gridColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f)
  val markerOuterColor = MaterialTheme.colorScheme.surface
  var selectedIndex by remember(points) { mutableStateOf(points.lastIndex.coerceAtLeast(0)) }

  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (points.isNotEmpty()) {
      val selectedPoint = points[selectedIndex.coerceIn(0, points.lastIndex)]
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(formatAxisTime(selectedPoint.timestamp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("${title} ${valueFormatter(selectedPoint.value)}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
      }
    }
    Canvas(
      modifier = Modifier
        .fillMaxWidth()
        .height(120.dp)
        .clip(RoundedCornerShape(16.dp))
        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
        .pointerInput(points) {
          detectTapGestures { offset ->
            if (points.isEmpty()) return@detectTapGestures
            val stepX = if (points.size == 1) size.width else size.width / (points.size - 1)
            val rawIndex = if (points.size == 1) 0 else (offset.x / stepX).toInt()
            val nearest = rawIndex.coerceIn(0, points.lastIndex)
            selectedIndex = nearest
          }
        }
    ) {
      if (points.isEmpty()) return@Canvas

      val maxValue = fixedMaxValue ?: max(points.maxOf { it.value }, 1.0)
      val stepX = if (points.size == 1) 0f else size.width / (points.size - 1)
      val yFor: (Double) -> Float = { value -> size.height - ((value / maxValue).toFloat() * size.height) }

      repeat(4) { idx ->
        val y = size.height * idx / 3f
        drawLine(gridColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
      }

      val path = Path()
      val fillPath = Path()
      points.forEachIndexed { index, point ->
        val x = index * stepX
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
      fillPath.lineTo(size.width, size.height)
      fillPath.close()

      drawPath(path = fillPath, brush = Brush.verticalGradient(listOf(fillColor, Color.Transparent)))
      drawPath(path = path, color = lineColor, style = Stroke(width = 4f, cap = StrokeCap.Round))

      val selectedPoint = points[selectedIndex.coerceIn(0, points.lastIndex)]
      val selectedX = if (points.size == 1) size.width / 2f else selectedIndex.coerceIn(0, points.lastIndex) * stepX
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
  val maxCellValue = max(traffic.cells.maxOfOrNull { it.totalRxBytes + it.totalTxBytes } ?: 0.0, 1.0)
  val columns = when (traffic.mode) {
    "month" -> 3
    "week" -> 2
    else -> 7
  }
  val rows = ((traffic.cells.size + columns - 1) / columns).coerceAtLeast(2)

  LazyVerticalGrid(
    columns = GridCells.Fixed(columns),
    modifier = Modifier.height(96.dp * rows),
    userScrollEnabled = false,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp)
  ) {
    items(traffic.cells, key = { it.key }) { cell ->
      val ratio = (cell.totalRxBytes + cell.totalTxBytes) / maxCellValue
      val baseColor = if (cell.isSelected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow
      val overlay = if (cell.isInPrimaryScope) ratio.toFloat() else 0.05f
      Surface(
        modifier = Modifier
          .height(88.dp)
          .clickable { onSelectCell(cell.rangeStart) },
        shape = RoundedCornerShape(18.dp),
        color = baseColor.copy(alpha = 0.65f + overlay * 0.3f)
      ) {
        Column(
          modifier = Modifier.padding(12.dp),
          verticalArrangement = Arrangement.SpaceBetween
        ) {
          Text(if (cell.isCurrentPeriod) "${cell.label} · 今" else cell.label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
          Column {
            Text(formatBytes(cell.totalRxBytes + cell.totalTxBytes), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
            Text("入 ${formatBytes(cell.totalRxBytes)} / 出 ${formatBytes(cell.totalTxBytes)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
          }
        }
      }
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

private fun formatPercent(value: Double?): String = if (value == null) "--" else "${"%.1f".format(value)}%"
private fun formatMHz(value: Double?): String = if (value == null) "--" else "${"%.0f".format(value)} MHz"
private fun formatCelsius(value: Double?): String = if (value == null) "--" else "${"%.1f".format(value)} °C"
private fun formatSpeed(value: Double?): String = formatBytes(value ?: 0.0) + "/s"
private fun formatDate(value: String): String = runCatching {
  java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDate().toString()
}.getOrDefault(value)
private fun formatDateInclusive(value: String): String = runCatching {
  java.time.OffsetDateTime.parse(value).minusNanos(1).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDate().toString()
}.getOrDefault(value)
private fun formatTime(value: String?): String = if (value.isNullOrBlank()) "--" else runCatching {
  val dt = java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault()).toLocalDateTime()
  "%04d-%02d-%02d %02d:%02d:%02d".format(dt.year, dt.monthValue, dt.dayOfMonth, dt.hour, dt.minute, dt.second)
}.getOrDefault(value)
private fun formatAxisTime(value: String): String = runCatching {
  val dt = java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault())
  "%02d:%02d".format(dt.hour, dt.minute)
}.getOrDefault("--")

private fun buildUsage(used: Long, total: Long): String = "${formatBytes(used.toDouble())} / ${formatBytes(total.toDouble())}"

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
