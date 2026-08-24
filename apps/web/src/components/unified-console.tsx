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
        <section className={styles.loginLoading} aria-live="polite">
          <div className={styles.loginBrand}>
            <img src="/logo.png" alt="观澜" className={styles.brandLogoImage} />
            <span>观澜</span>
            <small>WEB HUB</small>
          </div>
          <div className={styles.loginLoadingBar} aria-hidden="true" />
          <h1>正在连接观澜中枢</h1>
          <p>正在检查当前登录会话...</p>
        </section>
      </main>
    );
  }

  if (state === "anonymous") {
    return <LoginForm onAuthenticated={async () => { await webConsoleAdapter.getSnapshot(); setState("authenticated"); }} />;
  }

  return <WorkspaceApp adapter={webConsoleAdapter} initialRoute={initialRoute} />;
}
