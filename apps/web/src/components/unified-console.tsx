"use client";

import { useEffect, useMemo, useState } from "react";
import WorkspaceApp from "@dsc/console-ui";
import type { WorkspaceRoute } from "@dsc/console-ui";
import { ApiError, getSession } from "../lib/api";
import { webConsoleAdapter } from "../lib/console-adapter";
import { LoginForm } from "./login-form";
import styles from "./auth.module.css";

export function UnifiedConsole({ initialDeviceId = null }: { initialDeviceId?: string | null }) {
  const [state, setState] = useState<"loading" | "authenticated" | "anonymous">("loading");

  useEffect(() => {
    let active = true;
    void getSession()
      .then(() => {
        if (active) setState("authenticated");
      })
      .catch((error) => {
        if (active && error instanceof ApiError && error.status === 401) setState("anonymous");
        else if (active) setState("anonymous");
      });
    return () => { active = false; };
  }, []);

  const initialRoute = useMemo<WorkspaceRoute | undefined>(() => (
    initialDeviceId ? { kind: "device", deviceId: initialDeviceId } : undefined
  ), [initialDeviceId]);

  if (state === "loading") {
    return (
      <main className={styles.loginShell}>
        <header className={styles.loginTop}>
          <div className={styles.loginBrand}>
            <img src="/logo.png" alt="观澜" className={styles.brandLogoImage} />
            <div><strong>观澜</strong><span>设备状态中枢</span></div>
          </div>
          <span className={styles.loginTopNote}>浏览器工作台</span>
        </header>
        <section className={styles.loginPanel} aria-live="polite">
          <div className={styles.loginFormShell}>
            <div className={styles.loginLoadingBar} aria-hidden="true" />
            <p className={styles.loginPanelEyebrow}>正在连接</p>
            <h1>检查当前会话</h1>
            <p>正在读取认证状态，请稍候。</p>
          </div>
        </section>
      </main>
    );
  }

  if (state === "anonymous") {
    return <LoginForm onAuthenticated={async () => { await webConsoleAdapter.getSnapshot(); setState("authenticated"); }} />;
  }

  return <WorkspaceApp adapter={webConsoleAdapter} initialRoute={initialRoute} />;
}
