import React from "react";
import { useConsole } from "../../context/ConsoleContext";
import { Badge } from "../Common/Badge";
import type { ConsoleNavTab } from "../../types";

export const Sidebar: React.FC = () => {
  const {
    snapshot,
    activeTab,
    setActiveTab,
    selectedDeviceId,
    setAccessKeyModalOpen,
    exitApplication
  } = useConsole();

  const isLocalDevice = selectedDeviceId === snapshot?.localBackend?.config.connection.deviceId || selectedDeviceId === "local-win11-host";
  const localBackend = snapshot?.localBackend;
  const session = snapshot?.session;

  const navItems: { id: ConsoleNavTab; label: string; icon: string; badge?: string }[] = [
    { id: "fleet", label: "Fleet Overview", icon: "🌐", badge: snapshot?.devices?.length ? `${snapshot.devices.length}` : undefined },
    { id: "device-detail", label: "Device Telemetry", icon: "📊" },
    { id: "local-config", label: "This Computer", icon: "⚙️", badge: isLocalDevice ? "Local" : undefined },
    { id: "traffic-calendar", label: "Traffic Calendar", icon: "📅" },
    { id: "diagnostics", label: "Diagnostics & Spool", icon: "🛠️", badge: localBackend?.pendingSampleCount ? `${localBackend.pendingSampleCount} queued` : undefined }
  ];

  return (
    <aside
      style={{
        width: "220px",
        height: "100vh",
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        flexShrink: 0
      }}
    >
      {/* Brand Header */}
      <div>
        <div
          style={{
            padding: "16px 14px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: "10px"
          }}
        >
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "6px",
              background: "linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: "14px",
              color: "#06090d"
            }}
          >
            DS
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "12px", color: "var(--text-main)", letterSpacing: "0.02em" }}>
              DEVICE CONSOLE
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              v{snapshot?.update?.currentVersion || "0.2.68"} ({snapshot?.update?.currentChannel || "test"})
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav style={{ padding: "12px 8px", display: "flex", flexDirection: "column", gap: "3px" }}>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: isActive ? "rgba(56, 189, 248, 0.12)" : "transparent",
                  color: isActive ? "var(--accent-cyan)" : "var(--text-secondary)",
                  border: isActive ? "1px solid rgba(56, 189, 248, 0.25)" : "1px solid transparent",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: isActive ? 600 : 500,
                  transition: "all var(--transition-fast)",
                  textAlign: "left"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "14px" }}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "1px 5px",
                      borderRadius: "4px",
                      background: isActive ? "rgba(56, 189, 248, 0.2)" : "rgba(255, 255, 255, 0.06)",
                      color: isActive ? "var(--accent-cyan)" : "var(--text-muted)",
                      fontFamily: "var(--font-mono)"
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info & Session Controls */}
      <div
        style={{
          padding: "12px",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          background: "rgba(0, 0, 0, 0.2)"
        }}
      >
        {/* Collector Quick Status */}
        <div style={{ fontSize: "11px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)" }}>Local Collector:</span>
            {localBackend?.running ? (
              <Badge variant="online">Running</Badge>
            ) : (
              <Badge variant="offline">Stopped</Badge>
            )}
          </div>
          {localBackend?.pendingSampleCount ? (
            <div style={{ fontSize: "10px", color: "var(--accent-amber)" }}>
              ⚠️ {localBackend.pendingSampleCount} samples in upload spool
            </div>
          ) : null}
        </div>

        {/* Global Access Key Session Trigger */}
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setAccessKeyModalOpen(true)}
          style={{ width: "100%", justifyContent: "space-between" }}
        >
          <span>🔑 Hub Key</span>
          {session?.accessKeyConfigured ? (
            <span style={{ color: "var(--status-online)", fontSize: "10px" }}>Active</span>
          ) : (
            <span style={{ color: "var(--status-warning)", fontSize: "10px" }}>Set Key</span>
          )}
        </button>

        {/* Window Exit Button */}
        <button
          className="btn btn-danger btn-sm"
          onClick={exitApplication}
          style={{ width: "100%", opacity: 0.8 }}
        >
          🚪 Exit Console
        </button>
      </div>
    </aside>
  );
};
