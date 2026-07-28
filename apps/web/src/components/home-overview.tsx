"use client";

import React, { useEffect, useState } from "react";
import type { DeviceSummary } from "@dsc/shared";
import styles from "./monitor.module.css";

interface HomeOverviewProps {
  devices: DeviceSummary[];
  onOpenDevice: (deviceId: string) => void;
}

export function HomeOverview({ devices, onOpenDevice }: HomeOverviewProps) {
  const [background, setBackground] = useState<string | null>(null);

  useEffect(() => {
    setBackground(window.localStorage.getItem("dsc-background"));
  }, []);

  function handleBackground(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setBackground(result);
      window.localStorage.setItem("dsc-background", result);
    };
    reader.readAsDataURL(file);
  }

  const onlineCount = devices.filter((d) => d.status === "online").length;
  const onlineRate = devices.length ? Math.round((onlineCount / devices.length) * 100) : 0;

  const avgCpu = devices.length
    ? Math.round(devices.reduce((sum, d) => sum + (d.cpuUsagePercent ?? 0), 0) / devices.length)
    : 0;

  const avgMemory = devices.length
    ? Math.round(devices.reduce((sum, d) => sum + (d.memoryUsagePercent ?? 0), 0) / devices.length)
    : 0;

  const avgDisk = devices.length
    ? Math.round(devices.reduce((sum, d) => sum + (d.diskUsagePercent ?? 0), 0) / devices.length)
    : 0;

  return (
    <div
      style={
        background
          ? { backgroundImage: `url(${background})`, backgroundSize: "cover", borderRadius: "24px" }
          : undefined
      }
    >
      {/* Hero Banner Section */}
      <section className={styles.heroBanner}>
        <div className={styles.heroGlow} />
        <div className={styles.eyebrowTag}>
          <span>⚡</span>
          <span>全域中枢大盘</span>
        </div>
        <h1 className={styles.heroTitle}>DSC 节点集中控制台</h1>
        <p className={styles.heroDescription}>
          高精度实时硬件监控平台。掌握所有计算节点的健康生命线、资源趋势分布与实时状态全貌。
        </p>

        {/* Fleet Quick Stats Cards (Double Bezel) */}
        <div className={styles.fleetStatsGrid}>
          {/* Card 1: Total Nodes */}
          <div className={styles.doubleBezelShell}>
            <div className={styles.doubleBezelInner}>
              <div className={styles.statCardInner}>
                <span className={styles.statLabel}>已接入节点</span>
                <span className={styles.statValue}>{devices.length}</span>
                <span className={styles.statSubtext}>受控服务器与计算终端</span>
              </div>
            </div>
          </div>

          {/* Card 2: Online Rate */}
          <div className={styles.doubleBezelShell}>
            <div className={styles.doubleBezelInner}>
              <div className={styles.statCardInner}>
                <span className={styles.statLabel}>在线率</span>
                <span className={styles.statValue} style={{ color: "var(--accent-emerald)" }}>
                  {onlineRate}%
                </span>
                <span className={styles.statSubtext}>{onlineCount} 个节点在线运行</span>
              </div>
            </div>
          </div>

          {/* Card 3: Avg CPU */}
          <div className={styles.doubleBezelShell}>
            <div className={styles.doubleBezelInner}>
              <div className={styles.statCardInner}>
                <span className={styles.statLabel}>全网平均 CPU</span>
                <span className={styles.statValue} style={{ color: "var(--accent-cyan)" }}>
                  {avgCpu}%
                </span>
                <span className={styles.statSubtext}>实时计算资源占用</span>
              </div>
            </div>
          </div>

          {/* Card 4: Avg Memory */}
          <div className={styles.doubleBezelShell}>
            <div className={styles.doubleBezelInner}>
              <div className={styles.statCardInner}>
                <span className={styles.statLabel}>全网平均内存</span>
                <span className={styles.statValue} style={{ color: "var(--accent-violet)" }}>
                  {avgMemory}%
                </span>
                <span className={styles.statSubtext}>磁盘占用均值 {avgDisk}%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Fleet Devices Section */}
      <section>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>受控节点概览</h2>
            <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              实时资源状态摘要与硬件指示
            </span>
          </div>

          <label className={styles.footerActionBtn} style={{ cursor: "pointer" }}>
            🎨 自定义背景
            <input type="file" accept="image/*" onChange={handleBackground} style={{ display: "none" }} />
          </label>
        </div>

        {/* Device Cards Grid */}
        <div className={styles.deviceGrid}>
          {devices.map((device) => {
            const isOnline = device.status === "online";
            const cpuVal = device.cpuUsagePercent ?? 0;
            const gpuVal = device.gpuUsagePercent ?? 0;
            const memVal = device.memoryUsagePercent ?? 0;
            const diskVal = device.diskUsagePercent ?? 0;

            return (
              <div
                key={device.deviceId}
                className={`${styles.doubleBezelShell} ${styles.deviceCardShell}`}
                onClick={() => onOpenDevice(device.deviceId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    onOpenDevice(device.deviceId);
                  }
                }}
              >
                <div className={`${styles.doubleBezelInner} ${styles.deviceCardInner}`}>
                  {/* Header */}
                  <div className={styles.deviceCardHeader}>
                    <div className={styles.deviceTitleGroup}>
                      <h3 className={styles.deviceHostname}>{device.hostname}</h3>
                      <span className={styles.deviceIdTag}>{device.deviceId}</span>
                    </div>

                    <span
                      className={`${styles.statusPill} ${
                        isOnline ? styles.statusOnlinePill : styles.statusOfflinePill
                      }`}
                    >
                      <span
                        className={`${styles.statusIndicatorDot} ${
                          isOnline ? styles.statusDotOnline : styles.statusDotOffline
                        }`}
                      />
                      {isOnline ? "在线" : "离线"}
                    </span>
                  </div>

                  {/* Resource Progress Bars (Android-like Summary) */}
                  <div className={styles.cardMetricsList}>
                    {/* CPU Bar */}
                    <div className={styles.metricBarRow}>
                      <div className={styles.metricBarMeta}>
                        <span>CPU 占用</span>
                        <b>{formatPercent(device.cpuUsagePercent)}</b>
                      </div>
                      <div className={styles.progressBarBg}>
                        <div
                          className={`${styles.progressBarFill} ${styles.fillCyan}`}
                          style={{ width: `${Math.min(100, Math.max(0, cpuVal))}%` }}
                        />
                      </div>
                    </div>

                    {/* GPU Bar (if GPU present) */}
                    {device.gpuUsagePercent != null && (
                      <div className={styles.metricBarRow}>
                        <div className={styles.metricBarMeta}>
                          <span>GPU 核心</span>
                          <b>{formatPercent(device.gpuUsagePercent)}</b>
                        </div>
                        <div className={styles.progressBarBg}>
                          <div
                            className={`${styles.progressBarFill} ${styles.fillViolet}`}
                            style={{ width: `${Math.min(100, Math.max(0, gpuVal))}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Memory Bar */}
                    <div className={styles.metricBarRow}>
                      <div className={styles.metricBarMeta}>
                        <span>系统内存</span>
                        <b>{formatPercent(device.memoryUsagePercent)}</b>
                      </div>
                      <div className={styles.progressBarBg}>
                        <div
                          className={`${styles.progressBarFill} ${styles.fillEmerald}`}
                          style={{ width: `${Math.min(100, Math.max(0, memVal))}%` }}
                        />
                      </div>
                    </div>

                    {/* Disk Bar */}
                    <div className={styles.metricBarRow}>
                      <div className={styles.metricBarMeta}>
                        <span>磁盘容量</span>
                        <b>{formatPercent(device.diskUsagePercent)}</b>
                      </div>
                      <div className={styles.progressBarBg}>
                        <div
                          className={`${styles.progressBarFill} ${styles.fillAmber}`}
                          style={{ width: `${Math.min(100, Math.max(0, diskVal))}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card Action Footer with Button-in-Button Arrow */}
                  <div className={styles.cardActionFooter}>
                    <span className={styles.osBadge}>
                      {device.os === "windows" ? "Windows" : "Linux"}
                    </span>
                    <span className={styles.viewDetailsText}>
                      进入详细图表
                      <span className={styles.buttonIconCircle}>↗</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {devices.length === 0 && (
            <div style={{ gridColumn: "1 / -1", padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              暂无已连接节点。请在客户端启动 node agent 发送心跳。
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function formatPercent(value: number | null) {
  return value == null ? "--" : `${Math.round(value)}%`;
}
