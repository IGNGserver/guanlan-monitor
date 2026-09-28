import React, { useRef, useEffect } from "react";

/**
 * ChartTouchGestureOverlay provides a non-intrusive gesture handler on top of charts
 * so that touch dragging converts into native mousemove/pointermove events
 * recognized by charting libraries (like Carbon Charts tooltip dispatcher),
 * while preventing browser back/forward history navigation swipes.
 */
export function ChartTouchGestureOverlay({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let isTracking = false;

    const dispatchSimulatedPointer = (touch: Touch, eventType: string) => {
      const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!targetElement) return;

      const mouseEvent = new MouseEvent(eventType, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: touch.clientX,
        clientY: touch.clientY,
        screenX: touch.screenX,
        screenY: touch.screenY
      });
      targetElement.dispatchEvent(mouseEvent);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isTracking = true;
        dispatchSimulatedPointer(e.touches[0], "mousemove");
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isTracking || e.touches.length !== 1) return;
      const touch = e.touches[0];
      // Dispatch simulated mousemove to activate Carbon Chart's tooltip at crosshair
      dispatchSimulatedPointer(touch, "mousemove");
      // Prevent browser edge-swipe navigation if swiping horizontally inside the chart
      if (e.cancelable) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = () => {
      isTracking = false;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="chart-touch-gesture-overlay"
      style={{ touchAction: "none" }}
    >
      {children}
    </div>
  );
}
