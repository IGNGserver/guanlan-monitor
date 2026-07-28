"use client";

import React, { useEffect, useState } from "react";
import type { DeviceMetricConfigResponse, DeviceMetricKey } from "@dsc/shared";
import { getDeviceMetricConfig, saveDeviceMetricConfig } from "../lib/api";
import styles from "./monitor.module.css";

const ALL_METRIC_KEYS: { key: DeviceMetricKey; label: string; group: string }[] = [
  { key: "cpuUsage", label: "CPU 占用率", group: "CPU" },
  { key: "cpuFrequency", label: "CPU 主频", group: "CPU" },
  { key: "cpuTemperature", label: "CPU 温度", group: "CPU" },
  { key: "gpuUsage", label: "GPU 核心占用", group: "GPU" },
  { key: "gpuEncode", label: "GPU 视频编码", group: "GPU" },
  { key: "gpuDecode", label: "GPU 视频解码", group: "GPU" },
  { key: "gpuFrequency", label: "GPU 核心频率", group: "GPU" },
  { key: "gpuMemory", label: "GPU 显存占用", group: "GPU" },
  { key: "gpuTemperature", label: "GPU 核心温度", group: "GPU" },
  { key: "memoryUsage", label: "系统物理内存", group: "内存" },
  { key: "swapUsage", label: "交换空间/虚拟内存", group: "内存" },
  { key: "diskUsage", label: "磁盘使用容量", group: "磁盘" },
  { key: "diskRead", label: "磁盘读取速率", group: "磁盘" },
  { key: "diskWrite", label: "磁盘写入速率", group: "磁盘" },
  { key: "networkRxRate", label: "网络接收速率", group: "网络" },
  { key: "networkTxRate", label: "网络发送速率", group: "网络" },
  { key: "networkTraffic", label: "网络流量统计", group: "网络" }
];

interface MetricConfigModalProps {
  deviceId: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function MetricConfigModal({ deviceId, onClose, onSaved }: MetricConfigModalProps) {
  const [config, setConfig] = useState<DeviceMetricConfigResponse | null>(null);
  const [enabledKeys, setEnabledKeys] = useState<Set<DeviceMetricKey>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getDeviceMetricConfig(deviceId)
      .then((res) => {
        if (!active) return;
        setConfig(res);
        setEnabledKeys(new Set(res.enabledMetrics));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deviceId]);

  function toggleMetric(key: DeviceMetricKey) {
    const next = new Set(enabledKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setEnabledKeys(next);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveDeviceMetricConfig(deviceId, {
        enabledMetrics: Array.from(enabledKeys)
      });
      onSaved?.();
      onClose();
    } catch {
      alert("保存监控项配置失败");
    } finally {
      setSaving(false);
    }
  }

  const groups = Array.from(new Set(ALL_METRIC_KEYS.map((m) => m.group)));

  return (
    <div className={styles.modalBackdrop} onClick={onClose} aria-hidden="true">
      <div
        className={`${styles.doubleBezelShell} ${styles.modalShell}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`${styles.doubleBezelInner} ${styles.modalInner}`}>
          {/* Header */}
          <div className={styles.modalHeader}>
            <div>
              <h3 className={styles.modalTitle}>配置节点探针与监控项</h3>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 0" }}>
                设备 ID: <code style={{ color: "var(--accent-cyan)" }}>{deviceId}</code>
              </p>
            </div>
            <button type="button" className={styles.closeBtn} onClick={onClose}>
              ✕
            </button>
          </div>

          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              正在读取探针配置...
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {groups.map((group) => {
                const groupItems = ALL_METRIC_KEYS.filter((item) => item.group === group);
                return (
                  <div key={group}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "8px" }}>
                      {group} 指标探针
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" }}>
                      {groupItems.map((item) => {
                        const isChecked = enabledKeys.has(item.key);
                        const isAvailable = config?.availableMetrics.find((m) => m.key === item.key)?.available ?? true;

                        return (
                          <label
                            key={item.key}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              padding: "10px 14px",
                              borderRadius: "10px",
                              background: isChecked ? "rgba(6, 182, 212, 0.1)" : "rgba(255, 255, 255, 0.02)",
                              border: isChecked ? "1px solid rgba(6, 182, 212, 0.3)" : "1px solid var(--border-subtle)",
                              cursor: "pointer",
                              fontSize: "13px",
                              color: isChecked ? "var(--text-primary)" : "var(--text-secondary)",
                              opacity: isAvailable ? 1 : 0.5
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleMetric(item.key)}
                              style={{ accentColor: "var(--accent-cyan)" }}
                            />
                            <span>{item.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "12px", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
                <button type="button" className={styles.footerActionBtn} onClick={onClose}>
                  取消
                </button>
                <button
                  type="button"
                  className={styles.pillButton}
                  onClick={handleSave}
                  disabled={saving}
                >
                  <span>{saving ? "保存中..." : "保存监控配置"}</span>
                  <span className={styles.buttonIconCircle}>✓</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
