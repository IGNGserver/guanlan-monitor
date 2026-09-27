import React, { useRef, useState, useEffect } from "react";
import { Icon } from "../ui";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  children: React.ReactNode;
}

export function PullToRefresh({ onRefresh, disabled = false, children }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const isAtTopRef = useRef<boolean>(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const threshold = 64;
  const maxPull = 100;

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (disabled || isRefreshing) return;
      const scrollable = containerRef.current?.closest(".workspace-content") || document.documentElement;
      isAtTopRef.current = (scrollable.scrollTop || 0) <= 0;
      if (isAtTopRef.current && e.touches.length === 1) {
        startYRef.current = e.touches[0].clientY;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || disabled || isRefreshing) return;
      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;
      if (diff > 0 && isAtTopRef.current) {
        // Damped pull effect
        const damped = Math.min(diff * 0.45, maxPull);
        setPullDistance(damped);
        if (e.cancelable && damped > 10) {
          e.preventDefault();
        }
      } else {
        setPullDistance(0);
      }
    };

    const handleTouchEnd = async () => {
      if (startYRef.current === null) return;
      startYRef.current = null;
      if (pullDistance >= threshold && !isRefreshing && !disabled) {
        setIsRefreshing(true);
        setPullDistance(threshold * 0.8);
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          try { navigator.vibrate(12); } catch {}
        }
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    el.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [disabled, isRefreshing, onRefresh, pullDistance]);

  const rotation = Math.min((pullDistance / threshold) * 360, 360);
  const opacity = Math.min(pullDistance / (threshold * 0.6), 1);

  return (
    <div ref={containerRef} className="workspace-pull-container">
      {pullDistance > 0 && (
        <div
          className="workspace-pull-indicator"
          style={{
            height: `${pullDistance}px`,
            opacity
          }}
          aria-hidden="true"
        >
          <div
            className={`workspace-pull-icon ${isRefreshing ? "guanlan-spin" : ""}`}
            style={{ transform: !isRefreshing ? `rotate(${rotation}deg)` : undefined }}
          >
            <Icon name="refresh" size={18} />
          </div>
        </div>
      )}
      <div
        className="workspace-pull-content"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: pullDistance === 0 ? "transform 200ms ease" : "none"
        }}
      >
        {children}
      </div>
    </div>
  );
}
