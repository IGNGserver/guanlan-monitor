"use client";

import React, { useEffect, useState } from "react";
import type {
  DeviceBlockKey,
  DeviceMetricKey,
  DeviceSummary,
  MetricSeries,
  MetricWindow,
  MetricsResponse
} from "@dsc/shared";
import { getMetrics, saveFanNote } from "../lib/api";
import { ChartCard } from "./chart-card";
import { TrafficCalendar } from "./traffic-calendar";
import styles from "./monitor.module.css";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "all", label: "全部指标" },
  { key: "cpu", label: "CPU" },
  { key: "gpu", label: "GPU 显卡" },
  { key: "memory", label: "系统内存" },
  { key: "disk", label: "磁盘存储" },
  { key: "network", label: "网络吞吐" },
  { key: "fan", label: "风扇散热" },
  { key: "calendar", label: "流量日历" }
];

interface DashboardProps {
  deviceId: string;
  devices: DeviceSummary[];
  selectedWindow: MetricWindow;
  onSelectWindow: (window: MetricWindow) => void;
  onSelectDevice: (deviceId: string | null) => void;
}

export function Dashboard({
  deviceId,
  devices,
  selectedWindow,
  onSelectWindow,
  onSelectDevice
}: DashboardProps) {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [editingFan, setEditingFan] = useState<{ id: string; label: string; note: string } | null>(null);

  const [metrics, setMetrics] = useState<{
    status: DeviceSummary["status"];
    lastSeenAt: string | null;
    series: MetricSeries;
    enabledMetrics: DeviceMetricKey[];
    availableMetrics?: { key: DeviceMetricKey; available: boolean }[];
    device: {
      hostname: string;
      os: string;
      platform: string;
      arch?: string;
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

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getMetrics(deviceId, selectedWindow)
      .then((res) => {
        if (!active) return;
        setMetrics(res);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [deviceId, selectedWindow]);

  const currentDevice = devices.find((d) => d.deviceId === deviceId);
  const isOnline = metrics?.status === "online" || currentDevice?.status === "online";

  async function handleSaveFanNote() {
    if (!editingFan) return;
    try {
      await saveFanNote(deviceId, editingFan.id, { note: editingFan.note });
      setEditingFan(null);
      // refresh metrics
      const res = await getMetrics(deviceId, selectedWindow);
      setMetrics(res);
    } catch {
      alert("保存风扇备注失败");
    }
  }

  const series = metrics?.series;
  const latest = metrics?.latest as MetricsResponse["latest"] | undefined;
  const device = metrics?.device as MetricsResponse["device"] | undefined;

  // Dynamically compute available metric keys and categories based on Agent's actual reported metrics
  const availableKeys = new Set(
    metrics?.availableMetrics?.filter((m) => m.available).map((m) => m.key) ?? []
  );

  const hasCpu =
    availableKeys.has("cpuUsage") ||
    availableKeys.has("cpuFrequency") ||
    availableKeys.has("cpuTemperature") ||
    Boolean(metrics?.latest?.cpuPackages?.length);

  const hasGpu =
    Boolean(metrics?.latest?.gpus?.length) &&
    (availableKeys.has("gpuUsage") ||
      availableKeys.has("gpuEncode") ||
      availableKeys.has("gpuDecode") ||
      availableKeys.has("gpuFrequency") ||
      availableKeys.has("gpuMemory") ||
      availableKeys.has("gpuTemperature"));

  const hasMemory =
    availableKeys.has("memoryUsage") ||
    availableKeys.has("swapUsage") ||
    (metrics?.latest?.memoryTotalBytes ?? 0) > 0;

  const hasDisk =
    availableKeys.has("diskUsage") ||
    availableKeys.has("diskRead") ||
    availableKeys.has("diskWrite") ||
    Boolean(metrics?.latest?.disks?.length) ||
    (metrics?.latest?.diskTotalBytes ?? 0) > 0;

  const hasNetwork =
    availableKeys.has("networkRxRate") ||
    availableKeys.has("networkTxRate") ||
    availableKeys.has("networkTraffic") ||
    Boolean(metrics?.latest?.networkInterfaces?.length);

  const hasFan = Boolean(metrics?.latest?.fans && metrics.latest.fans.length > 0);

  const categories = [
    { key: "all", label: "全部指标" },
    ...(hasCpu ? [{ key: "cpu", label: "CPU" }] : []),
    ...(hasGpu ? [{ key: "gpu", label: "GPU 显卡" }] : []),
    ...(hasMemory ? [{ key: "memory", label: "系统内存" }] : []),
    ...(hasDisk ? [{ key: "disk", label: "磁盘存储" }] : []),
    ...(hasNetwork ? [{ key: "network", label: "网络吞吐" }] : []),
    ...(hasFan ? [{ key: "fan", label: "风扇散热" }] : []),
    ...(hasNetwork ? [{ key: "calendar", label: "流量日历" }] : [])
  ];

  useEffect(() => {
    if (metrics && !categories.some((c) => c.key === activeCategory)) {
      setActiveCategory("all");
    }
  }, [metrics, activeCategory, categories]);

  return (
    <div>
      {/* Device Hero Banner Bar */}
      <div className={styles.deviceDetailHeader}>
        <div>
          <div className={styles.deviceDetailTitle}>
            <button
              type="button"
              className={styles.footerActionBtn}
              onClick={() => onSelectDevice(null)}
              style={{ fontSize: "12px", padding: "4px 10px" }}
            >
              ← 返回全域概览
            </button>
            <span>{metrics?.device.hostname ?? currentDevice?.hostname ?? deviceId}</span>
            <span
              className={`${styles.statusPill} ${
                isOnline ? styles.statusOnlinePill : styles.statusOfflinePill
              }`}
            >
              <span
                className={`${styles.statusIndicatorDot} ${
                  isOnline ? styles.statusDotOnline : styles.statusDotOffline
                }`}
              />
              {isOnline ? "在线运行" : "离线"}
            </span>
          </div>

          <div className={styles.deviceDetailMeta} style={{ marginTop: "8px" }}>
            <span className={styles.metaBadge}>ID: {deviceId}</span>
            <span className={styles.metaBadge}>
              OS: {metrics?.device.os ?? currentDevice?.os ?? "unknown"}
            </span>
            {metrics?.device.cpuModel && (
              <span className={styles.metaBadge}>CPU: {metrics.device.cpuModel}</span>
            )}
          </div>
        </div>
      </div>

      {/* Category Filter Bar */}
      <div className={styles.filterChipBar}>
        {categories.map((cat) => (
          <button
            key={cat.key}
            type="button"
            className={`${styles.chipBtn} ${activeCategory === cat.key ? styles.chipBtnActive : ""}`}
            onClick={() => setActiveCategory(cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading && !metrics ? (
        <div style={{ padding: "60px", textAlign: "center", color: "var(--text-muted)" }}>
          正在加载设备采样数据与历史图表...
        </div>
      ) : (
        <div className={styles.chartGrid}>
          {activeCategory === "all" && latest && device && (
            <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
              <div className={styles.doubleBezelInner} style={{ padding: "20px 24px" }}>
                <h3 className={styles.chartTitle}>设备与上报状态</h3>
                <div className={styles.deviceDetailMeta} style={{ marginTop: "12px" }}>
                  <span className={styles.metaBadge}>平台：{device.platform}</span>
                  <span className={styles.metaBadge}>架构：{device.arch}</span>
                  <span className={styles.metaBadge}>最近上报：{metrics?.lastSeenAt ? new Date(metrics.lastSeenAt).toLocaleString("zh-CN") : "--"}</span>
                  <span className={styles.metaBadge}>进程：{latest.system.processCount}</span>
                  <span className={styles.metaBadge}>线程：{latest.system.threadCount}</span>
                  <span className={styles.metaBadge}>句柄：{latest.system.handleCount}</span>
                </div>
              </div>
            </div>
          )}

          {/* CPU Metric Charts */}
          {(activeCategory === "all" || activeCategory === "cpu") && hasCpu && series && (
            <>
              {availableKeys.has("cpuUsage") && (
                <ChartCard
                  title="CPU 总体占用率"
                  value={`${(series.cpuUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                  color="var(--accent-cyan)"
                  points={series.cpuUsagePercent}
                  detail="核心综合算力使用"
                />
              )}
              {availableKeys.has("cpuFrequency") && (
                <ChartCard
                  title="CPU 实时主频"
                  value={`${((series.cpuFrequencyMHz.at(-1)?.value ?? 0) / 1000).toFixed(2)}`}
                  unit="GHz"
                  color="var(--accent-blue)"
                  points={series.cpuFrequencyMHz}
                  detail="硬件时钟频率"
                />
              )}
              {availableKeys.has("cpuTemperature") && series.cpuTemperatureC.length > 0 && (
                <ChartCard
                  title="CPU 封装温度"
                  value={`${(series.cpuTemperatureC.at(-1)?.value ?? 0).toFixed(0)}°C`}
                  color="var(--accent-rose)"
                  points={series.cpuTemperatureC}
                  detail="核心热耗指标"
                />
              )}
            </>
          )}

          {/* GPU Metric Charts */}
          {(activeCategory === "all" || activeCategory === "gpu") && hasGpu && series && (
            <>
              {availableKeys.has("gpuUsage") && (
                <ChartCard
                  title="GPU 核心占用"
                  value={`${(series.gpuUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                  color="var(--accent-violet)"
                  points={series.gpuUsagePercent}
                  detail="图形加速核心"
                />
              )}
              {availableKeys.has("gpuMemory") && (
                <ChartCard
                  title="GPU 显存占用率"
                  value={`${(series.gpuMemoryUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                  color="var(--accent-cyan)"
                  points={series.gpuMemoryUsagePercent}
                  detail="VRAM 渲染存取"
                />
              )}
              {availableKeys.has("gpuTemperature") && series.gpuTemperatureC.length > 0 && (
                <ChartCard
                  title="GPU 核心温度"
                  value={`${(series.gpuTemperatureC.at(-1)?.value ?? 0).toFixed(0)}°C`}
                  color="var(--accent-rose)"
                  points={series.gpuTemperatureC}
                />
              )}
            </>
          )}

          {/* Memory Metric Charts */}
          {(activeCategory === "all" || activeCategory === "memory") && hasMemory && series && (
            <>
              {availableKeys.has("memoryUsage") && (
                <ChartCard
                  title="物理内存占用"
                  value={`${(series.memoryUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                  color="var(--accent-emerald)"
                  points={series.memoryUsagePercent}
                  detail={`已用 ${formatBytes(metrics?.latest.memoryUsedBytes ?? 0)} / ${formatBytes(
                    metrics?.latest.memoryTotalBytes ?? 0
                  )}`}
                />
              )}
              <ChartCard title="已用内存字节" value={formatBytes(series.memoryUsedBytes.at(-1)?.value ?? 0)} color="var(--accent-violet)" points={series.memoryUsedBytes} />
              <ChartCard title="Swap 已用字节" value={formatBytes(series.swapUsedBytes.at(-1)?.value ?? 0)} color="var(--accent-amber)" points={series.swapUsedBytes} />
              {availableKeys.has("swapUsage") && (metrics?.latest.swapTotalBytes ?? 0) > 0 && (
                <ChartCard
                  title="虚拟内存 (Swap) 占用"
                  value={`${(series.swapUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                  color="var(--accent-amber)"
                  points={series.swapUsagePercent}
                  detail={`已用 ${formatBytes(metrics?.latest.swapUsedBytes ?? 0)} / ${formatBytes(
                    metrics?.latest.swapTotalBytes ?? 0
                  )}`}
                />
              )}
            </>
          )}

          {/* Disk Metric Charts */}
          {(activeCategory === "all" || activeCategory === "disk") && hasDisk && series && (
            <>
              {availableKeys.has("diskUsage") && (
                <ChartCard
                  title="磁盘整体存储占用"
                  value={`${(series.diskUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`}
                  color="var(--accent-amber)"
                  points={series.diskUsagePercent}
                  detail={`已用 ${formatBytes(metrics?.latest.diskUsedBytes ?? 0)} / ${formatBytes(
                    metrics?.latest.diskTotalBytes ?? 0
                  )}`}
                />
              )}
              {availableKeys.has("diskRead") && (
                <ChartCard
                  title="磁盘读取速率"
                  value={formatRate(series.diskReadBytesPerSec.at(-1)?.value ?? 0)}
                  color="var(--accent-cyan)"
                  points={series.diskReadBytesPerSec}
                  detail="存储 IO 读取"
                />
              )}
              {availableKeys.has("diskWrite") && (
                <ChartCard
                  title="磁盘写入速率"
                  value={formatRate(series.diskWriteBytesPerSec.at(-1)?.value ?? 0)}
                  color="var(--accent-violet)"
                  points={series.diskWriteBytesPerSec}
                  detail="存储 IO 写入"
                />
              )}
            </>
          )}

          {/* Network Metric Charts */}
          {(activeCategory === "all" || activeCategory === "network") && hasNetwork && series && (
            <>
              {availableKeys.has("networkRxRate") && (
                <ChartCard
                  title="网络接收速率 (Rx)"
                  value={formatRate(series.networkRxBytesPerSec.at(-1)?.value ?? 0)}
                  color="var(--accent-cyan)"
                  points={series.networkRxBytesPerSec}
                  detail="下行实时流量"
                />
              )}
              {availableKeys.has("networkTxRate") && (
                <ChartCard
                  title="网络发送速率 (Tx)"
                  value={formatRate(series.networkTxBytesPerSec.at(-1)?.value ?? 0)}
                  color="var(--accent-emerald)"
                  points={series.networkTxBytesPerSec}
                  detail="上行实时流量"
                />
              )}
              {availableKeys.has("networkTraffic") && (
                <>
                  <ChartCard title="累计接收流量" value={formatBytes(series.trafficRxBytes.at(-1)?.value ?? 0)} color="var(--accent-blue)" points={series.trafficRxBytes} />
                  <ChartCard title="累计发送流量" value={formatBytes(series.trafficTxBytes.at(-1)?.value ?? 0)} color="var(--accent-violet)" points={series.trafficTxBytes} />
                </>
              )}
            </>
          )}

          {(activeCategory === "all" || activeCategory === "cpu") && series?.cpus.length > 0 && (
            <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
              <div className={styles.doubleBezelInner} style={{ padding: "24px" }}>
                <h3 className={styles.chartTitle}>CPU 实例详情</h3>
                {series.cpus.map((cpu) => (
                  <div key={cpu.id} style={{ marginTop: "18px", borderTop: "1px solid var(--border-subtle)", paddingTop: "18px" }}>
                    <div className={styles.deviceDetailMeta} style={{ marginBottom: "10px" }}>
                      <span className={styles.metaBadge}>{cpu.name}</span>
                      {cpu.model && <span className={styles.metaBadge}>{cpu.model}</span>}
                      <span className={styles.metaBadge}>核心/线程：{cpu.coreCount ?? "--"}/{cpu.logicalCount ?? "--"}</span>
                    </div>
                    <div className={styles.chartGrid}>
                      <ChartCard title={`${cpu.name} 使用率`} chartId={`${cpu.id}-usage`} value={`${(cpu.usagePercent.at(-1)?.value ?? 0).toFixed(0)}%`} color="var(--accent-cyan)" points={cpu.usagePercent} />
                      <ChartCard title={`${cpu.name} 频率`} chartId={`${cpu.id}-frequency`} value={formatMHz(cpu.frequencyMHz.at(-1)?.value ?? 0)} color="var(--accent-blue)" points={cpu.frequencyMHz} detail="MHz" />
                      <ChartCard title={`${cpu.name} 温度`} chartId={`${cpu.id}-temperature`} value={`${(cpu.temperatureC.at(-1)?.value ?? 0).toFixed(0)}°C`} color="var(--accent-rose)" points={cpu.temperatureC} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(activeCategory === "all" || activeCategory === "memory") && series && latest && (
            <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
              <div className={styles.doubleBezelInner} style={{ padding: "24px" }}>
                <h3 className={styles.chartTitle}>内存与系统详情</h3>
                <div className={styles.deviceDetailMeta} style={{ margin: "12px 0" }}>
                  <span className={styles.metaBadge}>可用：{formatBytes(latest.memoryAvailableBytes)}</span>
                  <span className={styles.metaBadge}>缓存：{formatBytes(latest.memoryCachedBytes)}</span>
                  <span className={styles.metaBadge}>已提交：{formatBytes(latest.memoryCommittedBytes)}</span>
                  <span className={styles.metaBadge}>频率：{latest.memorySpeedMHz ? `${latest.memorySpeedMHz.toFixed(0)} MHz` : "--"}</span>
                  <span className={styles.metaBadge}>插槽：{latest.memorySlotCount ?? "--"}</span>
                  <span className={styles.metaBadge}>形态：{latest.memoryFormFactor || "--"}</span>
                </div>
                <div className={styles.chartGrid}>
                  <ChartCard title="可用内存" value={formatBytes(series.memoryAvailableBytes.at(-1)?.value ?? 0)} color="var(--accent-emerald)" points={series.memoryAvailableBytes} />
                  <ChartCard title="缓存内存" value={formatBytes(series.memoryCachedBytes.at(-1)?.value ?? 0)} color="var(--accent-blue)" points={series.memoryCachedBytes} />
                  <ChartCard title="已提交内存" value={formatBytes(series.memoryCommittedBytes.at(-1)?.value ?? 0)} color="var(--accent-violet)" points={series.memoryCommittedBytes} />
                  <ChartCard title="进程数" value={`${(series.systemProcessCount.at(-1)?.value ?? latest.system.processCount).toFixed(0)}`} color="var(--accent-cyan)" points={series.systemProcessCount} />
                  <ChartCard title="线程数" value={`${(series.systemThreadCount.at(-1)?.value ?? latest.system.threadCount).toFixed(0)}`} color="var(--accent-cyan)" points={series.systemThreadCount} />
                  <ChartCard title="句柄数" value={`${(series.systemHandleCount.at(-1)?.value ?? latest.system.handleCount).toFixed(0)}`} color="var(--accent-amber)" points={series.systemHandleCount} />
                </div>
              </div>
            </div>
          )}

          {(activeCategory === "all" || activeCategory === "disk") && series?.disks.length > 0 && latest && (
            <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
              <div className={styles.doubleBezelInner} style={{ padding: "24px" }}>
                <h3 className={styles.chartTitle}>磁盘实例详情</h3>
                {series.disks.map((diskSeries) => {
                  const disk = latest.disks.find((item) => item.id === diskSeries.id);
                  return (
                    <div key={diskSeries.id} style={{ marginTop: "18px", borderTop: "1px solid var(--border-subtle)", paddingTop: "18px" }}>
                      <div className={styles.deviceDetailMeta} style={{ marginBottom: "10px" }}>
                        <span className={styles.metaBadge}>{disk?.mountPoint || diskSeries.name}</span>
                        {disk?.filesystem && <span className={styles.metaBadge}>{disk.filesystem}</span>}
                        {disk?.model && <span className={styles.metaBadge}>{disk.model}</span>}
                        {disk?.interfaceType && <span className={styles.metaBadge}>{disk.interfaceType}</span>}
                        <span className={styles.metaBadge}>容量：{formatBytes(disk?.usedBytes ?? 0)} / {formatBytes(disk?.totalBytes ?? 0)}</span>
                        {disk?.averageResponseMs != null && <span className={styles.metaBadge}>响应：{disk.averageResponseMs.toFixed(1)} ms</span>}
                      </div>
                      <div className={styles.chartGrid}>
                        <ChartCard title={`${diskSeries.name} 读取`} chartId={`${diskSeries.id}-read`} value={formatRate(diskSeries.readBytesPerSec.at(-1)?.value ?? 0)} color="var(--accent-cyan)" points={diskSeries.readBytesPerSec} />
                        <ChartCard title={`${diskSeries.name} 写入`} chartId={`${diskSeries.id}-write`} value={formatRate(diskSeries.writeBytesPerSec.at(-1)?.value ?? 0)} color="var(--accent-violet)" points={diskSeries.writeBytesPerSec} />
                        <ChartCard title={`${diskSeries.name} 活动时间`} chartId={`${diskSeries.id}-active`} value={`${(diskSeries.activePercent.at(-1)?.value ?? 0).toFixed(0)}%`} color="var(--accent-amber)" points={diskSeries.activePercent} />
                        <ChartCard title={`${diskSeries.name} 温度`} chartId={`${diskSeries.id}-temperature`} value={`${(diskSeries.temperatureC.at(-1)?.value ?? 0).toFixed(0)}°C`} color="var(--accent-rose)" points={diskSeries.temperatureC} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(activeCategory === "all" || activeCategory === "network") && series?.networks.length > 0 && latest && (
            <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
              <div className={styles.doubleBezelInner} style={{ padding: "24px" }}>
                <h3 className={styles.chartTitle}>网卡实例详情</h3>
                {series.networks.map((networkSeries) => {
                  const network = latest.networkInterfaces.find((item) => item.id === networkSeries.id);
                  return (
                    <div key={networkSeries.id} style={{ marginTop: "18px", borderTop: "1px solid var(--border-subtle)", paddingTop: "18px" }}>
                      <div className={styles.deviceDetailMeta} style={{ marginBottom: "10px" }}>
                        <span className={styles.metaBadge}>{network?.name || networkSeries.name}</span>
                        {network?.macAddress && <span className={styles.metaBadge}>MAC：{network.macAddress}</span>}
                        {network?.ipv4?.length ? <span className={styles.metaBadge}>IPv4：{network.ipv4.join(", ")}</span> : null}
                        {network?.ipv6?.length ? <span className={styles.metaBadge}>IPv6：{network.ipv6.join(", ")}</span> : null}
                        {network?.linkSpeedMbps != null && <span className={styles.metaBadge}>链路：{network.linkSpeedMbps.toFixed(0)} Mbps</span>}
                        {network?.connectionType && <span className={styles.metaBadge}>{network.connectionType}</span>}
                        {network?.signalStrengthPercent != null && <span className={styles.metaBadge}>信号：{network.signalStrengthPercent.toFixed(0)}%</span>}
                      </div>
                      <div className={styles.chartGrid}>
                        <ChartCard title={`${networkSeries.name} 接收`} chartId={`${networkSeries.id}-rx`} value={formatRate(networkSeries.rxBytesPerSec.at(-1)?.value ?? 0)} color="var(--accent-cyan)" points={networkSeries.rxBytesPerSec} />
                        <ChartCard title={`${networkSeries.name} 发送`} chartId={`${networkSeries.id}-tx`} value={formatRate(networkSeries.txBytesPerSec.at(-1)?.value ?? 0)} color="var(--accent-emerald)" points={networkSeries.txBytesPerSec} />
                        <ChartCard title={`${networkSeries.name} 累计接收`} chartId={`${networkSeries.id}-traffic-rx`} value={formatBytes(networkSeries.trafficRxBytes.at(-1)?.value ?? 0)} color="var(--accent-blue)" points={networkSeries.trafficRxBytes} />
                        <ChartCard title={`${networkSeries.name} 累计发送`} chartId={`${networkSeries.id}-traffic-tx`} value={formatBytes(networkSeries.trafficTxBytes.at(-1)?.value ?? 0)} color="var(--accent-violet)" points={networkSeries.trafficTxBytes} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(activeCategory === "all" || activeCategory === "gpu") && series?.gpus.length > 0 && latest && (
            <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
              <div className={styles.doubleBezelInner} style={{ padding: "24px" }}>
                <h3 className={styles.chartTitle}>GPU 实例详情</h3>
                {series.gpus.map((gpuSeries) => {
                  const gpu = latest.gpus.find((item) => item.id === gpuSeries.id);
                  return (
                    <div key={gpuSeries.id} style={{ marginTop: "18px", borderTop: "1px solid var(--border-subtle)", paddingTop: "18px" }}>
                      <div className={styles.deviceDetailMeta} style={{ marginBottom: "10px" }}>
                        <span className={styles.metaBadge}>{gpu?.name || gpuSeries.name}</span>
                        {gpu?.driverVersion && <span className={styles.metaBadge}>驱动：{gpu.driverVersion}</span>}
                        <span className={styles.metaBadge}>显存：{formatBytes(gpu?.memoryUsedBytes ?? 0)} / {formatBytes(gpu?.memoryTotalBytes ?? 0)}</span>
                      </div>
                      <div className={styles.chartGrid}>
                        <ChartCard title={`${gpuSeries.name} 使用率`} chartId={`${gpuSeries.id}-usage`} value={`${(gpuSeries.usagePercent.at(-1)?.value ?? 0).toFixed(0)}%`} color="var(--accent-violet)" points={gpuSeries.usagePercent} />
                        <ChartCard title={`${gpuSeries.name} 编码`} chartId={`${gpuSeries.id}-encode`} value={`${(gpuSeries.encodePercent.at(-1)?.value ?? 0).toFixed(0)}%`} color="var(--accent-blue)" points={gpuSeries.encodePercent} />
                        <ChartCard title={`${gpuSeries.name} 解码`} chartId={`${gpuSeries.id}-decode`} value={`${(gpuSeries.decodePercent.at(-1)?.value ?? 0).toFixed(0)}%`} color="var(--accent-cyan)" points={gpuSeries.decodePercent} />
                        <ChartCard title={`${gpuSeries.name} 频率`} chartId={`${gpuSeries.id}-frequency`} value={formatMHz(gpuSeries.frequencyMHz.at(-1)?.value ?? 0)} color="var(--accent-amber)" points={gpuSeries.frequencyMHz} detail="MHz" />
                        <ChartCard title={`${gpuSeries.name} 显存`} chartId={`${gpuSeries.id}-memory`} value={`${(gpuSeries.memoryUsagePercent.at(-1)?.value ?? 0).toFixed(0)}%`} color="var(--accent-emerald)" points={gpuSeries.memoryUsagePercent} />
                        <ChartCard title={`${gpuSeries.name} 显存已用`} chartId={`${gpuSeries.id}-memory-bytes`} value={formatBytes(gpuSeries.memoryUsedBytes.at(-1)?.value ?? 0)} color="var(--accent-emerald)" points={gpuSeries.memoryUsedBytes} />
                        <ChartCard title={`${gpuSeries.name} 温度`} chartId={`${gpuSeries.id}-temperature`} value={`${(gpuSeries.temperatureC.at(-1)?.value ?? 0).toFixed(0)}°C`} color="var(--accent-rose)" points={gpuSeries.temperatureC} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Fan Speed Cards */}
          {(activeCategory === "all" || activeCategory === "fan") && hasFan && latest?.fans && (
            <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
              <div className={`${styles.doubleBezelInner}`} style={{ padding: "24px" }}>
                <h3 className={styles.chartTitle} style={{ marginBottom: "16px" }}>
                  散热风扇转速
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
                  {latest.fans.map((fan) => (
                    <div
                      key={fan.id}
                      style={{
                        padding: "16px",
                        borderRadius: "12px",
                        background: "rgba(255, 255, 255, 0.02)",
                        border: "1px solid var(--border-subtle)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                          {fan.label}
                        </span>
                        <button
                          type="button"
                          style={{ background: "none", border: "none", fontSize: "11px", color: "var(--accent-cyan)", cursor: "pointer" }}
                          onClick={() => setEditingFan({ id: fan.id, label: fan.label, note: fan.note ?? "" })}
                        >
                          编辑备注
                        </button>
                      </div>

                      <div style={{ fontSize: "22px", fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--accent-cyan)" }}>
                        {fan.rpm} <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>RPM</span>
                      </div>

                      <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                        接口：{fan.interface || "--"} · 控制：{fan.controlMode || "--"} · 通道：{fan.channelState || "--"}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                        目标温度：{fan.targetTemperatureC != null ? `${fan.targetTemperatureC.toFixed(0)}°C` : "--"} · PWM：{fan.minPwmPercent != null || fan.maxPwmPercent != null ? `${fan.minPwmPercent ?? "--"}-${fan.maxPwmPercent ?? "--"}%` : "--"}
                      </div>

                      {series?.fans.find((item) => item.id === fan.id) && (
                        <ChartCard
                          title={`${fan.label} 转速`}
                          chartId={`${fan.id}-rpm`}
                          value={`${fan.rpm} RPM`}
                          color="var(--accent-cyan)"
                          points={series.fans.find((item) => item.id === fan.id)?.rpm ?? []}
                        />
                      )}

                      {fan.note && (
                        <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                          备注: {fan.note}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Traffic Calendar Component */}
          {(activeCategory === "all" || activeCategory === "calendar") && (
            <TrafficCalendar deviceId={deviceId} />
          )}

          {/* Sensor Backends Health Panel */}
          {metrics?.latest.sensorBackends && metrics.latest.sensorBackends.length > 0 && (
            <div className={styles.doubleBezelShell} style={{ gridColumn: "1 / -1" }}>
              <div className={`${styles.doubleBezelInner}`} style={{ padding: "24px" }}>
                <h3 className={styles.chartTitle} style={{ marginBottom: "16px" }}>
                  传感器后端与驱动健康探针
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
                  {metrics.latest.sensorBackends.map((backend) => (
                    <div
                      key={backend.id}
                      style={{
                        padding: "12px 16px",
                        borderRadius: "10px",
                        background: backend.ok ? "rgba(16, 185, 129, 0.05)" : "rgba(244, 63, 94, 0.05)",
                        border: backend.ok ? "1px solid rgba(16, 185, 129, 0.2)" : "1px solid rgba(244, 63, 94, 0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between"
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                          {backend.label}
                        </div>
                        {backend.detail && (
                          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                            {backend.detail}
                          </div>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: backend.ok ? "var(--accent-emerald)" : "var(--accent-rose)"
                        }}
                      >
                        {backend.ok ? "正常" : "异常/离线"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fan Note Editing Modal */}
      {editingFan && (
        <div className={styles.modalBackdrop} onClick={() => setEditingFan(null)}>
          <div className={`${styles.doubleBezelShell} ${styles.modalShell}`} onClick={(e) => e.stopPropagation()}>
            <div className={`${styles.doubleBezelInner} ${styles.modalInner}`}>
              <h3 className={styles.modalTitle}>修改风扇备注</h3>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
                风扇: {editingFan.label}
              </p>
              <input
                type="text"
                className={styles.loginInput}
                placeholder="例如: 机箱前置进风扇"
                value={editingFan.note}
                onChange={(e) => setEditingFan({ ...editingFan, note: e.target.value })}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" className={styles.footerActionBtn} onClick={() => setEditingFan(null)}>
                  取消
                </button>
                <button type="button" className={styles.pillButton} onClick={handleSaveFanNote}>
                  <span>保存备注</span>
                  <span className={styles.buttonIconCircle}>✓</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = bytes;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current.toFixed(1)} ${units[unit]}`;
}

function formatRate(bytesPerSec: number) {
  if (bytesPerSec <= 0) return "0 KB/s";
  if (bytesPerSec >= 1024 * 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
  }
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

function formatMHz(value: number) {
  if (value <= 0) return "0";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} GHz` : `${value.toFixed(0)} MHz`;
}
