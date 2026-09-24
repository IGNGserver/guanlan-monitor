import type {
  DesktopSnapshot,
  DesktopConfigPatch,
  MetricWindow,
  TrafficCalendarMode,
  DeviceSummary,
  DeviceDetail,
  MetricsResponse,
  AgentProbeSelection,
  DeviceMetricKey,
  DeviceBlockKey,
  FanSensorStats
} from "@dsc/shared";

export type ConsoleNavTab = "fleet" | "device-detail" | "local-config" | "traffic-calendar" | "diagnostics";

export interface ConsoleState {
  snapshot: DesktopSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  activeTab: ConsoleNavTab;
  selectedDeviceId: string | null;
  metricWindow: MetricWindow;
  trafficMode: TrafficCalendarMode;
  trafficAnchor: string | undefined;
  deviceSearchQuery: string;
  deviceFilterStatus: "all" | "online" | "offline";
  pendingConfigPatch: DesktopConfigPatch;
  hasPendingChanges: boolean;
  cloudPushStatus: "idle" | "pushing" | "success" | "error";
  cloudPushMessage: string | null;
  accessKeyModalOpen: boolean;
  secretModalOpen: boolean;
  fanNoteModalOpen: { deviceId: string; fanId: string; currentNote: string } | null;
  toastMessage: { type: "info" | "success" | "warning" | "error"; title: string; text: string } | null;
}

export type LocalMetricConfigState = {
  enabledMetrics: DeviceMetricKey[];
  enabledDeviceIds: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig: Record<string, DeviceMetricKey[]>;
};
