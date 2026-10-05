import React, { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../WorkspaceContext";
import { AppTopBar, RefreshProgress, SessionRecoveryBanner, ShellNotice } from "./AppTopBar";
import { CommandPalette } from "./CommandPalette";
import { NativeTitleBar } from "./NativeTitleBar";
import { PrimaryNavigation } from "./PrimaryNavigation";
import { RenderBoundary } from "../RenderBoundary";
import { serializeWorkspaceRoute } from "../routes";

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
  const { sidebarCollapsed, capabilities, route, selectedDevice, metricsWindow } = useWorkspace();
  /* The active theme is resolved by the workspace provider (`resolvedTheme`)
     and drives M3E tokens via `data-dsc-resolved-theme`.

     This frame only renders at widths above the compact breakpoint: below it
     every client uses the touch shell. The frame's own phone mode — an
     off-canvas drawer with a scrim, a bottom bar, an edge-swipe trigger and
     pull-to-refresh — duplicated that shell and is gone. */
  const [sidebarPeek, setSidebarPeek] = useState(false);
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
  useEffect(() => { if (!sidebarCollapsed) setSidebarPeek(false); }, [sidebarCollapsed]);
  return <div className={`m3e-theme workspace-root ${!capabilities.canControlNativeWindow ? "is-web" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : "is-sidebar-open"} ${sidebarPeek ? "is-sidebar-peek" : ""}`}>
    <NativeTitleBar />
    <PrimaryNavigation sidebarPeek={sidebarPeek} onSidebarLeave={() => setSidebarPeek(false)} />
    <div className="workspace-main">
      <AppTopBar />
      <SessionRecoveryBanner />
      <main className="workspace-content" id="workspace-main-content">
        <RenderBoundary scope="page" resetKey={serializeWorkspaceRoute(route)}>{children}</RenderBoundary>
      </main>
    </div>
    <CommandPalette />
    <ShellNotice />
    <RefreshProgress className="workspace-refresh-bar" />
    <div className="workspace-visually-hidden" aria-live="polite" aria-atomic="true">{dataViewAnnouncement}</div>
  </div>;
}
