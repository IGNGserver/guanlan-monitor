package com.dsc.android

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RemoteSnapshotCacheTest {
  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
  }

  @Test
  fun snapshotRoundTripDoesNotPersistCredentials() {
    val snapshot = CachedRemoteSnapshot(
      savedAt = "2026-08-21T00:00:00Z",
      devices = listOf(
        DeviceSummaryDto(
          deviceId = "device-1",
          hostname = "workstation",
          os = "windows",
          status = "online"
        )
      ),
      selectedDeviceId = "device-1",
      selectedWindow = "5m"
    )

    val encoded = json.encodeToString(snapshot)
    val decoded = json.decodeFromString<CachedRemoteSnapshot>(encoded)

    assertFalse(encoded.contains("accessKey"))
    assertEquals(snapshot.savedAt, decoded.savedAt)
    assertEquals(snapshot.selectedDeviceId, decoded.selectedDeviceId)
    assertEquals(snapshot.selectedWindow, decoded.selectedWindow)
    assertEquals(snapshot.devices.single().hostname, decoded.devices.single().hostname)
  }
}
