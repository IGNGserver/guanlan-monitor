import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentProbeTarget, DeviceBlockKey, DeviceMetricKey, DeviceSummary, FanMetricSeries, FanSensorStats, SamplePoint, TemperatureMetricSeries, TemperatureSensorReading, TrafficCalendarMode, TrafficCalendarResponse, VirtualizationStorageMetricSeries, VirtualizationStorageTelemetry, WidgetLayoutDocument, WidgetLayoutSaveRequest, WidgetPanelMetadata } from "@dsc/shared";
import { isDisplayableVirtualizationStorage, isDisplayableVirtualizationStorageSeries, virtualizationStorageInstances } from "@dsc/shared";
import { useWorkspace } from "../WorkspaceContext";
import { selectSnapshotSource } from "../selectors";
import {
  DesktopWidget,
  WidgetLayoutProvider,
  WidgetLayoutToolbar,
  confirmDiscardWidgetLayoutDraft,
  useOptionalWidgetLayout,
  type WidgetDisplayMode,
  type WidgetSize
} from "../WidgetLayout";
import { DeviceWidgetFrame } from "../DeviceWidgetFrame";
import { DynamicWidgetCanvas, WidgetDrawer } from "../widgetCatalog";
import { M3Checkbox, M3Chip, M3SegmentedControl, M3Select, M3Switch, M3Tabs, M3TextField } from "../m3";
import { Button, Icon, StatusDot, StatusLabel, Surface, SummaryRow, VirtualMachinePowerLabel, virtualMachinePowerState } from "../ui";
import { MiniTrend, TelemetryChartCard, TelemetryInfoCard } from "../TelemetryCards";
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
} from "../formatters";
import {
  AgentTemperatureSourcesPanel,
  ConfirmDialog,
  CpuFactsCard,
  DEFAULT_DEVICE_PANELS,
  DeviceRow,
  EmptyState,
  ErrorSurface,
  InstanceFilter,
  InstanceMetricOverride,
  MetricTile,
  MetricWindowControl,
  OverviewSummary,
  PageIntro,
  TemperatureSourcesPanel,
  TelemetryDeviceBlock,
  TelemetryModelList,
  TelemetrySection,
  TrafficCalendarCard,
  WidgetPanelBar,
  cloneDevicePanels,
  createDynamicLayout,
  createStarterDynamicLayout,
  formatVirtualizationStorageCapacity,
  formatVirtualizationStoragePercent,
  formatVirtualizationStorageType,
  formatVirtualizationStorageValue,
  isMetricUnavailable,
  latestSampleValue,
  mergeFanMetricSeries,
  normalizeDevicePanels,
  temperatureLimitsLabel,
  temperatureSourceLabel,
  temperatureStatusLabel,
  temperatureValueLabel,
  unavailablePoints,
  type DesktopMetricWindowValue
} from "./shared";

