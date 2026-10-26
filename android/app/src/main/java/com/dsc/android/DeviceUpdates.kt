package com.dsc.android

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.ResponseBody
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.io.File
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

interface DeviceUpdateSource {
  var channel: String
  val downloadClient: OkHttpClient
  suspend fun check(manual: Boolean): UpdateInfoDto
  fun validatePackage(file: File, update: UpdateInfoDto)
  fun openDownload(initial: String): Response {
    var next = initial
    repeat(6) {
      val url = next.toHttpUrlOrNull() ?: error("更新包地址异常")
      kotlin.check(url.isHttps && url.port == 443 && url.username.isEmpty() && url.password.isEmpty() && url.host in setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com")) { "更新包跳转地址不可信" }
      val response = downloadClient.newCall(Request.Builder().url(url).build()).execute()
      if (response.code !in listOf(301, 302, 303, 307, 308)) return response
      val location = response.header("Location")?.let { url.resolve(it)?.toString() }
      response.close()
      next = location ?: error("更新包跳转地址缺失")
    }
    error("更新包跳转次数过多")
  }
}

/** Update transport is deliberately independent of Hub sessions, cookies and credentials. */
class DeviceUpdates(private val context: Context, private val feedClient: OkHttpClient = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()) : DeviceUpdateSource {
  private val prefs = context.getSharedPreferences("device_updates", Context.MODE_PRIVATE)
  private val lock = Mutex()
  override val downloadClient = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS)
    .readTimeout(60, TimeUnit.SECONDS).callTimeout(30, TimeUnit.MINUTES).followRedirects(false).followSslRedirects(false).build()
  override var channel: String
    get() = prefs.getString("channel", if (BuildConfig.RELEASE_CHANNEL == "stable") "stable" else "preview") ?: "stable"
    set(value) { require(value == "stable" || value == "preview"); kotlin.check(prefs.edit().putString("channel", value).commit()) }

  override suspend fun check(manual: Boolean): UpdateInfoDto = withContext(Dispatchers.IO) { lock.withLock {
    val now = System.currentTimeMillis()
    var cached = prefs.getString("feed", null)
    if (cached != null && select(cached) == null) {
      cached = null
      kotlin.check(prefs.edit().remove("feed").remove("etag").putLong("nextAuto", 0).commit())
    }
    fun selected(message: String? = null): UpdateInfoDto = select(cached)?.let { if (message == null) it else it.copy(message = message) } ?: UpdateInfoDto(currentVersion = BuildConfig.RELEASE_VERSION, message = message ?: "尚未获得仓库更新信息")
    if (now < prefs.getLong("nextRequest", 0)) return@withLock selected("已使用最近检查结果；请在冷却结束后重试")
    if (!manual && now < prefs.getLong("nextAuto", 0)) return@withLock selected()
    kotlin.check(prefs.edit().putLong("nextRequest", now + 60_000).commit())
    try {
      val builder = Request.Builder().url("https://raw.githubusercontent.com/IGNGserver/guanlan-monitor/updates/updates.json")
      prefs.getString("etag", null)?.let { builder.header("If-None-Match", it) }
      feedClient.newCall(builder.build()).execute().use { response ->
        if (!response.isSuccessful && response.code != 304) {
          val retry = response.header("Retry-After")
          val retryAt = retry?.toLongOrNull()?.let { now + it * 1000 } ?: runCatching { ZonedDateTime.parse(retry, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }.getOrDefault(0)
          val reset = (response.header("X-RateLimit-Reset")?.toLongOrNull() ?: 0) * 1000
          kotlin.check(prefs.edit().putLong("nextRequest", maxOf(now + 60_000, retryAt, reset)).commit())
          error("feed_http_${response.code}")
        }
        val body = if (response.code == 304) cached ?: error("missing_cache") else readLimited(response.body ?: error("empty_feed"))
        val value = select(body) ?: error("invalid_feed")
        kotlin.check(prefs.edit().putString("feed", body).putString("etag", response.header("ETag") ?: prefs.getString("etag", null))
          .putInt("failures", 0).putLong("nextAuto", now + 6 * 3600_000 + kotlin.random.Random.nextLong(30 * 60_000)).commit())
        value
      }
    } catch (_: Exception) {
      val failures = (prefs.getInt("failures", 0) + 1).coerceAtMost(10)
      kotlin.check(prefs.edit().putInt("failures", failures).putLong("nextRequest", maxOf(prefs.getLong("nextRequest", 0), now + minOf(6 * 3600_000L, 60_000L * (1L shl failures)))).commit())
      selected("更新服务暂不可用，已保留最近结果并稍后重试")
    }
  } }

  private fun select(text: String?): UpdateInfoDto? = runCatching {
    require(text != null && text.toByteArray(Charsets.UTF_8).size <= 4 * 1024 * 1024)
    val feed = JSONObject(text ?: return null)
    require(feed.getInt("schemaVersion") == 1 && feed.getString("repository") == "IGNGserver/guanlan-monitor")
    Instant.parse(feed.getString("generatedAt"))
    val releases = feed.getJSONArray("releases")
    var best: UpdateInfoDto? = null
    val installed = context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode
    for (i in 0 until releases.length()) {
      val release = releases.getJSONObject(i)
      val tag = release.getString("tag_name")
      val version = tag.removePrefix("v")
      if (release.getBoolean("draft") || compareUpdateVersions(version, BuildConfig.RELEASE_VERSION) != 1) continue
      if (channel == "stable" && (release.getBoolean("prerelease") || version.substringBefore('+').contains('-'))) continue
      val assets = release.getJSONArray("assets")
      for (j in 0 until assets.length()) {
        val asset = assets.getJSONObject(j)
        if (asset.getString("name") != "DeviceStateConsole-Android-v$version.apk" || asset.optString("state") != "uploaded") continue
        val digest = asset.optString("digest")
        if (!Regex("sha256:[a-fA-F0-9]{64}").matches(digest)) continue
        val size = asset.optDouble("size", Double.NaN)
        if (!size.isFinite() || size <= 0 || size > 9_007_199_254_740_991.0 || size % 1.0 != 0.0) continue
        val code = asset.optLong("versionCode", updateVersionCode(version))
        if (code <= installed) continue
        val url = asset.getString("browser_download_url")
        if (!url.startsWith("https://github.com/IGNGserver/guanlan-monitor/releases/download/$tag/")) continue
        if (best != null && compareUpdateVersions(version, best.latestVersion!!) != 1) continue
        best = UpdateInfoDto(currentVersion = BuildConfig.RELEASE_VERSION, currentChannel = channel, available = true, latestVersion = version,
          latestChannel = if (release.getBoolean("prerelease") || version.substringBefore('+').contains('-')) "preview" else "stable", releaseTag = tag, releaseUrl = release.getString("html_url"),
          assetName = asset.getString("name"), assetUrl = url, assetSize = asset.optLong("size"), sha256 = digest.removePrefix("sha256:"), versionCode = code)
      }
    }
    best ?: UpdateInfoDto(currentVersion = BuildConfig.RELEASE_VERSION, currentChannel = channel, message = "当前通道暂无更高且可安装的版本；不会降级")
  }.getOrNull()

  private fun readLimited(body: ResponseBody): String = body.byteStream().use { input ->
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    var count = 0
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      count += read
      kotlin.check(count <= 4 * 1024 * 1024) { "update feed too large" }
      output.write(buffer, 0, read)
    }
    output.toString("UTF-8")
  }

