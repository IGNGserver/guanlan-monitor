import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AgentProbeProvider, AgentProbeTarget, CpuPackageStats, DeviceBlockKey, DeviceMetricKey, DesktopDetectedTargetGroup, DeviceSummary, FanMetricSeries, FanSensorStats, SamplePoint, SystemStats, TemperatureMetricSeries, TemperatureSensorReading, TrafficCalendarMode, TrafficCalendarResponse, VirtualizationStorageMetricSeries, VirtualizationStorageTelemetry, WidgetInstanceConfig, WidgetLayoutDocument, WidgetLayoutSaveRequest, WidgetPanelMetadata } from "@dsc/shared";
import { isDisplayableVirtualizationStorage, isDisplayableVirtualizationStorageSeries, virtualizationStorageInstances } from "@dsc/shared";
import clsx from "clsx";
import appIcon from "../assets/app-icon.png";
import type { ConsoleAdapter } from "../services/adapter";
import {
  SettingsSection,
  WorkspaceProvider,
  useWorkspace
} from "./WorkspaceContext";
import {
  DesktopWidget,
  WidgetLayoutProvider,
  WidgetLayoutToolbar,
  confirmDiscardWidgetLayoutDraft,
  useOptionalWidgetLayout,
  type WidgetKind,
  type WidgetDisplayMode,
  type WidgetSize
} from "./WidgetLayout";
import { DeviceWidgetFrame } from "./DeviceWidgetFrame";
import { DynamicWidgetCanvas, WidgetDrawer } from "./widgetCatalog";
import { Button, Icon, StatusDot, StatusLabel, Surface, SummaryRow, VirtualMachinePowerLabel, type IconName, virtualMachinePowerState } from "./ui";
import { MiniTrend, TelemetryChartCard, TelemetryInfoCard } from "./TelemetryCards";
import {
  CapacityMetricValue,
  MetricValue,
  UNAVAILABLE_METRIC_LABEL,
  WINDOW_DURATION_MAP,
  averageSamplePointsOrFallback,
  displayInstanceName,
  displayModelName,
  formatAxisTime,
  formatBytes,
  formatCapacitySummary,
  formatCount,
  formatDate,
  formatDuration,
  formatGpuMemorySummary,
  formatPreciseDateTime,
  gpuMemoryLabel,
  splitPointsIntoSegments,
  sumSamplePoints
} from "./formatters";

const appIconSrc = typeof appIcon === "string" ? appIcon : (appIcon as { src: string }).src;

function isMetricUnavailable(
  device: Pick<DeviceSummary, "instanceType" | "unavailableMetrics">,
  key: DeviceMetricKey,
  latest?: { unavailableMetrics?: DeviceMetricKey[] } | null
): boolean {
  if (device.instanceType !== "virtual_machine") return false;
  return new Set([...(device.unavailableMetrics ?? []), ...(latest?.unavailableMetrics ?? [])]).has(key);
}

function unavailablePoints(points: SamplePoint[], unavailable: boolean): SamplePoint[] {
  return unavailable ? [] : points;
}

function formatVirtualizationStorageType(type: string | null | undefined): string {
  const labels: Record<string, string> = {
    btrfs: "Btrfs",
    cephfs: "CephFS",
    cifs: "CIFS",
    dir: "目录",
    glusterfs: "GlusterFS",
    iscsi: "iSCSI",
    lvm: "LVM",
    lvmthin: "LVM-Thin",
    nfs: "NFS",
    rbd: "RBD",
    zfspool: "ZFS 存储池"
  };
  return type ? labels[type.toLowerCase()] ?? type : UNAVAILABLE_METRIC_LABEL;
}

function formatVirtualizationStorageValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatBytes(value) : UNAVAILABLE_METRIC_LABEL;
}

function formatVirtualizationStoragePercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : UNAVAILABLE_METRIC_LABEL;
}

function formatVirtualizationStorageCapacity(usedBytes: number | null | undefined, totalBytes: number | null | undefined): string {
  const complete = typeof usedBytes === "number" && Number.isFinite(usedBytes)
    && typeof totalBytes === "number" && Number.isFinite(totalBytes) && totalBytes > 0;
  return formatCapacitySummary(usedBytes, totalBytes, !complete);
}

function latestSampleValue(points: SamplePoint[] | undefined): number | null {
  const value = points?.at(-1)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const metricGroups: Array<{ label: string; items: Array<{ key: DeviceMetricKey; label: string }> }> = [
  {
    label: "处理器",
    items: [
      { key: "cpuUsage", label: "CPU 使用率" },
      { key: "cpuFrequency", label: "CPU 频率" },
      { key: "cpuTemperature", label: "CPU 温度" },
      { key: "cpuTopology", label: "核心、线程与 L3 缓存" },
      { key: "systemOverview", label: "系统概览" }
    ]
  },
  {
    label: "显卡",
    items: [
      { key: "gpuUsage", label: "GPU 使用率" },
      { key: "gpuEncode", label: "编码负载" },
      { key: "gpuDecode", label: "解码负载" },
      { key: "gpuFrequency", label: "GPU 频率" },
      { key: "gpuMemory", label: "GPU 内存使用" },
      { key: "gpuTemperature", label: "GPU 温度" },
      { key: "gpuDriverInfo", label: "驱动信息" }
    ]
  },
  {
    label: "内存",
    items: [
      { key: "memoryUsage", label: "内存使用率" },
      { key: "swapUsage", label: "交换分区" },
      { key: "memoryAvailable", label: "可用内存" },
      { key: "memoryCached", label: "缓存内存" },
      { key: "memoryCommitted", label: "已提交内存" },
      { key: "memoryHardware", label: "内存硬件信息" }
    ]
  },
  {
    label: "磁盘",
    items: [
      { key: "diskUsage", label: "磁盘使用率" },
      { key: "diskRead", label: "读取速率" },
      { key: "diskWrite", label: "写入速率" },
      { key: "diskMetadata", label: "磁盘信息" },
      { key: "diskActivity", label: "活动状态" },
      { key: "diskHealth", label: "健康状态" }
    ]
  },
  {
    label: "网络",
    items: [
      { key: "networkRxRate", label: "接收速率" },
      { key: "networkTxRate", label: "发送速率" },
      { key: "networkTraffic", label: "流量统计" },
      { key: "networkIdentity", label: "网卡信息" }
    ]
  },
  {
    label: "风扇",
    items: [
      { key: "fanRpm", label: "转速" },
      { key: "fanControl", label: "控制状态" },
      { key: "fanTargetTemperature", label: "目标温度" },
      { key: "fanPwm", label: "PWM 占空比" },
      { key: "fanChannelState", label: "通道状态" }
    ]
  },
  {
    label: "温度源",
    items: [
      { key: "temperatureSources", label: "全部温度传感器" }
    ]
  }
];

const instanceMetricOptions: Partial<Record<AgentProbeTarget, Array<{ key: DeviceMetricKey; label: string }>>> = {
  cpu: metricGroups[0].items,
  gpu: metricGroups[1].items,
  disk: metricGroups[3].items,
  network: metricGroups[4].items
};

const probeTargetLabels: Record<AgentProbeTarget, string> = {
  cpu: "CPU 处理器",
  gpu: "GPU 显卡",
  memory: "内存",
  disk: "磁盘",
  network: "网络",
  fan: "风扇",
  connection: "连接"
};

const probeProviderLabels: Record<AgentProbeProvider, string> = {
  builtin: "内置采集",
  gopsutil: "系统采集（gopsutil）",
  hwmon: "Linux hwmon",
  wmi: "Windows WMI",
  librehardwaremonitor: "LibreHardwareMonitor",
  libreHardwareMonitor: "LibreHardwareMonitor",
  openHardwareMonitor: "OpenHardwareMonitor",
  redfish: "Redfish",
  disabled: "禁用"
};

function WorkspaceSidebar({ sidebarPeek, onSidebarLeave }: { sidebarPeek: boolean; onSidebarLeave: () => void }) {
  const {
    capabilities,
    route,
    sidebarCollapsed,
    setSidebarCollapsed,
    hubs,
    navigate,
    openSettings,
    closeSettings,
    openExternal,
    snapshot,
    allDevices,
    devices,
    instanceType,
    setInstanceType
  } = useWorkspace();
  const deviceCount = allDevices.filter((device) => (device.instanceType ?? "device") === "device").length;
  const virtualMachineCount = allDevices.filter((device) => device.instanceType === "virtual_machine").length;
  const inSettings = route.kind === "settings";
  const hubOnline = hubs[0]?.state === "online";
  const hubAbnormal = !hubOnline && !snapshot?.session.authenticated && snapshot?.source !== "empty";

  return (
    <aside className={`workspace-sidebar ${sidebarCollapsed ? "is-collapsed" : ""} ${inSettings ? "is-settings" : ""}`} onMouseLeave={() => { if (sidebarCollapsed && sidebarPeek) onSidebarLeave(); }}>
      <div className="workspace-sidebar__topline">
        <button className="workspace-brand" type="button" onClick={() => (inSettings ? closeSettings() : navigate({ kind: "overview" }))} aria-label="返回总览">
          <img className="workspace-brand__mark-img" src={appIconSrc} alt="观澜" />
          <span className="workspace-brand__name">观澜</span>
        </button>
        <button className="workspace-icon-button workspace-sidebar__collapse" type="button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}>
          <Icon name="collapse" />
        </button>
      </div>

      {inSettings ? (
        <SettingsSidebar />
      ) : (
        <nav className="workspace-sidebar__nav" aria-label="设备控制台导航">
          <button className={`workspace-nav-item ${route.kind === "overview" ? "is-active" : ""}`} type="button" onClick={() => navigate({ kind: "overview" })} title="总览">
            <Icon name="overview" /> <span>总览</span>
          </button>
          <div className="workspace-sidebar__label"><button className="workspace-sidebar__hub-link" type="button" onClick={() => navigate({ kind: "hub", hubId: "primary" })}>接入中枢</button><span className="workspace-sidebar__count">{allDevices.length}</span></div>
          <div className="workspace-instance-tabs" role="tablist" aria-label="实例类型">
            {(["device", "virtual_machine"] as const).map((type) => (
              <button
                key={type}
                className={`workspace-instance-tab ${instanceType === type ? "is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={instanceType === type}
                onClick={() => {
                  const current = route.kind === "device" ? allDevices.find((device) => device.deviceId === route.deviceId) : null;
                  if (current && (current.instanceType ?? "device") !== type) navigate({ kind: "overview" });
                  setInstanceType(type);
                }}
              >
                {type === "device" ? `普通设备（${deviceCount}）` : `虚拟机（${virtualMachineCount}）`}
              </button>
            ))}
          </div>
          {hubAbnormal ? (
            <button className="workspace-sidebar-hub-alert" type="button" onClick={() => openSettings(capabilities.canConfigureConnection ? "connections" : "workspace")} title={capabilities.canConfigureConnection ? "中枢连接异常，点击检查连接设置" : "中枢连接异常，点击查看中枢设置"}>
              <StatusDot state="warning" />
              <span>中枢连接异常</span>
            </button>
          ) : null}
          <div className="workspace-device-list">
            {devices.length ? devices.map((device) => (
              <button className={`workspace-device-item ${route.kind === "device" && route.deviceId === device.deviceId ? "is-active" : ""}`} type="button" key={device.deviceId} onClick={() => navigate({ kind: "device", deviceId: device.deviceId })} title={device.hostname}>
                {(device.instanceType ?? "device") === "virtual_machine"
                  ? <StatusDot state={virtualMachinePowerState(device.virtualMachine?.powerState).state} />
                  : <StatusDot state={device.status === "online" ? "online" : "offline"} />}
                <span className="workspace-device-item__copy"><strong>{device.hostname}</strong><small>{(device.instanceType ?? "device") === "virtual_machine" ? `${virtualMachinePowerState(device.virtualMachine?.powerState).label} · 宿主机：${device.hostName ?? "未知"}` : device.os} · <MetricValue value={device.cpuUsagePercent} unavailable={isMetricUnavailable(device, "cpuUsage")} /></small></span>
              </button>
            )) : <div className="workspace-sidebar__empty">尚未发现设备</div>}
          </div>
          <div className="workspace-sidebar__spacer" />
          {capabilities.canManageLocalAgent && <button className="workspace-nav-item" type="button" onClick={() => openSettings("agent")} title="本机 Agent">
            <Icon name="agent" /> <span>本机 Agent</span>
          </button>}
          {capabilities.canConfigureConnection && <button className="workspace-nav-item" type="button" onClick={() => openSettings("connections")} title="连接设置">
            <Icon name="connection" /> <span>连接设置</span>
          </button>}
        </nav>
      )}

      <div className="workspace-sidebar__footer">
        {inSettings ? (
          <button className="workspace-nav-item" type="button" onClick={closeSettings} title="返回设备控制台"><Icon name="back" /><span>返回控制台</span></button>
        ) : (
          <button className="workspace-nav-item" type="button" onClick={() => openSettings()} title="设置"><Icon name="settings" /><span>设置</span></button>
        )}
        <button className="workspace-sidebar__support" type="button" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor/issues")} title="打开帮助与反馈">
          <span>帮助与反馈</span><Icon name="external" size={14} />
        </button>
      </div>
    </aside>
  );
}

const desktopSettingsNav: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: "general", label: "通用", icon: "settings" },
  { id: "appearance", label: "外观", icon: "appearance" },
  { id: "connections", label: "中枢与连接", icon: "connection" },
  { id: "agent", label: "本机 Agent", icon: "agent" },
  { id: "data", label: "数据与更新", icon: "data" },
  { id: "shortcuts", label: "快捷键", icon: "keyboard" },
  { id: "about", label: "关于观澜", icon: "about" }
];

const webSettingsNav: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: "workspace", label: "工作台", icon: "overview" },
  { id: "appearance", label: "外观", icon: "appearance" },
  { id: "session", label: "会话安全", icon: "connection" },
  { id: "data", label: "数据与更新", icon: "data" },
  { id: "shortcuts", label: "快捷键", icon: "keyboard" },
  { id: "about", label: "关于观澜", icon: "about" }
];

function settingsNavigation(capabilities: ReturnType<typeof useWorkspace>["capabilities"]) {
  return capabilities.canControlNativeWindow ? desktopSettingsNav : webSettingsNav;
}

function SettingsSidebar() {
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
        <button className={`workspace-nav-item ${route.kind === "settings" && route.section === item.id ? "is-active" : ""}`} type="button" key={item.id} onClick={() => navigate({ kind: "settings", section: item.id })} title={item.label}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function WindowTitleBar() {
  const { minimizeWindow, toggleMaximizeWindow, closeWindow, capabilities, adapterDragStart, adapterDragMove, adapterDragEnd } = useWorkspace();
  const [isMaximized, setIsMaximized] = useState(false);
  const dragPointerId = useRef<number | null>(null);

  const toggleMaximize = async () => {
    const next = await toggleMaximizeWindow();
    setIsMaximized(next);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragPointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (capabilities.canControlNativeWindow) adapterDragStart(event.screenX, event.screenY);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragPointerId.current !== event.pointerId) return;
    if (capabilities.canControlNativeWindow) adapterDragMove(event.screenX, event.screenY);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragPointerId.current !== event.pointerId) return;
    dragPointerId.current = null;
    if (capabilities.canControlNativeWindow) adapterDragEnd();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <header className="workspace-windowbar">
      <div
        className="workspace-windowbar__drag"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
        onDoubleClick={() => void toggleMaximize()}
      >
        <img className="workspace-windowbar__mark-img" src={appIconSrc} alt="观澜" />
        <strong>观澜</strong>
        <span className="workspace-windowbar__separator" aria-hidden="true" />
        <span className="workspace-windowbar__subtitle">设备状态控制台</span>
      </div>
      <div className="workspace-windowbar__controls" role="group" aria-label="窗口控制">
        <button className="workspace-window-control" type="button" onClick={() => void minimizeWindow()} aria-label="最小化" title="最小化"><Icon name="windowMinimize" size={15} /></button>
        <button className="workspace-window-control" type="button" onClick={() => void toggleMaximize()} aria-label={isMaximized ? "还原窗口" : "最大化"} title={isMaximized ? "还原窗口" : "最大化"}><Icon name={isMaximized ? "windowRestore" : "windowMaximize"} size={14} /></button>
        <button className="workspace-window-control workspace-window-control--close" type="button" onClick={() => void closeWindow()} aria-label="隐藏到托盘" title="隐藏到托盘"><Icon name="windowClose" size={15} /></button>
      </div>
    </header>
  );
}

function TopBar() {
  const { route, snapshot, refreshing, mutationPending, refresh, setCommandOpen, sidebarCollapsed, setSidebarCollapsed, openSettings, capabilities } = useWorkspace();
  const title = route.kind === "overview" ? "总览" : route.kind === "device" ? "设备详情" : route.kind === "hub" ? "中枢详情" : settingsNavigation(capabilities).find((item) => item.id === route.section)?.label ?? "设置";
  const sourceState = snapshot?.source === "cache" ? "cached" : snapshot?.session.authenticated ? "online" : snapshot?.source === "empty" ? "unknown" : "offline";
  return (
    <header className="workspace-topbar">
      <div className="workspace-topbar__title">
        <button className="workspace-icon-button workspace-topbar__toggle" type="button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label="切换侧边栏">
          <Icon name="collapse" />
        </button>
        <div>
          <span className="workspace-topbar__eyebrow">设备状态控制台</span>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="workspace-topbar__actions">
        <StatusLabel state={sourceState} />
        <button className="workspace-search-trigger" type="button" onClick={() => setCommandOpen(true)}><Icon name="search" /><span>搜索设备</span><kbd>/</kbd></button>
        <Button variant="quiet" onClick={() => void refresh()} disabled={refreshing || mutationPending} title={mutationPending ? "正在保存更改" : "刷新状态"}><Icon name="refresh" size={16} />{!refreshing && <span>{mutationPending ? "保存中" : "刷新"}</span>}</Button>
        {route.kind !== "settings" && <Button variant="quiet" onClick={() => openSettings("appearance")} title="外观设置"><Icon name="appearance" size={16} /></Button>}
      </div>
    </header>
  );
}

function ShellNotice() {
  const { notice } = useWorkspace();
  if (!notice) return null;
  return <div className={`workspace-toast workspace-toast--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>;
}

function CommandPalette() {
  const { commandOpen, setCommandOpen, searchQuery, setSearchQuery, filteredDevices, navigate, openSettings, capabilities } = useWorkspace();
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });

  useLayoutEffect(() => {
    if (!commandOpen || typeof window === "undefined") return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const visualViewport = window.visualViewport;
    const syncViewport = () => setViewport({ top: visualViewport?.offsetTop ?? 0, height: visualViewport?.height ?? window.innerHeight });
    syncViewport();
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus());
    visualViewport?.addEventListener("resize", syncViewport);
    visualViewport?.addEventListener("scroll", syncViewport);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      visualViewport?.removeEventListener("resize", syncViewport);
      visualViewport?.removeEventListener("scroll", syncViewport);
    };
  }, [commandOpen]);

  useEffect(() => {
    if (commandOpen) setActiveIndex(0);
  }, [commandOpen]);

  useEffect(() => {
    if (commandOpen) return;
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }, [commandOpen]);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
    if (!focusable.length) return;
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex + 1) % focusable.length;
    event.preventDefault();
    focusable[nextIndex]?.focus();
  };

  if (!commandOpen) return null;
  const commands: Array<{ label: string; detail: string; action: () => void }> = [
    { label: "打开总览", detail: "查看所有设备状态", action: () => navigate({ kind: "overview" }) },
    capabilities.canConfigureConnection
      ? { label: "打开连接设置", detail: "添加或重新认证中枢", action: () => openSettings("connections") }
      : { label: "打开中枢工作台", detail: "查看网页端同步和会话状态", action: () => openSettings("workspace") },
    ...(capabilities.canManageLocalAgent ? [{ label: "打开本机 Agent", detail: "控制本机采集服务", action: () => openSettings("agent") }] : []),
    ...filteredDevices.slice(0, 8).map((device) => ({ label: device.hostname, detail: `${device.os} · ${device.deviceId}`, action: () => navigate({ kind: "device", deviceId: device.deviceId }) }))
  ];
  const query = searchQuery.trim().toLowerCase();
  const filtered = query ? commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(query)) : commands;
  const select = (index: number) => {
    const command = filtered[index];
    if (!command) return;
    command.action();
    setCommandOpen(false);
    setSearchQuery("");
  };
  const overlayStyle = {
    "--workspace-viewport-top": `${viewport.top}px`,
    "--workspace-viewport-height": `${viewport.height || (typeof window === "undefined" ? 0 : window.innerHeight)}px`
  } as React.CSSProperties;
  return (
    <div className="workspace-overlay" style={overlayStyle} role="presentation" onPointerDown={() => setCommandOpen(false)}>
      <section ref={dialogRef} className="workspace-command" role="dialog" aria-modal="true" aria-label="搜索设备和命令" onPointerDown={(event) => event.stopPropagation()} onKeyDown={handleDialogKeyDown}>
        <div className="workspace-command__input"><Icon name="search" /><input ref={inputRef} autoFocus value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, filtered.length - 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); } else if (event.key === "Enter") { event.preventDefault(); select(activeIndex); } }} placeholder="搜索设备、页面或命令" /></div>
        <div className="workspace-command__list">
          {filtered.length ? filtered.map((command, index) => <button className={`workspace-command__item ${index === activeIndex ? "is-active" : ""}`} type="button" key={`${command.label}-${index}`} onPointerEnter={() => setActiveIndex(index)} onClick={() => select(index)}><span><strong>{command.label}</strong><small>{command.detail}</small></span><Icon name="arrow" size={15} /></button>) : <div className="workspace-command__empty">没有匹配结果</div>}
        </div>
        <div className="workspace-command__footer"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>打开</span><span><kbd>Esc</kbd>关闭</span></div>
      </section>
    </div>
  );
}

