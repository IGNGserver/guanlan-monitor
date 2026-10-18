import React from "react";
import type { DeviceSummary, SamplePoint } from "@dsc/shared";
import { CapacityBar, Sparkline } from "../charts";
import { metricTone, metricValue, type HealthThresholds, type ThresholdMetric } from "../health";
import { formatBytes, formatPercent, formatRate } from "../formatters";
import { latestPointValue, sumRates } from "../fleetTrends";
import type { DeviceTabId } from "../dashboard";

export interface DeviceKpiInput {
  device: DeviceSummary;
  thresholds: HealthThresholds;
  windowLabel: string;
  cpu: readonly SamplePoint[];
  /** Percent of the device's own capacity. */
  memory: readonly SamplePoint[];
  disk: readonly SamplePoint[];
  gpu: readonly SamplePoint[] | null;
  networkRx: readonly SamplePoint[];
  networkTx: readonly SamplePoint[];
  memoryCaption: string;
  diskCaption: string;
  /** Whether each metric is meaningful on this device. */
  unavailable: (metric: ThresholdMetric | "network") => boolean;
  onOpen: (tab: DeviceTabId) => void;
}

const THRESHOLD_WORDS = { warning: "警告", critical: "严重" } as const;

function PercentTile({ label, metric, points, caption, tab, input }: {
  label: string;
  metric: ThresholdMetric;
  points: readonly SamplePoint[];
  caption?: string;
  tab: DeviceTabId;
  input: DeviceKpiInput;
}) {
  const { device, thresholds, unavailable } = input;
  const online = device.status === "online";
  const value = unavailable(metric) ? null : metricValue(device, metric) ?? latestPointValue(points);
  const rule = thresholds[metric];
  const tone = online ? metricTone(value, rule) : "normal";
  const note = tone === "normal" ? caption : `超过${THRESHOLD_WORDS[tone]}阈值 ${tone === "critical" ? rule.critical : rule.warning}%`;
  return (
    <button type="button" className={`workspace-kpi is-${tone}`} onClick={() => input.onOpen(tab)} aria-label={`${label} ${formatPercent(value)}，查看${label}图表`}>
      <span className="workspace-kpi__label">{label}</span>
      <strong className="workspace-kpi__value">{unavailable(metric) ? "不适用" : formatPercent(value)}</strong>
      <CapacityBar percent={value} tone={tone} marks={rule} size="sm" />
      <Sparkline points={points} maxValue={100} tone={tone} height={28} />
      <span className="workspace-kpi__note">{note ?? `最近 ${input.windowLabel}`}</span>
    </button>
  );
}

/**
 * The device's vital signs in one row, above the tabs: each figure is the last
 * report, its bar shows how close it is to the thresholds, and its sparkline
 * covers the selected range. A tile opens the tab that charts it in full.
 */
export function DeviceKpiStrip(input: DeviceKpiInput) {
  const network = sumRates(input.networkRx, input.networkTx);
  const rx = latestPointValue(input.networkRx);
  const tx = latestPointValue(input.networkTx);
  const showGpu = input.gpu != null && !input.unavailable("gpu");
  return (
    <div className="workspace-kpi-strip" role="group" aria-label="关键指标">
      <PercentTile label="CPU" metric="cpu" points={input.cpu} tab="compute" input={input} />
      <PercentTile label="内存" metric="memory" points={input.memory} caption={input.memoryCaption} tab="compute" input={input} />
      <PercentTile label="磁盘" metric="disk" points={input.disk} caption={input.diskCaption} tab="storage" input={input} />
      {showGpu && <PercentTile label="GPU" metric="gpu" points={input.gpu ?? []} tab="thermal_hardware" input={input} />}
      <button type="button" className="workspace-kpi is-normal" onClick={() => input.onOpen("network")} aria-label="网络吞吐，查看网络图表">
        <span className="workspace-kpi__label">网络</span>
        <strong className="workspace-kpi__value workspace-kpi__value--pair">
          {input.unavailable("network") ? "不适用" : <><span>↓ {formatRate(rx)}</span><span>↑ {formatRate(tx)}</span></>}
        </strong>
        <Sparkline points={network} height={28} />
        <span className="workspace-kpi__note">收发合计 · 最近 {input.windowLabel}</span>
      </button>
    </div>
  );
}

/** Used bytes over time as a share of a fixed capacity. */
export function shareOf(points: readonly SamplePoint[] | undefined, total: number | null | undefined): SamplePoint[] {
  if (!points?.length || typeof total !== "number" || !Number.isFinite(total) || total <= 0) return [];
  return points.filter((point) => Number.isFinite(point.value)).map((point) => ({ timestamp: point.timestamp, value: Math.min(100, Math.max(0, (point.value / total) * 100)) }));
}

export function capacityCaption(used: number | null | undefined, total: number | null | undefined): string | undefined {
  return typeof used === "number" && typeof total === "number" && total > 0 ? `${formatBytes(used)} / ${formatBytes(total)}` : undefined;
}
