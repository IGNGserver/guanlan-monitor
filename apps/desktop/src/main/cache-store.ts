import path from "node:path";
import { stat } from "node:fs/promises";
import type { DesktopSnapshot } from "@dsc/shared";
import { readJsonFile, writeJsonAtomically } from "./atomic-json.js";

interface CacheEnvelope {
  version: 2;
  scope: string;
  savedAt: string;
  snapshot: DesktopSnapshot;
}

export class DesktopCacheStore {
  private readonly filePath: string;
  private loaded: { scope: string; value: Promise<DesktopSnapshot | null> } | null = null;
  private pending: CacheEnvelope | null = null;
  private writes: Promise<void> = Promise.resolve();
  private epoch = 0;
  private blocked = false;
  private savedAt = -Infinity;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "desktop-cache.json");
  }

  async read(scope: string | null = null): Promise<DesktopSnapshot | null> {
    if (!scope || this.blocked) return null;
    const readEpoch = this.epoch;
    if (this.loaded?.scope !== scope) {
      const epoch = this.epoch;
      const value = stat(this.filePath).then((info) => info.size <= 4_000_000 ? readJsonFile<CacheEnvelope>(this.filePath) : null).then((envelope) => {
        if (epoch !== this.epoch || envelope?.version !== 2 || envelope.scope !== scope || !envelope.snapshot) return null;
        const age = Date.now() - Date.parse(envelope.savedAt);
        if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60_000) return null;
        return sanitizeCachedSnapshot(envelope.snapshot);
      }).catch(() => null);
      this.loaded = { scope, value };
    }
    const result = await this.loaded.value;
    if (readEpoch !== this.epoch || this.blocked) return null;
    const age = result ? Date.now() - Date.parse(result.generatedAt) : Infinity;
    return age >= 0 && age <= 24 * 60 * 60_000 ? result : null;
  }

  async write(snapshot: DesktopSnapshot, scope: string | null = null): Promise<void> {
    if (!scope || snapshot.source !== "live" || !snapshot.session.authenticated) return;
    const safeSnapshot = sanitizeCachedSnapshot({ ...snapshot, localBackend: null, update: null,
      session: { authenticated: false, accessKeyConfigured: false } });
    if (Buffer.byteLength(JSON.stringify(safeSnapshot), "utf8") > 3_990_000) {
      safeSnapshot.metrics = null; safeSnapshot.overviewMetrics = null; safeSnapshot.trafficCalendar = null;
      if (Buffer.byteLength(JSON.stringify(safeSnapshot), "utf8") > 3_990_000) return;
    }
    this.loaded = { scope, value: Promise.resolve(safeSnapshot) };
    this.blocked = false;
    this.pending = { version: 2, scope, savedAt: new Date().toISOString(), snapshot: safeSnapshot };
    // Keep the latest offline snapshot in memory. Persist at most once per
    // minute during polling, and flush the latest state on orderly shutdown.
    if (Date.now() - this.savedAt >= 60_000) await this.flush();
  }

  async flush(): Promise<void> {
    const epoch = this.epoch;
    const writing = this.writes.catch(() => {}).then(async () => {
      if (epoch !== this.epoch || !this.pending) return;
      const envelope = this.pending; this.pending = null;
      try {
        await writeJsonAtomically(this.filePath, envelope, false);
        if (epoch === this.epoch) this.savedAt = Date.now();
      } catch (error) {
        if (epoch === this.epoch) this.pending ??= envelope;
        throw error;
      }
    });
    this.writes = writing;
    await writing;
  }

  async clear(): Promise<void> {
    ++this.epoch;
    this.blocked = true;
    this.loaded = null; this.pending = null; this.savedAt = -Infinity;
    // Serialize after any old write so it cannot recreate signed-out telemetry.
    const clear = this.writes.catch(() => {}).then(() => writeJsonAtomically(this.filePath, null, false));
    this.writes = clear;
    await clear;
  }
}

function sanitizeCachedSnapshot(snapshot: DesktopSnapshot): DesktopSnapshot {
  const cleaned = structuredClone(snapshot);
  const isVirtualMachine = (deviceId: string, value?: Record<string, unknown>) =>
    deviceId.startsWith("vm:") || value?.instanceType === "virtual_machine" || Boolean(value?.virtualMachine);
  cleaned.devices = cleaned.devices.filter((device) => !isVirtualMachine(device.deviceId, device as unknown as Record<string, unknown>));
  if (cleaned.selectedDeviceId && !cleaned.devices.some((device) => device.deviceId === cleaned.selectedDeviceId)) {
    cleaned.selectedDeviceId = cleaned.devices[0]?.deviceId ?? null;
  }
  if (cleaned.metrics) {
    const metrics = cleaned.metrics as typeof cleaned.metrics & Record<string, unknown>;
    if (isVirtualMachine(metrics.device.deviceId, metrics.device as unknown as Record<string, unknown>)) {
      cleaned.metrics = null;
    } else {
      const device = metrics.device as typeof metrics.device & Record<string, unknown>;
      delete device.instanceType;
      delete device.hostDeviceId;
      delete device.hostName;
      delete device.virtualMachine;
      delete (metrics as typeof metrics & Record<string, unknown>).virtualization;
      delete (metrics.latest as typeof metrics.latest & Record<string, unknown>).virtualization;
    }
  }
  if (cleaned.overviewMetrics) {
    cleaned.overviewMetrics.instances = cleaned.overviewMetrics.instances.filter((item) =>
      !isVirtualMachine(item.deviceId, item as unknown as Record<string, unknown>)
    );
    for (const instance of cleaned.overviewMetrics.instances) {
      delete (instance as typeof instance & Record<string, unknown>).instanceType;
      delete (instance as typeof instance & Record<string, unknown>).virtualMachine;
      delete (instance as typeof instance & Record<string, unknown>).hostDeviceId;
      delete (instance as typeof instance & Record<string, unknown>).hostName;
    }
  }
  if (cleaned.localBackend) {
    delete (cleaned.localBackend.config as typeof cleaned.localBackend.config & Record<string, unknown>).virtualization;
  }
  return cleaned;
}
