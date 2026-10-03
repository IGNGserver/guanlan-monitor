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
  // Mirror the render state into refs so the gesture effect can keep a stable
  // subscription. Depending on `pullDistance` re-added and removed all four
  // touch listeners on every move event, which is exactly when the browser is
  // busiest; the handlers now read the latest values without re-subscribing.
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  // Resolving the scroll parent calls getComputedStyle along the ancestor chain.
  // It cannot change during a single gesture, so resolve it once per touchstart
  // and reuse it for the moves.
  const scrollParentRef = useRef<HTMLElement | null>(null);

  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => { isRefreshingRef.current = isRefreshing; }, [isRefreshing]);

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
      if (isRefreshingRef.current || e.touches.length !== 1) return;
      const target = e.target instanceof Element ? e.target : null;
      // Let charts, controls, editable fields and nested scrollers own their
      // gestures; screen-edge Back remains the browser's gesture as well.
      if (e.touches[0].clientX < 24 || target?.closest("button, input, select, textarea, [contenteditable], .m3e-chart, [data-touch-scroll]")) return;
      const scrollParent = getScrollParent(el);
      scrollParentRef.current = scrollParent;
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
      if (e.touches.length !== 1) { handleTouchCancel(); return; }
      if (startYRef.current === null || startXRef.current === null || isRefreshingRef.current) return;
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
        const scrollParent = scrollParentRef.current ?? getScrollParent(el);
        if (scrollParent.scrollTop <= 0) {
          isPullingRef.current = true;
          // Apply cubic dampening
          const damped = Math.min(diffY * 0.4, maxPull);
          pullDistanceRef.current = damped;
          setPullDistance(damped);
          if (e.cancelable && damped > 8) {
            e.preventDefault();
          }
        }
      } else {
        isPullingRef.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    const handleTouchEnd = async () => {
      if (startYRef.current === null) return;
      startYRef.current = null;
      startXRef.current = null;
      const pulling = isPullingRef.current;
      isPullingRef.current = false;

      if (pulling && pullDistanceRef.current >= threshold && !isRefreshingRef.current) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        setPullDistance(threshold * 0.8);
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          try { navigator.vibrate(12); } catch {}
        }
        try {
          await onRefreshRef.current();
        } finally {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
          pullDistanceRef.current = 0;
          setPullDistance(0);
        }
      } else {
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    const handleTouchCancel = () => {
      startYRef.current = null;
      startXRef.current = null;
      isPullingRef.current = false;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    el.addEventListener("touchcancel", handleTouchCancel);

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [disabled]);

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
            className={`workspace-pull-icon ${isRefreshing ? "m3e-spin" : ""}`}
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
          transition: pullDistance === 0 ? "transform var(--md-sys-motion-effects-default)" : "none"
        }}
      >
        {children}
      </div>
    </div>
  );
}
