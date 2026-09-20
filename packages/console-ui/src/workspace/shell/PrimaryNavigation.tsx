import React from "react";
import appIcon from "../../assets/app-icon.png";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { M3Button, M3IconButton, M3NavigationItem } from "../m3";
import { Icon, type IconName } from "../ui";

const appIconSrc = typeof appIcon === "string" ? appIcon : (appIcon as { src: string }).src;

const desktopSettingsNav: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: "general", label: "通用", icon: "settings" },
  { id: "appearance", label: "外观", icon: "appearance" },
  { id: "connections", label: "连接与上报", icon: "connection" },
  { id: "agent", label: "本机 Agent", icon: "agent" },
  { id: "data", label: "数据与更新", icon: "data" },
  { id: "shortcuts", label: "快捷键", icon: "keyboard" },
  { id: "about", label: "关于观澜", icon: "about" }
];

const webSettingsNav: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: "workspace", label: "中枢状态", icon: "overview" },
  { id: "appearance", label: "外观", icon: "appearance" },
  { id: "session", label: "会话安全", icon: "connection" },
  { id: "data", label: "数据与更新", icon: "data" },
  { id: "shortcuts", label: "快捷键", icon: "keyboard" },
  { id: "about", label: "关于观澜", icon: "about" }
];

export function settingsNavigation(capabilities: ReturnType<typeof useWorkspace>["capabilities"]) {
  return capabilities.canControlNativeWindow ? desktopSettingsNav : webSettingsNav;
}

export function SettingsNavigation() {
  const { route, navigate, capabilities } = useWorkspace();
  const visibleSettings = settingsNavigation(capabilities).filter((item) => {
    if (item.id === "agent") return capabilities.canManageLocalAgent;
    if (item.id === "connections") return capabilities.canConfigureConnection;
    return true;
  });
  return (
    <nav className="workspace-sidebar__nav" aria-label="设置导航">
      <div className="workspace-sidebar__section-title">设置</div>
      {visibleSettings.map((item) => (
        <M3NavigationItem className="workspace-nav-item" selected={route.kind === "settings" && route.section === item.id} key={item.id} onClick={() => navigate({ kind: "settings", section: item.id })} title={item.label}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </M3NavigationItem>
      ))}
    </nav>
  );
}

export function PrimaryNavigation({ sidebarPeek, onSidebarLeave }: { sidebarPeek: boolean; onSidebarLeave: () => void }) {
  const { capabilities, route, sidebarCollapsed, setSidebarCollapsed, navigate, openSettings, closeSettings, openExternal } = useWorkspace();
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
          <M3NavigationItem className="workspace-nav-item" selected={route.kind === "overview"} onClick={() => navigate({ kind: "overview" })} title="总览"><Icon name="overview" /><span>总览</span></M3NavigationItem>
          <M3NavigationItem className="workspace-nav-item" selected={route.kind === "devices"} onClick={() => navigate({ kind: "devices" })} title="设备"><Icon name="device" /><span>设备</span></M3NavigationItem>
          <M3NavigationItem className="workspace-nav-item" selected={route.kind === "hub"} onClick={() => navigate({ kind: "hub", hubId: "primary" })} title="中枢状态"><Icon name="hub" /><span>中枢状态</span></M3NavigationItem>
          <div className="workspace-sidebar__spacer" />
          {capabilities.canManageLocalAgent && <M3NavigationItem className="workspace-nav-item" onClick={() => navigate({ kind: "settings", section: "agent" })} title="本机 Agent"><Icon name="agent" /><span>本机 Agent</span></M3NavigationItem>}
        </nav>
      )}
      <div className="workspace-sidebar__footer">
        {inSettings ? <M3NavigationItem className="workspace-nav-item" onClick={closeSettings} title="返回设备控制台"><Icon name="back" /><span>返回控制台</span></M3NavigationItem> : <M3NavigationItem className="workspace-nav-item" onClick={() => openSettings()} title="设置"><Icon name="settings" /><span>设置</span></M3NavigationItem>}
        <M3Button className="workspace-sidebar__support" variant="text" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor/issues")} title="打开帮助与反馈"><span>帮助与反馈</span><Icon name="external" size={14} /></M3Button>
      </div>
    </aside>
  );
}
