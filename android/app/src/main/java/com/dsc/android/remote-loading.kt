package com.dsc.android

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** No credential-derived hashes: the opaque identity lives only in encrypted settings. */
internal fun connectionRecord(previous: ServerConfig, requested: ServerConfig): ServerConfig {
  val identity = if (requested.baseUrl.isBlank() || requested.accessKey.isBlank()) ""
    else if (previous.baseUrl == requested.baseUrl && previous.accessKey == requested.accessKey && previous.cacheIdentity.isNotBlank()) previous.cacheIdentity
    else UUID.randomUUID().toString()
  return requested.copy(cacheIdentity = identity, networkMode = requested.networkMode.takeIf { it in setOf("auto", "standard", "saver") } ?: "auto")
}

internal fun cacheScope(config: ServerConfig): String? =
  if (config.baseUrl.isBlank() || config.accessKey.isBlank() || config.cacheIdentity.isBlank()) null
  else "${config.baseUrl}\u001f${config.cacheIdentity}"

internal data class RemoteReadPolicy(val constrained: Boolean) {
  val pointBudget: Int? get() = if (constrained) 120 else null
  val concurrency: Int get() = if (constrained) 1 else 2
  fun pollDelay(failures: Int): Long = minOf(120_000L, (if (constrained) 30_000L else 15_000L) * (1L shl failures.coerceIn(0, 4)))
}
internal fun remoteReadPolicy(mode: String, summaryDurationMs: Double) =
  RemoteReadPolicy(mode == "saver" || (mode != "standard" && summaryDurationMs >= 1500))

/** One authentication per observed session version; writes are never replayed. */
internal class RemoteSession {
  private val lock = Mutex()
  private var authenticated = false
  private var version = 0L
  suspend fun ensure(current: () -> Boolean, login: suspend () -> Unit) = lock.withLock {
    checkCurrent(current)
    if (!authenticated) { login(); checkCurrent(current); authenticated = true; version++ }
  }
  suspend fun <T> execute(read: Boolean, current: () -> Boolean, unauthorized: (Throwable) -> Boolean, login: suspend () -> Unit, block: suspend () -> T): T {
    ensure(current, login)
    val observed = version
    try { val result = block(); checkCurrent(current); return result }
    catch (error: Throwable) {
      if (error is CancellationException) throw error
      checkCurrent(current)
      if (!read || !unauthorized(error)) throw error
      lock.withLock {
        checkCurrent(current)
        if (version == observed) { authenticated = false; login(); checkCurrent(current); authenticated = true; version++ }
      }
      val result = block(); checkCurrent(current); return result
    }
  }
  private suspend fun checkCurrent(current: () -> Boolean) {
    currentCoroutineContext().ensureActive()
    if (!current()) throw CancellationException("remote_identity_changed")
  }
}

/** Unlike runCatching this cannot swallow structured-concurrency cancellation. */
internal suspend fun <T> remoteResult(block: suspend () -> T): Result<T> = try { Result.success(block()) }
catch (error: Throwable) { if (error is CancellationException) throw error; Result.failure(error) }
