import React, { useEffect, useRef, useState } from "react";
import { Theme } from "@carbon/react";
import { useWorkspace } from "../WorkspaceContext";
import { AppTopBar, SessionRecoveryBanner, ShellNotice } from "./AppTopBar";
import { CommandPalette } from "./CommandPalette";
import { CompactNavigation } from "./CompactNavigation";
import { NativeTitleBar } from "./NativeTitleBar";
import { PrimaryNavigation } from "./PrimaryNavigation";

export function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, setSidebarCollapsed, capabilities, theme, refreshing } = useWorkspace();
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);
  const carbonTheme = (theme === "dark" || (theme === "system" && systemDark)) ? "g100" : "g10";
  const [sidebarPeek, setSidebarPeek] = useState(false);
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
    <div className="workspace-main">
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
  </div></Theme>;
}