function PageIntro({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <div className="workspace-page-intro"><div>{eyebrow && <div className="workspace-page-intro__eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="workspace-page-intro__actions">{actions}</div>}</div>;
}



function useModalFocusTrap() {
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      const firstControl = dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])");
      firstControl?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex + 1) % focusable.length;
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, []);

  return dialogRef;
}

function ConfirmDialog({
  title,
  detail,
  confirmLabel = "确认",
  onConfirm,
  onCancel,
  disabled = false
}: {
  title: string;
  detail: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const dialogRef = useModalFocusTrap();
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disabled) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, onCancel]);
  return <div className="workspace-confirm-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !disabled) onCancel(); }}><section ref={dialogRef} className="workspace-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-confirm-title" onPointerDown={(event) => event.stopPropagation()}><span className="workspace-section-kicker">请确认操作</span><h2 id="workspace-confirm-title">{title}</h2><p>{detail}</p><div className="workspace-form__actions"><Button variant="danger" autoFocus onClick={onConfirm} disabled={disabled}>{disabled ? "处理中…" : confirmLabel}</Button><Button variant="quiet" onClick={onCancel} disabled={disabled}>取消</Button></div></section></div>;
}

function PromptDialog({
  title,
  detail,
  initialValue,
  confirmLabel = "保存",
  onConfirm,
  onCancel,
  disabled = false
}: {
  title: string;
  detail: string;
  initialValue: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const dialogRef = useModalFocusTrap();
  useEffect(() => setValue(initialValue), [initialValue]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disabled) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, onCancel]);
  const submit = () => {
    const nextValue = value.trim();
    if (!nextValue || disabled) return;
    onConfirm(nextValue);
  };
  return <div className="workspace-confirm-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !disabled) onCancel(); }}><section ref={dialogRef} className="workspace-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-prompt-title" onPointerDown={(event) => event.stopPropagation()}><span className="workspace-section-kicker">编辑名称</span><h2 id="workspace-prompt-title">{title}</h2><p>{detail}</p><input className="workspace-input" autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }} maxLength={80} /><div className="workspace-form__actions"><Button variant="primary" onClick={submit} disabled={disabled || !value.trim()}>{disabled ? "处理中…" : confirmLabel}</Button><Button variant="quiet" onClick={onCancel} disabled={disabled}>取消</Button></div></section></div>;
}

function DeviceRow({
  device,
  index,
  total,
  onMove,
  onDelete
}: {
  device: DeviceSummary;
  index?: number;
  total?: number;
  onMove?: (direction: -1 | 1) => void;
  onDelete?: () => void;
}) {
  const { navigate } = useWorkspace();
  const open = () => navigate({ kind: "device", deviceId: device.deviceId });
  const isVm = device.instanceType === "virtual_machine";
  const powerState = isVm ? virtualMachinePowerState(device.virtualMachine?.powerState) : null;
  return <div
    className="workspace-device-row"
    role="button"
    tabIndex={0}
    onClick={open}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}
  >
    <span className="workspace-device-row__status"><StatusDot state={powerState?.state ?? (device.status === "online" ? "online" : "offline")} /></span>
    <span className="workspace-device-row__identity"><strong>{device.hostname}</strong><small>{isVm ? `${powerState?.label ?? "电源状态未知"} · 宿主机：${device.hostName ?? "未知"}` : device.os} · {device.deviceId}</small></span>
    <span className="workspace-device-row__metric"><small>CPU</small><MetricValue value={device.cpuUsagePercent} unavailable={isMetricUnavailable(device, "cpuUsage")} /></span>
    <span className="workspace-device-row__metric"><small>内存</small><CapacityMetricValue usedBytes={device.memoryUsedBytes} totalBytes={device.memoryTotalBytes} percentValue={device.memoryUsagePercent} unavailable={isMetricUnavailable(device, "memoryUsage")} /></span>
    <span className="workspace-device-row__metric"><small>磁盘</small><CapacityMetricValue usedBytes={device.diskUsedBytes} totalBytes={device.diskTotalBytes} percentValue={device.diskUsagePercent} unavailable={isMetricUnavailable(device, "diskUsage")} /></span>
    {onMove || onDelete ? <span className="workspace-device-row__actions" onClick={(event) => event.stopPropagation()}>
      {onMove && <>
        <button type="button" className="workspace-row-action" disabled={index === 0} onClick={() => onMove(-1)} aria-label="上移" title="上移">↑</button>
        <button type="button" className="workspace-row-action" disabled={index === (total ?? 0) - 1} onClick={() => onMove(1)} aria-label="下移" title="下移">↓</button>
      </>}
      {onDelete && <button type="button" className="workspace-row-action workspace-row-action--danger" onClick={onDelete} aria-label="删除实例" title="删除实例">×</button>}
    </span> : <Icon name="arrow" size={15} />}
  </div>;
}

function OverviewPage() {
  const { snapshot, devices, instanceType, metricsWindow, loading, mutationPending, error, refresh, openSettings, deleteInstance, reorderInstances, capabilities } = useWorkspace();
  const [deleteTarget, setDeleteTarget] = useState<DeviceSummary | null>(null);
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备状态" detail={error ?? "桌面桥接尚未准备好"} onRetry={() => void refresh()} />;
  const online = devices.filter((device) => device.status === "online").length;
  const offline = devices.length - online;
  const cached = snapshot.source === "cache";
  const emptySource = snapshot.source === "empty";
  const canManageRemote = snapshot.source === "live" && snapshot.session.authenticated;
  const noData = snapshot.source === "empty" || devices.length === 0;
  const hubAbnormal = cached || (!snapshot.session.authenticated && snapshot.source !== "empty");
  const issueCount = hubAbnormal ? 0 : offline + (noData ? 1 : 0) + (snapshot.localBackend?.lastIssueCount ?? 0);
  const overviewInstances = (snapshot.overviewMetrics?.instances ?? []).filter((instance) => (instance.instanceType ?? "device") === instanceType);
  const liveDevices = devices.filter((device) => device.status === "online");
  const instanceLabel = instanceType === "virtual_machine" ? "虚拟机" : "普通设备";
  const webSettings = !capabilities.canControlNativeWindow;
  const primarySettingsSection: SettingsSection = capabilities.canConfigureConnection ? "connections" : "workspace";
  const noDataSettingsSection: SettingsSection = capabilities.canManageLocalAgent
    ? (snapshot.localBackend ? "agent" : "connections")
    : "workspace";
  const settingsLabel = capabilities.canConfigureConnection ? "连接设置" : "中枢设置";
  const metricWindowLabel = ({ "1m": "1 分钟", "5m": "5 分钟", "15m": "15 分钟", "1h": "1 小时", "6h": "6 小时", "24h": "24 小时", "1d": "1 天", "7d": "7 天", "1w": "1 周", "30d": "30 天", "1mo": "1 个月", "90d": "90 天", "1y": "1 年" } as Record<string, string>)[metricsWindow] ?? metricsWindow;

  // 计算 TOP 5 资源消耗榜
  const topCpuDevices = [...liveDevices].filter((device) => Number.isFinite(device.cpuUsagePercent) && !isMetricUnavailable(device, "cpuUsage")).sort((a, b) => (b.cpuUsagePercent ?? 0) - (a.cpuUsagePercent ?? 0)).slice(0, 5);
  const topMemoryDevices = [...liveDevices].filter((device) => Number.isFinite(device.memoryUsagePercent) && !isMetricUnavailable(device, "memoryUsage")).sort((a, b) => (b.memoryUsagePercent ?? 0) - (a.memoryUsagePercent ?? 0)).slice(0, 5);

  const moveInstance = (deviceId: string, direction: -1 | 1) => {
    const currentIndex = devices.findIndex((device) => device.deviceId === deviceId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= devices.length) return;
    const next = [...devices];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
    void reorderInstances(next.map((device) => device.deviceId));
  };

  const removeInstance = (device: DeviceSummary) => {
    setDeleteTarget(device);
  };

  return (
    <div className="workspace-page workspace-page--overview">
      <PageIntro
        eyebrow="系统状态"
        title={hubAbnormal ? "中枢连接异常" : issueCount ? `${issueCount} 项事项需要留意` : "所有设备运行正常"}
        description={emptySource
          ? capabilities.canManageLocalAgent
            ? "尚未取得实时设备状态，请先启动本机 Agent 或配置中枢。"
            : "尚未取得实时设备状态，请确认中枢已接入设备后刷新。"
          : hubAbnormal
            ? cached
              ? `当前显示的是离线缓存，缓存于 ${formatDate(snapshot.cache.savedAt)}；无法确认中枢当前状态。`
            : "无法连接到中枢，请检查中枢地址与访问密钥。"
          : `最后同步于 ${formatDate(snapshot.generatedAt)}。数据来自实时连接。`}
        actions={
          <>
            <Button variant="quiet" onClick={() => openSettings(primarySettingsSection)}>
              <Icon name={webSettings ? "overview" : "connection"} size={16} />{settingsLabel}
            </Button>
            <Button variant="primary" onClick={() => void refresh()} disabled={loading || mutationPending}>
              <Icon name="refresh" size={16} />刷新状态
            </Button>
          </>
        }
      />

      {hubAbnormal ? (
        <div className="workspace-attention">
          <div className="workspace-attention__icon"><Icon name="warning" /></div>
          <div>
            <strong>中枢连接异常</strong>
            <p>{cached ? "无法取得最新数据，页面中的设备信息可能已经过期。" : "无法连接到中枢，请检查中枢地址与访问密钥后重试。"}</p>
          </div>
          <Button variant="quiet" onClick={() => openSettings(primarySettingsSection)}>
            {webSettings ? "查看中枢设置" : "检查连接设置"}<Icon name="arrow" size={15} />
          </Button>
        </div>
      ) : issueCount > 0 && (
        <div className="workspace-attention">
          <div className="workspace-attention__icon"><Icon name="warning" /></div>
          <div>
            <strong>{noData ? "还没有可用设备" : "设备状态存在异常"}</strong>
            <p>{noData ? "连接中枢并等待设备上报后，这里会显示实时状态。" : `${offline} 台设备离线，${snapshot.localBackend?.lastIssueCount ?? 0} 条本机采集问题待处理。`}</p>
          </div>
          <Button variant="quiet" onClick={() => openSettings(noData ? noDataSettingsSection : capabilities.canManageLocalAgent ? "agent" : "workspace")}>
            查看详情<Icon name="arrow" size={15} />
          </Button>
        </div>
      )}

      {/* 设备列表 + 运维统计分析 */}
      <div className="workspace-overview-grid">
        <Surface className="workspace-overview-devices">
          <div className="workspace-surface__header">
            <div>
              <span className="workspace-section-kicker">实例概览</span>
              <h3>{devices.length} 个{instanceLabel}</h3>
            </div>
            {cached && <span className="workspace-caption">缓存只读</span>}
          </div>
          <div className="workspace-device-rows">
            {devices.length ? (
              devices.map((device, index) => <DeviceRow
                key={device.deviceId}
                device={device}
                index={index}
                total={devices.length}
                onMove={canManageRemote && !mutationPending ? (direction) => moveInstance(device.deviceId, direction) : undefined}
                onDelete={canManageRemote && !mutationPending ? () => removeInstance(device) : undefined}
              />)
            ) : (
              <EmptyState title="还没有设备" detail="连接一个中枢后，设备会出现在这里。" action={<Button variant="primary" onClick={() => openSettings(capabilities.canConfigureConnection ? "connections" : "workspace")}>{capabilities.canConfigureConnection ? "连接设置" : "查看中枢设置"}</Button>} />
            )}
          </div>
        </Surface>

        {/* 侧栏 Top 5 排行与摘要 */}
        <div className="workspace-overview-column">
          <Surface className="workspace-top-ranking">
            <div className="workspace-surface__header">
              <div>
                <span className="workspace-section-kicker">负载排行</span>
                <h3>CPU 使用率 TOP 5</h3>
              </div>
            </div>
            <div className="workspace-ranking-list">
              {topCpuDevices.length ? topCpuDevices.map((dev, idx) => (
                <div key={dev.deviceId} className="workspace-ranking-item">
                  <span className="workspace-ranking-badge">{idx + 1}</span>
                  <span className="workspace-ranking-name">{dev.hostname}</span>
                <span className="workspace-ranking-val"><MetricValue value={dev.cpuUsagePercent} unavailable={isMetricUnavailable(dev, "cpuUsage")} /></span>
                </div>
              )) : <div className="workspace-muted-block">暂无在线实例数据</div>}
            </div>
          </Surface>

          <Surface className="workspace-top-ranking">
            <div className="workspace-surface__header">
              <div>
                <span className="workspace-section-kicker">负载排行</span>
                <h3>内存占用 TOP 5</h3>
              </div>
            </div>
            <div className="workspace-ranking-list">
              {topMemoryDevices.length ? topMemoryDevices.map((dev, idx) => (
                <div key={dev.deviceId} className="workspace-ranking-item">
                  <span className="workspace-ranking-badge">{idx + 1}</span>
                  <span className="workspace-ranking-name">{dev.hostname}</span>
                  <span className="workspace-ranking-val"><CapacityMetricValue usedBytes={dev.memoryUsedBytes} totalBytes={dev.memoryTotalBytes} percentValue={dev.memoryUsagePercent} unavailable={isMetricUnavailable(dev, "memoryUsage")} /></span>
                </div>
              )) : <div className="workspace-muted-block">暂无在线实例数据</div>}
            </div>
          </Surface>
        </div>
      </div>

      {/* 总览图表：CPU / 内存 / 总存储 / 总网络吞吐，共用设备详情的时间范围 */}
      {snapshot.overviewMetrics && (
        <div className="workspace-overview-grid" style={{ gridTemplateColumns: "1fr" }}>
          <TelemetryChartCard
            title="CPU 图表"
            subtitle={`每个实例一条数据线 · 最近 ${metricWindowLabel}`}
            series={overviewInstances.map((instance) => ({ label: instance.hostname, points: unavailablePoints(instance.cpuUsagePercent, instance.unavailableMetrics?.includes("cpuUsage") ?? false) }))}
            valueFormatter={(v) => `${Math.round(v)}%`}
            fixedMaxValue={100}
          />
          <TelemetryChartCard
            title="内存图表"
            subtitle={`每个实例一条数据线 · 最近 ${metricWindowLabel}`}
            series={overviewInstances.map((instance) => ({ label: instance.hostname, points: unavailablePoints(instance.memoryUsedBytes, instance.unavailableMetrics?.includes("memoryUsage") ?? false), valueFormatter: formatBytes }))}
            valueFormatter={formatBytes}
          />
          <TelemetryChartCard
            title="总存储图表"
            subtitle={`每个实例一条数据线 · 最近 ${metricWindowLabel}`}
            series={overviewInstances.map((instance) => ({ label: instance.hostname, points: unavailablePoints(instance.diskUsedBytes, instance.unavailableMetrics?.includes("diskUsage") ?? false), valueFormatter: formatBytes }))}
            valueFormatter={formatBytes}
          />
          <TelemetryChartCard
            title="总网络吞吐"
            subtitle={`所有实例上行与下行叠加 · 最近 ${metricWindowLabel}`}
            series={[
              { label: "下行 (Rx)", points: sumSamplePoints(overviewInstances.map((instance) => unavailablePoints(instance.networkRxBytesPerSec, instance.unavailableMetrics?.includes("networkRxRate") ?? false))), valueFormatter: (v) => `${formatBytes(v)}/s` },
              { label: "上行 (Tx)", points: sumSamplePoints(overviewInstances.map((instance) => unavailablePoints(instance.networkTxBytesPerSec, instance.unavailableMetrics?.includes("networkTxRate") ?? false))), valueFormatter: (v) => `${formatBytes(v)}/s` }
            ]}
            valueFormatter={(v) => `${formatBytes(v)}/s`}
          />
        </div>
      )}
      {deleteTarget && <ConfirmDialog title={`删除“${deleteTarget.hostname}”？`} detail="删除后该实例不会继续出现在中枢列表中；下次宿主机或 Agent 再次上报时，它会重新显示。" confirmLabel="删除实例" disabled={mutationPending} onConfirm={() => { const deviceId = deleteTarget.deviceId; setDeleteTarget(null); void deleteInstance(deviceId); }} onCancel={() => setDeleteTarget(null)} />}
    </div>
  );
}



function MetricTile({ label, value, detail, tone, points }: { label: string; value: number | null | undefined; detail?: string; tone?: "blue" | "green" | "amber"; points?: SamplePoint[] }) {
  return <div className={`workspace-metric-tile ${tone ? `workspace-metric-tile--${tone}` : ""}`}><div className="workspace-metric-tile__header"><span>{label}</span><MetricValue value={value} /></div>{points && <MiniTrend compact label={label} points={points} />}{!points && <div className="workspace-metric-tile__empty">暂无趋势数据</div>}<small>{detail ?? "未采集"}</small></div>;
}

function TelemetrySection({
  id,
  eyebrow,
  title,
  description,
  controls,
  children
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="workspace-telemetry-section">
      <div className="workspace-telemetry-section__header">
        <div>
          <span className="workspace-section-kicker">{eyebrow}</span>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {controls && <div className="workspace-telemetry-section__controls">{controls}</div>}
      </div>
      <div className="workspace-device-chart-grid">{children}</div>
    </section>
  );
}

function mergeFanMetricSeries(latestFans: FanSensorStats[], historicalFans: FanMetricSeries[], fallbackTimestamp: string): FanMetricSeries[] {
  const latestById = new Map(latestFans.map((fan) => [fan.id, fan]));
  const merged = historicalFans.map((fan) => {
    const latest = latestById.get(fan.id);
    const currentPoint = latest ? { timestamp: fallbackTimestamp, value: latest.rpm } : null;
    const hasCurrentPoint = currentPoint ? fan.rpm.some((point) => point.timestamp === currentPoint.timestamp) : true;
    const rpm = currentPoint && !hasCurrentPoint
      ? [...fan.rpm, currentPoint].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
      : fan.rpm;
    return {
      ...fan,
      name: latest?.label || fan.name,
      interface: latest?.interface || fan.interface,
      rpm
    };
  });
  const seen = new Set(merged.map((fan) => fan.id));
  for (const fan of latestFans) {
    if (seen.has(fan.id)) continue;
    merged.push({
      id: fan.id,
      name: fan.label,
      interface: fan.interface,
      rpm: [{ timestamp: fallbackTimestamp, value: fan.rpm }]
    });
  }
  return merged;
}

const TELEMETRY_DEVICE_GROUP_TYPES: Record<"cpu" | "disk" | "gpu" | "network" | "fan", string> = {
  cpu: "cpu-device-group",
  disk: "disk-device-group",
  gpu: "gpu-device-group",
  network: "network-device-group",
  fan: "fan-device-group"
};

const TELEMETRY_DEVICE_GROUP_CATEGORIES: Record<"cpu" | "disk" | "gpu" | "network" | "fan", string> = {
  cpu: "处理器",
  disk: "存储",
  gpu: "显卡",
  network: "网络",
  fan: "散热"
};

