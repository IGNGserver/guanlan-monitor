"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type {
  DeviceBlockKey,
  DeviceMetricKey,
  DeviceMetricOption,
  DeviceRealtimeEvent,
  DeviceSummary,
  MetricSeries,
  MetricWindow
} from "@dsc/shared";
import { WINDOW_LABELS } from "@dsc/shared/chart";
import {
  getDeviceMetricConfig,
  getMetrics,
  getServerUrl,
  listDevices,
  logout,
  saveDeviceMetricConfig,
  saveFanNote
} from "../lib/api";
import { ChartCard } from "./chart-card";
import { DeviceSidebar } from "./device-sidebar";
import { TrafficCalendar } from "./traffic-calendar";
import styles from "./monitor.module.css";

const DEFAULT_WINDOWS: MetricWindow[] = ["1m", "15m", "1d"];
const DEFAULT_ENABLED_METRICS: DeviceMetricKey[] = [
  "cpuUsage",
  "cpuFrequency",
  "cpuTemperature",
  "gpuUsage",
  "gpuEncode",
  "gpuDecode",
  "gpuFrequency",
  "gpuMemory",
  "gpuTemperature",
  "memoryUsage",
  "swapUsage",
  "diskUsage",
  "diskRead",
  "diskWrite",
  "networkRxRate",
  "networkTxRate",
  "networkTraffic"
];
const BLOCK_METRICS = {
  cpu: ["cpuUsage", "cpuFrequency", "cpuTemperature"],
  gpu: ["gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature"],
  memory: ["memoryUsage", "swapUsage"],
  disk: ["diskUsage", "diskRead", "diskWrite"],
  network: ["networkRxRate", "networkTxRate", "networkTraffic"],
  fan: []
} satisfies Record<string, DeviceMetricKey[]>;
type BlockKey = keyof typeof BLOCK_METRICS;
const BLOCK_ORDER: BlockKey[] = ["cpu", "gpu", "memory", "disk", "network", "fan"];
const BLOCK_LABELS: Record<BlockKey, string> = {
  cpu: "CPU",
  gpu: "显卡",
  memory: "内存",
  disk: "磁盘",
  network: "网络",
  fan: "风扇"
};
const METRIC_LABELS: Record<DeviceMetricKey, string> = {
  cpuUsage: "CPU 占用",
  cpuFrequency: "CPU 频率",
  cpuTemperature: "CPU 温度",
  gpuUsage: "GPU 占用",
  gpuEncode: "GPU 编码",
  gpuDecode: "GPU 解码",
  gpuFrequency: "GPU 频率",
  gpuMemory: "GPU 显存",
  gpuTemperature: "GPU 温度",
  memoryUsage: "内存",
  swapUsage: "虚拟内存",
  diskUsage: "磁盘占用",
  diskRead: "磁盘读取",
  diskWrite: "磁盘写入",
  networkRxRate: "网络接收",
  networkTxRate: "网络发送",
  networkTraffic: "网络流量"
};
const WINDOW_DESCRIPTIONS: Record<MetricWindow, string> = {
  "1m": "来源：实时缓存 · 粒度：5 秒",
  "15m": "来源：实时缓存 · 粒度：1 分钟",
  "1d": "来源：分钟归档 · 粒度：1 分钟",
  "1w": "来源：小时归档 · 粒度：1 小时",
  "1mo": "来源：小时归档 · 粒度：1 小时",
  "1y": "来源：小时归档 · 粒度：1 小时"
};

