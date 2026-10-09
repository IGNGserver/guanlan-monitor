package com.dsc.android.ui.shell

import androidx.activity.compose.BackHandler
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Transition
import androidx.compose.animation.core.updateTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Hub
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarData
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.SaveableStateHolder
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dsc.android.AppScreen
import com.dsc.android.AppState
import com.dsc.android.RemoteDataSource
import com.dsc.android.ScreenTransitionDirection
import com.dsc.android.ui.oneui.GuanlanTheme
import com.dsc.android.ui.oneui.OneUiAnnouncer
import com.dsc.android.ui.oneui.OneUiAppearanceSetting
import com.dsc.android.ui.oneui.OneUiBottomBar
import com.dsc.android.ui.oneui.OneUiDestination
import com.dsc.android.ui.oneui.OneUiDialog
import com.dsc.android.ui.oneui.OneUiEmptyState
import com.dsc.android.ui.oneui.OneUiNavigationRail
import com.dsc.android.ui.oneui.OneUiPredictiveBackProgress
import com.dsc.android.ui.oneui.OneUiSpinner
import com.dsc.android.ui.oneui.OneUiText
import com.dsc.android.ui.oneui.OneUiTextRole
import com.dsc.android.ui.oneui.OneUiTheme
import com.dsc.android.ui.oneui.rememberOneUiAppearanceController
import com.dsc.android.ui.oneui.oneUiScreenTransition
import com.dsc.android.ui.screens.DeviceDetailScreen
import com.dsc.android.ui.screens.DeviceListScreen
import com.dsc.android.ui.screens.GuanlanAppearance
import com.dsc.android.ui.screens.MetricConfigSheet
import com.dsc.android.ui.screens.OnboardingScreen
import com.dsc.android.ui.screens.SettingsScreen
import com.dsc.android.ui.screens.TrafficScreen
import kotlinx.coroutines.launch

/**
 * 应用外壳（构）。
 *
 * One UI 的信息架构在这里固定下来：
 * 1. 登录态是引导页，不参与一级导航；
 * 2. 一级目的地（设备 / 设置）常驻底部拇指区，展开态换成同一组目的地的侧栏；
 * 3. 设备详情与流量是子页面，进入后不再携带一级导航，避免两级导航叠加；
 * 4. 展开态使用列表—详情双栏，而不是把详情推到屏幕之外（适）。
 */
@Composable
fun GuanlanApp(state: AppState, actions: GuanlanActions) {
  val controller = rememberOneUiAppearanceController()
  val setting by controller.settings.collectAsStateWithLifecycle(initialValue = OneUiAppearanceSetting.FollowSystem)
  val reduceMotion by controller.reduceAnimations.collectAsStateWithLifecycle(initialValue = false)
  val scope = rememberCoroutineScope()

  val appearance = GuanlanAppearance(
    setting = setting,
    reduceMotion = reduceMotion,
    onSetting = { next -> scope.launch { controller.update(next) } },
    onReduceMotion = { next -> scope.launch { controller.setReduceAnimations(next) } }
  )

  GuanlanTheme(appearance = setting, reduceMotionOverride = reduceMotion) {
    GuanlanShell(state = state, actions = actions, appearance = appearance)
  }
}

