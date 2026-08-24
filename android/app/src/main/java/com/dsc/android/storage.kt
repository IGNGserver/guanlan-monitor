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
  val ids = buildList {
    addAll(series.map { it.id })
    addAll(latest.map { it.id })
  }.distinct()

  return ids.mapNotNull { id ->
    val latestPool = latestById[id]
    val seriesPool = seriesById[id]
    val source = latestPool ?: seriesPool ?: return@mapNotNull null
    VirtualizationStorageDisplay(
      id = id,
      name = latestPool?.name?.takeIf { it.isNotBlank() } ?: source.name.ifBlank { id },
      node = latestPool?.node ?: seriesPool?.node,
      type = latestPool?.type ?: seriesPool?.type,
      active = latestPool?.active ?: seriesPool?.active,
      shared = latestPool?.shared ?: seriesPool?.shared,
      latest = latestPool,
      series = seriesPool
    )
  }
}
