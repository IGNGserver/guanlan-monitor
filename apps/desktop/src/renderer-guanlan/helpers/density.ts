/**
 * Guanlan Spectrum Adaptive Interaction Scale (Density) Helper
 * Manages interaction density scale:
 * - compact: High information density, tight padding, 28px touch targets
 * - comfortable: Standard desktop tool density, 36px targets
 * - touch: Touch-friendly targets, 44px targets
 *
 * Density and layout breakpoints remain strictly independent.
 */

export type InteractionScale = "compact" | "comfortable" | "touch";
export type InteractionScaleSetting = InteractionScale | "auto";

export function detectDefaultInteractionScale(hasTouchSupport: boolean): InteractionScale {
  return hasTouchSupport ? "touch" : "comfortable";
}

export function resolveInteractionScale(
  setting: InteractionScaleSetting,
  hasTouchSupport: boolean
): InteractionScale {
  if (setting === "compact" || setting === "comfortable" || setting === "touch") {
    return setting;
  }
  return detectDefaultInteractionScale(hasTouchSupport);
}
