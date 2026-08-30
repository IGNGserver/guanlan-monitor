package com.dsc.android

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.IOException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "dsc_android_settings")

interface DeviceStateApi {
  @POST("/api/auth/login")
  suspend fun login(@Body payload: LoginRequestDto): LoginResponseDto

  @POST("/api/auth/logout")
  suspend fun logout(): LoginResponseDto

  @GET("/api/auth/session")
  suspend fun session(): LoginResponseDto

  @GET("/api/updates")
  suspend fun updateInfo(
    @Query("platform") platform: String,
    @Query("currentVersion") currentVersion: String,
    @Query("currentChannel") currentChannel: String,
    @Query("arch") arch: String
  ): UpdateInfoDto

  @GET("/api/instances")
  suspend fun devices(): List<DeviceSummaryDto>

  @GET("/api/overview/metrics")
  suspend fun overviewMetrics(@Query("window") window: String): OverviewMetricsDto

  @retrofit2.http.DELETE("/api/devices/{deviceId}")
  suspend fun deleteDevice(@Path("deviceId") deviceId: String): Map<String, Boolean>

  @retrofit2.http.PUT("/api/devices/reorder")
  suspend fun reorderDevices(@retrofit2.http.Body payload: DeviceReorderPayloadDto): Map<String, Boolean>

  @GET("/api/devices/{deviceId}/metrics")
  suspend fun metrics(
    @Path("deviceId") deviceId: String,
    @Query("window") window: String
  ): MetricsDto

  @GET("/api/devices/{deviceId}/traffic-calendar")
  suspend fun trafficCalendar(
    @Path("deviceId") deviceId: String,
    @Query("mode") mode: String,
    @Query("anchor") anchor: String,
    @Query("selectedStart") selectedStart: String? = null
  ): TrafficCalendarDto

  @GET("/api/devices/{deviceId}/metric-config")
  suspend fun metricConfig(@Path("deviceId") deviceId: String): DeviceMetricConfigDto

  @retrofit2.http.PUT("/api/devices/{deviceId}/metric-config")
  suspend fun saveMetricConfig(
    @Path("deviceId") deviceId: String,
    @Body payload: DeviceMetricConfigPayloadDto
  ): DeviceMetricConfigDto

}

class InMemoryCookieJar : CookieJar {
  private val cookies = mutableMapOf<String, List<Cookie>>()

  override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
    this.cookies[url.host] = cookies
  }

  override fun loadForRequest(url: HttpUrl): List<Cookie> = cookies[url.host].orEmpty()

}

internal class InvalidServerUrlException(message: String) : IllegalArgumentException(message)

internal object ServerUrlPolicy {
  fun parse(value: String): HttpUrl {
    val trimmed = value.trim()
    if (trimmed.isBlank()) {
      throw InvalidServerUrlException("请输入中枢地址")
    }

    val withScheme = if (trimmed.contains("://")) trimmed else "http://$trimmed"
    val parsed = runCatching { withScheme.toHttpUrl() }
      .getOrElse { throw InvalidServerUrlException("中枢地址格式不正确") }
    if (parsed.username.isNotEmpty() || parsed.password.isNotEmpty()) {
      throw InvalidServerUrlException("中枢地址不能包含用户名或密码")
    }

    if (parsed.scheme != "http" && parsed.scheme != "https") {
      throw InvalidServerUrlException("中枢地址必须使用 HTTP 或 HTTPS")
    }
    return parsed
  }

  fun normalize(value: String): String =
    parse(value).toString().removeSuffix("/")

}

class SettingsRepository(private val application: Application) {
  private val baseUrlKey = stringPreferencesKey("base_url")
  private val encryptedPreferences: SharedPreferences by lazy {
    val masterKey = MasterKey.Builder(application)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()
    EncryptedSharedPreferences.create(
      application,
      "dsc_android_secure_settings",
      masterKey,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
  }
  private val accessKeyKey = "access_key"

  fun settings(): Flow<ServerConfig> =
    application.dataStore.data
      .catch { error ->
        if (error is IOException) emit(emptyPreferences()) else throw error
      }
      .map { preferences -> normalizeServerUrl(preferences[baseUrlKey].orEmpty()) }
      .combine(accessKeyFlow()) { baseUrl, accessKey ->
        ServerConfig(
          baseUrl = baseUrl,
          accessKey = accessKey
        )
      }

  suspend fun save(config: ServerConfig) {
    application.dataStore.edit { prefs ->
      prefs[baseUrlKey] = normalizeServerUrl(config.baseUrl)
    }
    encryptedPreferences.edit().putString(accessKeyKey, config.accessKey).apply()
  }

  suspend fun clear() {
    application.dataStore.edit { prefs ->
      prefs.remove(baseUrlKey)
    }
    encryptedPreferences.edit().remove(accessKeyKey).apply()
  }

  private fun accessKeyFlow(): Flow<String> = callbackFlow {
    val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
      if (key == accessKeyKey) {
        trySend(encryptedPreferences.getString(accessKeyKey, "").orEmpty())
      }
    }
    trySend(encryptedPreferences.getString(accessKeyKey, "").orEmpty())
    encryptedPreferences.registerOnSharedPreferenceChangeListener(listener)
    awaitClose {
      encryptedPreferences.unregisterOnSharedPreferenceChangeListener(listener)
    }
  }

  private fun normalizeServerUrl(value: String): String {
    val trimmed = value.trim()
    if (trimmed.isBlank()) return ""
    return runCatching {
      val parsed = ServerUrlPolicy.parse(trimmed)
      val normalized = if (parsed.port in setOf(4000, 3101)) {
        parsed.newBuilder().port(3100).build()
      } else {
        parsed
      }
      normalized.toString().removeSuffix("/")
    }.getOrDefault(trimmed)
  }
}

class ApiFactory(private val application: Application) {
  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
  }

  private val isDebuggable: Boolean =
    (application.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

  fun create(baseUrl: String): Triple<DeviceStateApi, InMemoryCookieJar, OkHttpClient> {
    val cookieJar = InMemoryCookieJar()
    val clientBuilder = OkHttpClient.Builder()
      .cookieJar(cookieJar)
    if (isDebuggable) {
      clientBuilder.addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
    }
    val client = clientBuilder.build()

    val retrofit = Retrofit.Builder()
      .baseUrl(resolveApiBaseUrl(baseUrl))
      .client(client)
      .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
      .build()

    return Triple(retrofit.create(DeviceStateApi::class.java), cookieJar, client)
  }

  fun resolveApiBaseUrl(value: String): String {
    val normalized = ServerUrlPolicy.normalize(value)
    return if (normalized.endsWith("/")) normalized else "$normalized/"
  }
}
