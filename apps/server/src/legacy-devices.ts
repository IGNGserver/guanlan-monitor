/**
 * Ids the hub published Proxmox virtual machines under before the feature was removed.
 *
 * Removing the feature deleted the producers, but not everything the old hub wrote: a `devices`
 * row, a Redis realtime entry or a history row can still carry a `vm:` id. Those ids name nothing
 * that exists any more, so they must never be treated as devices again - neither registered into
 * the device table nor returned in a listing.
 */
export const LEGACY_VIRTUAL_MACHINE_ID_PREFIX = "vm:";

export function isLegacyVirtualMachineId(deviceId: string): boolean {
  return deviceId.startsWith(LEGACY_VIRTUAL_MACHINE_ID_PREFIX);
}

/** SQL `LIKE` pattern matching every legacy id, for repository-level sweeps and filters. */
export const LEGACY_VIRTUAL_MACHINE_ID_PATTERN = `${LEGACY_VIRTUAL_MACHINE_ID_PREFIX}%`;

/**
 * A closed record for an id that must not enter the registry.
 *
 * `status: "closed"` is the signal every caller already respects: `buildDeviceSummaries()` only
 * surfaces records reported open, and `MetricsService.ingest()` drops a payload whose device is
 * closed. Returning it keeps both paths from writing anything.
 */
export function legacyVirtualMachineRecord(deviceId: string) {
  const now = new Date().toISOString();
  return {
    deviceId,
    name: deviceId,
    status: "closed" as const,
    sortOrder: 0,
    registeredAt: now,
    updatedAt: now
  };
}
