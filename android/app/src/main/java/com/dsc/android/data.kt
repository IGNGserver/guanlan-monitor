package com.dsc.android

import android.app.Application
import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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

  @GET("/api/devices")
  suspend fun devices(): List<DeviceSummaryDto>

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

class SettingsRepository(private val application: Application) {
  private val baseUrlKey = stringPreferencesKey("base_url")
  private val accessKeyKey = stringPreferencesKey("access_key")

  fun settings(): Flow<ServerConfig> =
    application.dataStore.data
      .catch { error ->
        if (error is IOException) emit(emptyPreferences()) else throw error
      }
      .map { preferences ->
        ServerConfig(
          baseUrl = preferences[baseUrlKey].orEmpty(),
          accessKey = preferences[accessKeyKey].orEmpty()
        )
      }

  suspend fun save(config: ServerConfig) {
    application.dataStore.edit { prefs ->
      prefs[baseUrlKey] = config.baseUrl.trim()
      prefs[accessKeyKey] = config.accessKey
    }
  }

  suspend fun clear() {
    application.dataStore.edit { prefs ->
      prefs.remove(baseUrlKey)
      prefs.remove(accessKeyKey)
    }
  }
}

class ApiFactory {
  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
  }

  fun create(baseUrl: String): Triple<DeviceStateApi, InMemoryCookieJar, OkHttpClient> {
    val cookieJar = InMemoryCookieJar()
    val client = OkHttpClient.Builder()
      .cookieJar(cookieJar)
      .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
      .build()

    val retrofit = Retrofit.Builder()
      .baseUrl(resolveApiBaseUrl(baseUrl))
      .client(client)
      .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
      .build()

    return Triple(retrofit.create(DeviceStateApi::class.java), cookieJar, client)
  }

  fun resolveApiBaseUrl(value: String): String {
    val trimmed = value.trim()
    val withScheme = if (trimmed.contains("://")) trimmed else "http://$trimmed"
    val parsed = withScheme.toHttpUrl()
    val normalized = parsed.toString()
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
  val summary: DeviceSummaryDto
)
