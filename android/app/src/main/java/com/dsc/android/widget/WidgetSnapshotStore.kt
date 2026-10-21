package com.dsc.android.widget

import android.content.Context
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * 组件的原子快照文件。
 *
 * 组件刷新失败时不能把旧读数擦掉：先读到内存、合并、再整文件替换。文件位于
 * App 私有目录，不参与备份，也不包含访问密钥。
 */
class WidgetSnapshotStore(context: Context) {
  private val file = File(context.applicationContext.filesDir, "widget-snapshot.json")
  private val lock = Mutex()
  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
  }

  suspend fun read(): WidgetSnapshot? = lock.withLock {
    withContext(Dispatchers.IO) {
      if (!file.isFile) return@withContext null
      runCatching {
        json.decodeFromString<WidgetSnapshot>(file.readText(Charsets.UTF_8))
          .takeIf { it.version == 1 }
      }.getOrNull()
    }
  }

  suspend fun write(snapshot: WidgetSnapshot) = lock.withLock {
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

  suspend fun update(transform: (WidgetSnapshot) -> WidgetSnapshot): WidgetSnapshot {
    val current = read() ?: WidgetSnapshot()
    val next = transform(current)
    write(next)
    return next
  }

  suspend fun clear() = lock.withLock {
    withContext(Dispatchers.IO) {
      file.delete()
      File(file.parentFile, "${file.name}.tmp").delete()
    }
  }
}
