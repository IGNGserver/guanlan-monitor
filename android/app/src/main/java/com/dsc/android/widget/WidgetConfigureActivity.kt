package com.dsc.android.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dsc.android.MainActivity
import com.dsc.android.ui.oneui.GuanlanTheme
import com.dsc.android.ui.oneui.OneUiButton
import com.dsc.android.ui.oneui.OneUiButtonSize
import com.dsc.android.ui.oneui.OneUiButtonVariant
import com.dsc.android.ui.oneui.OneUiGroup
import com.dsc.android.ui.oneui.OneUiIcon
import com.dsc.android.ui.oneui.OneUiListItem
import com.dsc.android.ui.oneui.OneUiNotice
import com.dsc.android.ui.oneui.OneUiNoticeTone
import com.dsc.android.ui.oneui.OneUiSpinner
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme

/**
 * 组件配置页：添加与长按重配共用。
 *
 * 只改组件自己盯住的设备，不复制登录态，也不把中枢凭据带到配置页。
 */
class WidgetConfigureActivity : ComponentActivity() {
  private val viewModel: WidgetConfigViewModel by viewModels { WidgetConfigViewModel.Factory }
  private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID
  private var widgetKind = WidgetKind.Device

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setResult(RESULT_CANCELED)
    appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }

    val manager = AppWidgetManager.getInstance(this)
    val provider = manager.getAppWidgetInfo(appWidgetId)?.provider
    if (provider != null && provider.packageName != packageName) {
      finish()
      return
    }
    widgetKind = when (provider) {
      ComponentName(this, TrafficWidgetProvider::class.java) -> WidgetKind.Traffic
      else -> WidgetKind.Device
    }

    enableEdgeToEdge()
    setContent {
      GuanlanTheme {
        val state by viewModel.state.collectAsStateWithLifecycle()
        WidgetConfigScreen(
          state = state,
          onSelect = viewModel::select,
          onRetry = viewModel::loadDevices,
          onOpenApp = ::openApp,
          onCancel = ::cancel,
          onSave = {
            viewModel.save(appWidgetId, widgetKind) {
              setResult(
                RESULT_OK,
                Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
              )
              finish()
            }
          }
        )
      }
    }
  }

  private fun cancel() {
    setResult(RESULT_CANCELED)
    finish()
  }

  private fun openApp() {
    startActivity(
      Intent(this, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    )
  }
}

@Composable
private fun WidgetConfigScreen(
  state: WidgetConfigUiState,
  onSelect: (String) -> Unit,
  onRetry: () -> Unit,
  onOpenApp: () -> Unit,
  onCancel: () -> Unit,
  onSave: () -> Unit
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics

  Column(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.canvas)
      .safeDrawingPadding()
      .padding(horizontal = metrics.screenMargin)
      .padding(top = metrics.spaceM, bottom = metrics.spaceL)
  ) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically
    ) {
      OneUiText(
        text = "选择设备",
        role = OneUiTextRole.Headline,
        modifier = Modifier.weight(1f)
      )
      OneUiButton(
        label = "取消",
        onClick = onCancel,
        variant = OneUiButtonVariant.Text,
        size = OneUiButtonSize.Compact
      )
    }
    OneUiText(
      text = "组件会持续显示这台设备的读数；数据由中枢每 15 分钟刷新一次。",
      role = OneUiTextRole.Caption,
      color = colors.textSecondary,
      modifier = Modifier.padding(top = metrics.spaceXs, bottom = metrics.spaceL)
    )

    when {
      state.loading -> {
        Box(
          modifier = Modifier
            .fillMaxWidth()
            .weight(1f),
          contentAlignment = Alignment.Center
        ) {
          Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(metrics.spaceS)
          ) {
            OneUiSpinner()
            OneUiText(text = "正在读取设备", role = OneUiTextRole.BodySecondary, color = colors.textSecondary)
          }
        }
      }

      state.error != null && state.devices.isEmpty() -> {
        Column(
          modifier = Modifier
            .fillMaxWidth()
            .weight(1f),
          verticalArrangement = Arrangement.spacedBy(metrics.spaceM)
        ) {
          OneUiNotice(
            title = "读取失败",
            description = state.error,
            tone = OneUiNoticeTone.Warning,
            action = {
              OneUiButton(
                label = "重试",
                onClick = onRetry,
                variant = OneUiButtonVariant.Tonal,
                size = OneUiButtonSize.Compact
              )
            }
          )
          OneUiButton(
            label = "打开观澜",
            onClick = onOpenApp,
            variant = OneUiButtonVariant.Filled,
            fillWidth = true
          )
        }
      }

      state.devices.isEmpty() -> {
        OneUiNotice(
          title = "暂无设备",
          description = "中枢还没有收到设备上报。打开观澜确认连接后，再回来重试。",
          tone = OneUiNoticeTone.Info,
          action = {
            OneUiButton(
              label = "打开观澜",
              onClick = onOpenApp,
              variant = OneUiButtonVariant.Tonal,
              size = OneUiButtonSize.Compact
            )
          }
        )
      }

      else -> {
        LazyColumn(
          modifier = Modifier.weight(1f),
          verticalArrangement = Arrangement.spacedBy(metrics.spaceXs)
        ) {
          item(key = "device-list") {
            OneUiGroup {
              state.devices.forEach { device ->
                OneUiListItem(
                  title = device.hostname,
                  subtitle = WidgetFormat.deviceSubtitle(device),
                  selected = device.id == state.selectedDeviceId,
                  onClick = { onSelect(device.id) },
                  role = Role.RadioButton,
                  trailing = {
                    if (device.id == state.selectedDeviceId) {
                      OneUiIcon(
                        imageVector = Icons.Rounded.Check,
                        contentDescription = "已选择",
                        size = 18.dp,
                        tint = colors.accent
                      )
                    }
                  }
                )
              }
            }
          }
          item(key = "config-note") {
            OneUiText(
              text = "添加后可长按组件重新配置；单机与流量组件各自记住设备。",
              role = OneUiTextRole.Caption,
              color = colors.textTertiary,
              modifier = Modifier.padding(top = metrics.spaceS)
            )
          }
        }
      }
    }

    Spacer(Modifier.height(metrics.spaceM))
    OneUiButton(
      label = if (state.saving) "保存中" else "保存",
      onClick = onSave,
      enabled = state.selectedDeviceId != null && !state.saving && !state.loading,
      loading = state.saving,
      fillWidth = true
    )
  }
}
