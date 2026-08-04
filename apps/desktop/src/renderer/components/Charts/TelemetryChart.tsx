import React, { useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from "recharts";
import { useConsole } from "../../context/ConsoleContext";
import { formatPercent, formatThroughput, formatTimeOnly } from "../../utils/formatters";

type ChartMetricTab = "cpu" | "gpu" | "memory" | "network" | "disk";

export const TelemetryChart: React.FC = () => {
  const { snapshot, metricWindow } = useConsole();
  const [activeTab, setActiveTab] = useState<ChartMetricTab>("cpu");

  const series = snapshot?.metrics?.series;

  if (!series) {
    return (
      <div className="card" style={{ height: "260px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
        No historical metric series available.
      </div>
    );
  }

  // Format CPU chart data
  const cpuData = (series.cpuUsagePercent || []).map((pt, idx) => ({
    time: formatTimeOnly(pt.timestamp),
    cpuUsage: pt.value,
    freq: series.cpuFrequencyMHz?.[idx]?.value || 0,
    temp: series.cpuTemperatureC?.[idx]?.value || 0
  }));

  // Format GPU chart data
  const gpuData = (series.gpuUsagePercent || []).map((pt, idx) => ({
    time: formatTimeOnly(pt.timestamp),
    gpuUsage: pt.value,
    vramUsage: series.gpuMemoryUsagePercent?.[idx]?.value || 0,
    temp: series.gpuTemperatureC?.[idx]?.value || 0
  }));

  // Format Memory chart data
  const memoryData = (series.memoryUsagePercent || []).map((pt, idx) => ({
    time: formatTimeOnly(pt.timestamp),
    ramUsage: pt.value,
    swapUsage: series.swapUsagePercent?.[idx]?.value || 0
  }));

  // Format Network chart data
  const networkData = (series.networkRxBytesPerSec || []).map((pt, idx) => ({
    time: formatTimeOnly(pt.timestamp),
    rxRate: pt.value,
    txRate: series.networkTxBytesPerSec?.[idx]?.value || 0
  }));

  // Format Disk chart data
  const diskData = (series.diskReadBytesPerSec || []).map((pt, idx) => ({
    time: formatTimeOnly(pt.timestamp),
    readRate: pt.value,
    writeRate: series.diskWriteBytesPerSec?.[idx]?.value || 0
  }));

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Chart Header Tabs */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-main)" }}>Historical Telemetry Series:</span>
          <div style={{ display: "flex", gap: "4px", background: "rgba(0,0,0,0.3)", padding: "2px", borderRadius: "var(--radius-sm)" }}>
            {(
              [
                { id: "cpu", label: "CPU" },
                { id: "gpu", label: "GPU" },
                { id: "memory", label: "Memory" },
                { id: "network", label: "Network Rate" },
                { id: "disk", label: "Disk I/O Rate" }
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: "3px 10px",
                  fontSize: "11px",
                  borderRadius: "3px",
                  border: "none",
                  background: activeTab === t.id ? "var(--border-muted)" : "transparent",
                  color: activeTab === t.id ? "var(--accent-cyan)" : "var(--text-secondary)",
                  fontWeight: activeTab === t.id ? 600 : 400,
                  cursor: "pointer"
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          Window: {metricWindow}
        </span>
      </div>

      {/* Chart Container */}
      <div style={{ width: "100%", height: "240px" }}>
        <ResponsiveContainer width="100%" height="100%">
          {activeTab === "cpu" ? (
            <AreaChart data={cpuData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#16202c" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={10} domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0d131a", borderColor: "#1e2d3e", borderRadius: "6px", fontSize: "11px", color: "#f1f5f9" }}
                formatter={(val: any) => [`${val}%`, "CPU Usage"]}
              />
              <Area type="monotone" dataKey="cpuUsage" stroke="#38bdf8" strokeWidth={2} fillOpacity={1} fill="url(#colorCpu)" />
            </AreaChart>
          ) : activeTab === "gpu" ? (
            <AreaChart data={gpuData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorGpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#818cf8" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#16202c" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={10} domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0d131a", borderColor: "#1e2d3e", borderRadius: "6px", fontSize: "11px", color: "#f1f5f9" }}
                formatter={(val: any, name: any) => [name === "gpuUsage" ? `${val}% (Core)` : `${val}% (VRAM)`, name]}
              />
              <Area type="monotone" dataKey="gpuUsage" stroke="#818cf8" strokeWidth={2} fillOpacity={1} fill="url(#colorGpu)" />
              <Line type="monotone" dataKey="vramUsage" stroke="#c084fc" strokeWidth={1.5} dot={false} />
            </AreaChart>
          ) : activeTab === "memory" ? (
            <AreaChart data={memoryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#16202c" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={10} domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0d131a", borderColor: "#1e2d3e", borderRadius: "6px", fontSize: "11px", color: "#f1f5f9" }}
                formatter={(val: any, name: any) => [`${val}%`, name === "ramUsage" ? "RAM Usage" : "Swap Usage"]}
              />
              <Area type="monotone" dataKey="ramUsage" stroke="#34d399" strokeWidth={2} fillOpacity={1} fill="url(#colorMem)" />
              <Line type="monotone" dataKey="swapUsage" stroke="#fbbf24" strokeWidth={1.5} dot={false} />
            </AreaChart>
          ) : activeTab === "network" ? (
            <LineChart data={networkData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#16202c" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={10} tickFormatter={(v) => formatThroughput(v)} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0d131a", borderColor: "#1e2d3e", borderRadius: "6px", fontSize: "11px", color: "#f1f5f9" }}
                formatter={(val: any, name: any) => [formatThroughput(Number(val)), name === "rxRate" ? "Download (Rx)" : "Upload (Tx)"]}
              />
              <Line type="monotone" dataKey="rxRate" stroke="#38bdf8" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="txRate" stroke="#c084fc" strokeWidth={2} dot={false} />
            </LineChart>
          ) : (
            <LineChart data={diskData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#16202c" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={10} tickFormatter={(v) => formatThroughput(v)} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0d131a", borderColor: "#1e2d3e", borderRadius: "6px", fontSize: "11px", color: "#f1f5f9" }}
                formatter={(val: any, name: any) => [formatThroughput(Number(val)), name === "readRate" ? "Disk Read" : "Disk Write"]}
              />
              <Line type="monotone" dataKey="readRate" stroke="#fbbf24" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="writeRate" stroke="#f87171" strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
