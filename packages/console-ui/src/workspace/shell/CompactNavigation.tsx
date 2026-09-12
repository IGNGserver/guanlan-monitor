import React from "react";
import { useWorkspace } from "../WorkspaceContext";
import { M3NavigationItem } from "../m3";
import { Icon } from "../ui";

export function CompactNavigation() {
  const { route, navigate, openSettings } = useWorkspace();
  return <nav className="workspace-bottom-nav" aria-label="主导航">
    <M3NavigationItem className="workspace-bottom-nav__item" selected={route.kind === "overview"} onClick={() => navigate({ kind: "overview" })}><Icon name="overview" size={18} /><span>总览</span></M3NavigationItem>
    <M3NavigationItem className="workspace-bottom-nav__item" selected={route.kind === "devices" || route.kind === "device"} onClick={() => navigate({ kind: "devices" })}><Icon name="device" size={18} /><span>设备</span></M3NavigationItem>
    <M3NavigationItem className="workspace-bottom-nav__item" selected={route.kind === "hub"} onClick={() => navigate({ kind: "hub", hubId: "primary" })}><Icon name="hub" size={18} /><span>中枢</span></M3NavigationItem>
    <M3NavigationItem className="workspace-bottom-nav__item" selected={route.kind === "settings"} onClick={() => openSettings()}><Icon name="settings" size={18} /><span>设置</span></M3NavigationItem>
  </nav>;
}
