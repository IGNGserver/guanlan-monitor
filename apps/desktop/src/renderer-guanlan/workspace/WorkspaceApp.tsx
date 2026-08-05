import React, { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { AgentProbeProvider, AgentProbeTarget, DeviceMetricKey, DeviceSummary, SamplePoint } from "@dsc/shared";
import clsx from "clsx";
import {
  SettingsSection,
  WorkspaceProvider,
  useWorkspace
} from "./WorkspaceContext";
import "./workspace.css";

type IconName =
  | "overview"
  | "hub"
  | "device"
  | "settings"
  | "back"
  | "search"
  | "refresh"
  | "collapse"
  | "chevron"
  | "external"
  | "copy"
  | "warning"
  | "check"
  | "clock"
  | "agent"
  | "appearance"
  | "connection"
  | "data"
  | "keyboard"
  | "about"
  | "arrow"
  | "windowMinimize"
  | "windowMaximize"
  | "windowRestore"
  | "windowClose";

const iconPaths: Record<IconName, string[]> = {
  overview: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  hub: ["M4 9h16", "M6 9V6l6-3 6 3v3", "M6 9v9", "M12 9v9", "M18 9v9", "M4 18h16"],
  device: ["M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M8 20h8", "M12 18v2"],
  settings: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-2.4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H6v-2.4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L7.3 8.6 9 6.9l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.1h2.4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1V14h-.1a1.7 1.7 0 0 0-1.6 1z"],
  back: ["M19 12H5", "M11 18l-6-6 6-6"],
  search: ["M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z", "m21 21-4.4-4.4"],
  refresh: ["M20 11a8.1 8.1 0 0 0-14.7-3L3 11", "M3 5v6h6", "M4 13a8.1 8.1 0 0 0 14.7 3L21 13", "M21 19v-6h-6"],
  collapse: ["M9 6 3 12l6 6", "M15 6l6 6-6 6"],
  chevron: ["m6 9 6 6 6-6"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"],
  copy: ["M8 8h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z", "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h0"],
  warning: ["M12 4 21 20H3L12 4z", "M12 10v4", "M12 17h.01"],
  check: ["m5 12 4 4L19 6"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  agent: ["M7 7h10v10H7z", "M4 10h3", "M17 10h3", "M10 4v3", "M14 4v3", "M10 17v3", "M14 17v3"],
  appearance: ["M12 3v18", "M3 12h18", "M5.6 5.6l12.8 12.8", "M18.4 5.6 5.6 18.4"],
  connection: ["M8 12h8", "M6 8h-1a4 4 0 0 0 0 8h1", "M18 8h1a4 4 0 0 1 0 8h-1", "M8 8a4 4 0 0 1 8 0v8a4 4 0 0 1-8 0V8z"],
  data: ["M4 5h16v14H4z", "M8 9h8", "M8 13h5", "M8 16h3"],
  keyboard: ["M4 6h16v12H4z", "M7 10h.01", "M10 10h.01", "M13 10h.01", "M16 10h.01", "M7 14h10"],
  about: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 10v6", "M12 7h.01"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  windowMinimize: ["M5 19h14"],
  windowMaximize: ["M5 5h14v14H5z"],
  windowRestore: ["M8 8h11v11H8z", "M5 16V5h11"],
  windowClose: ["m6 6 12 12", "m18 6L6 18"]
};

function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg className="workspace-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {iconPaths[name].map((path, index) => (
        <path key={`${name}-${index}`} d={path} />
      ))}
    </svg>
  );
}

function Button({
  children,
  onClick,
  variant = "secondary",
  className = "",
  disabled = false,
  type = "button",
  title
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button className={`workspace-button workspace-button--${variant} ${className}`} disabled={disabled} onClick={onClick} type={type} title={title}>
      {children}
    </button>
  );
}

function StatusDot({ state }: { state: "online" | "offline" | "cached" | "warning" | "unknown" }) {
  return <span className={`workspace-status-dot workspace-status-dot--${state}`} aria-hidden="true" />;
}