function TelemetryDeviceBlock({
  widgetId,
  widgetTemplateId,
  targetId,
  widgetDefaultSize = "large",
  kind = "cpu",
  eyebrow = "设备实例",
  title = "设备详情",
  subtitle,
  children
}: {
  widgetId?: string;
  widgetTemplateId?: string;
  targetId?: string;
  widgetDefaultSize?: WidgetSize;
  kind?: "cpu" | "disk" | "gpu" | "network" | "fan";
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const widgetType = widgetId ? TELEMETRY_DEVICE_GROUP_TYPES[kind] : undefined;
  const widgetConfig: WidgetInstanceConfig | undefined = widgetId
    ? { systemRendered: true, ...(targetId ? { targetId } : {}) }
    : undefined;
  const childCount = React.Children.count(children);
  const defaultH = childCount >= 3 ? 4 : 2;
  const compactH = Math.max(2, childCount * 2);
  const frame = (
    <DeviceWidgetFrame kind={kind} eyebrow={eyebrow} title={title} subtitle={subtitle} count={`${childCount} 个图表`} contentClassName="workspace-device-block__charts--dynamic">
      {children}
    </DeviceWidgetFrame>
  );
  if (!widgetId) return frame;
  return (
    <DesktopWidget
      id={widgetId}
      templateId={widgetTemplateId}
      title={title}
      widgetType={widgetType}
      category={widgetType ? TELEMETRY_DEVICE_GROUP_CATEGORIES[kind] : undefined}
      visualization="table"
      config={widgetConfig}
      kind="group"
      defaultSize={widgetDefaultSize}
      defaultH={defaultH}
      compactH={compactH}
      className="workspace-widget--device-frame"
    >
      {frame}
    </DesktopWidget>
  );
}

type TelemetryInstanceSummary = {
  id: string;
  name: string;
  detail?: string;
};

function TelemetryModelList({ label, items }: { label: string; items: TelemetryInstanceSummary[] }) {
  return (
    <div className="workspace-telemetry-models">
      <span className="workspace-telemetry-models__label">{label}</span>
      {items.length ? (
        <div className="workspace-telemetry-models__list">
          {items.map((item) => (
            <span className="workspace-telemetry-model-chip" key={item.id} title={item.detail ? `${item.name} · ${item.detail}` : item.name}>
              <strong>{item.name}</strong>
              {item.detail && <small>{item.detail}</small>}
            </span>
          ))}
        </div>
      ) : (
        <span className="workspace-telemetry-models__empty">未发现可参与聚合的实例</span>
      )}
    </div>
  );
}

function CpuFactsCard({ cpus, system, unavailable = false }: { cpus: CpuPackageStats[]; system?: SystemStats; unavailable?: boolean }) {
  const sum = (values: Array<number | null | undefined>) => {
    const valid = values.filter((value): value is number => Number.isFinite(value));
    return valid.length ? valid.reduce((total, value) => total + value, 0) : null;
  };
  const facts = [
    { label: "运行时间", value: unavailable ? UNAVAILABLE_METRIC_LABEL : formatDuration(system?.uptimeSeconds), className: "workspace-cpu-fact--duration" },
    { label: "物理核心", value: formatCount(sum(cpus.map((cpu) => cpu.coreCount))) },
    { label: "逻辑线程", value: formatCount(sum(cpus.map((cpu) => cpu.logicalCount))) },
    { label: "L3 缓存", value: formatBytes(sum(cpus.map((cpu) => cpu.l3CacheBytes))) },
    { label: "系统线程", value: unavailable ? UNAVAILABLE_METRIC_LABEL : formatCount(system?.threadCount) },
    { label: "进程数", value: unavailable ? UNAVAILABLE_METRIC_LABEL : formatCount(system?.processCount) },
    { label: "句柄数", value: unavailable ? UNAVAILABLE_METRIC_LABEL : formatCount(system?.handleCount) }
  ];
  return (
    <Surface className="workspace-cpu-facts">
      <div className="workspace-cpu-facts__header">
        <div>
          <span className="workspace-section-kicker">任务管理器式摘要</span>
          <h3>处理器与系统统计</h3>
        </div>
        <span className="workspace-caption">{cpus.length ? `${cpus.length} 个 CPU 实例` : "CPU 实例未采集"}</span>
      </div>
      <div className="workspace-cpu-facts__grid">
        {facts.map((fact) => <div className={`workspace-cpu-fact ${fact.className ?? ""}`} key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}
      </div>
    </Surface>
  );
}

function InstanceFilter({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; name: string; detail?: string }>;
}) {
  if (!options.length) return null;
  return (
    <label className="workspace-instance-filter">
      <span>{label}</span>
      <select className="workspace-select workspace-select--small" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">全部实例</option>
        {options.map((option) => <option value={option.id} key={option.id}>{option.name}{option.detail ? ` · ${option.detail}` : ""}</option>)}
      </select>
    </label>
  );
}

function InstanceMetricOverride({
  target,
  instanceId,
  globalMetrics,
  override,
  onChange,
  disabled
}: {
  target: AgentProbeTarget;
  instanceId: string;
  globalMetrics: DeviceMetricKey[];
  override?: DeviceMetricKey[];
  onChange: (value: DeviceMetricKey[] | undefined) => void;
  disabled: boolean;
}) {
  const options = instanceMetricOptions[target];
  if (!options?.length) return null;
  const isOverridden = Array.isArray(override);
  const enabledSet = new Set(override ?? globalMetrics);
  return (
    <details className="workspace-detected-metrics" open={isOverridden}>
      <summary>{isOverridden ? "已单独配置指标" : "跟随全局指标"}</summary>
      <div className="workspace-detected-metrics__body">
        <div className="workspace-detected-metrics__options">
          {options.map((option) => {
            const globallyEnabled = globalMetrics.includes(option.key);
            return <label key={option.key} className={!globallyEnabled ? "is-unavailable" : undefined} title={!globallyEnabled ? "请先在上方启用全局指标" : undefined}>
              <input
                type="checkbox"
                checked={globallyEnabled && enabledSet.has(option.key)}
                disabled={disabled || !globallyEnabled}
                onChange={(event) => {
                  const next = new Set(enabledSet);
                  if (event.target.checked) next.add(option.key);
                  else next.delete(option.key);
                  onChange([...next]);
                }}
              />
              <span>{option.label}</span>
            </label>;
          })}
        </div>
        {isOverridden && <button type="button" className="workspace-detected-metrics__inherit" onClick={() => onChange(undefined)} disabled={disabled}>恢复跟随全局</button>}
      </div>
    </details>
  );
}

function TrafficCalendarCard({
  data,
  mode,
  onModeChange
}: {
  data: TrafficCalendarResponse | null;
  mode: TrafficCalendarMode;
  onModeChange: (mode: TrafficCalendarMode) => void;
}) {
  const modes: Array<{ value: TrafficCalendarMode; label: string }> = [
    { value: "day", label: "日" },
    { value: "week", label: "周" },
    { value: "month", label: "月" }
  ];
  const maxTraffic = Math.max(...(data?.cells ?? []).map((cell) => cell.totalRxBytes + cell.totalTxBytes), 1);
  return (
    <Surface className="workspace-traffic-calendar">
      <div className="workspace-surface__header">
        <div><span className="workspace-section-kicker">流量日历</span><h3>网络流量消耗</h3></div>
        <div className="workspace-range-control__options" role="group" aria-label="流量日历范围">
          {modes.map((item) => <button key={item.value} type="button" className={`workspace-range-option ${mode === item.value ? "is-active" : ""}`} aria-pressed={mode === item.value} onClick={() => onModeChange(item.value)}>{item.label}</button>)}
        </div>
      </div>
      {data ? <>
        <p className="workspace-surface__description">{data.title} · {formatDate(data.rangeStart)} 至 {formatDate(data.rangeEnd)}</p>
        <div className="workspace-traffic-calendar__cells">
          {data.cells.map((cell) => {
            const total = cell.totalRxBytes + cell.totalTxBytes;
            return <div className={`workspace-traffic-calendar__cell${cell.isSelected ? " is-selected" : ""}`} key={cell.key} style={{ opacity: 0.45 + (total / maxTraffic) * 0.55 }}><strong>{cell.label}</strong><small>{formatBytes(total)}</small></div>;
          })}
        </div>
        <div className="workspace-detail-list"><SummaryRow label="接收" value={formatBytes(data.totalRxBytes)} /><SummaryRow label="发送" value={formatBytes(data.totalTxBytes)} /><SummaryRow label="采样记录" value={`${data.records.length} 条`} /></div>
      </> : <div className="workspace-muted-block">暂无流量日历数据；请确认设备已上报网络流量统计。</div>}
    </Surface>
  );
}

type DesktopMetricWindowValue = "5m" | "1h" | "6h" | "24h" | "7d";

const metricWindowOptions: Array<{ value: DesktopMetricWindowValue; label: string }> = [
  { value: "5m", label: "5 分钟" },
  { value: "1h", label: "1 小时" },
  { value: "6h", label: "6 小时" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" }
];

function MetricWindowControl({ value, onChange }: { value: DesktopMetricWindowValue; onChange: (value: DesktopMetricWindowValue) => void }) {
  return (
    <div className="workspace-range-control" role="group" aria-label="遥测时间范围">
      <span className="workspace-range-control__label"><Icon name="clock" size={14} />时间范围</span>
      <div className="workspace-range-control__options">
        {metricWindowOptions.map((option) => (
          <button
            type="button"
            key={option.value}
            className={`workspace-range-option ${value === option.value ? "is-active" : ""}`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type DeviceTabKey = "overview" | "compute" | "storage_net" | "gpu_thermal" | "fan" | "all";

const DEFAULT_DEVICE_PANELS: WidgetPanelMetadata[] = [
  { id: "overview", name: "综合面板", kind: "system", order: 0 },
  { id: "compute", name: "算力与内存", kind: "system", order: 1 },
  { id: "storage_net", name: "存储与网络", kind: "system", order: 2 },
  { id: "gpu_thermal", name: "显卡与散热", kind: "system", order: 3 },
  { id: "fan", name: "风扇转速", kind: "system", order: 4 },
  { id: "all", name: "全景视图", kind: "system", order: 5 }
];

function cloneDevicePanels(panels: WidgetPanelMetadata[]): WidgetPanelMetadata[] {
  return panels.map((panel) => ({ ...panel }));
}

function normalizeDevicePanels(panels: WidgetPanelMetadata[] | undefined): WidgetPanelMetadata[] {
  const systemIds = new Set(DEFAULT_DEVICE_PANELS.map((panel) => panel.id));
  const customPanels = (panels ?? [])
    .filter((panel) => panel.kind === "custom" && !systemIds.has(panel.id))
    .map((panel, index) => ({
      id: panel.id,
      name: panel.name.trim().slice(0, 80) || `自定义面板 ${index + 1}`,
      kind: "custom" as const,
      order: DEFAULT_DEVICE_PANELS.length + index
    }));
  return [...cloneDevicePanels(DEFAULT_DEVICE_PANELS), ...customPanels];
}

function createDynamicLayout(source: WidgetLayoutDocument | undefined): WidgetLayoutDocument {
  if (!source) return { version: 4, placements: {}, catalog: {}, snapToGrid: true };
  const removedSystemIds = new Set(Object.entries(source.catalog).filter(([, entry]) => entry.config?.systemRendered === true && entry.config.deleted === true).map(([id]) => id));
  const catalog = Object.fromEntries(Object.entries(source.catalog)
    .filter(([, entry]) => Boolean(entry.widgetType) && !removedSystemIds.has(entry.groupId ?? ""))
    .map(([id, entry]) => {
      const config = entry.config ? { ...entry.config } : undefined;
      if (config) {
        delete config.systemRendered;
        delete config.deleted;
      }
      return [id, { ...entry, ...(config && Object.keys(config).length ? { config } : {}) }];
    }));
  const placements = Object.fromEntries(Object.entries(source.placements).filter(([id]) => Boolean(catalog[id])).map(([id, placement]) => [id, { ...placement }]));
  return { version: 4, placements, catalog, snapToGrid: source.snapToGrid };
}

function createStarterDynamicLayout(): WidgetLayoutDocument {
  // Instance-backed widgets must be added through the drawer so the user can
  // bind each one to an exact CPU, disk, GPU, fan or network device.
  return { version: 4, placements: {}, catalog: {}, snapToGrid: true };
}

function WidgetPanelBar({
  panels,
  activePanelId,
  editable,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onDelete
}: {
  panels: WidgetPanelMetadata[];
  activePanelId: string;
  editable: boolean;
  onSelect: (panelId: string) => void;
  onCreate: (name: string) => void;
  onRename: (panelId: string, name: string) => void;
  onDuplicate: (panelId: string, layout?: WidgetLayoutDocument) => void;
  onDelete: (panelId: string) => void;
}) {
  const layout = useOptionalWidgetLayout();
  const [manageOpen, setManageOpen] = useState(false);
  const [newPanelName, setNewPanelName] = useState("");
  const managerRef = useRef<HTMLDivElement>(null);
  const [renameTarget, setRenameTarget] = useState<WidgetPanelMetadata | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WidgetPanelMetadata | null>(null);

  useEffect(() => {
    if (!manageOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !managerRef.current?.contains(event.target)) setManageOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setManageOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [manageOpen]);

  const submitNewPanel = (event: FormEvent) => {
    event.preventDefault();
    const name = newPanelName.trim();
    if (!name) return;
    onCreate(name);
    setNewPanelName("");
  };

  return (
    <>
    <div className="workspace-panel-bar">
      <div className="workspace-tabs" role="tablist" aria-label="设备面板">
        {panels.map((panel) => (
          <button className={`workspace-tab ${activePanelId === panel.id ? "is-active" : ""}`} type="button" role="tab" aria-selected={activePanelId === panel.id} onClick={() => onSelect(panel.id)} key={panel.id}>
            {panel.id === "overview" && <Icon name="overview" size={15} />}
            {panel.id === "compute" && <Icon name="device" size={15} />}
            {panel.id === "storage_net" && <Icon name="data" size={15} />}
            {panel.id === "gpu_thermal" && <Icon name="hub" size={15} />}
            {panel.id === "fan" && <Icon name="clock" size={15} />}
            {panel.name}
          </button>
        ))}
      </div>
      <div ref={managerRef} className="workspace-panel-manager">
        <button className={`workspace-layout-actions__button${manageOpen ? " is-active" : ""}`} type="button" onClick={() => setManageOpen((value) => !value)} aria-expanded={manageOpen} disabled={!editable} title={editable ? "管理自定义面板" : "离线缓存下不能修改面板"}>面板管理</button>
        {manageOpen && (
          <div className="workspace-panel-manager__tray">
            <div className="workspace-panel-manager__heading"><strong>我的面板</strong><span>系统面板保留兼容；自定义面板可以重复、重命名或删除。</span></div>
            <form className="workspace-panel-manager__create" onSubmit={submitNewPanel}><input value={newPanelName} onChange={(event) => setNewPanelName(event.target.value)} placeholder="新面板名称" aria-label="新面板名称" maxLength={80} /><button type="submit" disabled={!newPanelName.trim()}>新建</button></form>
            <div className="workspace-panel-manager__list">{panels.map((panel) => <div className="workspace-panel-manager__item" key={panel.id}><span><strong>{panel.name}</strong><small>{panel.kind === "custom" ? "自定义面板" : "系统面板"}</small></span><div>{panel.kind === "custom" && <><button type="button" onClick={() => setRenameTarget(panel)}>重命名</button><button type="button" onClick={() => onDuplicate(panel.id, activePanelId === panel.id ? layout?.getLayoutSnapshot() : undefined)}>复制</button><button type="button" className="is-danger" onClick={() => setDeleteTarget(panel)}>删除</button></>}{panel.kind === "system" && <button type="button" onClick={() => onDuplicate(panel.id, activePanelId === panel.id ? layout?.getLayoutSnapshot() : undefined)}>复制为自定义</button>}</div></div>)}</div>
          </div>
        )}
      </div>
    </div>
    {renameTarget && <PromptDialog title={`重命名“${renameTarget.name}”`} detail="名称只用于当前设备的面板列表，最多 80 个字符。" initialValue={renameTarget.name} onConfirm={(name) => { onRename(renameTarget.id, name); setRenameTarget(null); }} onCancel={() => setRenameTarget(null)} />}
    {deleteTarget && <ConfirmDialog title={`删除“${deleteTarget.name}”？`} detail="删除自定义面板后，其中的小组件布局也会从当前设备的面板列表中移除。" confirmLabel="删除面板" onConfirm={() => { onDelete(deleteTarget.id); setDeleteTarget(null); }} onCancel={() => setDeleteTarget(null)} />}
    </>
  );
}

const temperatureRoleLabels: Record<string, string> = {
  cpu_package: "CPU 封装",
  cpu_core: "CPU 核心",
  gpu_core: "GPU 核心",
  gpu_hotspot: "GPU 热点",
  storage_composite: "磁盘综合温度",
  storage_sensor: "磁盘附加传感器",
  motherboard: "主板温度",
  superio: "SuperIO 温度",
  peci: "PECI 温度",
  acpi_zone: "ACPI 热区",
  threshold: "温度阈值",
  derived: "派生温度",
  unknown: "未知温度源"
};

const temperatureSourceLabels: Record<string, string> = {
  librehardwaremonitor: "LibreHardwareMonitor",
  "linux-hwmon": "Linux hwmon",
  "linux-thermal": "Linux thermal",
  smartctl: "smartctl / SMART",
  "windows-storage-reliability": "Windows 存储可靠性",
  "cpu-package-shared": "CPU Package 共享",
};

function temperatureStatusLabel(status: TemperatureSensorReading["status"]): string {
  if (status === "valid") return "正常";
  if (status === "threshold") return "阈值";
  if (status === "invalid") return "无效值";
  return "不可用";
}

function temperatureSourceLabel(source: string): string {
  return temperatureSourceLabels[source] ?? (source || "未知来源");
}

function temperatureValueLabel(sensor: TemperatureSensorReading): string {
  if (sensor.currentC == null || !Number.isFinite(sensor.currentC)) {
    return sensor.status === "threshold" ? "仅阈值" : "—";
  }
  return `${sensor.currentC.toFixed(1)} °C`;
}

function temperatureLimitsLabel(sensor: TemperatureSensorReading): string {
  const limits = [
    sensor.highC != null ? `高 ${sensor.highC.toFixed(1)}°C` : "",
    sensor.criticalC != null ? `临界 ${sensor.criticalC.toFixed(1)}°C` : "",
    sensor.emergencyC != null ? `紧急 ${sensor.emergencyC.toFixed(1)}°C` : ""
  ].filter(Boolean);
  return limits.join(" · ");
}

function TemperatureSourcesPanel({
  sensors,
  series
}: {
  sensors: TemperatureSensorReading[];
  series: TemperatureMetricSeries[];
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const visibleSensors = useMemo(
    () => sensors.filter((sensor) => showDiagnostics || sensor.status === "valid"),
    [sensors, showDiagnostics]
  );
  const chartableSeries = useMemo(
    () => series.filter((sensor) => sensor.currentC.length > 0 && (showDiagnostics || sensor.status === "valid")),
    [series, showDiagnostics]
  );
  const selectedSeries = chartableSeries.find((sensor) => sensor.id === selectedId) ?? chartableSeries[0];

  useEffect(() => {
    if (!selectedSeries || selectedSeries.id === selectedId) return;
    setSelectedId(selectedSeries.id);
  }, [selectedId, selectedSeries]);

  if (!sensors.length && !series.length) return null;

  return (
    <DesktopWidget id="temperature-sources" title="温度源" kind="group" defaultSize="large">
      <Surface className="workspace-temperature-sources">
        <div className="workspace-surface__header">
          <div>
            <span className="workspace-section-kicker">温度源</span>
            <h3>全部温度传感器</h3>
          </div>
          <label className="workspace-temperature-toggle">
            <input type="checkbox" checked={showDiagnostics} onChange={(event) => setShowDiagnostics(event.target.checked)} />
            <span>显示诊断通道</span>
          </label>
        </div>
        <p className="workspace-surface__description">按传感器原始名称和采集后端展示；不同来源不会合并平均，阈值和无效值默认隐藏。</p>
        <div className="workspace-temperature-sources__body">
          <div className="workspace-temperature-source-list">
            {visibleSensors.length ? visibleSensors.map((sensor) => {
              const isSelected = sensor.id === selectedSeries?.id;
              return (
                <button
                  type="button"
                  key={sensor.id}
                  className={`workspace-temperature-source-row${isSelected ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(sensor.id)}
                >
                  <span className="workspace-temperature-source-row__identity">
                    <strong>{sensor.displayName || sensor.rawName}</strong>
                    <small>{temperatureRoleLabels[sensor.role] ?? sensor.role} · {temperatureSourceLabel(sensor.source)}</small>
                  </span>
                  <span className="workspace-temperature-source-row__value">
                    <strong>{temperatureValueLabel(sensor)}</strong>
                    <small className={`workspace-temperature-status workspace-temperature-status--${sensor.status}`}>{temperatureStatusLabel(sensor.status)}</small>
                    {temperatureLimitsLabel(sensor) && <small>{temperatureLimitsLabel(sensor)}</small>}
                  </span>
                </button>
              );
            }) : <div className="workspace-telemetry-empty">当前只有无效或诊断温度通道</div>}
          </div>
          <div className="workspace-temperature-source-chart">
            {selectedSeries ? (
              <TelemetryChartCard
                title={`${selectedSeries.name} · 历史`}
                subtitle={`${temperatureRoleLabels[selectedSeries.role] ?? selectedSeries.role} · ${temperatureSourceLabel(selectedSeries.source)}`}
                series={[{ label: "温度", points: selectedSeries.currentC, valueFormatter: (value) => `${value.toFixed(1)} °C` }]}
                valueFormatter={(value) => `${value.toFixed(1)} °C`}
                emptyMessage="等待有效温度样本"
              />
            ) : <div className="workspace-trend-empty">选择一个有效温度源查看历史</div>}
          </div>
        </div>
      </Surface>
    </DesktopWidget>
  );
}

function AgentTemperatureSourcesPanel({
  sensors,
  backends,
  probeError
}: {
  sensors: TemperatureSensorReading[];
  backends: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
  probeError?: string;
}) {
  return (
    <Surface className="workspace-agent-temperature-sources">
      <div className="workspace-surface__header">
        <div>
          <span className="workspace-section-kicker">温度探测</span>
          <h3>已发现温度源</h3>
        </div>
        <span className="workspace-caption">{sensors.length} 个源</span>
      </div>
      <p className="workspace-surface__description">这里展示本机探测到的全部温度源，不按 CPU/GPU 平均合并。有效值、阈值、无效值和核显共享 CPU Package 的来源都会保留。</p>
      <div className="workspace-agent-temperature-sources__body">
        {sensors.length ? (
          <div className="workspace-temperature-source-list">
            {sensors.map((sensor) => (
              <div className="workspace-temperature-source-row" key={sensor.id}>
                <span className="workspace-temperature-source-row__identity">
                  <strong>{sensor.displayName || sensor.rawName}</strong>
                  <small>{temperatureRoleLabels[sensor.role] ?? sensor.role} · {temperatureSourceLabel(sensor.source)}{sensor.backend ? ` · ${sensor.backend}` : ""}</small>
                  {sensor.path && <small>{sensor.path}</small>}
                </span>
                <span className="workspace-temperature-source-row__value">
                  <strong>{temperatureValueLabel(sensor)}</strong>
                  <small className={`workspace-temperature-status workspace-temperature-status--${sensor.status}`}>{temperatureStatusLabel(sensor.status)}</small>
                  {temperatureLimitsLabel(sensor) && <small>{temperatureLimitsLabel(sensor)}</small>}
                </span>
              </div>
            ))}
          </div>
        ) : <div className="workspace-muted-block">{probeError ? `温度探测失败：${probeError}` : "尚未返回温度源，请点击上方“重新检测硬件”。"}</div>}
        {backends.length ? (
          <div className="workspace-agent-temperature-backends">
            <strong>探测后端</strong>
            {backends.map((backend) => (
              <div className="workspace-agent-temperature-backend" key={backend.id}>
                <span className={backend.ok ? "is-enabled" : "is-disabled"}>{backend.ok ? "可用" : "不可用"}</span>
                <div><strong>{backend.label}</strong>{backend.detail && <small>{backend.detail}</small>}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Surface>
  );
}

function DevicePage() {
  const { selectedDevice, snapshot, navigate, openSettings, metricsWindow, setMetricsWindow, trafficMode, setTrafficMode, getWidgetLayout, saveWidgetLayout, orientation, capabilities } = useWorkspace();
  const canEditRemote = snapshot?.source === "live" && Boolean(snapshot.session.authenticated);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [panels, setPanels] = useState<WidgetPanelMetadata[]>(cloneDevicePanels(DEFAULT_DEVICE_PANELS));
  const [panelIndexLoading, setPanelIndexLoading] = useState(false);
  const [panelMutationMessage, setPanelMutationMessage] = useState("");
  const panelMutationQueue = useRef(Promise.resolve());
  const [widgetDrawerOpen, setWidgetDrawerOpen] = useState(false);
  const [displayMode, setDisplayModeState] = useState<WidgetDisplayMode>("normal");
  const displayModeStorageKey = selectedDevice ? `dsc-widget-display-mode:${selectedDevice.deviceId}:${activeTab}` : "";
  const boardRootRef = useRef<HTMLDivElement>(null);
  const boardFullscreenRef = useRef(false);
  const previousDisplayModeRef = useRef<Exclude<WidgetDisplayMode, "board">>("normal");

  const enterBoardPresentation = useCallback(() => {
    previousDisplayModeRef.current = displayMode === "minimal" ? "minimal" : "normal";
    setWidgetDrawerOpen(false);
    setDisplayModeState("board");
    const root = boardRootRef.current;
    if (!root?.requestFullscreen) return;
    void root.requestFullscreen().then(() => {
      boardFullscreenRef.current = true;
    }).catch(() => {
      // The fixed-position CSS presentation remains available when the host
      // denies the browser Fullscreen API (for example in an embedded shell).
    });
  }, [displayMode]);

  const exitBoardPresentation = useCallback(async () => {
    if (typeof document !== "undefined" && document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        // Keep the view usable when the host has already left fullscreen.
      }
    }
    boardFullscreenRef.current = false;
    setDisplayModeState(previousDisplayModeRef.current);
  }, []);

  const handleDisplayModeChange = useCallback((mode: WidgetDisplayMode) => {
    if (mode === "board") {
      enterBoardPresentation();
      return;
    }
    setDisplayModeState(mode);
    if (displayModeStorageKey && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(displayModeStorageKey, mode);
      } catch {
        // Local display preferences are optional and must not block the panel.
      }
    }
  }, [displayModeStorageKey, enterBoardPresentation]);

  useEffect(() => {
    if (!displayModeStorageKey || typeof window === "undefined") return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(displayModeStorageKey);
    } catch {
      stored = null;
    }
    const nextMode: Exclude<WidgetDisplayMode, "board"> = stored === "minimal" ? "minimal" : "normal";
    previousDisplayModeRef.current = nextMode;
    setDisplayModeState(nextMode);
  }, [displayModeStorageKey]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (boardFullscreenRef.current && !document.fullscreenElement) {
        boardFullscreenRef.current = false;
        setDisplayModeState(previousDisplayModeRef.current);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (displayMode !== "board") return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void exitBoardPresentation();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [displayMode, exitBoardPresentation]);

  const [activeAnchor, setActiveAnchor] = useState("section-overview");
  const anchorDefinitions = useMemo(() => [
    { id: "section-overview", label: "综合概览", tabs: ["overview", "all"] },
    { id: "section-compute", label: "算力与内存", tabs: ["compute", "all"] },
    { id: "section-storage", label: "存储与网络", tabs: ["storage_net", "all"] },
    { id: "section-gpu", label: "显卡与散热", tabs: ["gpu_thermal", "all"] },
    { id: "section-fan", label: "风扇转速", tabs: ["fan", "all"] },
    { id: "section-info", label: "硬件信息", tabs: ["overview", "all"] }
  ], []);
  const availableAnchors = useMemo(
    () => anchorDefinitions.filter((anchor) => anchor.tabs.includes(activeTab)),
    [activeTab, anchorDefinitions]
  );

  const scrollToAnchor = (anchorId: string) => {
    const target = document.getElementById(anchorId);
    if (target) {
      setActiveAnchor(anchorId);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  useEffect(() => {
    setActiveAnchor(availableAnchors[0]?.id ?? "");
    const root = document.getElementById("workspace-main-content");
    const targets = availableAnchors
      .map((anchor) => document.getElementById(anchor.id))
      .filter((target): target is HTMLElement => Boolean(target));
    if (!root || !targets.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (visible?.target instanceof HTMLElement) setActiveAnchor(visible.target.id);
    }, { root, rootMargin: "-72px 0px -55% 0px", threshold: [0, 0.12] });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [availableAnchors]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedDevice) {
      setPanels(cloneDevicePanels(DEFAULT_DEVICE_PANELS));
      setActiveTab("overview");
      return () => { cancelled = true; };
    }
    const deviceId = selectedDevice.deviceId;
    const instanceType = selectedDevice.instanceType ?? "device";
    setPanelIndexLoading(true);
    setPanelMutationMessage("");
    setActiveTab("overview");
    void getWidgetLayout({ scopeKey: `device:${deviceId}:panel-index`, templateKey: `device-type:${instanceType}:panel-index` }).then((remote) => {
      if (cancelled) return;
      setPanels(normalizeDevicePanels(remote.instanceLayout?.panels));
    }).catch(() => {
      if (!cancelled) setPanels(cloneDevicePanels(DEFAULT_DEVICE_PANELS));
    }).finally(() => {
      if (!cancelled) setPanelIndexLoading(false);
    });
    return () => { cancelled = true; };
  }, [getWidgetLayout, selectedDevice?.deviceId, selectedDevice?.instanceType]);

  const changeTab = (tab: string) => {
    if (tab === activeTab) return;
    if (!confirmDiscardWidgetLayoutDraft()) return;
    if (displayMode === "board") void exitBoardPresentation();
    setActiveTab(tab);
  };

  // 多实例单选中状态
  const [selectedNetId, setSelectedNetId] = useState<string>("all");
  const [selectedDiskId, setSelectedDiskId] = useState<string>("all");
  const [selectedGpuId, setSelectedGpuId] = useState<string>("all");

  useEffect(() => {
    setSelectedNetId("all");
    setSelectedDiskId("all");
    setSelectedGpuId("all");
  }, [selectedDevice?.deviceId]);

  const previousDeviceIdRef = useRef<string | null>(null);
  useEffect(() => {
    const nextDeviceId = selectedDevice?.deviceId ?? null;
    if (previousDeviceIdRef.current !== null && previousDeviceIdRef.current !== nextDeviceId && displayMode === "board") {
      void exitBoardPresentation();
    }
    previousDeviceIdRef.current = nextDeviceId;
  }, [displayMode, exitBoardPresentation, selectedDevice?.deviceId]);

  if (!selectedDevice) return <EmptyState title="没有找到这台设备" detail="设备可能已被移除，或者中枢还没有返回它。" action={<Button variant="primary" onClick={() => navigate({ kind: "overview" })}>返回总览</Button>} />;

  const activePanel = panels.find((panel) => panel.id === activeTab) ?? DEFAULT_DEVICE_PANELS[0];
  const isCustomPanel = activePanel.kind === "custom";
  const panelIndexScope = `device:${selectedDevice.deviceId}:panel-index`;
  const panelIndexTemplate = `device-type:${selectedDevice.instanceType ?? "device"}:panel-index`;
  const customPanelScope = (panelId: string) => `device:${selectedDevice.deviceId}:panel:${panelId}`;
  const customPanelTemplate = `device-type:${selectedDevice.instanceType ?? "device"}:panel`;
  type LinkedWidgetLayout = NonNullable<WidgetLayoutSaveRequest["linkedInstance"]>;
  const savePanelIndex = (nextPanels: WidgetPanelMetadata[], linkedInstance?: LinkedWidgetLayout): Promise<boolean> => {
    if (!canEditRemote) return Promise.resolve(false);
    const mutation = panelMutationQueue.current.then(async () => {
      await saveWidgetLayout({
        scopeKey: panelIndexScope,
        templateKey: panelIndexTemplate,
        instanceLayout: { version: 4, placements: {}, catalog: {}, snapToGrid: true, panels: nextPanels },
        ...(linkedInstance ? { linkedInstance } : {})
      });
      setPanels(nextPanels);
      setPanelMutationMessage("");
      return true;
    }).catch((error) => {
      setPanelMutationMessage(error instanceof Error ? `面板保存失败：${error.message}` : "面板保存失败");
      return false;
    });
    panelMutationQueue.current = mutation.then(() => undefined, () => undefined);
    return mutation;
  };
  const createPanel = (name: string) => {
    if (!canEditRemote) return;
    if (!confirmDiscardWidgetLayoutDraft()) return;
    const id = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nextPanels = [...panels, { id, name: name.trim().slice(0, 80), kind: "custom" as const, order: panels.length }];
    void savePanelIndex(nextPanels, {
      scopeKey: customPanelScope(id),
      templateKey: customPanelTemplate,
      instanceLayout: createStarterDynamicLayout()
    }).then((saved) => {
      if (saved) setActiveTab(id);
    });
  };
  const renamePanel = (panelId: string, name: string) => {
    if (!canEditRemote) return;
    const nextPanels = panels.map((panel) => panel.id === panelId && panel.kind === "custom" ? { ...panel, name: name.trim().slice(0, 80) } : panel);
    void savePanelIndex(nextPanels);
  };
  const duplicatePanel = (sourceId: string, sourceLayout?: WidgetLayoutDocument) => {
    if (!canEditRemote) return;
    if (!confirmDiscardWidgetLayoutDraft()) return;
    const source = panels.find((panel) => panel.id === sourceId);
    if (!source) return;
    const id = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nextPanels = [...panels, { id, name: `${source.name} 副本`.slice(0, 80), kind: "custom" as const, order: panels.length }];
    const sourceScope = source.kind === "custom" ? customPanelScope(source.id) : `device:${selectedDevice.deviceId}:${source.id}`;
    const sourceTemplate = source.kind === "custom" ? customPanelTemplate : `device-type:${selectedDevice.instanceType ?? "device"}:tab:${source.id}`;
    void (async () => {
      try {
        const sourceRemote = sourceLayout ? null : await getWidgetLayout({ scopeKey: sourceScope, templateKey: sourceTemplate });
        const layout = sourceLayout ?? sourceRemote?.instanceLayout ?? undefined;
        const saved = await savePanelIndex(nextPanels, {
          scopeKey: customPanelScope(id),
          templateKey: customPanelTemplate,
          instanceLayout: createDynamicLayout(layout)
        });
        if (saved) setActiveTab(id);
      } catch (error) {
        setPanelMutationMessage(error instanceof Error ? `面板复制失败：${error.message}` : "面板复制失败");
      }
    })();
  };
  const deletePanel = (panelId: string) => {
    if (!canEditRemote) return;
    const panel = panels.find((item) => item.id === panelId);
    if (!panel || panel.kind !== "custom") return;
    const nextPanels = panels.filter((item) => item.id !== panelId);
    void savePanelIndex(nextPanels, {
      scopeKey: customPanelScope(panelId),
      templateKey: customPanelTemplate,
      instanceLayout: null
    }).then((saved) => {
      if (saved && activeTab === panelId) setActiveTab("overview");
    });
  };

  const metrics = snapshot?.metrics?.device.deviceId === selectedDevice.deviceId ? snapshot.metrics : null;
  const localTemperatureSources = snapshot?.localBackend
    && (snapshot.localBackend.config.connection.deviceId === selectedDevice.deviceId || snapshot.localBackend.config.connection.hostname === selectedDevice.hostname)
    ? snapshot.localBackend.temperatureSources
    : [];
  const localTemperatureSourcesAt = snapshot?.localBackend?.lastDetectAt ?? null;
  const latest = metrics?.latest;
  const series = metrics?.series;
  const metricUnavailable = (key: DeviceMetricKey) => isMetricUnavailable(selectedDevice, key, latest);
  const enabledDeviceIds = metrics?.enabledDeviceIds;
  const hasInstanceConfiguration = (block: DeviceBlockKey) => Array.isArray(enabledDeviceIds?.[block]);
  const filterEnabledInstances = <T extends { id: string }>(block: DeviceBlockKey, instances: T[]) => {
    const configuredIds = enabledDeviceIds?.[block];
    return configuredIds ? instances.filter((instance) => configuredIds.includes(instance.id)) : instances;
  };
  const filteredDiskDetails = latest ? filterEnabledInstances("disk", latest.disks ?? []) : [];
  const filteredGpuDetails = latest ? filterEnabledInstances("gpu", latest.gpus ?? []) : [];
  const filteredLatest = latest
    ? {
        ...latest,
        cpuPackages: filterEnabledInstances("cpu", latest.cpuPackages ?? []),
        disks: filteredDiskDetails,
        networkInterfaces: filterEnabledInstances("network", latest.networkInterfaces ?? []),
        gpus: filteredGpuDetails,
        fans: filterEnabledInstances("fan", latest.fans ?? []),
        diskUsedBytes: filteredDiskDetails.length || hasInstanceConfiguration("disk") ? filteredDiskDetails.reduce((total, disk) => total + disk.usedBytes, 0) : latest.diskUsedBytes,
        diskTotalBytes: filteredDiskDetails.length || hasInstanceConfiguration("disk") ? filteredDiskDetails.reduce((total, disk) => total + disk.totalBytes, 0) : latest.diskTotalBytes
      }
    : undefined;
  const currentStoragePools = latest?.storagePools?.filter(isDisplayableVirtualizationStorage) ?? [];
  const storagePoolDetails: VirtualizationStorageTelemetry[] = latest
    ? currentStoragePools.length
      ? currentStoragePools
      : virtualizationStorageInstances(latest.virtualization)
    : [];
  const storagePoolSeries = series?.storagePools?.filter(isDisplayableVirtualizationStorageSeries) ?? [];
  const storagePoolDisplaySeries: VirtualizationStorageMetricSeries[] = [
    ...storagePoolSeries,
    ...storagePoolDetails
      .filter((pool) => !storagePoolSeries.some((seriesPool) => seriesPool.id === pool.id))
      .map((pool) => ({
        id: pool.id,
        name: pool.name,
        node: pool.node,
        type: pool.type,
        active: pool.active,
        shared: pool.shared,
        totalBytes: [],
        usedBytes: [],
        availableBytes: [],
        usagePercent: []
      }))
  ];

  const cpuInstances = filterEnabledInstances("cpu", series?.cpus ?? []);
  const diskInstances = filterEnabledInstances("disk", series?.disks ?? []);
  const networkInstances = filterEnabledInstances("network", series?.networks ?? []);
  const gpuInstances = filterEnabledInstances("gpu", series?.gpus ?? []);
  const latestFanInstances = latest ? filterEnabledInstances("fan", latest.fans ?? []) : [];
  const fanInstances = mergeFanMetricSeries(
    latestFanInstances,
    filterEnabledInstances("fan", series?.fans ?? []),
    snapshot?.generatedAt ?? metrics?.lastSeenAt ?? selectedDevice.lastSeenAt ?? new Date().toISOString()
  );
  const visibleDiskInstances = selectedDiskId === "all" ? diskInstances : diskInstances.filter((disk) => disk.id === selectedDiskId);
  const visibleNetworkInstances = selectedNetId === "all" ? networkInstances : networkInstances.filter((network) => network.id === selectedNetId);
  const visibleGpuInstances = selectedGpuId === "all" ? gpuInstances : gpuInstances.filter((gpu) => gpu.id === selectedGpuId);
  const diskOptions = diskInstances.map((disk) => ({ id: disk.id, name: displayModelName(disk.model, disk.name, "磁盘"), detail: disk.mountPoint }));
  const networkOptions = networkInstances.map((network) => ({ id: network.id, name: displayModelName(network.model, network.name, "网卡") }));
  const gpuOptions = gpuInstances.map((gpu) => ({ id: gpu.id, name: gpu.name }));
  const cpuAverageUsage = metricUnavailable("cpuUsage") ? [] : averageSamplePointsOrFallback(cpuInstances.map((cpu) => cpu.usagePercent), hasInstanceConfiguration("cpu") ? [] : series?.cpuUsagePercent ?? []);
  const diskTotalUsedBytes = diskInstances.length
    ? metricUnavailable("diskUsage") ? [] : sumSamplePoints(diskInstances.map((disk) => disk.usedBytes))
    : metricUnavailable("diskUsage") ? [] : hasInstanceConfiguration("disk") ? [] : series?.diskUsedBytes ?? [];
  const networkAverageRx = metricUnavailable("networkRxRate") ? [] : averageSamplePointsOrFallback(networkInstances.map((network) => network.rxBytesPerSec), hasInstanceConfiguration("network") ? [] : series?.networkRxBytesPerSec ?? []);
  const networkAverageTx = metricUnavailable("networkTxRate") ? [] : averageSamplePointsOrFallback(networkInstances.map((network) => network.txBytesPerSec), hasInstanceConfiguration("network") ? [] : series?.networkTxBytesPerSec ?? []);
  const gpuAverageUsage = averageSamplePointsOrFallback(gpuInstances.map((gpu) => gpu.usagePercent), hasInstanceConfiguration("gpu") ? [] : series?.gpuUsagePercent ?? []);
  const gpuAverageEncode = averageSamplePointsOrFallback(gpuInstances.map((gpu) => gpu.encodePercent), hasInstanceConfiguration("gpu") ? [] : series?.gpuEncodePercent ?? []);
  const gpuAverageDecode = averageSamplePointsOrFallback(gpuInstances.map((gpu) => gpu.decodePercent), hasInstanceConfiguration("gpu") ? [] : series?.gpuDecodePercent ?? []);
  const gpuTotalMemoryUsedBytes = gpuInstances.length
    ? sumSamplePoints(gpuInstances.map((gpu) => gpu.memoryUsedBytes))
    : hasInstanceConfiguration("gpu") ? [] : series?.gpuMemoryUsedBytes ?? [];
  const gpuMemorySummary = filteredLatest ? formatGpuMemorySummary(filteredLatest.gpus) : "容量暂无";
  const commitLimitBytes = filteredLatest
    ? filteredLatest.memoryCommitLimitBytes || filteredLatest.memoryTotalBytes + filteredLatest.swapTotalBytes
    : 0;
  const committedMemorySummary = filteredLatest
    ? formatCapacitySummary(filteredLatest.memoryCommittedBytes, commitLimitBytes, metricUnavailable("memoryCommitted"))
    : "容量暂无";
  const pagefileMemorySummary = filteredLatest
    ? formatCapacitySummary(filteredLatest.swapUsedBytes, filteredLatest.swapTotalBytes, metricUnavailable("swapUsage"))
    : "容量暂无";
  const cpuModelItems = cpuInstances.map((cpu) => ({
    id: cpu.id,
    name: `${cpu.socketIndex != null ? `Socket ${cpu.socketIndex}` : cpu.id} · ${displayModelName(cpu.model, cpu.name, "CPU")}`,
    detail: [cpu.coreCount ? `${cpu.coreCount} 核` : "", cpu.logicalCount ? `${cpu.logicalCount} 线程` : "", cpu.l3CacheBytes ? `L3 ${formatBytes(cpu.l3CacheBytes)}` : ""].filter(Boolean).join(" · ")
  }));
  const diskModelItems = diskInstances.map((disk) => ({
    id: disk.id,
    name: displayModelName(disk.model, disk.name, "磁盘"),
    detail: [disk.mountPoint, disk.filesystem].filter(Boolean).join(" · ")
  }));
  const networkModelItems = networkInstances.map((network) => ({
    id: network.id,
    name: displayModelName(network.model, network.name, "网卡"),
    detail: [network.name, network.macAddress || network.ipv4?.[0] || network.ipv6?.[0]].filter(Boolean).join(" · ")
  }));
  const gpuModelItems = gpuInstances.map((gpu) => ({
    id: gpu.id,
    name: displayInstanceName(gpu.name, "GPU")
  }));

  const renderStoragePoolBlocks = () => storagePoolDisplaySeries.map((pool, poolIndex) => {
    const poolLatest = storagePoolDetails.find((item) => item.id === pool.id);
    const totalBytes = poolLatest?.totalBytes ?? latestSampleValue(pool.totalBytes);
    const usedBytes = poolLatest?.usedBytes ?? latestSampleValue(pool.usedBytes);
    const availableBytes = poolLatest?.availableBytes ?? latestSampleValue(pool.availableBytes);
    const usagePercent = totalBytes != null && totalBytes > 0 && usedBytes != null
      ? Number(((usedBytes / totalBytes) * 100).toFixed(2))
      : latestSampleValue(pool.usagePercent);
    const poolName = poolLatest?.name ?? pool.name;
    const poolNode = poolLatest?.node ?? pool.node;
    const poolType = poolLatest?.type ?? pool.type;
    const poolActive = poolLatest?.active ?? pool.active;
    const poolShared = poolLatest?.shared ?? pool.shared;
    const poolLabel = [
      poolNode ? `节点 ${poolNode}` : null,
      formatVirtualizationStorageType(poolType),
      poolShared == null ? null : poolShared ? "共享" : "本地",
      poolActive == null ? null : poolActive ? "启用" : "停用"
    ].filter(Boolean).join(" · ");
    return (
      <TelemetryDeviceBlock
        key={`storage-pool-${pool.id}`}
        kind="disk"
        widgetId={`storage-pool-device-${pool.id}`}
        widgetTemplateId={`storage-pool-device-${poolIndex}`}
        targetId={pool.id}
        eyebrow="虚拟化存储池"
        title={poolName}
        subtitle={poolLabel || "Proxmox 存储池"}
      >
        <TelemetryInfoCard
          widgetId={`storage-pool-${pool.id}-summary`}
          widgetGroupId={`storage-pool-device-${pool.id}`}
          widgetType="virtualization-storage-pool-summary"
          widgetCategory="存储"
          widgetConfig={{ systemRendered: true, targetId: pool.id, visualization: "table" }}
          title={`${poolName} · 当前状态`}
          rows={[
            { label: "节点", value: poolNode ?? UNAVAILABLE_METRIC_LABEL },
            { label: "类型", value: formatVirtualizationStorageType(poolType) },
            { label: "容量", value: formatVirtualizationStorageCapacity(usedBytes, totalBytes) },
            { label: "可用空间", value: formatVirtualizationStorageValue(availableBytes) },
            { label: "使用率", value: formatVirtualizationStoragePercent(usagePercent) },
            { label: "读写速率", value: "无法获取数据 · Proxmox 存储池接口未提供" }
          ]}
        />
        <TelemetryChartCard
          widgetId={`storage-pool-${pool.id}-capacity`}
          widgetGroupId={`storage-pool-device-${pool.id}`}
          widgetType="virtualization-storage-pool-capacity"
          widgetCategory="存储"
          widgetVisualization="area"
          widgetConfig={{ systemRendered: true, targetId: pool.id, visualization: "area" }}
          title={`${poolName} · 已用与可用空间`}
          subtitle={formatVirtualizationStorageCapacity(usedBytes, totalBytes)}
          emptyMessage={UNAVAILABLE_METRIC_LABEL}
          series={[
            { label: "已用空间", points: pool.usedBytes, valueFormatter: formatBytes },
            { label: "可用空间", points: pool.availableBytes, valueFormatter: formatBytes }
          ]}
          valueFormatter={formatBytes}
        />
        <TelemetryChartCard
          widgetId={`storage-pool-${pool.id}-usage`}
          widgetGroupId={`storage-pool-device-${pool.id}`}
          widgetType="virtualization-storage-pool-usage"
          widgetCategory="存储"
          widgetVisualization="line"
          widgetConfig={{ systemRendered: true, targetId: pool.id, visualization: "line" }}
          title={`${poolName} · 使用率`}
          subtitle={formatVirtualizationStoragePercent(usagePercent)}
          emptyMessage={UNAVAILABLE_METRIC_LABEL}
          series={[{ label: "使用率", points: pool.usagePercent }]}
          valueFormatter={(value) => `${value.toFixed(2)}%`}
          fixedMaxValue={100}
        />
      </TelemetryDeviceBlock>
    );
  });

  return (
    <div
      ref={boardRootRef}
      className={`workspace-page workspace-page--device workspace-page--display-${displayMode}`}
      data-widget-display-mode={displayMode}
    >
      {displayMode === "board" && <button className="workspace-board-exit" type="button" onClick={() => void exitBoardPresentation()} aria-label="退出展板模式">退出展板</button>}
      <PageIntro
        eyebrow={selectedDevice.instanceType === "virtual_machine" ? "虚拟机实例" : "设备实例"}
        title={selectedDevice.hostname}
        description={`${selectedDevice.instanceType === "virtual_machine" ? "虚拟机" : selectedDevice.os} · ${selectedDevice.deviceId} · 最后心跳 ${formatDate(selectedDevice.lastSeenAt)}`}
        actions={
          <>
            <Button variant="quiet" onClick={() => navigate({ kind: "overview" })}><Icon name="back" size={16} />返回总览</Button>
          </>
        }
      />

      <div className="workspace-device-statusline">
        {selectedDevice.instanceType === "virtual_machine" ? <VirtualMachinePowerLabel powerState={selectedDevice.virtualMachine?.powerState} /> : <StatusLabel state={selectedDevice.status === "online" ? "online" : "offline"} />}
        <span>Agent {selectedDevice.agentVersion ? `v${selectedDevice.agentVersion}` : "版本未知"}</span>
        <span>通道 {selectedDevice.agentChannel ?? "未知"}</span>
        {selectedDevice.instanceType === "virtual_machine" && <span>宿主机 Agent {selectedDevice.status === "online" ? "在线" : "离线"} · {selectedDevice.hostName ?? "未知"}</span>}
        <span>{snapshot?.source === "cache" ? `缓存于 ${formatDate(snapshot.cache.savedAt)}` : `数据更新时间 ${formatDate(snapshot?.generatedAt)}`}</span>
      </div>



      <WidgetLayoutProvider
        key={activeTab}
        scopeKey={isCustomPanel ? customPanelScope(activeTab) : `device:${selectedDevice.deviceId}:${activeTab}`}
        templateKey={isCustomPanel ? customPanelTemplate : `device-type:${selectedDevice.instanceType ?? "device"}:tab:${activeTab}`}
        editable={activeTab !== "all" && snapshot?.source === "live" && Boolean(snapshot.session.authenticated)}
        locked={activeTab === "all"}
        displayMode={displayMode}
        onDisplayModeChange={handleDisplayModeChange}
        getWidgetLayout={getWidgetLayout}
        saveWidgetLayout={saveWidgetLayout}
      >
      {/* 视图 Tab 切换与时间范围控制器 */}
      <div className="telemetry-chart-header">
        <WidgetPanelBar panels={panels} activePanelId={activeTab} editable={canEditRemote} onSelect={changeTab} onCreate={createPanel} onRename={renamePanel} onDuplicate={duplicatePanel} onDelete={deletePanel} />

        <div className="workspace-device-toolbar">
          {panelIndexLoading && <span className="workspace-layout-notice">读取面板</span>}
          {panelMutationMessage && <span className="workspace-layout-notice">{panelMutationMessage}</span>}
          <MetricWindowControl value={metricsWindow as DesktopMetricWindowValue} onChange={(value) => setMetricsWindow(value)} />
          <WidgetLayoutToolbar
            onOpenWidgetDrawer={activeTab !== "all" && canEditRemote ? () => setWidgetDrawerOpen(true) : undefined}
            onEnterBoardMode={enterBoardPresentation}
            onExitBoardMode={exitBoardPresentation}
          />
        </div>
      </div>

      {availableAnchors.length > 1 && (activeTab === "all" || orientation === "portrait") && (
        <div className="workspace-anchor-bar" role="navigation" aria-label="硬件模块跳转">
          {availableAnchors.map((anchor) => (
            <button key={anchor.id} type="button" className={`workspace-anchor-btn${activeAnchor === anchor.id ? " is-active" : ""}`} aria-current={activeAnchor === anchor.id ? "page" : undefined} onClick={() => scrollToAnchor(anchor.id)}>{anchor.label}</button>
          ))}
        </div>
      )}

      {/* ================= Tab 1: 综合面板 (Overview) ================= */}
      {(activeTab === "overview" || activeTab === "all") && series && (
        <TelemetrySection id="section-overview" eyebrow="综合遥测" title="硬件平均趋势" description="综合面板按类别平均所有已采集实例；各硬件型号显示在对应图表底部，单独图表请切换到明细选项卡。">
          <TelemetryChartCard widgetId="overview-cpu-average" title="CPU 平均使用率" subtitle={`全部 ${cpuInstances.length} 个 CPU 实例的平均值`} series={[{ label: "全部 CPU 平均", points: cpuAverageUsage }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} footer={<TelemetryModelList label="已采集 CPU 型号" items={cpuModelItems} />} />
          <TelemetryChartCard widgetId="overview-memory" title="物理与已提交内存" subtitle={`物理 ${formatCapacitySummary(filteredLatest?.memoryUsedBytes, filteredLatest?.memoryTotalBytes, metricUnavailable("memoryUsage"))} · 已提交 ${committedMemorySummary} · 页面文件 ${pagefileMemorySummary}`} series={[{ label: "已用物理内存", points: unavailablePoints(series.memoryUsedBytes ?? [], metricUnavailable("memoryUsage")), valueFormatter: formatBytes }, { label: "已提交", points: unavailablePoints(series.memoryCommittedBytes ?? [], metricUnavailable("memoryCommitted")), valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
          <TelemetryChartCard widgetId="overview-disk-total" title="磁盘总已用容量" subtitle={`全部 ${diskInstances.length} 个硬盘实例的总量 · ${formatCapacitySummary(filteredLatest?.diskUsedBytes, filteredLatest?.diskTotalBytes, metricUnavailable("diskUsage"))}`} series={[{ label: "全部硬盘总已用", points: diskTotalUsedBytes, valueFormatter: formatBytes }]} valueFormatter={formatBytes} footer={<TelemetryModelList label="已采集硬盘型号" items={diskModelItems} />} />
          <TelemetryChartCard widgetId="overview-network-average" title="网卡平均吞吐" subtitle={metricUnavailable("networkRxRate") || metricUnavailable("networkTxRate") ? UNAVAILABLE_METRIC_LABEL : `全部 ${networkInstances.length} 个网卡实例的平均值`} series={[{ label: "平均接收 (Rx)", points: networkAverageRx, valueFormatter: (v) => `${formatBytes(v)}/s` }, { label: "平均发送 (Tx)", points: networkAverageTx, valueFormatter: (v) => `${formatBytes(v)}/s` }]} valueFormatter={(v) => `${formatBytes(v)}/s`} footer={<TelemetryModelList label="已采集网卡型号" items={networkModelItems} />} />
          <TelemetryChartCard widgetId="overview-gpu-average" title="GPU 平均使用率" subtitle={`全部 ${gpuInstances.length} 个显卡实例的平均值`} series={[{ label: "平均核心", points: gpuAverageUsage }, { label: "平均编码", points: gpuAverageEncode }, { label: "平均解码", points: gpuAverageDecode }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} footer={<TelemetryModelList label="已采集显卡型号" items={gpuModelItems} />} />
          <TelemetryChartCard widgetId="overview-gpu-memory" title="GPU 总内存已用容量" subtitle={`${gpuMemorySummary} · 全部显卡实例合计`} series={[{ label: "GPU 总内存已用", points: gpuTotalMemoryUsedBytes, valueFormatter: formatBytes }]} valueFormatter={formatBytes} footer={<TelemetryModelList label="已采集显卡型号" items={gpuModelItems} />} />
          {activeTab === "overview" && fanInstances.length ? fanInstances.map((fan, index) => <TelemetryChartCard key={`overview-fan-${fan.id}`} widgetId={`overview-fan-${fan.id}`} widgetTemplateId={`overview-fan-${index}`} title={`${fan.name} · 风扇转速`} subtitle={fan.interface || "风扇实例"} series={[{ label: "转速", points: fan.rpm }]} valueFormatter={(v) => `${Math.round(v)} RPM`} />) : null}
        </TelemetrySection>
      )}

      {/* ================= Tab 2: 算力与内存 (Compute & Memory) ================= */}
      {(activeTab === "compute" || activeTab === "all") && series && (
        <TelemetrySection id="section-compute" eyebrow="处理器与内存" title="算力与内存明细" description="CPU 实例、频率、温度和内存层级数据分开呈现，避免不同单位被压缩成一条汇总线。">
           <DesktopWidget id="compute-cpu-facts" title="处理器与系统统计" defaultSize="large"><CpuFactsCard cpus={filteredLatest?.cpuPackages ?? []} system={filteredLatest?.system} unavailable={metricUnavailable("systemOverview")} /></DesktopWidget>
           {cpuInstances.length ? cpuInstances.map((cpu) => {
             const cpuTemperaturePoints = cpu.temperatureC.length || cpuInstances.length > 1 ? cpu.temperatureC : series.cpuTemperatureC ?? [];
             const cpuLabel = `${cpu.socketIndex != null ? `Socket ${cpu.socketIndex}` : cpu.id} · ${displayModelName(cpu.model, cpu.name, "CPU")}`;
             return (
               <TelemetryDeviceBlock
                 key={`compute-cpu-${cpu.id}`}
                 kind="cpu"
                 widgetId={`compute-cpu-device-${cpu.id}`}
                 widgetTemplateId={`compute-cpu-device-${cpu.id}`}
                 targetId={cpu.id}
                 eyebrow="CPU 实例"
                 title={cpuLabel}
                 subtitle={`${cpu.coreCount ?? "未知"} 核 · ${cpu.logicalCount ?? "未知"} 线程${cpu.l3CacheBytes ? ` · L3 ${formatBytes(cpu.l3CacheBytes)}` : ""}`}
               >
                 <TelemetryChartCard widgetId={`compute-cpu-${cpu.id}-usage`} widgetGroupId={`compute-cpu-device-${cpu.id}`} widgetType="cpu-usage" widgetCategory="处理器" widgetVisualization="line" widgetConfig={{ systemRendered: true, targetId: cpu.id, visualization: "line" }} title={`${cpuLabel} · 使用率`} subtitle={metricUnavailable("cpuUsage") ? UNAVAILABLE_METRIC_LABEL : "处理器负载"} emptyMessage={UNAVAILABLE_METRIC_LABEL} series={[{ label: "使用率", points: unavailablePoints(cpu.usagePercent, metricUnavailable("cpuUsage")) }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
                 <TelemetryChartCard widgetId={`compute-cpu-${cpu.id}-frequency`} widgetGroupId={`compute-cpu-device-${cpu.id}`} widgetType="cpu-frequency" widgetCategory="处理器" widgetVisualization="line" widgetConfig={{ systemRendered: true, targetId: cpu.id, visualization: "line" }} title={`${cpuLabel} · 主频`} subtitle={metricUnavailable("cpuFrequency") ? UNAVAILABLE_METRIC_LABEL : "实时有效频率"} emptyMessage={UNAVAILABLE_METRIC_LABEL} series={[{ label: "频率", points: unavailablePoints(cpu.frequencyMHz, metricUnavailable("cpuFrequency")), valueFormatter: (v) => `${Math.round(v)} MHz` }]} valueFormatter={(v) => `${Math.round(v)} MHz`} />
                 <TelemetryChartCard widgetId={`compute-cpu-${cpu.id}-temperature`} widgetGroupId={`compute-cpu-device-${cpu.id}`} widgetType="cpu-temperature" widgetCategory="处理器" widgetVisualization="line" widgetConfig={{ systemRendered: true, targetId: cpu.id, visualization: "line" }} title={`${cpuLabel} · 温度`} subtitle={metricUnavailable("cpuTemperature") ? UNAVAILABLE_METRIC_LABEL : "CPU Package / Core"} emptyMessage={metricUnavailable("cpuTemperature") ? UNAVAILABLE_METRIC_LABEL : "等待 CPU Package/Core 温度传感器"} series={[{ label: "温度", points: unavailablePoints(cpuTemperaturePoints, metricUnavailable("cpuTemperature")), valueFormatter: (v) => `${Math.round(v)} °C` }]} valueFormatter={(v) => `${Math.round(v)} °C`} />
               </TelemetryDeviceBlock>
             );
           }) : hasInstanceConfiguration("cpu") ? <div className="workspace-telemetry-empty">当前已关闭所有 CPU 实例</div> : (
             <TelemetryDeviceBlock widgetId="compute-cpu-summary" kind="cpu" eyebrow="CPU 汇总" title="处理器总览" subtitle="未拆分出独立 CPU 实例">
               <TelemetryChartCard widgetId="compute-cpu-summary-usage" widgetGroupId="compute-cpu-summary" widgetType="cpu-usage" widgetCategory="处理器" widgetVisualization="line" widgetConfig={{ systemRendered: true, visualization: "line" }} title="使用率" emptyMessage={UNAVAILABLE_METRIC_LABEL} series={[{ label: "CPU 占用", points: unavailablePoints(series.cpuUsagePercent ?? [], metricUnavailable("cpuUsage")) }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
             </TelemetryDeviceBlock>
           )}
           <TelemetryChartCard widgetId="compute-memory" title="内存容量明细" subtitle={`物理 ${formatCapacitySummary(filteredLatest?.memoryUsedBytes, filteredLatest?.memoryTotalBytes, metricUnavailable("memoryUsage"))} · 已提交 ${committedMemorySummary} · 页面文件 ${pagefileMemorySummary}`} emptyMessage={UNAVAILABLE_METRIC_LABEL} series={[{ label: "已用物理内存", points: unavailablePoints(series.memoryUsedBytes ?? [], metricUnavailable("memoryUsage")), valueFormatter: formatBytes }, { label: "已提交", points: unavailablePoints(series.memoryCommittedBytes ?? [], metricUnavailable("memoryCommitted")), valueFormatter: formatBytes }, { label: "缓存", points: unavailablePoints(series.memoryCachedBytes ?? [], metricUnavailable("memoryCached")), valueFormatter: formatBytes }, { label: "页面文件实际使用", points: unavailablePoints(series.swapUsedBytes ?? [], metricUnavailable("swapUsage")), valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
           <TelemetryChartCard widgetId="compute-system" title="系统进程、线程与句柄" emptyMessage={metricUnavailable("systemOverview") ? UNAVAILABLE_METRIC_LABEL : undefined} series={[{ label: "线程数", points: unavailablePoints(series.systemThreadCount ?? [], metricUnavailable("systemOverview")) }, { label: "进程数", points: unavailablePoints(series.systemProcessCount ?? [], metricUnavailable("systemOverview")) }, { label: "句柄数", points: unavailablePoints(series.systemHandleCount ?? [], metricUnavailable("systemOverview")) }]} valueFormatter={(v) => `${Math.round(v)}`} />
        </TelemetrySection>
      )}

      {/* ================= Tab 3: 存储与网络 (Storage & Network) ================= */}
      {(activeTab === "storage_net" || activeTab === "all") && series && (
        <TelemetrySection id="section-storage" eyebrow="存储与网络" title="I/O 实例明细" description="虚拟化存储池与普通挂载硬盘分开统计；网卡和硬盘实例选择全部时会同时展示每个实例。" controls={<><InstanceFilter label="网卡" value={selectedNetId} onChange={setSelectedNetId} options={networkOptions} /><InstanceFilter label="磁盘" value={selectedDiskId} onChange={setSelectedDiskId} options={diskOptions} /></>}>
          <TrafficCalendarCard data={snapshot?.trafficCalendar ?? null} mode={trafficMode} onModeChange={setTrafficMode} />
          {networkInstances.length ? visibleNetworkInstances.map((network) => {
            const networkIndex = networkInstances.findIndex((item) => item.id === network.id);
            return <TelemetryChartCard key={`network-${network.id}`} widgetId={`storage-network-${network.id}`} widgetTemplateId={`network-${networkIndex}`} title={`${displayModelName(network.model, network.name, "网卡")} · 吞吐`} subtitle={metricUnavailable("networkRxRate") || metricUnavailable("networkTxRate") ? UNAVAILABLE_METRIC_LABEL : [network.name, network.macAddress, network.ipv4?.[0] || network.ipv6?.[0]].filter(Boolean).join(" · ") || "独立网卡实例"} emptyMessage={UNAVAILABLE_METRIC_LABEL} series={[{ label: "接收 (Rx)", points: unavailablePoints(network.rxBytesPerSec, metricUnavailable("networkRxRate")) , valueFormatter: (v) => `${formatBytes(v)}/s` }, { label: "发送 (Tx)", points: unavailablePoints(network.txBytesPerSec, metricUnavailable("networkTxRate")), valueFormatter: (v) => `${formatBytes(v)}/s` }]} valueFormatter={(v) => `${formatBytes(v)}/s`} />;
          }) : hasInstanceConfiguration("network") ? <div className="workspace-telemetry-empty">当前已关闭所有网卡实例</div> : <TelemetryChartCard widgetId="storage-network-summary" title="网络实时吞吐" subtitle={metricUnavailable("networkRxRate") || metricUnavailable("networkTxRate") ? UNAVAILABLE_METRIC_LABEL : "设备汇总"} emptyMessage={UNAVAILABLE_METRIC_LABEL} series={[{ label: "接收 (Rx)", points: unavailablePoints(series.networkRxBytesPerSec ?? [], metricUnavailable("networkRxRate")), valueFormatter: (v) => `${formatBytes(v)}/s` }, { label: "发送 (Tx)", points: unavailablePoints(series.networkTxBytesPerSec ?? [], metricUnavailable("networkTxRate")), valueFormatter: (v) => `${formatBytes(v)}/s` }]} valueFormatter={(v) => `${formatBytes(v)}/s`} />}
          {diskInstances.length ? visibleDiskInstances.map((disk) => {
            const diskLatest = filteredLatest?.disks?.find((item) => item.id === disk.id);
            const diskLabel = displayModelName(disk.model, disk.name, "磁盘");
            const diskIndex = diskInstances.findIndex((item) => item.id === disk.id);
            return (
              <TelemetryDeviceBlock
                key={`disk-${disk.id}`}
                kind="disk"
                widgetId={`storage-disk-device-${disk.id}`}
                widgetTemplateId={`storage-disk-device-${disk.id}`}
                targetId={disk.id}
                eyebrow="硬盘实例"
                title={diskLabel}
                subtitle={[disk.mountPoint, disk.filesystem].filter(Boolean).join(" · ") || "独立硬盘实例"}
              >
                <TelemetryChartCard widgetId={`storage-disk-${disk.id}-capacity`} widgetTemplateId={`disk-${diskIndex}-capacity`} widgetGroupId={`storage-disk-device-${disk.id}`} widgetType="disk-capacity" widgetCategory="存储" widgetVisualization="area" widgetConfig={{ systemRendered: true, targetId: disk.id, visualization: "area" }} title={`${diskLabel} · 已用容量`} subtitle={formatCapacitySummary(diskLatest?.usedBytes, diskLatest?.totalBytes, metricUnavailable("diskUsage"))} emptyMessage={UNAVAILABLE_METRIC_LABEL} series={[{ label: "已用容量", points: unavailablePoints(disk.usedBytes, metricUnavailable("diskUsage")), valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
                <TelemetryChartCard widgetId={`storage-disk-${disk.id}-io`} widgetTemplateId={`disk-${diskIndex}-io`} widgetGroupId={`storage-disk-device-${disk.id}`} widgetType="disk-io" widgetCategory="存储" widgetVisualization="line" widgetConfig={{ systemRendered: true, targetId: disk.id, visualization: "line" }} title={`${diskLabel} · 读写速率`} subtitle={metricUnavailable("diskRead") || metricUnavailable("diskWrite") ? UNAVAILABLE_METRIC_LABEL : "当前硬盘 I/O"} emptyMessage={UNAVAILABLE_METRIC_LABEL} series={[{ label: "读取", points: unavailablePoints(disk.readBytesPerSec, metricUnavailable("diskRead")), valueFormatter: (v) => `${formatBytes(v)}/s` }, { label: "写入", points: unavailablePoints(disk.writeBytesPerSec, metricUnavailable("diskWrite")), valueFormatter: (v) => `${formatBytes(v)}/s` }]} valueFormatter={(v) => `${formatBytes(v)}/s`} />
              </TelemetryDeviceBlock>
            );
          }) : hasInstanceConfiguration("disk") ? <div className="workspace-telemetry-empty">当前已关闭所有硬盘实例</div> : (
            <TelemetryDeviceBlock widgetId="storage-disk-summary" kind="disk" eyebrow="硬盘汇总" title="存储总览" subtitle={formatCapacitySummary(filteredLatest?.diskUsedBytes, filteredLatest?.diskTotalBytes, metricUnavailable("diskUsage"))}>
              <TelemetryChartCard widgetId="storage-disk-summary-capacity" widgetGroupId="storage-disk-summary" widgetType="disk-capacity" widgetCategory="存储" widgetVisualization="area" widgetConfig={{ systemRendered: true, visualization: "area" }} title="已用容量" emptyMessage={UNAVAILABLE_METRIC_LABEL} series={[{ label: "已用容量", points: unavailablePoints(series.diskUsedBytes ?? [], metricUnavailable("diskUsage")), valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
              <TelemetryChartCard widgetId="storage-disk-summary-io" widgetGroupId="storage-disk-summary" widgetType="disk-io" widgetCategory="存储" widgetVisualization="line" widgetConfig={{ systemRendered: true, visualization: "line" }} title="读写速率" subtitle={metricUnavailable("diskRead") || metricUnavailable("diskWrite") ? UNAVAILABLE_METRIC_LABEL : "设备汇总"} emptyMessage={UNAVAILABLE_METRIC_LABEL} series={[{ label: "读取", points: unavailablePoints(series.diskReadBytesPerSec ?? [], metricUnavailable("diskRead")), valueFormatter: (v) => `${formatBytes(v)}/s` }, { label: "写入", points: unavailablePoints(series.diskWriteBytesPerSec ?? [], metricUnavailable("diskWrite")), valueFormatter: (v) => `${formatBytes(v)}/s` }]} valueFormatter={(v) => `${formatBytes(v)}/s`} />
            </TelemetryDeviceBlock>
          )}
          {storagePoolDisplaySeries.length ? renderStoragePoolBlocks() : null}
        </TelemetrySection>
      )}

      {/* ================= Tab 4: 显卡与散热 (GPU & Thermal) ================= */}
      {(activeTab === "gpu_thermal" || activeTab === "all") && series && (
        <TelemetrySection id="section-gpu" eyebrow="显卡与温度" title="GPU 与温度明细" description="每个 GPU 都有独立的负载、频率、显存和温度数据；风扇转速请切换到单独的风扇转速面板。" controls={<InstanceFilter label="GPU" value={selectedGpuId} onChange={setSelectedGpuId} options={gpuOptions} />}>
          {gpuInstances.length ? visibleGpuInstances.map((gpu) => {
            const gpuLatest = filteredLatest?.gpus?.find((item) => item.id === gpu.id);
            const gpuTemperaturePoints = gpu.temperatureC ?? [];
            const gpuLabel = displayInstanceName(gpu.name, "GPU");
            const gpuIndex = gpuInstances.findIndex((item) => item.id === gpu.id);
            const memoryLabel = gpuMemoryLabel(gpuLatest?.memoryKind ?? gpu.memoryKind);
            const memorySummary = gpuLatest ? formatGpuMemorySummary([gpuLatest]) : "容量暂无";
            const temperatureSource = gpuLatest?.temperatureSource ?? gpu.temperatureSource;
            const temperatureSubtitle = gpuTemperaturePoints.length > 0
              ? (temperatureSource === "cpuPackageShared"
                ? "集成显卡未暴露独立温度 · 使用 CPU 封装温度"
                : "GPU 传感器温度")
              : (gpu.integrated ? "未采集 CPU 封装温度" : "未检测到 GPU 温度传感器");
            return (
              <TelemetryDeviceBlock
                key={`gpu-${gpu.id}`}
                kind="gpu"
                widgetId={`gpu-device-${gpu.id}`}
                widgetTemplateId={`gpu-device-${gpu.id}`}
                targetId={gpu.id}
                eyebrow="显卡实例"
                title={gpuLabel}
                subtitle={gpuLatest ? `${memorySummary} · ${temperatureSubtitle}` : temperatureSubtitle}
              >
                <TelemetryChartCard widgetId={`gpu-${gpu.id}-load`} widgetTemplateId={`gpu-${gpuIndex}-load`} widgetGroupId={`gpu-device-${gpu.id}`} widgetType="gpu-load" widgetCategory="显卡" widgetVisualization="line" widgetConfig={{ systemRendered: true, targetId: gpu.id, visualization: "line" }} title={`${gpuLabel} · 核心负载`} subtitle="GPU 核心引擎" series={[{ label: "核心", points: gpu.usagePercent }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
                <TelemetryChartCard widgetId={`gpu-${gpu.id}-encode`} widgetTemplateId={`gpu-${gpuIndex}-encode`} widgetGroupId={`gpu-device-${gpu.id}`} widgetType="gpu-encode" widgetCategory="显卡" widgetVisualization="line" widgetConfig={{ systemRendered: true, targetId: gpu.id, visualization: "line" }} title={`${gpuLabel} · 编码负载`} subtitle="视频编码引擎" series={[{ label: "编码", points: gpu.encodePercent }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
                <TelemetryChartCard widgetId={`gpu-${gpu.id}-decode`} widgetTemplateId={`gpu-${gpuIndex}-decode`} widgetGroupId={`gpu-device-${gpu.id}`} widgetType="gpu-decode" widgetCategory="显卡" widgetVisualization="line" widgetConfig={{ systemRendered: true, targetId: gpu.id, visualization: "line" }} title={`${gpuLabel} · 解码负载`} subtitle="视频解码引擎" series={[{ label: "解码", points: gpu.decodePercent }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
                <TelemetryChartCard widgetId={`gpu-${gpu.id}-frequency`} widgetTemplateId={`gpu-${gpuIndex}-frequency`} widgetGroupId={`gpu-device-${gpu.id}`} widgetType="gpu-frequency" widgetCategory="显卡" widgetVisualization="line" widgetConfig={{ systemRendered: true, targetId: gpu.id, visualization: "line" }} title={`${gpuLabel} · 核心频率`} subtitle="GPU 核心时钟" series={[{ label: "频率", points: gpu.frequencyMHz }]} valueFormatter={(v) => `${Math.round(v)} MHz`} />
                <TelemetryChartCard widgetId={`gpu-${gpu.id}-memory`} widgetTemplateId={`gpu-${gpuIndex}-memory`} widgetGroupId={`gpu-device-${gpu.id}`} widgetType="gpu-memory" widgetCategory="显卡" widgetVisualization="area" widgetConfig={{ systemRendered: true, targetId: gpu.id, visualization: "area" }} title={`${gpuLabel} · ${memoryLabel}已用容量`} subtitle={memorySummary} series={[{ label: `${memoryLabel}已用`, points: gpu.memoryUsedBytes, valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
                <TelemetryChartCard widgetId={`gpu-${gpu.id}-temperature`} widgetTemplateId={`gpu-${gpuIndex}-temperature`} widgetGroupId={`gpu-device-${gpu.id}`} widgetType="gpu-temperature" widgetCategory="显卡" widgetVisualization="line" widgetConfig={{ systemRendered: true, targetId: gpu.id, visualization: "line" }} title={`${gpuLabel} · 温度`} subtitle={temperatureSubtitle} emptyMessage={gpu.integrated ? "未采集 CPU 封装温度" : "未检测到 GPU 温度传感器"} series={[{ label: "温度", points: gpuTemperaturePoints, valueFormatter: (v) => `${Math.round(v)} °C` }]} valueFormatter={(v) => `${Math.round(v)} °C`} />
                <TelemetryInfoCard widgetId={`gpu-${gpu.id}-driver`} widgetTemplateId={`gpu-${gpuIndex}-driver`} widgetGroupId={`gpu-device-${gpu.id}`} widgetType="gpu-driver" widgetCategory="显卡" widgetConfig={{ systemRendered: true, targetId: gpu.id, visualization: "table" }} title={`${gpuLabel} · 驱动信息`} subtitle="适配器与驱动版本" rows={[{ label: "适配器", value: gpuLabel }, { label: "驱动版本", value: gpuLatest?.driverVersion || "未报告" }, { label: "显存类型", value: memoryLabel }]} />
              </TelemetryDeviceBlock>
            );
          }) : hasInstanceConfiguration("gpu") ? <div className="workspace-telemetry-empty">当前已关闭所有显卡实例</div> : (
            <TelemetryDeviceBlock widgetId="gpu-summary" kind="gpu" eyebrow="显卡汇总" title="GPU 总览" subtitle={`${gpuMemorySummary} · 设备汇总`}>
              <TelemetryChartCard widgetId="gpu-summary-load" widgetGroupId="gpu-summary" widgetType="gpu-load" widgetCategory="显卡" widgetVisualization="line" widgetConfig={{ systemRendered: true, visualization: "line" }} title="核心负载" subtitle="GPU 核心引擎" series={[{ label: "GPU 核心", points: series.gpuUsagePercent ?? [] }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
              <TelemetryChartCard widgetId="gpu-summary-encode" widgetGroupId="gpu-summary" widgetType="gpu-encode" widgetCategory="显卡" widgetVisualization="line" widgetConfig={{ systemRendered: true, visualization: "line" }} title="编码负载" subtitle="视频编码引擎" series={[{ label: "GPU 编码", points: series.gpuEncodePercent ?? [] }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
              <TelemetryChartCard widgetId="gpu-summary-decode" widgetGroupId="gpu-summary" widgetType="gpu-decode" widgetCategory="显卡" widgetVisualization="line" widgetConfig={{ systemRendered: true, visualization: "line" }} title="解码负载" subtitle="视频解码引擎" series={[{ label: "GPU 解码", points: series.gpuDecodePercent ?? [] }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
              <TelemetryChartCard widgetId="gpu-summary-frequency" widgetGroupId="gpu-summary" widgetType="gpu-frequency" widgetCategory="显卡" widgetVisualization="line" widgetConfig={{ systemRendered: true, visualization: "line" }} title="核心频率" subtitle="GPU 核心时钟" series={[{ label: "GPU 频率", points: series.gpuFrequencyMHz ?? [] }]} valueFormatter={(v) => `${Math.round(v)} MHz`} />
              <TelemetryChartCard widgetId="gpu-summary-memory" widgetGroupId="gpu-summary" widgetType="gpu-memory" widgetCategory="显卡" widgetVisualization="area" widgetConfig={{ systemRendered: true, visualization: "area" }} title="GPU 内存已用容量" subtitle={gpuMemorySummary} series={[{ label: "GPU 内存已用", points: series.gpuMemoryUsedBytes ?? [], valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
              <TelemetryChartCard widgetId="gpu-summary-temperature" widgetGroupId="gpu-summary" widgetType="gpu-temperature" widgetCategory="显卡" widgetVisualization="line" widgetConfig={{ systemRendered: true, visualization: "line" }} title="温度" subtitle="GPU 设备汇总" emptyMessage="等待 GPU 温度传感器" series={[{ label: "温度", points: series.gpuTemperatureC ?? [], valueFormatter: (v) => `${Math.round(v)} °C` }]} valueFormatter={(v) => `${Math.round(v)} °C`} />
              <TelemetryInfoCard widgetId="gpu-summary-driver" widgetGroupId="gpu-summary" widgetType="gpu-driver" widgetCategory="显卡" widgetConfig={{ systemRendered: true, visualization: "table" }} title="驱动信息" subtitle="全部 GPU 适配器" rows={(filteredLatest?.gpus ?? []).map((item) => ({ label: item.name, value: item.driverVersion || "未报告" }))} />
            </TelemetryDeviceBlock>
          )}
          <TemperatureSourcesPanel sensors={filteredLatest?.temperatureSensors ?? []} series={series.temperatureSensors ?? []} />
          {activeTab === "gpu_thermal" && fanInstances.length ? fanInstances.map((fan, index) => <TelemetryChartCard key={`thermal-fan-${fan.id}`} widgetId={`thermal-fan-${fan.id}`} widgetTemplateId={`thermal-fan-${index}`} title={`${fan.name} · 转速`} subtitle={fan.interface || "风扇实例"} series={[{ label: "转速", points: fan.rpm, valueFormatter: (v) => `${Math.round(v)} RPM` }]} valueFormatter={(v) => `${Math.round(v)} RPM`} />) : null}
          </TelemetrySection>
      )}

      {(activeTab === "fan" || activeTab === "all") && metrics && (
        <TelemetrySection id="section-fan" eyebrow="散热" title="风扇转速" description="这里显示每个风扇接口的当前转速和历史趋势；0 RPM 也会保留，表示当前接口确实报告了停转。">
          {fanInstances.length ? fanInstances.map((fan, index) => {
            const fanLatest = filteredLatest?.fans.find((item) => item.id === fan.id);
            const currentRpm = fanLatest?.rpm ?? fan.rpm[fan.rpm.length - 1]?.value;
            return (
              <TelemetryChartCard
                key={`fan-${fan.id}`}
                widgetId={`fan-${fan.id}-rpm`}
                widgetTemplateId={`fan-${index}-rpm`}
                title={`${fan.name} · 风扇转速`}
                subtitle={[fan.interface || "风扇接口", currentRpm == null ? "当前值未知" : `当前 ${Math.round(currentRpm)} RPM`].join(" · ")}
                series={[{ label: "转速", points: fan.rpm, valueFormatter: (value) => `${Math.round(value)} RPM` }]}
                valueFormatter={(value) => `${Math.round(value)} RPM`}
              />
            );
          }) : <div className="workspace-telemetry-empty">尚未收到风扇样本；请先在 Agent 设置中重新检测硬件并启动采集。</div>}
        </TelemetrySection>
      )}

      {activeTab !== "all" && <DynamicWidgetCanvas device={selectedDevice} metrics={metrics} localTemperatureSources={localTemperatureSources} localTemperatureSourcesAt={localTemperatureSourcesAt} showEmptyState={isCustomPanel} onOpenDrawer={canEditRemote ? () => setWidgetDrawerOpen(true) : undefined} />}

      {(activeTab === "overview" || activeTab === "all") && (
        <div id="section-info" className="workspace-widget-grid workspace-device-info-widgets">
          <DesktopWidget id="device-hardware-system" title="硬件与系统" kind="group" defaultSize="medium">
            <Surface>
              <div className="workspace-surface__header">
                <div>
                  <span className="workspace-section-kicker">设备信息</span>
                  <h3>硬件与系统</h3>
                </div>
                <button className="workspace-icon-button" type="button" onClick={() => void navigator.clipboard?.writeText(selectedDevice.deviceId)} title="复制设备 ID">
                  <Icon name="copy" />
                </button>
              </div>
              <div className="workspace-detail-list">
                <SummaryRow label="操作系统" value={selectedDevice.os} />
                <SummaryRow label="设备 ID" value={selectedDevice.deviceId} />
                <SummaryRow label="Agent 版本" value={selectedDevice.agentVersion ? `v${selectedDevice.agentVersion}` : "未知"} />
                <SummaryRow label="CPU 型号" value={filteredLatest?.cpuPackages.map((cpu) => `${cpu.socketIndex != null ? `Socket ${cpu.socketIndex} · ` : ""}${cpu.model || cpu.name}`).join("、") || "未采集"} />
                <SummaryRow label="运行时间" value={metricUnavailable("systemOverview") ? UNAVAILABLE_METRIC_LABEL : formatDuration(filteredLatest?.system.uptimeSeconds)} />
                <SummaryRow label="CPU 核心 / 线程" value={`${formatCount(filteredLatest?.cpuPackages.reduce((total, cpu) => total + (cpu.coreCount ?? 0), 0))} / ${formatCount(filteredLatest?.cpuPackages.reduce((total, cpu) => total + (cpu.logicalCount ?? 0), 0))}`} />
                <SummaryRow label="L3 缓存" value={formatBytes(filteredLatest?.cpuPackages.reduce((total, cpu) => total + (cpu.l3CacheBytes ?? 0), 0))} />
                <SummaryRow label="进程 / 系统线程 / 句柄" value={metricUnavailable("systemOverview") ? UNAVAILABLE_METRIC_LABEL : `${formatCount(filteredLatest?.system.processCount)} / ${formatCount(filteredLatest?.system.threadCount)} / ${formatCount(filteredLatest?.system.handleCount)}`} />
                <SummaryRow label="内存容量" value={filteredLatest ? formatCapacitySummary(filteredLatest.memoryUsedBytes, filteredLatest.memoryTotalBytes, metricUnavailable("memoryUsage")) : "未采集"} />
                <SummaryRow label="磁盘容量" value={filteredLatest ? formatCapacitySummary(filteredLatest.diskUsedBytes, filteredLatest.diskTotalBytes, metricUnavailable("diskUsage")) : "未采集"} />
              </div>
            </Surface>
          </DesktopWidget>

          <DesktopWidget id="device-agent-status" title="设备 Agent" kind="group" defaultSize="medium">
            <Surface className="workspace-agent-surface">
              <div className="workspace-surface__header">
                <div>
                  <span className="workspace-section-kicker">操作</span>
                  <h3>{selectedDevice.instanceType === "virtual_machine" ? "宿主机 Agent" : "设备 Agent"}</h3>
                </div>
                <StatusLabel state={selectedDevice.status === "online" ? "online" : "offline"} />
              </div>
              <p className="workspace-surface__description">设备状态和遥测均由中枢提供，本页面不直接读取本机采集状态；未上传或中枢离线时，数据会与其他设备一样不完整。</p>
              <Button variant="quiet" onClick={() => openSettings(capabilities.canConfigureConnection ? "connections" : "workspace")}>{capabilities.canConfigureConnection ? "查看中枢连接" : "查看中枢状态"}</Button>
            </Surface>
          </DesktopWidget>
        </div>
      )}

      <WidgetDrawer open={widgetDrawerOpen} onClose={() => setWidgetDrawerOpen(false)} device={selectedDevice} metrics={metrics} localTemperatureSources={localTemperatureSources} />

      </WidgetLayoutProvider>
    </div>
  );
}

function InstanceRow({ label, name, value }: { label: string; name: string; value: string }) {
  return <div className="workspace-instance-row"><span className="workspace-instance-row__label">{label}</span><span className="workspace-instance-row__name">{name}</span><strong>{value}</strong></div>;
}

function HubPage() {
  const { hubs, route, navigate, openSettings, capabilities } = useWorkspace();
  const hub = hubs.find((item) => item.id === (route.kind === "hub" ? route.hubId : "")) ?? hubs[0];
  if (!hub) return <EmptyState title="没有配置中枢" detail="添加一个中枢后，设备会显示在侧边栏。" action={<Button variant="primary" onClick={() => openSettings(capabilities.canConfigureConnection ? "connections" : "workspace")}>{capabilities.canConfigureConnection ? "添加中枢" : "查看中枢设置"}</Button>} />;
  const online = hub.devices.filter((device) => device.status === "online").length;
  const allVirtualMachines = hub.devices.length > 0 && hub.devices.every((device) => device.instanceType === "virtual_machine");
  const onlineLabel = allVirtualMachines ? "Agent 在线" : "在线";
  const settingsSection: SettingsSection = capabilities.canConfigureConnection ? "connections" : "workspace";
  const settingsLabel = capabilities.canConfigureConnection ? "管理连接" : "查看中枢设置";
  return <div className="workspace-page"><PageIntro eyebrow="中枢" title={hub.name} description={hub.endpoint} actions={<><Button variant="quiet" onClick={() => navigate({ kind: "overview" })}><Icon name="back" size={16} />返回总览</Button><Button variant="primary" onClick={() => openSettings(settingsSection)}><Icon name="settings" size={16} />{settingsLabel}</Button></>} /><div className="workspace-hub-hero"><div><StatusLabel state={hub.state === "online" ? "online" : hub.state === "cached" ? "cached" : hub.state === "offline" ? "warning" : "unknown"} /><strong>{hub.state === "online" ? "连接正常" : hub.state === "cached" ? "正在显示缓存" : "需要检查连接"}</strong><p>{online} 个实例 Agent 在线，共 {hub.devices.length} 个实例。</p></div><div className="workspace-hub-hero__stat"><span>实例</span><strong>{hub.devices.length}</strong></div><div className="workspace-hub-hero__stat"><span>{onlineLabel}</span><strong>{online}</strong></div></div><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">实例列表</span><h3>{hub.devices.length} 个实例</h3></div><Button variant="quiet" onClick={() => openSettings(settingsSection)}>{capabilities.canConfigureConnection ? "连接设置" : "中枢设置"}</Button></div><div className="workspace-device-rows">{hub.devices.map((device) => <DeviceRow key={device.deviceId} device={device} />)}</div></Surface></div>;
}

function SettingsPage() {
  const { route, capabilities } = useWorkspace();
  const section: SettingsSection = route.kind === "settings"
    ? route.section
    : capabilities.canControlNativeWindow ? "general" : "workspace";
  const pages: Record<SettingsSection, React.ReactNode> = {
    general: <GeneralSettings />,
    workspace: capabilities.canControlNativeWindow ? <GeneralSettings /> : <WebWorkspaceSettings />,
    appearance: <AppearanceSettings />,
    connections: capabilities.canConfigureConnection ? <ConnectionSettings /> : <WebSessionSettings />,
    agent: capabilities.canManageLocalAgent ? <AgentSettings /> : <WebWorkspaceSettings />,
    data: <DataSettings />,
    shortcuts: <ShortcutSettings />,
    session: capabilities.canConfigureConnection ? <ConnectionSettings /> : <WebSessionSettings />,
    about: <AboutSettings />
  };
  const heading = settingsNavigation(capabilities).find((item) => item.id === section);
  const descriptions: Partial<Record<SettingsSection, string>> = {
    general: "调整观澜的日常行为。",
    workspace: "浏览器端的刷新、实例筛选和中枢状态。",
    appearance: "调整工作区的主题、密度和动画适配。",
    session: "管理当前浏览器会话和访问边界。",
    data: "查看实时数据来源与版本信息。",
    shortcuts: "用键盘快速切换页面和刷新状态。",
    about: "查看观澜中枢的版本与项目链接。"
  };
  return <div className="workspace-page workspace-page--settings"><PageIntro eyebrow="设置" title={heading?.label ?? "设置"} description={descriptions[section]} />{pages[section]}</div>;
}

function WebWorkspaceSettings() {
  const { snapshot, hubs, allDevices, instanceType, setInstanceType, refreshInterval, setRefreshInterval, refresh, refreshing, mutationPending } = useWorkspace();
  const hub = hubs[0];
  const online = allDevices.filter((device) => device.status === "online").length;
  const state = snapshot?.session.authenticated && snapshot.source === "live" ? "online" : snapshot?.source === "cache" ? "cached" : "unknown";
  const stateLabel = state === "online" ? "连接正常" : state === "cached" ? "显示缓存" : "等待同步";
  return (
    <div className="workspace-settings-stack workspace-web-settings">
      <div className="workspace-web-settings__status">
        <div className="workspace-web-settings__status-main">
          <StatusLabel state={state} />
          <strong>{stateLabel}</strong>
          <p>{hub?.name ?? "观澜中枢"} · 浏览器端通过当前站点读取实时设备状态。</p>
        </div>
        <div className="workspace-web-settings__stat"><span>实例</span><strong>{allDevices.length}</strong></div>
        <div className="workspace-web-settings__stat"><span>在线</span><strong>{online}</strong></div>
        <div className="workspace-web-settings__stat"><span>同步</span><strong>{snapshot ? formatDate(snapshot.generatedAt) : "等待"}</strong></div>
      </div>

      <div className="workspace-web-settings__grid">
        <Surface>
          <div className="workspace-surface__header"><div><span className="workspace-section-kicker">工作台偏好</span><h3>浏览器显示与刷新</h3></div></div>
          <div className="workspace-settings-list">
            <SettingRow label="状态刷新频率" description="只影响当前网页读取状态的频率，不改变 Agent 的采样间隔。"><select className="workspace-select" value={refreshInterval} onChange={(event) => setRefreshInterval(Number(event.target.value) as typeof refreshInterval)} disabled={mutationPending}><option value="5">5 秒</option><option value="10">10 秒</option><option value="30">30 秒</option></select></SettingRow>
            <SettingRow label="默认实例类型" description="选择打开总览时优先查看的实例分组。"><select className="workspace-select" value={instanceType} onChange={(event) => setInstanceType(event.target.value as typeof instanceType)}><option value="device">普通设备</option><option value="virtual_machine">虚拟机</option></select></SettingRow>
          </div>
        </Surface>

        <Surface>
          <div className="workspace-surface__header"><div><span className="workspace-section-kicker">中枢状态</span><h3>当前数据链路</h3></div><StatusLabel state={state} /></div>
          <div className="workspace-detail-list"><SummaryRow label="数据来源" value={snapshot?.source === "live" ? "实时中枢" : snapshot?.source === "cache" ? "缓存" : "等待数据"} /><SummaryRow label="最近同步" value={snapshot ? formatPreciseDateTime(snapshot.generatedAt) : "尚未同步"} /><SummaryRow label="接入实例" value={`${allDevices.length} 个`} /></div>
          <div className="workspace-form__actions"><Button variant="quiet" onClick={() => void refresh()} disabled={refreshing || mutationPending}><Icon name="refresh" size={15} />{refreshing ? "正在同步" : "立即同步"}</Button></div>
        </Surface>
      </div>
    </div>
  );
}

function WebSessionSettings() {
  const { snapshot, logout, mutationPending } = useWorkspace();
  const authenticated = snapshot?.session.authenticated ?? false;
  const signOut = async () => {
    await logout();
    if (typeof window !== "undefined") window.location.reload();
  };
  return (
    <div className="workspace-settings-stack workspace-web-settings">
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">当前会话</span><h3>{authenticated ? "浏览器会话已认证" : "会话需要重新认证"}</h3></div><StatusLabel state={authenticated ? "online" : "warning"} /></div>
        <div className="workspace-detail-list"><SummaryRow label="认证方式" value="中枢访问密钥" /><SummaryRow label="会话范围" value="当前浏览器" /><SummaryRow label="访问权限" value="已授权设备与指标" /></div>
        <div className="workspace-form__actions"><Button variant="danger" onClick={() => void signOut()} disabled={!authenticated || mutationPending}>{mutationPending ? "正在退出" : "退出当前会话"}</Button></div>
      </Surface>
      <Surface className="workspace-connection-note">
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">网页端边界</span><h3>中枢地址由站点提供</h3></div></div>
        <p className="workspace-surface__description">浏览器端不保存桌面连接地址，也不管理本机 Agent。页面只使用当前站点的认证会话访问中枢，并通过实时通道接收设备更新。</p>
      </Surface>
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return <div className="workspace-setting-row"><div><strong>{label}</strong>{description && <p>{description}</p>}</div><div className="workspace-setting-row__control">{children}</div></div>;
}

function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return <label className={`workspace-toggle${disabled ? " is-disabled" : ""}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} disabled={disabled} /><span className="workspace-toggle__track"><span /></span></label>;
}

function GeneralSettings() {
  const { snapshot, updateStartupSettings, mutationPending, refreshInterval, setRefreshInterval, capabilities } = useWorkspace();
  if (!capabilities.canChangeStartupSettings) return <WebWorkspaceSettings />;
  const startup = snapshot?.startup ?? { openAtLogin: false, startMinimized: false };
  return <Surface><div className="workspace-settings-list"><SettingRow label="开机启动" description="登录系统后自动启动观澜。"><Toggle checked={startup.openAtLogin} onChange={(checked) => void updateStartupSettings({ openAtLogin: checked })} label="开机启动" disabled={mutationPending} /></SettingRow><SettingRow label="启动时最小化" description="启动后保持在系统托盘，不打断当前工作。"><Toggle checked={startup.startMinimized} onChange={(checked) => void updateStartupSettings({ startMinimized: checked })} label="启动时最小化" disabled={mutationPending} /></SettingRow><SettingRow label="数据刷新频率" description="实时连接下，桌面端自动刷新状态的间隔；不改变 Agent 的采样频率。"><select className="workspace-select" value={refreshInterval} onChange={(event) => setRefreshInterval(Number(event.target.value) as typeof refreshInterval)} disabled={mutationPending}><option value="5">5 秒</option><option value="10">10 秒</option><option value="30">30 秒</option></select></SettingRow></div></Surface>;
}

function AppearanceSettings() {
  const { theme, setTheme, density, setDensity } = useWorkspace();
  return <Surface><div className="workspace-settings-list"><SettingRow label="主题" description="跟随系统，或固定使用浅色/深色主题。"><select className="workspace-select" value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></SettingRow><SettingRow label="界面密度" description="自动会根据触摸输入和窗口尺寸放大操作目标；远控手机时可手动选择触摸。"><select className="workspace-select" value={density} onChange={(event) => setDensity(event.target.value as typeof density)}><option value="auto">自动</option><option value="comfortable">舒适</option><option value="compact">紧凑</option><option value="touch">触摸</option></select></SettingRow><SettingRow label="动画" description="尊重系统的减少动态效果设置。"><span className="workspace-setting-note"><Icon name="check" size={15} />已启用可访问性适配</span></SettingRow></div></Surface>;
}

function ConnectionSettings() {
  const { snapshot, saveHubConnection, logout, disconnectAgent, mutationPending } = useWorkspace();
  const [serverUrl, setServerUrl] = useState(snapshot?.localBackend?.config.connection.serverUrl ?? "");
  const [accessKey, setAccessKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const authenticated = snapshot?.session.authenticated ?? false;
  const agentConfigured = Boolean(snapshot?.localBackend?.config.connection.secretConfigured);
  const agentRunning = snapshot?.localBackend?.running ?? false;
  useEffect(() => {
    setServerUrl(snapshot?.localBackend?.config.connection.serverUrl ?? "");
  }, [snapshot?.localBackend?.config.connection.serverUrl]);
  const saveConnection = async (event: FormEvent) => {
    event.preventDefault();
    if (!serverUrl.trim() || (!accessKey.trim() && !snapshot?.session.accessKeyConfigured)) return;
    setSaving(true);
    try {
      const saved = await saveHubConnection(serverUrl, accessKey);
      if (saved) setAccessKey("");
    } finally {
      setSaving(false);
    }
  };
  const disconnect = async () => {
    const stopped = await disconnectAgent();
    if (stopped) setDisconnectConfirmOpen(false);
  };
  return <div className="workspace-settings-stack"><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">中枢连接</span><h3>{authenticated ? "已连接" : "需要认证"}</h3></div><StatusLabel state={authenticated ? "online" : "warning"} /></div><form className="workspace-form workspace-connection-form" onSubmit={saveConnection}><label>中枢地址<input className="workspace-input" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://hub.example.com" autoComplete="url" required /></label><label>访问密钥<input className="workspace-input" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder={snapshot?.session.accessKeyConfigured ? "已保存，留空保留当前认证" : "输入中枢访问密钥"} autoComplete="current-password" required={!snapshot?.session.accessKeyConfigured} /></label><p className="workspace-form__hint">地址和访问密钥会在同一次保存中提交。访问密钥只会发送到桌面主进程，不会进入页面状态或日志。</p><div className="workspace-form__actions"><Button variant="primary" type="submit" disabled={saving || mutationPending}>{saving ? "正在保存…" : authenticated ? "保存连接" : "保存并连接"}</Button>{authenticated && <Button variant="quiet" onClick={() => void logout()} disabled={saving || mutationPending}>退出桌面查看</Button>}</div></form></Surface><Surface className="workspace-connection-note"><div className="workspace-surface__header"><div><span className="workspace-section-kicker">本机上报</span><h3>{agentRunning ? "Agent 正在采集" : agentConfigured ? "Agent 已配置但未运行" : "Agent 未配置"}</h3></div><StatusLabel state={agentRunning ? "online" : agentConfigured ? "warning" : "unknown"} /></div><p className="workspace-surface__description">退出桌面查看只会结束当前界面的中枢认证，本机 Agent 仍可能继续采集和上报。如果要停止本机上报，会停止采集、关闭云同步并清除本机保存的上报凭据。</p>{agentConfigured && <div className="workspace-form__actions"><Button variant="danger" onClick={() => setDisconnectConfirmOpen(true)} disabled={mutationPending}>停止本机上报</Button></div>}{disconnectConfirmOpen && <div className="workspace-danger-note" role="alert"><strong>确认停止本机上报？</strong><p>这会停止 Agent、关闭云同步并清除上报凭据；之后需要重新配置连接才能恢复。</p><div className="workspace-form__actions"><Button variant="danger" onClick={() => void disconnect()} disabled={mutationPending}>{mutationPending ? "正在停止…" : "停止并清除凭据"}</Button><Button variant="quiet" onClick={() => setDisconnectConfirmOpen(false)} disabled={mutationPending}>取消</Button></div></div>}</Surface><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">连接诊断</span><h3>如果连接失败</h3></div></div><p className="workspace-surface__description">请确认地址包含协议（例如 https://），中枢服务已启动，并使用中枢访问密钥。保存按钮会先写入地址，再用同一地址完成认证，避免出现 server url is missing。</p></Surface></div>;
}

function AgentSettings() {
  const { snapshot, controlAgent, updateLocalConfig, cloudPush, refreshing, mutationPending } = useWorkspace();
  const backend = snapshot?.localBackend;
  const config = backend?.config;
  const enabledMetrics = config?.enabledMetrics ?? [];
  const configuredProbes = config?.probeSelections ?? [];
  const supportedProbePlans = Array.isArray(backend?.supportedProbePlans) ? backend.supportedProbePlans : [];
  const detectedTargets = Array.isArray(backend?.detectedTargets) ? backend.detectedTargets : [];
  const [selectedMetrics, setSelectedMetrics] = useState<DeviceMetricKey[]>(enabledMetrics);
  const selectedMetricsRef = useRef<DeviceMetricKey[]>(enabledMetrics);
  const metricSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const [probeSelections, setProbeSelections] = useState(configuredProbes);
  const [enabledDeviceIds, setEnabledDeviceIds] = useState<Partial<Record<DeviceBlockKey, string[]>>>(config?.enabledDeviceIds ?? {});
  const [instanceMetricConfig, setInstanceMetricConfig] = useState<Record<string, DeviceMetricKey[]>>(config?.instanceMetricConfig ?? {});
  const [agentHostname, setAgentHostname] = useState(config?.connection.hostname ?? "");
  const [normalSamplingSeconds, setNormalSamplingSeconds] = useState(String(config?.sampling.normalIntervalSeconds ?? 30));
  const [slowSamplingSeconds, setSlowSamplingSeconds] = useState(String(config?.sampling.slowIntervalSeconds ?? 30));
  const fanSeries = mergeFanMetricSeries(
    snapshot?.metrics?.latest.fans ?? [],
    snapshot?.metrics?.series?.fans ?? [],
    snapshot?.generatedAt ?? snapshot?.metrics?.lastSeenAt ?? new Date().toISOString()
  );
  const temperatureSources = Array.isArray(backend?.temperatureSources) ? backend.temperatureSources : [];
  const temperatureSensorBackends = Array.isArray(backend?.temperatureSensorBackends) ? backend.temperatureSensorBackends : [];
  const metricDraftKey = enabledMetrics.join("|");
  const probeDraftKey = configuredProbes.map((selection) => `${selection.target}:${selection.provider}:${selection.enabled}`).join("|");
  const deviceDraftKey = JSON.stringify(config?.enabledDeviceIds ?? {});
  const instanceMetricDraftKey = JSON.stringify(config?.instanceMetricConfig ?? {});
  const runtimeDraftKey = `${config?.connection.hostname ?? ""}|${config?.sampling.normalIntervalSeconds ?? 30}|${config?.sampling.slowIntervalSeconds ?? 30}`;
  useEffect(() => {
    selectedMetricsRef.current = enabledMetrics;
    setSelectedMetrics(enabledMetrics);
  }, [metricDraftKey]);
  useEffect(() => {
    setProbeSelections(configuredProbes);
  }, [probeDraftKey]);
  useEffect(() => {
    setEnabledDeviceIds(config?.enabledDeviceIds ?? {});
  }, [deviceDraftKey]);
  useEffect(() => {
    setInstanceMetricConfig(config?.instanceMetricConfig ?? {});
  }, [instanceMetricDraftKey]);
  useEffect(() => {
    setAgentHostname(config?.connection.hostname ?? "");
    setNormalSamplingSeconds(String(config?.sampling.normalIntervalSeconds ?? 30));
    setSlowSamplingSeconds(String(config?.sampling.slowIntervalSeconds ?? 30));
  }, [runtimeDraftKey]);
  if (!backend || !config) return <EmptyState title="本机 Agent 尚未启动" detail="启动本机服务后才能查看和修改采集设置。" action={<Button variant="primary" onClick={() => void controlAgent("start")}>启动服务</Button>} />;

  const detectedGroups: DesktopDetectedTargetGroup[] = (() => {
    if (!fanSeries.length) return detectedTargets;
    const fanGroup = detectedTargets.find((group) => group.target === "fan");
    if (fanGroup?.instances.length) return detectedTargets;
    const configuredFanIds = enabledDeviceIds.fan;
    const fanInstances = fanSeries.map((fan) => ({
      id: fan.id,
      name: fan.name,
      subtitle: fan.interface,
      enabled: configuredFanIds ? configuredFanIds.includes(fan.id) : true,
      metrics: ["转速"]
    }));
    if (fanGroup) return detectedTargets.map((group) => group.target === "fan" ? { ...group, instances: fanInstances } : group);
    return [...detectedTargets, { target: "fan", label: "风扇实例", instances: fanInstances }];
  })();

  const isInstanceEnabled = (target: AgentProbeTarget, id: string, fallback: boolean) => {
    if (target === "connection") return fallback;
    const configuredIds = enabledDeviceIds[target];
    return configuredIds ? configuredIds.includes(id) : fallback;
  };

  const toggleDetectedInstance = (target: AgentProbeTarget, id: string, enabled: boolean) => {
    if (target === "connection") return;
    const group = detectedGroups.find((item) => item.target === target);
    const fallbackIds = group?.instances.filter((instance) => instance.enabled).map((instance) => instance.id) ?? [];
    const currentIds = enabledDeviceIds[target] ?? fallbackIds;
    const nextIds = enabled ? Array.from(new Set([...currentIds, id])) : currentIds.filter((item) => item !== id);
    const nextEnabledDeviceIds = { ...enabledDeviceIds, [target]: nextIds };
    setEnabledDeviceIds(nextEnabledDeviceIds);
    // Instance switches are actions in their own right. Persist immediately so
    // leaving and re-entering settings cannot restore the previous selection.
    void updateLocalConfig({ enabledDeviceIds: nextEnabledDeviceIds });
  };

  const saveCollectionConfig = () => void updateLocalConfig({ enabledMetrics: selectedMetricsRef.current, enabledDeviceIds, instanceMetricConfig, probeSelections });
  const updateInstanceMetricConfig = (instanceId: string, value: DeviceMetricKey[] | undefined) => {
    setInstanceMetricConfig((current) => {
      const next = { ...current };
      if (value === undefined) delete next[instanceId];
      else next[instanceId] = value;
      return next;
    });
  };
  const saveRuntimeConfig = () => {
    const normalIntervalSeconds = Math.max(1, Number.parseInt(normalSamplingSeconds, 10) || 30);
    const slowIntervalSeconds = Math.max(1, Number.parseInt(slowSamplingSeconds, 10) || normalIntervalSeconds);
    setNormalSamplingSeconds(String(normalIntervalSeconds));
    setSlowSamplingSeconds(String(slowIntervalSeconds));
    void updateLocalConfig({
      connection: { hostname: agentHostname.trim() },
      sampling: { normalIntervalSeconds, slowIntervalSeconds }
    });
  };
  const toggleMetric = (key: DeviceMetricKey) => {
    const current = selectedMetricsRef.current;
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    selectedMetricsRef.current = next;
    setSelectedMetrics(next);
    metricSaveQueueRef.current = metricSaveQueueRef.current
      .catch(() => undefined)
      .then(() => updateLocalConfig({ enabledMetrics: next }))
      .catch(() => undefined);
  };
  const updateProbe = (target: AgentProbeTarget, patch: { provider?: AgentProbeProvider; enabled?: boolean }) => {
    setProbeSelections((current) => {
      const existing = current.find((selection) => selection.target === target);
      if (existing) return current.map((selection) => selection.target === target ? { ...selection, ...patch } : selection);
      return [...current, { target, provider: patch.provider ?? "builtin", enabled: patch.enabled ?? true }];
    });
  };
  return (
    <div className="workspace-settings-stack">
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">服务状态</span><h3>本机 Agent</h3></div><StatusLabel state={backend.running ? "online" : "offline"} /></div>
        <div className="workspace-agent-actions"><Button variant="primary" onClick={() => void controlAgent(backend.running ? "stop" : "start")} disabled={refreshing || mutationPending}>{backend.running ? "停止服务" : "启动服务"}</Button><Button variant="quiet" onClick={() => void controlAgent("restart")} disabled={refreshing || mutationPending}>重启服务</Button><Button variant="quiet" onClick={() => void controlAgent("check-connection")} disabled={refreshing || mutationPending}>检查连接</Button><Button variant="quiet" onClick={() => void controlAgent("detect-probes")} disabled={refreshing || mutationPending}>重新检测硬件</Button></div>
        <div className="workspace-detail-list"><SummaryRow label="连接状态" value={backend.connectionStatus} /><SummaryRow label="上传间隔" value={`${backend.effectiveUploadIntervalSeconds} 秒`} /><SummaryRow label="待上传样本" value={backend.pendingSampleCount ? `${backend.pendingSampleCount} 条 · ${formatBytes(backend.pendingBytes)}` : "0 条"} /><SummaryRow label="配置文件" value={backend.configFileExists ? "已找到" : "未找到"} />{backend.lastUploadError && <SummaryRow label="最近上传错误" value={backend.lastUploadError} />}</div>
      </Surface>
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">Agent 身份与节奏</span><h3>设备显示名与采样间隔</h3></div></div>
        <div className="workspace-form workspace-agent-runtime-form">
          <label>设备显示名<input className="workspace-input" value={agentHostname} onChange={(event) => setAgentHostname(event.target.value)} placeholder="例如：办公室主机" maxLength={120} /></label>
          <div className="workspace-form__grid"><label>正常采样间隔（秒）<input className="workspace-input" type="number" min="1" max="86400" value={normalSamplingSeconds} onChange={(event) => setNormalSamplingSeconds(event.target.value)} /></label><label>降级采样间隔（秒）<input className="workspace-input" type="number" min="1" max="86400" value={slowSamplingSeconds} onChange={(event) => setSlowSamplingSeconds(event.target.value)} /></label></div>
          <p className="workspace-form__hint">采样间隔决定 Agent 多久采集一次数据；桌面端“数据刷新频率”只决定界面多久读取一次状态，两者互不替代。</p>
          <div className="workspace-form__actions"><Button variant="primary" onClick={saveRuntimeConfig} disabled={refreshing || mutationPending}>保存 Agent 设置</Button></div>
        </div>
      </Surface>
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">采集策略</span><h3>本机行为</h3></div></div>
        <div className="workspace-settings-list"><SettingRow label="自动启动采集" description="Agent 启动后自动开始采集硬件数据。"><Toggle checked={config.autoStartCollector} onChange={(checked) => void updateLocalConfig({ autoStartCollector: checked })} label="自动启动采集" disabled={mutationPending} /></SettingRow><SettingRow label="异常时自动重启" description="采集器异常退出后自动尝试恢复。"><Toggle checked={config.autoRestartCollector} onChange={(checked) => void updateLocalConfig({ autoRestartCollector: checked })} label="异常时自动重启" disabled={mutationPending} /></SettingRow><SettingRow label="采集与本地记录" description="关闭后停止采集器，不再生成新的本机样本。"><Toggle checked={config.dataRecordingEnabled} onChange={(checked) => void updateLocalConfig({ dataRecordingEnabled: checked })} label="采集与本地记录" disabled={mutationPending} /></SettingRow><SettingRow label="上传到中枢" description="允许本机 Agent 将采样数据上传到当前中枢；关闭后仍可保留本地配置。"><Toggle checked={config.cloudSyncEnabled} onChange={(checked) => void updateLocalConfig({ cloudSyncEnabled: checked })} label="上传到中枢" disabled={mutationPending} /></SettingRow></div>
      </Surface>
      <Surface className="workspace-collection-surface">
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">上报数据</span><h3>选择 Agent 采集内容</h3></div><span className="workspace-caption">已选 {selectedMetrics.length} 项</span></div>
        <p className="workspace-surface__description">按勾选项采集并上报指标；指标勾选会立即保存，离开页面后仍会保留。启用某个硬件探针时，Agent 可能自动补齐该探针运行所需的依赖指标；探针来源和实例覆盖完成后点击一次保存。</p>
        <div className="workspace-metric-option-grid">{metricGroups.map((group) => <div className="workspace-metric-option-group" key={group.label}><strong>{group.label}</strong>{group.items.map((item) => <label className="workspace-check-row" key={item.key}><input type="checkbox" checked={selectedMetrics.includes(item.key)} onChange={() => toggleMetric(item.key)} /><span>{item.label}</span></label>)}</div>)}</div>
        <div className="workspace-probe-config"><div className="workspace-probe-config__header"><div><strong>硬件探针</strong><span>先启用探针来源，再在下方决定每个实例是否上报。</span></div></div>{supportedProbePlans.map((plan) => { const selection = probeSelections.find((item) => item.target === plan.target); const providers = plan.providers.filter((provider): provider is AgentProbeProvider => provider in probeProviderLabels); const selectedProvider = selection?.provider && providers.includes(selection.provider) ? selection.provider : providers.includes(plan.default as AgentProbeProvider) ? plan.default as AgentProbeProvider : providers[0]; return <div className="workspace-probe-row" key={plan.target}><div><strong>{probeTargetLabels[plan.target]}</strong><small>{selection?.enabled === false ? "已停用" : "已启用"}</small></div><select className="workspace-select workspace-select--small" value={selectedProvider ?? "disabled"} onChange={(event) => updateProbe(plan.target, { provider: event.target.value as AgentProbeProvider })} disabled={!providers.length || mutationPending}>{providers.map((provider) => <option value={provider} key={provider}>{probeProviderLabels[provider]}</option>)}</select><Toggle checked={selection?.enabled ?? true} onChange={(enabled) => updateProbe(plan.target, { enabled })} label={`${probeTargetLabels[plan.target]} 探针`} disabled={mutationPending} /></div>; })}</div>
        <div className="workspace-form__actions"><Button variant="primary" onClick={saveCollectionConfig} disabled={refreshing || mutationPending}>保存探针与实例配置</Button><Button variant="quiet" onClick={() => void cloudPush()} disabled={refreshing || mutationPending}>同步到中枢</Button></div>
      </Surface>
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">检测结果</span><h3>已发现硬件</h3><p className="workspace-surface__description">关闭某个实例后立即停止上报并写入本机配置；探针来源和实例覆盖需点击“保存探针与实例配置”，指标勾选会立即保存。</p></div><span className="workspace-caption">{detectedGroups.reduce((count, group) => count + group.instances.length, 0)} 个实例</span></div>
        {detectedGroups.length ? <div className="workspace-detected-list">{detectedGroups.map((group) => <div className="workspace-detected-group" key={group.target}><strong>{group.label}</strong>{group.instances.map((instance) => { const enabled = isInstanceEnabled(group.target, instance.id, instance.enabled); return <div className="workspace-detected-row" key={instance.id}><div className="workspace-detected-row__identity"><strong>{instance.name}</strong>{instance.subtitle && <small>{instance.subtitle}</small>}<InstanceMetricOverride target={group.target} instanceId={instance.id} globalMetrics={selectedMetrics} override={instanceMetricConfig[instance.id]} onChange={(value) => updateInstanceMetricConfig(instance.id, value)} disabled={mutationPending} /></div><div className="workspace-detected-row__control"><small className={enabled ? "is-enabled" : "is-disabled"}>{enabled ? "上报中" : "不上传"}</small><Toggle checked={enabled} onChange={(checked) => toggleDetectedInstance(group.target, instance.id, checked)} label={`${instance.name} 上报`} disabled={mutationPending} /></div></div>; })}</div>)}</div> : <div className="workspace-muted-block">尚未检测到硬件探针，请点击“重新检测硬件”。</div>}
      </Surface>
      <AgentTemperatureSourcesPanel sensors={temperatureSources} backends={temperatureSensorBackends} probeError={backend.temperatureProbeError} />
    </div>
  );
}

function DataSettings() {
  const { snapshot, openExternal, capabilities } = useWorkspace();
  const update = snapshot?.update;
  const sourceLabel = snapshot?.source === "cache" ? "离线缓存" : snapshot?.source === "live" ? capabilities.canUseOfflineCache ? "实时连接" : "实时中枢" : "无数据";
  return <div className="workspace-settings-stack"><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">同步状态</span><h3>数据与更新</h3></div></div><div className="workspace-detail-list"><SummaryRow label="数据来源" value={sourceLabel} /><SummaryRow label={capabilities.canUseOfflineCache ? "缓存时间" : "最近同步"} value={capabilities.canUseOfflineCache ? formatDate(snapshot?.cache.savedAt) : formatPreciseDateTime(snapshot?.generatedAt)} />{capabilities.canUseOfflineCache && <SummaryRow label="缓存年龄" value={snapshot?.cache.ageSeconds == null ? "无" : `${snapshot.cache.ageSeconds} 秒`} />}<SummaryRow label="当前版本" value={update?.currentVersion ?? "未知"} /></div></Surface><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">版本</span><h3>{update?.available ? `可用更新：${update.latestVersion}` : "当前已是最新版本"}</h3></div>{update?.available && <StatusLabel state="warning" />}</div>{update?.message && <p className="workspace-surface__description">{update.message}</p>}{update?.releaseUrl && <Button variant="quiet" onClick={() => void openExternal(update.releaseUrl!)}>查看更新说明<Icon name="external" size={15} /></Button>}</Surface></div>;
}

function ShortcutSettings() {
  const shortcuts = [["/ 或 Ctrl/⌘ + K", "打开搜索和命令面板"], ["F5 或 Ctrl/⌘ + R", "刷新设备状态"], ["Esc", "关闭当前弹层"], ["Ctrl/⌘ + B", "折叠侧边栏"], ["Ctrl/⌘ + ,", "打开设置"]];
  return <Surface><div className="workspace-shortcut-list">{shortcuts.map(([key, description]) => <div className="workspace-shortcut-row" key={key}><kbd>{key}</kbd><span>{description}</span></div>)}</div></Surface>;
}

function AboutSettings() {
  const { snapshot, openExternal } = useWorkspace();
  return <Surface><div className="workspace-about"><div className="workspace-about__mark-wrap"><img className="workspace-about__mark-img" src={appIconSrc} alt="观澜" /></div><h3>观澜设备状态控制台</h3><p>面向本机 Agent 和接入中枢的状态工作区。</p><div className="workspace-detail-list"><SummaryRow label="版本" value={snapshot?.update?.currentVersion ?? "开发版本"} /><SummaryRow label="发布通道" value={snapshot?.update?.currentChannel ?? "测试"} /></div><div className="workspace-form__actions"><Button variant="quiet" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor")}><Icon name="external" size={15} />项目主页</Button><Button variant="quiet" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor/issues")}><Icon name="external" size={15} />报告问题</Button></div></div></Surface>;
}

function LoadingSurface() {
  return <div className="workspace-page"><div className="workspace-skeleton workspace-skeleton--hero" /><div className="workspace-skeleton workspace-skeleton--large" /><div className="workspace-skeleton workspace-skeleton--medium" /></div>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="workspace-empty"><div className="workspace-empty__mark"><Icon name="overview" size={22} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

function ErrorSurface({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return <EmptyState title={title} detail={detail} action={<Button variant="primary" onClick={onRetry}><Icon name="refresh" size={16} />重试</Button>} />;
}

function RouteView() {
  const { route, error, refresh, loading, snapshot } = useWorkspace();
  if (route.kind === "settings") return <SettingsPage />;
  if (loading && !snapshot) return <LoadingSurface />;
  if (route.kind === "device") return <DevicePage />;
  if (route.kind === "hub") return <HubPage />;
  if (error) return <ErrorSurface title="无法同步设备状态" detail={error} onRetry={() => void refresh()} />;
  return <OverviewPage />;
}

function WorkspaceBottomNav() {
  const { route, navigate, refresh, refreshing, mutationPending, setCommandOpen, setSidebarCollapsed, sidebarCollapsed } = useWorkspace();

  const scrollToTop = () => {
    const mainContent = document.getElementById("workspace-main-content");
    if (mainContent) {
      mainContent.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <nav className="workspace-bottom-nav" aria-label="快捷操作栏">
      <button
        type="button"
        className={`workspace-bottom-nav__item${route.kind === "overview" ? " is-active" : ""}`}
        onClick={() => navigate({ kind: "overview" })}
        title="返回总览"
      >
        <Icon name="overview" size={18} />
        <span>总览</span>
      </button>

      <button
        type="button"
        className={`workspace-bottom-nav__item${!sidebarCollapsed ? " is-active" : ""}`}
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        title="切换设备列表"
      >
        <Icon name="device" size={18} />
        <span>设备</span>
      </button>

      <button
        type="button"
        className="workspace-bottom-nav__item"
        onClick={() => void refresh()}
        disabled={refreshing || mutationPending}
        title="刷新状态"
      >
        <span className={`workspace-refresh-icon${refreshing ? " is-spinning" : ""}`}>
          <Icon name="refresh" size={18} />
        </span>
        <span>{refreshing ? "更新中" : mutationPending ? "保存中" : "刷新"}</span>
      </button>

      <button
        type="button"
        className="workspace-bottom-nav__item"
        onClick={() => setCommandOpen(true)}
        title="搜索设备与命令"
      >
        <Icon name="search" size={18} />
        <span>搜索</span>
      </button>

      <button
        type="button"
        className="workspace-bottom-nav__item"
        onClick={scrollToTop}
        title="返回顶部"
      >
        <Icon name="chevronUp" size={18} />
        <span>置顶</span>
      </button>
    </nav>
  );
}

function WorkspaceFrame() {
  const { sidebarCollapsed, setSidebarCollapsed, capabilities } = useWorkspace();
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const edgeSwipeRef = useRef<{ pointerId: number; startX: number } | null>(null);
  useEffect(() => {
    if (!sidebarCollapsed) setSidebarPeek(false);
  }, [sidebarCollapsed]);
  const handleEdgePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    edgeSwipeRef.current = { pointerId: event.pointerId, startX: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleEdgePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = edgeSwipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.clientX - gesture.startX > 24) {
      event.preventDefault();
      edgeSwipeRef.current = null;
      setSidebarCollapsed(false);
    }
  };
  const handleEdgePointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (edgeSwipeRef.current?.pointerId === event.pointerId) edgeSwipeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div className={clsx("workspace-root", !capabilities.canControlNativeWindow && "is-web", sidebarCollapsed && "is-sidebar-collapsed", !sidebarCollapsed && "is-sidebar-open", sidebarPeek && "is-sidebar-peek")}>
      {capabilities.canControlNativeWindow && <WindowTitleBar />}
      <WorkspaceSidebar sidebarPeek={sidebarPeek} onSidebarLeave={() => setSidebarPeek(false)} />
      {!sidebarCollapsed && <div className="workspace-sidebar-backdrop" onPointerDown={() => setSidebarCollapsed(true)} aria-hidden="true" />}
      <div className="workspace-main">
        <TopBar />
        <main className="workspace-content" id="workspace-main-content">
          <RouteView />
        </main>
      </div>
      {sidebarCollapsed && (
        <button
          className="workspace-sidebar-edge-trigger"
          type="button"
          aria-label="展开侧边栏"
          onClick={() => setSidebarCollapsed(false)}
          onMouseEnter={() => setSidebarPeek(true)}
          onPointerEnter={() => setSidebarPeek(true)}
          onPointerDown={handleEdgePointerDown}
          onPointerMove={handleEdgePointerMove}
          onPointerUp={handleEdgePointerEnd}
          onPointerCancel={handleEdgePointerEnd}
          onLostPointerCapture={handleEdgePointerEnd}
        />
      )}
      <WorkspaceBottomNav />
      <CommandPalette />
      <ShellNotice />
    </div>
  );
}

export function WorkspaceApp({ adapter, initialRoute }: { adapter: ConsoleAdapter; initialRoute?: import("./WorkspaceContext").WorkspaceRoute }) {
  return <WorkspaceProvider adapter={adapter} initialRoute={initialRoute}><WorkspaceFrame /></WorkspaceProvider>;
}

export default WorkspaceApp;
