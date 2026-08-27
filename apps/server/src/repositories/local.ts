import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { DeviceBlockKey, DeviceMetricKey, MetricWindow, WidgetLayoutDocument, WidgetLayoutSaveRequest, WidgetLayoutSync, WidgetLayoutTemplate } from "@dsc/shared";
import type { TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import type {
  DeviceRecord,
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
import type { VirtualMachineRecord, VirtualMachineRegistration, VirtualMachineRepository } from "./virtual-machines.js";
import { buildTrafficCalendar } from "../traffic-calendar.js";

export interface LocalWidgetLayoutSnapshot {
  instances: Record<string, { templateKey: string; updatedAt: string; layout: WidgetLayoutDocument }>;
  templates: Record<string, Record<string, WidgetLayoutTemplate>>;
}

interface LocalDbShape {
  devices: Record<string, DeviceRealtimeState>;
  deviceRegistry?: Record<string, DeviceRecord>;
  virtualMachines: Record<string, VirtualMachineRecord>;
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
  virtualMachines: {},
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
        virtualMachines: readRecordField<LocalDbShape["virtualMachines"]>(parsed, "virtualMachines"),
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
}

export class LocalRealtimeRepository implements RealtimeRepository {
  constructor(private readonly store: LocalJsonStore) {}

  async upsert(state: DeviceRealtimeState) {
    await this.store.update((db) => {
      db.devices[state.identity.deviceId] = state;
    });
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
        db.minuteHistory[deviceId][existingIndex] = point;
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
        db.history[deviceId][existingIndex] = point;
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

  async registerOrUpdateDevice(deviceId: string, name?: string): Promise<DeviceRecord> {
    let resultRecord!: DeviceRecord;
    await this.store.update((db) => {
      const registry = (db.deviceRegistry ??= {});
      const now = new Date().toISOString();
      const existing = registry[deviceId];

      if (existing) {
        if (existing.status === "closed") {
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

export class LocalVirtualMachineRepository implements VirtualMachineRepository {
  constructor(private readonly store: LocalJsonStore) {}

  async registerOrUpdate(input: VirtualMachineRegistration): Promise<VirtualMachineRecord> {
    let result!: VirtualMachineRecord;
    await this.store.update((db) => {
      const registry = (db.virtualMachines ??= {});
      const existing = Object.values(registry).find(
        (item) => item.virtualMachineId === input.virtualMachineId ||
          (item.scopeKey === input.scopeKey && item.externalId === input.externalId)
      );
      const now = input.observedAt;
      if (existing) {
        existing.scopeKey = input.scopeKey;
        existing.externalId = input.externalId;
        existing.platform = input.platform;
        existing.name = input.name;
        existing.hostDeviceId = input.hostDeviceId;
        existing.hostName = input.hostName;
        existing.node = input.node ?? null;
        existing.type = input.type ?? null;
        existing.powerState = input.powerState;
        existing.status = "open";
        existing.updatedAt = now;
        existing.lastSeenAt = now;
        result = { ...existing };
        return;
      }

      const maxSortOrder = Object.values(registry).reduce((max, item) => Math.max(max, item.sortOrder ?? 0), -1);
      const record: VirtualMachineRecord = {
        virtualMachineId: input.virtualMachineId,
        scopeKey: input.scopeKey,
        externalId: input.externalId,
        platform: input.platform,
        name: input.name,
        hostDeviceId: input.hostDeviceId,
        hostName: input.hostName,
        node: input.node ?? null,
        type: input.type ?? null,
        powerState: input.powerState,
        status: "open",
        sortOrder: maxSortOrder + 1,
        registeredAt: now,
        updatedAt: now,
        lastSeenAt: now
      };
      registry[record.virtualMachineId] = record;
      result = { ...record };
    });
    return result;
  }

  async listOpen(): Promise<VirtualMachineRecord[]> {
    const db = await this.store.read();
    return Object.values(db.virtualMachines ?? {})
      .filter((item) => item.status === "open")
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.virtualMachineId.localeCompare(b.virtualMachineId));
  }

  async reconcile(scopeKey: string, observedVirtualMachineIds: string[], observedAt: string): Promise<string[]> {
    const observed = new Set(observedVirtualMachineIds);
    const closedIds: string[] = [];
    await this.store.update((db) => {
      for (const record of Object.values(db.virtualMachines ?? {})) {
        if (record.status === "open" && record.scopeKey === scopeKey && !observed.has(record.virtualMachineId)) {
          record.status = "closed";
          record.updatedAt = observedAt;
          closedIds.push(record.virtualMachineId);
        }
      }
    });
    return closedIds;
  }

  async delete(virtualMachineId: string): Promise<void> {
    await this.store.update((db) => {
      const registry = (db.virtualMachines ??= {});
      const record = registry[virtualMachineId];
      if (record) {
        record.status = "closed";
        record.updatedAt = new Date().toISOString();
      }
    });
  }

  async reorder(virtualMachineIds: string[]): Promise<void> {
    await this.store.update((db) => {
      const registry = (db.virtualMachines ??= {});
      const now = new Date().toISOString();
      virtualMachineIds.forEach((id, index) => {
        const record = registry[id];
        if (record) {
          record.sortOrder = index;
          record.updatedAt = now;
        }
      });
    });
  }
}

export function createLocalStore(filePath?: string) {
  return new LocalJsonStore(filePath);
}
