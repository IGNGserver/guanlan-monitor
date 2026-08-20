"use client";

import { useEffect, useMemo, useState } from "react";
import WorkspaceApp from "@dsc/console-ui";
import type { WorkspaceRoute } from "@dsc/console-ui";
import { ApiError, getSession } from "../lib/api";
import { webConsoleAdapter } from "../lib/console-adapter";
import { LoginForm } from "./login-form";
import styles from "./monitor.module.css";

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
    return <main className={styles.loginShell}><div className={`${styles.doubleBezelShell} ${styles.loginCardShell}`}><div className={styles.doubleBezelInner} style={{ textAlign: "center" }}><h1 style={{ margin: 0, fontSize: "20px" }}>正在连接观澜中枢</h1><p style={{ color: "var(--text-muted)" }}>正在检查当前登录会话...</p></div></div></main>;
  }

  if (state === "anonymous") {
    return <LoginForm onAuthenticated={async () => { await webConsoleAdapter.getSnapshot(); setState("authenticated"); }} />;
  }

  return <WorkspaceApp adapter={webConsoleAdapter} initialRoute={initialRoute} />;
}
