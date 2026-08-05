/**
 * Guanlan Spectrum Adaptive Layout Breakpoint Helper
 * Classifies window width into explicit layout classes according to Material 3 Adaptive layout guidelines:
 * - compact: < 600px
 * - medium: 600px - 839px
 * - expanded: 840px - 1199px
 * - large: >= 1200px
 */

export type LayoutClass = "compact" | "medium" | "expanded" | "large";

export function getLayoutClass(width: number): LayoutClass {
  if (width < 600) return "compact";
  if (width < 840) return "medium";
  if (width < 1200) return "expanded";
  return "large";
}
