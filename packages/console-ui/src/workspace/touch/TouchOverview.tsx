import React, { useMemo, useState } from "react";
import { useWorkspace } from "../WorkspaceContext";
import { useTouchState } from "./TouchState";
import { selectAttentionDevices, selectHealthSummary } from "../selectors";
import { Button, Icon } from "../ui";
import { M3SegmentedControl, M3Select } from "../m3";
import { TimeSeriesChart, type ChartSeries } from "../charts";
import { thresholdLines } from "../health";
import { selectFleetTrends, type FleetMetric } from "../fleetTrends";
import { formatDate, formatPercent, formatRate } from "../formatters";
import { EmptyState, metricWindowOptions, type DesktopMetricWindowValue } from "../pages/shared";
import { TouchDeviceRow } from "./TouchDeviceRow";

const TREND_TITLES: Record<FleetMetric, string> = { cpu: "CPU 使用率", memory: "内存占用率", disk: "磁盘占用率", network: "网络收发" };

/**
 * The fleet trend on a phone: the same chart as the desktop overview, sized for
 * one column. It sits right under the status card so the first screen shows
 * how the machines are doing, not only how many there are.
 */
function TouchFleetTrend() {
  const { snapshot, allDevices, metricsWindow, setMetricsWindow, healthThresholds } = useWorkspace();
  const [metric, setMetric] = useState<FleetMetric>("cpu");
  const instances = snapshot?.overviewMetrics?.instances;
  const fleet = useMemo(() => selectFleetTrends(instances ?? [], allDevices, metric), [instances, allDevices, metric]);
  const series = useMemo<ChartSeries[]>(() => fleet.trends.map((trend) => ({
    label: trend.offline ? `${trend.hostname}（离线）` : trend.hostname,
    points: trend.points,
    valueFormatter: fleet.percent ? formatPercent : formatRate,
    dashed: trend.offline
  })), [fleet]);
  if (!instances?.length) return null;
  return <section className="touch-trend" aria-labelledby="touch-trend-title">
    <header>
      <h2 id="touch-trend-title">{TREND_TITLES[metric]}</h2>
      <M3Select label="时间范围" hideLabel value={metricsWindow} onChange={(event) => setMetricsWindow(event.target.value as DesktopMetricWindowValue)} options={metricWindowOptions} />
    </header>
    <M3SegmentedControl size="sm" aria-label="趋势指标" value={metric} onChange={(value) => setMetric(value as FleetMetric)} options={[{ value: "cpu", label: "CPU" }, { value: "memory", label: "内存" }, { value: "disk", label: "磁盘" }, { value: "network", label: "网络" }]} />
    <TimeSeriesChart series={series} maxValue={fleet.percent ? 100 : undefined} compact height={200} thresholds={metric === "network" ? undefined : thresholdLines(healthThresholds[metric])} />
    {fleet.missingCapacity.length ? <p className="touch-section__hint">{fleet.missingCapacity.join("、")} 未上报容量，未绘制</p> : null}
  </section>;
}

export function TouchOverview() {
  const { snapshot, allDevices, navigate, openSettings, capabilities, healthThresholds } = useWorkspace();
  const { pins, setStatus, setQuery } = useTouchState();
  if (!snapshot) return null;
  const health = selectHealthSummary(snapshot, allDevices, formatDate, capabilities.liveDataTransport, healthThresholds);
  const attention = health.source === "live" ? selectAttentionDevices(allDevices, 3, healthThresholds) : [];
  const onlyOffline = health.overThreshold === 0;
  const pinned = allDevices.filter((device) => pins.includes(device.deviceId));
  const frequent = pinned.length ? pinned : allDevices.slice(0, 4);
  // The offline filter is the right destination only when offline devices are
  // the whole story; a resource issue lives on an online device.
  const openAttention = () => { setStatus(onlyOffline ? "offline" : "all"); setQuery(""); navigate({ kind: "devices" }); };
  return <div className="touch-page touch-overview">
    <header className="touch-page-title"><p>设备状态</p><h1>总览</h1></header>
    <section className={`touch-health${health.pending ? " has-attention" : ""}`} aria-label="中枢概况">
      <span className="touch-health__mark"><Icon name={health.source === "cache" ? "clock" : health.pending ? "warning" : "check"} size={28} /></span>
      <p>{health.source === "cache" ? "当前状态待确认" : health.source === "unknown" ? "等待恢复连接" : !health.total ? "等待第一台设备" : health.pending ? `${health.pending} 台设备需要关注` : "设备都在线"}</p>
      <span>{health.source === "cache" ? "显示上次保存的数据，联网后重新确认" : health.source === "unknown" ? "暂时无法确认设备状态" : `${health.online} 台在线 · ${health.total} 台已接入`}</span>
      <div className="touch-health__counts"><div><strong>{health.source === "cache" || health.source === "unknown" ? "—" : health.online}</strong><span>在线</span></div>
        <div><strong>{health.pending ?? "—"}</strong><span>需关注</span></div><div><strong>{health.total}</strong><span>{health.source === "cache" ? "已缓存" : "设备"}</span></div></div>
      <small>{health.sourceDetail}</small>
    </section>
    <TouchFleetTrend />
    {!!attention.length && <section className="touch-section"><header><h2>需要关注</h2><Button variant="text" onClick={openAttention}>查看全部<Icon name="chevronRight" size={16} /></Button></header>
      <p className="touch-section__hint">{onlyOffline ? "离线设备保留最近一次上报，请查看最后在线时间。" : "离线设备和资源超过阈值的设备，最紧急的在前。"}</p>
      <div className="touch-device-list">{attention.map((device) => <TouchDeviceRow key={device.deviceId} device={device} />)}</div>
    </section>}
    {!!frequent.length && <section className="touch-section"><header><h2>{pinned.length ? "常用设备" : "设备速览"}</h2><Button variant="text" onClick={() => { setStatus("all"); setQuery(""); navigate({ kind: "devices" }); }}>全部设备<Icon name="chevronRight" size={16} /></Button></header>
      {!pinned.length && <p className="touch-section__hint">在设备的更多操作中设为常用，下次打开即可查看。</p>}
      <div className="touch-device-list">{frequent.map((device) => <TouchDeviceRow key={device.deviceId} device={device} />)}</div>
    </section>}
    {!health.total && <EmptyState title="让设备开始上报" detail="在设备上运行 Agent 并连接当前中枢，首次上报后会自动出现在这里。" action={<Button variant="primary" onClick={() => openSettings("connections")}>查看连接</Button>} />}
  </div>;
}
