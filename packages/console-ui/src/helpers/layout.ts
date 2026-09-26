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
