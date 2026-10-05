import React from "react";
import { useWorkspaceUi } from "../WorkspaceContext";
import { M3NavigationItem } from "../m3";
import { Icon } from "../ui";

/**
 * Compact destinations mirror the rail one-for-one. The former 连接 tab pointed
 * at the hub page that the overview now owns, and a fourth tab would only have
 * duplicated the settings entry one row below it.
 */
export function CompactNavigation() {
  const { route, navigate, openSettings } = useWorkspaceUi();
  const handleNav = (target: "overview" | "devices" | "settings") => {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try { navigator.vibrate(10); } catch {}
    }
    if (target === "overview") navigate({ kind: "overview" });
    else if (target === "devices") navigate({ kind: "devices" });
    else if (target === "settings") openSettings();
  };

  return <nav className="workspace-bottom-nav" aria-label="主导航">
    <M3NavigationItem className="workspace-bottom-nav__item" icon={<span className="workspace-bottom-nav__icon-indicator"><Icon name="overview" size={24} /></span>} selected={route.kind === "overview"} onClick={() => handleNav("overview")}>总览</M3NavigationItem>
    <M3NavigationItem className="workspace-bottom-nav__item" icon={<span className="workspace-bottom-nav__icon-indicator"><Icon name="device" size={24} /></span>} selected={route.kind === "devices" || route.kind === "device"} onClick={() => handleNav("devices")}>设备</M3NavigationItem>
    <M3NavigationItem className="workspace-bottom-nav__item" icon={<span className="workspace-bottom-nav__icon-indicator"><Icon name="settings" size={24} /></span>} selected={route.kind === "settings"} onClick={() => handleNav("settings")}>设置</M3NavigationItem>
  </nav>;
}
