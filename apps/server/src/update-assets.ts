import type { UpdatePlatform } from "@dsc/shared";

/** Exact delivery-unit names; never fall back to another architecture. */
export function assetNameFor(platform: UpdatePlatform, version: string, arch?: string) {
  switch (platform) {
    case "windows-gui":
      return `DeviceStateConsole-Windows-Setup-v${version}.exe`;
    case "linux-gui":
      return `DeviceStateConsole-Linux-Install-v${version}.deb`;
    case "macos-gui": {
      const architecture = arch === "x64" || arch === "amd64" ? "x64" : arch === "arm64" ? "arm64" : null;
      return architecture ? `DeviceStateConsole-macOS-${architecture}-Install-v${version}.pkg` : null;
    }
    case "android":
      return `DeviceStateConsole-Android-v${version}.apk`;
    default:
      return null;
  }
}
