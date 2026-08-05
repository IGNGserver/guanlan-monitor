import React from "react";
import type { MetricWindow, TrafficCalendarMode } from "@dsc/shared";
import { useGuanlan } from "../../context/GuanlanContext";
import { SpectrumCard } from "../Common/SpectrumCard";
import { SpectrumButton } from "../Common/SpectrumButton";
import { GuanlanChart } from "../Charts/GuanlanChart";
import { EmptyState } from "../Common/EmptyState";
import { formatBytes } from "../../helpers/metricsNormalizer";

export const HistoryView: React.FC = () => {
  const {
    snapshot,
    loading,
    error,
    metricWindow,
    setMetricWindow,
    trafficMode,
    setTrafficMode,
    refresh
  } = useGuanlan();

  if (loading && !snapshot) return <EmptyState variant="loading" title="正在获取历史遥测数据..." />;

  if (error && !snapshot) {
    return (
      <EmptyState
        variant="error"
        title="获取历史数据失败"
        description={error}
        actionLabel="重试"
        onAction={refresh}
      />
    );
  }

  if (!snapshot) return <EmptyState variant="loading" />;

  const windowOptions: { key: MetricWindow; label: string }[] = [
    { key: "5m", label: "5分钟" },
    { key: "1h", label: "1小时" },
    { key: "24h", label: "24小时" },
    { key: "7d", label: "7天" },
    { key: "30d", label: "30天" },
    { key: "1y", label: "1年" }
  ];

  const trafficModeOptions: { key: TrafficCalendarMode; label: string }[] = [
    { key: "day", label: "日视图 (Day)" },
    { key: "week", label: "周视图 (Week)" },
    { key: "month", label: "月视图 (Month)" }
  ];

  const trafficCalendar = snapshot.trafficCalendar;
  const trafficCells = trafficCalendar?.cells || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Metric Window Time Selector */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--gl-text-primary)" }}>
          遥测数据时间窗口 (Metric Window)
        </div>
        <div style={{ display: "flex", gap: 4 }} role="group" aria-label="遥测时间窗口">
          {windowOptions.map((opt) => (
            <SpectrumButton
              key={opt.key}
              variant={metricWindow === opt.key ? "primary" : "secondary"}
              size="sm"
              onClick={() => setMetricWindow(opt.key)}
              aria-pressed={metricWindow === opt.key}
            >
              {opt.label}
            </SpectrumButton>
          ))}
        </div>
      </div>

      {/* Historical Telemetry Chart */}
      <SpectrumCard title={`历史遥测与资源占用趋势 (窗口: ${metricWindow})`}>
        <GuanlanChart metrics={snapshot.metrics} title="硬件资源历史折线图" height={240} />
      </SpectrumCard>

      {/* Traffic Calendar Header and Mode Switch */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--gl-text-primary)" }}>
            {trafficCalendar?.title || "网络流量与数据传输日历"}
          </div>
          {trafficCalendar && (
            <div style={{ fontSize: 11, color: "var(--gl-text-muted)" }}>
              总接收: <strong>{formatBytes(trafficCalendar.totalRxBytes)}</strong> | 总发送: <strong>{formatBytes(trafficCalendar.totalTxBytes)}</strong>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 4 }} role="group" aria-label="流量日历维度">
          {trafficModeOptions.map((opt) => (
            <SpectrumButton
              key={opt.key}
              variant={trafficMode === opt.key ? "primary" : "secondary"}
              size="sm"
              onClick={() => setTrafficMode(opt.key)}
              aria-pressed={trafficMode === opt.key}
            >
              {opt.label}
            </SpectrumButton>
          ))}
        </div>
      </div>

      {/* Traffic Calendar Data Table */}
      <SpectrumCard title={`网络流量记录 (${trafficCells.length} 个周期)`}>
        {trafficCells.length === 0 ? (
          <EmptyState variant="empty" title="尚无历史流量统计记录" />
        ) : (
          <div className="gl-table-container">
            <table className="gl-table">
              <thead>
                <tr>
                  <th>时间范围 (Range / Key)</th>
                  <th>接收流量 (Rx)</th>
                  <th>发送流量 (Tx)</th>
                  <th>总数据交换</th>
                  <th>当前周期</th>
                </tr>
              </thead>
              <tbody>
                {trafficCells.map((cell) => {
                  const rxStr = formatBytes(cell.totalRxBytes);
                  const txStr = formatBytes(cell.totalTxBytes);
                  const totalStr = formatBytes(cell.totalRxBytes + cell.totalTxBytes);
                  return (
                    <tr
                      key={cell.key}
                      style={{
                        backgroundColor: cell.isSelected ? "var(--gl-accent-quiet)" : undefined
                      }}
                    >
                      <td style={{ fontFamily: "var(--gl-font-mono)", fontWeight: 500 }}>
                        <div>{cell.label}</div>
                        <div style={{ fontSize: 10, color: "var(--gl-text-muted)" }}>{cell.key}</div>
                      </td>
                      <td style={{ color: "var(--gl-accent-text)", fontFamily: "var(--gl-font-mono)" }}>
                        ↓ {rxStr}
                      </td>
                      <td style={{ color: "var(--gl-status-online)", fontFamily: "var(--gl-font-mono)" }}>
                        ↑ {txStr}
                      </td>
                      <td style={{ fontWeight: 600, fontFamily: "var(--gl-font-mono)" }}>
                        {totalStr}
                      </td>
                      <td>
                        {cell.isCurrentPeriod ? (
                          <span style={{ fontSize: 11, color: "var(--gl-accent-text)", fontWeight: 600 }}>[当期]</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SpectrumCard>
    </div>
  );
};
