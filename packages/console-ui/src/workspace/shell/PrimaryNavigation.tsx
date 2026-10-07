import React from "react";
import appIcon from "../../assets/app-icon.png";
import { useWorkspaceActions, useWorkspaceUi, type WorkspaceUiValue } from "../WorkspaceContext";
import type { SettingsSection } from "../routes";
import { M3Button, M3IconButton, M3NavigationItem } from "../m3";
import { Icon, type IconName } from "../ui";

const appIconSrc = typeof appIcon === "string" ? appIcon : (appIcon as { src: string }).src;

/**
 * Both clients share one settings vocabulary. Desktop-only Agent controls live
 * inside the combined connection page, so there is no second Agent section.
 */
const desktopSettingsNav: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: "general", label: "通用", icon: "settings" },
  { id: "appearance", label: "外观", icon: "appearance" },
  { id: "connections", label: "连接与本机", icon: "connection" },
  { id: "data", label: "数据与更新", icon: "data" },
  { id: "shortcuts", label: "快捷键参考", icon: "keyboard" },
  { id: "about", label: "关于观澜", icon: "about" }
];

const webSettingsNav: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: "general", label: "通用", icon: "settings" },
  { id: "appearance", label: "外观", icon: "appearance" },
  { id: "connections", label: "连接", icon: "connection" },
  { id: "data", label: "数据与更新", icon: "data" },
  { id: "shortcuts", label: "快捷键参考", icon: "keyboard" },
  { id: "about", label: "关于观澜", icon: "about" }
];

export function settingsNavigation(capabilities: WorkspaceUiValue["capabilities"]) {
  return capabilities.canControlNativeWindow ? desktopSettingsNav : webSettingsNav;
}

/** One place decides which sections a client exposes. */
export function visibleSettingsNavigation(capabilities: WorkspaceUiValue["capabilities"]) {
  return settingsNavigation(capabilities);
}

export function SettingsNavigation() {
  const { route, navigate, capabilities } = useWorkspaceUi();
  const visibleSettings = visibleSettingsNavigation(capabilities);
  return (
    <nav className="workspace-sidebar__nav" aria-label="设置导航">
      <div className="workspace-sidebar__section-title">设置</div>
      {visibleSettings.map((item) => (
        <M3NavigationItem className="workspace-nav-item" icon={<Icon name={item.icon} />} selected={route.kind === "settings" && route.section === item.id} key={item.id} onClick={() => navigate({ kind: "settings", section: item.id })} title={item.label} aria-label={item.label}>
          {item.label}
        </M3NavigationItem>
      ))}
    </nav>
  );
}

export function PrimaryNavigation({ sidebarPeek, onSidebarLeave }: { sidebarPeek: boolean; onSidebarLeave: () => void }) {
  // Preferences and actions only: the rail no longer re-renders on every poll.
  const { capabilities, route, sidebarCollapsed, setSidebarCollapsed, navigate, openSettings, closeSettings } = useWorkspaceUi();
  const { openExternal } = useWorkspaceActions();
  const inSettings = route.kind === "settings";
  return (
    <aside className={`workspace-sidebar ${sidebarCollapsed ? "is-collapsed" : ""} ${inSettings ? "is-settings" : ""}`} onMouseLeave={() => { if (sidebarCollapsed && sidebarPeek) onSidebarLeave(); }}>
      <div className="workspace-sidebar__topline">
        <button className="workspace-brand" type="button" onClick={() => (inSettings ? closeSettings() : navigate({ kind: "overview" }))} aria-label="返回总览">
          <img className="workspace-brand__mark-img" src={appIconSrc} alt="观澜" />
          {!capabilities.canControlNativeWindow && <span className="workspace-brand__name">观澜</span>}
        </button>
        <M3IconButton className="workspace-icon-button workspace-sidebar__collapse" label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
          <Icon name="collapse" />
        </M3IconButton>
      </div>
      {inSettings ? <SettingsNavigation /> : (
        <nav className="workspace-sidebar__nav" aria-label="设备控制台导航">
          <M3NavigationItem className="workspace-nav-item" icon={<Icon name="overview" />} selected={route.kind === "overview"} onClick={() => navigate({ kind: "overview" })} title="总览" aria-label="总览">总览</M3NavigationItem>
          <M3NavigationItem className="workspace-nav-item" icon={<Icon name="device" />} selected={route.kind === "devices" || route.kind === "device"} onClick={() => navigate({ kind: "devices" })} title="设备" aria-label="设备">设备</M3NavigationItem>
          <div className="workspace-sidebar__spacer" />
          {capabilities.canManageLocalAgent && <M3NavigationItem className="workspace-nav-item" icon={<Icon name="connection" />} onClick={() => navigate({ kind: "settings", section: "connections" })} title="连接与本机" aria-label="连接与本机">连接与本机</M3NavigationItem>}
        </nav>
      )}
      <div className="workspace-sidebar__footer">
        {inSettings ? <M3NavigationItem className="workspace-nav-item" icon={<Icon name="back" />} onClick={closeSettings} title="返回设备控制台" aria-label="返回设备控制台">返回控制台</M3NavigationItem> : <M3NavigationItem className="workspace-nav-item" icon={<Icon name="settings" />} onClick={() => openSettings()} title="设置" aria-label="设置">设置</M3NavigationItem>}
        <M3Button className="workspace-sidebar__support" variant="text" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor/issues")} title="打开帮助与反馈" aria-label="打开帮助与反馈"><span>帮助与反馈</span><Icon name="external" size={18} /></M3Button>
      </div>
    </aside>
  );
}
