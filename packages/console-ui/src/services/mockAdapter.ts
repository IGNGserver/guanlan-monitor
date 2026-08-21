import type { ConsoleSnapshot, ConsoleSnapshotRequest, WidgetLayoutRequest, WidgetLayoutSaveRequest, WidgetLayoutSync } from "@dsc/shared";
import { emptyConsoleSnapshot, WEB_CAPABILITIES, type ConsoleAdapter } from "./adapter";

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
  async deleteInstance() { return this.snapshot; }
  async reorderInstances() { return this.snapshot; }
  async saveFanNote() { return this.snapshot; }
  async getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync> { return { ...request, instanceLayout: null, templates: [] }; }
  async saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync> { return { scopeKey: request.scopeKey, templateKey: request.templateKey, instanceLayout: request.instanceLayout ?? null, templates: [] }; }
  async openExternal(url: string) { window.open(url, "_blank", "noopener,noreferrer"); }
  subscribe(listener: (snapshot: ConsoleSnapshot) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
