import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { DeviceBlockKey, DeviceMetricKey, MetricWindow } from "@dsc/shared";
import type { TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import type {
  DeviceRecord,
  DeviceRegistrationOptions,
  DeviceRepository,
  DeviceMetricConfigValue,
  DeviceMetricConfigStore,
  DeviceRealtimeState,
  FanNoteStore,
  HistoryRepository,
  RealtimeRepository,
  TimeSeriesRecord
} from "../types.js";
import { buildTrafficCalendar } from "../traffic-calendar.js";
import { isLegacyVirtualMachineId, legacyVirtualMachineRecord } from "../legacy-devices.js";

interface LocalDbShape {
  devices: Record<string, DeviceRealtimeState>;
  deviceRegistry?: Record<string, DeviceRecord>;
  series: Record<string, Record<string, TimeSeriesRecord[]>>;
  minuteHistory: Record<string, TimeSeriesRecord[]>;
  history: Record<string, TimeSeriesRecord[]>;
  fanNotes: Record<string, Record<string, string>>;
  deviceMetricConfigs: Record<
    string,
    {
      enabledMetrics: DeviceMetricKey[];
      enabledDeviceIds?: Partial<Record<DeviceBlockKey, string[]>>;
      instanceMetricConfig?: Record<string, DeviceMetricKey[]>;
    }
  >;
}

const EMPTY_DB: LocalDbShape = {
  devices: {},
  deviceRegistry: {},
  series: {},
  minuteHistory: {},
  history: {},
  fanNotes: {},
  deviceMetricConfigs: {}
};

const MINUTE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const HOURLY_RETENTION_MS = 370 * 24 * 60 * 60 * 1000;
const MAX_MINUTE_POINTS = 60 * 24 * 90;
const MAX_HOURLY_POINTS = 24 * 370;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecordField<T>(parsed: Record<string, unknown>, key: string): T {
  const value = parsed[key];
  if (value === undefined) return {} as T;
  if (!isRecord(value)) throw new Error(`local database field ${key} must be an object`);
  return value as T;
}

class LocalJsonStore {
  private readonly filePath: string;
  private operationQueue = Promise.resolve();
  // Single-process, single-store ownership per file. External writers are not observed;
  // use a new store to reload. No filesystem polling occurs on the read path.
  private committedDb?: LocalDbShape;
  private hasLegacyVirtualMachines = false;

  constructor(filePath = resolve(process.cwd(), "data", "local-db.json")) {
    this.filePath = filePath;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  // Called only within the operation queue: concurrent first reads/writes share one load.
  // Failed loads leave the cache unset so the next queued operation can retry.
  private async load(): Promise<LocalDbShape> {
    if (this.committedDb) return this.committedDb;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed)) throw new Error("local database root must be an object");
      const db: LocalDbShape = {
        ...structuredClone(EMPTY_DB),
        devices: readRecordField<LocalDbShape["devices"]>(parsed, "devices"),
        deviceRegistry: readRecordField<NonNullable<LocalDbShape["deviceRegistry"]>>(parsed, "deviceRegistry"),
        series: readRecordField<LocalDbShape["series"]>(parsed, "series"),
        minuteHistory: readRecordField<LocalDbShape["minuteHistory"]>(parsed, "minuteHistory"),
        history: readRecordField<LocalDbShape["history"]>(parsed, "history"),
        fanNotes: readRecordField<LocalDbShape["fanNotes"]>(parsed, "fanNotes"),
        deviceMetricConfigs: readRecordField<LocalDbShape["deviceMetricConfigs"]>(parsed, "deviceMetricConfigs")
      };
      this.hasLegacyVirtualMachines = Object.hasOwn(parsed, "virtualMachines");
      this.committedDb = db;
      return db;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.committedDb = structuredClone(EMPTY_DB);
        return this.committedDb;
      }
      throw error;
    }
  }

  read() {
    return this.select((db) => db);
  }

  // Selectors are synchronous, read-only projections; clone only their result, not the database.
  select<T>(selector: (db: Readonly<LocalDbShape>) => T): Promise<T> {
    return this.enqueue(async () => structuredClone(selector(await this.load())));
  }

  update(mutator: (db: LocalDbShape) => void | Promise<void>) {
    return this.enqueue(() => this.commit(mutator));
  }

  updateWhen(needed: (db: Readonly<LocalDbShape>) => boolean, mutator: (db: LocalDbShape) => void | Promise<void>) {
    return this.enqueue(async () => {
      // Test the committed snapshot under the same queue before copying it.
      // A steady registration must not copy ninety days of fallback history.
      if (needed(await this.load())) await this.commit(mutator);
    });
  }

  // Queue-internal only. Mutators must not re-enter this store's queued public methods.
  private async commit(mutator: (db: LocalDbShape) => void | Promise<void>) {
    const draft = structuredClone(await this.load());
    await mutator(draft);
    const serialized = JSON.stringify(draft, null, 2);
    // Detach retained draft/input references and publish exactly the JSON persisted on disk.
    const committed = JSON.parse(serialized) as LocalDbShape;
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    this.committedDb = committed;
    this.hasLegacyVirtualMachines = false;
  }

  removeLegacyVirtualMachineData() {
    return this.enqueue(() => this.removeLegacyVirtualMachineDataInQueue());
  }

  private async removeLegacyVirtualMachineDataInQueue() {
    const db = await this.load();
    const isLegacyId = (id: string) => id.startsWith("vm:");
    const hasLegacyMetadata = (value: unknown) => {
      if (!isRecord(value)) return false;
      return value.instanceType === "virtual_machine"
        || "virtualMachine" in value
        || "virtualization" in value
        || "hostDeviceId" in value
        || "hostName" in value;
    };
    const isVirtualMachineState = (state: DeviceRealtimeState) => {
      const identity = state.identity as DeviceRealtimeState["identity"] & Record<string, unknown>;
      return state.identity.deviceId.startsWith("vm:")
        || identity.instanceType === "virtual_machine"
        || "virtualMachine" in identity;
    };
    const hasLegacyState = (state: DeviceRealtimeState) => isVirtualMachineState(state)
      || hasLegacyMetadata(state.identity)
      || hasLegacyMetadata(state.latest);
    const hasLegacyDetails = (point: TimeSeriesRecord) => hasLegacyMetadata(point)
      || hasLegacyMetadata(point.recordedDetails);
    let hasLegacyData = this.hasLegacyVirtualMachines;
    for (const [deviceId, state] of Object.entries(db.devices)) {
      if (isLegacyId(deviceId) || hasLegacyState(state)) hasLegacyData = true;
    }
    for (const [deviceId, record] of Object.entries(db.deviceRegistry ?? {})) {
      if (isLegacyId(deviceId) || hasLegacyMetadata(record)) hasLegacyData = true;
    }
    for (const [deviceId, buckets] of Object.entries(db.series)) {
      if (isLegacyId(deviceId)) hasLegacyData = true;
      for (const points of Object.values(buckets)) if (points.some(hasLegacyDetails)) hasLegacyData = true;
    }
    for (const map of [db.minuteHistory, db.history]) {
      if (Object.keys(map).some(isLegacyId)) hasLegacyData = true;
      for (const points of Object.values(map)) if (points.some(hasLegacyDetails)) hasLegacyData = true;
    }
    for (const [deviceId, config] of Object.entries(db.deviceMetricConfigs)) {
      if (isLegacyId(deviceId) || Object.keys(config.instanceMetricConfig ?? {}).some(isLegacyId)) hasLegacyData = true;
    }
    if (Object.keys(db.fanNotes).some(isLegacyId)) hasLegacyData = true;
    if (!hasLegacyData) return;

    await this.commit((current) => {
      const vmIds = new Set<string>();
      for (const [deviceId, state] of Object.entries(current.devices)) {
        if (isLegacyId(deviceId) || isVirtualMachineState(state)) vmIds.add(deviceId);
      }
      for (const [deviceId, record] of Object.entries(current.deviceRegistry ?? {})) {
        if (isLegacyId(deviceId) || hasLegacyMetadata(record)) vmIds.add(deviceId);
      }
      const removeIds = (map: Record<string, unknown>) => {
        for (const key of Object.keys(map)) if (isLegacyId(key) || vmIds.has(key)) delete map[key];
      };
      removeIds(current.devices);
      if (current.deviceRegistry) removeIds(current.deviceRegistry);
      removeIds(current.series);
      removeIds(current.minuteHistory);
      removeIds(current.history);
      removeIds(current.fanNotes);
      removeIds(current.deviceMetricConfigs);
      for (const state of Object.values(current.devices)) {
        const identity = state.identity as DeviceRealtimeState["identity"] & Record<string, unknown>;
        delete identity.instanceType;
        delete identity.hostDeviceId;
        delete identity.hostName;
        delete identity.virtualMachine;
        delete identity.virtualization;
        delete (state.latest as DeviceRealtimeState["latest"] & Record<string, unknown>).virtualization;
      }
      const stripPoint = (point: TimeSeriesRecord) => {
        delete (point.recordedDetails as (TimeSeriesRecord["recordedDetails"] & Record<string, unknown>) | undefined)?.virtualization;
        delete (point as TimeSeriesRecord & Record<string, unknown>).virtualization;
      };
      for (const buckets of Object.values(current.series)) for (const points of Object.values(buckets)) points.forEach(stripPoint);
      for (const points of [...Object.values(current.minuteHistory), ...Object.values(current.history)]) points.forEach(stripPoint);
      for (const config of Object.values(current.deviceMetricConfigs)) {
        if (config.instanceMetricConfig) {
          for (const id of Object.keys(config.instanceMetricConfig)) if (isLegacyId(id)) delete config.instanceMetricConfig[id];
        }
        delete (config as typeof config & Record<string, unknown>).virtualization;
      }
    });
  }
}

