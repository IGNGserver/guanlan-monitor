/**
 * Guanlan Spectrum Adaptive Layout Breakpoint Helper
 * Classifies window width into explicit layout classes according to Material 3 Adaptive layout guidelines:
 * - compact: < 600px
 * - medium: 600px - 839px
 * - expanded: 840px - 1199px
 * - large: >= 1200px
 */

export type LayoutClass = "compact" | "medium" | "expanded" | "large";
export type ScreenOrientation = "portrait" | "landscape";
export type ResponsiveTier = "xs" | "sm" | "md" | "lg" | "xl";

/**
 * Above this width the sidebar is a column of the page grid; at or below it the
 * sidebar becomes an off-canvas drawer and the bottom navigation takes over.
 * Keep the matching CSS breakpoints pinned to this same number.
 */
export const SIDEBAR_DRAWER_MAX_WIDTH = 839;

export function getLayoutClass(width: number): LayoutClass {
  if (width < 600) return "compact";
  if (width < 840) return "medium";
  if (width < 1200) return "expanded";
  return "large";
}

export function usesSidebarDrawer(width: number): boolean {
  return width <= SIDEBAR_DRAWER_MAX_WIDTH;
}

export function getScreenOrientation(width: number, height: number): ScreenOrientation {
  return height > width ? "portrait" : "landscape";
}

export function getResponsiveTier(width: number): ResponsiveTier {
  if (width < 480) return "xs";
  if (width < 768) return "sm";
  if (width < 1024) return "md";
  if (width < 1440) return "lg";
  return "xl";
}

export type DeviceFormFactor = "phone" | "tablet" | "desktop";

/**
 * Detect device form factor combining User Agent heuristics, screen width,
 * orientation and touch capabilities.
 *
 * Not consumed by any render path today. It was added for a tablet split view
 * that is not mounted, and `data-dsc-form-factor` is written but read by no
 * stylesheet, so the layout has a single source of truth in `getResponsiveTier`
 * and the drawer breakpoint. Retained because the phone/tablet/desktop split is
 * a real product distinction still being decided; it should be deleted rather
 * than wired up speculatively if that decision lands the other way.
 */
export function detectDeviceFormFactor(width?: number, hasTouch?: boolean): DeviceFormFactor {
  if (typeof window === "undefined" && width === undefined) return "desktop";
  const effectiveWidth = width ?? (typeof window !== "undefined" ? window.innerWidth : 1200);
  const touch = hasTouch ?? (typeof window !== "undefined" ? (("ontouchstart" in window) || (navigator.maxTouchPoints > 0)) : false);

  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    const isMobileUa = /mobile|iphone|ipod|android.*mobile|windows phone/i.test(ua);
    const isTabletUa = /ipad|tablet|(android(?!.*mobile))/i.test(ua) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(ua));
    if (isTabletUa) return "tablet";
    if (isMobileUa) return "phone";
  }

  if (touch) {
    if (effectiveWidth < 600) return "phone";
    if (effectiveWidth <= 1024) return "tablet";
  }

  if (effectiveWidth < 600) return "phone";
  return "desktop";
}
