import React from "react";
import { useConsole } from "../../context/ConsoleContext";
import { Badge } from "../Common/Badge";
import { formatPercent, formatTimestamp } from "../../utils/formatters";

export const DeviceSelector: React.FC = () => {
  const {
    snapshot,
    selectedDeviceId,
    selectDevice,
    deviceSearchQuery,
    setDeviceSearchQuery,
    deviceFilterStatus,
    setDeviceFilterStatus
  } = useConsole();

  const devices = snapshot?.devices || [];

  const filteredDevices = devices.filter((dev) => {
    // Status filter
    if (deviceFilterStatus === "online" && dev.status !== "online") return false;
    if (deviceFilterStatus === "offline" && dev.status !== "offline") return false;

    // Search query filter
    if (deviceSearchQuery.trim()) {
      const q = deviceSearchQuery.toLowerCase();
      const matchHost = dev.hostname.toLowerCase().includes(q);
      const matchId = dev.deviceId.toLowerCase().includes(q);
      const matchOs = dev.os.toLowerCase().includes(q);
      return matchHost || matchId || matchOs;
    }
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Fleet Controls Bar */}
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontWeight: 600, color: "var(--text-main)" }}>Known Fleet Devices ({filteredDevices.length}):</span>

          {/* Status Filter Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "rgba(0, 0, 0, 0.3)", padding: "2px", borderRadius: "var(--radius-sm)" }}>
            {(["all", "online", "offline"] as const).map((st) => (
              <button
                key={st}
                onClick={() => setDeviceFilterStatus(st)}
                style={{
                  padding: "3px 10px",
                  fontSize: "11px",
                  borderRadius: "3px",
                  border: "none",
                  background: deviceFilterStatus === st ? "var(--border-muted)" : "transparent",
                  color: deviceFilterStatus === st ? "var(--accent-cyan)" : "var(--text-secondary)",
                  fontWeight: deviceFilterStatus === st ? 600 : 400,
                  cursor: "pointer",
                  textTransform: "capitalize"
                }}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Search Input */}
        <input
          type="text"
          className="input-text"
          placeholder="Filter hostname, ID or OS..."
          value={deviceSearchQuery}
          onChange={(e) => setDeviceSearchQuery(e.target.value)}
          style={{ width: "240px" }}
        />
      </div>

      {/* Device Grid */}
      {filteredDevices.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
          No devices matched your current filter criteria.
        </div>
      ) : (
        <div className="grid-3">
          {filteredDevices.map((dev) => {
            const isSelected = dev.deviceId === selectedDeviceId;
            const isLocal = dev.deviceId === snapshot?.localBackend?.config.connection.deviceId || dev.deviceId === "local-win11-host";

            return (
              <div
                key={dev.deviceId}
                className="card"
                onClick={() => selectDevice(dev.deviceId)}
                style={{
                  cursor: "pointer",
                  borderColor: isSelected ? "var(--accent-cyan)" : undefined,
                  background: isSelected ? "var(--bg-card-active)" : undefined,
                  display: "flex",
                  flexDirection: "column",
                  justify: "space-between",
                  gap: "12px",
                  position: "relative"
                }}
              >
                {/* Header */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "14px" }}>{dev.os === "windows" ? "🪟" : "🐧"}</span>
                      <strong style={{ fontSize: "13px", color: "var(--text-main)" }}>{dev.hostname}</strong>
                    </div>
                    <Badge variant={dev.status === "online" ? "online" : "offline"}>
                      {dev.status}
                    </Badge>
                  </div>

                  <div style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", display: "flex", gap: "8px" }}>
                    <span>ID: {dev.deviceId}</span>
                    {isLocal && <span style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>(This Computer)</span>}
                  </div>
                </div>

                {/* Resource Metrics Summary Bars */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {/* CPU Usage */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                      <span style={{ color: "var(--text-secondary)" }}>CPU:</span>
                      <span className="mono" style={{ color: "var(--text-main)" }}>{formatPercent(dev.cpuUsagePercent)}</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, dev.cpuUsagePercent || 0))}%`,
                          backgroundColor: (dev.cpuUsagePercent || 0) > 85 ? "var(--accent-rose)" : "var(--accent-cyan)"
                        }}
                      />
                    </div>
                  </div>

                  {/* GPU Usage if available */}
                  {dev.gpuUsagePercent !== null && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                        <span style={{ color: "var(--text-secondary)" }}>GPU:</span>
                        <span className="mono" style={{ color: "var(--text-main)" }}>{formatPercent(dev.gpuUsagePercent)}</span>
                      </div>
                      <div className="progress-bar-bg">
                        <div
                          className="progress-bar-fill"
                          style={{
                            width: `${Math.min(100, Math.max(0, dev.gpuUsagePercent || 0))}%`,
                            backgroundColor: "var(--accent-indigo)"
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* RAM Usage */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Memory:</span>
                      <span className="mono" style={{ color: "var(--text-main)" }}>{formatPercent(dev.memoryUsagePercent)}</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, dev.memoryUsagePercent || 0))}%`,
                          backgroundColor: "var(--accent-emerald)"
                        }}
                      />
                    </div>
                  </div>

                  {/* Disk Usage */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Storage:</span>
                      <span className="mono" style={{ color: "var(--text-main)" }}>{formatPercent(dev.diskUsagePercent)}</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, dev.diskUsagePercent || 0))}%`,
                          backgroundColor: "var(--accent-amber)"
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Footer metadata */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: "6px",
                    borderTop: "1px solid var(--border-subtle)",
                    fontSize: "10px",
                    color: "var(--text-muted)"
                  }}
                >
                  <span>Agent v{dev.agentVersion || "—"}</span>
                  <span>Last seen: {formatTimestamp(dev.lastSeenAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
