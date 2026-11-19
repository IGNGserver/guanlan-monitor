import React, { useEffect, useMemo, useState } from "react";
import type { DeviceSummary } from "@dsc/shared";
import appIcon from "../../assets/app-icon.png";
import { useWorkspaceActions, useWorkspaceData, useWorkspaceUi, type WorkspaceUiValue } from "../WorkspaceContext";
import { evaluateDevice, type HealthThresholds } from "../health";
import type { SettingsSection } from "../routes";
import { UNGROUPED_GROUP_KEY, normalizeDeviceGroup, selectDeviceGroups, type DeviceGroupSummary } from "../selectors";
import { isDeviceGroupDragEvent, readDroppedDeviceIds } from "../deviceGroupDnd";
import { M3Button, M3IconButton, M3NavigationItem, useRipple } from "../m3";
import { Icon, StatusDot, type IconName, type StatusDotState } from "../ui";

const appIconSrc = typeof appIcon === "string" ? appIcon : (appIcon as { src: string }).src;

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
        <M3NavigationItem
          className="workspace-nav-item"
          icon={<Icon name={item.icon} />}
          selected={route.kind === "settings" && route.section === item.id}
          key={item.id}
          onClick={() => navigate({ kind: "settings", section: item.id })}
          title={item.label}
          aria-label={item.label}
        >
          {item.label}
        </M3NavigationItem>
      ))}
    </nav>
  );
}

function resolveDeviceDotState(device: DeviceSummary, thresholds: HealthThresholds): StatusDotState {
  if (device.status !== "online") return "offline";
  const issues = evaluateDevice(device, thresholds).filter((issue) => issue.kind !== "offline");
  if (issues.some((issue) => issue.severity === "critical")) return "critical";
  if (issues.length > 0) return "warning";
  return "online";
}

function describeGroupState(group: DeviceGroupSummary): string {
  const parts = [`${group.online}/${group.total} 在线`];
  if (group.offline > 0) parts.push(`${group.offline} 台离线`);
  if (group.criticalCount > 0) parts.push(`${group.criticalCount} 台严重超限`);
  if (group.warningCount > 0) parts.push(`${group.warningCount} 台警告超限`);
  return `${group.name}（${parts.join(" · ")}）`;
}

function SidebarAllDevicesButton({
  selected,
  onlineTotal,
  total,
  state,
  onClick
}: {
  selected: boolean;
  onlineTotal: number;
  total: number;
  state: StatusDotState;
  onClick: () => void;
}) {
  const { onPointerDown, rippleNodes } = useRipple<HTMLButtonElement>();
  return (
    <button
      type="button"
      className={`workspace-sidebar-group-btn m3e-state-host ${selected ? "is-selected" : ""}`}
      aria-current={selected ? "page" : undefined}
      onPointerDown={onPointerDown}
      onClick={onClick}
      title={`全部设备 (${onlineTotal}/${total} 在线)`}
    >
      <span className="workspace-sidebar-group-btn__lead">
        <StatusDot state={state} />
        <span className="workspace-sidebar-group-btn__name">全部设备</span>
      </span>
      <span className="workspace-sidebar-group-btn__trail">
        <span className="workspace-sidebar-group-btn__count">{onlineTotal}/{total}</span>
      </span>
      {rippleNodes}
    </button>
  );
}

function SidebarGroupDeviceItem({
  device,
  index,
  expanded,
  isCurrentDevice,
  state,
  onSelect
}: {
  device: DeviceSummary;
  index: number;
  expanded: boolean;
  isCurrentDevice: boolean;
  state: StatusDotState;
  onSelect: () => void;
}) {
  const { onPointerDown, rippleNodes } = useRipple<HTMLButtonElement>();
  const statusText = device.status !== "online"
    ? "离线"
    : state === "critical"
      ? "在线 · 严重超限"
      : state === "warning"
        ? "在线 · 警告超限"
        : "在线";
  return (
    <button
      type="button"
      tabIndex={expanded ? 0 : -1}
      style={{ ["--sidebar-device-index" as string]: String(index) }}
      className={`workspace-sidebar-group-device m3e-state-host ${isCurrentDevice ? "is-selected" : ""}`}
      aria-current={isCurrentDevice ? "page" : undefined}
      onPointerDown={onPointerDown}
      onClick={onSelect}
      title={`${device.hostname} (${statusText})`}
    >
      <StatusDot state={state} />
      <span className="workspace-sidebar-group-device__name">{device.hostname}</span>
      {rippleNodes}
    </button>
  );
}