export function Dashboard({
  initialDevices,
  initialSelectedDeviceId = null
}: {
  initialDevices: DeviceSummary[];
  initialSelectedDeviceId?: string | null;
}) {
  const router = useRouter();
  const [devices, setDevices] = useState(initialDevices);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(
    initialSelectedDeviceId && initialDevices.some((device) => device.deviceId === initialSelectedDeviceId)
      ? initialSelectedDeviceId
      : initialDevices[0]?.deviceId ?? null
  );
  const [selectedWindow, setSelectedWindow] = useState<MetricWindow>("1m");
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metrics, setMetrics] = useState<{
    status: DeviceSummary["status"];
    lastSeenAt: string | null;
    series: MetricSeries;
    enabledMetrics: DeviceMetricKey[];
    enabledDeviceIds?: Partial<Record<DeviceBlockKey, string[]>>;
    instanceMetricConfig?: Record<string, DeviceMetricKey[]>;
    availableMetrics: DeviceMetricOption[];
    device: {
      hostname: string;
      os: string;
      platform: string;
      cpuModel?: string;
    };
    latest: {
      cpuFrequencyMHz: number | null;
      cpuTemperatureC: number | null;
      cpuPackages: {
        id: string;
        name: string;
        model?: string;
        coreCount?: number;
        logicalCount?: number;
        frequencyMHz?: number | null;
        usagePercent?: number | null;
        temperatureC?: number | null;
      }[];
      memoryUsedBytes: number;
      memoryTotalBytes: number;
      swapUsedBytes: number;
      swapTotalBytes: number;
      diskUsedBytes: number;
      diskTotalBytes: number;
      disks: {
        id: string;
        name: string;
        mountPoint: string;
        filesystem?: string;
        model?: string;
        vendor?: string;
        sourceKey?: string;
        temperatureC?: number | null;
        totalBytes: number;
        usedBytes: number;
      }[];
      networkInterfaces: {
        id: string;
        name: string;
        macAddress?: string;
        ipv4?: string[];
        ipv6?: string[];
        rxBytesPerSec?: number;
        txBytesPerSec?: number;
        totalRxBytes?: number;
        totalTxBytes?: number;
      }[];
      gpus: {
        id: string;
        name: string;
        utilizationPercent: number;
        encodeUtilizationPercent?: number | null;
        decodeUtilizationPercent?: number | null;
        frequencyMHz?: number | null;
        memoryUsedBytes: number;
        memoryTotalBytes: number;
        temperatureC?: number | null;
      }[];
      sensorBackends: {
        id: string;
        label: string;
        ok: boolean;
        detail?: string;
      }[];
      fans: {
        id: string;
        label: string;
        interface: string;
        rpm: number;
        note?: string;
      }[];
    };
  } | null>(null);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [metricConfig, setMetricConfig] = useState<{
    deviceId: string;
    availableMetrics: DeviceMetricOption[];
    enabledMetrics: DeviceMetricKey[];
    enabledDeviceIds?: Partial<Record<DeviceBlockKey, string[]>>;
    instanceMetricConfig?: Record<string, DeviceMetricKey[]>;
  } | null>(null);
  const [metricConfigDraft, setMetricConfigDraft] = useState<DeviceMetricKey[]>([]);
  const [enabledDeviceIdsDraft, setEnabledDeviceIdsDraft] = useState<Partial<Record<DeviceBlockKey, string[]>>>({});
  const [instanceMetricConfigDraft, setInstanceMetricConfigDraft] = useState<Record<string, DeviceMetricKey[]>>({});
  const [savingMetricConfig, setSavingMetricConfig] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [editingBlockKey, setEditingBlockKey] = useState<BlockKey | null>(null);
  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
  const [pendingBlockKey, setPendingBlockKey] = useState<BlockKey | null>(null);
  const [detailModal, setDetailModal] = useState<
    | {
        title: string;
        subtitle?: string;
        rows: Array<{ label: string; value: string }>;
      }
    | null
  >(null);
  const [blockSheet, setBlockSheet] = useState<{ blockKey: BlockKey; tabId: string } | null>(null);

  useEffect(() => {
    if (!selectedDeviceId) return;
    setMetricsLoading(true);
    void getMetrics(selectedDeviceId, selectedWindow)
      .then((next) => {
        setMetrics(next);
        setMetricConfig({
          deviceId: selectedDeviceId,
          availableMetrics: next.availableMetrics,
          enabledMetrics: next.enabledMetrics,
          enabledDeviceIds: next.enabledDeviceIds ?? {},
          instanceMetricConfig: next.instanceMetricConfig ?? {}
        });
      })
      .catch(() => undefined)
      .finally(() => setMetricsLoading(false));
  }, [selectedDeviceId, selectedWindow]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = globalThis.setTimeout(() => setToastMessage(null), 2200);
    return () => globalThis.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    if (!devices.length) {
      if (selectedDeviceId !== null) setSelectedDeviceId(null);
      return;
    }

    if (!selectedDeviceId || !devices.some((device) => device.deviceId === selectedDeviceId)) {
      setSelectedDeviceId(devices[0]?.deviceId ?? null);
    }
  }, [devices, selectedDeviceId]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    router.replace(`/devices/${encodeURIComponent(selectedDeviceId)}` as never);
  }, [router, selectedDeviceId]);

  useEffect(() => {
    if (!pendingBlockKey || metricsLoading || !metrics) return;
    openBlockSheet(pendingBlockKey);
    setPendingBlockKey(null);
  }, [pendingBlockKey, metricsLoading, metrics]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    const socket: Socket = io(typeof window === "undefined" ? getServerUrl() : undefined, {
      path: "/socket.io",
      transports: ["websocket"],
      withCredentials: true
    });

    socket.on("device:update", (event: DeviceRealtimeEvent) => {
      setDevices((current) =>
        current.map((device) => (device.deviceId === event.deviceId ? event.summary : device))
      );

      if (event.deviceId !== selectedDeviceId || selectedWindow !== "1m") return;

      void getMetrics(selectedDeviceId, selectedWindow).then(setMetrics).catch(() => undefined);
    });

    return () => {
      socket.close();
    };
  }, [selectedDeviceId, selectedWindow]);

  async function refreshDevices() {
    const next = await listDevices();
    setDevices(next);
    if (!selectedDeviceId && next[0]) setSelectedDeviceId(next[0].deviceId);
  }

  async function handleLogout() {
    await logout();
    globalThis.location.reload();
  }

  function jumpToBlock(blockKey: BlockKey) {
    if (typeof document === "undefined") return;
    document.getElementById(`block-${blockKey}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openBlockSheet(blockKey: BlockKey, tabId = "total") {
    setBlockSheet({ blockKey, tabId });
  }

  function handleSelectDeviceBlock(deviceId: string, blockKey: BlockKey) {
    setSelectedDeviceId(deviceId);
    setPendingBlockKey(blockKey);
  }

  async function openDeviceEditor(deviceId: string) {
    const config = await getDeviceMetricConfig(deviceId);
    setMetricConfig(config);
    setMetricConfigDraft(config.enabledMetrics);
    setEnabledDeviceIdsDraft(config.enabledDeviceIds ?? {});
    setInstanceMetricConfigDraft(config.instanceMetricConfig ?? {});
    setEditingDeviceId(deviceId);
    setEditingBlockKey(null);
    setEditingInstanceId(null);
  }

  async function openBlockEditor(deviceId: string, blockKey: BlockKey) {
    const config = await getDeviceMetricConfig(deviceId);
    setMetricConfig(config);
    setMetricConfigDraft(config.enabledMetrics);
    setEnabledDeviceIdsDraft(config.enabledDeviceIds ?? {});
    setInstanceMetricConfigDraft(config.instanceMetricConfig ?? {});
    setEditingDeviceId(deviceId);
    setEditingBlockKey(blockKey);
    setEditingInstanceId(null);
  }

  async function openInstanceEditor(deviceId: string, blockKey: BlockKey, instanceId: string) {
    const config = await getDeviceMetricConfig(deviceId);
    setMetricConfig(config);
    setMetricConfigDraft(config.enabledMetrics);
    setEnabledDeviceIdsDraft(config.enabledDeviceIds ?? {});
    setInstanceMetricConfigDraft(config.instanceMetricConfig ?? {});
    setEditingDeviceId(deviceId);
    setEditingBlockKey(blockKey);
    setEditingInstanceId(instanceId);
  }

  function toggleMetric(metricKey: DeviceMetricKey) {
    setMetricConfigDraft((current) => {
      const enabled = new Set(current);
      if (enabled.has(metricKey)) enabled.delete(metricKey);
      else enabled.add(metricKey);
      return [...enabled];
    });
  }

  function toggleBlock(blockKey: BlockKey) {
    if (blockKey === "fan") return;
    setMetricConfigDraft((current) => {
      const enabled = new Set(current);
      const blockMetrics = BLOCK_METRICS[blockKey];
      const fullyEnabled = blockMetrics.every((metricKey) => enabled.has(metricKey));
      for (const metricKey of blockMetrics) {
        if (fullyEnabled) enabled.delete(metricKey);
        else enabled.add(metricKey);
      }
      return [...enabled];
    });
  }

  function toggleDeviceInstance(blockKey: BlockKey, instanceId: string) {
    setEnabledDeviceIdsDraft((current) => {
      const next = { ...current };
      const enabled = new Set(next[blockKey] ?? getBlockInstanceIds(blockKey));
      if (enabled.has(instanceId)) enabled.delete(instanceId);
      else enabled.add(instanceId);
      next[blockKey] = [...enabled];
      return next;
    });
  }

  function toggleInstanceMetric(instanceId: string, metricKey: DeviceMetricKey) {
    setInstanceMetricConfigDraft((current) => {
      const enabled = new Set(current[instanceId] ?? BLOCK_METRICS[editingBlockKey ?? "cpu"]);
      if (enabled.has(metricKey)) enabled.delete(metricKey);
      else enabled.add(metricKey);
      return {
        ...current,
        [instanceId]: [...enabled]
      };
    });
  }

  async function saveMetricConfig() {
    if (!editingDeviceId || !metricConfig) return;
    setSavingMetricConfig(true);
    try {
      const saved = await saveDeviceMetricConfig(editingDeviceId, {
        enabledMetrics: metricConfigDraft,
        enabledDeviceIds: enabledDeviceIdsDraft,
        instanceMetricConfig: instanceMetricConfigDraft
      });
      setMetricConfig(saved);
      setMetricConfigDraft(saved.enabledMetrics);
      setEnabledDeviceIdsDraft(saved.enabledDeviceIds ?? {});
      setInstanceMetricConfigDraft(saved.instanceMetricConfig ?? {});
      setMetrics((current) =>
        current && selectedDeviceId === editingDeviceId
          ? {
              ...current,
              enabledMetrics: saved.enabledMetrics,
              enabledDeviceIds: saved.enabledDeviceIds ?? {},
              instanceMetricConfig: saved.instanceMetricConfig ?? {},
              availableMetrics: saved.availableMetrics
            }
          : current
      );
      setEditingDeviceId(null);
      setEditingInstanceId(null);
      setToastMessage("记录项已保存");
      if (selectedDeviceId === editingDeviceId) {
        void getMetrics(editingDeviceId, selectedWindow)
          .then((refreshedMetrics) => {
            setMetrics(refreshedMetrics);
            setMetricConfig({
              deviceId: editingDeviceId,
              availableMetrics: refreshedMetrics.availableMetrics,
              enabledMetrics: refreshedMetrics.enabledMetrics,
              enabledDeviceIds: refreshedMetrics.enabledDeviceIds ?? {},
              instanceMetricConfig: refreshedMetrics.instanceMetricConfig ?? {}
            });
          })
          .catch(() => undefined);
      }
    } catch {
      setToastMessage("记录项保存失败");
    } finally {
      setSavingMetricConfig(false);
    }
  }

  const enabledMetricSet = new Set(metrics?.enabledMetrics ?? DEFAULT_ENABLED_METRICS);
  const availableMetricSet = new Set(
    (metrics?.availableMetrics ?? [])
      .filter((item) => item.available)
      .map((item) => item.key)
  );
  const showMetric = (metricKey: DeviceMetricKey) =>
    enabledMetricSet.has(metricKey) && (availableMetricSet.size === 0 || availableMetricSet.has(metricKey));
  const showBlock = (blockKey: BlockKey) => {
    if (blockKey === "fan") {
      return Boolean(metrics?.latest.fans.length || metrics?.latest.sensorBackends.length);
    }
    return BLOCK_METRICS[blockKey].some((metricKey) => showMetric(metricKey));
  };
  const editableMetrics: DeviceMetricKey[] | null = editingBlockKey ? [...BLOCK_METRICS[editingBlockKey]] : null;
  const getBlockInstanceIds = (blockKey: BlockKey) => {
    if (!metrics) return [];
    if (blockKey === "cpu") return metrics.latest.cpuPackages.map((item) => item.id);
    if (blockKey === "gpu") return metrics.latest.gpus.map((item) => item.id);
    if (blockKey === "disk") return metrics.latest.disks.map((item) => item.id);
    if (blockKey === "network") return metrics.latest.networkInterfaces.map((item) => item.id);
    return [];
  };
  const isInstanceVisible = (blockKey: BlockKey, instanceId: string) => {
    const enabledIds = metrics?.enabledDeviceIds?.[blockKey];
    if (!enabledIds || enabledIds.length === 0) return true;
    return enabledIds.includes(instanceId);
  };
  const isMetricVisibleForInstance = (blockKey: BlockKey, instanceId: string, metricKey: DeviceMetricKey) => {
    if (!showMetric(metricKey)) return false;
    const enabledMetrics = metrics?.instanceMetricConfig?.[instanceId];
    if (!enabledMetrics || enabledMetrics.length === 0) {
      return (BLOCK_METRICS[blockKey] as readonly DeviceMetricKey[]).includes(metricKey);
    }
    return enabledMetrics.includes(metricKey);
  };
  const getInstanceMetricDraft = (instanceId: string) =>
    new Set(instanceMetricConfigDraft[instanceId] ?? (editingBlockKey ? BLOCK_METRICS[editingBlockKey] : DEFAULT_ENABLED_METRICS));
  const getBlockInstanceOptions = (blockKey: BlockKey) => {
    if (!metrics) return [];
    if (blockKey === "cpu") {
      return metrics.latest.cpuPackages.map((item) => ({
        id: item.id,
        title: item.name,
        subtitle: `${item.logicalCount ?? 0} 线程`
      }));
    }
    if (blockKey === "gpu") {
      return metrics.latest.gpus.map((item) => ({ id: item.id, title: item.name, subtitle: item.id }));
    }
    if (blockKey === "disk") {
      return metrics.latest.disks.map((item) => ({ id: item.id, title: item.name, subtitle: item.mountPoint }));
    }
    if (blockKey === "network") {
      return metrics.latest.networkInterfaces.map((item) => ({
        id: item.id,
        title: item.name,
        subtitle: item.ipv4?.[0] || item.macAddress || item.id
      }));
    }
    if (blockKey === "fan") {
      return metrics.latest.fans.map((item) => ({
        id: item.id,
        title: item.label,
        subtitle: `${item.interface} · ${item.rpm} RPM`
      }));
    }
    return [];
  };
  const totalGpuMemoryUsedBytes = metrics?.latest.gpus.reduce((sum, gpu) => sum + gpu.memoryUsedBytes, 0) ?? 0;
  const totalGpuMemoryBytes = metrics?.latest.gpus.reduce((sum, gpu) => sum + gpu.memoryTotalBytes, 0) ?? 0;
  const summaryCapsules = metrics
    ? buildSummaryCapsules(metrics, selectedWindow, totalGpuMemoryUsedBytes, totalGpuMemoryBytes, showBlock)
    : [];
  const blockSheetTabs = blockSheet && metrics
    ? buildBlockSheetTabs({
        metrics,
        blockKey: blockSheet.blockKey,
        selectedWindow,
        showMetric,
        isInstanceVisible,
        isMetricVisibleForInstance,
        totalGpuMemoryUsedBytes,
        totalGpuMemoryBytes
      })
    : [];
  const activeBlockSheetTabId =
    blockSheetTabs.find((tab) => tab.id === blockSheet?.tabId)?.id ?? blockSheetTabs[0]?.id ?? null;
  const legacyMetrics = metrics as NonNullable<typeof metrics>;
  const legacySelectedDeviceId = selectedDeviceId ?? "";

  return (
    <main className={styles.shell}>
      <DeviceSidebar
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelect={setSelectedDeviceId}
        onSelectBlock={handleSelectDeviceBlock}
        onEdit={(deviceId) => void openDeviceEditor(deviceId)}
      />
      <section className={styles.mainPanel}>
        {!selectedDeviceId || !metrics ? (
          <div className={styles.emptyState}>
            <p>暂无设备数据。启动节点代理后会在这里出现。</p>
            <button className={styles.primaryButton} onClick={() => void refreshDevices()}>
              刷新设备
            </button>
          </div>
        ) : (
          <>
            <div className={styles.hero}>
              <div>
                <p className={styles.eyebrow}>{selectedDeviceId ?? metrics.device.hostname}</p>
                <h1>{metrics.device.hostname}</h1>
                <p className={styles.meta}>
                  {metrics.device.os} · {metrics.device.platform} · {metrics.status === "online" ? "在线" : "离线"}
                </p>
              </div>
              <button className={styles.ghostButton} onClick={() => void handleLogout()}>
                退出登录
              </button>
            </div>

            <div className={styles.toolbar} role="tablist" aria-label="时间范围">
              {DEFAULT_WINDOWS.map((item) => (
                <button
                  key={item}
                  className={`${styles.tab} ${selectedWindow === item ? styles.tabActive : ""}`}
                  onClick={() => setSelectedWindow(item)}
                >
                  {WINDOW_LABELS[item]}
                </button>
              ))}
            </div>
            <p className={styles.windowHint}>{WINDOW_DESCRIPTIONS[selectedWindow]}</p>

            <div className={styles.blockNav}>
              {summaryCapsules.map((capsule) => (
                <button key={capsule.blockKey} className={styles.blockNavItem} onClick={() => openBlockSheet(capsule.blockKey)} type="button">
                  <strong>{capsule.title}</strong>
                  <span>{capsule.description}</span>
                </button>
              ))}
            </div>

            <div className={styles.summaryCapsuleGrid}>
              {summaryCapsules.map((capsule) => (
                <button
                  key={capsule.blockKey}
                  className={styles.summaryCapsule}
                  onClick={() => openBlockSheet(capsule.blockKey)}
                  type="button"
                >
                  <div className={styles.summaryCapsuleHeader}>
                    <strong>{capsule.title}</strong>
                    <span>{capsule.description}</span>
                  </div>
                  <div className={styles.summaryCapsuleMetrics}>
                    {capsule.items.map((item) => (
                      <div key={`${capsule.blockKey}-${item.label}`} className={styles.summaryMetricItem}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>

            {metricsLoading ? (
              <div className={styles.loadingState}>
                <span className={styles.loadingSpinner} />
                <strong>加载图表中</strong>
              </div>
            ) : null}

            {false ? (() => { const metrics = legacyMetrics; const selectedDeviceId = legacySelectedDeviceId; return <div className={styles.groupStack}>
              {showBlock("cpu") ? (
                <section className={styles.metricGroup} id="block-cpu">
                  <div className={styles.metricGroupHeader}>
                    <div>
                      <strong>CPU</strong>
                      <p className={styles.subtle}>{metrics.device.cpuModel ?? "处理器概览"}</p>
                      {!availableMetricSet.has("cpuTemperature") ? (
                        <p className={styles.subtle}>当前设备未提供 CPU 温度传感器，虚拟机环境下较常见。</p>
                      ) : null}
                    </div>
                    <button
                      className={styles.inlineAction}
                      onClick={() => void openBlockEditor(selectedDeviceId, "cpu")}
                      type="button"
                    >
                      编辑
                    </button>
                  </div>
                  <div className={styles.metricSubGrid}>
                    {metrics.series.cpus
                      .filter((cpuSeries) => metrics.latest.cpuPackages.some((item) => item.id === cpuSeries.id))
                      .filter((cpuSeries) => isInstanceVisible("cpu", cpuSeries.id))
                      .map((cpuSeries) => {
                        const cpuPackage = metrics.latest.cpuPackages.find((item) => item.id === cpuSeries.id);
                        return (
                          <div key={cpuSeries.id} className={styles.metricSubBlock}>
                            <div className={styles.metricSubHeader}>
                              <strong>{cpuSeries.name}</strong>
                              <div className={styles.subHeaderActions}>
                                <button
                                  className={styles.inlineAction}
                                  onClick={() => void openInstanceEditor(selectedDeviceId, "cpu", cpuSeries.id)}
                                  type="button"
                                >
                                  编辑
                                </button>
                                <button
                                  className={styles.inlineAction}
                                  onClick={() =>
                                    setDetailModal({
                                      title: cpuSeries.name,
                                      subtitle: cpuSeries.model ?? cpuPackage?.model ?? metrics.device.cpuModel ?? metrics.device.hostname,
                                      rows: [
                                        { label: "CPU 占用", value: `${(cpuSeries.usagePercent.at(-1)?.value ?? 0).toFixed(1)}%` },
                                        {
                                          label: "CPU 频率",
                                          value: `${(cpuSeries.frequencyMHz.at(-1)?.value ?? cpuPackage?.frequencyMHz ?? 0).toFixed(0)} MHz`
                                        },
                                        {
                                          label: "CPU 温度",
                                          value:
                                            cpuSeries.temperatureC.at(-1)?.value != null
                                              ? `${(cpuSeries.temperatureC.at(-1)?.value ?? 0).toFixed(1)} °C`
                                              : "--"
                                        },
                                        { label: "核心 / 线程", value: `${cpuSeries.coreCount ?? "--"} / ${cpuSeries.logicalCount ?? "--"}` }
                                      ]
                                    })
                                  }
                                  type="button"
                                >
                                  详情
                                </button>
                              </div>
                            </div>
                            <div className={styles.metricCardGrid}>
                              {isMetricVisibleForInstance("cpu", cpuSeries.id, "cpuUsage") ? (
                                <ChartCard
                                  chartId={`cpu-usage-${cpuSeries.id}`}
                                  title="CPU 占用"
                                  value={(cpuSeries.usagePercent.at(-1)?.value ?? 0).toFixed(1)}
                                  unit="%"
                                  color="#3384ff"
                                  points={cpuSeries.usagePercent}
                                />
                              ) : null}
                              {isMetricVisibleForInstance("cpu", cpuSeries.id, "cpuFrequency") ? (
                                <ChartCard
                                  chartId={`cpu-frequency-${cpuSeries.id}`}
                                  title="CPU 频率"
                                  value={(cpuSeries.frequencyMHz.at(-1)?.value ?? 0).toFixed(0)}
                                  unit="MHz"
                                  color="#6b82ff"
                                  points={cpuSeries.frequencyMHz}
                                />
                              ) : null}
                              {isMetricVisibleForInstance("cpu", cpuSeries.id, "cpuTemperature") ? (
                                <ChartCard
                                  chartId={`cpu-temperature-${cpuSeries.id}`}
                                  title="CPU 温度"
                                  value={(cpuSeries.temperatureC.at(-1)?.value ?? 0).toFixed(1)}
                                  unit="°C"
                                  color="#ff7f3f"
                                  points={cpuSeries.temperatureC}
                                />
                              ) : null}
                            </div>
                            <div className={styles.metricMiniGrid}>
                              <MetricMiniCard label="型号" value={cpuSeries.model || cpuPackage?.model || metrics.device.cpuModel || "未知"} />
                              <MetricMiniCard label="核心 / 线程" value={`${cpuSeries.coreCount ?? "--"} / ${cpuSeries.logicalCount ?? "--"}`} />
                              <MetricMiniCard
                                label="频率"
                                value={cpuPackage?.frequencyMHz != null ? `${cpuPackage.frequencyMHz.toFixed(0)} MHz` : "--"}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </section>
              ) : null}

              {showBlock("memory") ? (
                <section className={styles.metricGroup} id="block-memory">
                  <div className={styles.metricGroupHeader}>
                    <div>
                      <strong>内存</strong>
                      <p className={styles.subtle}>系统内存与虚拟内存</p>
                    </div>
                    <button
                      className={styles.inlineAction}
                      onClick={() => void openBlockEditor(selectedDeviceId, "memory")}
                      type="button"
                    >
                      编辑
                    </button>
                  </div>
                  <div className={styles.metricSubGrid}>
                    <div className={styles.metricSubBlock}>
                      <div className={styles.metricSubHeader}>
                        <strong>内存资源</strong>
                        <div className={styles.subHeaderActions}>
                          <button
                            className={styles.inlineAction}
                            onClick={() => void openBlockEditor(selectedDeviceId, "memory")}
                            type="button"
                          >
                            编辑
                          </button>
                          <button
                            className={styles.inlineAction}
                            onClick={() =>
                              setDetailModal({
                                title: "内存资源",
                                rows: [
                                  { label: "物理内存", value: buildUsageDetail(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes) },
                                  { label: "虚拟内存", value: buildUsageDetail(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes) }
                                ]
                              })
                            }
                            type="button"
                          >
                            详情
                          </button>
                        </div>
                      </div>
                      <div className={styles.metricCardGrid}>
                        {showMetric("memoryUsage") ? (
                          <ChartCard
                            chartId="memory-usage"
                            title="内存"
                            value={(metrics.series.memoryUsagePercent.at(-1)?.value ?? 0).toFixed(1)}
                            unit="%"
                            color="#c13484"
                            points={metrics.series.memoryUsagePercent}
                            detail={buildUsageDetail(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes)}
                          />
                        ) : null}
                        {showMetric("swapUsage") ? (
                          <ChartCard
                            chartId="swap-usage"
                            title="虚拟内存"
                            value={(metrics.series.swapUsagePercent.at(-1)?.value ?? 0).toFixed(1)}
                            unit="%"
                            color="#ca7c20"
                            points={metrics.series.swapUsagePercent}
                            detail={buildUsageDetail(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes)}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {showBlock("disk") ? (
                <section className={styles.metricGroup} id="block-disk">
                  <div className={styles.metricGroupHeader}>
                    <div>
                      <strong>磁盘</strong>
                      <p className={styles.subtle}>{metrics.latest.disks.length} 块磁盘 / 分区</p>
                    </div>
                    <button
                      className={styles.inlineAction}
                      onClick={() => void openBlockEditor(selectedDeviceId, "disk")}
                      type="button"
                    >
                      编辑
                    </button>
                  </div>
                  <div className={styles.metricSubGrid}>
                    {metrics.series.disks
                      .filter((diskSeries) => metrics.latest.disks.some((item) => item.id === diskSeries.id))
                      .filter((diskSeries) => isInstanceVisible("disk", diskSeries.id))
                      .map((diskSeries) => {
                      const disk = metrics.latest.disks.find((item) => item.id === diskSeries.id);
                      return (
                      <div key={diskSeries.id} className={styles.metricSubBlock}>
                        <div className={styles.metricSubHeader}>
                          <div>
                            <strong>{diskSeries.name}</strong>
                            <p className={styles.subtle}>{diskSeries.mountPoint}</p>
                          </div>
                          <div className={styles.subHeaderActions}>
                            <button
                              className={styles.inlineAction}
                              onClick={() => void openInstanceEditor(selectedDeviceId, "disk", diskSeries.id)}
                              type="button"
                            >
                              编辑
                            </button>
                            <button
                              className={styles.inlineAction}
                              onClick={() =>
                                setDetailModal({
                                  title: diskSeries.name,
                                  subtitle: diskSeries.mountPoint,
                                  rows: [
                                    { label: "文件系统", value: diskSeries.filesystem || "未知" },
                                    {
                                      label: "容量",
                                      value: disk ? buildUsageDetail(disk.usedBytes, disk.totalBytes) : "无数据"
                                    },
                                    {
                                      label: "占用率",
                                      value: disk ? formatPercent(disk.usedBytes, disk.totalBytes) : "--"
                                    },
                                    {
                                      label: "温度",
                                      value: disk?.temperatureC != null ? `${disk.temperatureC.toFixed(1)} °C` : "--"
                                    },
                                    {
                                      label: "设备信息",
                                      value: [diskSeries.vendor, diskSeries.model].filter(Boolean).join(" ") || "未读取到型号"
                                    }
                                  ]
                                })
                              }
                              type="button"
                            >
                              详情
                            </button>
                          </div>
                        </div>
                        <div className={styles.metricCardGrid}>
                          {isMetricVisibleForInstance("disk", diskSeries.id, "diskUsage") ? (
                            <ChartCard
                              chartId={`disk-usage-${diskSeries.id}`}
                              title="磁盘占用"
                              value={disk ? buildUsageDetail(disk.usedBytes, disk.totalBytes) : "无数据"}
                              color="#d37d19"
                              points={diskSeries.usagePercent}
                              detail={disk ? formatPercent(disk.usedBytes, disk.totalBytes) : "无数据"}
                            />
                          ) : null}
                          {isMetricVisibleForInstance("disk", diskSeries.id, "diskRead") ? (
                            <ChartCard
                              chartId={`disk-read-${diskSeries.id}`}
                              title="磁盘读取"
                              value={formatBytes(diskSeries.readBytesPerSec.at(-1)?.value ?? 0)}
                              unit="/s"
                              color="#c5852a"
                              points={diskSeries.readBytesPerSec}
                            />
                          ) : null}
                          {isMetricVisibleForInstance("disk", diskSeries.id, "diskWrite") ? (
                            <ChartCard
                              chartId={`disk-write-${diskSeries.id}`}
                              title="磁盘写入"
                              value={formatBytes(diskSeries.writeBytesPerSec.at(-1)?.value ?? 0)}
                              unit="/s"
                              color="#ef9a34"
                              points={diskSeries.writeBytesPerSec}
                            />
                          ) : null}
                        </div>
                        <div className={styles.metricMiniGrid}>
                          <MetricMiniCard label="挂载位置" value={diskSeries.mountPoint} />
                          <MetricMiniCard label="文件系统" value={diskSeries.filesystem || "未知"} />
                          <MetricMiniCard label="容量" value={disk ? buildUsageDetail(disk.usedBytes, disk.totalBytes) : "无数据"} />
                          <MetricMiniCard label="温度" value={disk?.temperatureC != null ? `${disk.temperatureC.toFixed(1)} °C` : "--"} />
                          <MetricMiniCard
                            label="设备信息"
                            value={[diskSeries.vendor, diskSeries.model].filter(Boolean).join(" ") || "未读取到型号"}
                          />
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {showBlock("network") ? (
                <section className={styles.metricGroup} id="block-network">
                  <div className={styles.metricGroupHeader}>
                    <div>
                      <strong>网络</strong>
                      <p className={styles.subtle}>{metrics.latest.networkInterfaces.length} 个网络接口</p>
                    </div>
                    <button
                      className={styles.inlineAction}
                      onClick={() => void openBlockEditor(selectedDeviceId, "network")}
                      type="button"
                    >
                      编辑
                    </button>
                  </div>
                  <div className={styles.metricSubGrid}>
                    {metrics.series.networks
                      .filter((networkSeries) => metrics.latest.networkInterfaces.some((item) => item.id === networkSeries.id))
                      .filter((networkSeries) => isInstanceVisible("network", networkSeries.id))
                      .map((networkSeries) => {
                        const networkInterface = metrics.latest.networkInterfaces.find((item) => item.id === networkSeries.id);
                        return (
                          <div key={networkSeries.id} className={styles.metricSubBlock}>
                            <div className={styles.metricSubHeader}>
                              <div>
                                <strong>{networkSeries.name}</strong>
                                <p className={styles.subtle}>{networkSeries.ipv4?.[0] || networkSeries.macAddress || networkSeries.id}</p>
                              </div>
                              <div className={styles.subHeaderActions}>
                                <button
                                  className={styles.inlineAction}
                                  onClick={() => void openInstanceEditor(selectedDeviceId, "network", networkSeries.id)}
                                  type="button"
                                >
                                  编辑
                                </button>
                                <button
                                  className={styles.inlineAction}
                                  onClick={() =>
                                    setDetailModal({
                                      title: networkSeries.name,
                                      subtitle: networkSeries.macAddress || networkSeries.id,
                                      rows: [
                                        { label: "IPv4", value: networkSeries.ipv4?.join(", ") || "无" },
                                        { label: "IPv6", value: networkSeries.ipv6?.join(", ") || "无" },
                                        { label: "接收速率", value: `${formatBytes(networkSeries.rxBytesPerSec.at(-1)?.value ?? 0)}/s` },
                                        { label: "发送速率", value: `${formatBytes(networkSeries.txBytesPerSec.at(-1)?.value ?? 0)}/s` },
                                        {
                                          label: "区间流量",
                                          value: `${formatBytes(networkSeries.trafficRxBytes.at(-1)?.value ?? 0)} / ${formatBytes(networkSeries.trafficTxBytes.at(-1)?.value ?? 0)}`
                                        }
                                      ]
                                    })
                                  }
                                  type="button"
                                >
                                  详情
                                </button>
                              </div>
                            </div>
                            <div className={styles.metricCardGrid}>
                              {isMetricVisibleForInstance("network", networkSeries.id, "networkRxRate") ? (
                                <ChartCard
                                  chartId={`network-rx-${networkSeries.id}`}
                                  title="网络接收"
                                  value={formatBytes(networkSeries.rxBytesPerSec.at(-1)?.value ?? networkInterface?.rxBytesPerSec ?? 0)}
                                  unit="/s"
                                  color="#3cb8bf"
                                  points={networkSeries.rxBytesPerSec}
                                />
                              ) : null}
                              {isMetricVisibleForInstance("network", networkSeries.id, "networkTxRate") ? (
                                <ChartCard
                                  chartId={`network-tx-${networkSeries.id}`}
                                  title="网络发送"
                                  value={formatBytes(networkSeries.txBytesPerSec.at(-1)?.value ?? networkInterface?.txBytesPerSec ?? 0)}
                                  unit="/s"
                                  color="#2aa7af"
                                  points={networkSeries.txBytesPerSec}
                                />
                              ) : null}
                            </div>
                            <div className={styles.metricMiniGrid}>
                              <MetricMiniCard label="MAC" value={networkSeries.macAddress || "未知"} />
                              <MetricMiniCard label="IPv4" value={networkSeries.ipv4?.join(", ") || "无"} />
                              <MetricMiniCard label="IPv6" value={networkSeries.ipv6?.join(", ") || "无"} />
                              <MetricMiniCard
                                label="区间流量"
                                value={`${formatBytes(networkSeries.trafficRxBytes.at(-1)?.value ?? 0)} / ${formatBytes(networkSeries.trafficTxBytes.at(-1)?.value ?? 0)}`}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </section>
              ) : null}

              {showBlock("gpu") ? (
                <section className={styles.metricGroup} id="block-gpu">
                  <div className={styles.metricGroupHeader}>
                    <div>
                      <strong>显卡</strong>
                      <p className={styles.subtle}>
                        {metrics.latest.gpus.length} 张显卡 / 适配器 · 总显存 {formatUsageOrUnknown(totalGpuMemoryUsedBytes, totalGpuMemoryBytes)}
                      </p>
                    </div>
                    <button
                      className={styles.inlineAction}
                      onClick={() => void openBlockEditor(selectedDeviceId, "gpu")}
                      type="button"
                    >
                      编辑
                    </button>
                  </div>
                  <div className={styles.metricSubGrid}>
                    {metrics.series.gpus
                      .filter((gpuSeries) => metrics.latest.gpus.some((item) => item.id === gpuSeries.id))
                      .filter((gpuSeries) => isInstanceVisible("gpu", gpuSeries.id))
                      .map((gpuSeries) => {
                      const gpu = metrics.latest.gpus.find((item) => item.id === gpuSeries.id);
                      return (
                      <div key={gpuSeries.id} className={styles.metricSubBlock}>
                        <div className={styles.metricSubHeader}>
                          <strong>{gpuSeries.name}</strong>
                          <div className={styles.subHeaderActions}>
                            <button
                              className={styles.inlineAction}
                              onClick={() => void openInstanceEditor(selectedDeviceId, "gpu", gpuSeries.id)}
                              type="button"
                            >
                              编辑
                            </button>
                            <button
                              className={styles.inlineAction}
                              onClick={() =>
                                setDetailModal({
                                  title: gpuSeries.name,
                                  rows: [
                                    { label: "占用", value: `${(gpuSeries.usagePercent.at(-1)?.value ?? 0).toFixed(1)}%` },
                                    { label: "编码", value: `${(gpuSeries.encodePercent.at(-1)?.value ?? 0).toFixed(1)}%` },
                                    { label: "解码", value: `${(gpuSeries.decodePercent.at(-1)?.value ?? 0).toFixed(1)}%` },
                                    { label: "显存", value: gpu ? formatUsageOrUnknown(gpu.memoryUsedBytes, gpu.memoryTotalBytes) : "无数据" },
                                    {
                                      label: "温度",
                                      value: gpu?.temperatureC != null ? `${gpu.temperatureC.toFixed(1)} °C` : "--"
                                    },
                                    { label: "频率", value: gpu?.frequencyMHz != null ? `${gpu.frequencyMHz.toFixed(0)} MHz` : "--" }
                                  ]
                                })
                              }
                              type="button"
                            >
                              详情
                            </button>
                          </div>
                        </div>
                        <div className={styles.metricCardGrid}>
                          {isMetricVisibleForInstance("gpu", gpuSeries.id, "gpuUsage") ? (
                            <ChartCard
                              chartId={`gpu-usage-${gpuSeries.id}`}
                              title="GPU 占用"
                              value={(gpuSeries.usagePercent.at(-1)?.value ?? 0).toFixed(1)}
                              unit="%"
                              color="#5ba832"
                              points={gpuSeries.usagePercent}
                            />
                          ) : null}
                          {isMetricVisibleForInstance("gpu", gpuSeries.id, "gpuEncode") ? (
                            <ChartCard
                              chartId={`gpu-encode-${gpuSeries.id}`}
                              title="GPU 编码"
                              value={(gpuSeries.encodePercent.at(-1)?.value ?? 0).toFixed(1)}
                              unit="%"
                              color="#4ba86b"
                              points={gpuSeries.encodePercent}
                            />
                          ) : null}
                          {isMetricVisibleForInstance("gpu", gpuSeries.id, "gpuDecode") ? (
                            <ChartCard
                              chartId={`gpu-decode-${gpuSeries.id}`}
                              title="GPU 解码"
                              value={(gpuSeries.decodePercent.at(-1)?.value ?? 0).toFixed(1)}
                              unit="%"
                              color="#69bca1"
                              points={gpuSeries.decodePercent}
                            />
                          ) : null}
                          {isMetricVisibleForInstance("gpu", gpuSeries.id, "gpuFrequency") ? (
                            <ChartCard
                              chartId={`gpu-frequency-${gpuSeries.id}`}
                              title="GPU 频率"
                              value={(gpuSeries.frequencyMHz.at(-1)?.value ?? 0).toFixed(0)}
                              unit="MHz"
                              color="#4a9790"
                              points={gpuSeries.frequencyMHz}
                            />
                          ) : null}
                          {isMetricVisibleForInstance("gpu", gpuSeries.id, "gpuMemory") ? (
                            <ChartCard
                              chartId={`gpu-memory-${gpuSeries.id}`}
                              title="GPU 显存"
                              value={gpu ? formatUsageOrUnknown(gpu.memoryUsedBytes, gpu.memoryTotalBytes) : "无数据"}
                              color="#3f9f88"
                              points={gpuSeries.memoryUsagePercent}
                              detail={gpu ? formatPercent(gpu.memoryUsedBytes, gpu.memoryTotalBytes) : "无数据"}
                            />
                          ) : null}
                          {isMetricVisibleForInstance("gpu", gpuSeries.id, "gpuTemperature") ? (
                            <ChartCard
                              chartId={`gpu-temperature-${gpuSeries.id}`}
                              title="GPU 温度"
                              value={(gpuSeries.temperatureC.at(-1)?.value ?? 0).toFixed(1)}
                              unit="°C"
                              color="#8cbc44"
                              points={gpuSeries.temperatureC}
                            />
                          ) : null}
                        </div>
                        <div className={styles.metricMiniGrid}>
                          <MetricMiniCard label="占用" value={`${(gpuSeries.usagePercent.at(-1)?.value ?? 0).toFixed(1)}%`} />
                          <MetricMiniCard
                            label="显存"
                            value={gpu ? formatUsageOrUnknown(gpu.memoryUsedBytes, gpu.memoryTotalBytes) : "无数据"}
                          />
                          <MetricMiniCard
                            label="编解码"
                            value={`编 ${(gpuSeries.encodePercent.at(-1)?.value ?? 0).toFixed(1)}% / 解 ${(gpuSeries.decodePercent.at(-1)?.value ?? 0).toFixed(1)}%`}
                          />
                          <MetricMiniCard
                            label="温度 / 频率"
                            value={`${gpu?.temperatureC != null ? `${gpu.temperatureC.toFixed(1)} °C` : "--"} / ${gpu?.frequencyMHz != null ? `${gpu.frequencyMHz.toFixed(0)} MHz` : "--"}`}
                          />
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {showBlock("fan") ? (
                <section className={styles.metricGroup} id="block-fan">
                  <div className={styles.metricGroupHeader}>
                    <div>
                      <strong>风扇</strong>
                      <p className={styles.subtle}>{metrics.latest.fans.length ? `${metrics.latest.fans.length} 个风扇接口` : "未读取到风扇数据"}</p>
                    </div>
                    <button
                      className={styles.inlineAction}
                      onClick={() =>
                        setDetailModal({
                          title: "风扇概览",
                          rows: [
                            ...metrics.latest.fans.map((fan) => ({
                              label: fan.label,
                              value: `${fan.interface} · ${fan.rpm} RPM`
                            })),
                            ...metrics.latest.sensorBackends.map((backend) => ({
                              label: `后端 · ${backend.label}`,
                              value: `${backend.ok ? "可用" : "不可用"}${backend.detail ? ` · ${backend.detail}` : ""}`
                            }))
                          ]
                        })
                      }
                      type="button"
                    >
                      详情
                    </button>
                  </div>
                  <div className={styles.metricSubGrid}>
                    {metrics.latest.fans.map((fan) => {
                      const fanSeries = metrics.series.fans.find((item) => item.id === fan.id);
                      return (
                      <div key={fan.id} className={styles.metricSubBlock}>
                        <div className={styles.metricSubHeader}>
                          <strong>{fan.label}</strong>
                          <button
                            className={styles.inlineAction}
                            onClick={() =>
                              setDetailModal({
                                title: fan.label,
                                subtitle: fan.interface,
                                rows: [
                                  { label: "转速", value: `${fan.rpm} RPM` },
                                  { label: "备注", value: fan.note || "未备注" }
                                ]
                              })
                            }
                            type="button"
                          >
                            详情
                          </button>
                        </div>
                        {fanSeries ? (
                          <ChartCard
                            chartId={`fan-rpm-${fan.id}`}
                            title="风扇转速"
                            value={fan.rpm.toFixed(0)}
                            unit="RPM"
                            color="#c94b4b"
                            points={fanSeries.rpm}
                            detail={fan.interface}
                          />
                        ) : null}
                        <FanItem
                          deviceId={selectedDeviceId}
                          fan={fan}
                          onSaved={async () => {
                            if (!selectedDeviceId) return;
                            const next = await getMetrics(selectedDeviceId, selectedWindow);
                            setMetrics(next);
                          }}
                        />
                      </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>; })() : null}
            {showMetric("networkTraffic") && selectedDeviceId ? <TrafficCalendar deviceId={selectedDeviceId} /> : null}
          </>
        )}
      </section>
      {editingDeviceId && metricConfig ? (
        <div className={styles.modalBackdrop} onClick={() => setEditingDeviceId(null)} role="presentation">
          <section
            className={styles.modalCard}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="编辑设备记录项"
          >
            <div className={styles.modalHeader}>
              <div>
                <strong>记录项设置</strong>
                <p className={styles.subtle}>
                  {editingDeviceId}
                  {editingBlockKey ? ` · ${BLOCK_LABELS[editingBlockKey]}` : " · 大区块"}
                </p>
              </div>
              <button className={styles.ghostButton} onClick={() => setEditingDeviceId(null)} type="button">
                关闭
              </button>
            </div>
            <div className={styles.metricOptionList}>
              {editingBlockKey && editingInstanceId ? (
                metricConfig.availableMetrics
                  .filter((item) => editableMetrics?.includes(item.key))
                  .map((item) => (
                    <label
                      key={item.key}
                      className={`${styles.metricOption} ${!item.available ? styles.metricOptionUnsupported : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={getInstanceMetricDraft(editingInstanceId).has(item.key)}
                        onChange={() => toggleInstanceMetric(editingInstanceId, item.key)}
                      />
                      <div>
                        <strong>{METRIC_LABELS[item.key]}</strong>
                        <p className={styles.subtle}>{item.available ? "此实例可记录该指标" : "此设备当前不支持检测"}</p>
                      </div>
                    </label>
                  ))
              ) : editingBlockKey ? (
                getBlockInstanceOptions(editingBlockKey).map((item) => (
                  <label key={item.id} className={styles.metricOption}>
                    <input
                      type="checkbox"
                      checked={isInstanceEnabledDraft(enabledDeviceIdsDraft, editingBlockKey, item.id, getBlockInstanceIds)}
                      onChange={() => toggleDeviceInstance(editingBlockKey, item.id)}
                    />
                    <div>
                      <strong>{item.title}</strong>
                      <p className={styles.subtle}>{item.subtitle}</p>
                    </div>
                  </label>
                ))
              ) : (
                (Object.keys(BLOCK_METRICS) as BlockKey[]).map((blockKey) => {
                  const instances = getBlockInstanceOptions(blockKey).length;
                  return (
                    <label key={blockKey} className={styles.metricOption}>
                      <input type="checkbox" checked={showBlock(blockKey)} onChange={() => toggleBlock(blockKey)} disabled={blockKey === "fan"} />
                      <div>
                        <strong>{BLOCK_LABELS[blockKey]}</strong>
                        <p className={styles.subtle}>{blockKey === "fan" ? `当前检测到 ${instances} 个风扇接口` : `当前检测到 ${instances} 个实例`}</p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.primaryButton} onClick={() => void saveMetricConfig()} disabled={savingMetricConfig} type="button">
                {savingMetricConfig ? "保存中" : "保存"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {blockSheet && activeBlockSheetTabId ? (
        <div className={styles.sheetBackdrop} onClick={() => setBlockSheet(null)} role="presentation">
          <section
            className={styles.sheetCard}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${BLOCK_LABELS[blockSheet.blockKey]} 图表`}
          >
            <div className={styles.sheetHandle} />
            <div className={styles.sheetHeader}>
              <div>
                <strong>{BLOCK_LABELS[blockSheet.blockKey]}</strong>
                <p className={styles.subtle}>
                  {selectedWindow === "1m" ? "当前显示实时值" : "当前显示该粒度区间平均值"}
                </p>
              </div>
              <div className={styles.subHeaderActions}>
                <button
                  className={styles.inlineAction}
                  onClick={() => {
                    if (!selectedDeviceId) return;
                    void openBlockEditor(selectedDeviceId, blockSheet.blockKey);
                  }}
                  type="button"
                >
                  编辑
                </button>
                <button className={styles.ghostButton} onClick={() => setBlockSheet(null)} type="button">
                  关闭
                </button>
              </div>
            </div>
            <div className={styles.sheetTabRow}>
              {blockSheetTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`${styles.sheetTab} ${activeBlockSheetTabId === tab.id ? styles.sheetTabActive : ""}`}
                  onClick={() => setBlockSheet((current) => (current ? { ...current, tabId: tab.id } : current))}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className={styles.sheetViewport}>
              <div
                className={styles.sheetPages}
                style={{ transform: `translateX(-${Math.max(blockSheetTabs.findIndex((tab) => tab.id === activeBlockSheetTabId), 0) * 100}%)` }}
              >
                {blockSheetTabs.map((tab) => (
                  <div key={tab.id} className={styles.sheetPage}>
                    {tab.subtitle ? <p className={styles.subtle}>{tab.subtitle}</p> : null}
                    <div className={styles.metricCardGrid}>
                      {tab.cards.map((card) => (
                        <ChartCard
                          key={card.chartId}
                          chartId={card.chartId}
                          title={card.title}
                          value={card.value}
                          unit={card.unit}
                          color={card.color}
                          points={card.points}
                          detail={card.detail}
                        />
                      ))}
                    </div>
                    {tab.metrics.length ? (
                      <div className={styles.metricMiniGrid}>
                        {tab.metrics.map((item) => (
                          <MetricMiniCard key={`${tab.id}-${item.label}`} label={item.label} value={item.value} />
                        ))}
                      </div>
                    ) : null}
                    {tab.noteEditor && selectedDeviceId ? (
                      <FanItem deviceId={selectedDeviceId} fan={tab.noteEditor} onSaved={async () => {
                        if (!selectedDeviceId) return;
                        const next = await getMetrics(selectedDeviceId, selectedWindow);
                        setMetrics(next);
                      }} />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {detailModal ? (
        <div className={styles.modalBackdrop} onClick={() => setDetailModal(null)} role="presentation">
          <section
            className={styles.modalCard}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="查看区块详情"
          >
            <div className={styles.modalHeader}>
              <div>
                <strong>{detailModal.title}</strong>
                {detailModal.subtitle ? <p className={styles.subtle}>{detailModal.subtitle}</p> : null}
              </div>
              <button className={styles.ghostButton} onClick={() => setDetailModal(null)} type="button">
                关闭
              </button>
            </div>
            <div className={styles.metricMiniGrid}>
              {detailModal.rows.map((row) => (
                <MetricMiniCard key={`${detailModal.title}-${row.label}`} label={row.label} value={row.value} />
              ))}
            </div>
          </section>
        </div>
      ) : null}
      {toastMessage ? <div className={styles.toast}>{toastMessage}</div> : null}
    </main>
  );
}

function formatBytes(value: number) {
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current.toFixed(current >= 100 ? 0 : 1)} ${units[unit]}`;
}

function buildUsageDetail(usedBytes: number, totalBytes: number) {
  if (!totalBytes) return "无数据";
  return `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`;
}

function formatUsageOrUnknown(usedBytes: number, totalBytes: number) {
  if (!totalBytes) return `${formatBytes(usedBytes)} / 未知`;
  return `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`;
}

function formatPercent(usedBytes: number, totalBytes: number) {
  if (!totalBytes) return "--";
  return `${((usedBytes / totalBytes) * 100).toFixed(1)}%`;
}

function isInstanceEnabledDraft(
  enabledDeviceIdsDraft: Partial<Record<DeviceBlockKey, string[]>>,
  blockKey: BlockKey,
  instanceId: string,
  getBlockInstanceIds: (blockKey: BlockKey) => string[]
) {
  const enabledIds = enabledDeviceIdsDraft[blockKey];
  if (!enabledIds || enabledIds.length === 0) {
    return getBlockInstanceIds(blockKey).includes(instanceId);
  }
  return enabledIds.includes(instanceId);
}

function FanItem({
  deviceId,
  fan,
  onSaved
}: {
  deviceId: string | null;
  fan: {
    id: string;
    label: string;
    interface: string;
    rpm: number;
    note?: string;
  };
  onSaved: () => Promise<void>;
}) {
  const [note, setNote] = useState(fan.note ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!deviceId) return;
    setSaving(true);
    try {
      await saveFanNote(deviceId, fan.id, { note });
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.hardwareItem}>
      <div>
        <strong>{fan.label}</strong>
        <p>
          接口 {fan.interface} · {fan.rpm} RPM
        </p>
        <div className={styles.fanNoteRow}>
          <input
            className={styles.fanNoteInput}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="备注风扇名称"
          />
          <button className={styles.ghostButton} onClick={() => void handleSave()} disabled={saving} type="button">
            {saving ? "保存中" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricMiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metricMiniCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type SummaryCapsule = {
  blockKey: BlockKey;
  title: string;
  description: string;
  items: Array<{ label: string; value: string }>;
};

type SheetCardModel = {
  chartId: string;
  title: string;
  value: string;
  unit?: string;
  color: string;
  points: { timestamp: string; value: number }[];
  detail?: string;
};

type BlockSheetTab = {
  id: string;
  label: string;
  subtitle?: string;
  cards: SheetCardModel[];
  metrics: Array<{ label: string; value: string }>;
  noteEditor?: {
    id: string;
    label: string;
    interface: string;
    rpm: number;
    note?: string;
  };
};

type MetricsResponse = Awaited<ReturnType<typeof getMetrics>>;
type DashboardMetrics = {
  device: {
    hostname: string;
    os: string;
    platform: string;
    cpuModel?: string;
  };
  latest: MetricsResponse["latest"];
  series: MetricsResponse["series"];
  availableMetrics: MetricsResponse["availableMetrics"];
};

function buildSummaryCapsules(
  metrics: NonNullable<DashboardMetrics>,
  selectedWindow: MetricWindow,
  totalGpuMemoryUsedBytes: number,
  totalGpuMemoryBytes: number,
  showBlock: (blockKey: BlockKey) => boolean
): SummaryCapsule[] {
  const capsules: SummaryCapsule[] = [];
  if (showBlock("cpu")) {
    capsules.push({
      blockKey: "cpu",
      title: "CPU",
      description: metrics.device.cpuModel ?? "处理器概览",
      items: [
        { label: "占用", value: formatPoint(metrics.series.cpuUsagePercent, selectedWindow, { suffix: "%" }) },
        { label: "频率", value: formatPoint(metrics.series.cpuFrequencyMHz, selectedWindow, { digits: 0, suffix: " MHz" }) },
        { label: "温度", value: formatPoint(metrics.series.cpuTemperatureC, selectedWindow, { suffix: " °C", zeroMeansMissing: true }) }
      ]
    });
  }
  if (showBlock("gpu")) {
    capsules.push({
      blockKey: "gpu",
      title: "显卡",
      description: metrics.latest.gpus.length ? `${metrics.latest.gpus.length} 张显卡 / 适配器` : "未读取到显卡",
      items: [
        { label: "占用", value: formatPoint(metrics.series.gpuUsagePercent, selectedWindow, { suffix: "%" }) },
        { label: "显存", value: formatUsageOrUnknown(totalGpuMemoryUsedBytes, totalGpuMemoryBytes) },
        { label: "温度", value: formatPoint(metrics.series.gpuTemperatureC, selectedWindow, { suffix: " °C" }) }
      ]
    });
  }
  if (showBlock("memory")) {
    capsules.push({
      blockKey: "memory",
      title: "内存",
      description: "物理内存与虚拟内存",
      items: [
        { label: "物理", value: buildUsageDetail(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes) },
        { label: "占用", value: formatPoint(metrics.series.memoryUsagePercent, selectedWindow, { suffix: "%" }) },
        { label: "虚拟", value: buildUsageDetail(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes) }
      ]
    });
  }
  if (showBlock("disk")) {
    capsules.push({
      blockKey: "disk",
      title: "硬盘",
      description: `${metrics.latest.disks.length} 个设备 / 分区`,
      items: [
        { label: "总占用", value: buildUsageDetail(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes) },
        { label: "读取", value: formatPoint(metrics.series.diskReadBytesPerSec, selectedWindow, { bytesPerSecond: true }) },
        { label: "写入", value: formatPoint(metrics.series.diskWriteBytesPerSec, selectedWindow, { bytesPerSecond: true }) }
      ]
    });
  }
  if (showBlock("network")) {
    capsules.push({
      blockKey: "network",
      title: "网络",
      description: `${metrics.latest.networkInterfaces.length} 个网络接口`,
      items: [
        { label: "接收", value: formatPoint(metrics.series.networkRxBytesPerSec, selectedWindow, { bytesPerSecond: true }) },
        { label: "发送", value: formatPoint(metrics.series.networkTxBytesPerSec, selectedWindow, { bytesPerSecond: true }) },
        { label: "累计", value: formatBytes((metrics.series.trafficRxBytes.at(-1)?.value ?? 0) + (metrics.series.trafficTxBytes.at(-1)?.value ?? 0)) }
      ]
    });
  }
  if (showBlock("fan")) {
    capsules.push({
      blockKey: "fan",
      title: "风扇",
      description: metrics.latest.fans.length ? `${metrics.latest.fans.length} 个风扇接口` : "未读取到风扇数据",
      items: [
        { label: "最高", value: metrics.latest.fans.length ? `${Math.max(...metrics.latest.fans.map((fan) => fan.rpm))} RPM` : "--" },
        { label: "平均", value: metrics.latest.fans.length ? `${Math.round(metrics.latest.fans.reduce((sum, fan) => sum + fan.rpm, 0) / metrics.latest.fans.length)} RPM` : "--" },
        { label: "后端", value: metrics.latest.sensorBackends.some((backend) => backend.ok) ? "可用" : "不可用" }
      ]
    });
  }
  return capsules;
}

function buildBlockSheetTabs({
  metrics,
  blockKey,
  selectedWindow,
  showMetric,
  isInstanceVisible,
  isMetricVisibleForInstance,
  totalGpuMemoryUsedBytes,
  totalGpuMemoryBytes
}: {
  metrics: NonNullable<DashboardMetrics>;
  blockKey: BlockKey;
  selectedWindow: MetricWindow;
  showMetric: (metricKey: DeviceMetricKey) => boolean;
  isInstanceVisible: (blockKey: BlockKey, instanceId: string) => boolean;
  isMetricVisibleForInstance: (blockKey: BlockKey, instanceId: string, metricKey: DeviceMetricKey) => boolean;
  totalGpuMemoryUsedBytes: number;
  totalGpuMemoryBytes: number;
}): BlockSheetTab[] {
  if (blockKey === "cpu") {
    return [
      {
        id: "total",
        label: "总和",
        subtitle: !metrics.availableMetrics.some((item) => item.key === "cpuTemperature" && item.available)
          ? "当前设备未提供 CPU 温度传感器，虚拟机环境下较常见。"
          : metrics.device.cpuModel ?? "处理器概览",
        cards: [
          createChartCard("cpu-total-usage", "CPU 占用", formatPoint(metrics.series.cpuUsagePercent, selectedWindow, { suffix: "%" }), "#3384ff", metrics.series.cpuUsagePercent),
          createChartCard("cpu-total-frequency", "CPU 频率", formatPoint(metrics.series.cpuFrequencyMHz, selectedWindow, { digits: 0, suffix: " MHz" }), "#6b82ff", metrics.series.cpuFrequencyMHz),
          createChartCard("cpu-total-temperature", "CPU 温度", formatPoint(metrics.series.cpuTemperatureC, selectedWindow, { suffix: " °C", zeroMeansMissing: true }), "#ff7f3f", metrics.series.cpuTemperatureC)
        ],
        metrics: [
          { label: "处理器", value: metrics.device.cpuModel ?? "未知" },
          { label: "包数量", value: `${metrics.latest.cpuPackages.length}` }
        ]
      },
      ...metrics.series.cpus
        .filter((cpu) => metrics.latest.cpuPackages.some((item) => item.id === cpu.id))
        .filter((cpu) => isInstanceVisible("cpu", cpu.id))
        .map((cpu) => ({
          id: cpu.id,
          label: cpu.name,
          subtitle: listText([cpu.model, cpu.coreCount != null ? `${cpu.coreCount} 核` : "", cpu.logicalCount != null ? `${cpu.logicalCount} 线程` : ""]),
          cards: [
            isMetricVisibleForInstance("cpu", cpu.id, "cpuUsage")
              ? createChartCard(`cpu-usage-${cpu.id}`, "CPU 占用", formatPoint(cpu.usagePercent, selectedWindow, { suffix: "%" }), "#3384ff", cpu.usagePercent)
              : null,
            isMetricVisibleForInstance("cpu", cpu.id, "cpuFrequency")
              ? createChartCard(`cpu-frequency-${cpu.id}`, "CPU 频率", formatPoint(cpu.frequencyMHz, selectedWindow, { digits: 0, suffix: " MHz" }), "#6b82ff", cpu.frequencyMHz)
              : null,
            isMetricVisibleForInstance("cpu", cpu.id, "cpuTemperature")
              ? createChartCard(`cpu-temperature-${cpu.id}`, "CPU 温度", formatPoint(cpu.temperatureC, selectedWindow, { suffix: " °C", zeroMeansMissing: true }), "#ff7f3f", cpu.temperatureC)
              : null
          ].filter(Boolean) as SheetCardModel[],
          metrics: [
            { label: "型号", value: cpu.model || "未知" },
            { label: "核心 / 线程", value: `${cpu.coreCount ?? "--"} / ${cpu.logicalCount ?? "--"}` }
          ]
        }))
    ];
  }
  if (blockKey === "memory") {
    return [{
      id: "total",
      label: "总和",
      subtitle: "系统内存与虚拟内存",
      cards: [
        showMetric("memoryUsage")
          ? createChartCard("memory-usage", "物理内存", formatPoint(metrics.series.memoryUsagePercent, selectedWindow, { suffix: "%" }), "#c13484", metrics.series.memoryUsagePercent, buildUsageDetail(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes))
          : null,
        showMetric("swapUsage")
          ? createChartCard("swap-usage", "虚拟内存", formatPoint(metrics.series.swapUsagePercent, selectedWindow, { suffix: "%" }), "#ca7c20", metrics.series.swapUsagePercent, buildUsageDetail(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes))
          : null
      ].filter(Boolean) as SheetCardModel[],
      metrics: [
        { label: "物理内存", value: buildUsageDetail(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes) },
        { label: "虚拟内存", value: buildUsageDetail(metrics.latest.swapUsedBytes, metrics.latest.swapTotalBytes) }
      ]
    }];
  }
  if (blockKey === "disk") {
    return [
      {
        id: "total",
        label: "总和",
        subtitle: `${metrics.latest.disks.length} 个设备 / 分区`,
        cards: [
          showMetric("diskUsage")
            ? createChartCard("disk-total-usage", "总占用", buildUsageDetail(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes), "#d37d19", metrics.series.diskUsagePercent, formatPercent(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes))
            : null,
          showMetric("diskRead")
            ? createChartCard("disk-total-read", "总读取", formatPoint(metrics.series.diskReadBytesPerSec, selectedWindow, { bytesPerSecond: true }), "#d39a25", metrics.series.diskReadBytesPerSec)
            : null,
          showMetric("diskWrite")
            ? createChartCard("disk-total-write", "总写入", formatPoint(metrics.series.diskWriteBytesPerSec, selectedWindow, { bytesPerSecond: true }), "#9f6217", metrics.series.diskWriteBytesPerSec)
            : null
        ].filter(Boolean) as SheetCardModel[],
        metrics: [
          { label: "总容量", value: buildUsageDetail(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes) }
        ]
      },
      ...metrics.series.disks
        .filter((disk) => metrics.latest.disks.some((item) => item.id === disk.id))
        .filter((disk) => isInstanceVisible("disk", disk.id))
        .map((disk) => {
          const current = metrics.latest.disks.find((item) => item.id === disk.id);
          return {
            id: disk.id,
            label: disk.name,
            subtitle: disk.mountPoint,
            cards: [
              isMetricVisibleForInstance("disk", disk.id, "diskUsage")
                ? createChartCard(`disk-usage-${disk.id}`, "磁盘占用", current ? buildUsageDetail(current.usedBytes, current.totalBytes) : "无数据", "#d37d19", disk.usagePercent, current ? formatPercent(current.usedBytes, current.totalBytes) : "无数据")
                : null,
              isMetricVisibleForInstance("disk", disk.id, "diskRead")
                ? createChartCard(`disk-read-${disk.id}`, "磁盘读取", formatPoint(disk.readBytesPerSec, selectedWindow, { bytesPerSecond: true }), "#d39a25", disk.readBytesPerSec)
                : null,
              isMetricVisibleForInstance("disk", disk.id, "diskWrite")
                ? createChartCard(`disk-write-${disk.id}`, "磁盘写入", formatPoint(disk.writeBytesPerSec, selectedWindow, { bytesPerSecond: true }), "#9f6217", disk.writeBytesPerSec)
                : null
            ].filter(Boolean) as SheetCardModel[],
            metrics: [
              { label: "文件系统", value: disk.filesystem || "未知" },
              { label: "设备", value: listText([disk.vendor, disk.model]) || "未读取到型号" },
              { label: "温度", value: current?.temperatureC != null ? `${current.temperatureC.toFixed(1)} °C` : "--" }
            ]
          };
        })
    ];
  }
  if (blockKey === "network") {
    return [
      {
        id: "total",
        label: "总和",
        subtitle: `${metrics.latest.networkInterfaces.length} 个网络接口`,
        cards: [
          showMetric("networkRxRate")
            ? createChartCard("network-total-rx", "总接收", formatPoint(metrics.series.networkRxBytesPerSec, selectedWindow, { bytesPerSecond: true }), "#3cb8bf", metrics.series.networkRxBytesPerSec)
            : null,
          showMetric("networkTxRate")
            ? createChartCard("network-total-tx", "总发送", formatPoint(metrics.series.networkTxBytesPerSec, selectedWindow, { bytesPerSecond: true }), "#3f8fe2", metrics.series.networkTxBytesPerSec)
            : null
        ].filter(Boolean) as SheetCardModel[],
        metrics: [
          { label: "累计流量", value: formatBytes((metrics.series.trafficRxBytes.at(-1)?.value ?? 0) + (metrics.series.trafficTxBytes.at(-1)?.value ?? 0)) }
        ]
      },
      ...metrics.series.networks
        .filter((network) => metrics.latest.networkInterfaces.some((item) => item.id === network.id))
        .filter((network) => isInstanceVisible("network", network.id))
        .map((network) => {
          const current = metrics.latest.networkInterfaces.find((item) => item.id === network.id);
          return {
            id: network.id,
            label: network.name,
            subtitle: network.macAddress || network.id,
            cards: [
              isMetricVisibleForInstance("network", network.id, "networkRxRate")
                ? createChartCard(`network-rx-${network.id}`, "网络接收", formatPoint(network.rxBytesPerSec, selectedWindow, { bytesPerSecond: true }), "#3cb8bf", network.rxBytesPerSec)
                : null,
              isMetricVisibleForInstance("network", network.id, "networkTxRate")
                ? createChartCard(`network-tx-${network.id}`, "网络发送", formatPoint(network.txBytesPerSec, selectedWindow, { bytesPerSecond: true }), "#3f8fe2", network.txBytesPerSec)
                : null
            ].filter(Boolean) as SheetCardModel[],
            metrics: [
              { label: "MAC", value: network.macAddress || "未知" },
              { label: "IPv4", value: network.ipv4?.join(", ") || "无" },
              { label: "IPv6", value: network.ipv6?.join(", ") || "无" },
              { label: "累计接收", value: current?.totalRxBytes != null ? formatBytes(current.totalRxBytes) : "--" },
              { label: "累计发送", value: current?.totalTxBytes != null ? formatBytes(current.totalTxBytes) : "--" }
            ]
          };
        })
    ];
  }
  if (blockKey === "gpu") {
    return [
      {
        id: "total",
        label: "总和",
        subtitle: metrics.latest.gpus.length ? `${metrics.latest.gpus.length} 张显卡 / 适配器` : "未读取到显卡",
        cards: [
          showMetric("gpuUsage")
            ? createChartCard("gpu-total-usage", "总占用", formatPoint(metrics.series.gpuUsagePercent, selectedWindow, { suffix: "%" }), "#5ba832", metrics.series.gpuUsagePercent)
            : null,
          showMetric("gpuMemory")
            ? createChartCard("gpu-total-memory", "总显存", formatUsageOrUnknown(totalGpuMemoryUsedBytes, totalGpuMemoryBytes), "#3f9f88", metrics.series.gpuMemoryUsagePercent, formatPercent(totalGpuMemoryUsedBytes, totalGpuMemoryBytes))
            : null,
          showMetric("gpuTemperature")
            ? createChartCard("gpu-total-temperature", "总温度", formatPoint(metrics.series.gpuTemperatureC, selectedWindow, { suffix: " °C" }), "#8cbc44", metrics.series.gpuTemperatureC)
            : null
        ].filter(Boolean) as SheetCardModel[],
        metrics: [
          { label: "总显存", value: formatUsageOrUnknown(totalGpuMemoryUsedBytes, totalGpuMemoryBytes) }
        ]
      },
      ...metrics.series.gpus
        .filter((gpu) => metrics.latest.gpus.some((item) => item.id === gpu.id))
        .filter((gpu) => isInstanceVisible("gpu", gpu.id))
        .map((gpu) => {
          const current = metrics.latest.gpus.find((item) => item.id === gpu.id);
          return {
            id: gpu.id,
            label: gpu.name,
            subtitle: gpu.id,
            cards: [
              isMetricVisibleForInstance("gpu", gpu.id, "gpuUsage")
                ? createChartCard(`gpu-usage-${gpu.id}`, "GPU 占用", formatPoint(gpu.usagePercent, selectedWindow, { suffix: "%" }), "#5ba832", gpu.usagePercent)
                : null,
              isMetricVisibleForInstance("gpu", gpu.id, "gpuEncode")
                ? createChartCard(`gpu-encode-${gpu.id}`, "GPU 编码", formatPoint(gpu.encodePercent, selectedWindow, { suffix: "%" }), "#4ba86b", gpu.encodePercent)
                : null,
              isMetricVisibleForInstance("gpu", gpu.id, "gpuDecode")
                ? createChartCard(`gpu-decode-${gpu.id}`, "GPU 解码", formatPoint(gpu.decodePercent, selectedWindow, { suffix: "%" }), "#69bca1", gpu.decodePercent)
                : null,
              isMetricVisibleForInstance("gpu", gpu.id, "gpuFrequency")
                ? createChartCard(`gpu-frequency-${gpu.id}`, "GPU 频率", formatPoint(gpu.frequencyMHz, selectedWindow, { digits: 0, suffix: " MHz" }), "#4a9790", gpu.frequencyMHz)
                : null,
              isMetricVisibleForInstance("gpu", gpu.id, "gpuMemory")
                ? createChartCard(`gpu-memory-${gpu.id}`, "GPU 显存", current ? formatUsageOrUnknown(current.memoryUsedBytes, current.memoryTotalBytes) : "无数据", "#3f9f88", gpu.memoryUsagePercent, current ? formatPercent(current.memoryUsedBytes, current.memoryTotalBytes) : "无数据")
                : null,
              isMetricVisibleForInstance("gpu", gpu.id, "gpuTemperature")
                ? createChartCard(`gpu-temperature-${gpu.id}`, "GPU 温度", formatPoint(gpu.temperatureC, selectedWindow, { suffix: " °C" }), "#8cbc44", gpu.temperatureC)
                : null
            ].filter(Boolean) as SheetCardModel[],
            metrics: [
              { label: "显存", value: current ? formatUsageOrUnknown(current.memoryUsedBytes, current.memoryTotalBytes) : "无数据" },
              { label: "温度 / 频率", value: `${current?.temperatureC != null ? `${current.temperatureC.toFixed(1)} °C` : "--"} / ${current?.frequencyMHz != null ? `${current.frequencyMHz.toFixed(0)} MHz` : "--"}` }
            ]
          };
        })
    ];
  }
  if (blockKey === "fan") {
    return [
      {
        id: "total",
        label: "总和",
        subtitle: metrics.latest.sensorBackends.map((backend) => `${backend.label}: ${backend.ok ? "可用" : "不可用"}`).join(" · "),
        cards: metrics.latest.fans
          .map((fan) => {
            const series = metrics.series.fans.find((item) => item.id === fan.id);
            return series ? createChartCard(`fan-rpm-${fan.id}`, fan.label, `${fan.rpm} RPM`, "#c94b4b", series.rpm, fan.interface) : null;
          })
          .filter(Boolean) as SheetCardModel[],
        metrics: metrics.latest.sensorBackends.map((backend) => ({
          label: `后端 · ${backend.label}`,
          value: `${backend.ok ? "可用" : "不可用"}${backend.detail ? ` · ${backend.detail}` : ""}`
        }))
      },
      ...metrics.latest.fans.map((fan) => {
        const series = metrics.series.fans.find((item) => item.id === fan.id);
        return {
          id: fan.id,
          label: fan.label,
          subtitle: fan.interface,
          cards: series ? [createChartCard(`fan-rpm-sheet-${fan.id}`, "风扇转速", `${fan.rpm} RPM`, "#c94b4b", series.rpm, fan.interface)] : [],
          metrics: [
            { label: "转速", value: `${fan.rpm} RPM` },
            { label: "备注", value: fan.note || "未备注" }
          ],
          noteEditor: fan
        };
      })
    ];
  }
  return [];
}

function createChartCard(
  chartId: string,
  title: string,
  value: string,
  color: string,
  points: { timestamp: string; value: number }[],
  detail?: string,
  unit?: string
): SheetCardModel {
  return { chartId, title, value, color, points, detail, unit };
}

function formatPoint(
  points: { value: number }[],
  selectedWindow: MetricWindow,
  options: { digits?: number; suffix?: string; bytesPerSecond?: boolean; zeroMeansMissing?: boolean } = {}
) {
  if (!points.length) return "--";
  if (options.zeroMeansMissing && points.every((point) => point.value === 0)) return "--";
  const value =
    selectedWindow === "1m"
      ? points.at(-1)?.value ?? null
      : points.reduce((sum, point) => sum + point.value, 0) / points.length;
  if (value == null || !Number.isFinite(value)) return "--";
  if (options.bytesPerSecond) return `${formatBytes(value)}/s`;
  const digits = options.digits ?? 1;
  return `${value.toFixed(digits)}${options.suffix ?? ""}`;
}

function listText(values: Array<string | undefined>) {
  return values.filter(Boolean).join(" · ");
}

function getBlockStatus(
  metrics: {
    latest: {
      cpuPackages: { usagePercent?: number | null }[];
      memoryUsedBytes: number;
      memoryTotalBytes: number;
      diskUsedBytes: number;
      diskTotalBytes: number;
      networkInterfaces: { rxBytesPerSec?: number; txBytesPerSec?: number }[];
      gpus: { utilizationPercent: number; memoryUsedBytes: number; memoryTotalBytes: number }[];
      fans: { rpm: number }[];
    };
  } | null,
  blockKey: BlockKey,
  totalGpuMemoryUsedBytes: number,
  totalGpuMemoryBytes: number
) {
  if (!metrics) return "--";
  if (blockKey === "cpu") {
    return `${(metrics.latest.cpuPackages[0]?.usagePercent ?? 0).toFixed(0)}% 占用`;
  }
  if (blockKey === "gpu") {
    return metrics.latest.gpus.length
      ? `${formatUsageOrUnknown(totalGpuMemoryUsedBytes, totalGpuMemoryBytes)}`
      : "未读取到显卡";
  }
  if (blockKey === "memory") {
    return buildUsageDetail(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes);
  }
  if (blockKey === "disk") {
    return buildUsageDetail(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes);
  }
  if (blockKey === "network") {
    const rx = metrics.latest.networkInterfaces.reduce((sum, item) => sum + (item.rxBytesPerSec ?? 0), 0);
    const tx = metrics.latest.networkInterfaces.reduce((sum, item) => sum + (item.txBytesPerSec ?? 0), 0);
    return `${formatBytes(rx)}/s ↓ · ${formatBytes(tx)}/s ↑`;
  }
  if (blockKey === "fan") {
    return metrics.latest.fans.length ? `${metrics.latest.fans[0]?.rpm ?? 0} RPM` : "未读取到风扇";
  }
  return "--";
}

type OverviewMetricsData = {
  device: {
    cpuModel?: string;
  };
  latest: {
    memoryUsedBytes: number;
    memoryTotalBytes: number;
    diskUsedBytes: number;
    diskTotalBytes: number;
    networkInterfaces: { rxBytesPerSec?: number; txBytesPerSec?: number }[];
    gpus: { id: string }[];
    fans: { id: string; label: string; rpm: number }[];
  };
  series: Pick<
    MetricSeries,
    "cpuUsagePercent" | "gpuMemoryUsagePercent" | "memoryUsagePercent" | "diskUsagePercent" | "networkRxBytesPerSec" | "fans"
  >;
};

function buildOverviewCards(
  metrics: OverviewMetricsData,
  totalGpuMemoryUsedBytes: number,
  totalGpuMemoryBytes: number,
  showBlock: (blockKey: BlockKey) => boolean
) {
  const cards: Array<{
    blockKey: BlockKey;
    title: string;
    value: string;
    unit?: string;
    color: string;
    points: { timestamp: string; value: number }[];
    detail?: string;
  }> = [];

  if (showBlock("cpu")) {
    cards.push({
      blockKey: "cpu",
      title: "CPU 占用",
      value: (metrics.series.cpuUsagePercent.at(-1)?.value ?? 0).toFixed(1),
      unit: "%",
      color: "#3384ff",
      points: metrics.series.cpuUsagePercent,
      detail: metrics.device.cpuModel ?? "处理器概览"
    });
  }

  if (showBlock("gpu")) {
    cards.push({
      blockKey: "gpu",
      title: "总显存",
      value: formatUsageOrUnknown(totalGpuMemoryUsedBytes, totalGpuMemoryBytes),
      color: "#3f9f88",
      points: metrics.series.gpuMemoryUsagePercent,
      detail: metrics.latest.gpus.length ? `${metrics.latest.gpus.length} 张显卡 / 适配器` : "未读取到显卡"
    });
  }

  if (showBlock("memory")) {
    cards.push({
      blockKey: "memory",
      title: "内存",
      value: buildUsageDetail(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes),
      color: "#c13484",
      points: metrics.series.memoryUsagePercent,
      detail: formatPercent(metrics.latest.memoryUsedBytes, metrics.latest.memoryTotalBytes)
    });
  }

  if (showBlock("disk")) {
    cards.push({
      blockKey: "disk",
      title: "磁盘占用",
      value: buildUsageDetail(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes),
      color: "#d37d19",
      points: metrics.series.diskUsagePercent,
      detail: formatPercent(metrics.latest.diskUsedBytes, metrics.latest.diskTotalBytes)
    });
  }

  if (showBlock("network")) {
    const rx = metrics.latest.networkInterfaces.reduce((sum, item) => sum + (item.rxBytesPerSec ?? 0), 0);
    const tx = metrics.latest.networkInterfaces.reduce((sum, item) => sum + (item.txBytesPerSec ?? 0), 0);
    cards.push({
      blockKey: "network",
      title: "网络接收",
      value: formatBytes(rx),
      unit: "/s",
      color: "#3cb8bf",
      points: metrics.series.networkRxBytesPerSec,
      detail: `发送 ${formatBytes(tx)}/s`
    });
  }

  if (showBlock("fan") && metrics.latest.fans[0]) {
    const firstFan = metrics.latest.fans[0];
    const firstFanSeries = metrics.series.fans.find((item) => item.id === firstFan.id);
    if (firstFanSeries) {
      cards.push({
        blockKey: "fan",
        title: "风扇转速",
        value: firstFan.rpm.toFixed(0),
        unit: "RPM",
        color: "#c94b4b",
        points: firstFanSeries.rpm,
        detail: firstFan.label
      });
    }
  }

  return cards;
}
