"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type { DeviceRealtimeEvent, DeviceSummary, MetricWindow } from "@dsc/shared";
import { deleteDevice, getSession, getServerUrl, listDevices, logout, reorderDevices } from "../lib/api";
import { Dashboard } from "./dashboard";
import { HomeOverview } from "./home-overview";
import { LoginForm } from "./login-form";
import { SaasShell } from "./saas-shell";
import styles from "./monitor.module.css";

export function HomeClient({ initialDeviceId = null }: { initialDeviceId?: string | null }) {
  const [state, setState] = useState<"loading" | "authenticated" | "anonymous">("loading");
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(initialDeviceId);
  const [selectedWindow, setSelectedWindow] = useState<MetricWindow>("1m");
  const [socketConnected, setSocketConnected] = useState(false);

  const router = useRouter();

  async function loadAuthenticatedState() {
    await getSession();
    const nextDevices = await listDevices();
    setDevices(nextDevices);
    setState("authenticated");
  }

  async function handleDeleteDevice(deviceId: string) {
    await deleteDevice(deviceId);
    setDevices((current) => current.filter((d) => d.deviceId !== deviceId));
    if (selectedDeviceId === deviceId) {
      handleSelectDevice(null);
    }
  }

  async function handleReorderDevices(deviceIds: string[]) {
    await reorderDevices(deviceIds);
    const updatedDevices = await listDevices();
    setDevices(updatedDevices);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await getSession();
        const nextDevices = await listDevices();
        if (!active) return;
        setDevices(nextDevices);
        setState("authenticated");
      } catch {
        if (!active) return;
        setState("anonymous");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSelectedDeviceId(initialDeviceId);
  }, [initialDeviceId]);

  // Socket.io realtime listener
  useEffect(() => {
    if (state !== "authenticated") return;

    const socket: Socket = io(typeof window === "undefined" ? getServerUrl() : undefined, {
      path: "/socket.io",
      transports: ["websocket"],
      withCredentials: true
    });

    socket.on("connect", () => {
      setSocketConnected(true);
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
    });

    socket.on("device:update", (event: DeviceRealtimeEvent) => {
      setDevices((current) => {
        const exists = current.some((d) => d.deviceId === event.deviceId);
        if (exists) {
          return current.map((d) => (d.deviceId === event.deviceId ? event.summary : d));
        }
        return [...current, event.summary];
      });
    });

    return () => {
      socket.close();
    };
  }, [state]);

  function handleSelectDevice(deviceId: string | null) {
    setSelectedDeviceId(deviceId);
    if (deviceId) {
      router.push(`/devices/${encodeURIComponent(deviceId)}`);
    } else {
      router.push("/");
    }
  }

  async function handleLogout() {
    await logout();
    setState("anonymous");
    router.push("/");
  }

  if (state === "loading") {
    return (
      <main className={styles.loginShell}>
        <div className={`${styles.doubleBezelShell} ${styles.loginCardShell}`}>
          <div className={`${styles.doubleBezelInner} ${styles.loginCardInner}`} style={{ textAlign: "center" }}>
            <img src="/logo.png" alt="DSC Logo" className={styles.brandLogoImage} style={{ margin: "0 auto 12px" }} />
            <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>正在接入中枢服务</h2>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "6px 0 0" }}>
              检查登录凭证与节点全域快照...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (state === "anonymous") {
    return <LoginForm onAuthenticated={loadAuthenticatedState} />;
  }

  return (
    <SaasShell
      devices={devices}
      selectedDeviceId={selectedDeviceId}
      selectedWindow={selectedWindow}
      onSelectDevice={handleSelectDevice}
      onSelectWindow={setSelectedWindow}
      onLogout={handleLogout}
      socketConnected={socketConnected}
    >
      {selectedDeviceId ? (
        <Dashboard
          deviceId={selectedDeviceId}
          devices={devices}
          selectedWindow={selectedWindow}
          onSelectWindow={setSelectedWindow}
          onSelectDevice={handleSelectDevice}
        />
      ) : (
        <HomeOverview
          devices={devices}
          onOpenDevice={(id) => handleSelectDevice(id)}
          onDeleteDevice={handleDeleteDevice}
          onReorderDevices={handleReorderDevices}
        />
      )}
    </SaasShell>
  );
}
