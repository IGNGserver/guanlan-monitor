import React, { useRef, useEffect } from "react";
import type { CarbonSeries } from "./CarbonCharts";

interface ChartTouchGestureOverlayProps {
  series?: CarbonSeries[];
  valueFormatter?: (value: number) => string;
  onHoverPoint?: (info: { timeText: string; valueText: string } | null) => void;
  children: React.ReactNode;
}

/**
 * ChartTouchGestureOverlay provides gesture handling and top header info sync.
 * When dragging on the chart, it calculates the closest time point directly from series data,
 * and calls onHoverPoint so the parent ChartTile header displays the exact time and value!
 */
export function ChartTouchGestureOverlay({
  series,
  valueFormatter,
  onHoverPoint,
  children
}: ChartTouchGestureOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let gestureDirection: "undecided" | "horizontal" | "vertical" = "undecided";

    const updatePointFromX = (clientX: number) => {
      if (!series || !series.length || !onHoverPoint) return;
      const rect = el.getBoundingClientRect();
      const plotLeft = rect.left + 42;
      const plotRight = rect.right - 16;
      const plotWidth = Math.max(1, plotRight - plotLeft);
      const ratio = Math.max(0, Math.min(1, (clientX - plotLeft) / plotWidth));

      const allPointsWithTime: Array<{ time: number; val: number; dateStr: string }> = [];
      for (const s of series) {
        for (const p of s.points) {
          const t = Date.parse(p.timestamp);
          if (Number.isFinite(t) && Number.isFinite(p.value)) {
            allPointsWithTime.push({ time: t, val: p.value, dateStr: p.timestamp });
          }
        }
      }
      if (!allPointsWithTime.length) return;

      const minTime = Math.min(...allPointsWithTime.map((p) => p.time));
      const maxTime = Math.max(...allPointsWithTime.map((p) => p.time));
      if (maxTime <= minTime) {
        const p = allPointsWithTime[0];
        const valText = valueFormatter ? valueFormatter(p.val) : String(p.val);
        onHoverPoint({ timeText: formatTime(p.dateStr), valueText: valText });
        return;
      }

      const targetTime = minTime + ratio * (maxTime - minTime);
      let closest = allPointsWithTime[0];
      let minDiff = Math.abs(closest.time - targetTime);
      for (let i = 1; i < allPointsWithTime.length; i++) {
        const diff = Math.abs(allPointsWithTime[i].time - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = allPointsWithTime[i];
        }
      }

      const valText = valueFormatter ? valueFormatter(closest.val) : String(closest.val);
      onHoverPoint({ timeText: formatTime(closest.dateStr), valueText: valText });
    };

    const formatTime = (isoString: string) => {
      const d = new Date(isoString);
      if (!Number.isFinite(d.getTime())) return "";
      const h = String(d.getHours()).padStart(2, "0");
      const m = String(d.getMinutes()).padStart(2, "0");
      const s = String(d.getSeconds()).padStart(2, "0");
      return `${h}:${m}:${s}`;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        gestureDirection = "undecided";
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const diffX = Math.abs(touch.clientX - startX);
      const diffY = Math.abs(touch.clientY - startY);

      if (gestureDirection === "undecided") {
        if (diffX > 6 || diffY > 6) {
          gestureDirection = diffX > diffY ? "horizontal" : "vertical";
        }
      }

      if (gestureDirection === "horizontal") {
        if (e.cancelable) {
          e.preventDefault();
        }
        updatePointFromX(touch.clientX);
      }
    };

    const handleTouchEnd = () => {
      gestureDirection = "undecided";
    };

    const handleMouseMove = (e: MouseEvent) => {
      updatePointFromX(e.clientX);
    };

    const handleMouseLeave = () => {
      onHoverPoint?.(null);
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    el.addEventListener("mousemove", handleMouseMove, { passive: true });
    el.addEventListener("mouseleave", handleMouseLeave, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
      el.removeEventListener("mousemove", handleMouseMove);
      el.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [series, valueFormatter, onHoverPoint]);

  return (
    <div
      ref={containerRef}
      className="chart-touch-gesture-overlay"
      style={{ touchAction: "pan-y", width: "100%", height: "100%" }}
    >
      {children}
    </div>
  );
}
