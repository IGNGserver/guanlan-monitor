"use client";

import React, { useEffect, useState } from "react";
import type {
  DeviceBlockKey,
  DeviceMetricKey,
  DeviceSummary,
  MetricSeries,
  MetricWindow
} from "@dsc/shared";
import { getMetrics, saveFanNote } from "../lib/api";
import { ChartCard } from "./chart-card";
import { MetricConfigModal } from "./metric-config-modal";
import { TrafficCalendar } from "./traffic-calendar";
import styles from "./monitor.module.css";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "all", label: "全部指标" },
  { key: "cpu", label: "CPU" },
  { key: "gpu", label: "GPU 显卡" },
  { key: "memory", label: "系统内存" },
  { key: "disk", label: "磁盘存储" },
  { key: "network", label: "网络吞吐" },
  { key: "fan", label: "风扇散热" },
  { key: "calendar", label: "流量日历" }
];

interface DashboardProps {
  deviceId: string;
  devices: DeviceSummary[];
  selectedWindow: MetricWindow;
  onSelectWindow: (window: MetricWindow) => void;
  onSelectDevice: (deviceId: string | null) => void;
}

export function Dashboard({
  deviceId,
  devices,
  selectedWindow,
  onSelectWindow,
  onSelectDevice
}: DashboardProps) {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [editingConfigDeviceId, setEditingConfigDeviceId] = useState<string | null>(null);
  const [editingFan, setEditingFan] = useState<{ id: string; label: string; note: string } | null>(null);

  const [metrics, setMetrics] = useState<{
    status: DeviceSummary["status"];
    lastSeenAt: string | null;
    series: MetricSeries;
    enabledMetrics: DeviceMetricKey[];
    device: {
      hostname: string;
      os: string;
      platform: string;
      arch?: string;
      cpuModel?: string;
    };
    latest: {
      cpuFrequencyMHz: number | null;
      cpuTemperatureC: number | null;
      cpuPackages: {
        id: string;
        name: string;
        model?: string;
        coreCount?: number;
        logicalCount?: number;
        frequencyMHz?: number | null;
        usagePercent?: number | null;
        temperatureC?: number | null;
      }[];
      memoryUsedBytes: number;
      memoryTotalBytes: number;
      swapUsedBytes: number;
      swapTotalBytes: number;
      diskUsedBytes: number;
      diskTotalBytes: number;
      disks: {
        id: string;
        name: string;
        mountPoint: string;
        filesystem?: string;
        model?: string;
        vendor?: string;
        sourceKey?: string;
        temperatureC?: number | null;
        totalBytes: number;
        usedBytes: number;
      }[];
      networkInterfaces: {
        id: string;
        name: string;
        macAddress?: string;
        ipv4?: string[];
        ipv6?: string[];
        rxBytesPerSec?: number;
        txBytesPerSec?: number;
        totalRxBytes?: number;
        totalTxBytes?: number;
      }[];
      gpus: {
        id: string;
        name: string;
        utilizationPercent: number;
        encodeUtilizationPercent?: number | null;
        decodeUtilizationPercent?: number | null;
        frequencyMHz?: number | null;
        memoryUsedBytes: number;
        memoryTotalBytes: number;
        temperatureC?: number | null;
      }[];
      sensorBackends: {
        id: string;
        label: string;
        ok: boolean;
        detail?: string;
      }[];
      fans: {
        id: string;
        label: string;
        interface: string;
        rpm: number;
        note?: string;
      }[];
    };
  } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getMetrics(deviceId, selectedWindow)
      .then((res) => {
        if (!active) return;
        setMetrics(res);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [deviceId, selectedWindow]);

  const currentDevice = devices.find((d) => d.deviceId === deviceId);
  const isOnline = metrics?.status === "online" || currentDevice?.status === "online";

  async function handleSaveFanNote() {
    if (!editingFan) return;
    try {
      await saveFanNote(deviceId, editingFan.id, { note: editingFan.note });
      setEditingFan(null);
      // refresh metrics
      const res = await getMetrics(deviceId, selectedWindow);
      setMetrics(res);
    } catch {
      alert("保存风扇备注失败");
    }
  }

  const series = metrics?.series;

  return (
    <div>
      {/* Device Hero Banner Bar */}
      <div className={styles.deviceDetailHeader}>
        <div>
          <div className={styles.deviceDetailTitle}>
            <button
              type="button"
              className={styles.footerActionBtn}
              onClick={() => onSelectDevice(null)}
              style={{ fontSize: "12px", padding: "4px 10px" }}
            >
              ← 返回全域概览
            </button>
            <span>{metrics?.device.hostname ?? currentDevice?.hostname ?? deviceId}</span>
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
              {isOnline ? "在线运行" : "离线"}
            </span>
          </div>

          <div className={styles.deviceDetailMeta} style={{ marginTop: "8px" }}>
            <span className={styles.metaBadge}>ID: {deviceId}</span>
            <span className={styles.metaBadge}>
              OS: {metrics?.device.os ?? currentDevice?.os ?? "unknown"}
            </span>
            {metrics?.device.cpuModel && (
              <span className={styles.metaBadge}>CPU: {metrics.device.cpuModel}</span>
            )}
          </div>
        </div>

        <button
          type="button"
          className={styles.pillButton}
          onClick={() => setEditingConfigDeviceId(deviceId)}
        >
          <span>配置监控探针</span>
          <span className={styles.buttonIconCircle}>⚙</span>
        </button>
      </div>

      {/* Category Filter Bar */}
      <div className={styles.filterChipBar}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            className={`${styles.chipBtn} ${activeCategory === cat.key ? styles.chipBtnActive : ""}`}
            onClick={() => setActiveCategory(cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading && !metrics ? (
        <div style={{ padding: "60px", textAlign: "center", color: "var(--text-muted)" }}>
          正在加载设备采样数据与历史图表...
        </div>
      ) : (
        <div className={styles.chartGrid}>
          {/* CPU Metric Charts */}
          {(activeCategory === "all" || activeCategory === "cpu") && series && (
            <>
              <ChartCard
                title="CPU 总体占用率"
                value={`${(series.cpuUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                color="var(--accent-cyan)"
                points={series.cpuUsagePercent}
                detail="核心综合算力使用"
              />
              <ChartCard
                title="CPU 实时主频"
                value={`${((series.cpuFrequencyMHz.at(-1)?.value ?? 0) / 1000).toFixed(2)}`}
                unit="GHz"
                color="var(--accent-blue)"
                points={series.cpuFrequencyMHz}
                detail="硬件时钟频率"
              />
              {series.cpuTemperatureC.length > 0 && (
                <ChartCard
                  title="CPU 封装温度"
                  value={`${(series.cpuTemperatureC.at(-1)?.value ?? 0).toFixed(0)}°C`}
                  color="var(--accent-rose)"
                  points={series.cpuTemperatureC}
                  detail="核心热耗指标"
                />
              )}
            </>
          )}

          {/* GPU Metric Charts */}
          {(activeCategory === "all" || activeCategory === "gpu") && series && series.gpuUsagePercent.length > 0 && (
            <>
              <ChartCard
                title="GPU 核心占用"
                value={`${(series.gpuUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                color="var(--accent-violet)"
                points={series.gpuUsagePercent}
                detail="图形加速核心"
              />
              <ChartCard
                title="GPU 显存占用率"
                value={`${(series.gpuMemoryUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                color="var(--accent-cyan)"
                points={series.gpuMemoryUsagePercent}
                detail="VRAM 渲染存取"
              />
              {series.gpuTemperatureC.length > 0 && (
                <ChartCard
                  title="GPU 核心温度"
                  value={`${(series.gpuTemperatureC.at(-1)?.value ?? 0).toFixed(0)}°C`}
                  color="var(--accent-rose)"
                  points={series.gpuTemperatureC}
                />
              )}
            </>
          )}

          {/* Memory Metric Charts */}
          {(activeCategory === "all" || activeCategory === "memory") && series && (
            <>
              <ChartCard
                title="物理内存占用"
                value={`${(series.memoryUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                color="var(--accent-emerald)"
                points={series.memoryUsagePercent}
                detail={`已用 ${formatBytes(metrics?.latest.memoryUsedBytes ?? 0)} / ${formatBytes(
                  metrics?.latest.memoryTotalBytes ?? 0
                )}`}
              />
              {series.swapUsagePercent.length > 0 && (
                <ChartCard
                  title="虚拟内存 (Swap) 占用"
                  value={`${(series.swapUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                  color="var(--accent-amber)"
                  points={series.swapUsagePercent}
                  detail={`已用 ${formatBytes(metrics?.latest.swapUsedBytes ?? 0)} / ${formatBytes(
                    metrics?.latest.swapTotalBytes ?? 0
                  )}`}
                />
              )}
            </>
          )}

          {/* Disk Metric Charts */}
          {(activeCategory === "all" || activeCategory === "disk") && series && (
            <>
              <ChartCard
                title="磁盘整体存储占用"
                value={`${(series.diskUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                color="var(--accent-amber)"
                points={series.diskUsagePercent}
                detail={`已用 ${formatBytes(metrics?.latest.diskUsedBytes ?? 0)} / ${formatBytes(
                  metrics?.latest.diskTotalBytes ?? 0
                )}`}
              />
              <ChartCard
                title="磁盘读取速率"
                value={formatRate(series.diskReadBytesPerSec.at(-1)?.value ?? 0)}
                color="var(--accent-cyan)"
                points={series.diskReadBytesPerSec}
                detail="存储 IO 读取"
              />
              <ChartCard
                title="磁盘写入速率"
                value={formatRate(series.diskWriteBytesPerSec.at(-1)?.value ?? 0)}
                color="var(--accent-violet)"
                points={series.diskWriteBytesPerSec}
                detail="存储 IO 写入"
              />
            </>
          )}

          {/* Network Metric Charts */}
          {(activeCategory === "all" || activeCategory === "network") && series && (
            <>
              <ChartCard
                title="网络接收速率 (Rx)"
                value={formatRate(series.networkRxBytesPerSec.at(-1)?.value ?? 0)}
                color="var(--accent-cyan)"
                points={series.networkRxBytesPerSec}
                detail="下行实时流量"
              />
              <ChartCard
                title="网络发送速率 (Tx)"
                value={formatRate(series.networkTxBytesPerSec.at(-1)?.value ?? 0)}
                color="var(--accent-emerald)"
                points={series.networkTxBytesPerSec}
                detail="上行实时流量"
              />
            </>
          )}

          {/* Fan Speed Cards */}
          {(activeCategory === "all" || activeCategory === "fan") && metrics?.latest.fans && metrics.latest.fans.length > 0 && (
            <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
              <div className={`${styles.doubleBezelInner}`} style={{ padding: "24px" }}>
                <h3 className={styles.chartTitle} style={{ marginBottom: "16px" }}>
                  🌀 散热风扇转速
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
                  {metrics.latest.fans.map((fan) => (
                    <div
                      key={fan.id}
                      style={{
                        padding: "16px",
                        borderRadius: "12px",
                        background: "rgba(255, 255, 255, 0.02)",
                        border: "1px solid var(--border-subtle)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                          {fan.label}
                        </span>
                        <button
                          type="button"
                          style={{ background: "none", border: "none", fontSize: "11px", color: "var(--accent-cyan)", cursor: "pointer" }}
                          onClick={() => setEditingFan({ id: fan.id, label: fan.label, note: fan.note ?? "" })}
                        >
                          编辑备注
                        </button>
                      </div>

                      <div style={{ fontSize: "22px", fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--accent-cyan)" }}>
                        {fan.rpm} <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>RPM</span>
                      </div>

                      {fan.note && (
                        <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                          备注: {fan.note}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Traffic Calendar Component */}
          {(activeCategory === "all" || activeCategory === "calendar") && (
            <TrafficCalendar deviceId={deviceId} />
          )}

          {/* Sensor Backends Health Panel */}
          {metrics?.latest.sensorBackends && metrics.latest.sensorBackends.length > 0 && (
            <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
              <div className={`${styles.doubleBezelInner}`} style={{ padding: "24px" }}>
                <h3 className={styles.chartTitle} style={{ marginBottom: "16px" }}>
                  🛠 传感器后端与驱动健康探针
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
                  {metrics.latest.sensorBackends.map((backend) => (
                    <div
                      key={backend.id}
                      style={{
                        padding: "12px 16px",
                        borderRadius: "10px",
                        background: backend.ok ? "rgba(16, 185, 129, 0.05)" : "rgba(244, 63, 94, 0.05)",
                        border: backend.ok ? "1px solid rgba(16, 185, 129, 0.2)" : "1px solid rgba(244, 63, 94, 0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between"
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                          {backend.label}
                        </div>
                        {backend.detail && (
                          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                            {backend.detail}
                          </div>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: backend.ok ? "var(--accent-emerald)" : "var(--accent-rose)"
                        }}
                      >
                        {backend.ok ? "正常" : "异常/离线"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fan Note Editing Modal */}
      {editingFan && (
        <div className={styles.modalBackdrop} onClick={() => setEditingFan(null)}>
          <div className={`${styles.doubleBezelShell} ${styles.modalShell}`} onClick={(e) => e.stopPropagation()}>
            <div className={`${styles.doubleBezelInner} ${styles.modalInner}`}>
              <h3 className={styles.modalTitle}>修改风扇备注</h3>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
                风扇: {editingFan.label}
              </p>
              <input
                type="text"
                className={styles.loginInput}
                placeholder="例如: 机箱前置进风扇"
                value={editingFan.note}
                onChange={(e) => setEditingFan({ ...editingFan, note: e.target.value })}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" className={styles.footerActionBtn} onClick={() => setEditingFan(null)}>
                  取消
                </button>
                <button type="button" className={styles.pillButton} onClick={handleSaveFanNote}>
                  <span>保存备注</span>
                  <span className={styles.buttonIconCircle}>✓</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metric Config Modal */}
      {editingConfigDeviceId && (
        <MetricConfigModal
          deviceId={editingConfigDeviceId}
          onClose={() => setEditingConfigDeviceId(null)}
        />
      )}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = bytes;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current.toFixed(1)} ${units[unit]}`;
}

function formatRate(bytesPerSec: number) {
  if (bytesPerSec <= 0) return "0 KB/s";
  if (bytesPerSec >= 1024 * 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
  }
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}
