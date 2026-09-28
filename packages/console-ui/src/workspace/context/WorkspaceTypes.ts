import type {
  DesktopAgentControlAction,
  DesktopConfigPatch,
  ConsoleSnapshot,
  DesktopRuntimeProfile,
  DesktopStartupSettings,
  DeviceSummary,
  MetricWindow,
  TrafficCalendarMode
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
  /**
   * `theme` resolved against the operating system, in exactly one place.
   * Consumers that need a concrete light/dark choice — the Carbon `<Theme>`
   * wrapper and the chart theme — read this instead of running their own
   * `prefers-color-scheme` listener.
   */
  resolvedTheme: "light" | "dark";
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

/**
 * Turn a transport or bridge failure code into something a user can act on.
 *
 * Every message states the fact first and the next step second, and none of
 * them exceeds one sentence: the previous set mixed commands ("请输入中枢地址")
 * with descriptions ("中枢地址无效") at wildly different lengths, so two
 * failures that needed the same action read as three different problems.
 */
export function formatWorkspaceError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    const code = error.message.trim().toLowerCase();
    const messages: Record<string, string> = {
      hub_server_url_invalid: "中枢地址无效。请使用以 http:// 或 https:// 开头的完整地址。",
      hub_server_url_missing: "还没有配置中枢地址。请在连接页填写中枢地址。",
      hub_server_url_required: "缺少中枢地址。请输入完整地址，例如 https://hub.example.com。",
      hub_access_key_required: "缺少访问密钥。请输入中枢的访问密钥。",
      access_key_required: "缺少访问密钥。请输入中枢的访问密钥。",
      hub_login_required: "当前连接尚未认证。请在连接页重新连接中枢。",
      login_failed: "访问密钥不正确。请核对后重新输入。",
      unauthorized: "当前会话已失效。请重新认证后再查看设备。",
      local_agent_unavailable: "本机 Agent 当前不可用。请先在设置里启动服务。",
      cloud_push_unavailable: "当前环境不支持同步到中枢。请在桌面端执行同步。",
      desktop_bridge_unavailable: "桌面桥接暂不可用。请重新打开观澜后重试。",
      // The fallback adapter used before the preload bridge answers; users only
      // ever saw the generic fallback text, which named no cause at all.
      desktop_bridge_not_ready: "桌面桥接尚未就绪。请稍候几秒，或重新打开观澜。",
      startup_settings_unavailable: "当前环境不支持修改启动设置。请在桌面端修改。"
    };
    if (messages[code]) return messages[code];
    const status = code.match(/(?:hub|agent_backend)_(401|403|404|408|429|500|502|503|504)(?::|$)/)?.[1];
    if (status === "401" || status === "403") return "认证未被接受。请检查访问密钥或重新完成当前会话认证。";
    if (status === "404") return "找不到目标服务。请核对中枢地址与端口。";
    if (["408", "504"].includes(status ?? "")) return "服务响应超时。请检查网络后重试。";
    if (["429", "500", "502", "503"].includes(status ?? "")) return "服务暂时不可用。请稍后重试。";
    if (code.includes("timeout") || code.includes("timed out")) return "请求超时。请检查网络后重试。";
    if (code.includes("network") || code.includes("fetch") || code.includes("failed to fetch")) return "网络连接失败。请检查网络与中枢地址后重试。";
    return fallback;
  }
  return fallback;
}

