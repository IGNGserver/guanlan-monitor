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
  /**
   * The material the native window was created with, synchronously.
   *
   * Preload-visible so the renderer can write `data-dsc-material` before its
   * first paint. Without it the provider could only write `"opaque"` and then
   * await the capability call, which repainted the whole token set and produced
   * a visible flash on a Mica window.
   */
  readonly initialWindowMaterial: WindowMaterial;
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

/**
 * Read the launch switch the main process passes through
 * `webPreferences.additionalArguments`.
 *
 * The renderer needs the material on its first paint; asking for it over IPC
 * would mean one frame of the opaque token set on a Mica window. The switch is
 * the only synchronously available source, and an unparseable value has to mean
 * `opaque` rather than "assume Mica" — guessing wrong the other way leaves a
 * fully transparent window on a system that has no backdrop behind it.
 */
export function parseWindowMaterialArgument(argv: readonly string[]): WindowMaterial {
  const argument = argv.find((value) => value.startsWith("--dsc-window-material="));
  if (!argument) return "opaque";
  const value = argument.slice("--dsc-window-material=".length);
  return value === "mica" ? "mica" : "opaque";
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
