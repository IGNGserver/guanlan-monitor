import { useCallback, useEffect, useState } from "react";
import type { MetricWindow, TrafficCalendarMode } from "@dsc/shared";
import type { ConsoleAdapter } from "../../services/adapter";
import { detectTouchSupport, type InteractionScaleSetting, type PointerType } from "../../helpers/density";
import { getResponsiveTier, getScreenOrientation, usesSidebarDrawer, type ResponsiveTier, type ScreenOrientation } from "../../helpers/layout";
import { confirmDiscardDeviceOrderDraft } from "../deviceOrderDraft";
import { defaultRoute, routeFromLocation, serializeWorkspaceRoute, type SettingsSection, type WorkspaceRoute } from "../routes";
import { getStoredDensity, getStoredRefreshInterval, getStoredTheme } from "./WorkspaceTypes";

export function useWorkspaceUiState({ adapter, initialRoute }: { adapter: ConsoleAdapter; initialRoute?: WorkspaceRoute }) {
  const [route, setRoute] = useState<WorkspaceRoute>(() => initialRoute ?? routeFromLocation());
  const [returnRoute, setReturnRoute] = useState<WorkspaceRoute>(defaultRoute);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("dsc-sidebar-collapsed");
    // A stored choice is the user's own and must survive a narrow window; only a
    // first visit picks a viewport-sized default.
    if (stored === "true") return true;
    if (stored === "false") return false;
    return usesSidebarDrawer(window.innerWidth);
  });
  const [metricsWindow, setMetricsWindow] = useState<MetricWindow>("5m");
  const [trafficMode, setTrafficModeState] = useState<TrafficCalendarMode>("day");
  const [trafficAnchor, setTrafficAnchor] = useState(() => new Date().toISOString());
  const [searchQuery, setSearchQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [theme, setThemeState] = useState<"system" | "light" | "dark">(getStoredTheme);
  const [density, setDensityState] = useState<InteractionScaleSetting>(getStoredDensity);
  const [refreshInterval, setRefreshIntervalState] = useState<5 | 10 | 30>(getStoredRefreshInterval);
  const [orientation, setOrientation] = useState<ScreenOrientation>("landscape");
  const [isTouch, setIsTouch] = useState(false);
  const [inputMode, setInputMode] = useState<PointerType>("mouse");
  const [layoutTier, setLayoutTier] = useState<ResponsiveTier>("lg");
  const [pointerSeen, setPointerSeen] = useState(false);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      localStorage.removeItem("dsc-instance-type");
      // The v3 compact viewport used to force-collapse the sidebar once and leave
      // this marker behind. The preference is the user's again.
      localStorage.removeItem("dsc-sidebar-compact-migrated-v3");
    } catch {
      // Removing an obsolete optional preference must not block the workspace.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const nextOrientation = getScreenOrientation(width, height);
      const nextTier = getResponsiveTier(width);
      const nextTouch = detectTouchSupport();
      setOrientation(nextOrientation);
      setLayoutTier(nextTier);
      setIsTouch(nextTouch);
      if (!pointerSeen) setInputMode(nextTouch ? "touch" : "mouse");
      document.documentElement.dataset.dscOrientation = nextOrientation;
      document.documentElement.dataset.dscTier = nextTier;
      document.documentElement.dataset.dscTouchSupport = nextTouch ? "true" : "false";
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    const handlePointerDown = (event: PointerEvent) => {
      const nextPointer: PointerType = event.pointerType === "touch" || event.pointerType === "pen" ? event.pointerType : "mouse";
      setPointerSeen(true);
      setInputMode(nextPointer);
      document.documentElement.dataset.dscPointer = nextPointer;
    };
    document.addEventListener("pointerdown", handlePointerDown, { passive: true });
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pointerSeen]);

  const navigate = useCallback((nextRoute: WorkspaceRoute) => {
    if (!confirmDiscardDeviceOrderDraft()) return;
    setRoute(nextRoute);
    if (typeof window !== "undefined" && window.location.hash !== serializeWorkspaceRoute(nextRoute)) {
      window.history.pushState({ route: nextRoute }, "", serializeWorkspaceRoute(nextRoute));
    }
  }, []);

  const openSettings = useCallback((section: SettingsSection = adapter.capabilities.canControlNativeWindow ? "general" : "workspace") => {
    setReturnRoute((current) => (route.kind === "settings" ? current : route));
    navigate({ kind: "settings", section });
  }, [adapter, navigate, route]);

  const closeSettings = useCallback(() => navigate(returnRoute), [navigate, returnRoute]);
  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    localStorage.setItem("dsc-sidebar-collapsed", String(collapsed));
  }, []);
  const setTheme = useCallback((nextTheme: "system" | "light" | "dark") => {
    setThemeState(nextTheme);
    localStorage.setItem("dsc-theme", nextTheme);
  }, []);
  const setDensity = useCallback((nextDensity: InteractionScaleSetting) => {
    setDensityState(nextDensity);
    localStorage.setItem("dsc-density", nextDensity);
  }, []);
  const setRefreshInterval = useCallback((nextInterval: 5 | 10 | 30) => {
    setRefreshIntervalState(nextInterval);
    localStorage.setItem("dsc-refresh-interval", String(nextInterval));
  }, []);
  const setTrafficMode = useCallback((nextMode: TrafficCalendarMode) => {
    setTrafficModeState(nextMode);
    setTrafficAnchor(new Date().toISOString());
  }, []);
  const shiftTrafficAnchor = useCallback((direction: -1 | 1) => {
    setTrafficAnchor((current) => {
      const date = new Date(current);
      if (Number.isNaN(date.getTime())) return new Date().toISOString();
      if (trafficMode === "month") date.setUTCMonth(date.getUTCMonth() + direction);
      else if (trafficMode === "week") date.setUTCDate(date.getUTCDate() + direction * 7);
      else date.setUTCDate(date.getUTCDate() + direction);
      return date.toISOString();
    });
  }, [trafficMode]);

  return {
    route,
    setRoute,
    returnRoute,
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
  };
}