export class LocalRealtimeRepository implements RealtimeRepository {
  constructor(private readonly store: LocalJsonStore) {}

  async upsert(state: DeviceRealtimeState) {
    await this.store.update((db) => {
      db.devices[state.identity.deviceId] = state;
    });
  }

  async markOfflineIfMatch(
    deviceId: string,
    expectedLastSeenAt: string,
    offlineState: DeviceRealtimeState
  ): Promise<boolean> {
    let updated = false;
    await this.store.update((db) => {
      const current = db.devices[deviceId];
      if (current && current.lastSeenAt === expectedLastSeenAt) {
        db.devices[deviceId] = offlineState;
        updated = true;
      }
    });
    return updated;
  }

  async getDevice(deviceId: string) {
    return this.store.select((db) => db.devices[deviceId] ?? null);
  }

  async listDevices() {
    // The store-level sweep reads `db.devices` directly, so filtering here cannot hide anything
    // from it.
    return this.store.select((db) => Object.values(db.devices).filter((state) => !isLegacyVirtualMachineId(state.identity.deviceId)));
  }

  async remove(deviceId: string) {
    await this.store.update((db) => {
      delete db.devices[deviceId];
      delete db.series[deviceId];
    });
  }

  async appendSeries(deviceId: string, bucket: MetricWindow, point: TimeSeriesRecord, maxPoints: number) {
    await this.store.update((db) => {
      db.series[deviceId] ??= {};
      db.series[deviceId][bucket] ??= [];
      const existingIndex = db.series[deviceId][bucket].findIndex((item) => item.timestamp === point.timestamp);
      if (existingIndex >= 0) {
        db.series[deviceId][bucket][existingIndex] = point;
      } else {
        db.series[deviceId][bucket].push(point);
      }
      db.series[deviceId][bucket] = db.series[deviceId][bucket].slice(-maxPoints);
    });
  }

