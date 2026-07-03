"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SamplePoint } from "@dsc/shared";
import styles from "./monitor.module.css";

export function ChartCard({
  title,
  chartId,
  value,
  unit,
  color,
  points,
  detail
}: {
  title: string;
  chartId?: string;
  value: string;
  unit?: string;
  color: string;
  points: SamplePoint[];
  detail?: string;
}) {
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
    <section className={styles.chartCard}>
      <header className={styles.chartHeader}>
        <div className={styles.chartTitleGroup}>
          <span>{title}</span>
          {detail ? <small className={styles.chartDetail}>{detail}</small> : null}
        </div>
        <strong>
          {value}
          {unit ? <small>{unit}</small> : null}
        </strong>
      </header>
      <div className={styles.chartWrap}>
        {hasChartData ? (
          <ResponsiveContainer width="99%" height={180}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.42} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.08} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
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
                cursor={{ stroke: "rgba(255,255,255,0.14)", strokeWidth: 1 }}
                labelFormatter={(_, payload) =>
                  new Date(Number(payload?.[0]?.payload?.x ?? 0)).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                  })
                }
              />
              <Area type="monotone" dataKey="value" stroke={color} fill={`url(#${gradientId})`} strokeWidth={2.2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : null}
      </div>
      <div className={styles.chartAxisRange}>
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </section>
  );
}
