import path from "node:path";
import { fileURLToPath } from "node:url";

export function isTrustedRendererUrl(
  rawUrl: string,
  rendererRoot: string,
  devServerUrl?: string,
  allowRecoveryData = false
): boolean {
  if (allowRecoveryData && rawUrl.startsWith("data:text/html;charset=utf-8,")) return true;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol === "file:") {
    try {
      const rendererPath = path.resolve(fileURLToPath(url));
      const root = path.resolve(rendererRoot);
      return rendererPath === root || rendererPath.startsWith(`${root}${path.sep}`);
    } catch {
      return false;
    }
  }

  if (!devServerUrl) return false;
  try {
    return url.origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}
