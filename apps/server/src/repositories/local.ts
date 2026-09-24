import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { DeviceBlockKey, DeviceMetricKey, MetricWindow, WidgetLayoutDocument, WidgetLayoutSaveRequest, WidgetLayoutSync, WidgetLayoutTemplate } from "@dsc/shared";
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
  TimeSeriesRecord,
  WidgetLayoutStore
} from "../types.js";
import { buildTrafficCalendar } from "../traffic-calendar.js";

export interface LocalWidgetLayoutSnapshot {
  instances: Record<string, { templateKey: string; updatedAt: string; layout: WidgetLayoutDocument }>;
  templates: Record<string, Record<string, WidgetLayoutTemplate>>;
}

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
  widgetLayouts?: LocalWidgetLayoutSnapshot;
}

const EMPTY_DB: LocalDbShape = {
  devices: {},
  deviceRegistry: {},
  series: {},
  minuteHistory: {},
  history: {},
  fanNotes: {},
  deviceMetricConfigs: {},
  widgetLayouts: { instances: {}, templates: {} }
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

function emptyWidgetLayouts(): LocalWidgetLayoutSnapshot {
  return { instances: {}, templates: {} };
}

function readWidgetLayouts(value: unknown): LocalWidgetLayoutSnapshot {
  if (!isRecord(value)) throw new Error("local database field widgetLayouts must be an object");
  return {
    instances: readRecordField<LocalWidgetLayoutSnapshot["instances"]>(value, "instances"),
    templates: readRecordField<LocalWidgetLayoutSnapshot["templates"]>(value, "templates")
  };
}

function setLocalWidgetInstance(
  layouts: LocalWidgetLayoutSnapshot,
  scopeKey: string,
  templateKey: string,
  instanceLayout: WidgetLayoutDocument | null
) {
  if (instanceLayout === null) {
    delete layouts.instances[scopeKey];
    return;
  }
  layouts.instances[scopeKey] = {
    templateKey,
    updatedAt: new Date().toISOString(),
    layout: structuredClone(instanceLayout)
  };
}

class LocalJsonStore {
  private readonly filePath: string;
  private writeQueue = Promise.resolve();

  constructor(filePath = resolve(process.cwd(), "data", "local-db.json")) {
    this.filePath = filePath;
  }

  async read() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed)) throw new Error("local database root must be an object");
      return {
        ...structuredClone(EMPTY_DB),
        devices: readRecordField<LocalDbShape["devices"]>(parsed, "devices"),
        deviceRegistry: readRecordField<NonNullable<LocalDbShape["deviceRegistry"]>>(parsed, "deviceRegistry"),
        series: readRecordField<LocalDbShape["series"]>(parsed, "series"),
        minuteHistory: readRecordField<LocalDbShape["minuteHistory"]>(parsed, "minuteHistory"),
        history: readRecordField<LocalDbShape["history"]>(parsed, "history"),
        fanNotes: readRecordField<LocalDbShape["fanNotes"]>(parsed, "fanNotes"),
        deviceMetricConfigs: readRecordField<LocalDbShape["deviceMetricConfigs"]>(parsed, "deviceMetricConfigs"),
        widgetLayouts: parsed.widgetLayouts === undefined
          ? structuredClone(EMPTY_DB.widgetLayouts)
          : readWidgetLayouts(parsed.widgetLayouts)
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_DB);
      throw error;
    }
  }

  async update(mutator: (db: LocalDbShape) => void | Promise<void>) {
    const operation = this.writeQueue.then(async () => {
      const db = await this.read();
      await mutator(db);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, JSON.stringify(db, null, 2), { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, this.filePath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async removeLegacyVirtualMachineData() {
    const db = await this.read();
    const isLegacyId = (id: string) => id.startsWith("vm:");
    const hasLegacyMetadata = (value: unknown) => {
      if (!isRecord(value)) return false;
      return value.instanceType === "virtual_machine"
        || "virtualMachine" in value
        || "virtualization" in value
        || "storagePools" in value
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
    let hasLegacyData = false;
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
    if (db.widgetLayouts) {
      if (Object.keys(db.widgetLayouts.instances).some((key) => key.includes("vm:") || key.includes("virtual_machine"))) hasLegacyData = true;
      if (Object.keys(db.widgetLayouts.templates).some((key) => key.includes("virtual_machine"))) hasLegacyData = true;
    }
    const raw = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed) && Object.hasOwn(parsed, "virtualMachines")) hasLegacyData = true;
    }
    if (!hasLegacyData) return;

    await this.update((current) => {
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
        delete (state.latest as DeviceRealtimeState["latest"] & Record<string, unknown>).storagePools;
      }
      const stripPoint = (point: TimeSeriesRecord) => {
        delete (point.recordedDetails as (TimeSeriesRecord["recordedDetails"] & Record<string, unknown>) | undefined)?.virtualization;
        delete (point.recordedDetails as (TimeSeriesRecord["recordedDetails"] & Record<string, unknown>) | undefined)?.storagePools;
        delete (point as TimeSeriesRecord & Record<string, unknown>).virtualization;
        delete (point as TimeSeriesRecord & Record<string, unknown>).storagePools;
      };
      for (const buckets of Object.values(current.series)) for (const points of Object.values(buckets)) points.forEach(stripPoint);
      for (const points of [...Object.values(current.minuteHistory), ...Object.values(current.history)]) points.forEach(stripPoint);
      for (const config of Object.values(current.deviceMetricConfigs)) {
        if (config.instanceMetricConfig) {
          for (const id of Object.keys(config.instanceMetricConfig)) if (isLegacyId(id)) delete config.instanceMetricConfig[id];
        }
        delete (config as typeof config & Record<string, unknown>).virtualization;
      }
      if (current.widgetLayouts) {
        for (const [scopeKey, layout] of Object.entries(current.widgetLayouts.instances)) {
          if (scopeKey.includes("vm:") || layout.templateKey.includes("virtual_machine")) delete current.widgetLayouts.instances[scopeKey];
        }
        for (const templateKey of Object.keys(current.widgetLayouts.templates)) {
          if (templateKey.includes("virtual_machine")) delete current.widgetLayouts.templates[templateKey];
        }
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

  async markOfflineIfMatch(deviceId: string, expectedLastSeenAt: string): Promise<boolean> {
    let updated = false;
    await this.store.update((db) => {
      const current = db.devices[deviceId];
      if (current && current.lastSeenAt === expectedLastSeenAt) {
        db.devices[deviceId] = { ...current, status: "offline" };
        updated = true;
      }
    });
    return updated;
  }

  async getDevice(deviceId: string) {
    const db = await this.store.read();
    return db.devices[deviceId] ?? null;
  }

  async listDevices() {
    const db = await this.store.read();
    return Object.values(db.devices);
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
    const db = await this.store.read();
    return db.series[deviceId]?.[bucket] ?? [];
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
    const db = await this.store.read();
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
  }

  async clearDeviceHistory(deviceId: string) {
    await this.store.update((db) => {
      delete db.minuteHistory[deviceId];
      delete db.history[deviceId];
    });
  }

  async listKnownDevices() {
    const db = await this.store.read();
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
  }

  async getTrafficCalendar(
    deviceId: string,
    mode: TrafficCalendarMode,
    anchorDate: string,
    selectedStart?: string
  ): Promise<TrafficCalendarResponse> {
    const db = await this.store.read();
    const realtimePoints = [
      ...(db.minuteHistory[deviceId] ?? []),
      ...(db.series[deviceId]?.["1m"] ?? []),
      ...(db.series[deviceId]?.["15m"] ?? []),
      ...(db.history[deviceId] ?? [])
    ].sort((a, b) => a.timestamp - b.timestamp);
    return buildTrafficCalendar(realtimePoints, mode, anchorDate, selectedStart);
  }
}

export class LocalFanNoteStore implements FanNoteStore {
  constructor(private readonly store: LocalJsonStore) {}

  async get(deviceId: string) {
    const db = await this.store.read();
    return db.fanNotes[deviceId] ?? {};
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
    const db = await this.store.read();
    return db.deviceMetricConfigs[deviceId] ?? null;
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

export class LocalWidgetLayoutStore implements WidgetLayoutStore {
  constructor(private readonly store: LocalJsonStore) {}

  async get(scopeKey: string, templateKey: string): Promise<WidgetLayoutSync> {
    const db = await this.store.read();
    const layouts = db.widgetLayouts ?? emptyWidgetLayouts();
    const instance = layouts.instances[scopeKey];
    return {
      scopeKey,
      templateKey,
      instanceLayout: instance?.templateKey === templateKey ? structuredClone(instance.layout) : null,
      templates: Object.values(layouts.templates[templateKey] ?? {})
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((template) => structuredClone(template))
    };
  }

  async readAll(): Promise<LocalWidgetLayoutSnapshot> {
    const db = await this.store.read();
    return structuredClone(db.widgetLayouts ?? emptyWidgetLayouts());
  }

  async save(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync> {
    const instanceLayout = request.instanceLayout;
    const templateRequest = request.template;
    await this.store.update((db) => {
      const layouts = (db.widgetLayouts ??= emptyWidgetLayouts());
      if (Object.prototype.hasOwnProperty.call(request, "instanceLayout")) {
        if (instanceLayout === null) delete layouts.instances[request.scopeKey];
        else if (instanceLayout) setLocalWidgetInstance(layouts, request.scopeKey, request.templateKey, instanceLayout);
      }

      if (request.linkedInstance) {
        setLocalWidgetInstance(
          layouts,
          request.linkedInstance.scopeKey,
          request.linkedInstance.templateKey,
          request.linkedInstance.instanceLayout
        );
      }

      if (templateRequest) {
        const templates = (layouts.templates[request.templateKey] ??= {});
        const now = new Date().toISOString();
        const id = templateRequest.id?.trim() || randomUUID();
        const existing = templates[id];
        templates[id] = {
          id,
          name: templateRequest.name.trim(),
          templateKey: request.templateKey,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          layout: structuredClone(templateRequest.layout)
        };
      }

      if (request.deleteTemplateId) delete layouts.templates[request.templateKey]?.[request.deleteTemplateId];
    });
    return this.get(request.scopeKey, request.templateKey);
  }
}

export class LocalDeviceRepository implements DeviceRepository {
  constructor(private readonly store: LocalJsonStore) {}

  async registerOrUpdateDevice(
    deviceId: string,
    name?: string,
    options?: DeviceRegistrationOptions
  ): Promise<DeviceRecord> {
    let resultRecord!: DeviceRecord;
    await this.store.update((db) => {
      const registry = (db.deviceRegistry ??= {});
      const now = new Date().toISOString();
      const existing = registry[deviceId];

      if (existing) {
        if (existing.status === "closed" && !options?.reopenClosed) {
          resultRecord = { ...existing };
          return;
        }
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
    const db = await this.store.read();
    const registry = db.deviceRegistry ?? {};
    return Object.values(registry)
      .filter((d) => d.status === "open")
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.deviceId.localeCompare(b.deviceId));
  }

  async deleteDevice(deviceId: string): Promise<void> {
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
}

export function createLocalStore(filePath?: string) {
  return new LocalJsonStore(filePath);
}
