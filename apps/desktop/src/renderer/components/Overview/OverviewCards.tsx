import React from "react";
import { useConsole } from "../../context/ConsoleContext";
import {
  formatPercent,
  formatBytes,
  formatThroughput,
  formatFrequency,
  formatTemp
} from "../../utils/formatters";

export const OverviewCards: React.FC = () => {
  const { snapshot } = useConsole();
  const latest = snapshot?.metrics?.latest;

  if (!latest) {
    return (
      <div className="card" style={{ padding: "24px", color: "var(--text-muted)", textAlign: "center" }}>
        No telemetry snapshot data available for selected device.
      </div>
    );
  }

  // Calculate memory usage %
  const memUsed = latest.memoryUsedBytes || 0;
  const memTotal = latest.memoryTotalBytes || 1;
  const memPercent = (memUsed / memTotal) * 100;

  // Calculate swap usage %
  const swapUsed = latest.swapUsedBytes || 0;
  const swapTotal = latest.swapTotalBytes || 0;
  const swapPercent = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0;

  // Calculate disk usage %
  const diskUsed = latest.diskUsedBytes || 0;
  const diskTotal = latest.diskTotalBytes || 1;
  const diskPercent = (diskUsed / diskTotal) * 100;

  // Primary GPU
  const primaryGpu = latest.gpus && latest.gpus.length > 0 ? latest.gpus[0] : null;

  // Primary Fan
  const primaryFan = latest.fans && latest.fans.length > 0 ? latest.fans[0] : null;

  return (
    <div className="grid-3">
      {/* 1. CPU Overview Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <span style={{ fontSize: "16px" }}>💻</span>
            <span>CPU Processor</span>
          </div>
          <span className="mono" style={{ fontSize: "14px", fontWeight: 700, color: "var(--accent-cyan)" }}>
            {formatPercent(latest.cpuUsagePercent)}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{
                width: `${Math.min(100, Math.max(0, latest.cpuUsagePercent || 0))}%`,
                backgroundColor: "var(--accent-cyan)"
              }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>Frequency: </span>
              <strong className="mono" style={{ color: "var(--text-main)" }}>{formatFrequency(latest.cpuFrequencyMHz)}</strong>
            </div>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>Temperature: </span>
              <strong className="mono" style={{ color: "var(--text-main)" }}>{formatTemp(latest.cpuTemperatureC)}</strong>
            </div>
          </div>
          {latest.cpuPackages && latest.cpuPackages.length > 0 && (
            <div style={{ fontSize: "10px", color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)", paddingTop: "6px" }}>
              {latest.cpuPackages[0].name} ({latest.cpuPackages[0].coreCount || "—"} Cores / {latest.cpuPackages[0].logicalCount || "—"} Threads)
            </div>
          )}
        </div>
      </div>

      {/* 2. GPU Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <span style={{ fontSize: "16px" }}>🎮</span>
            <span>GPU Graphics</span>
          </div>
          <span className="mono" style={{ fontSize: "14px", fontWeight: 700, color: "var(--accent-indigo)" }}>
            {primaryGpu ? formatPercent(primaryGpu.utilizationPercent) : "N/A"}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{
                width: `${Math.min(100, Math.max(0, primaryGpu?.utilizationPercent || 0))}%`,
                backgroundColor: "var(--accent-indigo)"
              }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>VRAM Used: </span>
              <strong className="mono" style={{ color: "var(--text-main)" }}>
                {primaryGpu ? `${formatBytes(primaryGpu.memoryUsedBytes)} / ${formatBytes(primaryGpu.memoryTotalBytes)}` : "—"}
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>Temp: </span>
              <strong className="mono" style={{ color: "var(--text-main)" }}>{primaryGpu ? formatTemp(primaryGpu.temperatureC) : "—"}</strong>
            </div>
          </div>
          {primaryGpu && (
            <div style={{ fontSize: "10px", color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)", paddingTop: "6px" }}>
              {primaryGpu.name} ({primaryGpu.driverVersion ? `Driver ${primaryGpu.driverVersion}` : "Native"})
            </div>
          )}
        </div>
      </div>

      {/* 3. Memory & Swap Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <span style={{ fontSize: "16px" }}>⚡</span>
            <span>Memory & Swap</span>
          </div>
          <span className="mono" style={{ fontSize: "14px", fontWeight: 700, color: "var(--accent-emerald)" }}>
            {formatPercent(memPercent)}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{
                width: `${Math.min(100, Math.max(0, memPercent))}%`,
                backgroundColor: "var(--accent-emerald)"
              }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>RAM: </span>
              <strong className="mono" style={{ color: "var(--text-main)" }}>{formatBytes(memUsed)} / {formatBytes(memTotal)}</strong>
            </div>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>Swap: </span>
              <strong className="mono" style={{ color: "var(--text-main)" }}>{swapTotal > 0 ? `${formatBytes(swapUsed)} (${formatPercent(swapPercent)})` : "Off"}</strong>
            </div>
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)", paddingTop: "6px", display: "flex", justifyContent: "space-between" }}>
            <span>Speed: {latest.memorySpeedMHz ? `${latest.memorySpeedMHz} MHz` : "Standard"}</span>
            <span>Slots: {latest.memorySlotCount || "N/A"}</span>
          </div>
        </div>
      </div>

      {/* 4. Storage Disks Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <span style={{ fontSize: "16px" }}>💽</span>
            <span>Storage Disks</span>
          </div>
          <span className="mono" style={{ fontSize: "14px", fontWeight: 700, color: "var(--accent-amber)" }}>
            {formatPercent(diskPercent)}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{
                width: `${Math.min(100, Math.max(0, diskPercent))}%`,
                backgroundColor: "var(--accent-amber)"
              }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>Used Space: </span>
              <strong className="mono" style={{ color: "var(--text-main)" }}>{formatBytes(diskUsed)} / {formatBytes(diskTotal)}</strong>
            </div>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>Active Disks: </span>
              <strong className="mono" style={{ color: "var(--text-main)" }}>{latest.disks ? latest.disks.length : 1} Units</strong>
            </div>
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)", paddingTop: "6px" }}>
            {latest.disks && latest.disks.length > 0 ? `${latest.disks[0].mountPoint} (${latest.disks[0].filesystem || "NTFS/ext4"}) - Health: ${latest.disks[0].healthStatus || "OK"}` : "Primary Disk Volume"}
          </div>
        </div>
      </div>

      {/* 5. Network Interfaces Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <span style={{ fontSize: "16px" }}>📡</span>
            <span>Network Traffic</span>
          </div>
          <div style={{ display: "flex", gap: "8px", fontSize: "11px" }}>
            <span className="mono" style={{ color: "var(--accent-cyan)" }}>↓ {formatThroughput(latest.networkRxBytesPerSec)}</span>
            <span className="mono" style={{ color: "var(--accent-purple)" }}>↑ {formatThroughput(latest.networkTxBytesPerSec)}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>Rx Speed: </span>
              <strong className="mono" style={{ color: "var(--accent-cyan)" }}>{formatThroughput(latest.networkRxBytesPerSec)}</strong>
            </div>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>Tx Speed: </span>
              <strong className="mono" style={{ color: "var(--accent-purple)" }}>{formatThroughput(latest.networkTxBytesPerSec)}</strong>
            </div>
          </div>
          {latest.networkInterfaces && latest.networkInterfaces.length > 0 && (
            <div style={{ fontSize: "10px", color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)", paddingTop: "6px", display: "flex", justifyContent: "space-between" }}>
              <span>{latest.networkInterfaces[0].name}</span>
              <span>{latest.networkInterfaces[0].ipv4?.[0] || "No IP"}</span>
            </div>
          )}
        </div>
      </div>

      {/* 6. Cooling Fans & Sensors Card */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <span style={{ fontSize: "16px" }}>🌀</span>
            <span>Fans & Thermal Sensors</span>
          </div>
          <span className="mono" style={{ fontSize: "14px", fontWeight: 700, color: "var(--accent-cyan)" }}>
            {primaryFan ? `${primaryFan.rpm} RPM` : "N/A"}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>Primary Fan: </span>
              <strong className="mono" style={{ color: "var(--text-main)" }}>{primaryFan ? primaryFan.label : "None Detected"}</strong>
            </div>
            <div>
              <span style={{ color: "var(--text-secondary)" }}>Control Mode: </span>
              <strong className="mono" style={{ color: "var(--text-main)" }}>{primaryFan?.controlMode || "Auto"}</strong>
            </div>
          </div>
          {primaryFan && (
            <div style={{ fontSize: "10px", color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)", paddingTop: "6px" }}>
              Target: {primaryFan.targetTemperatureC ? `${primaryFan.targetTemperatureC}°C` : "60°C"} {primaryFan.note ? `• ${primaryFan.note}` : ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