@Composable
private fun GuanlanShell(state: AppState, actions: GuanlanActions, appearance: GuanlanAppearance) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  val window = OneUiTheme.window
  val snackbarHostState = remember { SnackbarHostState() }
  val saveableStateHolder = rememberSaveableStateHolder()
  var pendingLogout by remember { mutableStateOf(false) }

  // 边到边下状态栏图标必须由应用决定明暗：用户在应用内选了深色而系统仍是浅色时，
  // enableEdgeToEdge 会把图标留在深色，全黑顶栏上就什么都看不见了（适）
  val decorView = LocalView.current
  val androidWindow = (decorView.context as? android.app.Activity)?.window
  SideEffect {
    androidWindow?.let { target ->
      val lightBars = !colors.isDark && !colors.isExtraDark
      androidx.core.view.WindowCompat.getInsetsController(target, target.decorView).apply {
        isAppearanceLightStatusBars = lightBars
        isAppearanceLightNavigationBars = lightBars
      }
    }
  }

  val screen = state.resolvedScreen()
  val screenTransition = updateTransition(targetState = screen, label = "screen_stack")
  var gestureProgress by remember { mutableStateOf(0f) }
  var gestureSwipeEdge by remember { mutableStateOf(0) }
  val canHandleBack = pendingLogout ||
    state.editingDeviceId != null ||
    (screen != AppScreen.DeviceList && screen != AppScreen.Login)
  val predictiveBackPreview = resolvePredictiveBackPreviewScreen(
    screen = screen,
    backStack = state.screenBackStack,
    gestureProgress = gestureProgress,
    blockingUiVisible = pendingLogout || state.editingDeviceId != null,
    useTwoPane = window.useTwoPane,
    screenTransitionRunning = screenTransition.isRunning
  )

  val destinations = remember { oneUiDestinations() }

  LaunchedEffect(state.message) {
    val message = state.message ?: return@LaunchedEffect
    // 只有真正被吞掉的消息才回收：取消（新消息插进来）必须把上一条留给下一次循环，
    // 否则会连着丢掉提示（交）。
    try {
      snackbarHostState.showSnackbar(message, duration = SnackbarDuration.Short)
    } catch (cancelled: kotlinx.coroutines.CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      // SnackbarHost 尚未组合时（例如后台刷新）不阻塞消息回收
    }
    actions.onConsumeMessage()
  }

  LaunchedEffect(state.updateInstallerUri) {
    state.updateInstallerUri?.let { uri ->
      actions.onLaunchUpdateInstaller(uri)
      actions.onUpdateInstallerLaunched()
    }
  }

  val motion = OneUiTheme.motion

  PredictiveBackHandler(enabled = canHandleBack) { progressFlow ->
    try {
      progressFlow.collect { backEvent ->
        gestureSwipeEdge = backEvent.swipeEdge
        gestureProgress = backEvent.progress
      }
      // 手势确认完成
      gestureProgress = 0f
      if (pendingLogout) {
        pendingLogout = false
      } else {
        actions.onSystemBack()
      }
    } catch (_: kotlinx.coroutines.CancellationException) {
      // 用户划到一半又收回（取消返回）：平滑回弹到原位，不阻塞下次手势
      gestureProgress = 0f
    } finally {
      gestureProgress = 0f
    }
  }

  val predictive = OneUiPredictiveBackProgress(
    progress = gestureProgress,
    swipeEdge = gestureSwipeEdge
  )
  val animatedScale by androidx.compose.animation.core.animateFloatAsState(
    targetValue = predictive.scale,
    animationSpec = motion.spring(dampingRatio = 0.82f, stiffness = androidx.compose.animation.core.Spring.StiffnessMediumLow),
    label = "predictive_scale"
  )
  val animatedTranslationX by androidx.compose.animation.core.animateFloatAsState(
    targetValue = predictive.translationX,
    animationSpec = motion.spring(dampingRatio = 0.82f, stiffness = androidx.compose.animation.core.Spring.StiffnessMediumLow),
    label = "predictive_tx"
  )
  val animatedAlpha by androidx.compose.animation.core.animateFloatAsState(
    targetValue = predictive.contentAlpha,
    animationSpec = motion.spring(dampingRatio = 0.82f, stiffness = androidx.compose.animation.core.Spring.StiffnessMediumLow),
    label = "predictive_alpha"
  )

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(colors.canvas)
  ) {
    // 单 Activity 内的页面切换不会自动提供系统级的“上一页”表面。
    // 预见式返回期间先绘制上一条路由，再让当前路由带透明度缩放离开，
    // 底层页面因此仍由同一个实时 AppState 驱动，而不是静态截图（交）。
    predictiveBackPreview?.let { preview ->
      ShellLayer(
        state = state,
        actions = actions,
        screen = preview,
        screenTransition = screenTransition,
        twoPane = false,
        appearance = appearance,
        destinations = destinations,
        saveableStateHolder = saveableStateHolder,
        animateTransitions = false,
        // 预览层只负责视觉，不应在正常状态下重复出现在 TalkBack 节点树里（适）。
        modifier = Modifier
          .fillMaxSize()
          .clearAndSetSemantics { }
          .pointerInput("predictive-back-preview") {
            awaitPointerEventScope {
              while (true) {
                awaitPointerEvent(PointerEventPass.Initial).changes.forEach { change ->
                  change.consume()
                }
              }
            }
          }
      )
    }

    ShellLayer(
      state = state,
      actions = actions,
      screen = screen,
      screenTransition = screenTransition,
      twoPane = window.useTwoPane,
      appearance = appearance,
      destinations = destinations,
      saveableStateHolder = saveableStateHolder,
      animateTransitions = true,
      modifier = Modifier
        .fillMaxSize()
        .graphicsLayer {
          alpha = animatedAlpha
          scaleX = animatedScale
          scaleY = animatedScale
          translationX = animatedTranslationX
        }
    )

    // 消息条落在拇指区、贴着底部导航上方，并且不吃掉系统手势条（构 + 适）
    Box(
      modifier = Modifier
        .align(Alignment.BottomCenter)
        .navigationBarsPadding()
        .padding(
          start = metrics.screenMargin,
          end = metrics.screenMargin,
          bottom = if (screen.showsTopLevelNavigation) {
            metrics.bottomBarHeight + metrics.spaceM
          } else {
            metrics.spaceXl
          }
        )
    ) {
      SnackbarHost(hostState = snackbarHostState) { data -> OneUiSnackbar(data) }
    }

    // 常驻状态用独立播报区，避免与 Snackbar 重复朗读（适）
    OneUiAnnouncer(message = state.announcement)

    if (pendingLogout) {
      OneUiDialog(
        onDismissRequest = { pendingLogout = false },
        title = "登出并清除配置？",
        description = "登出后会清空本地缓存与中枢配置，需要重新输入中枢地址和访问密钥。",
        confirmLabel = "登出",
        onConfirm = {
          pendingLogout = false
          actions.onLogout()
        },
        dismissLabel = "取消",
        onDismiss = { pendingLogout = false },
        destructive = true
      )
    }
  }

  if (state.editingDeviceId != null && state.metricConfig != null) {
    MetricConfigSheet(
      state = state,
      actions = actions,
      onDismiss = actions.onCloseMetricConfigEditor
    )
  }
}

