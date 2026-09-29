import React, { useRef, useEffect } from "react";

/**
 * ChartTouchGestureOverlay provides an intelligent gesture handler on top of charts.
 * 1. If user swipes vertically (deltaY > deltaX), allow natural page scrolling!
 * 2. If user drags horizontally (deltaX >= deltaY), lock horizontal swipe to inspect
 *    time series points while preventing browser back/forward edge gestures.
 */
export function ChartTouchGestureOverlay({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let gestureDirection: "undecided" | "horizontal" | "vertical" = "undecided";

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

      // If horizontal gesture, lock browser navigation and dispatch tooltip crosshair
      if (gestureDirection === "horizontal") {
        if (e.cancelable) {
          e.preventDefault();
        }
        dispatchSimulatedPointer(touch, "mousemove");
      }
      // If vertical, do nothing! Let the event bubble naturally so the user can scroll vertically on top of charts!
    };

    const handleTouchEnd = () => {
      gestureDirection = "undecided";
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
      style={{ touchAction: "pan-y" }}
    >
      {children}
    </div>
  );
}