function SidebarGroupEntry({
  group,
  expanded,
  isSelectedGroup,
  isParentOfActiveDevice,
  activeDeviceId,
  healthThresholds,
  onSelectGroup,
  onToggleExpand,
  onSelectDevice,
  onDropDevices
}: {
  group: DeviceGroupSummary;
  expanded: boolean;
  isSelectedGroup: boolean;
  isParentOfActiveDevice: boolean;
  activeDeviceId: string | null;
  healthThresholds: HealthThresholds;
  onSelectGroup: () => void;
  onToggleExpand: () => void;
  onSelectDevice: (deviceId: string) => void;
  onDropDevices?: (deviceIds: string[]) => void;
}) {
  const { onPointerDown, rippleNodes } = useRipple<HTMLButtonElement>();
  const { onPointerDown: onTogglePointerDown, rippleNodes: toggleRipples } = useRipple<HTMLButtonElement>();
  const [dropActive, setDropActive] = useState(false);

  return (
    <div
      className={`workspace-sidebar-group-entry ${expanded ? "is-expanded" : ""}${dropActive ? " is-drop-target" : ""}`}
      onDragOver={
        onDropDevices
          ? (event) => {
              if (!isDeviceGroupDragEvent(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (!dropActive) setDropActive(true);
            }
          : undefined
      }
      onDragLeave={
        onDropDevices
          ? (event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              if (dropActive) setDropActive(false);
            }
          : undefined
      }
      onDrop={
        onDropDevices
          ? (event) => {
              if (!isDeviceGroupDragEvent(event)) return;
              event.preventDefault();
              setDropActive(false);
              const ids = readDroppedDeviceIds(event);
              if (ids.length > 0) onDropDevices(ids);
            }
          : undefined
      }
    >
      <div className="workspace-sidebar-group-row">
        <button
          type="button"
          className={`workspace-sidebar-group-btn m3e-state-host ${isSelectedGroup ? "is-selected" : ""} ${isParentOfActiveDevice ? "is-active-parent" : ""}`}
          aria-current={isSelectedGroup ? "page" : undefined}
          onPointerDown={onPointerDown}
          onClick={onSelectGroup}
          title={describeGroupState(group)}
        >
          <span className="workspace-sidebar-group-btn__lead">
            <StatusDot state={group.state} />
            <span className="workspace-sidebar-group-btn__name">{group.name}</span>
          </span>
          <span className="workspace-sidebar-group-btn__trail">
            <span className="workspace-sidebar-group-btn__count">{group.online}/{group.total}</span>
          </span>
          {rippleNodes}
        </button>
        {group.devices.length > 0 && (
          <button
            type="button"
            className={`workspace-sidebar-group-toggle m3e-state-host ${expanded ? "is-expanded" : ""}`}
            aria-expanded={expanded}
            aria-label={`${expanded ? "收起" : "展开"} ${group.name} 组内设备`}
            title={`${expanded ? "收起" : "展开"} ${group.name}`}
            onPointerDown={onTogglePointerDown}
            onClick={onToggleExpand}
          >
            <Icon name="chevronRight" size={14} />
            {toggleRipples}
          </button>
        )}
      </div>
      {group.devices.length > 0 && (
        <div
          className={`workspace-sidebar-group-collapse ${expanded ? "is-expanded" : ""}`}
          aria-hidden={!expanded}
        >
          <div className="workspace-sidebar-group-devices" role="group" aria-label={`${group.name} 组内设备`}>
            {group.devices.map((device, index) => (
              <SidebarGroupDeviceItem
                key={device.deviceId}
                device={device}
                index={index}
                expanded={expanded}
                isCurrentDevice={activeDeviceId === device.deviceId}
                state={resolveDeviceDotState(device, healthThresholds)}
                onSelect={() => onSelectDevice(device.deviceId)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SidebarDeviceGroups({ onAfterSelect }: { onAfterSelect?: () => void }) {
  const { route, navigate, healthThresholds } = useWorkspaceUi();
  const { allDevices, selectedDevice, snapshot, mutationPending } = useWorkspaceData();
  const { updateDeviceGroup } = useWorkspaceActions();
  const groups = useMemo(() => selectDeviceGroups(allDevices, healthThresholds), [allDevices, healthThresholds]);
  const hasNamedGroups = useMemo(() => groups.some((group) => !group.isUngrouped), [groups]);
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>({});
  const canManage = Boolean(snapshot?.source === "live" && snapshot.session.authenticated && !mutationPending);

  const activeDeviceGroupKey = route.kind === "device" && selectedDevice
    ? (normalizeDeviceGroup(selectedDevice.group) ?? UNGROUPED_GROUP_KEY)
    : null;
  const activeRouteGroup = (route.kind === "devices" || route.kind === "overview") ? (route.group ?? "all") : null;

  useEffect(() => {
    const focusKey = activeDeviceGroupKey ?? (activeRouteGroup && activeRouteGroup !== "all" ? activeRouteGroup : null);
    if (!focusKey) return;
    setManualExpanded((current) => (current[focusKey] === false ? { ...current, [focusKey]: true } : current));
  }, [activeDeviceGroupKey, activeRouteGroup]);

  if (!hasNamedGroups) {
    if (allDevices.length < 2) return null;
    return (
      <div className="workspace-sidebar-groups" role="group" aria-label="设备组引导">
        <div className="workspace-sidebar-groups__header">
          <span>设备组</span>
          <button
            type="button"
            className="workspace-sidebar-groups__manage-link"
            onClick={() => {
              navigate({ kind: "devices" });
              onAfterSelect?.();
            }}
          >
            + 新建
          </button>
        </div>
      </div>
    );
  }

  const onlineTotal = allDevices.filter((device) => device.status === "online").length;
  const allDevicesState: StatusDotState = allDevices.length === 0 || onlineTotal === 0
    ? "offline"
    : groups.some((g) => g.criticalCount > 0)
      ? "critical"
      : groups.some((g) => g.warningCount > 0 || g.offline > 0)
        ? "warning"
        : "online";
  const activeDeviceId = route.kind === "device" ? route.deviceId : null;
  const targetKind = route.kind === "overview" ? "overview" : "devices";

  return (
    <div className="workspace-sidebar-groups" role="group" aria-label="设备组快捷导航">
      <div className="workspace-sidebar-groups__header">
        <span>设备组</span>
        <small>{groups.filter((g) => !g.isUngrouped).length} 组</small>
      </div>
      <SidebarAllDevicesButton
        selected={(route.kind === "devices" || route.kind === "overview") && (!route.group || route.group === "all")}
        onlineTotal={onlineTotal}
        total={allDevices.length}
        state={allDevicesState}
        onClick={() => {
          navigate({ kind: targetKind });
          onAfterSelect?.();
        }}
      />
      {groups.map((group) => {
        const isSelectedGroup = activeRouteGroup === group.key;
        const isParentOfActiveDevice = activeDeviceGroupKey === group.key;
        const autoExpanded = isSelectedGroup || isParentOfActiveDevice;
        const expanded = manualExpanded[group.key] ?? autoExpanded;
        return (
          <SidebarGroupEntry
            key={group.key}
            group={group}
            expanded={expanded}
            isSelectedGroup={isSelectedGroup}
            isParentOfActiveDevice={isParentOfActiveDevice}
            activeDeviceId={activeDeviceId}
            healthThresholds={healthThresholds}
            onSelectGroup={() => {
              if ((route.kind === "devices" || route.kind === "overview") && isSelectedGroup) {
                setManualExpanded((current) => ({ ...current, [group.key]: !expanded }));
                return;
              }
              setManualExpanded((current) => ({ ...current, [group.key]: true }));
              navigate({ kind: targetKind, group: group.key });
              onAfterSelect?.();
            }}
            onToggleExpand={() => {
              setManualExpanded((current) => ({ ...current, [group.key]: !expanded }));
            }}
            onSelectDevice={(deviceId) => {
              navigate({ kind: "device", deviceId, view: route.kind === "device" ? route.view : undefined });
              onAfterSelect?.();
            }}
            onDropDevices={
              canManage
                ? (deviceIds) => {
                    const targetGroup = group.isUngrouped ? null : group.name;
                    const changed = deviceIds.filter((id) => {
                      const dev = allDevices.find((item) => item.deviceId === id);
                      return dev && normalizeDeviceGroup(dev.group) !== targetGroup;
                    });
                    if (changed.length > 0) void updateDeviceGroup(changed, targetGroup);
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

export function PrimaryNavigation({
  sidebarPeek,
  onRequestPeek,
  onSidebarLeave
}: {
  sidebarPeek: boolean;
  onRequestPeek?: () => void;
  onSidebarLeave: () => void;
}) {
  const { capabilities, route, sidebarCollapsed, setSidebarCollapsed, navigate, openSettings, closeSettings } = useWorkspaceUi();
  const { allDevices } = useWorkspaceData();
  const { openExternal } = useWorkspaceActions();
  const inSettings = route.kind === "settings";
  const hasNamedGroups = useMemo(
    () => allDevices.some((device) => normalizeDeviceGroup(device.group) !== null),
    [allDevices]
  );
  const activeGroupContext =
    (route.kind === "overview" || route.kind === "devices") && route.group ? route.group : undefined;

  return (
    <aside
      className={`workspace-sidebar ${sidebarCollapsed ? "is-collapsed" : ""} ${inSettings ? "is-settings" : ""}`}
      onMouseLeave={() => {
        if (sidebarCollapsed && sidebarPeek) onSidebarLeave();
      }}
    >
      <div className="workspace-sidebar__topline">
        <button
          className="workspace-brand"
          type="button"
          onClick={() => (inSettings ? closeSettings() : navigate({ kind: "overview" }))}
          aria-label="返回总览"
        >
          <img className="workspace-brand__mark-img" src={appIconSrc} alt="观澜" />
          {!capabilities.canControlNativeWindow && <span className="workspace-brand__name">观澜</span>}
        </button>
        <M3IconButton
          className="workspace-icon-button workspace-sidebar__collapse"
          label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          <Icon name="collapse" />
        </M3IconButton>
      </div>
      {inSettings ? (
        <SettingsNavigation />
      ) : (
        <nav className="workspace-sidebar__nav" aria-label="设备控制台导航">
          <M3NavigationItem
            className="workspace-nav-item"
            icon={<Icon name="overview" />}
            selected={route.kind === "overview"}
            onClick={() =>
              navigate(activeGroupContext ? { kind: "overview", group: activeGroupContext } : { kind: "overview" })
            }
            title="总览"
            aria-label="总览"
          >
            总览
          </M3NavigationItem>
          <M3NavigationItem
            className="workspace-nav-item"
            icon={<Icon name="device" />}
            selected={route.kind === "devices" || route.kind === "device"}
            onClick={() =>
              navigate(activeGroupContext ? { kind: "devices", group: activeGroupContext } : { kind: "devices" })
            }
            title="设备"
            aria-label="设备"
          >
            设备
          </M3NavigationItem>
          {sidebarCollapsed && !sidebarPeek && hasNamedGroups && onRequestPeek && (
            <M3IconButton
              className="workspace-icon-button workspace-sidebar__peek-groups"
              selected={Boolean(activeGroupContext)}
              label="展开设备组快捷面板"
              onClick={onRequestPeek}
            >
              <Icon name="grid" />
            </M3IconButton>
          )}
          <SidebarDeviceGroups onAfterSelect={sidebarCollapsed && sidebarPeek ? onSidebarLeave : undefined} />
          <div className="workspace-sidebar__spacer" />
          {capabilities.canManageLocalAgent && (
            <M3NavigationItem
              className="workspace-nav-item"
              icon={<Icon name="connection" />}
              onClick={() => navigate({ kind: "settings", section: "connections" })}
              title="连接与本机"
              aria-label="连接与本机"
            >
              连接与本机
            </M3NavigationItem>
          )}
        </nav>
      )}
      <div className="workspace-sidebar__footer">
        {inSettings ? (
          <M3NavigationItem
            className="workspace-nav-item"
            icon={<Icon name="back" />}
            onClick={closeSettings}
            title="返回设备控制台"
            aria-label="返回设备控制台"
          >
            返回控制台
          </M3NavigationItem>
        ) : (
          <M3NavigationItem
            className="workspace-nav-item"
            icon={<Icon name="settings" />}
            onClick={() => openSettings()}
            title="设置"
            aria-label="设置"
          >
            设置
          </M3NavigationItem>
        )}
        <M3Button
          className="workspace-sidebar__support"
          variant="text"
          onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor/issues")}
          title="打开帮助与反馈"
          aria-label="打开帮助与反馈"
        >
          <span>帮助与反馈</span>
          <Icon name="external" size={18} />
        </M3Button>
      </div>
    </aside>
  );
}