private val DestinationDevices = "devices"
private val DestinationSettings = "settings"

@Composable
private fun ShellLayer(
  state: AppState,
  actions: GuanlanActions,
  screen: AppScreen,
  screenTransition: Transition<AppScreen>,
  twoPane: Boolean,
  appearance: GuanlanAppearance,
  destinations: List<OneUiDestination>,
  saveableStateHolder: SaveableStateHolder,
  animateTransitions: Boolean,
  modifier: Modifier = Modifier
) {
  val colors = OneUiTheme.colors
  val window = OneUiTheme.window

  Box(
    modifier = modifier.background(colors.canvas)
  ) {
    if (window.useNavigationRail) {
      Row(modifier = Modifier.fillMaxSize()) {
        OneUiNavigationRail(
          destinations = destinations,
          selectedKey = screen.navigationKey(),
          onSelect = { key ->
            if (key == DestinationSettings) actions.onShowSettings() else actions.onShowDeviceList()
          },
          modifier = Modifier.fillMaxHeight()
        )
        Box(
          modifier = Modifier
            .weight(1f)
            .fillMaxHeight()
        ) {
          ScreenStack(
            state = state,
            actions = actions,
            screen = screen,
            screenTransition = screenTransition,
            twoPane = twoPane,
            appearance = appearance,
            saveableStateHolder = saveableStateHolder,
            animateTransitions = animateTransitions
          )
        }
      }
    } else {
      Column(modifier = Modifier.fillMaxSize()) {
        Box(
          modifier = Modifier
            .weight(1f)
            .fillMaxHeight()
        ) {
          ScreenStack(
            state = state,
            actions = actions,
            screen = screen,
            screenTransition = screenTransition,
            twoPane = false,
            appearance = appearance,
            saveableStateHolder = saveableStateHolder,
            animateTransitions = animateTransitions
          )
        }
        if (screen.showsTopLevelNavigation) {
          OneUiBottomBar(
            destinations = destinations,
            selectedKey = screen.navigationKey(),
            onSelect = { key ->
              if (key == DestinationSettings) actions.onShowSettings() else actions.onShowDeviceList()
            }
          )
        }
      }
    }
  }
}

@Composable
private fun ScreenStack(
  state: AppState,
  actions: GuanlanActions,
  screen: AppScreen,
  screenTransition: Transition<AppScreen>,
  twoPane: Boolean,
  appearance: GuanlanAppearance,
  saveableStateHolder: SaveableStateHolder,
  animateTransitions: Boolean
) {
  val colors = OneUiTheme.colors
  val motion = OneUiTheme.motion

  @Composable
  fun SavedScreenContent(target: AppScreen, embedded: Boolean) {
    saveableStateHolder.SaveableStateProvider(
      key = screenStateKey(target, state)
    ) {
      ScreenContent(
        state = state,
        actions = actions,
        screen = target,
        embedded = embedded,
        appearance = appearance
      )
    }
  }

  if (twoPane && screen != AppScreen.Login) {
    Row(modifier = Modifier.fillMaxSize()) {
      Box(
        modifier = Modifier
          .width(380.dp)
          .fillMaxHeight()
          .background(colors.canvas)
      ) {
        saveableStateHolder.SaveableStateProvider(
          key = screenStateKey(AppScreen.DeviceList, state)
        ) {
          DeviceListScreen(state = state, actions = actions, embedded = true)
        }
      }
      Box(
        modifier = Modifier
          .weight(1f)
          .fillMaxHeight()
          .background(colors.canvas)
      ) {
        when {
          screen.showsDetail -> SavedScreenContent(screen, embedded = true)

          screen == AppScreen.Settings -> SavedScreenContent(screen, embedded = true)

          else -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            OneUiEmptyState(
              title = "选择一台设备",
              description = "在左侧选择设备，即可查看 CPU、显卡、内存、硬盘、网络、温度与风扇指标。",
              icon = Icons.Rounded.Hub
            )
          }
        }
      }
    }
    return
  }

  if (animateTransitions) {
    screenTransition.AnimatedContent(
      transitionSpec = {
        oneUiScreenTransition(
          forward = state.transitionDirection != ScreenTransitionDirection.Backward,
          motion = motion
        )
      },
      label = "screen_stack"
    ) { target ->
      SavedScreenContent(target, embedded = false)
    }
  } else {
    SavedScreenContent(screen, embedded = false)
  }
}

