package com.dsc.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Hub
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.dsc.android.AppState
import com.dsc.android.ui.oneui.OneUiButton
import com.dsc.android.ui.oneui.OneUiButtonSize
import com.dsc.android.ui.oneui.OneUiGroup
import com.dsc.android.ui.oneui.OneUiIconTone
import com.dsc.android.ui.oneui.OneUiLeadingIcon
import com.dsc.android.ui.oneui.OneUiNotice
import com.dsc.android.ui.oneui.OneUiNoticeTone
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextField
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme
import com.dsc.android.ui.shell.GuanlanActions

/**
 * 连接引导页（构）。
 *
 * 旧版是居中堆叠的两个输入框，不符合 One UI 的组织方式：One UI 把这类页面当“引导”——
 * 标题留在上方、说明紧随其后、字段成组、主行动按钮固定在底部拇指区。
 * 业务语义不变：仍然是保存中枢地址与访问密钥并立即连接。
 */
@Composable
fun OnboardingScreen(
  state: AppState,
  actions: GuanlanActions
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val window = OneUiTheme.window
  var baseUrl by remember(state.serverConfig.baseUrl) { mutableStateOf(state.serverConfig.baseUrl) }
  var accessKey by remember(state.serverConfig.accessKey) { mutableStateOf(state.serverConfig.accessKey) }
  val busy = state.savingConfig || state.loggingIn
  val canSubmit = baseUrl.isNotBlank() && accessKey.isNotBlank() && !busy

  Column(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.canvas)
      .imePadding()
  ) {
    Column(
      modifier = Modifier
        .weight(1f)
        .verticalScroll(rememberScrollState())
        .padding(horizontal = metrics.screenMargin),
      verticalArrangement = Arrangement.Top
    ) {
      Spacer(Modifier.height(metrics.spaceXxxl))
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OneUiLeadingIcon(icon = Icons.Rounded.Hub, contentDescription = null, tone = OneUiIconTone.Accent)
        OneUiText(
          text = "观澜",
          role = OneUiTextRole.RowSubtitle,
          color = colors.textSecondary,
          weight = FontWeight.SemiBold
        )
      }
      Spacer(Modifier.height(metrics.spaceM))
      OneUiText(text = "连接到中枢", role = OneUiTextRole.Display, maxLines = 2)
      Spacer(Modifier.height(metrics.spaceXs))
      OneUiText(
        text = "先连接观澜中枢，再查看设备状态与历史指标。地址决定连接到哪台中枢，访问密钥用于验证权限。",
        role = OneUiTextRole.Body,
        color = colors.textSecondary
      )
      Spacer(Modifier.height(metrics.spaceXl))

      if (state.serverConfig.baseUrl.isNotBlank() && !state.authenticated) {
        OneUiNotice(
          title = "正在使用已保存的配置重连",
          description = state.serverConfig.baseUrl,
          tone = OneUiNoticeTone.Info,
          modifier = Modifier.padding(bottom = metrics.spaceM)
        )
      }

      if (!state.message.isNullOrBlank()) {
        OneUiNotice(
          title = "上一次连接未成功",
          description = state.message,
          tone = OneUiNoticeTone.Critical,
          modifier = Modifier.padding(bottom = metrics.spaceM)
        )
      }

      OneUiGroup {
        Column(
          modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = metrics.groupPadding, vertical = metrics.spaceM),
          verticalArrangement = Arrangement.spacedBy(metrics.spaceM)
        ) {
          OneUiTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it },
            label = "中枢地址",
            supportingText = "例如 http://192.168.1.10:3100 或 https://你的域名",
            enabled = !busy,
            imeAction = ImeAction.Next
          )
          OneUiTextField(
            value = accessKey,
            onValueChange = { accessKey = it },
            label = "访问密钥",
            password = true,
            enabled = !busy,
            imeAction = ImeAction.Done,
            supportingText = "与中枢的访问密钥一致，仅保存在本机加密存储中。",
            onVisibleToggle = {}
          )
        }
      }
      Spacer(Modifier.height(metrics.spaceXxl))
    }

    // 底部行动区：主行动固定在拇指可及处（构 + 交）
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .background(colors.canvas)
        .padding(horizontal = metrics.screenMargin, vertical = metrics.spaceM),
      verticalArrangement = Arrangement.spacedBy(metrics.spaceXs),
      horizontalAlignment = Alignment.Start
    ) {
      OneUiButton(
        label = when {
          state.savingConfig -> "保存中"
          state.loggingIn -> "连接中"
          else -> "保存并连接"
        },
        onClick = if (canSubmit) {
          { actions.onSaveServerConfig(baseUrl, accessKey) }
        } else {
          null
        },
        fillWidth = true,
        size = OneUiButtonSize.Regular,
        loading = busy,
        enabled = busy || canSubmit
      )
      OneUiText(
        text = if (canSubmit || busy) "" else "请填写中枢地址与访问密钥。",
        role = OneUiTextRole.Caption,
        color = colors.textTertiary
      )
    }
  }
}

