import React from "react";
import { useConsole } from "../../context/ConsoleContext";
import { Badge } from "../Common/Badge";
import type { MetricWindow } from "@dsc/shared";
import { getMetricWindowLabel, formatTimeOnly } from "../../utils/formatters";

export const TopHeader: React.FC = () => {
  const {
    snapshot,
    activeTab,
    selectedDeviceId,
    metricWindow,
    setMetricWindow,
    refreshing,
    refreshSnapshot,
    deviceSearchQuery,
    setDeviceSearchQuery,
    hasPendingChanges,
    triggerCloudPush,
    cloudPushStatus,
    cloudPushMessage
  } = useConsole();

  const selectedDevice = snapshot?.devices.find(d => d.deviceId === selectedDeviceId);
  const isCache = snapshot?.source === "cache";
  const isEmpty = snapshot?.source === "empty";
  const cacheAge = snapshot?.cache?.ageSeconds;

  const availableWindows: MetricWindow[] = ["5m", "1h", "6h", "24h", "7d", "30d", "90d", "1y"];

  return (
    <header
      style={{
        height: "52px",
        background: "var(--bg-card)",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        flexShrink: 0
      }}
    >
      {/* Title & Device Indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "8px" }}>
          {activeTab === "fleet" && "Fleet Overview"}
          {activeTab === "device-detail" && (selectedDevice ? selectedDevice.hostname : "Device Telemetry")}
          {activeTab === "local-config" && "This Computer Configuration"}
          {activeTab === "traffic-calendar" && "Bandwidth Traffic Calendar"}
          {activeTab === "diagnostics" && "Local Backend & Diagnostic Log"}
        </h2>

        {/* Live / Cache Badge */}
        {isCache ? (
          <Badge variant="cache">
            Cached ({cacheAge !== null && cacheAge !== undefined ? `${cacheAge}s ago` : "offline"})
          </Badge>
        ) : isEmpty ? (
          <Badge variant="offline">No live data</Badge>
        ) : (
          <Badge variant="live">Live Telemetry</Badge>
        )}
      </div>

      {/* Center Controls: Search Input */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {activeTab === "fleet" && (
          <div style={{ position: "relative" }}>
            <input
              id="device-search-input"
              type="text"
              className="input-text"
              placeholder="Search hostname / ID... (/)"
              value={deviceSearchQuery}
              onChange={(e) => setDeviceSearchQuery(e.target.value)}
              style={{ width: "220px", paddingRight: "30px" }}
            />
            {deviceSearchQuery && (
              <button
                onClick={() => setDeviceSearchQuery("")}
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "12px"
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* History Window Selector */}
        {(activeTab === "device-detail" || activeTab === "fleet") && (
          <div style={{ display: "flex", alignItems: "center", background: "rgba(0, 0, 0, 0.3)", borderRadius: "var(--radius-sm)", padding: "2px" }}>
            {availableWindows.map((win) => {
              const active = metricWindow === win;
              return (
                <button
                  key={win}
                  onClick={() => setMetricWindow(win)}
                  style={{
                    padding: "3px 8px",
                    fontSize: "11px",
                    borderRadius: "3px",
                    border: "none",
                    background: active ? "var(--border-muted)" : "transparent",
                    color: active ? "var(--accent-cyan)" : "var(--text-secondary)",
                    fontWeight: active ? 600 : 400,
                    cursor: "pointer",
                    transition: "all var(--transition-fast)"
                  }}
                >
                  {getMetricWindowLabel(win)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Controls: Cloud Push & Refresh */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {/* Explicit Cloud Sync Push Button */}
        {activeTab === "local-config" && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={triggerCloudPush}
            disabled={cloudPushStatus === "pushing"}
            title="Push local display configuration to Hub"
          >
            {cloudPushStatus === "pushing" ? "☁️ Pushing..." : "☁️ Push to Hub"}
          </button>
        )}

        {/* Refresh Snapshot Button */}
        <button
          className="btn btn-secondary btn-sm"
          onClick={refreshSnapshot}
          disabled={refreshing}
          title="Refresh telemetry snapshot (F5 / Ctrl+R)"
        >
          <span className={refreshing ? "animate-spin" : ""} style={{ display: "inline-block" }}>
            🔄
          </span>
          <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
        </button>

        {/* Last generated timestamp */}
        <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {formatTimeOnly(snapshot?.generatedAt)}
        </span>
      </div>
    </header>
  );
};
