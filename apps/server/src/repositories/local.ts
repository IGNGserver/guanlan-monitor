import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DeviceBlockKey, DeviceMetricKey, MetricWindow } from "@dsc/shared";
import type { TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import type {
  DeviceMetricConfigValue,
  DeviceMetricConfigStore,
  DeviceRealtimeState,
  FanNoteStore,
  HistoryRepository,
  RealtimeRepository,
  TimeSeriesRecord
} from "../types.js";
import { buildTrafficCalendar } from "../traffic-calendar.js";

interface LocalDbShape {
  devices: Record<string, DeviceRealtimeState>;
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
  series: {},
  minuteHistory: {},
  history: {},
  fanNotes: {},
  deviceMetricConfigs: {}
};

class LocalJsonStore {
  private readonly filePath: string;
  private writeQueue = Promise.resolve();

  constructor(filePath = resolve(process.cwd(), "data", "local-db.json")) {
    this.filePath = filePath;
  }

  async read() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return { ...EMPTY_DB, ...JSON.parse(raw) } as LocalDbShape;
    } catch {
      return structuredClone(EMPTY_DB);
    }
  }

  async update(mutator: (db: LocalDbShape) => void | Promise<void>) {
    this.writeQueue = this.writeQueue.then(async () => {
      const db = await this.read();
      await mutator(db);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(db, null, 2), "utf8");
    });
    return this.writeQueue;
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

  async appendSeries(deviceId: string, bucket: MetricWindow, point: TimeSeriesRecord, maxPoints: number) {
    await this.store.update((db) => {
      db.series[deviceId] ??= {};
      db.series[deviceId][bucket] ??= [];
      db.series[deviceId][bucket].push(point);
      db.series[deviceId][bucket] = db.series[deviceId][bucket].slice(-maxPoints);
    });
  }

  async readSeries(deviceId: string, bucket: MetricWindow) {
    const db = await this.store.read();
    return db.series[deviceId]?.[bucket] ?? [];
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
        db.minuteHistory[deviceId] = db.minuteHistory[deviceId].slice(-60 * 24 * 90);
      }
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
    });
  }

  async getHistoricalSeries(deviceId: string, bucket: MetricWindow) {
    const db = await this.store.read();
    if (bucket === "1m" || bucket === "15m") {
      return [];
    }
    if (bucket === "1d") {
      const points = db.minuteHistory[deviceId] ?? [];
      const threshold = Date.now() - 24 * 60 * 60 * 1000;
      return points.filter((point) => point.timestamp >= threshold);
    }
    const points = db.history[deviceId] ?? [];
    const hours = bucket === "1w" ? 24 * 7 : bucket === "1mo" ? 24 * 31 : 24 * 366;
    const threshold = Date.now() - hours * 60 * 60 * 1000;
    return points.filter((point) => point.timestamp >= threshold);
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

export function createLocalStore(filePath?: string) {
  return new LocalJsonStore(filePath);
}
