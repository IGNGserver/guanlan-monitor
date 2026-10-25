package com.dsc.android

import android.content.Context
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DeviceUpdatesTest {
  private val context: Context get() = RuntimeEnvironment.getApplication()
  private val prefs get() = context.getSharedPreferences("device_updates", Context.MODE_PRIVATE)
  @Before fun clearPreferences() { prefs.edit().clear().commit() }
  private fun release(version: String, preview: Boolean) = """{"tag_name":"v$version","html_url":"https://github.com/IGNGserver/guanlan-monitor/releases/tag/v$version","draft":false,"prerelease":$preview,"assets":[{"name":"DeviceStateConsole-Android-v$version.apk","size":100,"state":"uploaded","browser_download_url":"https://github.com/IGNGserver/guanlan-monitor/releases/download/v$version/package.apk","digest":"sha256:${"a".repeat(64)}"}]}"""
  private fun feed() = """{"schemaVersion":1,"repository":"IGNGserver/guanlan-monitor","generatedAt":"2026-10-25T12:00:00Z","releases":[${release("999.0.0", false)},${release("999.1.0", true)}]}"""

  @Test fun selectionAndEtagWorkWithoutHubCredentials() = runTest {
    var calls = 0
    val client = OkHttpClient.Builder().addInterceptor { chain ->
      calls++
      assertEquals("raw.githubusercontent.com", chain.request().url.host)
      assertNull(chain.request().header("Authorization")); assertNull(chain.request().header("Cookie"))
      if (calls == 2) assertEquals("\"feed1\"", chain.request().header("If-None-Match"))
      Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).message("fixture")
        .code(if (calls == 1) 200 else 304).header("ETag", "\"feed1\"").body((if (calls == 1) feed() else "").toResponseBody()).build()
    }.build()
    val service = DeviceUpdates(context, client)
    service.channel = "stable"
    assertEquals("999.0.0", service.check(true).latestVersion)
    service.channel = "preview"
    assertEquals("999.1.0", service.check(true).latestVersion)
    assertEquals(1, calls)
    prefs.edit().putLong("nextRequest", 0).putLong("nextAuto", 0).commit()
    assertEquals("999.1.0", DeviceUpdates(context, client).check(true).latestVersion)
    assertEquals(2, calls)
  }

  @Test fun retryAfterSurvivesRestartAndOversizedFeedIsRejected() = runTest {
    var calls = 0
    val limited = OkHttpClient.Builder().addInterceptor { chain -> calls++
      Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).message("limited").code(429).header("Retry-After", "3600").body("".toResponseBody()).build()
    }.build()
    assertFalse(DeviceUpdates(context, limited).check(true).available)
    assertFalse(DeviceUpdates(context, limited).check(true).available)
    assertEquals(1, calls)
    assertTrue(prefs.getLong("nextRequest", 0) > System.currentTimeMillis() + 3500_000)
    prefs.edit().clear().commit()
    val large = OkHttpClient.Builder().addInterceptor { chain -> Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).message("large").code(200).body(" ".repeat(4 * 1024 * 1024 + 1).toResponseBody()).build() }.build()
    assertFalse(DeviceUpdates(context, large).check(true).available)
    assertNull(prefs.getString("feed", null))
  }

  @Test fun packageRedirectsRejectInsecureOrUntrustedDestinations() {
    var calls = 0
    val client = OkHttpClient.Builder().followRedirects(false).addInterceptor { chain -> calls++
      Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).message("redirect").code(302)
        .header("Location", "http://evil.invalid/package.apk").body("".toResponseBody()).build()
    }.build()
    val source = object : DeviceUpdateSource {
      override var channel = "preview"
      override val downloadClient = client
      override suspend fun check(manual: Boolean) = UpdateInfoDto()
      override fun validatePackage(file: File, update: UpdateInfoDto) {}
    }
    assertThrows(IllegalStateException::class.java) { source.openDownload("https://github.com/IGNGserver/guanlan-monitor/releases/download/v1.0.0/package.apk") }
    assertEquals(1, calls)
    assertThrows(IllegalStateException::class.java) { source.openDownload("http://github.com/IGNGserver/guanlan-monitor/releases/download/v1.0.0/package.apk") }
    assertEquals(1, calls)
  }
}
