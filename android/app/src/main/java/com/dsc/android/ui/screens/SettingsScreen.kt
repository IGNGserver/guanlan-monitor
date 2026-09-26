@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.dsc.android.ui.screens

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsc.android.AppState
import com.dsc.android.BuildConfig
import com.dsc.android.RemoteDataSource
import com.dsc.android.ui.oneui.OneUiAppearanceSetting
import com.dsc.android.ui.oneui.OneUiIconTone
import com.dsc.android.ui.oneui.OneUiDialog
import com.dsc.android.ui.oneui.OneUiGroup
import com.dsc.android.ui.oneui.OneUiGroupHeader
import com.dsc.android.ui.oneui.OneUiIconButton
import com.dsc.android.ui.oneui.OneUiLeadingIcon
import com.dsc.android.ui.oneui.OneUiLinearProgress
import com.dsc.android.ui.oneui.OneUiListDivider
import com.dsc.android.ui.oneui.OneUiListItem
import com.dsc.android.ui.oneui.OneUiButton
import com.dsc.android.ui.oneui.OneUiButtonSize
import com.dsc.android.ui.oneui.OneUiButtonVariant
import com.dsc.android.ui.oneui.OneUiNotice
import com.dsc.android.ui.oneui.OneUiNoticeTone
import com.dsc.android.ui.oneui.OneUiStatusDot
import com.dsc.android.ui.oneui.OneUiSwitch
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme
import com.dsc.android.ui.oneui.OneUiTopBar
import com.dsc.android.ui.oneui.formatBytes
import com.dsc.android.ui.oneui.formatTime
import com.dsc.android.ui.oneui.oneUiListContentPadding
import com.dsc.android.ui.oneui.rememberOneUiCollapse
import com.dsc.android.ui.shell.GuanlanActions

/**
 * 设置（构）。
 *
 * 旧版把登出、刷新、编辑、更新提示全部塞在设备列表顶栏，
 * 现在按 One UI 的层级收敛：连接、同步、外观、版本与更新各自成组，
 * 一级导航里多出“设置”目的地；设备列表只留下与列表本身相关的动作。
 * 数据语义没有变化：仍是同一份会话、同一份缓存与同一个更新接口。
 */
@Immutable
data class GuanlanAppearance(
  val setting: OneUiAppearanceSetting,
  val reduceMotion: Boolean,
  val onSetting: (OneUiAppearanceSetting) -> Unit,
  val onReduceMotion: (Boolean) -> Unit
)