  async readSeries(deviceId: string, bucket: MetricWindow) {
    return this.store.select((db) => db.series[deviceId]?.[bucket] ?? []);
  }

  async clearSeries(deviceId: string) {
    await this.store.update((db) => {
      delete db.series[deviceId];
    });
  }
}

export class LocalHistoryRepository implements HistoryRepository {
  constructor(private readonly store: LocalJsonStore) {}

  async insertMinutePoint(deviceId: string, point: TimeSeriesRecord) {
    await this.store.update((db) => {
      db.minuteHistory[deviceId] ??= [];
      const existingIndex = db.minuteHistory[deviceId].findIndex((item) => item.timestamp === point.timestamp);
      if (existingIndex >= 0) {
        const existing = db.minuteHistory[deviceId][existingIndex];
        const existingCount = existing.sampleCount ?? 1;
        const newCount = point.sampleCount ?? 1;
        if (newCount >= existingCount) {
          db.minuteHistory[deviceId][existingIndex] = { ...point, sampleCount: Math.max(existingCount, newCount) };
        }
      } else {
        db.minuteHistory[deviceId].push(point);
        db.minuteHistory[deviceId].sort((a, b) => a.timestamp - b.timestamp);
      }
      db.minuteHistory[deviceId] = db.minuteHistory[deviceId].slice(-MAX_MINUTE_POINTS);
    });
  }

