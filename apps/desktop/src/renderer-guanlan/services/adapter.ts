/**
 * Guanlan Spectrum Adaptive - Data Adapter Interface
 * Isolates UI presentation from underlying IPC / bridge implementation.
 * Allows mock-first UI slice rendering and seamless real dscBridge swap.
 */

import type {
  DesktopSnapshot,
  DesktopSnapshotRequest,
  DesktopConfigPatch,
  DesktopAgentControlAction,
  DesktopStartupSettings,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync
} from "@dsc/shared";

export interface MockStateFlags {
  simulateEmpty: boolean;
  simulateCached: boolean;
  simulateAgentStopped: boolean;
  simulateError: boolean;
}

export interface IGuanlanDataAdapter {
  getSnapshot(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  refresh(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  updateLocalConfig(patch: DesktopConfigPatch): Promise<DesktopSnapshot>;
  controlAgent(action: DesktopAgentControlAction): Promise<DesktopSnapshot>;
  saveHubConnection(serverUrl: string, accessKey: string): Promise<DesktopSnapshot>;
  saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot>;
  deleteInstance(deviceId: string): Promise<DesktopSnapshot>;
  reorderInstances(deviceIds: string[]): Promise<DesktopSnapshot>;
  updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot>;
  cloudPush(): Promise<DesktopSnapshot>;
  getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync>;
  saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync>;
  openExternal(url: string): Promise<void>;
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<boolean>;
  windowClose(): Promise<void>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;

  // Mock-only simulation toggles (ignored in real bridge mode)
  setMockFlags?(flags: Partial<MockStateFlags>): void;
  getMockFlags?(): MockStateFlags;
}
