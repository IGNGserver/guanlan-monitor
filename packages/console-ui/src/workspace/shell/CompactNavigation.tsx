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
  const handleNav = (target: "overview" | "devices" | "settings") => {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try { navigator.vibrate(10); } catch {}
    }
    if (target === "overview") navigate({ kind: "overview" });
    else if (target === "devices") navigate({ kind: "devices" });
    else if (target === "settings") openSettings();
  };

  return <nav className="workspace-bottom-nav" aria-label="主导航">
    <M3NavigationItem className={`workspace-bottom-nav__item ${route.kind === "overview" ? "is-active" : ""}`} selected={route.kind === "overview"} onClick={() => handleNav("overview")}>
      <span className="workspace-bottom-nav__icon-indicator"><Icon name="overview" size={20} /></span>
      <span>总览</span>
    </M3NavigationItem>
    <M3NavigationItem className={`workspace-bottom-nav__item ${route.kind === "devices" || route.kind === "device" ? "is-active" : ""}`} selected={route.kind === "devices" || route.kind === "device"} onClick={() => handleNav("devices")}>
      <span className="workspace-bottom-nav__icon-indicator"><Icon name="device" size={20} /></span>
      <span>设备</span>
    </M3NavigationItem>
    <M3NavigationItem className={`workspace-bottom-nav__item ${route.kind === "settings" ? "is-active" : ""}`} selected={route.kind === "settings"} onClick={() => handleNav("settings")}>
      <span className="workspace-bottom-nav__icon-indicator"><Icon name="settings" size={20} /></span>
      <span>设置</span>
    </M3NavigationItem>
  </nav>;
}