  async insertHourlyPoint(deviceId: string, point: TimeSeriesRecord) {
    await this.store.update((db) => {
      db.history[deviceId] ??= [];
      const existingIndex = db.history[deviceId].findIndex((item) => item.timestamp === point.timestamp);
      if (existingIndex >= 0) {
        const existing = db.history[deviceId][existingIndex];
        const existingCount = existing.sampleCount ?? 1;
        const newCount = point.sampleCount ?? 1;
        if (newCount >= existingCount) {
          db.history[deviceId][existingIndex] = { ...point, sampleCount: Math.max(existingCount, newCount) };
        }
      } else {
        db.history[deviceId].push(point);
        db.history[deviceId].sort((a, b) => a.timestamp - b.timestamp);
      }
      db.history[deviceId] = db.history[deviceId].slice(-MAX_HOURLY_POINTS);
    });
  }

  async runRetentionCleanup() {
    const now = Date.now();
    const minuteThreshold = now - MINUTE_RETENTION_MS;
    const hourlyThreshold = now - HOURLY_RETENTION_MS;
    await this.store.update((db) => {
      for (const [deviceId, points] of Object.entries(db.minuteHistory)) {
        const retained = points.filter((point) => point.timestamp >= minuteThreshold).slice(-MAX_MINUTE_POINTS);
        if (retained.length) db.minuteHistory[deviceId] = retained;
        else delete db.minuteHistory[deviceId];
      }
      for (const [deviceId, points] of Object.entries(db.history)) {
        const retained = points.filter((point) => point.timestamp >= hourlyThreshold).slice(-MAX_HOURLY_POINTS);
        if (retained.length) db.history[deviceId] = retained;
        else delete db.history[deviceId];
      }
    });
  }

  async getHistoricalSeries(deviceId: string, bucket: MetricWindow) {
    return this.store.select((db) => {
      if (bucket === "1m" || bucket === "5m") {
        return [];
      }
      if (bucket === "15m" || bucket === "1h" || bucket === "6h" || bucket === "24h" || bucket === "1d") {
        const points = db.minuteHistory[deviceId] ?? [];
        const durationMs =
          bucket === "15m" ? 15 * 60 * 1000 :
          bucket === "1h" ? 60 * 60 * 1000 :
          bucket === "6h" ? 6 * 60 * 60 * 1000 :
          24 * 60 * 60 * 1000;
        const threshold = Date.now() - durationMs;
        return points.filter((point) => point.timestamp >= threshold);
      }
      const points = db.history[deviceId] ?? [];
      const hours = bucket === "7d" || bucket === "1w" ? 24 * 7 :
        bucket === "30d" || bucket === "1mo" ? 24 * 31 :
        bucket === "90d" ? 24 * 90 : 24 * 366;
      const threshold = Date.now() - hours * 60 * 60 * 1000;
      return points.filter((point) => point.timestamp >= threshold);
    });
  }

