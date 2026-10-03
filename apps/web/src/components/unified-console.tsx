"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WorkspaceApp, { M3Button } from "@dsc/console-ui";
import type { WorkspaceRoute } from "@dsc/console-ui";
import { ApiError } from "../lib/api";
import { webConsoleAdapter } from "../lib/console-adapter";
import { LoginForm } from "./login-form";
import { PwaControls } from "./pwa-controls";
import styles from "./auth.module.css";

export function UnifiedConsole({ initialDeviceId = null }: { initialDeviceId?: string | null }) {
  const [state, setState] = useState<"loading" | "authenticated" | "anonymous" | "unavailable">("loading");
  const stateRef = useRef(state);
  const checkVersion = useRef(0);
  stateRef.current = state;
  const invalidateCheck = useCallback(() => { ++checkVersion.current; }, []);
  const check = useCallback(async () => {
    const version = ++checkVersion.current;
    const current = () => version === checkVersion.current;
    try {
      await webConsoleAdapter.establishSession();
      if (current()) setState("authenticated");
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setState("anonymous");
      else {
        const restored = await webConsoleAdapter.restoreOffline({}, current);
        if (current()) setState(restored ? "authenticated" : "unavailable");
      }
    }
  }, []);
  useEffect(() => {
    void check();
    const recover = () => { if (stateRef.current !== "authenticated") void check(); };
    window.addEventListener("online", recover);
    return () => { invalidateCheck(); window.removeEventListener("online", recover); };
  }, [check, invalidateCheck]);
  const initialRoute = useMemo<WorkspaceRoute | undefined>(() => {
    if (typeof window !== "undefined" && window.location.hash) return undefined;
    let id = initialDeviceId;
    // The offline shell is the root document. A saved deep link still selects
    // its device even though the server's dynamic route is unreachable.
    if (!id && typeof window !== "undefined" && window.location.pathname.startsWith("/devices/")) {
      try { id = decodeURIComponent(window.location.pathname.slice("/devices/".length)); } catch { /* Invalid URL falls back to overview. */ }
    }
    return id ? { kind: "device", deviceId: id } : undefined;
  }, [initialDeviceId]);
  const forget = async () => { invalidateCheck(); await webConsoleAdapter.forgetOfflineData(); setState(navigator.onLine ? "anonymous" : "unavailable"); };
  let content;
  if (state === "loading" || state === "unavailable") {
    content = <main className={styles.loginShell}><header className={styles.loginTop}><div className={styles.loginBrand}><img src="/logo.png" alt="观澜" className={styles.brandLogoImage} /><div><strong>观澜</strong><span>设备状态中枢</span></div></div></header>
      <section className={styles.loginPanel} aria-live="polite"><div className={styles.loginFormShell}>
        {state === "loading" ? <><div className={styles.loginLoadingBar} aria-hidden="true" /><h1>正在连接中枢</h1><p>正在检查会话和可用的设备状态。</p></>
          : <><h1>暂时无法连接</h1><p>请检查网络与中枢服务。此浏览器没有可用的离线数据，恢复连接后会自动重试。</p><M3Button onClick={() => { setState("loading"); void check(); }}>重新连接</M3Button></>}
      </div></section></main>;
  } else if (state === "anonymous") content = <LoginForm onAuthenticated={async () => { const version = ++checkVersion.current; await webConsoleAdapter.establishSession(); if (version === checkVersion.current) setState("authenticated"); }} onStartLogin={async () => { invalidateCheck(); await webConsoleAdapter.forgetOfflineData(); }} />;
  else content = <WorkspaceApp adapter={webConsoleAdapter} initialRoute={initialRoute} />;
  return <>{content}<PwaControls onForget={forget} /></>;
}
