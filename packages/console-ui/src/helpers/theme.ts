/**
 * Guanlan Spectrum Adaptive Theme Helper
 * Handles theme resolution (light, dark, system), contrast mode, and motion preference.
 */

export type ThemeMode = "light" | "dark" | "system";
export type ContrastMode = "normal" | "low";
export type MotionMode = "full" | "reduced";

export function resolveEffectiveTheme(
  mode: ThemeMode,
  systemPrefersDark: boolean
): "light" | "dark" {
  if (mode === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return mode;
}