  override fun validatePackage(file: File, update: UpdateInfoDto) {
    val pm = context.packageManager
    val flags = PackageManager.GET_SIGNING_CERTIFICATES
    val archive = pm.getPackageArchiveInfo(file.absolutePath, flags) ?: error("无法读取更新包")
    val installed = pm.getPackageInfo(context.packageName, flags)
    kotlin.check(archive.packageName == context.packageName) { "更新包包名不匹配" }
    kotlin.check(archive.longVersionCode > installed.longVersionCode && archive.longVersionCode == update.versionCode) { "更新包版本码必须严格增加" }
    kotlin.check(compareUpdateVersions(archive.versionName.orEmpty(), BuildConfig.RELEASE_VERSION) == 1 && archive.versionName == update.latestVersion) { "更新包版本不匹配" }
    val current = installed.signingInfo?.apkContentsSigners.orEmpty().map { it.toByteArray().toList() }.toSet()
    val incoming = archive.signingInfo?.apkContentsSigners.orEmpty().map { it.toByteArray().toList() }.toSet()
    kotlin.check(current.isNotEmpty() && current == incoming) { "更新包签名不匹配" }
  }
}

internal fun updateVersionCode(value: String): Long {
  val parts = value.split('.').map { it.toLongOrNull() ?: return -1 }
  if (parts.size != 3 || parts[0] !in 0..2099 || parts[1] !in 0..99 || parts[2] !in 0..9999) return -1
  return parts[0] * 1_000_000 + parts[1] * 10_000 + parts[2]
}

internal fun compareUpdateVersions(left: String, right: String): Int? {
  val pattern = Regex("^v?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$")
  val a = pattern.matchEntire(left) ?: return null
  val b = pattern.matchEntire(right) ?: return null
  if (listOf(a, b).any { match -> match.groupValues[4].split('.').any { Regex("0[0-9]+").matches(it) } }) return null
  for (i in 1..3) { val av = a.groupValues[i].toLongOrNull() ?: return null; val bv = b.groupValues[i].toLongOrNull() ?: return null; val c = av.compareTo(bv); if (c != 0) return c.coerceIn(-1, 1) }
  val x = a.groupValues[4]; val y = b.groupValues[4]
  if (x.isEmpty() || y.isEmpty()) return if (x == y) 0 else if (x.isEmpty()) 1 else -1
  val ax = x.split('.'); val by = y.split('.')
  for (i in 0 until maxOf(ax.size, by.size)) {
    if (i >= ax.size || i >= by.size) return if (i >= ax.size) -1 else 1
    if (ax[i] == by[i]) continue
    val an = ax[i].all { it in '0'..'9' }; val bn = by[i].all { it in '0'..'9' }
    return when { an && bn -> if (ax[i].length == by[i].length) ax[i].compareTo(by[i]) else ax[i].length.compareTo(by[i].length); an -> -1; bn -> 1; else -> ax[i].compareTo(by[i]) }.coerceIn(-1, 1)
  }
  return 0
}
