import type { MetricsResponse, SamplePoint, TemperatureSensorReading } from "@dsc/shared";
import { formatBytes } from "./metricsNormalizer.ts";

export interface WidgetLine {
  label: string;
  points: SamplePoint[];
  formatter?: (value: number) => string;
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

export function averageSamplePoints(groups: SamplePoint[][]): SamplePoint[] {
  const buckets = new Map<number, { timestamp: string; total: number; count: number }>();
  for (const points of groups) {
    for (const point of points) {
      const timestamp = Date.parse(point.timestamp);
      if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) continue;
      // Separate probes can record one collection cycle a few milliseconds
      // apart. Merge within one-second buckets so aggregate lines do not
      // alternate between partial samples.
      const bucketTimestamp = Math.round(timestamp / 1000) * 1000;
      const current = buckets.get(bucketTimestamp) ?? { timestamp: new Date(bucketTimestamp).toISOString(), total: 0, count: 0 };
      current.total += point.value;
      current.count += 1;
      buckets.set(bucketTimestamp, current);
    }
  }
  return [...buckets.values()]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .map((point) => ({ timestamp: point.timestamp, value: point.count ? point.total / point.count : 0 }));
}

export function getWidgetLines(widgetType: string, metrics: MetricsResponse | null, targetId?: string, localTemperatureSources: TemperatureSensorReading[] = [], localTemperatureSourcesAt?: string | null): { lines: WidgetLine[]; valueFormatter?: (value: number) => string } {
  const series = metrics?.series;
  if (widgetType === "temperature-source-line") {
    const sensor = targetId ? series?.temperatureSensors?.find((item) => item.id === targetId) : undefined;
    const latestSensor = targetId ? metrics?.latest.temperatureSensors?.find((item) => item.id === targetId) : undefined;
    const localSensor = targetId ? localTemperatureSources.find((item) => item.id === targetId) : undefined;
    const points = sensor?.currentC.length
      ? sensor.currentC
      : latestSensor?.currentC != null && Number.isFinite(latestSensor.currentC)
        ? [{ timestamp: metrics?.lastSeenAt ?? metrics?.device.lastSeenAt ?? new Date().toISOString(), value: latestSensor.currentC }]
        : localSensor?.currentC != null && Number.isFinite(localSensor.currentC)
          ? [{ timestamp: localTemperatureSourcesAt ?? metrics?.lastSeenAt ?? metrics?.device.lastSeenAt ?? new Date().toISOString(), value: localSensor.currentC }]
          : [];
    const label = sensor?.name ?? latestSensor?.displayName ?? latestSensor?.rawName ?? localSensor?.displayName ?? localSensor?.rawName ?? "温度";
    return { lines: points.length ? [{ label, points, formatter: (value: number) => `${value.toFixed(1)} °C` }] : [], valueFormatter: (value) => `${value.toFixed(1)} °C` };
  }
  if (!series) return { lines: [] };
  if (widgetType === "cpu-usage" || widgetType === "cpu-usage-pie") {
    const lines = series.cpus?.length && targetId ? series.cpus.filter((item) => item.id === targetId).map((item) => ({ label: item.socketIndex != null ? `Socket ${item.socketIndex}` : item.name, points: item.usagePercent, formatter: (value: number) => `${Math.round(value)}%` })) : [{ label: "CPU 使用率", points: series.cpuUsagePercent, formatter: (value: number) => `${Math.round(value)}%` }];
    return { lines, valueFormatter: (value) => `${Math.round(value)}%` };
  }
  if (widgetType === "cpu-frequency") {
    const cpu = targetId ? series.cpus?.find((item) => item.id === targetId) : undefined;
    const fallback = targetId && (series.cpus?.length ?? 0) > 1 ? [] : series.cpuFrequencyMHz;
    return { lines: [{ label: "主频", points: cpu?.frequencyMHz ?? fallback, formatter: (value: number) => `${Math.round(value)} MHz` }], valueFormatter: (value) => `${Math.round(value)} MHz` };
  }
  if (widgetType === "cpu-temperature") {
    const cpu = targetId ? series.cpus?.find((item) => item.id === targetId) : undefined;
    const fallback = targetId && (series.cpus?.length ?? 0) > 1 ? [] : series.cpuTemperatureC;
    return { lines: [{ label: "温度", points: cpu?.temperatureC ?? fallback, formatter: (value: number) => `${Math.round(value)} °C` }], valueFormatter: (value) => `${Math.round(value)} °C` };
  }
  if (widgetType === "memory-usage" || widgetType === "memory-usage-pie") return { lines: [{ label: "物理内存", points: series.memoryUsedBytes, formatter: formatBytes }, { label: "已提交", points: series.memoryCommittedBytes, formatter: formatBytes }], valueFormatter: formatBytes };
  if (widgetType === "disk-capacity" || widgetType === "disk-capacity-pie") {
    const points = targetId ? series.disks?.find((item) => item.id === targetId)?.usedBytes ?? [] : series.diskUsedBytes;
    return { lines: [{ label: "磁盘已用", points, formatter: formatBytes }], valueFormatter: formatBytes };
  }
  if (widgetType === "disk-io") {
    const disk = targetId ? series.disks?.find((item) => item.id === targetId) : undefined;
    return {
      lines: [
        { label: "读取", points: disk?.readBytesPerSec ?? series.diskReadBytesPerSec, formatter: (value: number) => `${formatBytes(value)}/s` },
        { label: "写入", points: disk?.writeBytesPerSec ?? series.diskWriteBytesPerSec, formatter: (value: number) => `${formatBytes(value)}/s` }
      ],
      valueFormatter: (value) => `${formatBytes(value)}/s`
    };
  }
  if (widgetType === "network-throughput") {
    const targetNetwork = targetId ? series.networks?.find((item) => item.id === targetId) : undefined;
    const networkLines = targetNetwork ? [
      { label: "接收 Rx", points: targetNetwork.rxBytesPerSec, formatter: (value: number) => `${formatBytes(value)}/s` },
      { label: "发送 Tx", points: targetNetwork.txBytesPerSec, formatter: (value: number) => `${formatBytes(value)}/s` }
    ] : [];
    return {
      lines: networkLines.length ? networkLines : [{ label: "接收 Rx", points: series.networkRxBytesPerSec, formatter: (value: number) => `${formatBytes(value)}/s` }, { label: "发送 Tx", points: series.networkTxBytesPerSec, formatter: (value: number) => `${formatBytes(value)}/s` }],
      valueFormatter: (value) => `${formatBytes(value)}/s`
    };
  }
  if (widgetType === "gpu-load" || widgetType === "gpu-load-pie") {
    const gpuLines = series.gpus?.length && targetId ? series.gpus.filter((item) => item.id === targetId) : series.gpus ?? [];
    return { lines: gpuLines.length ? [{ label: "核心", points: averageSamplePoints(gpuLines.map((item) => item.usagePercent)), formatter: (value: number) => `${Math.round(value)}%` }, { label: "编码", points: averageSamplePoints(gpuLines.map((item) => item.encodePercent)), formatter: (value: number) => `${Math.round(value)}%` }, { label: "解码", points: averageSamplePoints(gpuLines.map((item) => item.decodePercent)), formatter: (value: number) => `${Math.round(value)}%` }] : [{ label: "GPU 使用率", points: series.gpuUsagePercent, formatter: (value: number) => `${Math.round(value)}%` }], valueFormatter: (value) => `${Math.round(value)}%` };
  }
  if (widgetType === "gpu-encode" || widgetType === "gpu-decode") {
    const gpuLines = series.gpus?.length && targetId ? series.gpus.filter((item) => item.id === targetId) : series.gpus ?? [];
    const points = gpuLines.length
      ? averageSamplePoints(gpuLines.map((item) => widgetType === "gpu-encode" ? item.encodePercent : item.decodePercent))
      : widgetType === "gpu-encode" ? series.gpuEncodePercent : series.gpuDecodePercent;
    return { lines: [{ label: widgetType === "gpu-encode" ? "编码" : "解码", points, formatter: (value: number) => `${Math.round(value)}%` }], valueFormatter: (value) => `${Math.round(value)}%` };
  }
  if (widgetType === "gpu-frequency") {
    const gpuLines = series.gpus?.length && targetId ? series.gpus.filter((item) => item.id === targetId) : series.gpus ?? [];
    const points = gpuLines.length ? averageSamplePoints(gpuLines.map((item) => item.frequencyMHz)) : series.gpuFrequencyMHz;
    return { lines: [{ label: "频率", points, formatter: (value: number) => `${Math.round(value)} MHz` }], valueFormatter: (value) => `${Math.round(value)} MHz` };
  }
  if (widgetType === "gpu-memory" || widgetType === "gpu-memory-pie") {
    const gpu = targetId ? series.gpus?.find((item) => item.id === targetId) : undefined;
    const points = targetId ? (gpu?.memoryUsedBytes ?? []) : series.gpuMemoryUsedBytes;
    const label = gpu?.memoryKind === "shared" ? "共享显存已用" : gpu?.memoryKind === "dedicated" ? "独立显存已用" : "GPU 内存已用";
    return { lines: [{ label, points, formatter: formatBytes }], valueFormatter: formatBytes };
  }
  if (widgetType === "gpu-temperature") {
    const gpu = targetId ? series.gpus?.find((item) => item.id === targetId) : undefined;
    const points = targetId ? (gpu?.temperatureC ?? []) : (series.gpuTemperatureC ?? []);
    return { lines: [{ label: "温度", points, formatter: (value: number) => `${Math.round(value)} °C` }], valueFormatter: (value) => `${Math.round(value)} °C` };
  }
  if (widgetType === "fan-speed") {
    const fanLines = series.fans?.length && targetId ? series.fans.filter((item) => item.id === targetId) : series.fans ?? [];
    if (fanLines.length) {
      return { lines: fanLines.map((item) => ({ label: item.name, points: item.rpm, formatter: (value: number) => `${Math.round(value)} RPM` })), valueFormatter: (value) => `${Math.round(value)} RPM` };
    }
    const latestFans = targetId ? metrics?.latest.fans.filter((item) => item.id === targetId) ?? [] : metrics?.latest.fans ?? [];
    const timestamp = metrics?.lastSeenAt ?? metrics?.device.lastSeenAt ?? new Date().toISOString();
    return { lines: latestFans.map((item) => ({ label: item.label, points: [{ timestamp, value: item.rpm }], formatter: (value: number) => `${Math.round(value)} RPM` })), valueFormatter: (value) => `${Math.round(value)} RPM` };
  }
  if (widgetType === "system-processes") return { lines: [{ label: "进程", points: series.systemProcessCount, formatter: (value: number) => formatNumber(value) }, { label: "线程", points: series.systemThreadCount, formatter: (value: number) => formatNumber(value) }, { label: "句柄", points: series.systemHandleCount, formatter: (value: number) => formatNumber(value) }] };
  return { lines: [] };
}
