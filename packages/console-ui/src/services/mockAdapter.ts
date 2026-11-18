import type { ConsoleSnapshot, ConsoleSnapshotRequest, DesktopStartupSettings } from "@dsc/shared";
import { emptyConsoleSnapshot, WEB_CAPABILITIES, type ConsoleAdapter } from "./adapter.ts";

export class MockConsoleAdapter implements ConsoleAdapter {
  readonly capabilities = WEB_CAPABILITIES;
  private snapshot = emptyConsoleSnapshot();
  private listeners = new Set<(snapshot: ConsoleSnapshot) => void>();

  async getSnapshot(_request?: ConsoleSnapshotRequest) { return this.snapshot; }
  async refresh(_request?: ConsoleSnapshotRequest) { return this.snapshot; }
  async login() { this.snapshot = { ...this.snapshot, session: { authenticated: true, accessKeyConfigured: true } }; return this.snapshot; }
  async logout() { this.snapshot = { ...this.snapshot, session: { authenticated: false, accessKeyConfigured: false } }; return this.snapshot; }
  async disconnectAgent() { this.snapshot = { ...this.snapshot, session: { authenticated: false, accessKeyConfigured: false } }; return this.snapshot; }
  async saveHubConnection() { return this.snapshot; }
  async updateStartupSettings(settings: Partial<DesktopStartupSettings>) {
    this.snapshot = { ...this.snapshot, startup: { ...this.snapshot.startup, updateChannel: settings.updateChannel } };
    for (const listener of this.listeners) listener(this.snapshot);
    return this.snapshot;
  }
  async deleteInstance() { return this.snapshot; }
  async reorderInstances() { return this.snapshot; }
  async updateDeviceGroup(deviceIds: string[], group: string | null) {
    return this.syncDeviceGroupMembers(deviceIds, group, []);
  }
  async syncDeviceGroupMembers(assignDeviceIds: string[], group: string | null, removeDeviceIds: string[]) {
    const normalized = group?.trim() ? group.trim() : null;
    const assignSet = new Set(assignDeviceIds);
    const removeSet = new Set(removeDeviceIds.filter((id) => !assignSet.has(id)));
    this.snapshot = {
      ...this.snapshot,
      devices: this.snapshot.devices.map((device) =>
        assignSet.has(device.deviceId)
          ? { ...device, group: normalized }
          : removeSet.has(device.deviceId)
            ? { ...device, group: null }
            : device
      )
    };
    for (const listener of this.listeners) listener(this.snapshot);
    return this.snapshot;
  }
  async saveFanNote() { return this.snapshot; }
  async openExternal(url: string) { window.open(url, "_blank", "noopener,noreferrer"); }
  subscribe(listener: (snapshot: ConsoleSnapshot) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
