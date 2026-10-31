import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceBlockKey, DeviceMetricKey, MetricsLatest } from "@dsc/shared";
import { M3SegmentedControl, M3Tabs, M3Select } from "../m3";
import type { TouchPanel } from "../touch/TouchState";
import { touchPercent } from "../touch/TouchDeviceRow";
import { useWorkspace } from "../WorkspaceContext";
import { normalizeDeviceGroup, selectExistingGroupNames, selectLinkLabel, selectSnapshotSource } from "../selectors";
import {
  DEFAULT_DEVICE_TAB_ID,
  DEVICE_DASHBOARD,
  DashboardGrid,
  DashboardSection,
  deviceTabAnchors,
  findDeviceTab,
  type DeviceSectionId,
  type DeviceTabId
} from "../dashboard";
import {
  averageSamplePointsOrFallback,
  describeNetworkIdentity,
  displayInstanceName,
  displayModelName,
  formatBytes,
  formatCapacitySummary,
  formatDate,
  formatGpuMemorySummary,
  formatReleaseChannel,
  sumSamplePoints
} from "../formatters";
import { Button, Icon, StatusDot } from "../ui";
import { DeviceChartCells, type DeviceChartContext, type DeviceSectionControls } from "./deviceCharts";
import { describeIssue, evaluateDevice, metricTone } from "../health";
import { CapacityBar } from "../charts";
import { DeviceKpiStrip, capacityCaption, shareOf } from "./DeviceKpiStrip";
import { LiveTopicPanel, useLiveCapabilities } from "./LiveDevicePanel";
import type { DeviceLiveView } from "../routes";
import {
  DeviceGroupDialog,
  EmptyState,
  InstanceFilter,
  MetricsLoadingSurface,
  MetricWindowControl,
  PageIntro,
  SnapshotFreshnessNotice,
  isMetricUnavailable,
  mergeFanMetricSeries,
  metricWindowLabel,
  type DesktopMetricWindowValue
} from "./shared";

/**
 * 设备详情页。
 *
 * 页面结构完全由 `DEVICE_DASHBOARD` 常量决定：选项卡、分区、图表与栅格跨度都是
 * 编译期字面量，运行期不再从服务端读取布局文档，也没有拖拽编辑与自定义面板。
 * 这里只保留三件与布局无关的事情：时间范围、实例筛选、整页全屏。
 */
