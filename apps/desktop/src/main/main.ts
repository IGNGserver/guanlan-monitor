import { app, BrowserWindow, Menu, nativeImage, nativeTheme, screen, Tray } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopController } from "./controller.js";
import { registerIpc } from "./ipc.js";
import { resolveWindowMaterial } from "../window-material.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveAppIconPath(): string {
  const resourceIcon = path.join(process.resourcesPath, "app-icon.ico");
  if (fs.existsSync(resourceIcon)) return resourceIcon;
  const devIcon = path.join(__dirname, "../../../windows-agent/DeviceStateConsoleAgent.WinUI/Assets/app-icon.ico");
  if (fs.existsSync(devIcon)) return devIcon;
  return resourceIcon;
}

type InstallerRestoreState = "window" | "tray";

function getInstallerRestoreState(commandLine: string[]): InstallerRestoreState | null {
  const argument = commandLine.find((value) => value === "--dsc-installer-restore=window" || value === "--dsc-installer-restore=tray");
  if (argument === "--dsc-installer-restore=window") return "window";
  if (argument === "--dsc-installer-restore=tray") return "tray";
  return null;
}

function getWindowsBuild(): number | null {
  const electronProcess = process as NodeJS.Process & { getSystemVersion?: () => string };
  if (process.platform !== "win32" || typeof electronProcess.getSystemVersion !== "function") return null;
  const match = electronProcess.getSystemVersion().match(/^\d+\.\d+\.(\d+)/);
  return match ? Number(match[1]) : null;
}

function resolveNativeWindowMaterial(): "mica" | "none" {
  const material = resolveWindowMaterial({
    platform: process.platform === "win32" ? "windows" : "other",
    windowsBuild: getWindowsBuild(),
    prefersReducedTransparency: process.platform === "win32" && nativeTheme.prefersReducedTransparency,
    supportsNativeMaterial: process.platform === "win32"
  });
  return material === "mica" ? "mica" : "none";
}

const installerRestoreState = getInstallerRestoreState(process.argv);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let controller: DesktopController | null = null;
  let quitting = false;
  let shutdownPromise: Promise<void> | null = null;

  const showWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  const shutdown = async () => {
    if (!controller) return;
    shutdownPromise ??= controller.shutdown();
    await shutdownPromise;
  };

  const createWindow = () => {
    const preloadPath = path.join(__dirname, "../preload/index.js");
    const iconPath = resolveAppIconPath();
    const appIcon = nativeImage.createFromPath(iconPath);
    const nativeWindowMaterial = resolveNativeWindowMaterial();
    const workArea = screen.getPrimaryDisplay().workAreaSize;
    const minWidth = Math.min(360, Math.max(320, workArea.width - 32));
    const minHeight = Math.min(360, Math.max(320, workArea.height - 32));
    mainWindow = new BrowserWindow({
      width: Math.min(1440, Math.max(minWidth, workArea.width - 48)),
      height: Math.min(920, Math.max(minHeight, workArea.height - 48)),
      minWidth,
      minHeight,
      show: false,
      frame: false,
      icon: appIcon.isEmpty() ? undefined : appIcon,
      // Windows 11 uses native Mica as the window-level backdrop. Windows 10,
      // reduced-transparency systems, and other platforms stay opaque; the
      // renderer applies the matching surface token set automatically.
      backgroundColor: nativeWindowMaterial === "mica" ? "#00000000" : "#f5f7fa",
      backgroundMaterial: process.platform === "win32" ? nativeWindowMaterial : undefined,
      title: "观澜 · 设备状态控制台",
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        // The preload is compiled as an ESM module. Keep Node integration disabled
        // and context isolation enabled; the unsandboxed preload is required for
        // Electron to load its typed ESM bridge on both supported platforms.
        sandbox: false,
        spellcheck: false
      }
    });
    mainWindow.setMenuBarVisibility(false);
    const updateNativeWindowMaterial = () => {
      if (!mainWindow || mainWindow.isDestroyed() || process.platform !== "win32") return;
      const material = resolveNativeWindowMaterial();
      try {
        mainWindow.setBackgroundMaterial(material);
        mainWindow.setBackgroundColor(material === "mica" ? "#00000000" : "#f5f7fa");
      } catch {
        // Older Electron builds can expose the option but reject a runtime update.
      }
    };
    nativeTheme.on("updated", updateNativeWindowMaterial);
    mainWindow.once("closed", () => nativeTheme.removeListener("updated", updateNativeWindowMaterial));
    mainWindow.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      mainWindow?.hide();
    });
    mainWindow.once("ready-to-show", () => {
      if (installerRestoreState === "tray") return;
      if (installerRestoreState === "window" || !controller?.startupSettings.startMinimized) showWindow();
    });

    const devServerUrl = process.env.DSC_DEV_SERVER_URL ?? process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      void mainWindow.loadURL(devServerUrl);
    } else {
      void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    }
  };

  const createTray = () => {
    const iconPath = resolveAppIconPath();
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip("观澜 · 设备状态控制台");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开观澜", click: showWindow },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitting = true;
          void shutdown().finally(() => app.quit());
        }
      }
    ]));
    tray.on("double-click", showWindow);
  };

  app.on("second-instance", (_event, commandLine) => {
    if (getInstallerRestoreState(commandLine) === "tray") mainWindow?.hide();
    else showWindow();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void shutdown().finally(() => app.quit());
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("org.igng.devicestateconsole");
    controller = new DesktopController();
    await controller.initialize();
    registerIpc(controller, () => mainWindow, () => { quitting = true; });
    createWindow();
    createTray();
    if (mainWindow) {
      mainWindow.webContents.once("did-finish-load", () => {
        void controller?.refresh();
      });
    }
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  }).catch((error) => {
    console.error("Device State Console startup failed", error);
    app.quit();
  });
}
