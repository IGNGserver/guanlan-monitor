import path from "node:path";
import type { DesktopSnapshot } from "@dsc/shared";
import { readJsonFile, writeJsonAtomically } from "./atomic-json.js";

interface CacheEnvelope {
  version: 1;
  savedAt: string;
  snapshot: DesktopSnapshot;
}

export class DesktopCacheStore {
  private readonly filePath: string;
  private loaded: Promise<DesktopSnapshot | null> | null = null;
  private pending: DesktopSnapshot | null = null;
  private writing: Promise<void> | null = null;
  private savedAt = -Infinity;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "desktop-cache.json");
  }

  async read(): Promise<DesktopSnapshot | null> {
    this.loaded ??= readJsonFile<CacheEnvelope>(this.filePath)
      .then(async (envelope) => {
        if (envelope?.version !== 1 || !envelope.snapshot) return null;
        const snapshot = sanitizeCachedSnapshot(envelope.snapshot);
        if (JSON.stringify(snapshot) !== JSON.stringify(envelope.snapshot)) {
          await writeJsonAtomically(this.filePath, { ...envelope, snapshot }, false);
        }
        return snapshot;
      })
      .catch(() => null);
    return this.loaded;
  }

  async write(snapshot: DesktopSnapshot): Promise<void> {
    const safeSnapshot: DesktopSnapshot = {
      ...snapshot,
      session: {
        authenticated: snapshot.session.authenticated,
        accessKeyConfigured: snapshot.session.accessKeyConfigured
      }
    };
    this.loaded = Promise.resolve(safeSnapshot);
    this.pending = safeSnapshot;
    // Keep the latest offline snapshot in memory. Persist at most once per
    // minute during polling, and flush the latest state on orderly shutdown.
    if (Date.now() - this.savedAt >= 60_000) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.writing) await this.writing;
    if (!this.pending) return;
    const snapshot = this.pending;
    this.pending = null;
    const writing = writeJsonAtomically(this.filePath, {
      version: 1,
      savedAt: new Date().toISOString(),
      snapshot
    } satisfies CacheEnvelope, false);
    this.writing = writing;
    try {
      await writing;
      this.savedAt = Date.now();
    } catch (error) {
      this.pending ??= snapshot;
      throw error;
    } finally {
      if (this.writing === writing) this.writing = null;
    }
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
      delete (metrics.latest as typeof metrics.latest & Record<string, unknown>).storagePools;
      delete (metrics.series as typeof metrics.series & Record<string, unknown>).storagePools;
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
