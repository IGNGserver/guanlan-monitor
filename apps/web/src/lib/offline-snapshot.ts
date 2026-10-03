import type { ConsoleSnapshot, ConsoleSnapshotRequest } from "@dsc/shared";

export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
export const SNAPSHOT_LIMIT = 8;
export const SNAPSHOT_BYTE_LIMIT = 4_000_000;
function byteSize(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function isSavedView(view: SavedView): boolean {
  return !!view && typeof view.savedAt === "string" && !!view.request && typeof view.request === "object"
    && !!view.snapshot && Array.isArray(view.snapshot.devices);
}
export interface SavedView { request: ConsoleSnapshotRequest; snapshot: ConsoleSnapshot; savedAt: string; }
export interface SnapshotRecord { schema: 1; scope: string; views: SavedView[]; }

export function readonlySnapshot(snapshot: ConsoleSnapshot, savedAt: string, now = Date.now()): ConsoleSnapshot {
  return {
    ...snapshot, source: "cache", localBackend: null, update: null,
    session: { authenticated: false, accessKeyConfigured: false },
    startup: { openAtLogin: false, startMinimized: false },
    cache: { available: true, savedAt, ageSeconds: Math.max(0, Math.floor((now - Date.parse(savedAt)) / 1000)) }
  };
}
function calendarKey(request: ConsoleSnapshotRequest) {
  return `${request.trafficMode ?? "day"}:${request.trafficAnchor?.slice(0, 10) ?? ""}`;
}
function viewKey(request: ConsoleSnapshotRequest) {
  return JSON.stringify([request.selectedDeviceId ?? null, request.metricWindow ?? "5m", calendarKey(request)]);
}
export function saveSnapshotView(record: SnapshotRecord | null, scope: string, snapshot: ConsoleSnapshot, request: ConsoleSnapshotRequest, now = Date.now()): SnapshotRecord {
  const savedAt = new Date(now).toISOString();
  const normalized = { ...request, selectedDeviceId: snapshot.selectedDeviceId };
  const view: SavedView = { request: normalized, snapshot: readonlySnapshot(snapshot, savedAt, now), savedAt };
  const previous = record?.scope === scope && Array.isArray(record.views) ? record.views.filter(isSavedView) : [];
  const next = { schema: 1 as const, scope, views: [view, ...previous.filter((item) => viewKey(item.request) !== viewKey(normalized))].slice(0, SNAPSHOT_LIMIT) };
  // Bound storage even on large fleets. A summary remains useful when an
  // unusually large telemetry payload does not fit the cache budget.
  while (next.views.length > 1 && byteSize(next) > SNAPSHOT_BYTE_LIMIT) next.views.pop();
  if (byteSize(next) > SNAPSHOT_BYTE_LIMIT) next.views[0].snapshot = { ...view.snapshot, metrics: null, overviewMetrics: null, trafficCalendar: null };
  if (byteSize(next) > SNAPSHOT_BYTE_LIMIT) next.views = [];
  return next;
}
export function restoreSnapshotView(record: SnapshotRecord | null, request: ConsoleSnapshotRequest = {}, now = Date.now()): ConsoleSnapshot | null {
  if (record?.schema !== 1 || typeof record.scope !== "string" || !record.scope || !Array.isArray(record.views)) return null;
  const views = record.views.filter(isSavedView).filter((item) => Number.isFinite(Date.parse(item.savedAt)) && now >= Date.parse(item.savedAt) && now - Date.parse(item.savedAt) <= SNAPSHOT_TTL_MS);
  const latest = views[0];
  if (!latest?.snapshot?.devices) return null;
  const selectedDeviceId = request.selectedDeviceId !== undefined ? request.selectedDeviceId : latest.snapshot.selectedDeviceId;
  const window = request.metricWindow ?? "5m";
  const selectedView = views.find((item) => item.snapshot.metrics?.device.deviceId === selectedDeviceId && (item.snapshot.metrics?.window ?? item.request.metricWindow ?? "5m") === window);
  const overview = views.find((item) => (item.snapshot.overviewMetrics?.window ?? item.request.metricWindow ?? "5m") === window);
  const calendar = views.find((item) => item.snapshot.selectedDeviceId === selectedDeviceId && calendarKey(item.request) === calendarKey(request));
  return readonlySnapshot({
    ...latest.snapshot, selectedDeviceId,
    metrics: selectedView?.snapshot.metrics ?? null,
    overviewMetrics: overview?.snapshot.overviewMetrics ?? null,
    trafficCalendar: calendar?.snapshot.trafficCalendar ?? null
  }, latest.savedAt, now);
}
