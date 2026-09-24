"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import { getTrafficCalendar } from "../../lib/api";
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getTrafficCalendar(deviceId, mode, anchor, selectedStart)
      .then((response) => {
        if (!active) return;
        setData(response);
        const selected = response.cells.find((cell) => cell.isSelected);
        setSelectedStart(selected?.rangeStart);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deviceId, mode, anchor, selectedStart]);

  const maxCellValue = useMemo(() => {
    if (!data?.cells.length) return 1;
    return Math.max(...data.cells.map((cell) => cell.totalRxBytes + cell.totalTxBytes), 1);
  }, [data]);

  return (
    <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
      <div className={`${styles.doubleBezelInner}`} style={{ padding: "28px" }}>
        {/* Header & Controls */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", marginBottom: "20px" }}>
          <div>
            <h3 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
              🌐 网络流量日历
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "4px 0 0" }}>
              选定时间范围内的全网网络数据交互与流量消耗分析
            </p>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            {/* View Mode Switcher */}
            <div className={styles.windowBar}>
              {MODES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`${styles.windowBtn} ${mode === item.key ? styles.windowBtnActive : ""}`}
                  onClick={() => {
                    setMode(item.key);
                    setSelectedStart(undefined);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Page Shift Buttons */}
            <button
              type="button"
              className={styles.footerActionBtn}
              onClick={() => shiftAnchor(mode, anchor, -1, setAnchor)}
            >
              ← 上一页
            </button>
            <button
              type="button"
              className={styles.footerActionBtn}
              onClick={() => shiftAnchor(mode, anchor, 1, setAnchor)}
            >
              下一页 →
            </button>
          </div>
        </div>

        {/* Selected Range Title Banner */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderRadius: "14px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--border-light)", marginBottom: "20px" }}>
          <div>
            <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>
              {data?.title ?? "加载中..."}
            </span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "12px", fontFamily: "var(--font-mono)" }}>
              {data ? `${formatDate(data.rangeStart)} ~ ${formatDateInclusive(data.rangeEnd)}` : "--"}
            </span>
          </div>

          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>选中范围累计: </span>
            <span style={{ fontSize: "18px", fontWeight: 800, color: "var(--accent-cyan)", fontFamily: "var(--font-mono)", marginLeft: "6px" }}>
              {formatBytes((data?.totalRxBytes ?? 0) + (data?.totalTxBytes ?? 0))}
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "10px" }}>
              (接收 {formatBytes(data?.totalRxBytes ?? 0)} · 发送 {formatBytes(data?.totalTxBytes ?? 0)})
            </span>
          </div>
        </div>

        {/* Calendar Weekday Row */}
        {mode === "day" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px", textAlign: "center", marginBottom: "8px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)" }}>
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        )}

        {/* Calendar Heatmap Grid */}
        <div style={{ display: "grid", gridTemplateColumns: mode === "day" ? "repeat(7, 1fr)" : "repeat(auto-fill, minmax(80px, 1fr))", gap: "8px", marginBottom: "24px" }}>
          {(data?.cells ?? []).map((cell) => {
            const ratio = (cell.totalRxBytes + cell.totalTxBytes) / maxCellValue;
            const isSelected = cell.isSelected;

            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => setSelectedStart(cell.rangeStart)}
                style={{
                  padding: "12px 8px",
                  borderRadius: "10px",
                  border: isSelected ? "1px solid var(--accent-cyan)" : "1px solid var(--border-subtle)",
                  background: isSelected
                    ? "rgba(6, 182, 212, 0.25)"
                    : `rgba(6, 182, 212, ${0.04 + ratio * 0.4})`,
                  color: isSelected ? "#ffffff" : "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: isSelected ? 700 : 500,
                  textAlign: "center",
                  transition: "all 0.2s ease"
                }}
              >
                <div>{formatDay(cell.rangeStart)}{cell.isCurrentPeriod ? " (今)" : ""}</div>
                <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px", fontFamily: "var(--font-mono)" }}>
                  {formatBytes(cell.totalRxBytes + cell.totalTxBytes)}
                </div>
              </button>
            );
          })}
        </div>

        {/* Traffic Stats Bar */}
        <div className={styles.fleetStatsGrid} style={{ marginBottom: "24px" }}>
          <div className={styles.statCardInner} style={{ background: "rgba(0,0,0,0.3)", borderRadius: "12px" }}>
            <span className={styles.statLabel}>总接收流量 (RX)</span>
            <span className={styles.statValue} style={{ color: "var(--accent-cyan)" }}>
              {formatBytes(data?.totalRxBytes ?? 0)}
            </span>
          </div>
          <div className={styles.statCardInner} style={{ background: "rgba(0,0,0,0.3)", borderRadius: "12px" }}>
            <span className={styles.statLabel}>总发送流量 (TX)</span>
            <span className={styles.statValue} style={{ color: "var(--accent-violet)" }}>
              {formatBytes(data?.totalTxBytes ?? 0)}
            </span>
          </div>
          <div className={styles.statCardInner} style={{ background: "rgba(0,0,0,0.3)", borderRadius: "12px" }}>
            <span className={styles.statLabel}>全范围交互总量</span>
            <span className={styles.statValue} style={{ color: "var(--accent-emerald)" }}>
              {formatBytes((data?.totalRxBytes ?? 0) + (data?.totalTxBytes ?? 0))}
            </span>
          </div>
          <div className={styles.statCardInner} style={{ background: "rgba(0,0,0,0.3)", borderRadius: "12px" }}>
            <span className={styles.statLabel}>采样记录数</span>
            <span className={styles.statValue}>{data?.records.length ?? 0}</span>
          </div>
        </div>

        {/* Traffic Records List */}
        <div>
          <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px", color: "var(--text-secondary)" }}>
            近段采样明细
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "280px", overflowY: "auto", paddingRight: "4px" }}>
            {(data?.records ?? []).slice(-36).reverse().map((record, index) => (
              <div
                key={`${record.timestamp}-${index}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "12px"
                }}
              >
                <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {new Date(record.timestamp).toLocaleString("zh-CN")}
                </span>
                <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {formatBytes(record.totalBytes)}
                </span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  入 {formatBytes(record.rxBytes)} / 出 {formatBytes(record.txBytes)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
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

function formatDay(value: string) {
  return new Date(value).toLocaleDateString("zh-CN", { day: "numeric" });
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
