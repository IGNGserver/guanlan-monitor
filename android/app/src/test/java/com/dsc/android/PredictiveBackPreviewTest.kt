package com.dsc.android

import com.dsc.android.ui.shell.resolvePredictiveBackPreviewScreen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PredictiveBackPreviewTest {
  @Test
  fun previewIsNotComposedWhileScreenIsIdle() {
    assertNull(
      resolvePredictiveBackPreviewScreen(
        screen = AppScreen.Settings,
        backStack = listOf(AppScreen.DeviceList),
        gestureProgress = 0f,
        blockingUiVisible = false,
        useTwoPane = false,
        screenTransitionRunning = false
      )
    )
  }

  @Test
  fun activeGesturePreviewsThePreviousRouteAfterTransitionSettles() {
    assertEquals(
      AppScreen.Settings,
      resolvePredictiveBackPreviewScreen(
        screen = AppScreen.DeviceDetail,
        backStack = listOf(AppScreen.DeviceList, AppScreen.Settings),
        gestureProgress = 0.25f,
        blockingUiVisible = false,
        useTwoPane = false,
        screenTransitionRunning = false
      )
    )
  }

  @Test
  fun previewIsSuppressedDuringRouteTransition() {
    assertNull(
      resolvePredictiveBackPreviewScreen(
        screen = AppScreen.Settings,
        backStack = listOf(AppScreen.DeviceList),
        gestureProgress = 0.25f,
        blockingUiVisible = false,
        useTwoPane = false,
        screenTransitionRunning = true
      )
    )
  }

  @Test
  fun previewIsSuppressedForBlockingUiAndTwoPaneLayout() {
    val gestureProgress = 0.25f
    val backStack = listOf(AppScreen.DeviceList)

    assertNull(
      resolvePredictiveBackPreviewScreen(
        screen = AppScreen.Settings,
        backStack = backStack,
        gestureProgress = gestureProgress,
        blockingUiVisible = true,
        useTwoPane = false,
        screenTransitionRunning = false
      )
    )
    assertNull(
      resolvePredictiveBackPreviewScreen(
        screen = AppScreen.Settings,
        backStack = backStack,
        gestureProgress = gestureProgress,
        blockingUiVisible = false,
        useTwoPane = true,
        screenTransitionRunning = false
      )
    )
  }
}
