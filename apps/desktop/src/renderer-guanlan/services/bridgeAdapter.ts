/**
 * Guanlan Spectrum Adaptive - Desktop Bridge Data Adapter
 * Connects Guanlan Renderer to the existing safe DesktopRendererBridge contract (`dscBridge`).
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
import type { IGuanlanDataAdapter } from "./adapter";
import { dscBridge } from "../../renderer/services/dscBridge";

export class BridgeGuanlanDataAdapter implements IGuanlanDataAdapter {
  async getSnapshot(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot> {
    return dscBridge.getSnapshot(request);
  }

  async refresh(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot> {
    return dscBridge.refresh(request);
  }

  async updateLocalConfig(patch: DesktopConfigPatch): Promise<DesktopSnapshot> {
    return dscBridge.updateLocalConfig(patch);
  }

  async controlAgent(action: DesktopAgentControlAction): Promise<DesktopSnapshot> {
    return dscBridge.controlAgent(action);
  }

  async saveHubConnection(serverUrl: string, accessKey: string): Promise<DesktopSnapshot> {
    return dscBridge.saveHubConnection(serverUrl, accessKey);
  }

  async saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot> {
    return dscBridge.saveFanNote(deviceId, fanId, note);
  }

  async deleteInstance(deviceId: string): Promise<DesktopSnapshot> {
    return dscBridge.deleteInstance(deviceId);
  }

  async reorderInstances(deviceIds: string[]): Promise<DesktopSnapshot> {
    return dscBridge.reorderInstances(deviceIds);
  }

  async updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot> {
    return dscBridge.updateStartupSettings(settings);
  }

  async cloudPush(): Promise<DesktopSnapshot> {
    return dscBridge.cloudPush();
  }

  async getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync> {
    return dscBridge.getWidgetLayout(request);
  }

  async saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync> {
    return dscBridge.saveWidgetLayout(request);
  }

  async openExternal(url: string): Promise<void> {
    return dscBridge.openExternal(url);
  }

  async windowMinimize(): Promise<void> {
    return dscBridge.windowMinimize();
  }

  async windowToggleMaximize(): Promise<boolean> {
    return dscBridge.windowToggleMaximize();
  }

  async windowClose(): Promise<void> {
    return dscBridge.windowClose();
  }

  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void {
    return dscBridge.subscribe(listener);
  }
}
