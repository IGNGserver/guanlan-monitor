import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConsoleSnapshot,
  DesktopRuntimeProfile
} from "@dsc/shared";
import type { ConsoleAdapter, WindowState } from "../services/adapter";
import { fallbackRuntimeProfile, fallbackWindowMaterialCapabilities, fallbackWindowState } from "../services/adapter";
import { startVisiblePolling } from "../helpers/visiblePolling";
import { resolveInteractionScale } from "../helpers/density";
import { parseWorkspaceHash, serializeWorkspaceRoute, type WorkspaceRoute } from "./routes";
import { formatWorkspaceError as formatError, type WorkspaceContextValue } from "./context/WorkspaceTypes";
import { useWorkspaceMutations } from "./context/useWorkspaceMutations";
import { useWorkspaceUiState } from "./context/useWorkspaceUiState";
import { confirmDiscardDeviceOrderDraft } from "./deviceOrderDraft";
import { selectSnapshotSource } from "./selectors";

export type { SettingsSection, WorkspaceRoute } from "./routes";

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider: React.FC<{ adapter: ConsoleAdapter; initialRoute?: WorkspaceRoute; children: React.ReactNode }> = ({ adapter, initialRoute, children }) => {
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
    trafficAnchor,
    shiftTrafficAnchor,
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
  const [windowState, setWindowState] = useState<WindowState>(fallbackWindowState);

  /* Native window chrome. The host pushes maximize/restore/fullscreen transitions
   * (taskbar, keyboard, window manager) and the renderer reads the initial value
   * once, so the caption buttons reflect the real window instead of assuming a
   * local toggle is the only way it can change. */
  useEffect(() => {
    if (!adapter.getWindowState) return;
    let cancelled = false;
    void adapter.getWindowState().then(
      (state) => { if (!cancelled) setWindowState(state); },
      () => { if (!cancelled) setWindowState(fallbackWindowState()); }
    );
    const unsubscribe = adapter.subscribeWindowState?.((state) => setWindowState(state));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [adapter]);

  useEffect(() => {
    if (!adapter.getRuntimeProfile) return;
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
    const stop = startVisiblePolling(syncRuntimeProfile, 30_000, true);
    return () => {
      cancelled = true;
      stop();
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
  const currentRequestKeyRef = useRef<string>("");
  const queuedRequestRef = useRef<{ forceRefresh: boolean; announce: boolean } | null>(null);

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
        trafficMode,
        trafficAnchor
      };
      const requestKey = `${selectedDeviceId ?? ""}:${metricsWindow}:${trafficMode}:${trafficAnchor}`;
      currentRequestKeyRef.current = requestKey;

      if (refreshInFlightRef.current) {
        queuedRequestRef.current = {
          forceRefresh: forceRefresh || (queuedRequestRef.current?.forceRefresh ?? false),
          announce: announce || (queuedRequestRef.current?.announce ?? false)
        };
        return refreshInFlightRef.current;
      }
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
          // Verify request key still matches latest intent
          if (currentRequestKeyRef.current === requestKey) {
            setSnapshot(nextSnapshot);
            if (announce) {
              setNotice({ tone: "success", text: "状态已更新" });
            }
          }
        } catch (nextError) {
          if (requestEpoch === mutationEpochRef.current && pendingMutationsRef.current === 0 && currentRequestKeyRef.current === requestKey) {
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
        if (refreshInFlightRef.current === refresh) {
          refreshInFlightRef.current = null;
          if (queuedRequestRef.current) {
            const queued = queuedRequestRef.current;
            queuedRequestRef.current = null;
            void fetchSnapshot(queued.forceRefresh, queued.announce);
          }
        }
      }
    },
    [adapter, metricsWindow, selectedDeviceId, trafficAnchor, trafficMode]
  );

  /* Subscribe once per adapter.
   *
   * This effect used to depend on `fetchSnapshot` as well, because the initial
   * load and the subscription shared a body. `fetchSnapshot` changes whenever
   * the selected device, metric window, traffic mode or traffic anchor changes —
   * so every time-range click closed the live socket and opened a new one, and
   * paid for a full snapshot fetch on top. The two concerns are split now: the
   * subscription is tied to the adapter's identity alone, and the load runs off
   * the callback that actually encodes the request.
   */
  useEffect(() => {
    void fetchSnapshot(false);
  }, [fetchSnapshot]);

  useEffect(() => adapter.subscribe((nextSnapshot) => {
    if (pendingMutationsRef.current > 0) return;
    setSnapshot(nextSnapshot);
  }), [adapter]);

  const currentRouteRef = useRef(route);
  useEffect(() => {
    currentRouteRef.current = route;
  }, [route]);

  useEffect(() => {
    const handleLocationChange = () => {
      const targetRoute = parseWorkspaceHash(window.location.hash);
      if (!confirmDiscardDeviceOrderDraft()) {
        const currentHash = serializeWorkspaceRoute(currentRouteRef.current);
        if (window.location.hash !== currentHash) {
          window.history.replaceState({ route: currentRouteRef.current }, "", currentHash);
        }
        return;
      }
      setRoute(targetRoute);
    };
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
    };
  }, [setRoute]);

  useEffect(() => {
    const effectiveRefreshInterval = lowResourceMode
      ? Math.max(30, refreshInterval)
      : Math.max(refreshInterval, runtimeProfile.recommendedRefreshInterval);
    return startVisiblePolling(() => fetchSnapshot(true, false), effectiveRefreshInterval * 1000);

  }, [fetchSnapshot, lowResourceMode, refreshInterval, runtimeProfile.recommendedRefreshInterval]);

  useEffect(() => {
    const currentDevice = snapshot?.devices.find((device) => device.deviceId === selectedDeviceId);
    if (route.kind === "device" && !currentDevice && snapshot?.devices.length) {
      navigate({ kind: "overview" });
    }
  }, [navigate, route, selectedDeviceId, snapshot]);

  /* Single theme resolver.
   *
   * Resolves the active theme into 'light' | 'dark' and writes to
   * data-dsc-theme / data-dsc-resolved-theme for M3E token mapping.
   */
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const nextTheme = theme === "system" ? (mediaQuery.matches ? "dark" : "light") : theme;
      setResolvedTheme(nextTheme);
      root.dataset.dscTheme = theme;
      root.dataset.dscResolvedTheme = nextTheme;
      root.style.colorScheme = nextTheme;
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
    // Seed from the material the native window was actually created with, then
    // refresh it from the capability call. Writing "opaque" first and correcting
    // it asynchronously repainted the whole token set and flashed on Mica.
    const seeded = adapter.initialWindowMaterial ?? "opaque";
    const root = document.documentElement;
    root.dataset.dscMaterial = seeded;
    localStorage.removeItem("dsc-window-material");
    const syncWindowMaterial = async () => {
      try {
        const capabilities = adapter.getWindowMaterialCapabilities
          ? await adapter.getWindowMaterialCapabilities()
          : fallbackWindowMaterialCapabilities();
        if (cancelled) return;
        root.dataset.dscMaterial = capabilities.activeMaterial;
      } catch {
        if (cancelled) return;
        // Keep the seeded value: a failed probe is not evidence of "opaque".
        root.dataset.dscMaterial = seeded;
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
    const timer = window.setTimeout(() => setNotice(null), notice.tone === "error" ? 8000 : 5000);
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
  const devices = allDevices;
  const snapshotSource = snapshot ? selectSnapshotSource(snapshot, allDevices) : "unknown";
  const selectedDevice = allDevices.find((device) => device.deviceId === selectedDeviceId) ?? null;
  const closeWindowSafely = useCallback(async () => {
    if (!confirmDiscardDeviceOrderDraft()) return;
    await closeWindow();
  }, [closeWindow]);

  /* The native client hides to the tray on close, and the shortcut reference
   * promises Ctrl/⌘+W does the same. It runs through the same confirm-discard
   * guard as the titlebar's close button, and is declared after that guard so the
   * dependency is initialised. The browser console has no window to hide, so the
   * binding is capability-gated. */
  useEffect(() => {
    if (!adapter.capabilities.canControlNativeWindow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        void closeWindowSafely();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [adapter.capabilities.canControlNativeWindow, closeWindowSafely]);

  const openExternal = useCallback((url: string) => adapter.openExternal(url), [adapter]);

  /* Memoised on purpose.
   *
   * The object used to be rebuilt on every render along with a fresh
   * `openExternal` arrow, so every consumer of `useWorkspace()` re-rendered on
   * every tick of the poll — navigation, the device table and every chart tile
   * on the device page, including renders where nothing they read had changed.
   */
  const value = useMemo<WorkspaceContextValue>(() => ({
    route,
    navigate,
    openSettings,
    closeSettings,
    sidebarCollapsed,
    setSidebarCollapsed,
    snapshot,
    loading,
    refreshing,
    mutationPending,
    error,
    notice,
    devices,
    allDevices,
    selectedDevice,
    metricsWindow,
    setMetricsWindow,
    trafficMode,
    setTrafficMode,
    trafficAnchor,
    shiftTrafficAnchor,
    searchQuery,
    setSearchQuery,
    commandOpen,
    setCommandOpen,
    theme,
    setTheme,
    resolvedTheme,
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
    saveFanNote,
    deleteInstance,
    reorderInstances,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow: closeWindowSafely,
    adapterDragStart,
    adapterDragMove,
    adapterDragEnd,
    login,
    logout,
    disconnectAgent,
    openExternal,
    capabilities: adapter.capabilities,
    orientation,
    isTouch,
    inputMode,
    layoutTier,
    runtimeProfile,
    lowResourceMode,
    chartPointLimit,
    windowState
  }), [
    route,
    navigate,
    openSettings,
    closeSettings,
    sidebarCollapsed,
    setSidebarCollapsed,
    snapshot,
    loading,
    refreshing,
    mutationPending,
    error,
    notice,
    devices,
    allDevices,
    selectedDevice,
    metricsWindow,
    setMetricsWindow,
    trafficMode,
    setTrafficMode,
    trafficAnchor,
    shiftTrafficAnchor,
    searchQuery,
    setSearchQuery,
    commandOpen,
    setCommandOpen,
    theme,
    setTheme,
    resolvedTheme,
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
    saveFanNote,
    deleteInstance,
    reorderInstances,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindowSafely,
    adapterDragStart,
    adapterDragMove,
    adapterDragEnd,
    login,
    logout,
    disconnectAgent,
    openExternal,
    adapter.capabilities,
    orientation,
    isTouch,
    inputMode,
    layoutTier,
    runtimeProfile,
    lowResourceMode,
    chartPointLimit,
    windowState
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
