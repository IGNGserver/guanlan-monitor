import { app, BrowserWindow, crashReporter, Menu, nativeImage, nativeTheme, screen, Tray } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DesktopController } from "./controller.js";
import { appendDesktopDiagnostic } from "./diagnostics.js";
import { registerIpc } from "./ipc.js";
import { getDesktopRuntimeProfile, readSystemMemoryInfo } from "./runtime-profile.js";
import { resolveWindowMaterial } from "../window-material.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GPU_FALLBACK_ARGUMENT = "--dsc-disable-gpu";
const GPU_FORCE_HARDWARE_ARGUMENT = "--dsc-enable-gpu";
const GPU_FALLBACK_MARKER = "desktop-gpu-fallback.json";

function gpuFallbackMarkerPath(): string | null {
  try {
    return path.join(app.getPath("userData"), GPU_FALLBACK_MARKER);
  } catch {
    return null;
  }
}

function hasPersistedGpuFallback(): boolean {
  const markerPath = gpuFallbackMarkerPath();
  if (!markerPath) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as { enabled?: unknown };
    return marker.enabled === true;
  } catch {
    return false;
  }
}

function hasPreviousGpuCrash(): boolean {
  const diagnosticPath = (() => {
    try {
      return path.join(app.getPath("userData"), "desktop-diagnostics.log");
    } catch {
      return null;
    }
  })();
  if (!diagnosticPath) return false;
  try {
    const lines = fs.readFileSync(diagnosticPath, "utf8").split(/\r?\n/).slice(-128);
    return lines.some((line) => {
      try {
        const event = JSON.parse(line) as { event?: unknown; type?: unknown; reason?: unknown };
        return event.event === "child-process-gone" && event.type === "GPU" && event.reason !== "clean-exit";
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function persistGpuFallback(reason: string): void {
  const markerPath = gpuFallbackMarkerPath();
  if (!markerPath) return;
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    const temporaryPath = `${markerPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ enabled: true, reason, at: new Date().toISOString() }), "utf8");
    fs.renameSync(temporaryPath, markerPath);
  } catch {
    // A missing marker must not prevent the one-shot fallback relaunch.
  }
}

const gpuFallbackActive = process.platform === "win32"
  && !process.argv.includes(GPU_FORCE_HARDWARE_ARGUMENT)
  && (process.argv.includes(GPU_FALLBACK_ARGUMENT) || hasPersistedGpuFallback() || hasPreviousGpuCrash());

crashReporter.start({
  productName: "观澜",
  uploadToServer: false,
  compress: false
});
if (gpuFallbackActive) app.disableHardwareAcceleration();

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
  if (getDesktopRuntimeProfile(gpuFallbackActive).useOpaqueWindow) return "none";
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
  let rendererRecoveryTimer: NodeJS.Timeout | null = null;
  let rendererRecoveryWindowStartedAt = 0;
  let rendererRecoveryCount = 0;
  let rendererRecoveryFallbackActive = false;
  let rendererUnresponsiveTimer: NodeJS.Timeout | null = null;
  let windowVisible = false;
  let recreateWindowShowState: boolean | null = null;
  let gpuFallbackRelaunchScheduled = false;
  let createWindow: () => void;

  const reportProcessEvent = (event: string, details: Record<string, unknown>) => {
    appendDesktopDiagnostic(event, {
      ...details,
      systemMemory: readSystemMemoryInfo(),
      runtimeProfile: getDesktopRuntimeProfile(gpuFallbackActive),
      appMetrics: (() => {
        try {
          return app.getAppMetrics().map((metric) => ({
            pid: metric.pid,
            type: metric.type,
            name: metric.name,
            cpu: metric.cpu,
            memory: metric.memory
          }));
        } catch {
          return undefined;
        }
      })()
    });
    console.error(`[${event}]`, details);
  };

  reportProcessEvent("process-start", {
    version: app.getVersion(),
    gpuFallbackActive,
    argv: process.argv.slice(1)
  });

  const loadMainContent = (window: BrowserWindow) => {
    const devServerUrl = process.env.DSC_DEV_SERVER_URL ?? process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) return window.loadURL(devServerUrl);
    return window.loadFile(path.join(__dirname, "../renderer/index.html"));
  };

  const showRendererRecoveryPage = (reason: string) => {
    if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
    rendererRecoveryFallbackActive = true;
    const devServerUrl = process.env.DSC_DEV_SERVER_URL ?? process.env.VITE_DEV_SERVER_URL;
    const retryTarget = devServerUrl ?? pathToFileURL(path.join(__dirname, "../renderer/index.html")).toString();
    const recoveryPage = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>观澜正在恢复</title>
    <style>
      :root { color-scheme: light; font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif; background: #f5f7fa; color: #17202a; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f5f7fa; }
      main { width: min(560px, calc(100vw - 48px)); padding: 32px; border: 1px solid #d8e0e8; border-radius: 18px; background: #ffffff; box-shadow: 0 16px 40px rgba(30, 48, 68, .12); }
      h1 { margin: 0 0 12px; font-size: 22px; font-weight: 650; }
      p { margin: 8px 0; line-height: 1.65; color: #526170; }
      button { margin-top: 18px; border: 0; border-radius: 10px; padding: 10px 16px; background: #1668dc; color: #fff; font: inherit; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>观澜正在等待系统恢复</h1>
      <p>显示进程刚刚因为系统资源不足或远程桌面显示切换而退出。主程序仍在运行，窗口已进入安全恢复页。</p>
      <p>请稍等片刻；如果系统资源已经释放，可以点击下方按钮重新加载控制台。</p>
      <button id="retry" type="button">重新加载控制台</button>
    </main>
    <script>
      const retryTarget = ${JSON.stringify(retryTarget)};
      document.getElementById("retry")?.addEventListener("click", () => window.location.replace(retryTarget));
    </script>
  </body>
</html>`;
    reportProcessEvent("renderer-recovery-fallback", { reason, count: rendererRecoveryCount });
    void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(recoveryPage)}`).catch((error) => {
      reportProcessEvent("renderer-recovery-fallback-failed", { reason, error });
    });
  };

  const recreateWindow = (reason: string) => {
    if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
    const previousWindow = mainWindow;
    recreateWindowShowState = windowVisible;
    windowVisible = false;
    mainWindow = null;
    rendererRecoveryFallbackActive = false;
    reportProcessEvent("renderer-recovery-recreate", { reason, count: rendererRecoveryCount });
    try {
      previousWindow.destroy();
    } catch (error) {
      reportProcessEvent("renderer-recovery-destroy-failed", { reason, error });
    }
    createWindow();
  };

  const scheduleRendererRecovery = (reason: string) => {
    if (quitting || !mainWindow || mainWindow.isDestroyed() || rendererRecoveryTimer) return;
    const now = Date.now();
    if (now - rendererRecoveryWindowStartedAt > 60_000) {
      rendererRecoveryWindowStartedAt = now;
      rendererRecoveryCount = 0;
    }
    if (rendererRecoveryCount >= 5) {
      reportProcessEvent("renderer-recovery-suppressed", { reason, count: rendererRecoveryCount });
      if (!rendererRecoveryFallbackActive) showRendererRecoveryPage(reason);
      return;
    }
    rendererRecoveryCount += 1;
    const recoveryCount = rendererRecoveryCount;
    const delay = Math.min(8_000, 1_000 * (2 ** (recoveryCount - 1)));
    rendererRecoveryTimer = setTimeout(() => {
      rendererRecoveryTimer = null;
      if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
      const hardFailure = reason === "oom" || reason === "launch-failed" || reason === "memory-eviction" || recoveryCount >= 2;
      if (hardFailure) {
        recreateWindow(reason);
        return;
      }
      reportProcessEvent("renderer-recovery-reload", { reason, count: recoveryCount });
      try {
        void mainWindow.reload();
      } catch (error) {
        reportProcessEvent("renderer-recovery-reload-failed", { reason, count: recoveryCount, error });
        recreateWindow(reason);
      }
    }, delay);
  };

  const showWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (rendererRecoveryFallbackActive) {
      rendererRecoveryFallbackActive = false;
      rendererRecoveryCount = 0;
      void loadMainContent(mainWindow).catch((error) => {
        reportProcessEvent("renderer-recovery-retry-failed", { error });
      });
    }
    windowVisible = true;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  const hideWindow = () => {
    windowVisible = false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  };

  const shutdown = async () => {
    if (!controller) return;
    shutdownPromise ??= controller.shutdown();
    await shutdownPromise;
  };

  const relaunchWithGpuFallback = (reason: string) => {
    if (gpuFallbackActive || gpuFallbackRelaunchScheduled || quitting) return false;
    gpuFallbackRelaunchScheduled = true;
    persistGpuFallback(reason);
    reportProcessEvent("gpu-fallback-relaunch", { reason });
    const args = process.argv.slice(1).filter((argument) => argument !== GPU_FALLBACK_ARGUMENT);
    app.relaunch({ args: [...args, GPU_FALLBACK_ARGUMENT] });
    quitting = true;
    void shutdown().finally(() => app.exit(0));
    return true;
  };

  createWindow = () => {
    const preloadPath = path.join(__dirname, "../preload/index.js");
    const iconPath = resolveAppIconPath();
    const appIcon = nativeImage.createFromPath(iconPath);
    const nativeWindowMaterial = resolveNativeWindowMaterial();
    const workArea = screen.getPrimaryDisplay().workAreaSize;
    const minWidth = Math.min(360, Math.max(320, workArea.width - 32));
    const minHeight = Math.min(360, Math.max(320, workArea.height - 32));
    const window = new BrowserWindow({
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
    mainWindow = window;
    window.setMenuBarVisibility(false);
    const updateNativeWindowMaterial = () => {
      if (window.isDestroyed() || process.platform !== "win32") return;
      const material = resolveNativeWindowMaterial();
      try {
        window.setBackgroundMaterial(material);
        window.setBackgroundColor(material === "mica" ? "#00000000" : "#f5f7fa");
      } catch {
        // Older Electron builds can expose the option but reject a runtime update.
      }
    };
    nativeTheme.on("updated", updateNativeWindowMaterial);
    window.once("closed", () => {
      nativeTheme.removeListener("updated", updateNativeWindowMaterial);
      if (rendererUnresponsiveTimer) {
        clearTimeout(rendererUnresponsiveTimer);
        rendererUnresponsiveTimer = null;
      }
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      reportProcessEvent("render-process-gone", {
        reason: details.reason,
        exitCode: details.exitCode
      });
      if (details.reason !== "clean-exit") scheduleRendererRecovery(details.reason);
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      reportProcessEvent("renderer-load-failed", {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      });
      if (isMainFrame && errorCode !== -3) scheduleRendererRecovery(`load:${errorCode}`);
    });
    window.webContents.on("unresponsive", () => {
      reportProcessEvent("renderer-unresponsive", {});
      if (!rendererUnresponsiveTimer) {
        rendererUnresponsiveTimer = setTimeout(() => {
          rendererUnresponsiveTimer = null;
          scheduleRendererRecovery("unresponsive");
        }, 10_000);
      }
    });
    window.webContents.on("responsive", () => {
      if (rendererUnresponsiveTimer) {
        clearTimeout(rendererUnresponsiveTimer);
        rendererUnresponsiveTimer = null;
      }
      reportProcessEvent("renderer-responsive", {});
    });
    window.webContents.once("did-finish-load", () => {
      if (rendererRecoveryFallbackActive) return;
      rendererRecoveryCount = 0;
      rendererRecoveryWindowStartedAt = Date.now();
      reportProcessEvent("renderer-ready", {});
      void controller?.refresh();
    });
    window.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      hideWindow();
    });
    window.once("ready-to-show", () => {
      if (installerRestoreState === "tray") return;
      const shouldShow = recreateWindowShowState ?? (installerRestoreState === "window" || !controller?.startupSettings.startMinimized);
      recreateWindowShowState = null;
      if (shouldShow) showWindow();
    });

    void loadMainContent(window).catch((error) => {
      reportProcessEvent("renderer-load-start-failed", { error });
      scheduleRendererRecovery("load-start");
    });
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
    if (getInstallerRestoreState(commandLine) === "tray") hideWindow();
    else showWindow();
  });
  app.on("will-quit", () => {
    reportProcessEvent("will-quit", { quitting });
  });
  app.on("quit", (_event, exitCode) => {
    appendDesktopDiagnostic("app-quit", { exitCode, gpuFallbackActive });
  });
  app.on("child-process-gone", (_event, details) => {
    reportProcessEvent("child-process-gone", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName
    });
    if (details.reason !== "clean-exit" && details.type === "GPU") {
      const reason = `gpu:${details.reason}`;
      if (!relaunchWithGpuFallback(reason)) scheduleRendererRecovery(reason);
    }
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void shutdown().finally(() => app.quit());
  });
  process.on("uncaughtException", (error) => {
    appendDesktopDiagnostic("main-uncaught-exception", { error });
    console.error("Device State Console main process failed", error);
    app.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    appendDesktopDiagnostic("main-unhandled-rejection", { reason });
    console.error("Device State Console unhandled rejection", reason);
  });
  process.on("exit", (code) => {
    appendDesktopDiagnostic("process-exit", { code, gpuFallbackActive });
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("org.igng.devicestateconsole");
    controller = new DesktopController();
    await controller.initialize();
    reportProcessEvent("desktop-ready", { gpuFallbackActive });
    registerIpc(controller, () => mainWindow, () => { quitting = true; }, gpuFallbackActive);
    createWindow();
    createTray();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  }).catch((error) => {
    appendDesktopDiagnostic("startup-failed", { error });
    console.error("Device State Console startup failed", error);
    app.quit();
  });
}
