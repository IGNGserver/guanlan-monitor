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
  DesktopStartupSettings
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
  setAgentSecret(secret: string): Promise<DesktopSnapshot>;
  saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot>;
  updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot>;
  cloudPush(): Promise<DesktopSnapshot>;
  openExternal(url: string): Promise<void>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;

  // Mock-only simulation toggles (ignored in real bridge mode)
  setMockFlags?(flags: Partial<MockStateFlags>): void;
  getMockFlags?(): MockStateFlags;
}
