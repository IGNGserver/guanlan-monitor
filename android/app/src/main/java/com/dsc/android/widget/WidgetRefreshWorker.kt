package com.dsc.android.widget

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.io.IOException
import kotlinx.coroutines.CancellationException

/**
 * 组件刷新只做三件事：读中枢、写快照、重绘桌面。
 * 失败时保留上一次成功快照，只把错误和时间写进快照，不把旧读数擦掉。
 */
class WidgetRefreshWorker(
  appContext: Context,
  params: WorkerParameters
) : CoroutineWorker(appContext, params) {
  override suspend fun doWork(): Result {
    val inventory = readWidgetInventory(applicationContext)
    if (!inventory.hasWidgets) {
      WidgetRefreshScheduler.cancelAll(applicationContext)
      return Result.success()
    }

    val store = WidgetSnapshotStore(applicationContext)
    val previous = store.read() ?: WidgetSnapshot()
    return try {
      val loader = WidgetDataLoader(applicationContext)
      val snapshot = loader.refresh(inventory, previous)
      store.write(snapshot)
      WidgetUpdater.updateAll(applicationContext)
      Result.success()
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (error: Throwable) {
      val failed = previous.copy(
        lastAttemptAt = System.currentTimeMillis(),
        lastError = WidgetSnapshotMapper.friendlyError(error)
      )
      store.write(failed)
      WidgetUpdater.updateAll(applicationContext)
      if (error is IOException && runAttemptCount < 2) Result.retry() else Result.failure()
    }
  }
}