@Composable
fun SettingsScreen(
  state: AppState,
  actions: GuanlanActions,
  appearance: GuanlanAppearance,
  embedded: Boolean
) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val listState = rememberLazyListState()
  val collapse = rememberOneUiCollapse(listState)
  var confirmLogout by remember { mutableStateOf(false) }

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.canvas)
  ) {
    Column(modifier = Modifier.fillMaxSize()) {
      if (!embedded) {
        OneUiTopBar(
          title = "设置",
          subtitle = "中枢连接、同步、外观与更新",
          collapse = collapse,
          large = true
        )
      }

      LazyColumn(
        state = listState,
        modifier = Modifier
          .weight(1f)
          .fillMaxWidth(),
        contentPadding = oneUiListContentPadding(),
        verticalArrangement = Arrangement.spacedBy(metrics.cardGap)
      ) {
        item(key = "hub-header") {
          OneUiGroupHeader(label = "中枢连接", description = state.serverConfig.baseUrl.ifBlank { "尚未配置中枢" })
        }

        item(key = "hub") {
          OneUiGroup {
            OneUiListItem(
              title = "会话状态",
              subtitle = sessionSubtitle(state),
              leading = {
                OneUiLeadingIcon(
                  icon = Icons.Rounded.Refresh,
                  contentDescription = null,
                  tone = when {
                    state.authenticated -> OneUiIconTone.Online
                    state.loading -> OneUiIconTone.Neutral
                    else -> OneUiIconTone.Offline
                  }
                )
              },
              trailing = {
                OneUiStatusDot(
                  color = if (state.authenticated) colors.online else colors.offline,
                  description = if (state.authenticated) "已连接" else "未连接"
                )
              }
            )
            OneUiListDivider()
            OneUiListItem(
              title = "访问密钥",
              subtitle = if (state.serverConfig.accessKey.isNotBlank()) "已保存在本机加密存储，不显示明文" else "未设置",
              leading = {
                OneUiLeadingIcon(
                  icon = Icons.Rounded.Key,
                  contentDescription = null,
                  tone = OneUiIconTone.Neutral
                )
              }
            )
            OneUiListDivider()
            OneUiListItem(
              title = "登出并清除配置",
              subtitle = "清空本地缓存与中枢地址，需要重新输入",
              onClick = { confirmLogout = true },
              trailing = {
                OneUiText(
                  text = "登出",
                  role = OneUiTextRole.ChartLabel,
                  color = colors.criticalContent,
                  weight = FontWeight.SemiBold
                )
              }
            )
          }
        }

        item(key = "sync-header") {
          OneUiGroupHeader(label = "同步与缓存")
        }

        item(key = "sync") {
          OneUiGroup {
            OneUiListItem(
              title = "自动同步",
              subtitle = "应用在前台时每 15 秒读取一次中枢数据",
              leading = {
                OneUiLeadingIcon(icon = Icons.Rounded.Timer, contentDescription = null, tone = OneUiIconTone.Neutral)
              }
            )
            OneUiListDivider()
            OneUiListItem(
              title = "立即刷新",
              subtitle = if (state.refreshing) "正在同步…" else "手动向中枢请求一次最新数据",
              onClick = { if (!state.refreshing) actions.onRefresh() },
              trailing = {
                OneUiButton(
                  label = if (state.refreshing) "同步中" else "刷新",
                  onClick = if (state.refreshing) null else actions.onRefresh,
                  variant = OneUiButtonVariant.Tonal,
                  size = OneUiButtonSize.Compact,
                  loading = state.refreshing
                )
              }
            )
            OneUiListDivider()
            OneUiListItem(
              title = "离线缓存",
              subtitle = when (state.dataSource) {
                RemoteDataSource.Cache -> "当前正在展示缓存：${formatTime(state.cacheSavedAt)}"
                RemoteDataSource.Live -> "缓存于 ${formatTime(state.cacheSavedAt)}"
                RemoteDataSource.Empty -> "本机暂无缓存数据"
              }
            )
          }
        }

        item(key = "appearance-header") {
          OneUiGroupHeader(label = "外观", description = "深浅色、投影层级与动效强度")
        }

        item(key = "appearance") {
          OneUiGroup {
            OneUiAppearanceSetting.entries.forEachIndexed { index, setting ->
              val description = setting.description
              if (index > 0) OneUiListDivider()
              val selected = appearance.setting == setting
              Row(
                modifier = Modifier
                  .fillMaxWidth()
                  .selectable(
                    selected = selected,
                    onClick = { appearance.onSetting(setting) },
                    role = androidx.compose.ui.semantics.Role.RadioButton
                  )
                  .padding(horizontal = metrics.rowPadding, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(metrics.rowIconGap)
              ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                  OneUiText(text = setting.label, role = OneUiTextRole.RowTitle)
                  OneUiText(
                    text = description,
                    role = OneUiTextRole.RowSubtitle,
                    color = colors.textSecondary
                  )
                }
                if (selected) {
                  Icon(
                    imageVector = Icons.Rounded.Check,
                    contentDescription = "已选择",
                    tint = colors.accent,
                    modifier = Modifier.size(22.dp)
                  )
                }
              }
            }
            OneUiListDivider()
            OneUiListItem(
              title = "减少动画",
              subtitle = "页面转场、图表描线与状态过渡改为直接切换",
              onClick = { appearance.onReduceMotion(!appearance.reduceMotion) },
              trailing = {
                OneUiSwitch(
                  checked = appearance.reduceMotion,
                  onCheckedChange = appearance.onReduceMotion,
                  label = "减少动画"
                )
              }
            )
          }
        }

        item(key = "update-header") {
          OneUiGroupHeader(label = "版本与更新")
        }

        item(key = "update") {
          val update = state.updateInfo
          OneUiGroup {
            OneUiListItem(
              title = "客户端版本",
              subtitle = "v${BuildConfig.RELEASE_VERSION} · ${channelLabel(BuildConfig.RELEASE_CHANNEL)}"
            )
            if (update?.available == true) {
              OneUiListDivider()
              Column(modifier = Modifier.padding(horizontal = metrics.rowPadding, vertical = 12.dp)) {
                OneUiNotice(
                  title = "发现新版本 v${update.latestVersion ?: ""}",
                  description = updateInfoDescription(update),
                  tone = OneUiNoticeTone.Info,
                  icon = Icons.Rounded.Download
                )
                if (state.updateDownloading) {
                  Spacer(Modifier.height(metrics.spaceS))
                  OneUiLinearProgress(fraction = state.updateProgress)
                  OneUiText(
                    text = "下载进度 ${(state.updateProgress * 100).toInt()}%",
                    role = OneUiTextRole.ChartLabel,
                    color = colors.textSecondary,
                    modifier = Modifier.padding(top = 4.dp)
                  )
                }
                Spacer(Modifier.height(metrics.spaceS))
                OneUiButton(
                  label = if (state.updateDownloading) "下载中" else "下载并安装",
                  onClick = if (state.updateDownloading) null else actions.onDownloadUpdate,
                  fillWidth = true,
                  loading = state.updateDownloading
                )
              }
            } else {
              OneUiListDivider()
              OneUiListItem(
                title = "检查更新",
                subtitle = update?.message ?: "下次同步时向中枢确认是否有新的安装包",
                onClick = { if (!state.refreshing) actions.onRefresh() }
              )
            }
          }
        }

        item(key = "help-header") {
          OneUiGroupHeader(label = "使用说明")
        }

        item(key = "help") {
          OneUiGroup {
            OneUiListItem(
              title = "编辑记录项",
              subtitle = "在设备行长按，或在设备详情底部进入，可勾选要采集的指标与实例",
              onClick = {
                state.selectedDeviceId?.let { actions.onOpenDeviceEditor(it) }
              }
            )
            OneUiListDivider()
            OneUiListItem(
              title = "数据来源",
              subtitle = "客户端只读取中枢已有的数据，不会向设备下发任何配置"
            )
          }
        }
      }
    }
  }

  if (confirmLogout) {
    OneUiDialog(
      onDismissRequest = { confirmLogout = false },
      title = "登出并清除配置？",
      description = "登出后会清空本地缓存与中枢配置，需要重新输入中枢地址和访问密钥。",
      confirmLabel = "登出",
      onConfirm = {
        confirmLogout = false
        actions.onLogout()
      },
      dismissLabel = "取消",
      onDismiss = { confirmLogout = false },
      destructive = true
    )
  }
}

private fun sessionSubtitle(state: AppState): String = when {
  state.authenticated && state.dataSource == RemoteDataSource.Live -> "已连接，正在实时同步"
  state.authenticated && state.dataSource == RemoteDataSource.Cache -> "已连接，当前使用离线缓存"
  state.authenticated -> "已连接"
  state.loading -> "正在恢复会话"
  state.serverConfig.baseUrl.isNotBlank() -> "连接失败，请检查地址、密钥与网络"
  else -> "尚未连接中枢"
}

private fun channelLabel(channel: String): String = when (channel) {
  "stable" -> "正式渠道"
  "test" -> "测试渠道"
  else -> channel
}

private fun updateInfoDescription(update: com.dsc.android.UpdateInfoDto): String = buildString {
  update.publishedAt?.takeIf { it.isNotBlank() }?.let {
    append("发布 ")
    append(formatTime(it))
    append(" · ")
  }
  update.assetSize?.takeIf { it > 0 }?.let {
    append("大小 ")
    append(formatBytes(it.toDouble()))
    append(" · ")
  }
  append("下载完成后由系统安装器接管授权")
}
