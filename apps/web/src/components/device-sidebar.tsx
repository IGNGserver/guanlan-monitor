"use client";

import clsx from "clsx";
import type { DeviceBlockKey, DeviceSummary } from "@dsc/shared";
import styles from "./monitor.module.css";

export function DeviceSidebar({
  devices,
  selectedDeviceId,
  onSelect,
  onSelectBlock,
  onEdit
}: {
  devices: DeviceSummary[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string) => void;
  onSelectBlock: (deviceId: string, blockKey: DeviceBlockKey) => void;
  onEdit: (deviceId: string) => void;
}) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarTitle}>资源</div>
      <div className={styles.deviceList}>
        {devices.map((device) => {
          const active = device.deviceId === selectedDeviceId;
          return (
            <div
              key={device.deviceId}
              className={clsx(styles.deviceItem, active && styles.deviceItemActive)}
            >
              <button className={styles.deviceSelect} onClick={() => onSelect(device.deviceId)} type="button">
                <div className={styles.deviceItemRow}>
                  <span>{device.hostname}</span>
                  <span
                    className={clsx(styles.statusDot, device.status === "online" ? styles.statusOnline : styles.statusOffline)}
                  />
                </div>
                <div className={styles.deviceItemMeta}>
                  <small>{device.deviceId}</small>
                  <span>{device.os}</span>
                </div>
              </button>
              <div className={styles.deviceMetricStrip}>
                <MetricPill label="CPU" value={formatPercent(device.cpuUsagePercent)} onClick={() => onSelectBlock(device.deviceId, "cpu")} />
                <MetricPill label="GPU" value={formatPercent(device.gpuUsagePercent)} onClick={() => onSelectBlock(device.deviceId, "gpu")} />
                <MetricPill label="显存" value={formatPercent(device.gpuMemoryUsagePercent)} onClick={() => onSelectBlock(device.deviceId, "gpu")} />
                <MetricPill label="内存" value={formatPercent(device.memoryUsagePercent)} onClick={() => onSelectBlock(device.deviceId, "memory")} />
                <MetricPill label="磁盘" value={formatPercent(device.diskUsagePercent)} onClick={() => onSelectBlock(device.deviceId, "disk")} />
              </div>
              <div className={styles.deviceItemActions}>
                <span className={styles.deviceItemHint}>监控项</span>
                <button
                  className={styles.inlineAction}
                  onClick={() => onEdit(device.deviceId)}
                  type="button"
                >
                  编辑
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function formatPercent(value: number | null) {
  return value == null ? "--" : `${value.toFixed(0)}%`;
}

function MetricPill({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button className={styles.deviceMetricPillButton} onClick={onClick} type="button">
      <div className={styles.deviceMetricPill}>
      <span>{label}</span>
      <strong>{value}</strong>
      </div>
    </button>
  );
}
