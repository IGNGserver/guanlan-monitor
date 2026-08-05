import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  DesktopAgentControlAction,
  DesktopConfigPatch,
  DesktopSnapshot,
  DesktopStartupSettings,
  DeviceSummary,
  MetricWindow,
  TrafficCalendarMode
} from "@dsc/shared";
import { dscBridge } from "../../renderer/services/dscBridge";
import { BridgeGuanlanDataAdapter } from "../services/bridgeAdapter";
import { MockGuanlanDataAdapter } from "../services/mockAdapter";
import type { IGuanlanDataAdapter } from "../services/adapter";

export type SettingsSection =
  | "general"
  | "appearance"
  | "connections"
  | "agent"
  | "data"
  | "shortcuts"
  | "about";

export type WorkspaceRoute =
  | { kind: "overview" }
  | { kind: "hub"; hubId: string }
  | { kind: "device"; deviceId: string }
  | { kind: "settings"; section: SettingsSection };

export interface HubViewModel {
  id: string;
  name: string;
  endpoint: string;
  devices: DeviceSummary[];
  state: "online" | "offline" | "cached" | "unknown";
}

interface WorkspaceContextValue {
  route: WorkspaceRoute;
  navigate: (route: WorkspaceRoute) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  canGoBack: boolean;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  snapshot: DesktopSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  notice: { tone: "success" | "error" | "info"; text: string } | null;
  hubs: HubViewModel[];
  devices: DeviceSummary[];
  filteredDevices: DeviceSummary[];
  selectedDevice: DeviceSummary | null;
  metricsWindow: MetricWindow;
  setMetricsWindow: (window: MetricWindow) => void;
  trafficMode: TrafficCalendarMode;
  setTrafficMode: (mode: TrafficCalendarMode) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  collapsedHubs: Record<string, boolean>;
  toggleHub: (hubId: string) => void;
  theme: "system" | "light" | "dark";
  setTheme: (theme: "system" | "light" | "dark") => void;
  density: "comfortable" | "compact";
  setDensity: (density: "comfortable" | "compact") => void;
  refreshInterval: 5 | 10 | 30;
  setRefreshInterval: (interval: 5 | 10 | 30) => void;
  refresh: () => Promise<void>;
  updateLocalConfig: (patch: DesktopConfigPatch) => Promise<boolean>;
  controlAgent: (action: DesktopAgentControlAction | "restart") => Promise<boolean>;
  saveHubConnection: (serverUrl: string, accessKey: string) => Promise<boolean>;
  updateStartupSettings: (settings: Partial<DesktopStartupSettings>) => Promise<boolean>;
  cloudPush: () => Promise<boolean>;
  login: (accessKey: string) => Promise<void>;
  logout: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  isPreview: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const defaultRoute: WorkspaceRoute = { kind: "overview" };
const settingsSections = new Set<SettingsSection>([
  "general",
  "appearance",
  "connections",
  "agent",
  "data",
  "shortcuts",
  "about"
]);

function routeFromHash(): WorkspaceRoute {
  if (typeof window === "undefined") return defaultRoute;
  const value = window.location.hash.replace(/^#/, "");
  const [kind, id] = value.split("/");
  if (kind === "device" && id) return { kind: "device", deviceId: decodeURIComponent(id) };
  if (kind === "hub" && id) return { kind: "hub", hubId: decodeURIComponent(id) };
  if (kind === "settings" && id && settingsSections.has(id as SettingsSection)) {
    return { kind: "settings", section: id as SettingsSection };
  }
  return defaultRoute;
}

function hashForRoute(route: WorkspaceRoute): string {
  switch (route.kind) {
    case "device":
      return `#device/${encodeURIComponent(route.deviceId)}`;
    case "hub":
      return `#hub/${encodeURIComponent(route.hubId)}`;
    case "settings":
      return `#settings/${route.section}`;
    default:
      return "#overview";
  }
}

function getStoredTheme(): "system" | "light" | "dark" {
  const value = typeof window === "undefined" ? "system" : localStorage.getItem("dsc-theme");
  return value === "light" || value === "dark" ? value : "system";
}

function getStoredDensity(): "comfortable" | "compact" {
  const value = typeof window === "undefined" ? "comfortable" : localStorage.getItem("dsc-density");
  return value === "compact" ? "compact" : "comfortable";
}

function getStoredRefreshInterval(): 5 | 10 | 30 {
  const value = typeof window === "undefined" ? "10" : localStorage.getItem("dsc-refresh-interval");
  return value === "5" || value === "30" ? Number(value) as 5 | 30 : 10;
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isPreview = import.meta.env.DEV && import.meta.env.VITE_DSC_UI_PREVIEW === "true";
  const adapter = useMemo<IGuanlanDataAdapter>(
    () => (isPreview ? new MockGuanlanDataAdapter() : new BridgeGuanlanDataAdapter()),
    [isPreview]
  );
  const [route, setRoute] = useState<WorkspaceRoute>(routeFromHash);
  const [returnRoute, setReturnRoute] = useState<WorkspaceRoute>(defaultRoute);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => {
    return typeof window !== "undefined" && localStorage.getItem("dsc-sidebar-collapsed") === "true";
  });
  const [collapsedHubs, setCollapsedHubs] = useState<Record<string, boolean>>({});
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<WorkspaceContextValue["notice"]>(null);
  const [metricsWindow, setMetricsWindow] = useState<MetricWindow>("1h");
  const [trafficMode, setTrafficMode] = useState<TrafficCalendarMode>("day");
  const [searchQuery, setSearchQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [theme, setThemeState] = useState<"system" | "light" | "dark">(getStoredTheme);
  const [density, setDensityState] = useState<"comfortable" | "compact">(getStoredDensity);
  const [refreshInterval, setRefreshIntervalState] = useState<5 | 10 | 30>(getStoredRefreshInterval);

  const selectedDeviceId = route.kind === "device" ? route.deviceId : snapshot?.selectedDeviceId ?? null;

  const navigate = useCallback((nextRoute: WorkspaceRoute) => {
    setRoute(nextRoute);
    if (typeof window !== "undefined" && window.location.hash !== hashForRoute(nextRoute)) {
      window.history.pushState({ route: nextRoute }, "", hashForRoute(nextRoute));
    }
  }, []);

  const openSettings = useCallback(
    (section: SettingsSection = "general") => {
      setReturnRoute((current) => (route.kind === "settings" ? current : route));
      navigate({ kind: "settings", section });
    },
    [navigate, route]
  );

  const closeSettings = useCallback(() => navigate(returnRoute), [navigate, returnRoute]);

  const fetchSnapshot = useCallback(
    async (forceRefresh: boolean) => {
      const request = {
        selectedDeviceId: selectedDeviceId ?? undefined,
        metricWindow: metricsWindow,
        trafficMode
      };
      try {
        setError(null);
        if (forceRefresh) setRefreshing(true);
        else setLoading(true);
        const nextSnapshot = forceRefresh
          ? await adapter.refresh(request)
          : await adapter.getSnapshot(request);
        setSnapshot(nextSnapshot);
        if (forceRefresh) {
          setNotice({ tone: "success", text: "状态已更新" });
        }
      } catch (nextError) {
        setError(formatError(nextError, "无法读取设备状态"));
        if (forceRefresh) setNotice({ tone: "error", text: "刷新失败，请检查连接" });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [adapter, metricsWindow, selectedDeviceId, trafficMode]
  );

  useEffect(() => {
    void fetchSnapshot(false);
    const unsubscribe = adapter.subscribe((nextSnapshot) => setSnapshot(nextSnapshot));
    return unsubscribe;
  }, [adapter, fetchSnapshot]);

  useEffect(() => {
    const handlePopState = () => setRoute(routeFromHash());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void fetchSnapshot(false), refreshInterval * 1000);
    return () => window.clearInterval(timer);
  }, [fetchSnapshot, refreshInterval]);

  useEffect(() => {
    const currentDevice = snapshot?.devices.find((device) => device.deviceId === selectedDeviceId);
    if (route.kind === "device" && !currentDevice && snapshot?.devices.length) {
      navigate({ kind: "overview" });
    }
  }, [navigate, route, selectedDeviceId, snapshot]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.dscTheme = theme;
    root.dataset.dscDensity = density;
    if (theme === "system") {
      root.dataset.dscResolvedTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } else {
      root.dataset.dscResolvedTheme = theme;
    }
  }, [density, theme]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (!editing && (event.key === "/" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k"))) {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") setCommandOpen(false);
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsedState((current) => {
          const next = !current;
          localStorage.setItem("dsc-sidebar-collapsed", String(next));
          return next;
        });
      }
      if (!editing && (event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        openSettings("general");
      }
      if (!editing && (event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r"))) {
        event.preventDefault();
        void fetchSnapshot(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fetchSnapshot, openSettings]);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    localStorage.setItem("dsc-sidebar-collapsed", String(collapsed));
  }, []);

  const setTheme = useCallback((nextTheme: "system" | "light" | "dark") => {
    setThemeState(nextTheme);
    localStorage.setItem("dsc-theme", nextTheme);
  }, []);

  const setDensity = useCallback((nextDensity: "comfortable" | "compact") => {
    setDensityState(nextDensity);
    localStorage.setItem("dsc-density", nextDensity);
  }, []);

  const setRefreshInterval = useCallback((nextInterval: 5 | 10 | 30) => {
    setRefreshIntervalState(nextInterval);
    localStorage.setItem("dsc-refresh-interval", String(nextInterval));
  }, []);

  const toggleHub = useCallback((hubId: string) => {
    setCollapsedHubs((current) => ({ ...current, [hubId]: !current[hubId] }));
  }, []);

  const runMutation = useCallback(
    async (action: () => Promise<DesktopSnapshot>, successText: string, errorText: string): Promise<boolean> => {
      try {
        const nextSnapshot = await action();
        setSnapshot(nextSnapshot);
        setNotice({ tone: "success", text: successText });
        return true;
      } catch (mutationError) {
        setNotice({ tone: "error", text: `${errorText}: ${formatError(mutationError, "未知错误")}` });
        return false;
      }
    },
    []
  );

  const refresh = useCallback(() => fetchSnapshot(true), [fetchSnapshot]);
  const updateLocalConfig = useCallback(
    (patch: DesktopConfigPatch) => runMutation(() => adapter.updateLocalConfig(patch), "本机配置已保存", "保存失败"),
    [adapter, runMutation]
  );
  const controlAgent = useCallback(
    async (action: DesktopAgentControlAction | "restart") => {
      if (action === "restart") {
        const stopped = await runMutation(() => adapter.controlAgent("stop"), "Agent 已停止", "停止失败");
        if (!stopped) return false;
        return runMutation(() => adapter.controlAgent("start"), "Agent 已重启", "启动失败");
      }
      return runMutation(() => adapter.controlAgent(action), "Agent 操作已完成", "Agent 操作失败");
    },
    [adapter, runMutation]
  );
  const saveHubConnection = useCallback(
    (serverUrl: string, accessKey: string) => runMutation(() => adapter.saveHubConnection(serverUrl, accessKey), "中枢连接已保存", "连接保存失败"),
    [adapter, runMutation]
  );
  const updateStartupSettings = useCallback(
    (settings: Partial<DesktopStartupSettings>) => runMutation(() => adapter.updateStartupSettings(settings), "启动设置已保存", "启动设置保存失败"),
    [adapter, runMutation]
  );
  const cloudPush = useCallback(() => runMutation(() => adapter.cloudPush(), "配置已同步到中枢", "同步失败"), [adapter, runMutation]);
  const login = useCallback(async (accessKey: string) => {
    if (isPreview) return;
    try {
      const nextSnapshot = await dscBridge.login(accessKey);
      setSnapshot(nextSnapshot);
      setNotice({ tone: "success", text: "已连接中枢" });
    } catch (loginError) {
      setNotice({ tone: "error", text: `连接失败：${formatError(loginError, "认证失败")}` });
    }
  }, [isPreview]);
  const logout = useCallback(async () => {
    if (isPreview) return;
    try {
      const nextSnapshot = await dscBridge.logout();
      setSnapshot(nextSnapshot);
      setNotice({ tone: "info", text: "已断开中枢" });
    } catch (logoutError) {
      setNotice({ tone: "error", text: `断开失败：${formatError(logoutError, "未知错误")}` });
    }
  }, [isPreview]);

  const devices = snapshot?.devices ?? [];
  const filteredDevices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return devices;
    return devices.filter((device) => [device.hostname, device.deviceId, device.os].some((value) => value.toLowerCase().includes(query)));
  }, [devices, searchQuery]);
  const endpoint = snapshot?.localBackend?.config.connection.serverUrl || "未配置地址";
  const hubState: HubViewModel["state"] = snapshot?.source === "cache"
    ? "cached"
    : snapshot?.session.authenticated
      ? "online"
      : snapshot?.source === "empty"
        ? "unknown"
        : "offline";
  const hubs = useMemo<HubViewModel[]>(() => [{ id: "primary", name: "当前中枢", endpoint, devices, state: hubState }], [devices, endpoint, hubState]);
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId) ?? null;

  const value: WorkspaceContextValue = {
    route,
    navigate,
    openSettings,
    closeSettings,
    canGoBack: route.kind !== "overview",
    sidebarCollapsed,
    setSidebarCollapsed,
    snapshot,
    loading,
    refreshing,
    error,
    notice,
    hubs,
    devices,
    filteredDevices,
    selectedDevice,
    metricsWindow,
    setMetricsWindow,
    trafficMode,
    setTrafficMode,
    searchQuery,
    setSearchQuery,
    commandOpen,
    setCommandOpen,
    collapsedHubs,
    toggleHub,
    theme,
    setTheme,
    density,
    setDensity,
    refreshInterval,
    setRefreshInterval,
    refresh,
    updateLocalConfig,
    controlAgent,
    saveHubConnection,
    updateStartupSettings,
    cloudPush,
    login,
    logout,
    openExternal: (url: string) => adapter.openExternal(url),
    isPreview
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
