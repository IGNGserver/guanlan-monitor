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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
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
  suspend fun reorderDevices(@retrofit2.http.Body payload: Map<String, List<String>>): Map<String, Boolean>

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

  fun headerValue(url: HttpUrl): String? {
    val values = loadForRequest(url)
    if (values.isEmpty()) return null
    return values.joinToString("; ") { "${it.name}=${it.value}" }
  }
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

    val isHttps = parsed.scheme == "https"
    val isAllowedHttp = parsed.scheme == "http" && isPrivateNetworkHost(parsed.host)
    if (!isHttps && !isAllowedHttp) {
      throw InvalidServerUrlException("公网中枢必须使用 HTTPS；HTTP 仅支持 localhost 或私有网络地址")
    }
    return parsed
  }

  fun normalize(value: String): String = parse(value).toString().removeSuffix("/")

  private fun isPrivateNetworkHost(rawHost: String): Boolean {
    val host = rawHost.removePrefix("[").removeSuffix("]").lowercase()
    if (host == "localhost" || host == "::1") return true

    val octets = host.split('.')
    if (octets.size == 4) {
      val values = octets.mapNotNull { it.toIntOrNull() }
      if (values.size == 4 && values.all { it in 0..255 }) {
        val first = values[0]
        val second = values[1]
        return first == 127 ||
          first == 10 ||
          (first == 172 && second in 16..31) ||
          (first == 192 && second == 168) ||
          (first == 169 && second == 254)
      }
    }

    return host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")
  }
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

class DeviceRealtimeSocket(
  private val client: OkHttpClient,
  private val cookieJar: InMemoryCookieJar,
  private val serverBaseUrl: String
) {
  private val json = Json { ignoreUnknownKeys = true }
  private var socket: WebSocket? = null

  fun connect(onUpdate: (DeviceRealtimeEventDto) -> Unit, onFailure: (() -> Unit)? = null) {
    close()
    val base = normalize(serverBaseUrl).toHttpUrl()
    val wsScheme = if (base.isHttps) "wss" else "ws"
    val socketUrl = base.newBuilder()
      .addPathSegments("socket.io/")
      .addQueryParameter("EIO", "4")
      .addQueryParameter("transport", "websocket")
      .build()
      .toString()
      .replaceFirst("${base.scheme}://", "$wsScheme://")

    val requestBuilder = Request.Builder().url(socketUrl)
    cookieJar.headerValue(base)?.let { requestBuilder.header("Cookie", it) }
    socket = client.newWebSocket(requestBuilder.build(), object : WebSocketListener() {
      override fun onMessage(webSocket: WebSocket, text: String) {
        when {
          text == "2" -> webSocket.send("3")
          text.startsWith("0") -> webSocket.send("40")
          text.startsWith("40") -> Unit
          text.startsWith("42") -> {
            val payload = text.removePrefix("42")
            runCatching {
              val event = json.parseToJsonElement(payload) as JsonArray
              val eventName = event.getOrNull(0)?.toString()?.trim('"')
              if (eventName == "device:update") {
                val data = json.decodeFromJsonElement(DeviceRealtimeEventDto.serializer(), event[1])
                onUpdate(data)
              }
            }
          }
        }
      }

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
        onFailure?.invoke()
      }
    })
  }

  fun close() {
    socket?.close(1000, null)
    socket = null
  }

  private fun normalize(url: String): String = if (url.endsWith("/")) url else "$url/"
}

@Serializable
data class DeviceRealtimeEventDto(
  val deviceId: String,
  val summary: DeviceSummaryDto,
  val latest: JsonObject? = null
)
