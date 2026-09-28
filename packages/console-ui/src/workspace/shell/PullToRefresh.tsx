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
  const startXRef = useRef<number | null>(null);
  const isPullingRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const threshold = 64;
  const maxPull = 90;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    const getScrollParent = (node: HTMLElement | null): HTMLElement => {
      let curr = node;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        const style = getComputedStyle(curr);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          return curr;
        }
        curr = curr.parentElement;
      }
      return document.documentElement;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshing || e.touches.length !== 1) return;
      const scrollParent = getScrollParent(el);
      const isTop = scrollParent.scrollTop <= 0;
      if (isTop) {
        startYRef.current = e.touches[0].clientY;
        startXRef.current = e.touches[0].clientX;
        isPullingRef.current = false;
      } else {
        startYRef.current = null;
        startXRef.current = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || startXRef.current === null || isRefreshing) return;
      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const diffY = currentY - startYRef.current;
      const diffX = currentX - startXRef.current;

      // If user is swiping horizontally, cancel pull-to-refresh
      if (!isPullingRef.current && Math.abs(diffX) > Math.abs(diffY)) {
        startYRef.current = null;
        startXRef.current = null;
        return;
      }

      if (diffY > 0) {
        const scrollParent = getScrollParent(el);
        if (scrollParent.scrollTop <= 0) {
          isPullingRef.current = true;
          // Apply cubic dampening
          const damped = Math.min(diffY * 0.4, maxPull);
          setPullDistance(damped);
          if (e.cancelable && damped > 8) {
            e.preventDefault();
          }
        }
      } else {
        isPullingRef.current = false;
        setPullDistance(0);
      }
    };

    const handleTouchEnd = async () => {
      if (startYRef.current === null) return;
      startYRef.current = null;
      startXRef.current = null;
      const pulling = isPullingRef.current;
      isPullingRef.current = false;

      if (pulling && pullDistance >= threshold && !isRefreshing) {
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
