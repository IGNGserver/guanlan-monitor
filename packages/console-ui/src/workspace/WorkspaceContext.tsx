import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConsoleSnapshot,
  DesktopRuntimeProfile
} from "@dsc/shared";
import type { ConsoleAdapter } from "../services/adapter";
import { fallbackRuntimeProfile, fallbackWindowMaterialCapabilities } from "../services/adapter";
import { resolveInteractionScale } from "../helpers/density";
import { parseWorkspaceHash, type WorkspaceRoute } from "./routes";
import { formatWorkspaceError as formatError, type HubViewModel, type WorkspaceContextValue } from "./context/WorkspaceTypes";
import { useWorkspaceMutations } from "./context/useWorkspaceMutations";
import { useWorkspaceUiState } from "./context/useWorkspaceUiState";

export type { SettingsSection, WorkspaceRoute } from "./routes";
export type { HubViewModel } from "./context/WorkspaceTypes";

export const WorkspaceProvider: React.FC<{ adapter: ConsoleAdapter; initialRoute?: WorkspaceRoute; children: React.ReactNode }> = ({ adapter, initialRoute, children }) => {
  const isPreview = false;
  const {
    route,
    setRoute,
    navigate,
    openSettings,
    closeSettings,
    sidebarCollapsed,
    setSidebarCollapsed,
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
    density,
    setDensity,
    refreshInterval,
    setRefreshInterval,
    instanceType,
    setInstanceType,
    orientation,
    isTouch,
    inputMode,
    layoutTier
  } = useWorkspaceUiState({ adapter, initialRoute });
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const pendingMutationsRef = useRef(0);
  const mutationEpochRef = useRef(0);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<WorkspaceContextValue["notice"]>(null);
  const [runtimeProfile, setRuntimeProfile] = useState<DesktopRuntimeProfile>(fallbackRuntimeProfile);

  useEffect(() => {
    let cancelled = false;
    const syncRuntimeProfile = async () => {
      try {
        const nextProfile = adapter.getRuntimeProfile
          ? await adapter.getRuntimeProfile()
          : fallbackRuntimeProfile();
        if (!cancelled) setRuntimeProfile(nextProfile);
      } catch {
        if (!cancelled) setRuntimeProfile(fallbackRuntimeProfile());
      }
    };
    void syncRuntimeProfile();
    const timer = window.setInterval(() => void syncRuntimeProfile(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [adapter]);

  const lowResourceMode = adapter.capabilities.canControlNativeWindow && (
    runtimeProfile.isRemoteSession
    || runtimeProfile.memoryPressure !== "normal"
    || orientation === "portrait"
    || layoutTier === "xs"
  );
  const chartPointLimit = Math.max(2, Math.min(
    runtimeProfile.chartPointLimit,
    lowResourceMode ? 120 : 240
  ));

  const selectedDeviceId = route.kind === "device" ? route.deviceId : snapshot?.selectedDeviceId ?? null;

  const fetchSnapshot = useCallback(
    async (forceRefresh: boolean, announce = forceRefresh) => {
      // Guard with the ref as well as the rendered flag. A mutation can start
      // and a timer can fire before React commits the next render; the ref
      // closes that small window and prevents a stale refresh from overwriting
      // the mutation result.
      if (pendingMutationsRef.current > 0) return;
      if (refreshInFlightRef.current) return refreshInFlightRef.current;
      const request = {
        selectedDeviceId: selectedDeviceId ?? undefined,
        metricWindow: metricsWindow,
        trafficMode
      };
      const requestEpoch = mutationEpochRef.current;
      const refresh = (async () => {
        try {
          setError(null);
          if (forceRefresh) setRefreshing(true);
          else setLoading(true);
          const nextSnapshot = forceRefresh
            ? await adapter.refresh(request)
            : await adapter.getSnapshot(request);
          if (requestEpoch !== mutationEpochRef.current || pendingMutationsRef.current > 0) return;
          setSnapshot(nextSnapshot);
          if (announce) {
            setNotice({ tone: "success", text: "状态已更新" });
          }
        } catch (nextError) {
          if (requestEpoch === mutationEpochRef.current && pendingMutationsRef.current === 0) {
            setError(formatError(nextError, "无法读取设备状态"));
            if (announce) setNotice({ tone: "error", text: "刷新失败，请检查连接" });
          }
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      })();
      refreshInFlightRef.current = refresh;
      try {
        await refresh;
      } finally {
        if (refreshInFlightRef.current === refresh) refreshInFlightRef.current = null;
      }
    },
    [adapter, metricsWindow, selectedDeviceId, trafficMode]
  );

  useEffect(() => {
    void fetchSnapshot(false);
    const unsubscribe = adapter.subscribe((nextSnapshot) => {
      if (pendingMutationsRef.current > 0) return;
      setSnapshot(nextSnapshot);
    });
    return unsubscribe;
  }, [adapter, fetchSnapshot]);

  useEffect(() => {
    const handleLocationChange = () => setRoute(parseWorkspaceHash(window.location.hash));
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const effectiveRefreshInterval = lowResourceMode
      ? 30
      : Math.max(refreshInterval, runtimeProfile.recommendedRefreshInterval);
    const schedule = () => {
      if (cancelled) return;
      timer = window.setTimeout(async () => {
        timer = null;
        await fetchSnapshot(true, false);
        schedule();
      }, effectiveRefreshInterval * 1000);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [fetchSnapshot, lowResourceMode, refreshInterval, runtimeProfile.recommendedRefreshInterval]);

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
    applyTheme();
    if (theme !== "system") return;

    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [density, inputMode, isTouch, theme]);

  useEffect(() => {
    let cancelled = false;
    const syncWindowMaterial = async () => {
      const root = document.documentElement;
      root.dataset.dscMaterial = "opaque";
      localStorage.removeItem("dsc-window-material");
      try {
        const capabilities = adapter.getWindowMaterialCapabilities
          ? await adapter.getWindowMaterialCapabilities()
          : fallbackWindowMaterialCapabilities();
        if (cancelled) return;
        root.dataset.dscMaterial = capabilities.activeMaterial;
      } catch {
        if (cancelled) return;
        root.dataset.dscMaterial = "opaque";
      }
    };
    void syncWindowMaterial();
    return () => {
      cancelled = true;
      document.documentElement.dataset.dscMaterial = "opaque";
    };
  }, [adapter]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.dscRuntimeMode = lowResourceMode ? "low-resource" : "normal";
    root.dataset.dscMemoryPressure = runtimeProfile.memoryPressure;
    return () => {
      delete root.dataset.dscRuntimeMode;
      delete root.dataset.dscMemoryPressure;
    };
  }, [lowResourceMode, runtimeProfile.memoryPressure]);

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
        setSidebarCollapsed(!sidebarCollapsed);
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
  }, [fetchSnapshot, openSettings, setSidebarCollapsed, sidebarCollapsed]);

  const {
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
    disconnectAgent
  } = useWorkspaceMutations({
    adapter,
    pendingMutationsRef,
    mutationEpochRef,
    setSnapshot,
    setNotice,
    setMutationPending
  });

  const refresh = useCallback(() => fetchSnapshot(true), [fetchSnapshot]);

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
    layoutTier,
    runtimeProfile,
    lowResourceMode,
    chartPointLimit
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
