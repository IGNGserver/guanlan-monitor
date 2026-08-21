package com.dsc.android

import android.app.Application
import java.io.File
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
  val savedAt: String,
  val devices: List<DeviceSummaryDto> = emptyList(),
  val selectedDeviceId: String? = null,
  val selectedWindow: String = "1m",
  val metrics: MetricsDto? = null,
  val overviewMetrics: OverviewMetricsDto? = null,
  val trafficCalendar: TrafficCalendarDto? = null
)

/**
 * A best-effort, access-key-free snapshot cache for the last successful Hub
 * read. It is intentionally separate from settings so clearing credentials
 * can also clear telemetry that belongs to the previous Hub account.
 */
class RemoteSnapshotCache(application: Application) {
  private val file = File(application.filesDir, "remote-snapshot-cache.json")
  private val lock = Mutex()
  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
  }

  suspend fun read(): CachedRemoteSnapshot? = lock.withLock {
    withContext(Dispatchers.IO) {
      if (!file.isFile) return@withContext null
      runCatching {
        json.decodeFromString<CachedRemoteSnapshot>(file.readText(Charsets.UTF_8))
          .takeIf { it.version == 1 }
      }.getOrNull()
    }
  }

  suspend fun write(snapshot: CachedRemoteSnapshot) = lock.withLock {
    withContext(Dispatchers.IO) {
      file.parentFile?.mkdirs()
      val temporary = File(file.parentFile, "${file.name}.tmp")
      temporary.writeText(json.encodeToString(snapshot), Charsets.UTF_8)
      if (!temporary.renameTo(file)) {
        temporary.copyTo(file, overwrite = true)
        temporary.delete()
      }
    }
  }

  suspend fun clear() = lock.withLock {
    withContext(Dispatchers.IO) {
      file.delete()
      File(file.parentFile, "${file.name}.tmp").delete()
    }
  }
}
