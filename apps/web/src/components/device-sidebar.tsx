"use client";

import clsx from "clsx";
import type { DeviceSummary } from "@dsc/shared";
import styles from "./monitor.module.css";

export function DeviceSidebar({
  devices,
  selectedDeviceId,
  onSelect,
  onEdit
}: {
  devices: DeviceSummary[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string) => void;
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
                  <span>{device.os}</span>
                  <span>{device.cpuUsagePercent?.toFixed(0) ?? "--"}%</span>
                </div>
              </button>
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
