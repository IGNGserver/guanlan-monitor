import type { DesktopRendererBridge } from "@dsc/shared";
import type { WindowMaterialBridge } from "../window-material.js";

declare global {
  interface Window {
    dsc: DesktopRendererBridge & WindowMaterialBridge;
  }
}

export {};
