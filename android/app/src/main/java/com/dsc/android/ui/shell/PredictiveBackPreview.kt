package com.dsc.android.ui.shell

import com.dsc.android.AppScreen

/**
 * Resolve the underlay used by Android's predictive-back gesture.
 *
 * The previous route is already composed as AnimatedContent's outgoing content
 * during a screen transition. Composing it again under the same
 * SaveableStateHolder key can crash Compose, so the underlay is only mounted
 * during a settled, active back gesture.
 */
internal fun resolvePredictiveBackPreviewScreen(
  screen: AppScreen,
  backStack: List<AppScreen>,
  gestureProgress: Float,
  blockingUiVisible: Boolean,
  useTwoPane: Boolean,
  screenTransitionRunning: Boolean
): AppScreen? {
  if (
    gestureProgress <= 0f ||
    blockingUiVisible ||
    useTwoPane ||
    screenTransitionRunning ||
    screen == AppScreen.Login ||
    screen == AppScreen.DeviceList
  ) {
    return null
  }

  return backStack.lastOrNull() ?: AppScreen.DeviceList
}
