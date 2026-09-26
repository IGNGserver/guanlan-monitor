import React, { useEffect, useRef, useState } from "react";
import { Theme } from "@carbon/react";
import { SIDEBAR_DRAWER_MAX_WIDTH } from "../../helpers/layout";
import { useWorkspace } from "../WorkspaceContext";
import { AppTopBar, SessionRecoveryBanner, ShellNotice } from "./AppTopBar";
import { CommandPalette } from "./CommandPalette";
import { CompactNavigation } from "./CompactNavigation";
import { NativeTitleBar } from "./NativeTitleBar";
import { PrimaryNavigation } from "./PrimaryNavigation";

/** Same calendar vocabulary the metric-window controls show to sighted users. */
const metricsWindowAnnouncements: Record<string, string> = {
  "1m": "1 分钟",
  "5m": "5 分钟",
  "15m": "15 分钟",
  "1h": "1 小时",
  "6h": "6 小时",
  "24h": "24 小时",
  "1d": "1 天",
  "7d": "7 天",
  "1w": "1 周",
  "30d": "30 天",
  "1mo": "1 个月",
  "90d": "90 天",
  "1y": "1 年"
};

export function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, setSidebarCollapsed, capabilities, refreshing, route, selectedDevice, metricsWindow, resolvedTheme } = useWorkspace();
  /* The Carbon theme now comes from the provider's single
     `prefers-color-scheme` resolver. This component used to run a second,
     independent listener to derive `g10`/`g100`, so the two theme systems could
     disagree: the Material token layer follows `data-dsc-resolved-theme` and
     Carbon follows this one, which is what made dark mode look half applied. */
  const carbonTheme = resolvedTheme === "dark" ? "g100" : "g10";
  const [sidebarPeek, setSidebarPeek] = useState(false);
  // The backdrop only exists as a scrim while the sidebar is an off-canvas drawer,
  // i.e. exactly at `max-width: ${SIDEBAR_DRAWER_MAX_WIDTH}px` where workspace.pages.css
  // moves it off canvas. The JS state machine (usesSidebarDrawer) uses the same bound,
  // so `sidebarDrawerOpen` mirrors "the drawer really covers the content" and never
  // inertes the main region on wide desktops where an open rail is the normal state.
  const [isCompactViewport, setIsCompactViewport] = useState(() => typeof window !== "undefined" && window.matchMedia(`(max-width: ${SIDEBAR_DRAWER_MAX_WIDTH}px)`).matches);
  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${SIDEBAR_DRAWER_MAX_WIDTH}px)`);
    const sync = () => setIsCompactViewport(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);
  const sidebarDrawerOpen = isCompactViewport && !sidebarCollapsed;
  useEffect(() => {
    if (!sidebarDrawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSidebarCollapsed(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarDrawerOpen, setSidebarCollapsed]);
  const drawerWasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = drawerWasOpenRef.current;
    drawerWasOpenRef.current = sidebarDrawerOpen;
    if (wasOpen === sidebarDrawerOpen) return;
    const activeElement = document.activeElement;
    if (sidebarDrawerOpen) {
      // The content becomes inert, so hand focus to the drawer the user just opened
      // instead of letting the browser dump it on <body>.
      const focusOwnedByContent = activeElement === document.body || (activeElement instanceof HTMLElement && Boolean(activeElement.closest(".workspace-main")));
      if (focusOwnedByContent) document.querySelector<HTMLElement>(".workspace-sidebar button:not([disabled])")?.focus();
      return;
    }
    if (!isCompactViewport || !sidebarCollapsed) return;
    // The drawer slid off canvas; never leave focus stranded inside it.
    if (activeElement instanceof HTMLElement && activeElement.closest(".workspace-sidebar")) document.querySelector<HTMLElement>(".workspace-topbar__toggle")?.focus();
  }, [sidebarDrawerOpen, isCompactViewport, sidebarCollapsed]);
  // Data on the device and overview pages is replaced wholesale when the device or
  // the time window changes, and nothing said so. The refresh bar (role=status) owns
  // "a fetch is running"; this region owns "what you are looking at now".
  const [dataViewAnnouncement, setDataViewAnnouncement] = useState("");
  const dataViewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const viewKey = route.kind === "device" ? `device:${route.deviceId}:${selectedDevice?.hostname ?? ""}:${metricsWindow}` : `${route.kind}:${metricsWindow}`;
    const previousKey = dataViewKeyRef.current;
    dataViewKeyRef.current = viewKey;
    if (previousKey === null || previousKey === viewKey) return;
    const windowLabel = metricsWindowAnnouncements[metricsWindow] ?? metricsWindow;
    if (route.kind === "device") {
      if (!selectedDevice) return;
      setDataViewAnnouncement(`正在查看设备 ${selectedDevice.hostname}，时间范围 ${windowLabel}`);
    } else if (route.kind === "overview") {
      setDataViewAnnouncement(`正在查看总览，时间范围 ${windowLabel}`);
    }
  }, [route, selectedDevice, metricsWindow]);
  const edgeSwipeRef = useRef<{ pointerId: number; startX: number } | null>(null);
  useEffect(() => { if (!sidebarCollapsed) setSidebarPeek(false); }, [sidebarCollapsed]);
  const handleEdgePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    edgeSwipeRef.current = { pointerId: event.pointerId, startX: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleEdgePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = edgeSwipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.clientX - gesture.startX > 24) { event.preventDefault(); edgeSwipeRef.current = null; setSidebarCollapsed(false); }
  };
  const handleEdgePointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (edgeSwipeRef.current?.pointerId === event.pointerId) edgeSwipeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleEdgePointerEnter = (event: React.PointerEvent<HTMLButtonElement>) => { if (event.pointerType === "mouse" && window.innerWidth > 839) setSidebarPeek(true); };
  return <Theme theme={carbonTheme} className="guanlan-carbon-theme"><div className={`workspace-root ${!capabilities.canControlNativeWindow ? "is-web" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : "is-sidebar-open"} ${sidebarPeek ? "is-sidebar-peek" : ""}`}>
    <NativeTitleBar />
    <PrimaryNavigation sidebarPeek={sidebarPeek} onSidebarLeave={() => setSidebarPeek(false)} />
    {!sidebarCollapsed && <div className="workspace-sidebar-backdrop" onPointerDown={() => setSidebarCollapsed(true)} aria-hidden="true" />}
    <div className="workspace-main" inert={sidebarDrawerOpen || undefined}>
      <AppTopBar />
      <SessionRecoveryBanner />
      <main className="workspace-content" id="workspace-main-content">{children}</main>
    </div>
    {sidebarCollapsed && <button className="workspace-sidebar-edge-trigger" type="button" aria-label="展开侧边栏" onClick={() => setSidebarCollapsed(false)} onPointerEnter={handleEdgePointerEnter} onFocus={() => { if (window.innerWidth > 839) setSidebarPeek(true); }} onPointerDown={handleEdgePointerDown} onPointerMove={handleEdgePointerMove} onPointerUp={handleEdgePointerEnd} onPointerCancel={handleEdgePointerEnd} onLostPointerCapture={handleEdgePointerEnd} />}
    <CompactNavigation />
    <CommandPalette />
    <ShellNotice />
    {/* A page-wide "data is on its way" signal. The only one before this was the
        word inside the refresh button, which nobody looks at while waiting. */}
    {refreshing && <div className="workspace-refresh-bar" role="status" aria-label="正在刷新设备状态" />}
    <div className="workspace-visually-hidden" aria-live="polite" aria-atomic="true">{dataViewAnnouncement}</div>
  </div></Theme>;
}
