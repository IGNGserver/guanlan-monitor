import React, { useEffect, useMemo, useRef, useState } from "react";
import { Tab, TabList, Tabs } from "@carbon/react";
import type { DeviceBlockKey, DeviceMetricKey } from "@dsc/shared";
import { useWorkspace } from "../WorkspaceContext";
import { selectSnapshotSource } from "../selectors";
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
  displayInstanceName,
  displayModelName,
  formatBytes,
  formatCapacitySummary,
  formatDate,
  formatGpuMemorySummary,
  sumSamplePoints
} from "../formatters";
import { Button, Icon, StatusLabel } from "../ui";
import { DeviceChartCells, type DeviceChartContext, type DeviceSectionControls } from "./deviceCharts";
import {
  EmptyState,
  InstanceFilter,
  MetricWindowControl,
  PageIntro,
  isMetricUnavailable,
  mergeFanMetricSeries,
  type DesktopMetricWindowValue
} from "./shared";

/**
 * 设备详情页。
 *
 * 页面结构完全由 `DEVICE_DASHBOARD` 常量决定：选项卡、分区、图表与栅格跨度都是
 * 编译期字面量，运行期不再从服务端读取布局文档，也没有拖拽编辑与自定义面板。
 * 这里只保留三件与布局无关的事情：时间范围、实例筛选、整页全屏。
 */
export function DeviceDetailsPage() {
  const {
    selectedDevice,
    snapshot,
    navigate,
    openSettings,
    metricsWindow,
    setMetricsWindow,
    trafficMode,
    setTrafficMode,
    shiftTrafficAnchor,
    capabilities
  } = useWorkspace();
  const snapshotSource = snapshot ? selectSnapshotSource(snapshot, snapshot.devices) : "unknown";
  const deviceSourceState: "online" | "offline" | "cached" | "warning" | "unknown" = snapshotSource === "cache"
    ? "cached"
    : snapshotSource === "live"
      ? "online"
      : snapshotSource === "empty"
        ? "unknown"
        : "warning";

  const [activeTab, setActiveTab] = useState<DeviceTabId>(DEFAULT_DEVICE_TAB_ID);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
    target.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // 多实例单选状态：切换设备时一并复位，避免把上一台设备的实例 id 带过来。
  const [selectedNetId, setSelectedNetId] = useState("all");
  const [selectedDiskId, setSelectedDiskId] = useState("all");
  const [selectedGpuId, setSelectedGpuId] = useState("all");
  const deviceId = selectedDevice?.deviceId;

  useEffect(() => {
    setSelectedNetId("all");
    setSelectedDiskId("all");
    setSelectedGpuId("all");
    setActiveTab(DEFAULT_DEVICE_TAB_ID);
  }, [deviceId]);

  if (!selectedDevice) {
    return (
      <EmptyState
        title="没有找到这台设备"
        detail="设备可能已被移除，或者中枢还没有返回它。"
        action={<Button variant="primary" onClick={() => navigate({ kind: "devices" })}>返回设备目录</Button>}
      />
    );
  }

  const metrics =
    snapshot?.metrics?.device.deviceId === selectedDevice.deviceId &&
    (!snapshot.metrics.window || snapshot.metrics.window === metricsWindow)
      ? snapshot.metrics
      : null;
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
  const commitLimitBytes = filteredLatest
    ? filteredLatest.memoryCommitLimitBytes || filteredLatest.memoryTotalBytes + filteredLatest.swapTotalBytes
    : 0;
  const settingsSection = capabilities.canConfigureConnection ? "connections" : "workspace";

  const chartContext: DeviceChartContext = {
    device: selectedDevice,
    filteredLatest,
    series,
    unavailable: metricUnavailable,
    hasInstanceConfiguration,
    cpuInstances,
    diskInstances,
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
        detail: [network.name, network.macAddress || network.ipv4?.[0] || network.ipv6?.[0]].filter(Boolean).join(" · ")
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
    canConfigureConnection: capabilities.canConfigureConnection
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
        action: <span className="workspace-caption">请使用顶部刷新按钮重新获取</span>
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
            action: <Button variant="quiet" onClick={() => openSettings(settingsSection)}>查看中枢连接<Icon name="arrow" size={15} /></Button>
          }
        : null;

  const selectedIndex = Math.max(0, DEVICE_DASHBOARD.tabs.findIndex((item) => item.id === activeTab));

  return (
    <div ref={rootRef} className={`workspace-page workspace-page--device${isFullscreen ? " workspace-page--fullscreen" : ""}`}>
      <nav className="workspace-breadcrumb" aria-label="面包屑">
        <button type="button" onClick={() => navigate({ kind: "devices" })}>设备</button>
        <span aria-hidden="true">/</span>
        <strong>{selectedDevice.hostname}</strong>
      </nav>
      <PageIntro
        eyebrow="设备"
        title={selectedDevice.hostname}
        description={`${selectedDevice.os} · ${selectedDevice.deviceId}`}
        actions={<Button variant="quiet" onClick={() => navigate({ kind: "devices" })}><Icon name="back" size={16} />返回设备目录</Button>}
      />

      <div className="workspace-device-statusline">
        <StatusLabel state={selectedDevice.status === "online" ? "online" : "offline"} />
        <span>Agent {selectedDevice.agentVersion ? `v${selectedDevice.agentVersion}` : "版本未知"}</span>
        <span>通道 {selectedDevice.agentChannel ?? "未知"}</span>
        {selectedDevice.unavailableMetrics?.length ? <span>不适用指标：{selectedDevice.unavailableMetrics.join("、")}</span> : null}
        <span>{snapshotSource === "cache" ? `缓存于 ${formatDate(snapshot?.cache.savedAt)}` : `数据更新时间 ${formatDate(snapshot?.generatedAt)}`}</span>
        <StatusLabel state={deviceSourceState} />
      </div>

      <div className="workspace-device-facts" aria-label="设备事实">
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

      {/* 选项卡、时间范围与全屏属于同一个设备上下文，滚动图表时保持可见。 */}
      <div className="workspace-device-context">
        <Tabs
          selectedIndex={selectedIndex}
          onChange={({ selectedIndex: nextIndex }) => changeTab(DEVICE_DASHBOARD.tabs[nextIndex]?.id ?? DEFAULT_DEVICE_TAB_ID)}
        >
          <TabList aria-label="设备面板" activation="manual" contained fullWidth size="md">
            {DEVICE_DASHBOARD.tabs.map((item) => <Tab key={item.id}>{item.name}</Tab>)}
          </TabList>
        </Tabs>

        <div className="workspace-device-context__controls">
          <div className="workspace-device-toolbar">
            <MetricWindowControl value={metricsWindow as DesktopMetricWindowValue} onChange={(value) => setMetricsWindow(value)} />
            <Button variant="quiet" title={isFullscreen ? "退出全屏" : "全屏查看"} onClick={toggleFullscreen}>
              <Icon name={isFullscreen ? "windowRestore" : "windowMaximize"} size={16} />
              {isFullscreen ? "退出全屏" : "全屏"}
            </Button>
          </div>
        </div>

        {tab.caption ? <p className="workspace-device-context__caption">{tab.caption}</p> : null}

        {anchors.length > 1 && (
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

      {(!metrics || !series) && (
        <EmptyState
          title="暂无可用遥测"
          detail="硬件与系统信息仍可查看；收到第一批样本后，综合趋势和明细图表会自动出现。可使用顶部刷新按钮重新读取。"
        />
      )}

      <div className="workspace-device-dashboard">
        {tab.sections.map((section) => (
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
      </div>
    </div>
  );
}
