import React, { useMemo } from "react";
import appIcon from "../../assets/app-icon.png";
import { useWorkspaceActions, useWorkspaceData, useWorkspaceUi, type WorkspaceUiValue } from "../WorkspaceContext";
import type { SettingsSection } from "../routes";
import { UNGROUPED_GROUP_KEY, normalizeDeviceGroup, selectDeviceGroups } from "../selectors";
import { M3Button, M3IconButton, M3NavigationItem } from "../m3";
import { Icon, StatusDot, type IconName } from "../ui";

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

export function SidebarDeviceGroups() {
  const { route, navigate, healthThresholds } = useWorkspaceUi();
  const { allDevices, selectedDevice } = useWorkspaceData();
  const groups = useMemo(() => selectDeviceGroups(allDevices, healthThresholds), [allDevices, healthThresholds]);
  const hasNamedGroups = useMemo(() => groups.some((group) => !group.isUngrouped), [groups]);

  if (!hasNamedGroups) return null;

  const activeDeviceGroupKey = route.kind === "device" && selectedDevice
    ? (normalizeDeviceGroup(selectedDevice.group) ?? UNGROUPED_GROUP_KEY)
    : null;
  const activeRouteGroup = (route.kind === "devices" || route.kind === "overview") ? (route.group ?? "all") : null;
  const onlineTotal = allDevices.filter((device) => device.status === "online").length;

  return (
    <div className="workspace-sidebar-groups" role="group" aria-label="设备组快捷导航">
      <div className="workspace-sidebar-groups__header">
        <span>设备组</span>
        <small>{groups.filter((g) => !g.isUngrouped).length} 组</small>
      </div>
      <button
        type="button"
        className={`workspace-sidebar-group-btn ${route.kind === "devices" && (!route.group || route.group === "all") ? "is-selected" : ""}`}
        onClick={() => navigate({ kind: "devices" })}
        title={`全部设备 (${onlineTotal}/${allDevices.length} 在线)`}
      >
        <span className="workspace-sidebar-group-btn__name">全部设备</span>
        <span className="workspace-sidebar-group-btn__count">{onlineTotal}/{allDevices.length}</span>
      </button>
      {groups.map((group) => {
        const isSelectedGroup = activeRouteGroup === group.key;
        const isParentOfActiveDevice = activeDeviceGroupKey === group.key;
        const expanded = isSelectedGroup || isParentOfActiveDevice;
        const hasOffline = group.offline > 0;
        const hasWarning = group.overThreshold > 0;
        return (
          <div key={group.key} className={`workspace-sidebar-group-entry ${expanded ? "is-expanded" : ""}`}>
            <button
              type="button"
              className={`workspace-sidebar-group-btn ${isSelectedGroup ? "is-selected" : ""} ${isParentOfActiveDevice ? "is-active-parent" : ""}`}
              aria-current={isSelectedGroup ? "page" : undefined}
              onClick={() => navigate({ kind: "devices", group: group.key })}
              title={`${group.name} (${group.online}/${group.total} 在线)`}
            >
              <span className="workspace-sidebar-group-btn__lead">
                {(hasOffline || hasWarning) ? (
                  <span
                    className={`workspace-group-chip-dot ${hasOffline ? "is-offline" : "is-warning"}`}
                    aria-hidden="true"
                  />
                ) : (
                  <span className="workspace-sidebar-group-btn__dot" aria-hidden="true" />
                )}
                <span className="workspace-sidebar-group-btn__name">{group.name}</span>
              </span>
              <span className="workspace-sidebar-group-btn__count">{group.online}/{group.total}</span>
            </button>
            {expanded && group.devices.length > 0 && (
              <div className="workspace-sidebar-group-devices" role="group" aria-label={`${group.name} 组内设备`}>
                {group.devices.map((device) => {
                  const isCurrentDevice = route.kind === "device" && route.deviceId === device.deviceId;
                  return (
                    <button
                      key={device.deviceId}
                      type="button"
                      className={`workspace-sidebar-group-device ${isCurrentDevice ? "is-selected" : ""}`}
                      aria-current={isCurrentDevice ? "page" : undefined}
                      onClick={() => navigate({ kind: "device", deviceId: device.deviceId, view: route.kind === "device" ? route.view : undefined })}
                      title={`${device.hostname} (${device.status === "online" ? "在线" : "离线"})`}
                    >
                      <StatusDot state={device.status === "online" ? "online" : "offline"} />
                      <span className="workspace-sidebar-group-device__name">{device.hostname}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
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
          <SidebarDeviceGroups />
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
