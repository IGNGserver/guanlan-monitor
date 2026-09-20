import type {
  DesktopAgentControlAction,
  DesktopConfigPatch,
  ConsoleSnapshot,
  DesktopRuntimeProfile,
  DesktopStartupSettings,
  DeviceSummary,
  InstanceType,
  MetricWindow,
  TrafficCalendarMode,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync
} from "@dsc/shared";
import type { ConsoleAdapter } from "../../services/adapter";
import type { InteractionScaleSetting, PointerType } from "../../helpers/density";
import type { ResponsiveTier, ScreenOrientation } from "../../helpers/layout";
import type { SettingsSection, WorkspaceRoute } from "../routes";

export interface HubViewModel {
  id: string;
  name: string;
  endpoint: string;
  devices: DeviceSummary[];
  state: "online" | "offline" | "cached" | "unknown";
}
export interface WorkspaceContextValue {
  route: WorkspaceRoute;
  navigate: (route: WorkspaceRoute) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  canGoBack: boolean;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  mutationPending: boolean;
  error: string | null;
  notice: { tone: "success" | "error" | "info"; text: string } | null;
  hubs: HubViewModel[];
  allDevices: DeviceSummary[];
  devices: DeviceSummary[];
  instanceType: InstanceScope;
  setInstanceType: (instanceType: InstanceScope) => void;
  filteredDevices: DeviceSummary[];
  selectedDevice: DeviceSummary | null;
  metricsWindow: MetricWindow;
  setMetricsWindow: (window: MetricWindow) => void;
  trafficMode: TrafficCalendarMode;
  setTrafficMode: (mode: TrafficCalendarMode) => void;
  trafficAnchor: string;
  shiftTrafficAnchor: (direction: -1 | 1) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  theme: "system" | "light" | "dark";
  setTheme: (theme: "system" | "light" | "dark") => void;
  density: InteractionScaleSetting;
  setDensity: (density: InteractionScaleSetting) => void;
  refreshInterval: 5 | 10 | 30;
  setRefreshInterval: (interval: 5 | 10 | 30) => void;
  refresh: () => Promise<void>;
  updateLocalConfig: (patch: DesktopConfigPatch) => Promise<boolean>;
  controlAgent: (action: DesktopAgentControlAction) => Promise<boolean>;
  saveHubConnection: (serverUrl: string, accessKey: string) => Promise<boolean>;
  updateStartupSettings: (settings: Partial<DesktopStartupSettings>) => Promise<boolean>;
  cloudPush: () => Promise<boolean>;
  getWidgetLayout: (request: WidgetLayoutRequest) => Promise<WidgetLayoutSync>;
  saveWidgetLayout: (request: WidgetLayoutSaveRequest) => Promise<WidgetLayoutSync>;
  saveFanNote: (deviceId: string, fanId: string, note: string) => Promise<boolean>;
  deleteInstance: (deviceId: string) => Promise<boolean>;
  reorderInstances: (deviceIds: string[]) => Promise<boolean>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  adapterDragStart: (screenX: number, screenY: number) => void;
  adapterDragMove: (screenX: number, screenY: number) => void;
  adapterDragEnd: () => void;
  login: (accessKey: string) => Promise<void>;
  logout: () => Promise<void>;
  disconnectAgent: () => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
  isPreview: boolean;
  capabilities: ConsoleAdapter["capabilities"];
  orientation: "portrait" | "landscape";
  isTouch: boolean;
  inputMode: PointerType;
  layoutTier: ResponsiveTier;
  runtimeProfile: DesktopRuntimeProfile;
  lowResourceMode: boolean;
  chartPointLimit: number;
}

export type InstanceScope = InstanceType | "all";

export function getStoredTheme(): "system" | "light" | "dark" {
  const value = typeof window === "undefined" ? "system" : localStorage.getItem("dsc-theme");
  return value === "light" || value === "dark" ? value : "system";
}

export function getStoredDensity(): InteractionScaleSetting {
  const value = typeof window === "undefined" ? "auto" : localStorage.getItem("dsc-density");
  return value === "compact" || value === "touch" || value === "comfortable" ? value : "auto";
}

export function getStoredRefreshInterval(): 5 | 10 | 30 {
  const value = typeof window === "undefined" ? "10" : localStorage.getItem("dsc-refresh-interval");
  return value === "5" || value === "30" ? Number(value) as 5 | 30 : 10;
}

export function getStoredInstanceType(): InstanceScope {
  const value = typeof window === "undefined" ? "all" : localStorage.getItem("dsc-instance-type");
  return value === "device" || value === "virtual_machine" || value === "all" ? value : "all";
}

export function formatWorkspaceError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    const code = error.message.trim().toLowerCase();
    const messages: Record<string, string> = {
      hub_server_url_invalid: "中枢地址无效：请输入以 http:// 或 https:// 开头的合法完整 URL。",
      hub_server_url_missing: "还没有配置中枢地址。",
      hub_server_url_required: "请输入中枢地址。",
      hub_access_key_required: "请输入中枢访问密钥。",
      access_key_required: "请输入中枢访问密钥。",
      hub_login_required: "当前连接尚未认证，请重新连接中枢。",
      login_failed: "访问密钥无效或已过期，请重新输入。",
      unauthorized: "当前会话已失效，请重新认证。",
      local_agent_unavailable: "本机 Agent 当前不可用，请先启动服务。",
      cloud_push_unavailable: "当前环境不支持同步到中枢。",
      desktop_bridge_unavailable: "桌面桥接暂不可用，请重新打开观澜。",
      startup_settings_unavailable: "当前环境不支持修改启动设置。"
    };
    if (messages[code]) return messages[code];
    const status = code.match(/(?:hub|agent_backend)_(401|403|404|408|429|500|502|503|504)(?::|$)/)?.[1];
    if (status === "401" || status === "403") return "认证失败，请检查访问密钥或当前会话。";
    if (status === "404") return "找不到目标服务，请检查地址和端口。";
    if (["408", "504"].includes(status ?? "")) return "服务响应超时，请检查网络后重试。";
    if (["429", "500", "502", "503"].includes(status ?? "")) return "服务暂时不可用，请稍后重试。";
    if (code.includes("timeout") || code.includes("timed out")) return "请求超时，请检查网络后重试。";
    if (code.includes("network") || code.includes("fetch") || code.includes("failed to fetch")) return "网络连接失败，请检查网络和中枢地址。";
    return fallback;
  }
  return fallback;
}
