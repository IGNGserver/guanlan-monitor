/**
 * Keyboard reference for the shared console.
 *
 * Pure data + platform detection live here, separate from the React page, so the
 * platform rules are importable by a plain `node --test` suite: the component
 * file is `.tsx` and cannot be loaded by the repo's test runner.
 */

export type NavigatorPlatform = "mac" | "windows" | "linux" | "other";

export interface ShortcutRow {
  keys: string;
  description: string;
}

export function detectPlatform(): NavigatorPlatform {
  if (typeof navigator === "undefined") return "other";
  const platform = (navigator.platform || navigator.userAgent || "").toLowerCase();
  if (platform.includes("mac") || platform.includes("iphone") || platform.includes("ipad")) return "mac";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux") || platform.includes("x11") || platform.includes("android")) return "linux";
  return "other";
}

/**
 * Shortcut names that are true on the machine the reader is actually using.
 *
 * The shared reference used to print `Ctrl/⌘` and a bare `F5` to both clients,
 * so the browser's reload key was listed as a console shortcut when the handler
 * actually calls `preventDefault`, and the desktop client was shown a ⌘ it never
 * has. Only the modifier and the refresh row differ; the rest are shared.
 *
 * `refreshKey` is `"F5"` for the browser console and anything else for the
 * native client, whose window has no browser reload key at all.
 */
export function platformShortcutRows(platform: NavigatorPlatform, refreshKey: string, nativeWindow: boolean): ShortcutRow[] {
  const modifier = platform === "mac" ? "⌘" : "Ctrl";
  const refresh = refreshKey === "F5" ? "F5 或 Ctrl + R" : `${modifier} + R`;
  const rows: ShortcutRow[] = [
    { keys: `/ 或 ${modifier} + K`, description: "打开搜索和命令面板" },
    { keys: refresh, description: "刷新设备状态" },
    { keys: "Esc", description: "关闭当前弹层" },
    { keys: `${modifier} + B`, description: "折叠侧边栏" },
    { keys: `${modifier} + ,`, description: "打开设置" }
  ];
  if (nativeWindow) rows.push({ keys: `${modifier} + W`, description: "隐藏窗口到系统托盘" });
  return rows;
}
