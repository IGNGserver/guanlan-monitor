package com.dsc.android

import android.app.Application
import java.io.File
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class CachedRemoteSnapshot(
  val version: Int = 1,
  val scope: String = "",
  val savedAt: String,
  val devices: List<DeviceSummaryDto> = emptyList(),
  val selectedDeviceId: String? = null,
  val selectedWindow: String = "5m",
  val metrics: MetricsDto? = null,
  val overviewMetrics: OverviewMetricsDto? = null,
  val trafficCalendar: TrafficCalendarDto? = null,
  // 按设备缓存指标与流量：离线浏览任一设备页时都能拿到最近一次成功读到的数据（交）
  val deviceMetrics: Map<String, MetricsDto> = emptyMap(),
  val deviceTraffic: Map<String, TrafficCalendarDto> = emptyMap()
)

/**
 * A best-effort, access-key-free snapshot cache for the last successful Hub
 * read. It is intentionally separate from settings so clearing credentials
 * can also clear telemetry that belongs to the previous Hub account.
 */
class RemoteSnapshotCache internal constructor(private val file: File) {
  constructor(application: Application) : this(File(application.filesDir, "remote-snapshot-cache.json"))
  private val lock = Mutex()
  private val epoch = AtomicLong()
  fun generation(): Long = epoch.get()
  fun invalidate(): Long = epoch.incrementAndGet()
  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
  }

  suspend fun read(expectedScope: String?, expectedEpoch: Long = generation()): CachedRemoteSnapshot? = lock.withLock {
    withContext(Dispatchers.IO) {
      if (expectedScope == null || expectedEpoch != generation() || !file.isFile || file.length() > 4_000_000) return@withContext null
      runCatching {
        json.decodeFromString<CachedRemoteSnapshot>(file.readText(Charsets.UTF_8))
          .takeIf { validRemoteSnapshot(it, expectedScope) && expectedEpoch == generation() }
      }.getOrNull()
    }
  }

  suspend fun write(snapshot: CachedRemoteSnapshot, expectedEpoch: Long = generation()) = lock.withLock {
    withContext(Dispatchers.IO) {
      if (expectedEpoch != generation() || snapshot.version != 2 || snapshot.scope.isBlank()) return@withContext
      var bounded = snapshot.copy(deviceMetrics = snapshot.deviceMetrics.entries.toList().takeLast(8).associate { it.toPair() }, deviceTraffic = snapshot.deviceTraffic.entries.toList().takeLast(8).associate { it.toPair() })
      var text = json.encodeToString(bounded)
      if (text.toByteArray(Charsets.UTF_8).size > 4_000_000) {
        bounded = bounded.copy(metrics = null, overviewMetrics = null, trafficCalendar = null, deviceMetrics = emptyMap(), deviceTraffic = emptyMap())
        text = json.encodeToString(bounded)
      }
      if (text.toByteArray(Charsets.UTF_8).size > 4_000_000) return@withContext
      file.parentFile?.mkdirs()
      val temporary = File(file.parentFile, "${file.name}.tmp")
      temporary.writeText(text, Charsets.UTF_8)
      if (expectedEpoch != generation()) { temporary.delete(); return@withContext }
      if (!temporary.renameTo(file)) {
        temporary.copyTo(file, overwrite = true)
        temporary.delete()
      }
    }
  }

  suspend fun clear() {
    invalidate()
    withContext(NonCancellable + Dispatchers.IO) { lock.withLock {
      if (file.exists()) check(file.delete()) { "remote_cache_clear_failed" }
      File(file.parentFile, "${file.name}.tmp").delete()
    } }
  }
}

internal fun validRemoteSnapshot(snapshot: CachedRemoteSnapshot, scope: String, now: Instant = Instant.now()): Boolean {
  if (snapshot.version != 2 || snapshot.scope != scope || scope.isBlank()) return false
  val age = runCatching { java.time.Duration.between(Instant.parse(snapshot.savedAt), now).toMillis() }.getOrNull() ?: return false
  return age in 0..86_400_000
}