function StatusLabel({ state, compact = false }: { state: "online" | "offline" | "cached" | "warning" | "unknown"; compact?: boolean }) {
  const labels = { online: "在线", offline: "离线", cached: "缓存", warning: "异常", unknown: "未连接" };
  return (
    <span className={`workspace-status-label workspace-status-label--${state} ${compact ? "is-compact" : ""}`}>
      <StatusDot state={state} />
      {!compact && labels[state]}
    </span>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function MetricValue({ value, suffix = "%" }: { value: number | null | undefined; suffix?: string }) {
  return <span className="workspace-metric-value">{value == null ? "—" : `${value}${suffix}`}</span>;
}

function formatAxisTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function MiniTrend({
  points,
  label,
  valueFormatter = (value) => `${Math.round(value)}%`,
  fixedMaxValue = 100,
  compact = false
}: {
  points: SamplePoint[];
  label: string;
  valueFormatter?: (value: number) => string;
  fixedMaxValue?: number;
  compact?: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState(Math.max(points.length - 1, 0));
  useEffect(() => {
    setSelectedIndex(Math.max(points.length - 1, 0));
  }, [points]);

  if (!points.length) {
    return <div className={`workspace-trend workspace-trend--empty ${compact ? "workspace-trend--compact" : ""}`} aria-label={label} role="img"><div className="workspace-trend-empty">等待足够的遥测样本</div></div>;
  }

  const maxValue = Math.max(fixedMaxValue, Math.max(...points.map((point) => point.value), 1));
  const xFor = (index: number) => points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
  const yFor = (value: number) => 100 - Math.min(Math.max(value / maxValue, 0), 1) * 100;
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(2)} ${yFor(point.value).toFixed(2)}`).join(" ");
  const fillPath = `${linePath} L 100 100 L 0 100 Z`;
  const selected = points[Math.min(selectedIndex, points.length - 1)] ?? points[points.length - 1];
  const selectedX = xFor(Math.min(selectedIndex, points.length - 1));
  const selectedY = yFor(selected.value);

  const resolveIndex = (event: React.PointerEvent<HTMLDivElement>) => {
    if (points.length < 2) return 0;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 1;
    return Math.round(Math.min(Math.max(ratio, 0), 1) * (points.length - 1));
  };
  const selectPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    setSelectedIndex(resolveIndex(event));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  return (
    <div className="workspace-trend" aria-label={label} role="img">
      {!compact && <div className="workspace-trend__readout"><span>{formatAxisTime(selected.timestamp)}</span><strong>{label} {valueFormatter(selected.value)}</strong></div>}
      <div className={`workspace-trend__chart ${compact ? "workspace-trend__chart--compact" : ""}`} onPointerDown={selectPoint} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) selectPoint(event); }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="workspace-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--workspace-accent)" stopOpacity="0.22" /><stop offset="100%" stopColor="var(--workspace-accent)" stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3].map((index) => <line key={index} x1="0" x2="100" y1={(index / 3) * 100} y2={(index / 3) * 100} className="workspace-trend__grid" />)}
          <path d={fillPath} className="workspace-trend__fill" />
          <path d={linePath} className="workspace-trend__line" />
          <line x1={selectedX} x2={selectedX} y1="0" y2="100" className="workspace-trend__selection" />
          <circle cx={selectedX} cy={selectedY} r="4.8" className="workspace-trend__marker-outer" />
          <circle cx={selectedX} cy={selectedY} r="2.8" className="workspace-trend__marker" />
        </svg>
        <div className="workspace-trend-axis"><span>{valueFormatter(maxValue)}</span><span>{valueFormatter(0)}</span></div>
      </div>
      {!compact && points.length > 1 && <div className="workspace-trend__range"><span>{formatAxisTime(points[0].timestamp)}</span><span>{formatAxisTime(points[points.length - 1].timestamp)}</span></div>}
    </div>
  );
}

const metricGroups: Array<{ label: string; items: Array<{ key: DeviceMetricKey; label: string }> }> = [
  {
    label: "处理器",
    items: [
      { key: "cpuUsage", label: "CPU 使用率" },
      { key: "cpuFrequency", label: "CPU 频率" },
      { key: "cpuTemperature", label: "CPU 温度" },
      { key: "cpuTopology", label: "核心与线程" },
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
      { key: "gpuMemory", label: "显存使用" },
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
      { key: "fanChannelState", label: "通道状态" },
      { key: "fanNote", label: "风扇备注" }
    ]
  }
];

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
  wmi: "Windows WMI",
  libreHardwareMonitor: "LibreHardwareMonitor",
  openHardwareMonitor: "OpenHardwareMonitor",
  redfish: "Redfish",
  disabled: "禁用"
};

function WorkspaceSidebar({ sidebarPeek, onSidebarLeave }: { sidebarPeek: boolean; onSidebarLeave: () => void }) {
  const {
    route,
    sidebarCollapsed,
    setSidebarCollapsed,
    hubs,
    collapsedHubs,
    toggleHub,
    navigate,
    openSettings,
    closeSettings,
    openExternal,
    snapshot,
    devices
  } = useWorkspace();
  const inSettings = route.kind === "settings";
  const localDeviceId = snapshot?.localBackend?.config.connection.deviceId;
  const localDeviceAvailable = Boolean(localDeviceId && devices.some((device) => device.deviceId === localDeviceId));

  return (
    <aside className={`workspace-sidebar ${sidebarCollapsed ? "is-collapsed" : ""} ${inSettings ? "is-settings" : ""}`} onMouseLeave={() => { if (sidebarCollapsed && sidebarPeek) onSidebarLeave(); }}>
      <div className="workspace-sidebar__topline">
        <button className="workspace-brand" type="button" onClick={() => (inSettings ? closeSettings() : navigate({ kind: "overview" }))} aria-label="返回总览">
          <span className="workspace-brand__mark">澜</span>
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
          <div className="workspace-sidebar__label"><span>接入中枢</span><span className="workspace-sidebar__count">{hubs.length}</span></div>
          {hubs.map((hub) => {
            const collapsed = Boolean(collapsedHubs[hub.id]);
            const hubActive = route.kind === "hub" && route.hubId === hub.id;
            return (
              <div className="workspace-hub-group" key={hub.id}>
                <div className={`workspace-hub-heading ${hubActive ? "is-active" : ""}`}>
                  <button className="workspace-hub-heading__main" type="button" onClick={() => navigate({ kind: "hub", hubId: hub.id })} title={hub.name}>
                    <StatusDot state={hub.state === "online" ? "online" : hub.state === "cached" ? "cached" : hub.state === "offline" ? "warning" : "unknown"} />
                    <span className="workspace-hub-heading__name">{hub.name}</span>
                    <span className="workspace-hub-heading__count">{hub.devices.length}</span>
                  </button>
                  <button className="workspace-hub-heading__toggle" type="button" onClick={() => toggleHub(hub.id)} aria-label={collapsed ? `展开${hub.name}` : `折叠${hub.name}`}>
                    <Icon name="chevron" size={15} />
                  </button>
                </div>
                {!collapsed && (
                  <div className="workspace-device-list">
                    {hub.devices.length ? hub.devices.map((device) => (
                      <button className={`workspace-device-item ${route.kind === "device" && route.deviceId === device.deviceId ? "is-active" : ""}`} type="button" key={device.deviceId} onClick={() => navigate({ kind: "device", deviceId: device.deviceId })} title={device.hostname}>
                        <StatusDot state={device.status === "online" ? "online" : "offline"} />
                        <span className="workspace-device-item__copy"><strong>{device.hostname}</strong><small>{device.os} · <MetricValue value={device.cpuUsagePercent} /></small></span>
                      </button>
                    )) : <div className="workspace-sidebar__empty">尚未发现设备</div>}
                  </div>
                )}
              </div>
            );
          })}
          <div className="workspace-sidebar__spacer" />
          <button className={`workspace-nav-item ${route.kind === "device" && route.deviceId === localDeviceId ? "is-active" : ""}`} type="button" onClick={() => localDeviceAvailable ? navigate({ kind: "device", deviceId: localDeviceId! }) : openSettings("agent")} title="本机 Agent">
            <Icon name="agent" /> <span>本机 Agent</span>
          </button>
          <button className="workspace-nav-item" type="button" onClick={() => openSettings("connections")} title="连接设置">
            <Icon name="connection" /> <span>连接设置</span>
          </button>
        </nav>
      )}

      <div className="workspace-sidebar__footer">
        {inSettings ? (
          <button className="workspace-nav-item" type="button" onClick={closeSettings} title="返回设备控制台"><Icon name="back" /><span>返回控制台</span></button>
        ) : (
          <button className="workspace-nav-item" type="button" onClick={() => openSettings("general")} title="设置"><Icon name="settings" /><span>设置</span></button>
        )}
        <button className="workspace-sidebar__support" type="button" onClick={() => void openExternal("https://github.com/IGNGserver/Device-State-Console/issues")} title="打开帮助与反馈">
          <span>帮助与反馈</span><Icon name="external" size={14} />
        </button>
      </div>
    </aside>
  );
}

const settingsNav: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: "general", label: "通用", icon: "settings" },
  { id: "appearance", label: "外观", icon: "appearance" },
  { id: "connections", label: "中枢与连接", icon: "connection" },
  { id: "agent", label: "本机 Agent", icon: "agent" },
  { id: "data", label: "数据与更新", icon: "data" },
  { id: "shortcuts", label: "快捷键", icon: "keyboard" },
  { id: "about", label: "关于观澜", icon: "about" }
];

function SettingsSidebar() {
  const { route, navigate } = useWorkspace();
  return (
    <nav className="workspace-sidebar__nav" aria-label="设置导航">
      <div className="workspace-sidebar__section-title">设置</div>
      {settingsNav.map((item) => (
        <button className={`workspace-nav-item ${route.kind === "settings" && route.section === item.id ? "is-active" : ""}`} type="button" key={item.id} onClick={() => navigate({ kind: "settings", section: item.id })} title={item.label}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function WindowTitleBar() {
  const { minimizeWindow, toggleMaximizeWindow, closeWindow } = useWorkspace();
  const [isMaximized, setIsMaximized] = useState(false);
  const toggleMaximize = async () => {
    const next = await toggleMaximizeWindow();
    setIsMaximized(next);
  };
  return (
    <header className="workspace-windowbar">
      <div className="workspace-windowbar__drag" onDoubleClick={() => void toggleMaximize()}>
        <span className="workspace-windowbar__mark">澜</span>
        <strong>观澜</strong>
        <span className="workspace-windowbar__separator" aria-hidden="true" />
        <span className="workspace-windowbar__subtitle">设备状态控制台</span>
      </div>
      <div className="workspace-windowbar__controls" role="group" aria-label="窗口控制">
        <button className="workspace-window-control" type="button" onClick={() => void minimizeWindow()} aria-label="最小化" title="最小化"><Icon name="windowMinimize" size={15} /></button>
        <button className="workspace-window-control" type="button" onClick={() => void toggleMaximize()} aria-label={isMaximized ? "还原窗口" : "最大化"} title={isMaximized ? "还原窗口" : "最大化"}><Icon name={isMaximized ? "windowRestore" : "windowMaximize"} size={14} /></button>
        <button className="workspace-window-control workspace-window-control--close" type="button" onClick={() => void closeWindow()} aria-label="关闭窗口" title="关闭窗口"><Icon name="windowClose" size={15} /></button>
      </div>
    </header>
  );
}

function TopBar() {
  const { route, snapshot, refreshing, refresh, setCommandOpen, sidebarCollapsed, setSidebarCollapsed, openSettings } = useWorkspace();
  const title = route.kind === "overview" ? "总览" : route.kind === "device" ? "设备详情" : route.kind === "hub" ? "中枢详情" : settingsNav.find((item) => item.id === route.section)?.label ?? "设置";
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
        <Button variant="quiet" onClick={() => void refresh()} disabled={refreshing} title="刷新状态"><Icon name="refresh" size={16} />{!refreshing && <span>刷新</span>}</Button>
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
  const { commandOpen, setCommandOpen, searchQuery, setSearchQuery, filteredDevices, navigate, openSettings } = useWorkspace();
  const [activeIndex, setActiveIndex] = useState(0);
  if (!commandOpen) return null;
  const commands: Array<{ label: string; detail: string; action: () => void }> = [
    { label: "打开总览", detail: "查看所有中枢和设备状态", action: () => navigate({ kind: "overview" }) },
    { label: "打开连接设置", detail: "添加或重新认证中枢", action: () => openSettings("connections") },
    { label: "打开本机 Agent", detail: "控制本机采集服务", action: () => openSettings("agent") },
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
  return (
    <div className="workspace-overlay" role="presentation" onMouseDown={() => setCommandOpen(false)}>
      <section className="workspace-command" role="dialog" aria-modal="true" aria-label="搜索设备和命令" onMouseDown={(event) => event.stopPropagation()}>
        <div className="workspace-command__input"><Icon name="search" /><input autoFocus value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, filtered.length - 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); } else if (event.key === "Enter") { event.preventDefault(); select(activeIndex); } }} placeholder="搜索设备、页面或命令" /></div>
        <div className="workspace-command__list">
          {filtered.length ? filtered.map((command, index) => <button className={`workspace-command__item ${index === activeIndex ? "is-active" : ""}`} type="button" key={`${command.label}-${index}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => select(index)}><span><strong>{command.label}</strong><small>{command.detail}</small></span><Icon name="arrow" size={15} /></button>) : <div className="workspace-command__empty">没有匹配结果</div>}
        </div>
        <div className="workspace-command__footer"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>打开</span><span><kbd>Esc</kbd>关闭</span></div>
      </section>
    </div>
  );
}

