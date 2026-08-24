import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  DesktopAgentControlAction,
  DesktopConfigPatch,
  ConsoleSnapshot,
  DesktopStartupSettings,
  DeviceSummary,
  InstanceType,
  MetricWindow,
  TrafficCalendarMode,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync
} from "@dsc/shared";
import type { ConsoleAdapter, WindowMaterial, WindowMaterialCapabilities } from "../services/adapter";
import { fallbackWindowMaterialCapabilities } from "../services/adapter";
import { confirmDiscardWidgetLayoutDraft } from "./WidgetLayout";
import { getResponsiveTier, getScreenOrientation, type ResponsiveTier, type ScreenOrientation } from "../helpers/layout";
import { detectTouchSupport, resolveInteractionScale, type InteractionScaleSetting, type PointerType } from "../helpers/density";

export type SettingsSection =
  | "general"
  | "workspace"
  | "appearance"
  | "connections"
  | "agent"
  | "data"
  | "shortcuts"
  | "session"
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
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  mutationPending: boolean;
  error: string | null;
  notice: { tone: "success" | "error" | "info"; text: string } | null;
  hubs: HubViewModel[];
  allDevices: DeviceSummary[];
  devices: DeviceSummary[];
  instanceType: InstanceType;
  setInstanceType: (instanceType: InstanceType) => void;
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
  theme: "system" | "light" | "dark";
  setTheme: (theme: "system" | "light" | "dark") => void;
  windowMaterial: WindowMaterial;
  setWindowMaterial: (material: WindowMaterial) => void;
  windowMaterialCapabilities: WindowMaterialCapabilities | null;
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
  layoutTier: "xs" | "sm" | "md" | "lg" | "xl";
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const defaultRoute: WorkspaceRoute = { kind: "overview" };
const settingsSections = new Set<SettingsSection>([
  "general",
  "workspace",
  "appearance",
  "connections",
  "agent",
  "data",
  "shortcuts",
  "session",
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

function getStoredWindowMaterial(): WindowMaterial {
  const value = typeof window === "undefined" ? "guanlan" : localStorage.getItem("dsc-window-material");
  return value === "mica" || value === "acrylic" ? value : "guanlan";
}

function getStoredDensity(): InteractionScaleSetting {
  const value = typeof window === "undefined" ? "auto" : localStorage.getItem("dsc-density");
  return value === "compact" || value === "touch" || value === "comfortable" ? value : "auto";
}

function getStoredRefreshInterval(): 5 | 10 | 30 {
  const value = typeof window === "undefined" ? "10" : localStorage.getItem("dsc-refresh-interval");
  return value === "5" || value === "30" ? Number(value) as 5 | 30 : 10;
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    const messages: Record<string, string> = {
      hub_server_url_invalid: "中枢地址无效：公网地址必须使用 HTTPS，局域网 HTTP 仅支持私有地址。",
      hub_server_url_missing: "还没有配置中枢地址。",
      hub_server_url_required: "请输入中枢地址。",
      hub_access_key_required: "请输入中枢访问密钥。"
    };
    return messages[error.message] ?? error.message;
  }
  return fallback;
}

export const WorkspaceProvider: React.FC<{ adapter: ConsoleAdapter; initialRoute?: WorkspaceRoute; children: React.ReactNode }> = ({ adapter, initialRoute, children }) => {
  const isPreview = false;
  const [route, setRoute] = useState<WorkspaceRoute>(() => initialRoute ?? routeFromHash());
  const [returnRoute, setReturnRoute] = useState<WorkspaceRoute>(defaultRoute);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("dsc-sidebar-collapsed");
    return stored === "true";
  });
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const pendingMutationsRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<WorkspaceContextValue["notice"]>(null);
  const [metricsWindow, setMetricsWindow] = useState<MetricWindow>("5m");
  const [trafficMode, setTrafficMode] = useState<TrafficCalendarMode>("day");
  const [searchQuery, setSearchQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [theme, setThemeState] = useState<"system" | "light" | "dark">(getStoredTheme);
  const [windowMaterial, setWindowMaterialState] = useState<WindowMaterial>(getStoredWindowMaterial);
  const [windowMaterialCapabilities, setWindowMaterialCapabilities] = useState<WindowMaterialCapabilities | null>(null);
  const [windowMaterialReady, setWindowMaterialReady] = useState(false);
  const [density, setDensityState] = useState<InteractionScaleSetting>(getStoredDensity);
  const [refreshInterval, setRefreshIntervalState] = useState<5 | 10 | 30>(getStoredRefreshInterval);
  const [instanceType, setInstanceType] = useState<InstanceType>("device");
  // Keep the first render deterministic for the remote Web app. The actual
  // viewport and input device are applied immediately after mount, which also
  // avoids rendering a different tree during hydration on portrait phones.
  const [orientation, setOrientation] = useState<ScreenOrientation>("landscape");
  const [isTouch, setIsTouch] = useState(false);
  const [inputMode, setInputMode] = useState<PointerType>("mouse");
  const [layoutTier, setLayoutTier] = useState<ResponsiveTier>("lg");
  const pointerSeenRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const nextOrientation = getScreenOrientation(w, h);
      const nextTier = getResponsiveTier(w);
      const nextTouch = detectTouchSupport();
      setOrientation(nextOrientation);
      setLayoutTier(nextTier);
      setIsTouch(nextTouch);
      if (!pointerSeenRef.current) setInputMode(nextTouch ? "touch" : "mouse");
      if (localStorage.getItem("dsc-sidebar-collapsed") == null && w <= 820) {
        setSidebarCollapsedState(true);
      }
      document.documentElement.dataset.dscOrientation = nextOrientation;
      document.documentElement.dataset.dscTier = nextTier;
      document.documentElement.dataset.dscTouchSupport = nextTouch ? "true" : "false";
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    const handlePointerDown = (event: PointerEvent) => {
      pointerSeenRef.current = true;
      const nextPointer: PointerType = event.pointerType === "touch" || event.pointerType === "pen" ? event.pointerType : "mouse";
      setInputMode(nextPointer);
      document.documentElement.dataset.dscPointer = nextPointer;
    };
    document.addEventListener("pointerdown", handlePointerDown, { passive: true });
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  const selectedDeviceId = route.kind === "device" ? route.deviceId : snapshot?.selectedDeviceId ?? null;

  const navigate = useCallback((nextRoute: WorkspaceRoute) => {
    if (!confirmDiscardWidgetLayoutDraft()) return;
    setRoute(nextRoute);
    if (typeof window !== "undefined" && window.location.hash !== hashForRoute(nextRoute)) {
      window.history.pushState({ route: nextRoute }, "", hashForRoute(nextRoute));
    }
  }, []);

  const openSettings = useCallback(
    (section: SettingsSection = adapter.capabilities.canControlNativeWindow ? "general" : "workspace") => {
      setReturnRoute((current) => (route.kind === "settings" ? current : route));
      navigate({ kind: "settings", section });
    },
    [adapter, navigate, route]
  );

  const closeSettings = useCallback(() => navigate(returnRoute), [navigate, returnRoute]);

  const fetchSnapshot = useCallback(
    async (forceRefresh: boolean, announce = forceRefresh) => {
      // Guard with the ref as well as the rendered flag. A mutation can start
      // and a timer can fire before React commits the next render; the ref
      // closes that small window and prevents a stale refresh from overwriting
      // the mutation result.
      if (pendingMutationsRef.current > 0) return;
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
        if (announce) {
          setNotice({ tone: "success", text: "状态已更新" });
        }
      } catch (nextError) {
        setError(formatError(nextError, "无法读取设备状态"));
        if (announce) setNotice({ tone: "error", text: "刷新失败，请检查连接" });
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
    const timer = window.setInterval(() => void fetchSnapshot(true, false), refreshInterval * 1000);
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
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme = theme === "system" ? (mediaQuery.matches ? "dark" : "light") : theme;
      root.dataset.dscTheme = theme;
      root.dataset.dscResolvedTheme = resolvedTheme;
      root.style.colorScheme = resolvedTheme;
    };

    root.dataset.dscTheme = theme;
    root.dataset.dscDensity = resolveInteractionScale(density, inputMode !== "mouse");
    root.dataset.dscDensitySetting = density;
    root.dataset.dscPointer = inputMode;
    root.dataset.dscTouchSupport = isTouch ? "true" : "false";
    root.dataset.dscMaterial = windowMaterialReady ? windowMaterial : "guanlan";
    applyTheme();
    if (theme !== "system") return;

    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [density, inputMode, isTouch, theme, windowMaterial, windowMaterialReady]);

  useEffect(() => {
    let cancelled = false;
    const syncWindowMaterial = async () => {
      try {
        if (!adapter.getWindowMaterialCapabilities || !adapter.setWindowMaterial) {
          setWindowMaterialCapabilities(fallbackWindowMaterialCapabilities());
          setWindowMaterialReady(true);
          return;
        }
        const capabilities = await adapter.getWindowMaterialCapabilities();
        if (cancelled) return;
        setWindowMaterialCapabilities(capabilities);
        const applied = await adapter.setWindowMaterial(windowMaterial);
        if (cancelled) return;
        setWindowMaterialCapabilities(applied);
        if (applied.activeMaterial !== windowMaterial) {
          setWindowMaterialState(applied.activeMaterial);
          localStorage.setItem("dsc-window-material", applied.activeMaterial);
        }
        setWindowMaterialReady(true);
      } catch {
        if (cancelled) return;
        setWindowMaterialCapabilities(fallbackWindowMaterialCapabilities());
        setWindowMaterialState("guanlan");
        localStorage.setItem("dsc-window-material", "guanlan");
        setWindowMaterialReady(true);
      }
    };
    void syncWindowMaterial();
    return () => { cancelled = true; };
  }, [adapter, windowMaterial]);

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
        openSettings();
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

  const setWindowMaterial = useCallback((nextMaterial: WindowMaterial) => {
    setWindowMaterialState(nextMaterial);
    setWindowMaterialReady(false);
    localStorage.setItem("dsc-window-material", nextMaterial);
  }, []);

  const setDensity = useCallback((nextDensity: InteractionScaleSetting) => {
    setDensityState(nextDensity);
    localStorage.setItem("dsc-density", nextDensity);
  }, []);

  const setRefreshInterval = useCallback((nextInterval: 5 | 10 | 30) => {
    setRefreshIntervalState(nextInterval);
    localStorage.setItem("dsc-refresh-interval", String(nextInterval));
  }, []);

  const runMutation = useCallback(
    async (action: () => Promise<ConsoleSnapshot>, successText: string, errorText: string): Promise<boolean> => {
      pendingMutationsRef.current += 1;
      setMutationPending(true);
      try {
        const nextSnapshot = await action();
        setSnapshot(nextSnapshot);
        setNotice({ tone: "success", text: successText });
        return true;
      } catch (mutationError) {
        setNotice({ tone: "error", text: `${errorText}: ${formatError(mutationError, "未知错误")}` });
        return false;
      } finally {
        pendingMutationsRef.current = Math.max(0, pendingMutationsRef.current - 1);
        if (pendingMutationsRef.current === 0) setMutationPending(false);
      }
    },
    []
  );

  const refresh = useCallback(() => fetchSnapshot(true), [fetchSnapshot]);
  const updateLocalConfig = useCallback(
    (patch: DesktopConfigPatch) => runMutation(
      () => adapter.updateLocalConfig ? adapter.updateLocalConfig(patch) : Promise.reject(new Error("local_agent_unavailable")),
      "本机配置已保存",
      "保存失败"
    ),
    [adapter, runMutation]
  );
  const controlAgent = useCallback(
    (action: DesktopAgentControlAction) => runMutation(
        () => adapter.controlAgent ? adapter.controlAgent(action) : Promise.reject(new Error("local_agent_unavailable")),
        action === "restart" ? "Agent 已重启" : "Agent 操作已完成",
        action === "restart" ? "Agent 重启失败" : "Agent 操作失败"
      ),
    [adapter, runMutation]
  );
  const saveHubConnection = useCallback(
    (serverUrl: string, accessKey: string) => runMutation(() => adapter.saveHubConnection(serverUrl, accessKey), "中枢连接已保存", "连接保存失败"),
    [adapter, runMutation]
  );
  const updateStartupSettings = useCallback(
    (settings: Partial<DesktopStartupSettings>) => runMutation(
      () => adapter.updateStartupSettings ? adapter.updateStartupSettings(settings) : Promise.reject(new Error("startup_settings_unavailable")),
      "启动设置已保存",
      "启动设置保存失败"
    ),
    [adapter, runMutation]
  );
  const cloudPush = useCallback(
    () => runMutation(
      () => adapter.cloudPush ? adapter.cloudPush() : Promise.reject(new Error("cloud_push_unavailable")),
      "配置已同步到中枢",
      "同步失败"
    ),
    [adapter, runMutation]
  );
  const getWidgetLayout = useCallback((request: WidgetLayoutRequest) => adapter.getWidgetLayout(request), [adapter]);
  const saveWidgetLayout = useCallback((request: WidgetLayoutSaveRequest) => adapter.saveWidgetLayout(request), [adapter]);
  const saveFanNote = useCallback(
    (deviceId: string, fanId: string, note: string) => runMutation(
      () => adapter.saveFanNote(deviceId, fanId, note),
      "风扇备注已保存",
      "保存风扇备注失败"
    ),
    [adapter, runMutation]
  );
  const deleteInstance = useCallback(
    (deviceId: string) => runMutation(() => adapter.deleteInstance(deviceId), "实例已删除；下次上报后会重新显示", "删除实例失败"),
    [adapter, runMutation]
  );
  const reorderInstances = useCallback(
    (deviceIds: string[]) => runMutation(() => adapter.reorderInstances(deviceIds), "实例顺序已保存", "保存排序失败"),
    [adapter, runMutation]
  );
  const minimizeWindow = useCallback(() => adapter.windowMinimize?.() ?? Promise.resolve(), [adapter]);
  const toggleMaximizeWindow = useCallback(() => adapter.windowToggleMaximize?.() ?? Promise.resolve(false), [adapter]);
  const closeWindow = useCallback(() => adapter.windowClose?.() ?? Promise.resolve(), [adapter]);
  const adapterDragStart = useCallback((screenX: number, screenY: number) => adapter.windowDragStart?.(screenX, screenY), [adapter]);
  const adapterDragMove = useCallback((screenX: number, screenY: number) => adapter.windowDragMove?.(screenX, screenY), [adapter]);
  const adapterDragEnd = useCallback(() => adapter.windowDragEnd?.(), [adapter]);
  const login = useCallback(async (accessKey: string) => {
    try {
      const nextSnapshot = await adapter.login(accessKey);
      setSnapshot(nextSnapshot);
      setNotice({ tone: "success", text: "已连接中枢" });
    } catch (loginError) {
      setNotice({ tone: "error", text: `连接失败：${formatError(loginError, "认证失败")}` });
    }
  }, [adapter]);
  const logout = useCallback(
    () => runMutation(
      () => adapter.logout(),
      "已退出桌面查看；本机 Agent 仍可继续上报",
      "退出查看失败"
    ).then(() => undefined),
    [adapter, runMutation]
  );
  const disconnectAgent = useCallback(
    () => runMutation(
      () => adapter.disconnectAgent(),
      "已停止本机上报并清除凭据",
      "停止上报失败"
    ),
    [adapter, runMutation]
  );

  const allDevices = snapshot?.devices ?? [];
  const devices = useMemo(
    () => allDevices.filter((device) => (device.instanceType ?? "device") === instanceType),
    [allDevices, instanceType]
  );
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
  const hubs = useMemo<HubViewModel[]>(() => [{ id: "primary", name: "中枢", endpoint, devices: allDevices, state: hubState }], [allDevices, endpoint, hubState]);
  const selectedDevice = allDevices.find((device) => device.deviceId === selectedDeviceId) ?? null;

  useEffect(() => {
    if (route.kind === "device" && selectedDevice) setInstanceType(selectedDevice.instanceType ?? "device");
  }, [route.kind, selectedDevice]);

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
    mutationPending,
    error,
    notice,
    hubs,
    devices,
    allDevices,
    instanceType,
    setInstanceType,
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
    theme,
    setTheme,
    windowMaterial,
    setWindowMaterial,
    windowMaterialCapabilities,
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
    getWidgetLayout,
    saveWidgetLayout,
    saveFanNote,
    deleteInstance,
    reorderInstances,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    adapterDragStart,
    adapterDragMove,
    adapterDragEnd,
    login,
    logout,
    disconnectAgent,
    openExternal: (url: string) => adapter.openExternal(url),
    isPreview,
    capabilities: adapter.capabilities,
    orientation,
    isTouch,
    inputMode,
    layoutTier
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
