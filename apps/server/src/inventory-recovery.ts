import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { DeviceSummary } from "@dsc/shared";
import type { DeviceRecord, Repositories, RealtimeDeviceSummary } from "./types.js";
import { toSummary } from "./utils.js";

function offlineSummary(record: DeviceRecord): DeviceSummary {
  return {
    deviceId: record.deviceId, hostname: record.name || record.deviceId, os: "unknown" as const,
    agentVersion: null, agentChannel: null, status: "offline" as const,
    lastSeenAt: record.updatedAt,
    cpuUsagePercent: null, gpuUsagePercent: null, gpuMemoryUsagePercent: null,
    memoryUsagePercent: null, diskUsagePercent: null, sortOrder: record.sortOrder,
    group: record.group ?? null
  };
}

/** Hot path: registry + realtime only, never historical telemetry. */
export async function buildDeviceSummaries(repositories: Repositories, log: FastifyBaseLogger): Promise<DeviceSummary[]> {
  const [openDevices, realtimeDevices] = await Promise.all([
    repositories.devices.listOpenDevices(),
    repositories.realtime.listSummaries
      ? repositories.realtime.listSummaries()
      : repositories.realtime.listDevices().then((states): RealtimeDeviceSummary[] => states.map((state) => ({
        ...toSummary(state), registrationHostname: state.identity.hostname
      })))
  ]);
  const realtimeMap = new Map(realtimeDevices.map((state) => [state.deviceId, state]));
  const registeredIds = new Set(openDevices.map((device) => device.deviceId));
  for (const realtimeState of realtimeDevices) {
    if (registeredIds.has(realtimeState.deviceId)) continue;
    const record = await repositories.devices.registerOrUpdateDevice(
      realtimeState.deviceId,
      realtimeState.registrationHostname ?? realtimeState.hostname,
      { skipUnchanged: true }
    );
    if (record.status !== "open") continue;
    if (record.deviceId !== realtimeState.deviceId) {
      // A legacy case-insensitive registry row answered for a differently
      // cased live id. Appending it would list the same registry row twice;
      // the startup collation migration removes the root cause, so keep the
      // single registry entry and make the mismatch visible in the log.
      log.warn(
        { requestedDeviceId: realtimeState.deviceId, registeredDeviceId: record.deviceId },
        "device registry returned a different id casing; keeping one entry"
      );
      registeredIds.add(record.deviceId);
      continue;
    }
    if (registeredIds.has(record.deviceId)) continue;
    openDevices.push(record);
    registeredIds.add(record.deviceId);
  }
  const summaries = new Map<string, DeviceSummary>();
  for (const record of openDevices) {
    const realtimeState = realtimeMap.get(record.deviceId);
    let summary: DeviceSummary;
    if (realtimeState) {
      try {
        const { registrationHostname: _hostname, ...publicSummary } = realtimeState;
        summary = { ...publicSummary, sortOrder: record.sortOrder, group: record.group ?? null };
      }
      catch (error) {
        log.error({ error, deviceId: record.deviceId }, "failed to summarize device state");
        summary = offlineSummary(record);
      }
    }
    else summary = offlineSummary(record);
    if (summaries.has(summary.deviceId)) {
      log.warn({ deviceId: summary.deviceId }, "duplicate registry entry ignored");
      continue;
    }
    summaries.set(summary.deviceId, summary);
  }
  return [...summaries.values()].sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || a.deviceId.localeCompare(b.deviceId));
}

/** Historical-only devices are reconciled once per Hub start, not on each GET.
 * Ingestion already registers new devices before writing history. Closed
 * records remain closed: recovery never passes reopenClosed.
 */
export function registerInventoryRecovery(app: FastifyInstance, repositories: Repositories, retryMs = 30_000): void {
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const recover = async () => {
    try {
      const [known, open] = await Promise.all([
        repositories.history.listKnownDevices(), repositories.devices.listOpenDevices()
      ]);
      const registered = new Set(open.map((device) => device.deviceId));
      for (const device of known) {
        if (closed) return;
        if (!registered.has(device.deviceId)) await repositories.devices.registerOrUpdateDevice(device.deviceId, device.deviceId);
      }
    } catch (error) {
      if (closed) return;
      app.log.error({ error }, "historical inventory recovery failed; retrying off the request path");
      retry = setTimeout(() => { void recover(); }, retryMs);
      retry.unref();
    }
  };
  app.addHook("onListen", async () => { void recover(); });
  app.addHook("onClose", async () => { closed = true; if (retry) clearTimeout(retry); });
}