function PageIntro({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <div className="workspace-page-intro"><div>{eyebrow && <div className="workspace-page-intro__eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="workspace-page-intro__actions">{actions}</div>}</div>;
}

function Surface({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`workspace-surface ${className}`}>{children}</section>;
}

function DeviceRow({ device }: { device: DeviceSummary }) {
  const { navigate } = useWorkspace();
  return <button className="workspace-device-row" type="button" onClick={() => navigate({ kind: "device", deviceId: device.deviceId })}><span className="workspace-device-row__status"><StatusDot state={device.status === "online" ? "online" : "offline"} /></span><span className="workspace-device-row__identity"><strong>{device.hostname}</strong><small>{device.os} · {device.deviceId}</small></span><span className="workspace-device-row__metric"><small>CPU</small><MetricValue value={device.cpuUsagePercent} /></span><span className="workspace-device-row__metric"><small>内存</small><MetricValue value={device.memoryUsagePercent} /></span><Icon name="arrow" size={15} /></button>;
}

function OverviewPage() {
  const { snapshot, hubs, devices, loading, error, refresh, navigate, openSettings } = useWorkspace();
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备状态" detail={error ?? "桌面桥接尚未准备好"} onRetry={() => void refresh()} />;
  const online = devices.filter((device) => device.status === "online").length;
  const offline = devices.length - online;
  const localRunning = snapshot.localBackend?.running;
  const cached = snapshot.source === "cache";
  const noData = snapshot.source === "empty" || devices.length === 0;
  const issueCount = offline + (cached ? 1 : 0) + (noData ? 1 : 0) + (snapshot.localBackend?.lastIssueCount ?? 0);
  const overviewLatest = snapshot.metrics?.latest;
  return <div className="workspace-page workspace-page--overview">
    <PageIntro eyebrow="系统状态" title={issueCount ? `${issueCount} 项事项需要留意` : "所有中枢运行正常"} description={`最后同步于 ${formatDate(snapshot.generatedAt)}。${cached ? "当前显示的是离线缓存。" : "数据来自实时连接。"}`} actions={<><Button variant="quiet" onClick={() => openSettings("connections")}><Icon name="connection" size={16} />连接设置</Button><Button variant="primary" onClick={() => void refresh()} disabled={loading}><Icon name="refresh" size={16} />刷新状态</Button></>} />
    {issueCount > 0 && <div className="workspace-attention"><div className="workspace-attention__icon"><Icon name="warning" /></div><div><strong>{cached ? "中枢连接需要确认" : noData ? "还没有可用设备" : "设备状态存在异常"}</strong><p>{cached ? "无法取得最新数据，页面中的设备信息可能已经过期。" : noData ? "连接中枢并等待设备上报后，这里会显示实时状态。" : `${offline} 台设备离线，${snapshot.localBackend?.lastIssueCount ?? 0} 条本机采集问题待处理。`}</p></div><Button variant="quiet" onClick={() => openSettings(cached || noData ? "connections" : "agent")}>查看详情<Icon name="arrow" size={15} /></Button></div>}
     {snapshot.metrics && <div className="workspace-metric-grid workspace-overview-metric-grid"><MetricTile label="CPU 使用率" value={overviewLatest?.cpuUsagePercent} detail={overviewLatest?.cpuTemperatureC == null ? "温度未采集" : `${overviewLatest.cpuTemperatureC}°C`} tone="blue" points={snapshot.metrics.series.cpuUsagePercent} /><MetricTile label="内存使用率" value={overviewLatest ? Math.round((overviewLatest.memoryUsedBytes / Math.max(overviewLatest.memoryTotalBytes, 1)) * 100) : null} detail={overviewLatest ? formatBytes(overviewLatest.memoryUsedBytes) : undefined} tone="green" points={snapshot.metrics.series.memoryUsagePercent} /><MetricTile label="GPU 使用率" value={overviewLatest?.gpus[0]?.utilizationPercent} detail={overviewLatest?.gpus[0]?.name ?? "未检测到 GPU"} tone="amber" points={snapshot.metrics.series.gpuUsagePercent} /><MetricTile label="磁盘使用率" value={overviewLatest ? Math.round((overviewLatest.diskUsedBytes / Math.max(overviewLatest.diskTotalBytes, 1)) * 100) : null} detail={overviewLatest ? formatBytes(overviewLatest.diskUsedBytes) : undefined} points={snapshot.metrics.series.diskUsagePercent} /></div>}
     <div className="workspace-overview-grid">
      <Surface className="workspace-overview-devices"><div className="workspace-surface__header"><div><span className="workspace-section-kicker">设备概览</span><h3>{devices.length} 台设备</h3></div><Button variant="quiet" onClick={() => navigate({ kind: "hub", hubId: hubs[0]?.id ?? "primary" })}>查看中枢<Icon name="arrow" size={15} /></Button></div><div className="workspace-device-rows">{devices.length ? devices.map((device) => <DeviceRow key={device.deviceId} device={device} />) : <EmptyState title="还没有设备" detail="连接一个中枢后，设备会出现在这里。" action={<Button variant="primary" onClick={() => openSettings("connections")}>添加中枢</Button>} />}</div></Surface>
      <div className="workspace-overview-column"><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">运行摘要</span><h3>当前连接</h3></div><StatusLabel state={cached ? "cached" : snapshot.session.authenticated ? "online" : "unknown"} /></div><div className="workspace-summary-list"><SummaryRow label="在线设备" value={`${online} / ${devices.length}`} /><SummaryRow label="离线设备" value={String(offline)} tone={offline ? "warning" : undefined} /><SummaryRow label="本机 Agent" value={localRunning ? "运行中" : "未运行"} tone={localRunning ? "success" : "warning"} /><SummaryRow label="数据源" value={cached ? "离线缓存" : snapshot.source === "empty" ? "暂无数据" : "实时同步"} /></div></Surface><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">资源趋势</span><h3>当前设备 CPU 使用率</h3></div><span className="workspace-caption">最近 1 小时</span></div><MiniTrend label="当前设备 CPU 使用率趋势" points={snapshot.metrics?.series.cpuUsagePercent ?? []} /><div className="workspace-trend-footer"><span>数据样本</span><strong>{snapshot.metrics?.series.cpuUsagePercent.length ?? 0}</strong></div></Surface></div>
    </div>
    <Surface className="workspace-hub-summary"><div className="workspace-surface__header"><div><span className="workspace-section-kicker">接入中枢</span><h3>连接概览</h3></div><Button variant="quiet" onClick={() => openSettings("connections")}>管理中枢</Button></div><div className="workspace-hub-summary__grid">{hubs.map((hub) => <button className="workspace-hub-summary__item" type="button" key={hub.id} onClick={() => navigate({ kind: "hub", hubId: hub.id })}><div><StatusLabel state={hub.state === "online" ? "online" : hub.state === "cached" ? "cached" : hub.state === "offline" ? "warning" : "unknown"} /><strong>{hub.name}</strong></div><span>{hub.endpoint}</span><small>{hub.devices.length} 台设备 <Icon name="arrow" size={14} /></small></button>)}</div></Surface>
  </div>;
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return <div className="workspace-summary-row"><span>{label}</span><strong className={tone ? `is-${tone}` : ""}>{value}</strong></div>;
}

function MetricTile({ label, value, detail, tone, points }: { label: string; value: number | null | undefined; detail?: string; tone?: "blue" | "green" | "amber"; points?: SamplePoint[] }) {
  return <div className={`workspace-metric-tile ${tone ? `workspace-metric-tile--${tone}` : ""}`}><div className="workspace-metric-tile__header"><span>{label}</span><MetricValue value={value} /></div>{points && <MiniTrend compact label={label} points={points} />}{!points && <div className="workspace-metric-tile__empty">暂无趋势数据</div>}<small>{detail ?? "未采集"}</small></div>;
}

function DevicePage() {
  const { selectedDevice, snapshot, navigate, openSettings, metricsWindow, setMetricsWindow, controlAgent, refreshing } = useWorkspace();
  if (!selectedDevice) return <EmptyState title="没有找到这台设备" detail="设备可能已被移除，或者中枢还没有返回它。" action={<Button variant="primary" onClick={() => navigate({ kind: "overview" })}>返回总览</Button>} />;
  const metrics = snapshot?.metrics?.device.deviceId === selectedDevice.deviceId ? snapshot.metrics : null;
  const localDevice = snapshot?.localBackend?.config.connection.deviceId === selectedDevice.deviceId;
  const latest = metrics?.latest;
  const series = metrics?.series.cpuUsagePercent ?? [];
  return <div className="workspace-page workspace-page--device">
    <PageIntro eyebrow={localDevice ? "本机设备" : "远端设备"} title={selectedDevice.hostname} description={`${selectedDevice.os} · ${selectedDevice.deviceId} · 最后心跳 ${formatDate(selectedDevice.lastSeenAt)}`} actions={<><Button variant="quiet" onClick={() => navigate({ kind: "overview" })}><Icon name="back" size={16} />返回总览</Button>{localDevice && <Button variant="primary" onClick={() => openSettings("agent")}><Icon name="agent" size={16} />本机设置</Button>}</>} />
    <div className="workspace-device-statusline"><StatusLabel state={selectedDevice.status === "online" ? "online" : "offline"} /><span>Agent {selectedDevice.agentVersion ? `v${selectedDevice.agentVersion}` : "版本未知"}</span><span>通道 {selectedDevice.agentChannel ?? "未知"}</span><span>数据更新时间 {formatDate(snapshot?.generatedAt)}</span></div>
     <div className="workspace-metric-grid"><MetricTile label="CPU 使用率" value={selectedDevice.cpuUsagePercent} detail={latest?.cpuTemperatureC == null ? "温度未采集" : `${latest.cpuTemperatureC}°C`} tone="blue" points={metrics?.series.cpuUsagePercent} /><MetricTile label="内存使用率" value={selectedDevice.memoryUsagePercent} detail={latest ? formatBytes(latest.memoryUsedBytes) : undefined} tone="green" points={metrics?.series.memoryUsagePercent} /><MetricTile label="GPU 使用率" value={selectedDevice.gpuUsagePercent} detail={latest?.gpus[0]?.name ?? "未检测到 GPU"} tone="amber" points={metrics?.series.gpuUsagePercent} /><MetricTile label="磁盘使用率" value={selectedDevice.diskUsagePercent} detail={latest ? formatBytes(latest.diskUsedBytes) : undefined} points={metrics?.series.diskUsagePercent} /></div>
    <div className="workspace-device-grid"><Surface className="workspace-device-chart"><div className="workspace-surface__header"><div><span className="workspace-section-kicker">遥测趋势</span><h3>CPU 使用率</h3></div><select className="workspace-select workspace-select--small" value={metricsWindow} onChange={(event) => setMetricsWindow(event.target.value as typeof metricsWindow)} aria-label="遥测时间范围"><option value="5m">5 分钟</option><option value="1h">1 小时</option><option value="6h">6 小时</option><option value="24h">24 小时</option><option value="7d">7 天</option></select></div><MiniTrend label="设备 CPU 使用率趋势" points={series} /><div className="workspace-trend-footer"><span>样本数</span><strong>{series.length}</strong><span>最后采样</span><strong>{formatDate(metrics?.lastSeenAt)}</strong></div></Surface><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">设备信息</span><h3>硬件与系统</h3></div><button className="workspace-icon-button" type="button" onClick={() => void navigator.clipboard?.writeText(selectedDevice.deviceId)} title="复制设备 ID"><Icon name="copy" /></button></div><div className="workspace-detail-list"><SummaryRow label="操作系统" value={selectedDevice.os} /><SummaryRow label="设备 ID" value={selectedDevice.deviceId} /><SummaryRow label="Agent 版本" value={selectedDevice.agentVersion ? `v${selectedDevice.agentVersion}` : "未知"} /><SummaryRow label="CPU 型号" value={latest?.cpuPackages[0]?.name ?? "未采集"} /><SummaryRow label="网络接收" value={latest ? formatBytes(latest.networkRxBytesPerSec) + "/s" : "未采集"} /><SummaryRow label="网络发送" value={latest ? formatBytes(latest.networkTxBytesPerSec) + "/s" : "未采集"} /></div></Surface></div>
    <div className="workspace-device-grid"><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">硬件实例</span><h3>GPU、磁盘与风扇</h3></div></div>{latest ? <div className="workspace-instance-list">{latest.gpus.map((gpu) => <InstanceRow key={gpu.id} label="GPU" name={gpu.name} value={`${gpu.utilizationPercent}%`} />)}{latest.disks.map((disk) => <InstanceRow key={disk.id} label="磁盘" name={`${disk.name} · ${disk.mountPoint}`} value={`${Math.round((disk.usedBytes / Math.max(disk.totalBytes, 1)) * 100)}%`} />)}{latest.fans.map((fan) => <InstanceRow key={fan.id} label="风扇" name={fan.label} value={`${fan.rpm} RPM`} />)}{!latest.gpus.length && !latest.disks.length && !latest.fans.length && <div className="workspace-muted-block">没有可展示的硬件实例。</div>}</div> : <div className="workspace-muted-block">这台设备暂时没有详细遥测数据。</div>}</Surface><Surface className="workspace-agent-surface"><div className="workspace-surface__header"><div><span className="workspace-section-kicker">操作</span><h3>{localDevice ? "本机 Agent" : "远端设备"}</h3></div><StatusLabel state={localDevice && snapshot?.localBackend?.running ? "online" : selectedDevice.status === "online" ? "online" : "offline"} /></div>{localDevice && snapshot?.localBackend ? <><p className="workspace-surface__description">本机采集服务负责向中枢上传设备状态和遥测数据。</p><div className="workspace-action-row"><Button variant="primary" onClick={() => void controlAgent("restart")} disabled={refreshing}>重启服务</Button><Button variant="quiet" onClick={() => void controlAgent(snapshot.localBackend?.running ? "stop" : "start")} disabled={refreshing}>{snapshot.localBackend.running ? "停止服务" : "启动服务"}</Button></div><div className="workspace-detail-list"><SummaryRow label="连接状态" value={snapshot.localBackend.connectionStatus} /><SummaryRow label="待上传样本" value={String(snapshot.localBackend.pendingSampleCount)} /><SummaryRow label="采集间隔" value={`${snapshot.localBackend.effectiveUploadIntervalSeconds}s`} /></div></> : <><p className="workspace-surface__description">远端设备只提供状态与遥测查看，不在此处修改采集配置。</p><Button variant="quiet" onClick={() => openSettings("connections")}>查看中枢连接</Button></>}</Surface></div>
  </div>;
}

function InstanceRow({ label, name, value }: { label: string; name: string; value: string }) {
  return <div className="workspace-instance-row"><span className="workspace-instance-row__label">{label}</span><span className="workspace-instance-row__name">{name}</span><strong>{value}</strong></div>;
}

function HubPage() {
  const { hubs, route, navigate, openSettings } = useWorkspace();
  const hub = hubs.find((item) => item.id === (route.kind === "hub" ? route.hubId : "")) ?? hubs[0];
  if (!hub) return <EmptyState title="没有配置中枢" detail="添加一个中枢后，设备会显示在侧边栏。" action={<Button variant="primary" onClick={() => openSettings("connections")}>添加中枢</Button>} />;
  const online = hub.devices.filter((device) => device.status === "online").length;
  return <div className="workspace-page"><PageIntro eyebrow="接入中枢" title={hub.name} description={hub.endpoint} actions={<><Button variant="quiet" onClick={() => navigate({ kind: "overview" })}><Icon name="back" size={16} />返回总览</Button><Button variant="primary" onClick={() => openSettings("connections")}><Icon name="settings" size={16} />管理连接</Button></>} /><div className="workspace-hub-hero"><div><StatusLabel state={hub.state === "online" ? "online" : hub.state === "cached" ? "cached" : hub.state === "offline" ? "warning" : "unknown"} /><strong>{hub.state === "online" ? "连接正常" : hub.state === "cached" ? "正在显示缓存" : "需要检查连接"}</strong><p>{online} 台设备在线，共 {hub.devices.length} 台设备。</p></div><div className="workspace-hub-hero__stat"><span>设备</span><strong>{hub.devices.length}</strong></div><div className="workspace-hub-hero__stat"><span>在线</span><strong>{online}</strong></div></div><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">设备列表</span><h3>{hub.devices.length} 台设备</h3></div><Button variant="quiet" onClick={() => openSettings("connections")}>连接设置</Button></div><div className="workspace-device-rows">{hub.devices.map((device) => <DeviceRow key={device.deviceId} device={device} />)}</div></Surface></div>;
}

function SettingsPage() {
  const { route } = useWorkspace();
  const section = route.kind === "settings" ? route.section : "general";
  const pages: Record<SettingsSection, React.ReactNode> = {
    general: <GeneralSettings />,
    appearance: <AppearanceSettings />,
    connections: <ConnectionSettings />,
    agent: <AgentSettings />,
    data: <DataSettings />,
    shortcuts: <ShortcutSettings />,
    about: <AboutSettings />
  };
  const heading = settingsNav.find((item) => item.id === section);
  return <div className="workspace-page workspace-page--settings"><PageIntro eyebrow="设置" title={heading?.label ?? "设置"} description={section === "general" ? "调整观澜的日常行为。" : undefined} />{pages[section]}</div>;
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return <div className="workspace-setting-row"><div><strong>{label}</strong>{description && <p>{description}</p>}</div><div className="workspace-setting-row__control">{children}</div></div>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <label className="workspace-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} /><span className="workspace-toggle__track"><span /></span></label>;
}

function GeneralSettings() {
  const { snapshot, updateStartupSettings, refreshInterval, setRefreshInterval } = useWorkspace();
  const startup = snapshot?.startup ?? { openAtLogin: false, startMinimized: false };
  return <Surface><div className="workspace-settings-list"><SettingRow label="开机启动" description="登录系统后自动启动观澜。"><Toggle checked={startup.openAtLogin} onChange={(checked) => void updateStartupSettings({ openAtLogin: checked })} label="开机启动" /></SettingRow><SettingRow label="启动时最小化" description="启动后保持在系统托盘，不打断当前工作。"><Toggle checked={startup.startMinimized} onChange={(checked) => void updateStartupSettings({ startMinimized: checked })} label="启动时最小化" /></SettingRow><SettingRow label="数据刷新频率" description="实时连接下，桌面端自动刷新状态的间隔。"><select className="workspace-select" value={refreshInterval} onChange={(event) => setRefreshInterval(Number(event.target.value) as typeof refreshInterval)}><option value="5">5 秒</option><option value="10">10 秒</option><option value="30">30 秒</option></select></SettingRow></div></Surface>;
}

function AppearanceSettings() {
  const { theme, setTheme, density, setDensity } = useWorkspace();
  return <Surface><div className="workspace-settings-list"><SettingRow label="主题" description="跟随系统，或固定使用浅色/深色主题。"><select className="workspace-select" value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></SettingRow><SettingRow label="界面密度" description="紧凑适合大屏监控，舒适适合日常操作。"><select className="workspace-select" value={density} onChange={(event) => setDensity(event.target.value as typeof density)}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></SettingRow><SettingRow label="动画" description="尊重系统的减少动态效果设置。"><span className="workspace-setting-note"><Icon name="check" size={15} />已启用可访问性适配</span></SettingRow></div></Surface>;
}

function ConnectionSettings() {
  const { snapshot, saveHubConnection, logout } = useWorkspace();
  const [serverUrl, setServerUrl] = useState(snapshot?.localBackend?.config.connection.serverUrl ?? "");
  const [accessKey, setAccessKey] = useState("");
  const [saving, setSaving] = useState(false);
  const authenticated = snapshot?.session.authenticated ?? false;
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
  return <div className="workspace-settings-stack"><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">当前中枢</span><h3>{authenticated ? "已连接" : "需要认证"}</h3></div><StatusLabel state={authenticated ? "online" : "warning"} /></div><form className="workspace-form workspace-connection-form" onSubmit={saveConnection}><label>中枢地址<input className="workspace-input" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://hub.example.com" autoComplete="url" required /></label><label>访问密钥<input className="workspace-input" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder={snapshot?.session.accessKeyConfigured ? "已保存，留空保留当前认证" : "输入中枢访问密钥"} autoComplete="current-password" required={!snapshot?.session.accessKeyConfigured} /></label><p className="workspace-form__hint">地址和访问密钥会在同一次保存中提交。访问密钥只会发送到桌面主进程，不会进入页面状态或日志。</p><div className="workspace-form__actions"><Button variant="primary" type="submit" disabled={saving}>{saving ? "正在保存…" : authenticated ? "保存连接" : "保存并连接"}</Button>{authenticated && <Button variant="quiet" onClick={() => void logout()} disabled={saving}>断开连接</Button>}</div></form></Surface><Surface className="workspace-connection-note"><div className="workspace-surface__header"><div><span className="workspace-section-kicker">连接诊断</span><h3>如果连接失败</h3></div></div><p className="workspace-surface__description">请确认地址包含协议（例如 https://），中枢服务已启动，并使用中枢访问密钥。保存按钮会先写入地址，再用同一地址完成认证，避免出现 server url is missing。</p></Surface></div>;
}

function AgentSettings() {
  const { snapshot, controlAgent, updateLocalConfig, cloudPush, refreshing } = useWorkspace();
  const backend = snapshot?.localBackend;
  const config = backend?.config;
  const enabledMetrics = config?.enabledMetrics ?? [];
  const configuredProbes = config?.probeSelections ?? [];
  const [selectedMetrics, setSelectedMetrics] = useState<DeviceMetricKey[]>(enabledMetrics);
  const [probeSelections, setProbeSelections] = useState(configuredProbes);
  const metricDraftKey = enabledMetrics.join("|");
  const probeDraftKey = configuredProbes.map((selection) => `${selection.target}:${selection.provider}:${selection.enabled}`).join("|");
  useEffect(() => {
    setSelectedMetrics(enabledMetrics);
  }, [metricDraftKey]);
  useEffect(() => {
    setProbeSelections(configuredProbes);
  }, [probeDraftKey]);
  if (!backend || !config) return <EmptyState title="本机 Agent 尚未启动" detail="启动本机服务后才能查看和修改采集设置。" action={<Button variant="primary" onClick={() => void controlAgent("start")}>启动服务</Button>} />;
  const saveCollectionConfig = () => void updateLocalConfig({ enabledMetrics: selectedMetrics, probeSelections });
  const toggleMetric = (key: DeviceMetricKey) => {
    setSelectedMetrics((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };
  const updateProbe = (target: AgentProbeTarget, patch: { provider?: AgentProbeProvider; enabled?: boolean }) => {
    setProbeSelections((current) => {
      const existing = current.find((selection) => selection.target === target);
      if (existing) return current.map((selection) => selection.target === target ? { ...selection, ...patch } : selection);
      return [...current, { target, provider: patch.provider ?? "builtin", enabled: patch.enabled ?? true }];
    });
  };
  return <div className="workspace-settings-stack"><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">服务状态</span><h3>本机 Agent</h3></div><StatusLabel state={backend.running ? "online" : "offline"} /></div><div className="workspace-agent-actions"><Button variant="primary" onClick={() => void controlAgent(backend.running ? "stop" : "start")} disabled={refreshing}>{backend.running ? "停止服务" : "启动服务"}</Button><Button variant="quiet" onClick={() => void controlAgent("restart")} disabled={refreshing}>重启服务</Button><Button variant="quiet" onClick={() => void controlAgent("check-connection")} disabled={refreshing}>检查连接</Button><Button variant="quiet" onClick={() => void controlAgent("detect-probes")} disabled={refreshing}>重新检测硬件</Button></div><div className="workspace-detail-list"><SummaryRow label="连接状态" value={backend.connectionStatus} /><SummaryRow label="上传间隔" value={`${backend.effectiveUploadIntervalSeconds} 秒`} /><SummaryRow label="待上传样本" value={`${backend.pendingSampleCount} 条`} /><SummaryRow label="配置文件" value={backend.configFileExists ? "已找到" : "未找到"} /></div></Surface><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">采集策略</span><h3>本机行为</h3></div></div><div className="workspace-settings-list"><SettingRow label="自动启动采集" description="Agent 启动后自动开始采集硬件数据。"><Toggle checked={config.autoStartCollector} onChange={(checked) => void updateLocalConfig({ autoStartCollector: checked })} label="自动启动采集" /></SettingRow><SettingRow label="异常时自动重启" description="采集器异常退出后自动尝试恢复。"><Toggle checked={config.autoRestartCollector} onChange={(checked) => void updateLocalConfig({ autoRestartCollector: checked })} label="异常时自动重启" /></SettingRow><SettingRow label="上传到中枢" description="允许本机 Agent 将采样数据上传到当前中枢。"><Toggle checked={config.cloudSyncEnabled} onChange={(checked) => void updateLocalConfig({ cloudSyncEnabled: checked })} label="上传到中枢" /></SettingRow></div></Surface><Surface className="workspace-collection-surface"><div className="workspace-surface__header"><div><span className="workspace-section-kicker">上报数据</span><h3>选择 Agent 采集内容</h3></div><span className="workspace-caption">已选 {selectedMetrics.length} 项</span></div><p className="workspace-surface__description">只采集并上报你勾选的指标；未选择的指标不会进入本机采集队列。完成选择后点击一次保存。</p><div className="workspace-metric-option-grid">{metricGroups.map((group) => <div className="workspace-metric-option-group" key={group.label}><strong>{group.label}</strong>{group.items.map((item) => <label className="workspace-check-row" key={item.key}><input type="checkbox" checked={selectedMetrics.includes(item.key)} onChange={() => toggleMetric(item.key)} /><span>{item.label}</span></label>)}</div>)}</div><div className="workspace-probe-config"><div className="workspace-probe-config__header"><div><strong>硬件探针</strong><span>选择每类硬件使用的采集来源。</span></div></div>{backend.supportedProbePlans.map((plan) => { const selection = probeSelections.find((item) => item.target === plan.target); const providers = plan.providers.filter((provider): provider is AgentProbeProvider => provider in probeProviderLabels); return <div className="workspace-probe-row" key={plan.target}><div><strong>{probeTargetLabels[plan.target]}</strong><small>{selection?.enabled === false ? "已停用" : "已启用"}</small></div><select className="workspace-select workspace-select--small" value={selection?.provider ?? plan.default} onChange={(event) => updateProbe(plan.target, { provider: event.target.value as AgentProbeProvider })}>{providers.map((provider) => <option value={provider} key={provider}>{probeProviderLabels[provider]}</option>)}</select><Toggle checked={selection?.enabled ?? true} onChange={(enabled) => updateProbe(plan.target, { enabled })} label={`${probeTargetLabels[plan.target]} 探针`} /></div>; })}</div><div className="workspace-form__actions"><Button variant="primary" onClick={saveCollectionConfig} disabled={refreshing}>保存采集配置</Button><Button variant="quiet" onClick={() => void cloudPush()} disabled={refreshing}>同步到中枢</Button></div></Surface><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">检测结果</span><h3>已发现硬件</h3></div><span className="workspace-caption">{backend.detectedTargets.reduce((count, group) => count + group.instances.length, 0)} 个实例</span></div>{backend.detectedTargets.length ? <div className="workspace-detected-list">{backend.detectedTargets.map((group) => <div className="workspace-detected-group" key={group.target}><strong>{group.label}</strong>{group.instances.map((instance) => <div className="workspace-detected-row" key={instance.id}><span>{instance.name}</span><small>{instance.enabled ? "可用" : "已停用"}</small></div>)}</div>)}</div> : <div className="workspace-muted-block">尚未检测到硬件探针，请点击“重新检测硬件”。</div>}</Surface></div>;
}

function DataSettings() {
  const { snapshot, openExternal } = useWorkspace();
  const update = snapshot?.update;
  return <div className="workspace-settings-stack"><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">缓存</span><h3>数据与更新</h3></div></div><div className="workspace-detail-list"><SummaryRow label="数据来源" value={snapshot?.source === "cache" ? "离线缓存" : snapshot?.source === "live" ? "实时连接" : "无数据"} /><SummaryRow label="缓存时间" value={formatDate(snapshot?.cache.savedAt)} /><SummaryRow label="缓存年龄" value={snapshot?.cache.ageSeconds == null ? "—" : `${snapshot.cache.ageSeconds} 秒`} /><SummaryRow label="当前版本" value={update?.currentVersion ?? "未知"} /></div></Surface><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">版本</span><h3>{update?.available ? `可用更新：${update.latestVersion}` : "当前已是最新版本"}</h3></div>{update?.available && <StatusLabel state="warning" />}</div>{update?.message && <p className="workspace-surface__description">{update.message}</p>}{update?.releaseUrl && <Button variant="quiet" onClick={() => void openExternal(update.releaseUrl!)}>查看更新说明<Icon name="external" size={15} /></Button>}</Surface></div>;
}

function ShortcutSettings() {
  const shortcuts = [["/ 或 Ctrl/⌘ + K", "打开搜索和命令面板"], ["F5 或 Ctrl/⌘ + R", "刷新设备状态"], ["Esc", "关闭当前弹层"], ["Ctrl/⌘ + B", "折叠侧边栏"], ["Ctrl/⌘ + ,", "打开设置"]];
  return <Surface><div className="workspace-shortcut-list">{shortcuts.map(([key, description]) => <div className="workspace-shortcut-row" key={key}><kbd>{key}</kbd><span>{description}</span></div>)}</div></Surface>;
}

function AboutSettings() {
  const { snapshot, openExternal } = useWorkspace();
  return <Surface><div className="workspace-about"><div className="workspace-about__mark">澜</div><h3>观澜设备状态控制台</h3><p>面向本机 Agent 和接入中枢的状态工作区。</p><div className="workspace-detail-list"><SummaryRow label="版本" value={snapshot?.update?.currentVersion ?? "开发版本"} /><SummaryRow label="发布通道" value={snapshot?.update?.currentChannel ?? "测试"} /></div><div className="workspace-form__actions"><Button variant="quiet" onClick={() => void openExternal("https://github.com/IGNGserver/Device-State-Console")}><Icon name="external" size={15} />项目主页</Button><Button variant="quiet" onClick={() => void openExternal("https://github.com/IGNGserver/Device-State-Console/issues")}><Icon name="external" size={15} />报告问题</Button></div></div></Surface>;
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

function WorkspaceFrame() {
  const { sidebarCollapsed } = useWorkspace();
  const [sidebarPeek, setSidebarPeek] = useState(false);
  useEffect(() => {
    if (!sidebarCollapsed) setSidebarPeek(false);
  }, [sidebarCollapsed]);
  return <div className={clsx("workspace-root", sidebarCollapsed && "is-sidebar-collapsed", sidebarPeek && "is-sidebar-peek")}><WindowTitleBar /><WorkspaceSidebar sidebarPeek={sidebarPeek} onSidebarLeave={() => setSidebarPeek(false)} /><div className="workspace-main"><TopBar /><main className="workspace-content" id="workspace-main-content"><RouteView /></main></div>{sidebarCollapsed && <button className="workspace-sidebar-edge-trigger" type="button" aria-label="展开侧边栏" onMouseEnter={() => setSidebarPeek(true)} onPointerEnter={() => setSidebarPeek(true)} />}<CommandPalette /><ShellNotice /></div>;
}

export function WorkspaceApp() {
  return <WorkspaceProvider><WorkspaceFrame /></WorkspaceProvider>;
}

export default WorkspaceApp;
