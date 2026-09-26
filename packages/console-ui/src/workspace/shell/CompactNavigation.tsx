import React from "react";
import { useWorkspace } from "../WorkspaceContext";
import { M3NavigationItem } from "../m3";
import { Icon } from "../ui";

/**
 * Compact destinations mirror the rail one-for-one. The former 连接 tab pointed
 * at the hub page that the overview now owns, and a fourth tab would only have
 * duplicated the settings entry one row below it.
 */
export function CompactNavigation() {
  const { route, navigate, openSettings } = useWorkspace();
  return <nav className="workspace-bottom-nav" aria-label="主导航">
    <M3NavigationItem className="workspace-bottom-nav__item" selected={route.kind === "overview"} onClick={() => navigate({ kind: "overview" })}><Icon name="overview" size={18} /><span>总览</span></M3NavigationItem>
    <M3NavigationItem className="workspace-bottom-nav__item" selected={route.kind === "devices" || route.kind === "device"} onClick={() => navigate({ kind: "devices" })}><Icon name="device" size={18} /><span>设备</span></M3NavigationItem>
    <M3NavigationItem className="workspace-bottom-nav__item" selected={route.kind === "settings"} onClick={() => openSettings()}><Icon name="settings" size={18} /><span>设置</span></M3NavigationItem>
  </nav>;
}
