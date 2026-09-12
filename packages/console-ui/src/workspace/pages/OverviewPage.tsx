import React, { useState } from "react";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { Button, Icon, Surface } from "../ui";
import { M3SegmentedControl } from "../m3";
import { TelemetryChartCard } from "../TelemetryCards";
import { CapacityMetricValue, MetricValue, formatDate } from "../formatters";
import { selectHealthSummary, selectOverviewDevices, selectResourceRanking } from "../selectors";
import { EmptyState, DeviceRow, ErrorSurface, isMetricUnavailable, LoadingSurface, PageIntro, OverviewSummary, unavailablePoints } from "./shared";

export function OverviewPage() {
  const { snapshot, allDevices, metricsWindow, loading, error, refresh, openSettings, navigate, capabilities } = useWorkspace();
  const [resourceMetric, setResourceMetric] = useState<"cpu" | "memory" | "disk">("cpu");
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备状态" detail={error ?? "桌面桥接尚未准备好"} onRetry={() => void refresh()} />;

  const health = selectHealthSummary(snapshot, allDevices, formatDate);
  const cached = health.source === "cache";
  const noData = health.total === 0;
  const hubAbnormal = health.source === "cache" || health.source === "unknown";
  const overviewInstances = snapshot.overviewMetrics?.instances ?? [];
  const recentDevices = selectOverviewDevices(allDevices);
  const resourceDevices = selectResourceRanking(allDevices, resourceMetric, 5);
  const instanceLabel = health.virtualMachineTotal ? `主机 ${health.hostTotal} · 虚拟机 ${health.virtualMachineTotal}` : "设备";
  const settingsSection: SettingsSection = capabilities.canConfigureConnection ? "connections" : "workspace";
  const settingsLabel = capabilities.canConfigureConnection ? "连接设置" : "中枢设置";
  const noDataSettingsSection: SettingsSection = capabilities.canManageLocalAgent
    ? (snapshot.localBackend ? "agent" : "connections")
    : "workspace";
  const metricWindowLabel = ({ "1m": "1 分钟", "5m": "5 分钟", "15m": "15 分钟", "1h": "1 小时", "6h": "6 小时", "24h": "1 天", "1d": "1 天", "7d": "7 天", "1w": "1 周", "30d": "1 个月", "1mo": "1 个月", "90d": "90 天", "1y": "1 年" } as Record<string, string>)[metricsWindow] ?? metricsWindow;
  const resourceLabel = resourceMetric === "cpu" ? "CPU 使用率" : resourceMetric === "memory" ? "内存占用" : "磁盘占用";
  const issueCount = health.pending;

  return <div className="workspace-page workspace-page--overview">
    <PageIntro
      eyebrow="总览"
      title={hubAbnormal ? "中枢连接异常" : issueCount ? `${issueCount} 项事项需要留意` : noData ? "等待设备接入" : "系统状态正常"}
      description={health.source === "empty"
        ? capabilities.canManageLocalAgent ? "尚未取得实时设备状态，请先启动本机 Agent 或配置中枢。" : "尚未取得实时设备状态，请确认中枢已接入设备后刷新。"
        : hubAbnormal
          ? cached ? `当前显示的是离线缓存，${health.sourceDetail}；无法确认中枢当前状态。` : "无法连接到中枢，请检查中枢地址与访问密钥。"
          : `${health.sourceDetail}。数据来自实时连接。`}
      actions={<>
        <Button variant="quiet" onClick={() => openSettings(settingsSection)}><Icon name="connection" size={16} />{settingsLabel}</Button>
        <Button variant="primary" onClick={() => navigate({ kind: "devices" })}>查看全部设备<Icon name="arrow" size={16} /></Button>
      </>}
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

    {hubAbnormal ? <div className="workspace-attention">
      <div className="workspace-attention__icon"><Icon name="warning" /></div>
      <div><strong>中枢连接异常</strong><p>{cached ? "无法取得最新数据，页面中的设备信息可能已经过期。" : "无法连接到中枢，请检查中枢地址与访问密钥后重试。"}</p></div>
      <Button variant="quiet" onClick={() => openSettings(settingsSection)}>{settingsLabel}<Icon name="arrow" size={15} /></Button>
    </div> : (health.source === "empty" || (issueCount ?? 0) > 0) ? <div className="workspace-attention">
      <div className="workspace-attention__icon"><Icon name="warning" /></div>
      <div><strong>{noData ? "还没有可用设备" : "设备状态存在异常"}</strong><p>{noData ? "连接中枢并等待设备上报后，这里会显示实时状态。" : `${health.offline} 台设备离线，${snapshot.localBackend?.lastIssueCount ?? 0} 条本机采集问题待处理。`}</p></div>
      <Button variant="quiet" onClick={() => openSettings(noData ? noDataSettingsSection : capabilities.canManageLocalAgent ? "agent" : "workspace")}>查看详情<Icon name="arrow" size={15} /></Button>
    </div> : null}

    <div className="workspace-overview-grid workspace-overview-grid--split">
      <Surface className="workspace-overview-devices">
        <div className="workspace-surface__header">
          <div><span className="workspace-section-kicker">最近设备</span><h3>{allDevices.length} 个实例</h3></div>
          <Button variant="quiet" onClick={() => navigate({ kind: "devices" })}>查看全部</Button>
        </div>
        {cached && <div className="workspace-inline-note">当前为缓存快照，设备列表只读。</div>}
        <div className="workspace-device-rows">
          {recentDevices.length ? recentDevices.map((device) => <DeviceRow key={device.deviceId} device={device} />) : <EmptyState title="还没有设备" detail="连接一个中枢后，设备会出现在这里。" action={<Button variant="primary" onClick={() => openSettings(capabilities.canConfigureConnection ? "connections" : "workspace")}>{capabilities.canConfigureConnection ? "连接设置" : "查看中枢设置"}</Button>} />}
        </div>
      </Surface>

      <Surface className="workspace-resource-observation">
        <div className="workspace-surface__header">
          <div><span className="workspace-section-kicker">资源观察</span><h3>{resourceLabel} · 重点实例</h3></div>
          <M3SegmentedControl options={[{ value: "cpu", label: "CPU" }, { value: "memory", label: "内存" }, { value: "disk", label: "磁盘" }]} value={resourceMetric} onChange={(value) => setResourceMetric(value as typeof resourceMetric)} aria-label="资源观察指标" />
        </div>
        <p className="workspace-surface__description">只展示在线实例的可用指标；缺失或不适用的数据不会被估算。</p>
        <div className="workspace-ranking-list">
          {resourceDevices.length ? resourceDevices.map((device, index) => <div key={device.deviceId} className="workspace-ranking-item">
            <span className="workspace-ranking-badge">{index + 1}</span><span className="workspace-ranking-name">{device.hostname}</span><span className="workspace-ranking-val">
              {resourceMetric === "cpu" && <MetricValue value={device.cpuUsagePercent} unavailable={isMetricUnavailable(device, "cpuUsage")} />}
              {resourceMetric === "memory" && <CapacityMetricValue usedBytes={device.memoryUsedBytes} totalBytes={device.memoryTotalBytes} percentValue={device.memoryUsagePercent} unavailable={isMetricUnavailable(device, "memoryUsage")} />}
              {resourceMetric === "disk" && <CapacityMetricValue usedBytes={device.diskUsedBytes} totalBytes={device.diskTotalBytes} percentValue={device.diskUsagePercent} unavailable={isMetricUnavailable(device, "diskUsage")} />}
            </span>
          </div>) : <div className="workspace-muted-block">暂无可用的{resourceLabel}数据</div>}
        </div>
      </Surface>
    </div>

    {snapshot.overviewMetrics && <div className="workspace-overview-trend">
      <TelemetryChartCard
        title="CPU 趋势预览"
        subtitle={`每个实例一条数据线 · 最近 ${metricWindowLabel}`}
        series={overviewInstances.map((instance) => ({ label: instance.hostname, points: unavailablePoints(instance.cpuUsagePercent, instance.unavailableMetrics?.includes("cpuUsage") ?? false) }))}
        valueFormatter={(value) => `${Math.round(value)}%`}
        fixedMaxValue={100}
      />
    </div>}
  </div>;
}
