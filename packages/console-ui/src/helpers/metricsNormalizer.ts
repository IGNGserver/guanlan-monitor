import type {
  MetricsResponse,
  DeviceSummary,
  DesktopAgentBackendState,
  TrafficCalendarResponse,
  TrafficCalendarCell
} from "@dsc/shared";

export interface NormalizedChartPoint {
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
  gpuUsage: number;
  diskUsage: number;
  rxRate: number;
  txRate: number;
}

export function normalizeMetricsResponse(metrics: MetricsResponse | null): NormalizedChartPoint[] {
  if (!metrics || !metrics.series) return [];

  const cpuSeries = metrics.series.cpuUsagePercent || [];
  const memSeries = metrics.series.memoryUsagePercent || [];
  const gpuSeries = metrics.series.gpuUsagePercent || [];
  const diskSeries = metrics.series.diskUsagePercent || [];
  const rxSeries = metrics.series.networkRxBytesPerSec || [];
  const txSeries = metrics.series.networkTxBytesPerSec || [];

  const maxLen = Math.max(
    cpuSeries.length,
    memSeries.length,
    gpuSeries.length,
    diskSeries.length,
    rxSeries.length,
    txSeries.length
  );

  if (maxLen === 0) return [];

  const points: NormalizedChartPoint[] = [];

  for (let i = 0; i < maxLen; i++) {
    const timestamp =
      cpuSeries[i]?.timestamp ||
      memSeries[i]?.timestamp ||
      gpuSeries[i]?.timestamp ||
      diskSeries[i]?.timestamp ||
      rxSeries[i]?.timestamp ||
      txSeries[i]?.timestamp ||
      new Date().toISOString();

    points.push({
      timestamp,
      cpuUsage: Math.round(cpuSeries[i]?.value ?? 0),
      memoryUsage: Math.round(memSeries[i]?.value ?? 0),
      gpuUsage: Math.round(gpuSeries[i]?.value ?? 0),
      diskUsage: Math.round(diskSeries[i]?.value ?? 0),
      rxRate: rxSeries[i]?.value ?? 0,
      txRate: txSeries[i]?.value ?? 0
    });
  }

  return points;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  let amount = bytes;
  let idx = 0;
  while (amount >= 1024 && idx < sizes.length - 1) {
    amount /= 1024;
    idx += 1;
  }
  const digits = idx === 0 ? 0 : 1;
  if (Number(amount.toFixed(digits)) >= 1024 && idx < sizes.length - 1) {
    amount /= 1024;
    idx += 1;
  }
  return `${amount.toFixed(idx === 0 ? 0 : 1)} ${sizes[idx]}`;
}
