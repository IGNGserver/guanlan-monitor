import { io, type Socket } from "socket.io-client";
import type {
  ConsoleSnapshot,
  ConsoleSnapshotRequest,
  DeviceRealtimeEvent,
  DeviceSummary,
  MetricWindow,
  TrafficCalendarMode,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync
} from "@dsc/shared";
import type { ConsoleAdapter } from "@dsc/console-ui";
import { WEB_CAPABILITIES, emptyConsoleSnapshot } from "@dsc/console-ui";
import {
  deleteDevice,
  getMetrics,
  getOverviewMetrics,
  getSession,
  getTrafficCalendar,
  getUpdateInfo,
  listDevices,
  login,
  logout,
  reorderDevices,
  saveFanNote,
  getWidgetLayout,
  saveWidgetLayout
} from "./api";

export class WebConsoleAdapter implements ConsoleAdapter {
  readonly capabilities = WEB_CAPABILITIES;
  private snapshot: ConsoleSnapshot = emptyConsoleSnapshot();
  private listeners = new Set<(snapshot: ConsoleSnapshot) => void>();
  private socket: Socket | null = null;

  async getSnapshot(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot> {
    return this.loadSnapshot(request);
  }

  async refresh(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot> {
    return this.loadSnapshot(request);
  }

  async login(accessKey: string): Promise<ConsoleSnapshot> {
    await login({ accessKey });
    await getSession();
    return this.loadSnapshot();
  }

  async logout(): Promise<ConsoleSnapshot> {
    this.socket?.close();
    this.socket = null;
    await logout();
    this.snapshot = { ...emptyConsoleSnapshot(), generatedAt: new Date().toISOString() };
    this.notify();
    return this.snapshot;
  }

  async disconnectAgent(): Promise<ConsoleSnapshot> {
    return this.logout();
  }

  async saveHubConnection(_serverUrl: string, accessKey: string): Promise<ConsoleSnapshot> {
    return this.login(accessKey);
  }

  async deleteInstance(deviceId: string): Promise<ConsoleSnapshot> {
    await deleteDevice(deviceId);
    return this.loadSnapshot({ selectedDeviceId: this.snapshot.selectedDeviceId === deviceId ? null : this.snapshot.selectedDeviceId });
  }

  async reorderInstances(deviceIds: string[]): Promise<ConsoleSnapshot> {
    await reorderDevices(deviceIds);
    return this.loadSnapshot({ selectedDeviceId: this.snapshot.selectedDeviceId });
  }

  async saveFanNote(deviceId: string, fanId: string, note: string): Promise<ConsoleSnapshot> {
    await saveFanNote(deviceId, fanId, { note });
    return this.loadSnapshot({ selectedDeviceId: deviceId });
  }

  async getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync> {
    return getWidgetLayout(request);
  }

  async saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync> {
    return saveWidgetLayout(request);
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  subscribe(listener: (snapshot: ConsoleSnapshot) => void): () => void {
    this.listeners.add(listener);
    this.connectSocket();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.socket?.close();
        this.socket = null;
      }
    };
  }

  private async loadSnapshot(request: ConsoleSnapshotRequest = {}): Promise<ConsoleSnapshot> {
    const devices = await listDevices();
    const selectedDeviceId = request.selectedDeviceId !== undefined
      ? request.selectedDeviceId
      : this.snapshot.selectedDeviceId && devices.some((device) => device.deviceId === this.snapshot.selectedDeviceId)
        ? this.snapshot.selectedDeviceId
        : devices[0]?.deviceId ?? null;
    const metricWindow: MetricWindow = request.metricWindow ?? "5m";
    const trafficMode: TrafficCalendarMode = request.trafficMode ?? "day";

    const [metrics, overviewMetrics, update] = await Promise.all([
      selectedDeviceId ? getMetrics(selectedDeviceId, metricWindow).catch(() => null) : Promise.resolve(null),
      getOverviewMetrics(metricWindow).catch(() => null),
      getUpdateInfo("web").catch(() => null)
    ]);
    const trafficCalendar = selectedDeviceId
      ? await getTrafficCalendar(selectedDeviceId, trafficMode, request.trafficAnchor ?? new Date().toISOString()).catch(() => null)
      : null;

    this.snapshot = {
      generatedAt: new Date().toISOString(),
      source: "live",
      cache: { available: false, savedAt: null, ageSeconds: null },
      session: { authenticated: true, accessKeyConfigured: true },
      localBackend: null,
      devices,
      selectedDeviceId,
      metrics,
      overviewMetrics,
      trafficCalendar,
      update,
      startup: { openAtLogin: false, startMinimized: false }
    };
    this.notify();
    return this.snapshot;
  }

  private connectSocket(): void {
    if (this.socket || typeof window === "undefined") return;
    this.socket = io({
      path: "/socket.io",
      transports: ["websocket"],
      withCredentials: true
    });
    this.socket.on("device:update", (event: DeviceRealtimeEvent) => {
      if (event.removed) {
        const devices = this.snapshot.devices.filter((device) => device.deviceId !== event.deviceId);
        this.snapshot = { ...this.snapshot, generatedAt: new Date().toISOString(), devices };
        this.notify();
        if (this.snapshot.selectedDeviceId === event.deviceId) {
          void this.loadSnapshot();
        }
        return;
      }
      const devices = upsertDevice(this.snapshot.devices, event.summary);
      this.snapshot = { ...this.snapshot, generatedAt: new Date().toISOString(), devices };
      this.notify();
      if (this.snapshot.selectedDeviceId === event.deviceId) {
        void this.loadSnapshot({ selectedDeviceId: event.deviceId });
      }
    });
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

function upsertDevice(devices: DeviceSummary[], next: DeviceSummary): DeviceSummary[] {
  const index = devices.findIndex((device) => device.deviceId === next.deviceId);
  if (index < 0) return [...devices, next];
  return devices.map((device, itemIndex) => itemIndex === index ? { ...device, ...next, sortOrder: next.sortOrder ?? device.sortOrder } : device);
}

export const webConsoleAdapter = new WebConsoleAdapter();
