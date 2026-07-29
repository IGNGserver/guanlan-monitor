"use client";

import React, { useState } from "react";
import type { DeviceSummary } from "@dsc/shared";
import styles from "./monitor.module.css";

interface DeviceSidebarProps {
  devices: DeviceSummary[];
  selectedDeviceId: string | null;
  onSelectDevice: (deviceId: string | null) => void;
  onLogout?: () => void;
  className?: string;
}

export function DeviceSidebar({
  devices,
  selectedDeviceId,
  onSelectDevice,
  className = ""
}: DeviceSidebarProps) {
  const [filterQuery, setFilterQuery] = useState("");

  const filteredDevices = devices.filter(
    (d) =>
      d.hostname.toLowerCase().includes(filterQuery.toLowerCase()) ||
      d.deviceId.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const onlineCount = devices.filter((d) => d.status === "online").length;

  return (
    <aside className={`${styles.sidebar} ${className}`}>
      {/* Brand & Hub Status Header */}
      <div className={styles.sidebarHeader}>
        <div className={styles.brandLockup}>
          <img src="/logo.png" alt="DSC Logo" className={styles.brandLogoImage} />
          <div className={styles.brandTitle}>
            DSC Hub
            <span className={styles.brandSubtitle}>设备控制中心</span>
          </div>
        </div>
        <div className={styles.sidebarStatus}>
          <span className={styles.statusDotPulse} />
          <span>服务正常 ({onlineCount}/{devices.length} 在线)</span>
        </div>
      </div>

      {/* Navigation Sections */}
      <div className={styles.sidebarBody}>
        {/* Main Nav Group */}
        <div className={styles.navGroup}>
          <div className={styles.navLabel}>主菜单</div>
          <button
            type="button"
            className={`${styles.navItem} ${selectedDeviceId === null ? styles.navItemActive : ""}`}
            onClick={() => onSelectDevice(null)}
          >
            <div className={styles.navItemLeft}>
              <span>📊</span>
              <span>控制中心 (首页)</span>
            </div>
            <span className={styles.navBadge}>{devices.length}</span>
          </button>
        </div>

        {/* Fleet Devices Group */}
        <div className={styles.navGroup}>
          <div className={styles.navLabel}>接入节点 ({devices.length})</div>
          
          {/* Search Device Input */}
          <div className={styles.sidebarSearch}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="搜索主机名或 ID..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </div>

          {/* Device Items */}
          {filteredDevices.map((device) => {
            const isActive = device.deviceId === selectedDeviceId;
            const isOnline = device.status === "online";

            return (
              <div
                key={device.deviceId}
                className={`${styles.sidebarDeviceItem} ${isActive ? styles.sidebarDeviceActive : ""}`}
                onClick={() => onSelectDevice(device.deviceId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    onSelectDevice(device.deviceId);
                  }
                }}
              >
                <div className={styles.deviceItemTop}>
                  <div className={styles.deviceItemHostname}>
                    <span
                      className={`${styles.statusIndicatorDot} ${
                        isOnline ? styles.statusDotOnline : styles.statusDotOffline
                      }`}
                    />
                    <span>{device.hostname}</span>
                  </div>
                  <span className={styles.osBadge}>
                    {device.os === "windows" ? "Win" : "Linux"}
                  </span>
                </div>

                {/* Quick Resource Usage Pills */}
                <div className={styles.devicePillsRow}>
                  <span className={styles.miniMetricPill}>
                    CPU <b>{formatPercent(device.cpuUsagePercent)}</b>
                  </span>
                  {device.gpuUsagePercent != null && (
                    <span className={styles.miniMetricPill}>
                      GPU <b>{formatPercent(device.gpuUsagePercent)}</b>
                    </span>
                  )}
                  <span className={styles.miniMetricPill}>
                    RAM <b>{formatPercent(device.memoryUsagePercent)}</b>
                  </span>
                </div>
              </div>
            );
          })}

          {filteredDevices.length === 0 && (
            <div style={{ padding: "12px", fontSize: "12px", color: "var(--text-muted)", textAlign: "center" }}>
              未匹配到节点
            </div>
          )}
        </div>
      </div>

      {/* Sidebar Footer */}
      <div className={styles.sidebarFooter}>
        <span className={styles.versionTag}>v0.2.4</span>
        <button
          type="button"
          className={styles.footerActionBtn}
          onClick={() => onSelectDevice(null)}
        >
          刷新概览
        </button>
      </div>
    </aside>
  );
}

function formatPercent(value: number | null) {
  return value == null ? "--" : `${Math.round(value)}%`;
}