export function DeviceDetailsPage() {
  const { selectedDevice, snapshot, navigate, openSettings, metricsWindow, setMetricsWindow, trafficMode, setTrafficMode, getWidgetLayout, saveWidgetLayout, orientation, capabilities } = useWorkspace();
  const snapshotSource = snapshot ? selectSnapshotSource(snapshot, snapshot.devices) : "unknown";
  const canEditRemote = snapshotSource === "live";
  const deviceSourceState: "online" | "offline" | "cached" | "warning" | "unknown" = snapshotSource === "cache"
    ? "cached"
    : snapshotSource === "live"
      ? "online"
      : snapshotSource === "empty"
        ? "unknown"
        : "warning";
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
  const vmPower = selectedDevice.instanceType === "virtual_machine" ? virtualMachinePowerState(selectedDevice.virtualMachine?.powerState) : null;
  const deviceStateBanner = (snapshotSource === "cache" && snapshot)
    ? {
        tone: "cached",
        title: "当前显示离线缓存",
        detail: `数据缓存于 ${formatDate(snapshot.cache.savedAt)}，设备和图表可能已经过期。`,
        action: <span className="workspace-caption">请使用顶部刷新按钮重新获取</span>
      }
    : vmPower && vmPower.state !== "online"
      ? {
          tone: vmPower.state === "unknown" ? "empty" : "offline",
          title: `虚拟机${vmPower.label}`,
          detail: `${vmPower.label}时，CPU、内存、磁盘等运行时指标按“不适用”展示；宿主机 Agent 和最近心跳仍单独保留。`,
          action: <span className="workspace-caption">电源状态由中枢虚拟化接口提供</span>
        }
    : !metrics || !series
      ? {
          tone: "empty",
          title: "还没有收到遥测样本",
          detail: "设备已经出现在中枢列表，但当前没有可展示的历史指标；确认 Agent 正在运行并刷新状态。",
          action: <span className="workspace-caption">请使用顶部刷新按钮重新获取</span>
        }
      : selectedDevice.status !== "online"
        ? {
            tone: "offline",
            title: "设备当前未在线",
            detail: "下面仍会保留最近一次可用样本；设备重新上报后，刷新即可看到最新数据。",
            action: <Button variant="quiet" onClick={() => openSettings(capabilities.canConfigureConnection ? "connections" : "workspace")}>查看中枢连接<Icon name="arrow" size={15} /></Button>
          }
        : null;

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
      <nav className="workspace-breadcrumb" aria-label="面包屑">
        <button type="button" onClick={() => navigate({ kind: "devices" })}>设备</button>
        <span aria-hidden="true">/</span>
        <strong>{selectedDevice.hostname}</strong>
      </nav>
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
        <span>{selectedDevice.status === "online" ? "最近心跳有效" : "最近心跳已过期"} · {formatDate(selectedDevice.lastSeenAt)}</span>
        {selectedDevice.unavailableMetrics?.length ? <span>不适用指标：{selectedDevice.unavailableMetrics.join("、")}</span> : null}
        <span>{snapshotSource === "cache" ? `缓存于 ${formatDate(snapshot?.cache.savedAt)}` : `数据更新时间 ${formatDate(snapshot?.generatedAt)}`}</span>
        <StatusLabel state={deviceSourceState} />
      </div>

      <div className="workspace-device-facts" aria-label="设备事实">
        <div><span>实例类型</span><strong>{selectedDevice.instanceType === "virtual_machine" ? "虚拟机" : "普通设备"}</strong></div>
        <div><span>宿主机</span><strong>{selectedDevice.instanceType === "virtual_machine" ? selectedDevice.hostName ?? "未知" : "本机 Agent"}</strong></div>
        <div><span>最近心跳</span><strong>{formatDate(selectedDevice.lastSeenAt)} · {selectedDevice.status === "online" ? "有效" : "已过期"}</strong></div>
        <div><span>中枢顺序</span><strong>{(selectedDevice.sortOrder ?? 0) + 1}</strong></div>
      </div>

      {deviceStateBanner && (
        <div className={`workspace-device-state-banner workspace-device-state-banner--${deviceStateBanner.tone}`} role={deviceStateBanner.tone === "offline" ? "alert" : "status"}>
          <div className="workspace-device-state-banner__icon"><Icon name={deviceStateBanner.tone === "empty" ? "data" : deviceStateBanner.tone === "cached" ? "clock" : "warning"} size={18} /></div>
          <div className="workspace-device-state-banner__copy"><strong>{deviceStateBanner.title}</strong><p>{deviceStateBanner.detail}</p></div>
          {deviceStateBanner.action}
        </div>
      )}



      <WidgetLayoutProvider
        key={activeTab}
        scopeKey={isCustomPanel ? customPanelScope(activeTab) : `device:${selectedDevice.deviceId}:${activeTab}`}
        templateKey={isCustomPanel ? customPanelTemplate : `device-type:${selectedDevice.instanceType ?? "device"}:tab:${activeTab}`}
        editable={activeTab !== "all" && canEditRemote}
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

      {(!metrics || !series) && (
        <EmptyState
          title="暂无可用遥测"
          detail="硬件与系统信息仍可查看；收到第一批样本后，综合趋势和明细图表会自动出现。可使用顶部刷新按钮重新读取。"
        />
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
