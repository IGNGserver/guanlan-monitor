"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import { getTrafficCalendar } from "../lib/api";
import styles from "./monitor.module.css";

const MODES: { key: TrafficCalendarMode; label: string }[] = [
  { key: "day", label: "日" },
  { key: "week", label: "周" },
  { key: "month", label: "月" }
];
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function TrafficCalendar({ deviceId }: { deviceId: string }) {
  const [mode, setMode] = useState<TrafficCalendarMode>("day");
  const [anchor, setAnchor] = useState(() => toLocalAnchor(new Date()));
  const [selectedStart, setSelectedStart] = useState<string | undefined>(undefined);
  const [data, setData] = useState<TrafficCalendarResponse | null>(null);

  useEffect(() => {
    let active = true;
    void getTrafficCalendar(deviceId, mode, anchor, selectedStart)
      .then((response) => {
        if (!active) return;
        setData(response);
        const selected = response.cells.find((cell) => cell.isSelected);
        setSelectedStart(selected?.rangeStart);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [deviceId, mode, anchor, selectedStart]);

  const maxCellValue = useMemo(() => {
    if (!data?.cells.length) return 1;
    return Math.max(...data.cells.map((cell) => cell.totalRxBytes + cell.totalTxBytes), 1);
  }, [data]);

  return (
    <section className={styles.trafficPanel}>
      <div className={styles.hero}>
        <div>
          <h1>流量记录</h1>
          <p className={styles.meta}>按日历查看范围流量，点击单元格查看所选范围明细。</p>
        </div>
      </div>

      <div className={styles.toolbarStack}>
        <div className={styles.toolbar} role="tablist" aria-label="流量视图">
          {MODES.map((item) => (
            <button
              key={item.key}
              className={`${styles.tab} ${mode === item.key ? styles.tabActive : ""}`}
              onClick={() => {
                setMode(item.key);
                setSelectedStart(undefined);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className={styles.toolbar}>
          <button className={styles.ghostButton} onClick={() => shiftAnchor(mode, anchor, -1, setAnchor)}>
            上一页
          </button>
          <button className={styles.ghostButton} onClick={() => shiftAnchor(mode, anchor, 1, setAnchor)}>
            下一页
          </button>
        </div>
      </div>

      <div className={styles.trafficCalendarHeader}>
        <strong>{data?.title ?? "--"}</strong>
        <span>
          {data ? `${formatDate(data.rangeStart)} - ${formatDateInclusive(data.rangeEnd)}` : "--"}
        </span>
      </div>

      {mode === "day" ? (
        <div className={styles.trafficWeekdays}>
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      ) : null}

      <div className={clsx(styles.trafficCalendarGrid, mode === "month" && styles.trafficCalendarGridMonth)}>
        {(data?.cells ?? []).map((cell) => {
          const ratio = (cell.totalRxBytes + cell.totalTxBytes) / maxCellValue;
          return (
            <button
              key={cell.key}
              className={clsx(
                styles.trafficCalendarCell,
                cell.isSelected && styles.trafficCalendarCellActive,
                !cell.isInPrimaryScope && styles.trafficCalendarCellMuted
              )}
              onClick={() => setSelectedStart(cell.rangeStart)}
              style={{
                background: `linear-gradient(180deg, rgba(219,91,19,${0.15 + ratio * 0.5}), rgba(40,40,40,0.95))`
              }}
            >
              <span>{cell.label}{cell.isCurrentPeriod ? " · 今" : ""}</span>
              <strong>{formatBytes(cell.totalRxBytes + cell.totalTxBytes)}</strong>
              <small>
                入 {formatBytes(cell.totalRxBytes)} / 出 {formatBytes(cell.totalTxBytes)}
              </small>
            </button>
          );
        })}
      </div>

      <div className={styles.trafficStats}>
        <div>
          <span>范围接收</span>
          <strong>{formatBytes(data?.totalRxBytes ?? 0)}</strong>
        </div>
        <div>
          <span>范围发送</span>
          <strong>{formatBytes(data?.totalTxBytes ?? 0)}</strong>
        </div>
        <div>
          <span>范围总流量</span>
          <strong>{formatBytes((data?.totalRxBytes ?? 0) + (data?.totalTxBytes ?? 0))}</strong>
        </div>
        <div>
          <span>记录条数</span>
          <strong>{data?.records.length ?? 0}</strong>
        </div>
      </div>

      <div className={styles.trafficRecords}>
        {(data?.records ?? []).slice(-36).reverse().map((record, index) => (
          <div key={`${record.timestamp}-${index}`} className={styles.trafficRecord}>
            <span>{new Date(record.timestamp).toLocaleString("zh-CN")}</span>
            <strong>{formatBytes(record.totalBytes)}</strong>
            <small>
              入 {formatBytes(record.rxBytes)} / 出 {formatBytes(record.txBytes)}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}

function shiftAnchor(mode: TrafficCalendarMode, anchor: string, direction: number, setAnchor: (value: string) => void) {
  const date = new Date(anchor);
  if (mode === "month") {
    date.setFullYear(date.getFullYear() + direction);
  } else {
    date.setMonth(date.getMonth() + direction);
  }
  setAnchor(toLocalAnchor(date));
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("zh-CN");
}

function formatDateInclusive(value: string) {
  return new Date(new Date(value).getTime() - 1).toLocaleDateString("zh-CN");
}

function formatBytes(value: number) {
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current.toFixed(current >= 100 ? 0 : 1)} ${units[unit]}`;
}

function toLocalAnchor(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}
