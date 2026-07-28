"use client";

import React, { useState } from "react";
import type { DeviceSummary, MetricWindow } from "@dsc/shared";
import { DeviceSidebar } from "./device-sidebar";
import styles from "./monitor.module.css";

interface SaasShellProps {
  devices: DeviceSummary[];
  selectedDeviceId: string | null;
  selectedWindow?: MetricWindow;
  onSelectDevice: (deviceId: string | null) => void;
  onSelectWindow?: (window: MetricWindow) => void;
  onOpenMetricConfig?: (deviceId: string) => void;
  onLogout?: () => void;
  socketConnected?: boolean;
  children: React.ReactNode;
}

export function SaasShell({
  devices,
  selectedDeviceId,
  selectedWindow = "1m",
  onSelectDevice,
  onSelectWindow,
  onOpenMetricConfig,
  onLogout,
  socketConnected = true,
  children
}: SaasShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId);

  return (
    <div className={styles.shellContainer}>
      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div
          className={styles.sidebarOverlay}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Persistent Left Sidebar */}
      <DeviceSidebar
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={(id) => {
          onSelectDevice(id);
          setMobileOpen(false);
        }}
        onOpenConfig={onOpenMetricConfig}
        onLogout={onLogout}
        className={mobileOpen ? styles.sidebarOpen : ""}
      />

      {/* Main Content Area */}
      <div className={styles.mainWrapper}>
        {/* Top Navigation Header */}
        <header className={styles.topHeader}>
          <div className={styles.topHeaderLeft}>
            <button
              type="button"
              className={styles.mobileMenuToggle}
              onClick={() => setMobileOpen(!mobileOpen)}
              title="切换侧边栏"
            >
              ☰
            </button>

            {/* Breadcrumb Path */}
            <div className={styles.breadcrumb}>
              <button
                type="button"
                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0 }}
                onClick={() => onSelectDevice(null)}
              >
                控制中心
              </button>
              <span>/</span>
              <span className={styles.breadcrumbItemActive}>
                {selectedDevice ? selectedDevice.hostname : "概览与全域大盘"}
              </span>
            </div>
          </div>

          <div className={styles.topHeaderRight}>
            {/* Live Socket Status */}
            <div className={styles.liveStatusPill}>
              <span className={styles.liveDot} style={{ background: socketConnected ? "var(--accent-cyan)" : "var(--accent-rose)", boxShadow: socketConnected ? "0 0 10px var(--accent-cyan)" : "none" }} />
              <span>{socketConnected ? "WebSocket 实时流" : "离线轮询中"}</span>
            </div>

            {/* Time Window Selector (only on device detail view) */}
            {selectedDeviceId && onSelectWindow && (
              <div className={styles.windowBar}>
                {(["1m", "15m", "1d", "1w", "1mo", "1y"] as MetricWindow[]).map((win) => (
                  <button
                    key={win}
                    type="button"
                    className={`${styles.windowBtn} ${selectedWindow === win ? styles.windowBtnActive : ""}`}
                    onClick={() => onSelectWindow(win)}
                  >
                    {win}
                  </button>
                ))}
              </div>
            )}

            {/* Logout CTA */}
            {onLogout && (
              <button
                type="button"
                className={styles.footerActionBtn}
                onClick={onLogout}
                title="退出登录"
              >
                退出
              </button>
            )}
          </div>
        </header>

        {/* Dynamic Page View */}
        <main className={styles.contentArea}>{children}</main>
      </div>
    </div>
  );
}
