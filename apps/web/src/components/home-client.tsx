"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeviceSummary } from "@dsc/shared";
import { getSession, listDevices } from "../lib/api";
import { Dashboard } from "./dashboard";
import { LoginForm } from "./login-form";
import styles from "./monitor.module.css";

export function HomeClient({ initialDeviceId = null }: { initialDeviceId?: string | null }) {
  const [state, setState] = useState<"loading" | "authenticated" | "anonymous">("loading");
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const router = useRouter();

  async function loadAuthenticatedState() {
    await getSession();
    const nextDevices = await listDevices();
    setDevices(nextDevices);
    if (initialDeviceId == null && nextDevices[0]) {
      router.replace(`/devices/${encodeURIComponent(nextDevices[0].deviceId)}` as never);
    }
    setState("authenticated");
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await getSession();
        const nextDevices = await listDevices();
        if (!active) return;
        setDevices(nextDevices);
        if (initialDeviceId == null && nextDevices[0]) {
          router.replace(`/devices/${encodeURIComponent(nextDevices[0].deviceId)}` as never);
        }
        setState("authenticated");
      } catch {
        if (!active) return;
        setState("anonymous");
      }
    })();

    return () => {
      active = false;
    };
  }, [initialDeviceId, router]);

  if (state === "loading") {
    return (
      <main className={styles.loginShell}>
        <section className={styles.loginCard}>
          <p className={styles.eyebrow}>设备状态控制台</p>
          <h1>正在加载</h1>
          <p className={styles.meta}>正在检查登录态与设备列表。</p>
        </section>
      </main>
    );
  }

  if (state === "anonymous") {
    return <LoginForm onAuthenticated={loadAuthenticatedState} />;
  }

  return <Dashboard initialDevices={devices} initialSelectedDeviceId={initialDeviceId} />;
}
