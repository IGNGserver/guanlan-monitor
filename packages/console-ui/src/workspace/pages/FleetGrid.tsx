import React, { useMemo } from "react";
import type { DeviceSummary, SamplePoint } from "@dsc/shared";
import { CapacityBar, Sparkline } from "../charts";
import { evaluateDevice, metricTone, metricValue, type DeviceIssue, type HealthThresholds, type ThresholdMetric } from "../health";
import { formatDate, formatPercent, formatRate } from "../formatters";
import { latestPointValue, type FleetMetric } from "../fleetTrends";
import { Icon, StatusDot } from "../ui";

const ROWS: Array<{ metric: ThresholdMetric; label: string }> = [
  { metric: "cpu", label: "CPU" },
  { metric: "memory", label: "内存" },
  { metric: "disk", label: "磁盘" }
];

const TREND_LABELS: Record<FleetMetric, string> = { cpu: "CPU", memory: "内存", disk: "磁盘", network: "网络收发" };

function rank(issues: DeviceIssue[]): number {
  if (!issues.length) return 3;
  if (issues.some((issue) => issue.kind !== "offline" && issue.severity === "critical")) return 0;
  if (issues.some((issue) => issue.kind !== "offline")) return 1;
  return 2;
}

/**
 * Every device as a small card: its three capacities against their thresholds
 * and a trend of the metric chosen above the fleet chart. Devices that need
 * attention come first — a resource past its critical line, then past its
 * warning line, then offline — and keep the directory order within each group.
 */
export function FleetGrid({ devices, trends, metric, windowLabel, thresholds, onOpen }: {
  devices: readonly DeviceSummary[];
  /** Points of the selected metric by device id, in that metric's unit. */
  trends: ReadonlyMap<string, readonly SamplePoint[]>;
  metric: FleetMetric;
  windowLabel: string;
  thresholds: HealthThresholds;
  onOpen: (deviceId: string) => void;
}) {
  const cards = useMemo(() => devices
    .map((device, order) => ({ device, order, issues: evaluateDevice(device, thresholds) }))
    .sort((left, right) => rank(left.issues) - rank(right.issues) || left.order - right.order), [devices, thresholds]);
  return (
    <ul className="workspace-fleet-grid" aria-label="设备一览">
      {cards.map(({ device, issues }) => {
        const online = device.status === "online";
        const worst = issues.find((issue) => issue.severity === "critical") ?? issues[0];
        const state = !online ? "offline" : worst ? worst.severity : "normal";
        const points = trends.get(device.deviceId) ?? [];
        const latest = latestPointValue(points);
        const trendTone = metric === "network" ? "normal" : metricTone(latest, thresholds[metric]);
        return (
          <li key={device.deviceId}>
            <button type="button" className={`workspace-fleet-card is-${state}`} onClick={() => onOpen(device.deviceId)} aria-label={`打开 ${device.hostname}`}>
              <span className="workspace-fleet-card__head">
                <StatusDot state={online ? "online" : "offline"} />
                <strong>{device.hostname}</strong>
                <span className={`workspace-fleet-card__state is-${state}`}>{!online ? "离线" : state === "critical" ? "严重" : state === "warning" ? "警告" : "正常"}</span>
              </span>
              <span className="workspace-fleet-card__metrics">
                {ROWS.map(({ metric: row, label }) => {
                  const value = metricValue(device, row);
                  const tone = online ? metricTone(value, thresholds[row]) : "normal";
                  return (
                    <span className={`workspace-fleet-card__metric is-${tone}`} key={row}>
                      <span>{label}</span>
                      <CapacityBar percent={value} tone={tone} marks={thresholds[row]} size="sm" />
                      <strong>{formatPercent(value)}</strong>
                    </span>
                  );
                })}
              </span>
              <span className="workspace-fleet-card__trend">
                <span className="workspace-fleet-card__trend-label">
                  <span>{TREND_LABELS[metric]} · 最近 {windowLabel}</span>
                  <strong>{latest == null ? "—" : metric === "network" ? formatRate(latest) : formatPercent(latest)}</strong>
                </span>
                <Sparkline points={points} maxValue={metric === "network" ? undefined : 100} tone={online ? trendTone : "normal"} height={36} />
              </span>
              {!online && <span className="workspace-fleet-card__note"><Icon name="clock" size={14} />最后在线 {formatDate(device.lastSeenAt)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
