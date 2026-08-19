import type { MetricWindow } from "@dsc/shared";

export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(Math.max(i, 0), sizes.length - 1);
  return `${(bytes / Math.pow(k, idx)).toFixed(idx === 0 ? 0 : dm)} ${sizes[idx]}`;
}

export function formatThroughput(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec === null || bytesPerSec === undefined || isNaN(bytesPerSec)) return "0 B/s";
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatPercent(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return `${val.toFixed(decimals)}%`;
}

export function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return ts;
  }
}

export function formatTimeOnly(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return ts;
  }
}

export function formatFrequency(mhz: number | null | undefined): string {
  if (mhz === null || mhz === undefined || mhz <= 0) return "—";
  if (mhz >= 1000) {
    return `${(mhz / 1000).toFixed(2)} GHz`;
  }
  return `${Math.round(mhz)} MHz`;
}

export function formatTemp(celsius: number | null | undefined): string {
  if (celsius === null || celsius === undefined || celsius <= 0) return "—";
  return `${Math.round(celsius)}°C`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0s";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function getMetricWindowLabel(window: MetricWindow): string {
  switch (window) {
    case "1m": return "1 Min";
    case "5m": return "5 Mins";
    case "15m": return "15 Mins";
    case "1h": return "1 Hour";
    case "6h": return "6 Hours";
    case "24h":
    case "1d": return "24 Hours";
    case "7d":
    case "1w": return "7 Days";
    case "30d":
    case "1mo": return "30 Days";
    case "90d": return "90 Days";
    case "1y": return "1 Year";
    default: return window;
  }
}

export function getBlockLabel(block: string): string {
  switch (block.toLowerCase()) {
    case "cpu": return "CPU / Processor";
    case "gpu": return "GPU / Graphics";
    case "memory": return "Memory & Swap";
    case "disk": return "Storage Disks";
    case "network": return "Network Interfaces";
    case "fan": return "Fans & Sensors";
    case "system": return "System Overview";
    default: return block.toUpperCase();
  }
}
