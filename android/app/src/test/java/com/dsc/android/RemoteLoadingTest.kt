package com.dsc.android

import java.io.File
import java.nio.file.Files
import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class RemoteLoadingTest {
  @Test fun identityIsOpaqueStableForModesAndReplacedForAccountsOrHubs() {
    val first = connectionRecord(ServerConfig(), ServerConfig("https://hub.example", "fixture-account"))
    assertTrue(first.cacheIdentity.isNotBlank())
    assertFalse(cacheScope(first)!!.contains("fixture-account"))
    assertEquals(first.cacheIdentity, connectionRecord(first, first.copy(networkMode = "saver")).cacheIdentity)
    assertNotEquals(first.cacheIdentity, connectionRecord(first, first.copy(accessKey = "other-fixture")).cacheIdentity)
    assertNotEquals(first.cacheIdentity, connectionRecord(first, first.copy(baseUrl = "https://other.example")).cacheIdentity)
    assertNull(cacheScope(connectionRecord(first, ServerConfig())))
  }

  @Test fun policyUsesRequestDurationNotRttAndCapsBackoff() {
    assertNull(remoteReadPolicy("standard", 5000.0).pointBudget)
    assertEquals(120, remoteReadPolicy("auto", 1500.0).pointBudget)
    assertEquals(1, remoteReadPolicy("saver", 0.0).concurrency)
    assertEquals(2, remoteReadPolicy("auto", 100.0).concurrency)
    assertEquals(30_000L, remoteReadPolicy("saver", 0.0).pollDelay(0))
    assertEquals(120_000L, remoteReadPolicy("saver", 0.0).pollDelay(100))
    assertEquals(15_000L, remoteReadPolicy("standard", 0.0).pollDelay(0))
  }

  @Test fun authenticationIsSingleFlightAndConcurrent401RefreshesOnce() = runBlocking {
    val session = RemoteSession()
    var logins = 0
    val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
    val pending = (1..20).map { async {
      session.ensure({ true }) { logins++; entered.complete(Unit); release.await() }
    } }
    entered.await(); assertEquals(1, logins); release.complete(Unit); pending.awaitAll()
    class Unauthorized : RuntimeException()
    val allStarted = CompletableDeferred<Unit>(); var started = 0
    val reads = (1..10).map { async {
      var tries = 0
      session.execute(true, { true }, { it is Unauthorized }, { logins++ }) {
        if (++tries == 1) { if (++started == 10) allStarted.complete(Unit); allStarted.await(); throw Unauthorized() }
        "ok"
      }
    } }
    assertTrue(reads.awaitAll().all { it == "ok" }); assertEquals(2, logins)
  }

  @Test fun writesAreNeverReplayedAndCancellationIsNotAResult() = runBlocking {
    val session = RemoteSession(); var logins = 0; var writes = 0
    val error = IllegalStateException("denied")
    try {
      session.execute(false, { true }, { true }, { logins++ }) { writes++; throw error }
      fail("write must fail")
    } catch (actual: IllegalStateException) { assertSame(error, actual) }
    assertEquals(1, logins); assertEquals(1, writes)
    try { remoteResult<Unit> { throw CancellationException("cancelled") }; fail("must propagate") }
    catch (_: CancellationException) { }
  }

  @Test fun oldIdentityCannotCompleteOrReauthenticateARequest() = runBlocking {
    val session = RemoteSession(); var current = true; var logins = 0
    val gate = CompletableDeferred<Unit>(); val entered = CompletableDeferred<Unit>()
    val read = async {
      session.execute(true, { current }, { true }, { logins++ }) {
        entered.complete(Unit); gate.await(); error("401")
      }
    }
    entered.await(); current = false; gate.complete(Unit)
    try { read.await(); fail("old identity must cancel") } catch (_: CancellationException) { }
    assertEquals(1, logins)
  }

  @Test fun scopeTtlLegacyAndFutureDataAreRejected() {
    val now = Instant.parse("2026-10-20T00:00:00Z")
    val good = CachedRemoteSnapshot(version = 2, scope = "hub|opaque", savedAt = now.toString())
    assertTrue(validRemoteSnapshot(good, "hub|opaque", now))
    assertFalse(validRemoteSnapshot(good, "another-account", now))
    assertFalse(validRemoteSnapshot(good.copy(version = 1), "hub|opaque", now))
    assertFalse(validRemoteSnapshot(good.copy(savedAt = now.minusSeconds(86401).toString()), "hub|opaque", now))
    assertFalse(validRemoteSnapshot(good.copy(savedAt = now.plusSeconds(1).toString()), "hub|opaque", now))
  }

  @Test fun realCacheRoundtripAndClearRejectsWritesCapturedBeforeInvalidation() = runBlocking {
    val dir = Files.createTempDirectory("guanlan-cache-test").toFile()
    try {
      val file = File(dir, "cache.json"); val cache = RemoteSnapshotCache(file)
      val snapshot = CachedRemoteSnapshot(version = 2, scope = "hub|opaque", savedAt = Instant.now().toString(), devices = listOf(DeviceSummaryDto("a", "nas", "linux", status = "online")))
      val captured = cache.generation()
      cache.write(snapshot, captured)
      assertEquals("nas", cache.read(snapshot.scope)!!.devices.single().hostname)
      assertNull(cache.read("other|opaque"))
      val text = file.readText(); assertFalse(text.contains("accessKey")); assertFalse(text.contains("Cookie"))
      cache.clear(); cache.write(snapshot, captured)
      assertNull(RemoteSnapshotCache(file).read(snapshot.scope))
      file.writeText(Json.encodeToString(snapshot.copy(version = 1)))
      assertNull(cache.read(snapshot.scope))
      file.writeText(" ".repeat(4_000_001)); assertNull(cache.read(snapshot.scope))
    } finally { dir.deleteRecursively() }
  }
}
