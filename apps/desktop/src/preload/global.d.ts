import type { DesktopRendererBridge } from "@dsc/shared";

declare global {
  interface Window {
    dsc: DesktopRendererBridge;
  }
}

export {};
