export interface ViewerRealtimeSnapshot {
  enabled: boolean;
  viewerCount: number;
  durationSeconds: number;
  expiresAt: string;
}

const DEFAULT_VIEWER_TTL_SECONDS = 20;

export class ViewerPresenceService {
  private readonly byDevice = new Map<string, Map<string, number>>();
  private readonly onSnapshotChanged?: (deviceId: string, snapshot: ViewerRealtimeSnapshot) => void;

  constructor(onSnapshotChanged?: (deviceId: string, snapshot: ViewerRealtimeSnapshot) => void) {
    this.onSnapshotChanged = onSnapshotChanged;
  }

  touch(deviceId: string, viewerId: string, ttlSeconds = DEFAULT_VIEWER_TTL_SECONDS) {
    const resolvedDeviceId = deviceId.trim();
    const resolvedViewerId = viewerId.trim();
    if (!resolvedDeviceId || !resolvedViewerId) {
      return;
    }

    const now = Date.now();
    const ttlMs = Math.max(5, ttlSeconds) * 1000;
    const viewers = this.byDevice.get(resolvedDeviceId) ?? new Map<string, number>();
    viewers.set(resolvedViewerId, now + ttlMs);
    this.byDevice.set(resolvedDeviceId, viewers);
    this.cleanupDevice(resolvedDeviceId, now);
    this.emitSnapshot(resolvedDeviceId, now);
  }

  clear(deviceId: string, viewerId: string) {
    const resolvedDeviceId = deviceId.trim();
    const viewers = this.byDevice.get(resolvedDeviceId);
    if (!viewers) {
      return;
    }

    viewers.delete(viewerId.trim());
    if (viewers.size === 0) {
      this.byDevice.delete(resolvedDeviceId);
    }
    this.emitSnapshot(resolvedDeviceId);
  }

  snapshot(deviceId: string): ViewerRealtimeSnapshot {
    const now = Date.now();
    this.cleanupDevice(deviceId.trim(), now);
    const viewers = this.byDevice.get(deviceId.trim());
    const viewerCount = viewers?.size ?? 0;
    const durationSeconds = DEFAULT_VIEWER_TTL_SECONDS;
    return {
      enabled: viewerCount > 0,
      viewerCount,
      durationSeconds,
      expiresAt: viewerCount > 0 ? new Date(now + durationSeconds * 1000).toISOString() : ""
    };
  }

  private cleanupDevice(deviceId: string, now = Date.now()) {
    const viewers = this.byDevice.get(deviceId);
    if (!viewers) {
      return;
    }

    for (const [viewerId, expiresAt] of viewers.entries()) {
      if (expiresAt <= now) {
        viewers.delete(viewerId);
      }
    }

    if (viewers.size === 0) {
      this.byDevice.delete(deviceId);
    }
  }

  private emitSnapshot(deviceId: string, now = Date.now()) {
    this.onSnapshotChanged?.(deviceId, this.snapshotAt(deviceId, now));
  }

  private snapshotAt(deviceId: string, now: number): ViewerRealtimeSnapshot {
    this.cleanupDevice(deviceId, now);
    const viewers = this.byDevice.get(deviceId);
    const viewerCount = viewers?.size ?? 0;
    const durationSeconds = DEFAULT_VIEWER_TTL_SECONDS;
    return {
      enabled: viewerCount > 0,
      viewerCount,
      durationSeconds,
      expiresAt: viewerCount > 0 ? new Date(now + durationSeconds * 1000).toISOString() : ""
    };
  }
}
