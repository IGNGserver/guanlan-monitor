import React, { useState } from "react";
import type { MetricsResponse } from "@dsc/shared";
import { useTheme } from "../../context/ThemeContext";
import { normalizeMetricsResponse, NormalizedChartPoint } from "../../helpers/metricsNormalizer";

interface GuanlanChartProps {
  metrics?: MetricsResponse | null;
  points?: NormalizedChartPoint[];
  title?: string;
  height?: number;
}

export const GuanlanChart: React.FC<GuanlanChartProps> = ({
  metrics,
  points: rawPoints,
  title = "遥测指标趋势",
  height = 200
}) => {
  const { effectiveTheme } = useTheme();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const points = rawPoints ?? normalizeMetricsResponse(metrics ?? null);

  if (!points || points.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--gl-text-muted)", fontSize: 13 }}>
        无图表遥测数据
      </div>
    );
  }

  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const width = 600; // SVG viewBox width
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = 100;

  const getX = (index: number) => {
    if (points.length <= 1) return padding.left + chartW / 2;
    return padding.left + (index / (points.length - 1)) * chartW;
  };

  const getY = (val: number) => {
    return padding.top + chartH - (val / maxVal) * chartH;
  };

  // Generate SVG path string
  const cpuPointsString = points.map((p, i) => `${getX(i)},${getY(p.cpuUsage)}`).join(" ");
  const memPointsString = points.map((p, i) => `${getX(i)},${getY(p.memoryUsage)}`).join(" ");

  const cpuAreaString = `${getX(0)},${padding.top + chartH} ${cpuPointsString} ${getX(points.length - 1)},${padding.top + chartH}`;

  const strokeCpu = effectiveTheme === "dark" ? "#38bdf8" : "#0284c7";
  const strokeMem = effectiveTheme === "dark" ? "#a78bfa" : "#7c3aed";
  const gridColor = effectiveTheme === "dark" ? "#334155" : "#e2e8f0";
  const textColor = effectiveTheme === "dark" ? "#94a3b8" : "#64748b";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gl-text-primary)" }}>{title}</div>
        <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4, color: strokeCpu }}>
            <span style={{ width: 8, height: 2, backgroundColor: strokeCpu, display: "inline-block" }} /> CPU 使用率
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, color: strokeMem }}>
            <span style={{ width: 8, height: 2, backgroundColor: strokeMem, display: "inline-block" }} /> 内存使用率
          </span>
        </div>
      </div>

      <div style={{ position: "relative", width: "100%" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "auto", overflow: "visible" }}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Horizontal Gridlines */}
          {[0, 25, 50, 75, 100].map((val) => {
            const y = getY(val);
            return (
              <g key={val}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke={gridColor}
                  strokeWidth="1"
                  strokeDasharray={val === 0 ? "none" : "3 3"}
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  fill={textColor}
                  fontSize="10"
                  textAnchor="end"
                >
                  {val}%
                </text>
              </g>
            );
          })}

          {/* Area Fill for CPU */}
          <polygon points={cpuAreaString} fill={strokeCpu} opacity={effectiveTheme === "dark" ? "0.15" : "0.08"} />

          {/* Lines */}
          <polyline fill="none" stroke={strokeMem} strokeWidth="2" points={memPointsString} />
          <polyline fill="none" stroke={strokeCpu} strokeWidth="2" points={cpuPointsString} />

          {/* Hover interactive points */}
          {points.map((p, i) => {
            const x = getX(i);
            const yCpu = getY(p.cpuUsage);
            const isHovered = hoveredIdx === i;

            return (
              <g
                key={i}
                onMouseEnter={() => setHoveredIdx(i)}
                style={{ cursor: "pointer" }}
              >
                {/* Invisible hover capture area */}
                <rect
                  x={x - 15}
                  y={padding.top}
                  width={30}
                  height={chartH}
                  fill="transparent"
                />
                {isHovered && (
                  <>
                    <line
                      x1={x}
                      y1={padding.top}
                      x2={x}
                      y2={padding.top + chartH}
                      stroke={strokeCpu}
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    <circle cx={x} cy={yCpu} r="4" fill={strokeCpu} stroke="#ffffff" strokeWidth="2" />
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {/* Floating Tooltip */}
        {hoveredIdx !== null && points[hoveredIdx] && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: `${(hoveredIdx / (points.length - 1)) * 80 + 10}%`,
              transform: "translateX(-50%)",
              backgroundColor: "var(--gl-surface-layer-1)",
              border: "1px solid var(--gl-border-strong)",
              borderRadius: "var(--gl-radius-xs)",
              padding: "4px 8px",
              boxShadow: "var(--gl-shadow-sm)",
              fontSize: 11,
              pointerEvents: "none",
              zIndex: 10
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--gl-text-primary)" }}>
              {new Date(points[hoveredIdx].timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div style={{ color: strokeCpu }}>CPU: {points[hoveredIdx].cpuUsage}%</div>
            <div style={{ color: strokeMem }}>内存: {points[hoveredIdx].memoryUsage}%</div>
          </div>
        )}
      </div>
    </div>
  );
};
