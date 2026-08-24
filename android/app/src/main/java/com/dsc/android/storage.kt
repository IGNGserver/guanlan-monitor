package com.dsc.android

internal data class VirtualizationStorageDisplay(
  val id: String,
  val name: String,
  val node: String?,
  val type: String?,
  val active: Boolean?,
  val shared: Boolean?,
  val latest: VirtualizationStorageDto?,
  val series: VirtualizationStorageMetricSeriesDto?
)

private const val STORAGE_POOL_TAB_PREFIX = "storage-pool:"

internal fun storagePoolTabId(storagePoolId: String): String = "$STORAGE_POOL_TAB_PREFIX$storagePoolId"

internal fun storagePoolIdFromTabId(tabId: String): String? {
  if (!tabId.startsWith(STORAGE_POOL_TAB_PREFIX)) return null
  return tabId.removePrefix(STORAGE_POOL_TAB_PREFIX).takeIf { it.isNotBlank() }
}

internal fun isDisplayableVirtualizationStorage(storage: VirtualizationStorageDto): Boolean =
  storage.active != false && listOfNotNull(storage.totalBytes, storage.usedBytes, storage.availableBytes).any { it > 0L }

internal fun isDisplayableVirtualizationStorageSeries(storage: VirtualizationStorageMetricSeriesDto): Boolean =
  storage.active != false && listOf(storage.totalBytes, storage.usedBytes, storage.availableBytes).any { points ->
    points.any { it.value.isFinite() && it.value > 0.0 }
  }

internal fun displayableVirtualizationStoragePools(metrics: MetricsDto): List<VirtualizationStorageDisplay> {
  val latest = metrics.latest.storagePools.filter(::isDisplayableVirtualizationStorage)
  val series = metrics.series.storagePools.filter(::isDisplayableVirtualizationStorageSeries)
  val latestById = latest.associateBy { it.id }
  val seriesById = series.associateBy { it.id }
  val ids: List<String> = buildList {
    addAll(series.map { it.id })
    addAll(latest.map { it.id })
  }.distinct()

  return ids.mapNotNull { id ->
    val latestPool = latestById[id]
    val seriesPool = seriesById[id]
    if (latestPool == null && seriesPool == null) return@mapNotNull null
    VirtualizationStorageDisplay(
      id = id,
      name = latestPool?.name?.takeIf { it.isNotBlank() }
        ?: seriesPool?.name?.takeIf { it.isNotBlank() }
        ?: id,
      node = latestPool?.node ?: seriesPool?.node,
      type = latestPool?.type ?: seriesPool?.type,
      active = latestPool?.active ?: seriesPool?.active,
      shared = latestPool?.shared ?: seriesPool?.shared,
      latest = latestPool,
      series = seriesPool
    )
  }
}
