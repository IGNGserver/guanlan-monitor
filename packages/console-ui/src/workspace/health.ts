import type { DeviceMetricKey, DeviceSummary } from "@dsc/shared";

/* =============================================================================
 * Fleet health.
 *
 * "需要关注" used to mean "offline" and nothing else: a machine at 100 % CPU, a
 * disk at 98 % or a GPU pinned at its ceiling never reached the overview. Every
 * surface (overview, directory, device cards, touch overview, device page) now
 * asks this module the same question and gets the same answer: which device,
 * which resource, how far past which threshold.
 *
 * Pure functions over the device summaries the hub already pushes, so the
 * verdict is identical on every client and testable without a browser.
 * ========================================================================== */

export type HealthSeverity = "critical" | "warning";
export type ThresholdMetric = "cpu" | "memory" | "disk" | "gpu";

export interface ThresholdRule {
  /** Percent at or above which the resource needs attention. */
  warning: number;
  /** Percent at or above which it is urgent. */
  critical: number;
}

export type HealthThresholds = Record<ThresholdMetric, ThresholdRule>;

/**
 * Defaults chosen for workstations and small servers: a disk at 85 % still has
 * room but should be planned for; CPU and GPU only matter when they stay near
 * saturation, so their bars sit higher.
 */
export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  cpu: { warning: 90, critical: 98 },
  memory: { warning: 90, critical: 97 },
  disk: { warning: 85, critical: 95 },
  gpu: { warning: 95, critical: 99 }
};

export const THRESHOLD_METRICS: readonly ThresholdMetric[] = ["cpu", "memory", "disk", "gpu"];

export const THRESHOLD_LABELS: Record<ThresholdMetric, string> = {
  cpu: "CPU",
  memory: "内存",
  disk: "磁盘",
  gpu: "GPU"
};

const METRIC_KEYS: Record<ThresholdMetric, DeviceMetricKey> = {
  cpu: "cpuUsage",
  memory: "memoryUsage",
  disk: "diskUsage",
  gpu: "gpuUsage"
};

export interface DeviceIssue {
  deviceId: string;
  hostname: string;
  kind: "offline" | ThresholdMetric;
  severity: HealthSeverity;
  /** Current percent for a resource issue; null for an offline device. */
  value: number | null;
  /** The threshold that was crossed; null for an offline device. */
  threshold: number | null;
  /** For an offline device, when it last reported. */
  since: string | null;
}

export function metricValue(device: DeviceSummary, metric: ThresholdMetric): number | null {
  if (device.unavailableMetrics?.includes(METRIC_KEYS[metric])) return null;
  const value = metric === "cpu" ? device.cpuUsagePercent
    : metric === "memory" ? device.memoryUsagePercent
      : metric === "disk" ? device.diskUsagePercent
        : device.gpuUsagePercent;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Severity of one reading against one rule, or null when it is fine. */
export function metricSeverity(value: number | null | undefined, rule: ThresholdRule): HealthSeverity | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= rule.critical) return "critical";
  if (value >= rule.warning) return "warning";
  return null;
}

/**
 * Every issue on one device. An offline device reports only that it is
 * offline: its last readings are history, and calling a powered-off machine's
 * stale 99 % disk "critical" would rank it by a number nobody can act on now.
 */
export function evaluateDevice(device: DeviceSummary, thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS): DeviceIssue[] {
  const base = { deviceId: device.deviceId, hostname: device.hostname };
  if (device.status !== "online") {
    return [{ ...base, kind: "offline", severity: "critical", value: null, threshold: null, since: device.lastSeenAt }];
  }
  const issues: DeviceIssue[] = [];
  for (const metric of THRESHOLD_METRICS) {
    const value = metricValue(device, metric);
    const rule = thresholds[metric];
    const severity = metricSeverity(value, rule);
    if (!severity) continue;
    issues.push({ ...base, kind: metric, severity, value, threshold: severity === "critical" ? rule.critical : rule.warning, since: null });
  }
  return issues;
}

const SEVERITY_RANK: Record<HealthSeverity, number> = { critical: 0, warning: 1 };

/**
 * Every issue in the fleet, most urgent first: critical before warning, then
 * offline before resources (an unreachable machine hides everything else), then
 * by how far past its threshold a reading is.
 */
export function evaluateFleet(devices: readonly DeviceSummary[], thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS): DeviceIssue[] {
  return devices
    .flatMap((device) => evaluateDevice(device, thresholds))
    .sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
      || Number(right.kind === "offline") - Number(left.kind === "offline")
      || ((right.value ?? 0) - (right.threshold ?? 0)) - ((left.value ?? 0) - (left.threshold ?? 0))
      || left.hostname.localeCompare(right.hostname, "zh-CN"));
}

/** Devices with at least one issue, in the order of their most urgent one. */
export function devicesNeedingAttention(issues: readonly DeviceIssue[]): string[] {
  const seen = new Set<string>();
  for (const issue of issues) seen.add(issue.deviceId);
  return [...seen];
}

/** One sentence per issue, as the overview list and the device page print it. */
export function describeIssue(issue: DeviceIssue, formatDate: (value: string | null | undefined) => string): string {
  if (issue.kind === "offline") return `离线 · 最后在线 ${formatDate(issue.since)}`;
  return `${THRESHOLD_LABELS[issue.kind]} ${Math.round(issue.value ?? 0)}%，超过${issue.severity === "critical" ? "严重" : "警告"}阈值 ${issue.threshold}%`;
}

/* ---- Persistence ----------------------------------------------------------- */

const STORAGE_KEY = "dsc-health-thresholds";

function validRule(rule: unknown): rule is ThresholdRule {
  if (!rule || typeof rule !== "object") return false;
  const { warning, critical } = rule as Record<string, unknown>;
  return typeof warning === "number" && typeof critical === "number"
    && Number.isFinite(warning) && Number.isFinite(critical)
    && warning >= 1 && critical <= 100 && warning < critical;
}

/** Thresholds saved on this client, falling back per metric to the defaults. */
export function parseThresholds(raw: string | null): HealthThresholds {
  if (!raw) return DEFAULT_HEALTH_THRESHOLDS;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<ThresholdMetric, unknown>>;
    const result = { ...DEFAULT_HEALTH_THRESHOLDS };
    for (const metric of THRESHOLD_METRICS) {
      const rule = parsed?.[metric];
      if (validRule(rule)) result[metric] = { warning: rule.warning, critical: rule.critical };
    }
    return result;
  } catch {
    return DEFAULT_HEALTH_THRESHOLDS;
  }
}

export function readStoredThresholds(): HealthThresholds {
  try {
    return parseThresholds(typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_HEALTH_THRESHOLDS;
  }
}

export function storeThresholds(thresholds: HealthThresholds): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds)); } catch { /* Optional preference. */ }
}

export function isValidThresholdRule(rule: ThresholdRule): boolean {
  return validRule(rule);
}