  async getTrafficSeries(deviceId: string, start: number, end: number) {
    return this.store.select((db) => {
      const threshold = Math.max(start, Date.now() - 366 * 24 * 60 * 60 * 1000);
      return (db.history[deviceId] ?? [])
        .filter((point) => point.timestamp >= threshold && point.timestamp < end)
        .map(({ timestamp, trafficRxBytes, trafficTxBytes }) => ({ timestamp, trafficRxBytes, trafficTxBytes }));
    });
  }

  async clearDeviceHistory(deviceId: string) {
    await this.store.update((db) => {
      delete db.minuteHistory[deviceId];
      delete db.history[deviceId];
    });
  }

  async listKnownDevices() {
    return this.store.select((db) => {
      const all = new Map<string, TimeSeriesRecord[]>();
      for (const [deviceId, points] of Object.entries(db.minuteHistory)) all.set(deviceId, [...points]);
      for (const [deviceId, points] of Object.entries(db.history)) {
        all.set(deviceId, [...(all.get(deviceId) ?? []), ...points]);
      }
      return [...all.entries()]
        .filter(([, points]) => points.length > 0)
        .map(([deviceId, points]) => ({
          deviceId,
          lastSeenAt: new Date(Math.max(...points.map((point) => point.timestamp))).toISOString()
        }));
    });
  }

  async getTrafficCalendar(
    deviceId: string,
    mode: TrafficCalendarMode,
    anchorDate: string,
    selectedStart?: string
  ): Promise<TrafficCalendarResponse> {
    return this.store.select((db) => {
      const realtimePoints = [
        ...(db.minuteHistory[deviceId] ?? []),
        ...(db.series[deviceId]?.["1m"] ?? []),
        ...(db.series[deviceId]?.["15m"] ?? []),
        ...(db.history[deviceId] ?? [])
      ].sort((a, b) => a.timestamp - b.timestamp);
      return buildTrafficCalendar(realtimePoints, mode, anchorDate, selectedStart);
    });
  }
}

export class LocalFanNoteStore implements FanNoteStore {
  constructor(private readonly store: LocalJsonStore) {}

  async get(deviceId: string) {
    return this.store.select((db) => db.fanNotes[deviceId] ?? {});
  }

  async set(deviceId: string, fanId: string, note: string) {
    await this.store.update((db) => {
      db.fanNotes[deviceId] ??= {};
      db.fanNotes[deviceId][fanId] = note;
    });
  }
}

export class LocalDeviceMetricConfigStore implements DeviceMetricConfigStore {
  constructor(private readonly store: LocalJsonStore) {}

  async get(deviceId: string) {
    return this.store.select((db) => db.deviceMetricConfigs[deviceId] ?? null);
  }

  async set(deviceId: string, value: DeviceMetricConfigValue) {
    await this.store.update((db) => {
      db.deviceMetricConfigs[deviceId] = {
        enabledMetrics: [...new Set(value.enabledMetrics)],
        enabledDeviceIds: value.enabledDeviceIds ?? {},
        instanceMetricConfig: Object.fromEntries(
          Object.entries(value.instanceMetricConfig ?? {}).map(([instanceId, metrics]) => [
            instanceId,
            [...new Set(metrics)]
          ])
        )
      };
    });
  }
}

export class LocalDeviceRepository implements DeviceRepository {
  constructor(private readonly store: LocalJsonStore) {}