private fun screenStateKey(screen: AppScreen, state: AppState): String = when (screen) {
  AppScreen.DeviceDetail -> "device-detail:${state.selectedDeviceId ?: "none"}"
  AppScreen.Traffic -> "traffic:${state.selectedDeviceId ?: "none"}"
  else -> "screen:${screen.name}"
}

@Composable
private fun ScreenContent(
  state: AppState,
  actions: GuanlanActions,
  screen: AppScreen,
  embedded: Boolean,
  appearance: GuanlanAppearance
) {
  when (screen) {
    AppScreen.Login -> if (state.loading) {
      SplashScreen()
    } else {
      OnboardingScreen(state = state, actions = actions)
    }

    AppScreen.DeviceList -> DeviceListScreen(state = state, actions = actions, embedded = embedded)
    AppScreen.DeviceDetail -> DeviceDetailScreen(state = state, actions = actions, embedded = embedded)
    AppScreen.Traffic -> TrafficScreen(state = state, actions = actions, embedded = embedded)
    AppScreen.Settings -> SettingsScreen(
      state = state,
      actions = actions,
      appearance = appearance,
      embedded = embedded
    )
  }
}

@Composable
private fun SplashScreen() {
  val colors = OneUiTheme.colors
  Box(modifier = Modifier.fillMaxSize().background(colors.canvas), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
      OneUiSpinner(size = 30.dp, color = colors.accent)
      OneUiText(text = "正在恢复会话", role = OneUiTextRole.RowSubtitle, color = colors.textSecondary)
    }
  }
}

/** One UI 的消息条：胶囊容器 + 单行可读文本（件）。 */
@Composable
private fun OneUiSnackbar(data: SnackbarData) {
  val colors = OneUiTheme.colors
  val metrics = OneUiTheme.metrics
  Box(
    modifier = Modifier
      .background(colors.raised, OneUiTheme.shapes.pill)
      .padding(horizontal = metrics.spaceM, vertical = 13.dp)
      .semantics { contentDescription = data.visuals.message }
  ) {
    OneUiText(
      text = data.visuals.message,
      role = OneUiTextRole.RowSubtitle,
      color = colors.textPrimary,
      maxLines = 2
    )
  }
}

private val AppScreen.showsDetail: Boolean
  get() = this == AppScreen.DeviceDetail || this == AppScreen.Traffic

private val AppScreen.showsTopLevelNavigation: Boolean
  get() = this == AppScreen.DeviceList || this == AppScreen.Settings

private fun AppScreen.navigationKey(): String = if (this == AppScreen.Settings) DestinationSettings else DestinationDevices

private fun oneUiDestinations(): List<OneUiDestination> = listOf(
  OneUiDestination(key = DestinationDevices, label = "设备", icon = Icons.Rounded.Hub),
  OneUiDestination(key = DestinationSettings, label = "设置", icon = Icons.Rounded.Tune)
)

/**
 * 屏幕路由推导：
 * 1. loading 时显示 Login（开屏）；
 * 2. 未配置中枢地址且未认证时进入 Login；
 * 3. 有离线缓存或已认证时，用户自由浏览当前屏幕；
 * 4. 其它未认证态显示设备列表（用于呈现连接过程或失败状态与重试）。
 */
private fun AppState.resolvedScreen(): AppScreen = when {
  loading -> AppScreen.Login
  !authenticated && serverConfig.baseUrl.isBlank() -> AppScreen.Login
  currentScreen != AppScreen.Login -> currentScreen
  else -> AppScreen.Login
}

/** 常驻状态播报给读屏；即时反馈由 Snackbar 承担，两者不重复（适）。 */
private val AppState.announcement: String?
  get() = when {
    refreshing -> "正在同步中枢数据"
    !loading && dataSource == RemoteDataSource.Cache -> "当前显示离线缓存数据"
    else -> null
  }
