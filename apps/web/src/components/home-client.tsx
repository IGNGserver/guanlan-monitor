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

  return initialDeviceId ? (
    <Dashboard initialDevices={devices} initialSelectedDeviceId={initialDeviceId} />
  ) : (
    <HomeOverview devices={devices} onOpenDevice={(deviceId) => router.push(`/devices/${encodeURIComponent(deviceId)}`)} />
  );
}

function HomeOverview({
  devices,
  onOpenDevice
}: {
  devices: DeviceSummary[];
  onOpenDevice: (deviceId: string) => void;
}) {
  const [background, setBackground] = useState<string | null>(null);

  useEffect(() => {
    setBackground(window.localStorage.getItem("dsc-background"));
  }, []);

  function handleBackground(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setBackground(result);
      window.localStorage.setItem("dsc-background", result);
    };
    reader.readAsDataURL(file);
  }

  const online = devices.filter((device) => device.status === "online").length;
  const avgCpu = devices.length
    ? Math.round(devices.reduce((sum, device) => sum + (device.cpuUsagePercent ?? 0), 0) / devices.length)
    : 0;

  return (
    <main className={styles.homeShell} style={background ? { backgroundImage: `url(${background})` } : undefined}>
      <div className={styles.homeScrim} />
      <section className={styles.homeFrame}>
        <header className={styles.homeHeader}>
          <div className={styles.brandLockup}>
            <span className={styles.brandMark}>DS</span>
            <div><strong>设备状态控制台</strong><span>Device operations</span></div>
          </div>
          <label className={styles.backgroundButton}>
            更换背景
            <input type="file" accept="image/*" onChange={handleBackground} />
          </label>
        </header>

        <div className={styles.homeIntro}>
          <div>
            <p className={styles.eyebrow}>工作台总览</p>
            <h1>设备，保持在掌握之中。</h1>
            <p className={styles.homeLead}>从一个安静的空间查看所有节点的健康状态、资源趋势和实时变化。</p>
          </div>
          <div className={styles.homePulse}><span className={styles.pulseDot} />监控服务正常</div>
        </div>

        <div className={styles.homeStats}>
          <div><span>设备总数</span><strong>{devices.length}</strong><small>已接入节点</small></div>
          <div><span>当前在线</span><strong>{online}</strong><small>{devices.length ? `${Math.round((online / devices.length) * 100)}% 可用` : "等待接入"}</small></div>
          <div><span>平均 CPU</span><strong>{avgCpu}%</strong><small>来自当前快照</small></div>
        </div>

        <section className={styles.homeDevices}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>节点目录</p><h2>所有设备</h2></div><span>{devices.length} 个节点</span></div>
          {devices.length ? <div className={styles.homeDeviceGrid}>{devices.map((device) => (
            <button key={device.deviceId} className={styles.homeDeviceCard} onClick={() => onOpenDevice(device.deviceId)} type="button">
              <div className={styles.homeDeviceTop}><span className={styles.deviceType}>{device.os === "windows" ? "Windows" : "Linux"}</span><span className={device.status === "online" ? styles.onlineLabel : styles.offlineLabel}><i />{device.status === "online" ? "在线" : "离线"}</span></div>
              <h3>{device.hostname}</h3><p>{device.deviceId}</p>
              <div className={styles.homeMetricRow}><span>CPU <b>{formatPercent(device.cpuUsagePercent)}</b></span><span>内存 <b>{formatPercent(device.memoryUsagePercent)}</b></span><span>磁盘 <b>{formatPercent(device.diskUsagePercent)}</b></span></div>
              <span className={styles.openDevice}>查看设备 <b>↗</b></span>
            </button>
          ))}</div> : <div className={styles.emptyState}><p>暂无设备数据。启动节点代理后会在这里出现。</p></div>}
        </section>
      </section>
    </main>
  );
}

function formatPercent(value: number | null) {
  return value == null ? "--" : `${value.toFixed(0)}%`;
}