export function DeviceDetailsPage({ presentation = "desktop", touchPanel = "status", onTouchPanelChange, touchTab = DEFAULT_DEVICE_TAB_ID, onTouchTabChange }: {
  presentation?: "desktop" | "touch";
  touchPanel?: TouchPanel;
  onTouchPanelChange?: (panel: TouchPanel) => void;
  touchTab?: DeviceTabId;
  onTouchTabChange?: (tab: DeviceTabId) => void;
} = {}) {
  const touch = presentation === "touch";
  const {
    selectedDevice,
    allDevices,
    snapshot,
    navigate,
    openSettings,
    loading,
    refreshing,
    mutationPending,
    refresh,
    updateDeviceGroup,
    metricsWindow,
    setMetricsWindow,
    trafficMode,
    setTrafficMode,
    shiftTrafficAnchor,
    capabilities,
    healthThresholds,
    route
  } = useWorkspace();
  const [editingGroup, setEditingGroup] = useState(false);
  const existingGroups = useMemo(() => selectExistingGroupNames(allDevices), [allDevices]);
  const snapshotSource = snapshot ? selectSnapshotSource(snapshot, snapshot.devices) : "unknown";
  const deviceSourceState: "online" | "offline" | "cached" | "warning" | "unknown" = snapshotSource === "cache"
    ? "cached"
    : snapshotSource === "live"
      ? "online"
      : snapshotSource === "empty"
        ? "unknown"
        : "warning";

  const [desktopTab, setDesktopTab] = useState<DeviceTabId>(DEFAULT_DEVICE_TAB_ID);
  const activeTab = touch ? (touchPanel === "trends" ? touchTab : "overview") : desktopTab;
  const setActiveTab = (id: DeviceTabId) => touch ? onTouchTabChange?.(id) : setDesktopTab(id);
  /* Live views read the device itself, on demand. Processes and containers are
     tabs (and part of the link, so they can be bookmarked); live metrics are a
     range of the overview. None of them starts a request until it is shown. */
  const routeLiveView: DeviceLiveView | null = route.kind === "device" ? route.view ?? null : null;
  const liveView: DeviceLiveView | null = touch ? (touchPanel === "processes" || touchPanel === "containers" ? touchPanel : null) : routeLiveView;
  const [liveOverview, setLiveOverview] = useState(false);
  const [touchLive, setTouchLive] = useState(false);
  const liveAuthenticated = snapshotSource === "live" && snapshot?.session.authenticated === true;
  const liveCapabilities = useLiveCapabilities(selectedDevice?.deviceId ?? "", Boolean(selectedDevice) && liveAuthenticated);
  // Hidden only once the Hub has confirmed a ready session without Docker; an
  // offline device keeps the tab where the reader expects it.
  const showContainers = liveView === "containers" || liveCapabilities === null || liveCapabilities.includes("docker");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const deviceContextRef = useRef<HTMLDivElement>(null);

  // 全屏只是一个查看辅助：宿主拒绝 Fullscreen API 时按钮静默失效，页面照常可用。
  const toggleFullscreen = () => {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    rootRef.current?.requestFullscreen().catch(() => undefined);
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const tab = useMemo(() => findDeviceTab(activeTab), [activeTab]);
  const anchors = useMemo(() => deviceTabAnchors(tab), [tab]);
  const [activeAnchor, setActiveAnchor] = useState("");

  const changeTab = (nextTab: string) => {
    const matched = DEVICE_DASHBOARD.tabs.find((item) => item.id === nextTab);
    if (!matched || matched.id === activeTab) return;
    setActiveTab(matched.id);
  };

  const scrollToAnchor = (anchorId: string) => {
    const target = document.getElementById(anchorId);
    if (!target) return;
    setActiveAnchor(anchorId);
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  useEffect(() => {
    setActiveAnchor(anchors[0]?.id ?? "");
    const root = document.getElementById("workspace-main-content");
    const targets = anchors
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
  }, [anchors]);

  /* The sticky device-context bar is what `scroll-padding-top` has to clear when
     an anchor jumps. Its height is content-driven (tabs + controls + an optional
     caption + the anchor row), so the 76px token in `workspace.tokens.css` was a
     guess: on a tab that renders a caption *and* an anchor row, the section
     heading landed underneath the bar after `scrollIntoView`. Publish the
     measured height to the token the scroller reads instead of keeping a second
     magic number in sync by hand. */
  useEffect(() => {
    const context = deviceContextRef.current;
    const scroller = document.getElementById("workspace-main-content");
    if (!context || !scroller || typeof ResizeObserver === "undefined") return;
    const syncOffset = () => {
      const height = context.getBoundingClientRect().height;
      if (height > 0) scroller.style.setProperty("--workspace-sticky-offset", `${Math.round(height)}px`);
    };
    syncOffset();
    const observer = new ResizeObserver(syncOffset);
    observer.observe(context);
    return () => {
      observer.disconnect();
      scroller.style.removeProperty("--workspace-sticky-offset");
    };
  }, [activeTab]);

  // 多实例单选状态：切换设备时一并复位，避免把上一台设备的实例 id 带过来。
  const [selectedNetId, setSelectedNetId] = useState("all");
  const [selectedDiskId, setSelectedDiskId] = useState("all");
  const [selectedGpuId, setSelectedGpuId] = useState("all");
  const deviceId = selectedDevice?.deviceId;

  useEffect(() => {
    setSelectedNetId("all");
    setSelectedDiskId("all");
    setSelectedGpuId("all");
    if (!touch) setDesktopTab(DEFAULT_DEVICE_TAB_ID);
    setLiveOverview(false);
    setTouchLive(false);
  }, [deviceId, touch]);

  // A link to a live view opens the same view in the touch layout.
  useEffect(() => {
    if (touch && routeLiveView) onTouchPanelChange?.(routeLiveView);
    // Only on arrival: afterwards the touch tabs own the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch, routeLiveView, deviceId]);

  // Devices this page has already served a telemetry payload for, this session.
  // Keyed by id, so one machine's history cannot excuse another one's charts.
  const seenMetricsDevicesRef = useRef<Set<string>>(new Set());

  if (!selectedDevice) {
    return (
      <EmptyState
        title="没有找到这台设备"
        detail="设备可能已被移除，或者中枢还没有返回它。"
        action={<Button variant="primary" onClick={() => navigate({ kind: "devices" })}>返回设备目录</Button>}
      />
    );
  }

  const metricsPayloadForDevice = snapshot?.metrics?.device.deviceId === selectedDevice.deviceId ? snapshot.metrics : null;
  // Once this device has produced a telemetry payload in the session, a later
  // null means "the read for what is on screen did not land" — a range switch,
  // or a metrics request that failed on its own — and not "the Agent has never
  // reported". Latched during render because the payload itself is transient.
  if (snapshot?.metrics) seenMetricsDevicesRef.current.add(snapshot.metrics.device.deviceId);
  const hadTelemetryHere = seenMetricsDevicesRef.current.has(selectedDevice.deviceId);
  const metrics =
    metricsPayloadForDevice &&
    (!metricsPayloadForDevice.window || metricsPayloadForDevice.window === metricsWindow)
      ? metricsPayloadForDevice
      : null;
  const telemetryMissing = !metrics || !metrics.series;
  const windowLabel = metricWindowLabel(metricsWindow);
  /**
   * What the missing charts actually mean, in the order the reader can act on:
   * waiting for this range, this range did not arrive, or nothing yet at all.
   */
  const telemetryState: "ready" | "pending" | "range" | "none" = !telemetryMissing
    ? "ready"
    : loading || refreshing
      ? "pending"
      : metricsPayloadForDevice || hadTelemetryHere
        ? "range"
        : "none";
  const latest = metrics?.latest;
  const series = metrics?.series;
  const metricUnavailable = (key: DeviceMetricKey) => isMetricUnavailable(selectedDevice, key, latest);
  const enabledDeviceIds = metrics?.enabledDeviceIds;
  const hasInstanceConfiguration = (block: DeviceBlockKey) => Array.isArray(enabledDeviceIds?.[block]);
  // Membership over a configured block is O(n) per instance, so filtering a
  // block was O(n²). One Set per block makes the same check a lookup and the
  // filter linear; build once per render and reuse across every filter call.
  const enabledInstanceSets = (() => {
    const sets = new Map<DeviceBlockKey, Set<string>>();
    for (const [block, ids] of Object.entries(enabledDeviceIds ?? {})) {
      if (Array.isArray(ids)) sets.set(block as DeviceBlockKey, new Set(ids));
    }
    return sets;
  })();
  const filterEnabledInstances = <T extends { id: string }>(block: DeviceBlockKey, instances: T[]) => {
    const configuredIds = enabledInstanceSets.get(block);
    return configuredIds ? instances.filter((instance) => configuredIds.has(instance.id)) : instances;
  };
  const filteredDiskDetails = latest ? filterEnabledInstances("disk", latest.disks ?? []) : [];
  // One disk without a size must not cost the whole machine its disk total: a
  // single `undefined` used to turn the sum into NaN, which
  // `formatCapacitySummary` then reported as "容量暂无" for every healthy disk.
  // Same rule as the chart side, which already treats a missing value as zero.
  const sumDiskBytes = (pick: (disk: MetricsLatest["disks"][number]) => number) => filteredDiskDetails.reduce((total, disk) => {
    const value = pick(disk);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
  const filteredGpuDetails = latest ? filterEnabledInstances("gpu", latest.gpus ?? []) : [];
  const filteredLatest = latest
    ? {
        ...latest,
        cpuPackages: filterEnabledInstances("cpu", latest.cpuPackages ?? []),
        disks: filteredDiskDetails,
        storagePools: latest.storagePools ?? [],
        networkInterfaces: filterEnabledInstances("network", latest.networkInterfaces ?? []),
        gpus: filteredGpuDetails,
        fans: filterEnabledInstances("fan", latest.fans ?? []),
        diskUsedBytes: filteredDiskDetails.length || hasInstanceConfiguration("disk") ? sumDiskBytes((disk) => disk.usedBytes) : latest.diskUsedBytes,
        diskTotalBytes: filteredDiskDetails.length || hasInstanceConfiguration("disk") ? sumDiskBytes((disk) => disk.totalBytes) : latest.diskTotalBytes
      }
    : undefined;
  const cpuInstances = filterEnabledInstances("cpu", series?.cpus ?? []);
  const diskInstances = filterEnabledInstances("disk", series?.disks ?? []);
  const storagePools = series?.storagePools ?? [];
  const networkInstances = filterEnabledInstances("network", series?.networks ?? []);
  const gpuInstances = filterEnabledInstances("gpu", series?.gpus ?? []);
  const latestFanInstances = latest ? filterEnabledInstances("fan", latest.fans ?? []) : [];
  const fanInstances = mergeFanMetricSeries(
    latestFanInstances,
    filterEnabledInstances("fan", series?.fans ?? []),
    latest?.hardwareSampledAt ?? metrics?.lastSeenAt ?? selectedDevice.lastSeenAt ?? new Date().toISOString()
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
  const commitLimitBytes = filteredLatest
    ? filteredLatest.memoryCommitLimitBytes || filteredLatest.memoryTotalBytes + filteredLatest.swapTotalBytes
    : 0;
  const settingsSection = "connections" as const;
  const liveOverviewActive = !touch && !liveView && liveOverview && activeTab === "overview";
  // Tab captions repeated the section headings right below them; only the live
  // views, which read the device instead of history, still need to say so.
  const caption = liveView ? liveViewCaptions[liveView] : liveOverviewActive ? "最近两分钟的设备实时数据，直接来自设备，不写入历史" : null;

  const chartContext: DeviceChartContext = {
    device: selectedDevice,
    filteredLatest,
    series,
    unavailable: metricUnavailable,
    hasInstanceConfiguration,
    cpuInstances,
    diskInstances,
    storagePools,
    storagePoolLatest: filteredLatest?.storagePools ?? [],
    networkInstances,
    gpuInstances,
    fanInstances,
    visibleDiskInstances,
    visibleNetworkInstances,
    visibleGpuInstances,
    aggregates: {
      cpuUsage: cpuAverageUsage,
      diskUsedBytes: diskTotalUsedBytes,
      networkRx: networkAverageRx,
      networkTx: networkAverageTx,
      gpuUsage: gpuAverageUsage,
      gpuEncode: gpuAverageEncode,
      gpuDecode: gpuAverageDecode,
      gpuMemoryUsedBytes: gpuTotalMemoryUsedBytes
    },
    summaries: {
      memory: filteredLatest ? formatCapacitySummary(filteredLatest.memoryUsedBytes, filteredLatest.memoryTotalBytes, metricUnavailable("memoryUsage")) : "容量暂无",
      committed: filteredLatest ? formatCapacitySummary(filteredLatest.memoryCommittedBytes, commitLimitBytes, metricUnavailable("memoryCommitted")) : "容量暂无",
      pagefile: filteredLatest ? formatCapacitySummary(filteredLatest.swapUsedBytes, filteredLatest.swapTotalBytes, metricUnavailable("swapUsage")) : "容量暂无",
      disk: filteredLatest ? formatCapacitySummary(filteredLatest.diskUsedBytes, filteredLatest.diskTotalBytes, metricUnavailable("diskUsage")) : "容量暂无",
      gpuMemory: filteredLatest ? formatGpuMemorySummary(filteredLatest.gpus) : "容量暂无"
    },
    modelItems: {
      cpu: cpuInstances.map((cpu) => ({
        id: cpu.id,
        name: `${cpu.socketIndex != null ? `Socket ${cpu.socketIndex}` : cpu.id} · ${displayModelName(cpu.model, cpu.name, "CPU")}`,
        detail: [cpu.coreCount ? `${cpu.coreCount} 核` : "", cpu.logicalCount ? `${cpu.logicalCount} 线程` : "", cpu.l3CacheBytes ? `L3 ${formatBytes(cpu.l3CacheBytes)}` : ""].filter(Boolean).join(" · ")
      })),
      disk: diskInstances.map((disk) => ({
        id: disk.id,
        name: displayModelName(disk.model, disk.name, "磁盘"),
        detail: [disk.mountPoint, disk.filesystem].filter(Boolean).join(" · ")
      })),
      network: networkInstances.map((network) => ({
        id: network.id,
        name: displayModelName(network.model, network.name, "网卡"),
        detail: describeNetworkIdentity(network)
      })),
      gpu: gpuInstances.map((gpu) => ({ id: gpu.id, name: displayInstanceName(gpu.name, "GPU") }))
    },
    traffic: {
      data: snapshot?.trafficCalendar ?? null,
      mode: trafficMode,
      onModeChange: setTrafficMode,
      onShiftAnchor: shiftTrafficAnchor
    },
    settingsSection,
    openSettings,
    canConfigureConnection: capabilities.canConfigureConnection,
    thresholds: healthThresholds
  };

  // 分区级筛选控件。键用 DeviceSectionId，锚点写错会直接编译失败。
  const sectionControls: DeviceSectionControls = {
    "section-storage": <InstanceFilter label="网卡" value={selectedNetId} onChange={setSelectedNetId} options={networkOptions} />,
    "section-storage-disk": <InstanceFilter label="磁盘" value={selectedDiskId} onChange={setSelectedDiskId} options={diskOptions} />,
    "section-gpu": <InstanceFilter label="GPU" value={selectedGpuId} onChange={setSelectedGpuId} options={gpuOptions} />
  };

  const deviceStateBanner = (snapshotSource === "cache" && snapshot)
    ? {
        tone: "cached",
        title: "当前显示离线缓存",
        detail: `数据缓存于 ${formatDate(snapshot.cache.savedAt)}，设备和图表可能已经过期。`,
        action: <Button variant="quiet" onClick={() => void refresh()}>{refreshing ? "正在刷新" : "重新获取"}<Icon name="refresh" size={15} /></Button>
      }
    : telemetryState === "pending"
      ? {
          // `cached` is the banner that already reads "this is not current yet"
          // without alarming the reader; the loading tone has no styling of its
          // own and would fall back to the warning icon.
          tone: "cached",
          title: `正在读取最近 ${windowLabel} 的遥测样本`,
          detail: "切换时间范围或设备后，上一批数据不再适用于当前画面；图表会在这段样本到达后自动补齐，设备的上报状态不受影响。",
          action: <span className="workspace-caption">无需检查 Agent，正在读取</span>
        }
      : telemetryState === "range"
        ? {
            tone: "empty",
            title: `${windowLabel} 范围内还没有读到样本`,
            detail: "这台设备在本页展示过其他范围的样本，所以更可能是这次读取没有完成；点“重新读取”重试即可。",
            action: <Button variant="quiet" onClick={() => void refresh()}>{refreshing ? "正在刷新" : "重新读取"}<Icon name="refresh" size={15} /></Button>
          }
        : telemetryState === "none"
          ? {
              tone: "empty",
              title: "还没有收到遥测样本",
              detail: "设备已经出现在中枢列表，但中枢还没有它任何一段历史指标；确认 Agent 正在运行，或点“重新读取”。",
              // The topbar refresh button is icon-only on phones, so "use the top
              // refresh button" pointed at no visible label. A real button in the
              // banner works at every width.
              action: <Button variant="quiet" onClick={() => void refresh()}>{refreshing ? "正在刷新" : "重新读取"}<Icon name="refresh" size={15} /></Button>
            }
          : selectedDevice.status !== "online"
            ? {
                tone: "offline",
                title: "设备当前离线",
                detail: "下面仍会保留最近一次可用样本；设备重新上报后，刷新即可看到最新数据。",
                action: <Button variant="quiet" onClick={() => openSettings(settingsSection)}>查看中枢连接<Icon name="arrow" size={15} /></Button>
              }
            : null;

  return (
    <div ref={rootRef} className={`workspace-page workspace-page--device${isFullscreen ? " workspace-page--fullscreen" : ""}`}>
      {!touch && <><nav className="workspace-breadcrumb" aria-label="面包屑">
        <button type="button" onClick={() => navigate({ kind: "overview" })}>总览</button>
        <span aria-hidden="true">/</span>
        <button type="button" onClick={() => navigate({ kind: "devices" })}>设备</button>
        {normalizeDeviceGroup(selectedDevice.group) && (
          <>
            <span aria-hidden="true">/</span>
            <span>{normalizeDeviceGroup(selectedDevice.group)}</span>
          </>
        )}
        <span aria-hidden="true">/</span>
        <strong>{selectedDevice.hostname}</strong>
      </nav>
      <PageIntro
        eyebrow={normalizeDeviceGroup(selectedDevice.group) ? `设备 · ${normalizeDeviceGroup(selectedDevice.group)}` : "设备"}
        title={selectedDevice.hostname}
        description={`${selectedDevice.os} · ${selectedDevice.deviceId}`}
      />
      <SnapshotFreshnessNotice /></>}
      {touch && <header className="touch-device-heading"><h1>{selectedDevice.hostname}</h1><p>{selectedDevice.os}{normalizeDeviceGroup(selectedDevice.group) ? ` · ${normalizeDeviceGroup(selectedDevice.group)}` : ""} · {snapshotSource === "cache" ? "缓存中的状态" : selectedDevice.status === "online" ? "在线" : "离线"}</p></header>}

      {/* One card carries every state fact. They used to be split across a
          status line and a facts strip that repeated the same two things, so
          answering "is this device live?" meant reading three places. */}
      <details className="touch-device-facts" open={touch ? undefined : true}><summary>设备信息与数据时间</summary><div className="workspace-device-facts" aria-label="设备事实">
        {/* The visible word already names the state, so the dot is decoration
            here and must stay out of the accessibility tree. `StatusLabel
            compact` carries its own accessible name (it is the only indicator on
            the overview tile), which read these two cells as "在线 在线" — and on
            the data-link row as "在线 实时中枢", two different names for one fact. */}
        <div><span>最近上报状态</span><strong><StatusDot state={selectedDevice.status === "online" ? "online" : "offline"} />{selectedDevice.status === "online" ? "在线" : "离线"}</strong></div>
        <div><span>与中枢链路</span><strong><StatusDot state={deviceSourceState} />{selectLinkLabel(snapshotSource, capabilities.liveDataTransport)}</strong></div>
        <div>
          <span>所属分组</span>
          <strong className="workspace-device-facts__group">
            <span>{normalizeDeviceGroup(selectedDevice.group) ?? "未分组"}</span>
            {liveAuthenticated && (
              <Button
                variant="quiet"
                onClick={() => setEditingGroup(true)}
                disabled={mutationPending}
              >
                {normalizeDeviceGroup(selectedDevice.group) ? "修改" : "设组"}
              </Button>
            )}
          </strong>
        </div>
        <div><span>最后在线</span><strong>{formatDate(selectedDevice.lastSeenAt)} · {selectedDevice.status === "online" ? "刚刚上报" : "已停止上报"}</strong></div>
        <div><span>{snapshotSource === "cache" ? "缓存时间" : "数据时间"}</span><strong>{formatDate(snapshotSource === "cache" ? snapshot?.cache.savedAt : snapshot?.generatedAt)}</strong></div>
        <div><span>Agent 版本</span><strong>{selectedDevice.agentVersion ? `v${selectedDevice.agentVersion}` : "版本未知"}</strong></div>
        <div><span>发布通道</span><strong>{formatReleaseChannel(selectedDevice.agentChannel)}</strong></div>
      </div>

      </details>
      {editingGroup && (
        <DeviceGroupDialog
          title={`设置“${selectedDevice.hostname}”的分组`}
          detail="选择已有分组或输入新分组名，保存后在设备目录与总览中生效。"
          currentGroup={normalizeDeviceGroup(selectedDevice.group)}
          existingGroups={existingGroups}
          disabled={mutationPending}
          onConfirm={(nextGroup) => {
            setEditingGroup(false);
            void updateDeviceGroup([selectedDevice.deviceId], nextGroup);
          }}
          onCancel={() => setEditingGroup(false)}
        />
      )}
      {/* The phone's counterpart of the desktop 实时 range: the same tiles, read from the device. */}
      {touch && touchPanel === "status" && <M3SegmentedControl
        className="touch-metrics-source"
        size="sm"
        aria-label="指标来源"
        value={touchLive ? "live" : "report"}
        onChange={(value) => setTouchLive(value === "live")}
        options={[{ value: "report", label: "最近上报" }, { value: "live", label: <LiveTabLabel>实时</LiveTabLabel> }]}
      />}
      {touch && touchPanel === "status" && touchLive && <LiveTopicPanel deviceId={selectedDevice.deviceId} topic="metrics" authenticated={liveAuthenticated} compact />}
      {touch && touchPanel === "status" && !touchLive && <div className="touch-current-metrics" aria-label="最近上报指标">{([ ["CPU", "cpuUsage", "cpu", selectedDevice.cpuUsagePercent], ["内存", "memoryUsage", "memory", selectedDevice.memoryUsagePercent], ["磁盘", "diskUsage", "disk", selectedDevice.diskUsagePercent] ] as const).map(([label, key, metric, value]) => {
        const reading = selectedDevice.unavailableMetrics?.includes(key) ? null : value;
        const tone = selectedDevice.status === "online" ? metricTone(reading, healthThresholds[metric]) : "normal";
        return <div key={key} className={`is-${tone}`}><span>{label}</span><strong>{touchPercent(selectedDevice, key, value)}</strong><CapacityBar percent={reading} tone={tone} marks={healthThresholds[metric]} size="sm" /><small>最近一次上报</small></div>;
      })}</div>}
      {selectedDevice.unavailableMetrics?.length ? <div className="workspace-inline-note" role="status"><Icon name="about" size={15} />本机不适用指标：{selectedDevice.unavailableMetrics.join("、")}；对应图表会留空而不是估算。</div> : null}

      {/* The same verdict the overview lists, on the machine it is about. Offline
          is already the state banner below, so only resource issues show here. */}
      {!touch && <DeviceKpiStrip
        device={selectedDevice}
        thresholds={healthThresholds}
        windowLabel={windowLabel}
        cpu={cpuAverageUsage}
        memory={shareOf(series?.memoryUsedBytes, filteredLatest?.memoryTotalBytes ?? selectedDevice.memoryTotalBytes)}
        disk={shareOf(diskTotalUsedBytes, filteredLatest?.diskTotalBytes ?? selectedDevice.diskTotalBytes)}
        gpu={gpuInstances.length || selectedDevice.gpuUsagePercent != null ? gpuAverageUsage : null}
        networkRx={networkAverageRx}
        networkTx={networkAverageTx}
        memoryCaption={capacityCaption(filteredLatest?.memoryUsedBytes ?? selectedDevice.memoryUsedBytes, filteredLatest?.memoryTotalBytes ?? selectedDevice.memoryTotalBytes) ?? "容量暂无"}
        diskCaption={capacityCaption(filteredLatest?.diskUsedBytes ?? selectedDevice.diskUsedBytes, filteredLatest?.diskTotalBytes ?? selectedDevice.diskTotalBytes) ?? "容量暂无"}
        unavailable={(metric) => metric === "cpu" ? metricUnavailable("cpuUsage")
          : metric === "memory" ? metricUnavailable("memoryUsage")
            : metric === "disk" ? metricUnavailable("diskUsage")
              : metric === "gpu" ? metricUnavailable("gpuUsage")
                : metricUnavailable("networkRxRate") && metricUnavailable("networkTxRate")}
        onOpen={(id) => {
          if (liveView) navigate({ kind: "device", deviceId: selectedDevice.deviceId });
          setLiveOverview(false);
          if (id !== activeTab) setActiveTab(id);
          // Bring the charts that tile summarises into view, below the tabs.
          requestAnimationFrame(() => deviceContextRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
        }}
      />}

      {touch && (() => {
        const resourceIssues = evaluateDevice(selectedDevice, healthThresholds).filter((issue) => issue.kind !== "offline");
        if (!resourceIssues.length) return null;
        return <ul className="workspace-device-issues" aria-label="超过阈值的资源">
          {resourceIssues.map((issue) => <li key={issue.kind} className={`workspace-device-issue workspace-device-issue--${issue.severity}`}>
            <Icon name="warning" size={16} /><span>{describeIssue(issue, formatDate)}</span>
          </li>)}
        </ul>;
      })()}

      {deviceStateBanner && (!liveView || deviceStateBanner.tone === "offline") && (
        <div className={`workspace-device-state-banner workspace-device-state-banner--${deviceStateBanner.tone}`} role={deviceStateBanner.tone === "offline" ? "alert" : "status"}>
          <div className="workspace-device-state-banner__icon"><Icon name={deviceStateBanner.tone === "empty" ? "data" : deviceStateBanner.tone === "cached" ? "clock" : "warning"} size={18} /></div>
          <div className="workspace-device-state-banner__copy"><strong>{deviceStateBanner.title}</strong><p>{deviceStateBanner.detail}</p></div>
          {deviceStateBanner.action}
        </div>
      )}

      {/* 选项卡、时间范围与全屏属于同一个设备上下文，滚动图表时保持可见。 */}
      <div className="workspace-device-context" ref={deviceContextRef}>
        {touch && <M3Tabs aria-label="设备详情" value={touchPanel} onChange={(id) => onTouchPanelChange?.(id as TouchPanel)} tabs={[
          { id: "status", label: "状态" },
          { id: "trends", label: "趋势" },
          { id: "processes", label: <LiveTabLabel>进程</LiveTabLabel> },
          ...(showContainers ? [{ id: "containers", label: <LiveTabLabel>容器</LiveTabLabel> }] : []),
          { id: "hardware", label: "硬件" }
        ]} />}
        {!touch && <M3Tabs
          aria-label="设备面板"
          className="workspace-device-tabs"
          value={liveView ?? activeTab}
          onChange={(id) => {
            if (id === "processes" || id === "containers") { navigate({ kind: "device", deviceId: selectedDevice.deviceId, view: id }); return; }
            if (liveView) navigate({ kind: "device", deviceId: selectedDevice.deviceId });
            changeTab(id);
          }}
          tabs={[
            ...DEVICE_DASHBOARD.tabs.map((item) => ({ id: item.id, label: item.name })),
            { id: "processes", label: <LiveTabLabel>进程</LiveTabLabel>, className: "workspace-device-tab--live workspace-device-tab--live-first" },
            ...(showContainers ? [{ id: "containers", label: <LiveTabLabel>容器</LiveTabLabel>, className: "workspace-device-tab--live" }] : [])
          ]}
        />}
        {touch && touchPanel === "trends" && <M3Select label="趋势分类" value={activeTab} onChange={(event) => changeTab(event.target.value)} options={DEVICE_DASHBOARD.tabs.map((item) => ({ value: item.id, label: item.name }))} />}

        {!liveView && (!touch || touchPanel === "trends") && <div className="workspace-device-context__controls">
          <div className="workspace-device-toolbar">
            <MetricWindowControl
              value={metricsWindow as DesktopMetricWindowValue}
              onChange={(value) => { setLiveOverview(false); setMetricsWindow(value); }}
              live={!touch && activeTab === "overview" ? { selected: liveOverview, onSelect: () => setLiveOverview(true) } : undefined}
              compact={!touch}
            />
            <Button variant="quiet" title={isFullscreen ? "退出全屏" : "全屏查看"} aria-label={isFullscreen ? "退出全屏" : "全屏查看"} onClick={toggleFullscreen}>
              <Icon name={isFullscreen ? "windowRestore" : "windowMaximize"} size={16} />
              {touch ? (isFullscreen ? "退出全屏" : "全屏") : null}
            </Button>
          </div>
        </div>}

        {!touch && caption ? <p className="workspace-device-context__caption">{caption}</p> : null}

        {!touch && !liveView && anchors.length > 1 && (
          <div className="workspace-anchor-bar" role="navigation" aria-label="分区跳转">
            {anchors.map((anchor) => (
              <button
                key={anchor.id}
                type="button"
                className={`workspace-anchor-btn${activeAnchor === anchor.id ? " is-active" : ""}`}
                aria-current={activeAnchor === anchor.id ? "page" : undefined}
                onClick={() => scrollToAnchor(anchor.id)}
              >
                {anchor.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The banner above already states why this range is empty; this body
          placeholder only appears while samples are actually on their way (where
          they will land). Both the banner and this block used to repeat the same
          "no telemetry / press refresh" sentence, so the reader read one fact
          three times. */}
      {!liveView && telemetryMissing && telemetryState === "pending"
        ? <MetricsLoadingSurface detail={`正在读取最近 ${windowLabel} 的遥测样本，综合趋势与明细图表会在样本到达后自动补齐。`} />
        : null}

      {liveView ? <section className="workspace-live" aria-label={liveView === "processes" ? "进程" : "容器"}>
        <LiveTopicPanel deviceId={selectedDevice.deviceId} topic={liveView === "processes" ? "processes" : "docker"} authenticated={liveAuthenticated} />
      </section> : <div className="workspace-device-dashboard">
        {(touch ? (touchPanel === "trends" ? tab.sections : findDeviceTab("overview").sections.filter((section) => touchPanel === "hardware" ? section.id === "section-info" : section.id === "section-overview-capacity")) : tab.sections).map((section) => liveOverviewActive && section.id === "section-overview" ? (
          <DashboardSection key={section.id} id={section.id} eyebrow="实时" title="核心性能 · 实时" description="每次刷新都直接询问设备，只保留最近两分钟。">
            <LiveTopicPanel deviceId={selectedDevice.deviceId} topic="metrics" authenticated={liveAuthenticated} />
          </DashboardSection>
        ) : (
          <DashboardSection
            key={section.id}
            id={section.id}
            eyebrow={section.eyebrow}
            title={section.title}
            description={section.description}
            controls={sectionControls[section.id as DeviceSectionId]}
          >
            <DashboardGrid>
              <DeviceChartCells section={section} context={chartContext} />
            </DashboardGrid>
          </DashboardSection>
        ))}
      </div>}
    </div>
  );
}

const liveViewCaptions: Record<DeviceLiveView, string> = {
  processes: "设备上正在运行的进程 · 打开时才向设备查询，不写入历史",
  containers: "Docker 容器的状态与资源占用 · 打开时才向设备查询，不写入历史"
};

/** Live tabs carry the same dot as the 实时 range: "this reads the device now". */
function LiveTabLabel({ children }: { children: React.ReactNode }) {
  return <span className="workspace-live-tab"><span className="workspace-live-dot" aria-hidden="true" />{children}</span>;
}