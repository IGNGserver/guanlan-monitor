import type {
  AuthLoginPayload,
  DeviceDetail,
  DeviceMetricConfigPayload,
  DeviceMetricConfigResponse,
  DeviceSummary,
  FanNotePayload,
  MetricSeries,
  MetricWindow,
  TrafficCalendarMode,
  TrafficCalendarResponse
} from "@dsc/shared";

function getServerUrl() {
  if (typeof window !== "undefined") {
    return "";
  }

  if (process.env.SERVER_API_URL) {
    return process.env.SERVER_API_URL;
  }

  if (process.env.NEXT_PUBLIC_SERVER_URL) {
    return process.env.NEXT_PUBLIC_SERVER_URL;
  }

  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:4000";
}

export class ApiError extends Error {
  status: number;

  constructor(status: number) {
    super(`api_error:${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getServerUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return response.json() as Promise<T>;
}

export function login(payload: AuthLoginPayload) {
  return apiFetch<{ ok: true }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function logout() {
  return apiFetch<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

export function getSession() {
  return apiFetch<{ ok: true; issuedAt: string }>("/api/auth/session");
}

export function listDevices() {
  return apiFetch<DeviceSummary[]>("/api/devices").then((devices) =>
    devices.map((device) => ({
      ...device,
      gpuUsagePercent: device.gpuUsagePercent ?? null,
      gpuMemoryUsagePercent: device.gpuMemoryUsagePercent ?? null
    }))
  );
}

export function getDevice(deviceId: string) {
  return apiFetch<DeviceDetail>(`/api/devices/${deviceId}`);
}

export function getMetrics(deviceId: string, window: MetricWindow) {
  return apiFetch<{
    device: DeviceDetail;
    status: DeviceSummary["status"];
    lastSeenAt: string | null;
    enabledMetrics: DeviceMetricConfigResponse["enabledMetrics"];
    enabledDeviceIds?: DeviceMetricConfigResponse["enabledDeviceIds"];
    instanceMetricConfig?: DeviceMetricConfigResponse["instanceMetricConfig"];
    availableMetrics: DeviceMetricConfigResponse["availableMetrics"];
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
      }[] | undefined;
      fans: {
        id: string;
        label: string;
        interface: string;
        rpm: number;
        note?: string;
      }[] | undefined;
    };
    series: MetricSeries;
  }>(`/api/devices/${deviceId}/metrics?window=${window}`).then((payload) => ({
    ...payload,
    latest: {
      ...payload.latest,
      cpuPackages: payload.latest.cpuPackages ?? [],
      disks: payload.latest.disks ?? [],
      networkInterfaces: payload.latest.networkInterfaces ?? [],
      gpus: payload.latest.gpus ?? [],
      fans: payload.latest.fans ?? [],
      sensorBackends: payload.latest.sensorBackends ?? []
    },
    series: {
      ...payload.series,
      cpus: payload.series.cpus ?? [],
      disks: payload.series.disks ?? [],
      networks: payload.series.networks ?? [],
      gpus: payload.series.gpus ?? [],
      fans: payload.series.fans ?? []
    }
  }));
}

export function saveFanNote(deviceId: string, fanId: string, payload: FanNotePayload) {
  return apiFetch<{ ok: true; deviceId: string; fanId: string; note: string }>(
    `/api/devices/${deviceId}/fans/${encodeURIComponent(fanId)}/note`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function getDeviceMetricConfig(deviceId: string) {
  return apiFetch<DeviceMetricConfigResponse>(`/api/devices/${deviceId}/metric-config`);
}

export function saveDeviceMetricConfig(deviceId: string, payload: DeviceMetricConfigPayload) {
  return apiFetch<DeviceMetricConfigResponse>(`/api/devices/${deviceId}/metric-config`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function touchViewerPresence(deviceId: string, viewerId: string, ttlSeconds = 20) {
  return apiFetch<{ ok: true; enabled: boolean; viewerCount: number; durationSeconds: number; expiresAt: string }>(
    `/api/devices/${deviceId}/viewer-presence`,
    {
      method: "PUT",
      body: JSON.stringify({ viewerId, ttlSeconds })
    }
  );
}

export function clearViewerPresence(deviceId: string, viewerId: string) {
  return apiFetch<{ ok: true; enabled: boolean; viewerCount: number; durationSeconds: number; expiresAt: string }>(
    `/api/devices/${deviceId}/viewer-presence`,
    {
      method: "DELETE",
      body: JSON.stringify({ viewerId })
    }
  );
}

export function getTrafficCalendar(
  deviceId: string,
  mode: TrafficCalendarMode,
  anchor: string,
  selectedStart?: string
) {
  const params = new URLSearchParams({
    mode,
    anchor
  });
  if (selectedStart) params.set("selectedStart", selectedStart);
  return apiFetch<TrafficCalendarResponse>(`/api/devices/${deviceId}/traffic-calendar?${params.toString()}`);
}

export { getServerUrl };
