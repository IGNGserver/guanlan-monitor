import type { UpdatePlatform } from "@dsc/shared";

/** Native process architecture, not the UI's navigator/platform string. */
export function desktopUpdatePlatform(platform = process.platform): UpdatePlatform {
  switch (platform) {
    case "win32": return "windows-gui";
    case "darwin": return "macos-gui";
    case "linux": return "linux-gui";
    default: throw new Error(`unsupported_desktop_platform:${platform}`);
  }
}
