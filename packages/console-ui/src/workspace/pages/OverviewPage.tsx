import React, { useState } from "react";
import { ActionableNotification } from "@carbon/react";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { Button, Icon, Surface } from "../ui";
import { M3SegmentedControl } from "../m3";
import { TelemetryChartCard } from "../TelemetryCards";
import { formatBytes, formatDate } from "../formatters";
import { selectHealthSummary, selectOverviewDevices } from "../selectors";
import { CarbonDeviceTable, EmptyState, ErrorSurface, isMetricUnavailable, LoadingSurface, PageIntro, OverviewSummary, unavailablePoints } from "./shared";

type ObservationMetric = "cpu" | "memory" | "disk" | "network";

const observationLabels: Record<ObservationMetric, string> = {
  cpu: "CPU 使用率",
  memory: "内存占用",
  disk: "磁盘已用容量",
  network: "网络吞吐"
};

export function OverviewPage() {
  const { snapshot, allDevices, devices, instanceType, setInstanceType, metricsWindow, loading, error, refresh, openSettings, navigate, capabilities } = useWorkspace();
  const [observationMetric, setObservationMetric] = useState<ObservationMetric>("cpu");
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备状态" detail={error ?? "桌面桥接尚未准备好"} onRetry={() => void refresh()} />;

  const health = selectHealthSummary(snapshot, allDevices, formatDate);
  const cached = health.source === "cache";
  const noData = health.total === 0;
  const hubAbnormal = health.source === "cache" || health.source === "unknown";
  const recentDevices = selectOverviewDevices(allDevices);
  const scopedDeviceIds = new Set(devices.map((device) => device.deviceId));
  const overviewInstances = (snapshot.overviewMetrics?.instances ?? []).filter((instance) => scopedDeviceIds.has(instance.deviceId));
  const instanceLabel = health.virtualMachineTotal ? "主机 " + health.hostTotal + " · 虚拟机 " + health.virtualMachineTotal : "设备实例";
  const settingsSection: SettingsSection = capabilities.canConfigureConnection ? "connections" : "workspace";
  const settingsLabel = capabilities.canConfigureConnection ? "连接设置" : "中枢设置";
  const noDataSettingsSection: SettingsSection = capabilities.canManageLocalAgent
    ? (snapshot.localBackend ? "agent" : "connections")
    : "workspace";
  const metricWindowLabel = ({ "1m": "1 分钟", "5m": "5 分钟", "15m": "15 分钟", "1h": "1 小时", "6h": "6 小时", "24h": "1 天", "1d": "1 天", "7d": "1 周", "1w": "1 周", "30d": "1 个月", "1mo": "1 个月", "90d": "90 天", "1y": "1 年" } as Record<string, string>)[metricsWindow] ?? metricsWindow;
  const issueCount = health.pending;
  const abnormalVmCount = allDevices.filter((device) => device.instanceType === "virtual_machine" && device.virtualMachine?.powerState?.trim().toLowerCase() !== "running").length;
  const scopedLabel = instanceType === "virtual_machine" ? "虚拟机" : "普通设备";

  const observationSeries = overviewInstances.flatMap((instance) => {
    const unavailable = (key: Parameters<typeof isMetricUnavailable>[1]) => instance.unavailableMetrics?.includes(key) ?? false;
    if (observationMetric === "cpu") return [{ label: instance.hostname, points: unavailablePoints(instance.cpuUsagePercent, unavailable("cpuUsage")) }];
    if (observationMetric === "memory") return [{ label: instance.hostname, points: unavailablePoints(instance.memoryUsedBytes, unavailable("memoryUsage")), valueFormatter: formatBytes }];
    if (observationMetric === "disk") return [{ label: instance.hostname, points: unavailablePoints(instance.diskUsedBytes, unavailable("diskUsage")), valueFormatter: formatBytes }];
    return [
      { label: instance.hostname + " · Rx", points: unavailablePoints(instance.networkRxBytesPerSec, unavailable("networkRxRate")), valueFormatter: (value: number) => (Number.isFinite(value) && value > 0 ? formatBytes(value) + "/s" : "0 B/s") },
      { label: instance.hostname + " · Tx", points: unavailablePoints(instance.networkTxBytesPerSec, unavailable("networkTxRate")), valueFormatter: (value: number) => (Number.isFinite(value) && value > 0 ? formatBytes(value) + "/s" : "0 B/s") }
    ];
  });
  const observationHasData = observationSeries.some((series) => series.points.length > 0);
  const observationEmptyMessage = overviewInstances.length
    ? observationHasData ? undefined : observationLabels[observationMetric] + "暂无可用数据（缺失指标不会被估算）"
    : "当前范围暂无" + scopedLabel + "的总览样本";

  return <div className="workspace-page workspace-page--overview">
    <PageIntro
      eyebrow="总览"
      title={hubAbnormal ? "中枢连接异常" : issueCount ? issueCount + " 项事项需要留意" : noData ? "等待设备接入" : "系统状态正常"}
      description={health.source === "empty"
        ? capabilities.canManageLocalAgent ? "尚未取得实时设备状态，请先启动本机 Agent 或配置中枢。" : "尚未取得实时设备状态，请确认中枢已接入设备后刷新。"
        : hubAbnormal
          ? cached ? "当前显示的是离线缓存，" + health.sourceDetail + "；无法确认中枢当前状态。" : "无法连接到中枢，请检查中枢地址与访问密钥。"
          : health.sourceDetail + "。健康统计覆盖全部主机和虚拟机。"}
      actions={<><Button variant="quiet" onClick={() => openSettings(settingsSection)}><Icon name="connection" size={16} />{settingsLabel}</Button><Button variant="primary" onClick={() => navigate({ kind: "devices" })}>查看全部设备<Icon name="arrow" size={16} /></Button></>}
    />

    <OverviewSummary
      total={health.total}
      online={health.online}
      offline={health.offline}
      issueCount={issueCount}
      instanceLabel={instanceLabel}
      sourceLabel={health.sourceLabel}
      sourceState={health.source === "live" ? "online" : health.source === "cache" ? "cached" : health.source === "unknown" ? "warning" : "unknown"}
      sourceDetail={health.sourceDetail}
    />

    {hubAbnormal ? <ActionableNotification
      inline
      className="workspace-attention"
      kind="warning"
      lowContrast
      hasFocus={false}
      hideCloseButton
      title="中枢连接异常"
      subtitle={cached ? "无法取得最新数据，页面中的设备信息可能已经过期。" : "无法连接到中枢，请检查中枢地址与访问密钥后重试。"}
      actionButtonLabel={settingsLabel}
      onActionButtonClick={() => openSettings(settingsSection)}
    /> : (health.source === "empty" || (issueCount ?? 0) > 0) ? <ActionableNotification
      inline
      className="workspace-attention"
      kind={noData ? "info" : "warning"}
      lowContrast
      hasFocus={false}
      hideCloseButton
      title={noData ? "还没有可用设备" : "设备状态存在异常"}
      subtitle={noData ? "连接中枢并等待设备上报后，这里会显示实时状态。" : health.offline + " 台设备离线，" + abnormalVmCount + " 台 VM 电源未运行，" + (snapshot.localBackend?.lastIssueCount ?? 0) + " 条本机采集问题待处理。"}
      actionButtonLabel="查看详情"
      onActionButtonClick={() => openSettings(noData ? noDataSettingsSection : capabilities.canManageLocalAgent ? "agent" : "workspace")}
    /> : null}

    <div className="workspace-overview-scope" aria-label="总览观察范围">
      <div><span className="workspace-section-kicker">局部观察范围</span><p>健康结论和实例总数始终覆盖全部设备；趋势按这里的范围读取。</p></div>
      <M3SegmentedControl options={[{ value: "device", label: "普通设备" }, { value: "virtual_machine", label: "虚拟机" }]} value={instanceType} onChange={(value) => setInstanceType(value as typeof instanceType)} aria-label="总览观察范围" />
    </div>

    <div className="workspace-overview-grid workspace-overview-grid--single">
      <Surface className="workspace-overview-devices">
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">异常与最近设备</span><h3>{recentDevices.length ? recentDevices.length + " 个重点实例" : "等待设备"}</h3></div><Button variant="quiet" onClick={() => navigate({ kind: "devices" })}>查看全部</Button></div>
        {cached && <div className="workspace-inline-note">当前为缓存快照，设备列表只读。</div>}
        <CarbonDeviceTable devices={recentDevices} emptyState={<EmptyState title="还没有设备" detail="连接一个中枢后，设备会出现在这里。" action={<Button variant="primary" onClick={() => openSettings(capabilities.canConfigureConnection ? "connections" : "workspace")}>{capabilities.canConfigureConnection ? "连接设置" : "查看中枢设置"}</Button>} />} />
      </Surface>
    </div>

    <Surface className="workspace-overview-observation">
      <div className="workspace-surface__header"><div><span className="workspace-section-kicker">单一资源观察</span><h3>{observationLabels[observationMetric]} · {scopedLabel}</h3></div><M3SegmentedControl options={[{ value: "cpu", label: "CPU" }, { value: "memory", label: "内存" }, { value: "disk", label: "磁盘" }, { value: "network", label: "网络" }]} value={observationMetric} onChange={(value) => setObservationMetric(value as ObservationMetric)} aria-label="总览观察指标" /></div>
      <p className="workspace-surface__description">一张图只观察一个维度；VM 停止、暂停、挂起或未知电源状态的不可用指标会明确留空。</p>
      <TelemetryChartCard title={observationLabels[observationMetric] + "趋势"} subtitle={"每个实例一组数据线 · 最近 " + metricWindowLabel} series={observationSeries} valueFormatter={observationMetric === "cpu" ? (value) => Math.round(value) + "%" : observationMetric === "network" ? (value) => (Number.isFinite(value) && value > 0 ? formatBytes(value) + "/s" : "0 B/s") : formatBytes} fixedMaxValue={observationMetric === "cpu" ? 100 : undefined} emptyMessage={observationEmptyMessage} showDetailsControl={false} />
    </Surface>
  </div>;
}
