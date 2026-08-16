export const WINDOW_MATERIALS = ["guanlan", "mica", "acrylic"] as const;

export type WindowMaterial = (typeof WINDOW_MATERIALS)[number];

export interface WindowMaterialCapabilities {
  platform: "windows" | "other";
  windowsBuild: number | null;
  supportsMica: boolean;
  supportsAcrylic: boolean;
  prefersReducedTransparency: boolean;
  activeMaterial: WindowMaterial;
}

export interface WindowMaterialBridge {
  getWindowMaterialCapabilities(): Promise<WindowMaterialCapabilities>;
  setWindowMaterial(material: WindowMaterial): Promise<WindowMaterialCapabilities>;
}

export function createFallbackWindowMaterialCapabilities(): WindowMaterialCapabilities {
  return {
    platform: "other",
    windowsBuild: null,
    supportsMica: false,
    supportsAcrylic: false,
    prefersReducedTransparency: false,
    activeMaterial: "guanlan"
  };
}
