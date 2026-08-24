export const MIN_WINDOWS_MATERIAL_BUILD = 22621;

export type WindowMaterial = "opaque" | "mica";

export interface WindowMaterialCapabilities {
  platform: "windows" | "other";
  windowsBuild: number | null;
  supportsMica: boolean;
  prefersReducedTransparency: boolean;
  activeMaterial: WindowMaterial;
}

export interface WindowMaterialBridge {
  getWindowMaterialCapabilities(): Promise<WindowMaterialCapabilities>;
}

export function resolveWindowMaterial({
  platform,
  windowsBuild,
  prefersReducedTransparency,
  supportsNativeMaterial
}: {
  platform: "windows" | "other";
  windowsBuild: number | null;
  prefersReducedTransparency: boolean;
  supportsNativeMaterial: boolean;
}): WindowMaterial {
  return platform === "windows" &&
    windowsBuild !== null &&
    windowsBuild >= MIN_WINDOWS_MATERIAL_BUILD &&
    supportsNativeMaterial &&
    !prefersReducedTransparency
    ? "mica"
    : "opaque";
}

export function createFallbackWindowMaterialCapabilities(): WindowMaterialCapabilities {
  return {
    platform: "other",
    windowsBuild: null,
    supportsMica: false,
    prefersReducedTransparency: false,
    activeMaterial: "opaque"
  };
}