  async registerOrUpdateDevice(
    deviceId: string,
    name?: string,
    options?: DeviceRegistrationOptions
  ): Promise<DeviceRecord> {
    if (isLegacyVirtualMachineId(deviceId)) return legacyVirtualMachineRecord(deviceId);

    let resultRecord!: DeviceRecord;
    await this.store.updateWhen((db) => {
      const existing = db.deviceRegistry?.[deviceId];
      if (existing && (existing.status === "closed" && !options?.reopenClosed
        || options?.skipUnchanged && existing.status === "open" && (!name || name === existing.name))) {
        resultRecord = { ...existing };
        return false;
      }
      return true;
    }, (db) => {
      const registry = (db.deviceRegistry ??= {});
      const now = new Date().toISOString();
      const existing = registry[deviceId];

      if (existing) {
        existing.status = "open";
        existing.updatedAt = now;
        if (name) existing.name = name;
        resultRecord = { ...existing };
      } else {
        const allDevices = Object.values(registry);
        const maxSortOrder = allDevices.reduce((max, d) => Math.max(max, d.sortOrder ?? 0), -1);
        const newRecord: DeviceRecord = {
          deviceId,
          name: name || deviceId,
          status: "open",
          sortOrder: maxSortOrder + 1,
          group: null,
          registeredAt: now,
          updatedAt: now
        };
        registry[deviceId] = newRecord;
        resultRecord = { ...newRecord };
      }
    });
    return resultRecord;
  }

  async listOpenDevices(): Promise<DeviceRecord[]> {
    return this.store.select((db) => Object.values(db.deviceRegistry ?? {})
      .filter((d) => d.status === "open" && !isLegacyVirtualMachineId(d.deviceId))
      .map((d) => ({ ...d, group: d.group ?? null }))
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.deviceId.localeCompare(b.deviceId)));
  }

  async deleteDevice(deviceId: string): Promise<void> {
    // The registry write below creates a row when one is missing, so a legacy id would be
    // resurrected by the very call meant to hide it.
    if (isLegacyVirtualMachineId(deviceId)) return;
    await this.store.update((db) => {
      const registry = (db.deviceRegistry ??= {});
      if (registry[deviceId]) {
        registry[deviceId].status = "closed";
        registry[deviceId].updatedAt = new Date().toISOString();
      } else {
        registry[deviceId] = {
          deviceId,
          name: deviceId,
          status: "closed",
          sortOrder: 0,
          group: null,
          registeredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      delete db.devices[deviceId];
    });
  }

  async reorderDevices(deviceIds: string[]): Promise<void> {
    await this.store.update((db) => {
      const registry = (db.deviceRegistry ??= {});
      const now = new Date().toISOString();
      deviceIds.forEach((id, index) => {
        const item = registry[id];
        if (item) {
          item.sortOrder = index;
          item.updatedAt = now;
        }
      });
    });
  }

  async updateDeviceGroup(deviceIds: string[], group: string | null): Promise<void> {
    const normalizedGroup = group?.trim() ? group.trim().slice(0, 64) : null;
    await this.store.update((db) => {
      const registry = (db.deviceRegistry ??= {});
      const now = new Date().toISOString();
      for (const id of deviceIds) {
        if (isLegacyVirtualMachineId(id)) continue;
        const item = registry[id];
        if (item) {
          item.group = normalizedGroup;
          item.updatedAt = now;
        } else {
          const allDevices = Object.values(registry);
          const maxSortOrder = allDevices.reduce((max, d) => Math.max(max, d.sortOrder ?? 0), -1);
          registry[id] = {
            deviceId: id,
            name: db.devices[id]?.identity.hostname || id,
            status: "open",
            sortOrder: maxSortOrder + 1,
            group: normalizedGroup,
            registeredAt: now,
            updatedAt: now
          };
        }
      }
    });
  }
}

export function createLocalStore(filePath?: string) {
  return new LocalJsonStore(filePath);
}
