"use client";

import React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SamplePoint } from "@dsc/shared";
import styles from "./monitor.module.css";

interface ChartCardProps {
  title: string;
  chartId?: string;
  value: string;
  unit?: string;
  color: string;
  points: SamplePoint[];
  detail?: string;
}

export function ChartCard({
  title,
  chartId,
  value,
  unit,
  color,
  points,
  detail
}: ChartCardProps) {
  const gradientId = `fill-${(chartId ?? title).replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const chartData = points.map((point, index) => ({
    ...point,
    x: new Date(point.timestamp).getTime(),
    xKey: `${point.timestamp}-${index}`
  }));

  const startLabel = points[0]?.timestamp
    ? new Date(points[0].timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : "--:--";

  const endLabel = points.at(-1)?.timestamp
    ? new Date(points.at(-1)!.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : "--:--";

  const hasChartData = chartData.length > 0;

  return (
    <div className={`${styles.doubleBezelShell} ${styles.chartCardShell}`}>
      <div className={`${styles.doubleBezelInner} ${styles.chartCardInner}`}>
        {/* Header */}
        <div className={styles.chartCardHeader}>
          <div>
            <span className={styles.chartTitle}>{title}</span>
            {detail && (
              <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                {detail}
              </span>
            )}
          </div>

          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "22px", fontWeight: 800, fontFamily: "var(--font-mono)", color: color }}>
              {value}
            </span>
            {unit && (
              <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "4px" }}>
                {unit}
              </span>
            )}
          </div>
        </div>

        {/* Chart View */}
        <div style={{ width: "100%", height: 180, marginTop: "8px" }}>
          {hasChartData ? (
            <ResponsiveContainer width="99%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} strokeDasharray="3 3" />
                <XAxis
                  hide
                  dataKey="x"
                  scale="time"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  allowDuplicatedCategory={false}
                />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip
                  wrapperStyle={{ outline: "none" }}
                  contentStyle={{
                    background: "rgba(10, 14, 23, 0.95)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "12px",
                    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
                    padding: "8px 12px",
                    color: "#ffffff"
                  }}
                  cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "4 4" }}
                  labelFormatter={(_, payload) =>
                    new Date(Number(payload?.[0]?.payload?.x ?? 0)).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit"
                    })
                  }
                  formatter={(val: unknown) => [
                    `${typeof val === "number" ? val.toFixed(1) : String(val ?? "")} ${unit ?? ""}`,
                    title
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  fill={`url(#${gradientId})`}
                  strokeWidth={2.2}
                  activeDot={{ r: 5, fill: color, stroke: "#ffffff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "12px",
                color: "var(--text-muted)"
              }}
            >
              无图表采样数据
            </div>
          )}
        </div>

        {/* Time Domain Axis Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            borderTop: "1px solid var(--border-subtle)",
            paddingTop: "8px",
            marginTop: "4px"
          }}
        >
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      </div>
    </div>
  );
}
