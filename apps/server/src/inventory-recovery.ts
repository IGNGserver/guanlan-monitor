import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Repositories, RealtimeDeviceSummary } from "./types.js";
import { toSummary } from "./utils.js";

/** Hot path: registry + realtime only, never historical telemetry. */
export async function buildDeviceSummaries(repositories: Repositories, log: FastifyBaseLogger) {
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
    if (!registeredIds.has(realtimeState.deviceId)) {
      const record = await repositories.devices.registerOrUpdateDevice(realtimeState.deviceId, realtimeState.registrationHostname ?? realtimeState.hostname);
      if (record.status === "open") { openDevices.push(record); registeredIds.add(record.deviceId); }
    }
  }
  return openDevices.map((record) => {
    const realtimeState = realtimeMap.get(record.deviceId);
    if (realtimeState) {
      try {
        const { registrationHostname: _hostname, ...publicSummary } = realtimeState;
        return { ...publicSummary, sortOrder: record.sortOrder };
      }
      catch (error) { log.error({ error, deviceId: record.deviceId }, "failed to summarize device state"); }
    }
    return {
      deviceId: record.deviceId, hostname: record.name || record.deviceId, os: "unknown" as const,
      agentVersion: null, agentChannel: null, status: "offline" as const,
      lastSeenAt: realtimeState?.lastSeenAt ?? record.updatedAt,
      cpuUsagePercent: null, gpuUsagePercent: null, gpuMemoryUsagePercent: null,
      memoryUsagePercent: null, diskUsagePercent: null, sortOrder: record.sortOrder
    };
  }).sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || a.deviceId.localeCompare(b.deviceId));
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
