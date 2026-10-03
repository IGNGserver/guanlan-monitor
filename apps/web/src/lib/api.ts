import type {
  AuthLoginPayload,
  DeviceDetail,
  DeviceMetricConfigPayload,
  DeviceMetricConfigResponse,
  DeviceSummary,
  FanNotePayload,
  MetricWindow,
  MetricsResponse,
  ReleaseChannel,
  TrafficCalendarMode,
  TrafficCalendarResponse,
  UpdateInfo,
  HubUpdateStatus,
  SystemVersionInfo
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
  const controller = new AbortController();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason ?? new Error("request_cancelled"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  const cancel = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) cancel();
  else init?.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("request_timeout")), 12_000);
  try {
    const request = (async () => {
      const response = await fetch(`${getServerUrl()}${path}`, {
        ...init,
        signal: controller.signal,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
        cache: "no-store"
      });
      if (!response.ok) throw new ApiError(response.status);
      return await response.json() as T;
    })();
    // Bound both the response and its body even when a transport ignores abort.
    return await Promise.race([request, aborted]);
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
  }
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

export function getUpdateInfo(platform: "hub" | "web" = "web") {
  const params = new URLSearchParams({
    platform,
    currentVersion: process.env.NEXT_PUBLIC_DSC_VERSION ?? "dev",
    currentChannel: (process.env.NEXT_PUBLIC_DSC_RELEASE_CHANNEL as ReleaseChannel | undefined) ?? "test"
  });
  return apiFetch<UpdateInfo>(`/api/updates?${params.toString()}`);
}

export function getSystemVersionInfo() {
  return apiFetch<SystemVersionInfo>("/api/system/version");
}

export function requestHubUpdate(version: string) {
  return apiFetch<HubUpdateStatus>("/api/admin/hub-update", {
    method: "POST",
    body: JSON.stringify({ version })
  });
}

export function getHubUpdateStatus() {
  return apiFetch<HubUpdateStatus>("/api/admin/hub-update-status");
}

export function listDevices() {
  return apiFetch<DeviceSummary[]>("/api/instances").then((devices) =>
    devices.map((device) => ({
      ...device,
      gpuUsagePercent: device.gpuUsagePercent ?? null,
      gpuMemoryUsagePercent: device.gpuMemoryUsagePercent ?? null
    }))
  );
}

/**
 * Device ids are free text from the hub (host names, MAC-derived ids, ids an
 * operator typed), so every one of them has to be escaped before it becomes a
 * path segment. `deleteDevice` already did; the reads did not, which turned an
 * id with a space or a slash into a 404 rather than a missing device.
 */
function devicePath(deviceId: string, suffix = "") {
  return `/api/devices/${encodeURIComponent(deviceId)}${suffix}`;
}

export function getDevice(deviceId: string) {
  return apiFetch<DeviceDetail>(devicePath(deviceId));
}

export function deleteDevice(deviceId: string) {
  return apiFetch<{ ok: true }>(devicePath(deviceId), {
    method: "DELETE"
  });
}

export function reorderDevices(deviceIds: string[]) {
  return apiFetch<{ ok: true }>("/api/devices/reorder", {
    method: "PUT",
    body: JSON.stringify({ deviceIds })
  });
}

export function getMetrics(deviceId: string, window: MetricWindow) {
  return apiFetch<MetricsResponse>(devicePath(deviceId, `/metrics?window=${encodeURIComponent(window)}`)).then((payload) => ({
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
    devicePath(deviceId, `/fans/${encodeURIComponent(fanId)}/note`),
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function getOverviewMetrics(window: MetricWindow) {
  return apiFetch<{ window: MetricWindow; instances: import("@dsc/shared").OverviewInstanceSeries[] }>(`/api/overview/metrics?window=${encodeURIComponent(window)}`);
}

export function getDeviceMetricConfig(deviceId: string) {
  return apiFetch<DeviceMetricConfigResponse>(devicePath(deviceId, "/metric-config"));
}

export function saveDeviceMetricConfig(deviceId: string, payload: DeviceMetricConfigPayload) {
  return apiFetch<DeviceMetricConfigResponse>(devicePath(deviceId, "/metric-config"), {
    method: "PUT",
    body: JSON.stringify(payload)
  });
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
  return apiFetch<TrafficCalendarResponse>(devicePath(deviceId, `/traffic-calendar?${params.toString()}`));
}

export { getServerUrl };
