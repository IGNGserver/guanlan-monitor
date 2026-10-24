import { createHash } from "node:crypto";
import { averageRecord } from "./services/metrics.js";
import type { TimeSeriesRecord } from "./types.js";

/**
 * OFF-PATH EXPERIMENT ONLY. No service/repository imports this module.
 * This is snapshot memoization, NOT an incremental sum: subtraction/readdition
 * cannot preserve the oracle's floating-point reduction order. Instances,
 * observations, quality, counters and sampleCount all remain oracle-owned.
 * The caps reproduce existing accumulator caps; they are not a retention policy
 * and do not authorize dropping production points or replacing any storage path.
 */
export class CachedMetricAccumulator {
  readonly #samples = new Map<number, TimeSeriesRecord>();
  readonly #bucketStartedAt: number;
  readonly #maxSamples: number;
  #revision = 0;
  #cachedRevision = -1;
  #cached: TimeSeriesRecord | undefined;
  #averageComputations = 0;

  constructor(bucketStartedAt: number, window: "minute" | "hour") {
    if (!Number.isFinite(bucketStartedAt)) throw new RangeError("bucket timestamp must be finite");
    if (window !== "minute" && window !== "hour") throw new RangeError("unknown accumulator window");
    this.#bucketStartedAt = bucketStartedAt;
    this.#maxSamples = window === "minute" ? 256 : 4_096;
  }

  get bucketStartedAt() { return this.#bucketStartedAt; }
  get maxSamples() { return this.#maxSamples; }
  get size() { return this.#samples.size; }
  get revision() { return this.#revision; }
  /** Diagnostic count, not a benchmark or production instrumentation. */
  get averageComputations() { return this.#averageComputations; }

  append(point: TimeSeriesRecord): void {
    if (!Number.isFinite(point.timestamp)) throw new RangeError("sample timestamp must be finite");
    // Own every input snapshot. In particular, never skip a same-object append:
    // object identity alone does not prove that a caller kept it immutable.
    const snapshot = structuredClone(point);
    if (!this.#samples.has(snapshot.timestamp) && this.#samples.size >= this.#maxSamples) {
      this.#samples.delete(this.#samples.keys().next().value!);
    }
    // Map.set replaces in place, preserving first insertion order (not time sort).
    this.#samples.set(snapshot.timestamp, snapshot);
    this.#revision += 1;
    this.#cached = undefined;
  }

  read(): TimeSeriesRecord | undefined {
    if (!this.#samples.size) return undefined;
    if (this.#cachedRevision !== this.#revision) {
      this.#cached = structuredClone(averageRecord([...this.#samples.values()], this.#bucketStartedAt));
      this.#cachedRevision = this.#revision;
      this.#averageComputations += 1;
    }
    // The cache and stored input graphs never escape, even through nested details.
    return structuredClone(this.#cached);
  }
}

type MetadataScalar = string | number | boolean | null | undefined;
type MetadataPath = Array<string | number>;
export interface RecordMetadataEntry {
  path: MetadataPath;
  fields: Record<string, MetadataScalar>;
}

export interface SplitRecordMetadata<T extends TimeSeriesRecord = TimeSeriesRecord> {
  schemaVersion: 1;
  metadataVersion: string;
  /** An owned record with only explicitly allowlisted hardware fields removed. */
  dynamicRecord: T;
}

export class MetadataVersionMissingError extends Error {
  constructor(version: string) {
    super(`metadata version missing or evicted: ${version}`);
    this.name = "MetadataVersionMissingError";
  }
}

/** Typed canonical encoding retains undefined, -0 and non-finite numbers. */
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number") return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
  if (typeof value === "string" || typeof value === "boolean") return `${typeof value}:${JSON.stringify(value)}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new TypeError("unsupported metadata value");
}

/**
 * Bounded in-memory FIFO dictionary, scoped by the experiment's caller.
 * An evicted reference fails loudly; this is NOT a durable storage protocol.
 * Production would need transactional reference lifetime/GC and migration rules.
 */
export class RecordMetadataDictionary {
  readonly #versions = new Map<string, { canonical: string; entries: RecordMetadataEntry[] }>();
  readonly #maxVersions: number;

  constructor(maxVersions = 256) {
    if (!Number.isSafeInteger(maxVersions) || maxVersions < 1) throw new RangeError("maxVersions must be a positive safe integer");
    this.#maxVersions = maxVersions;
  }

  get size() { return this.#versions.size; }
  get maxVersions() { return this.#maxVersions; }

  intern(entries: RecordMetadataEntry[]): string {
    const snapshot = structuredClone(entries);
    const encoded = canonical(snapshot);
    const version = `v1:sha256:${createHash("sha256").update(encoded).digest("hex")}`;
    const existing = this.#versions.get(version);
    if (existing) {
      if (existing.canonical !== encoded) throw new Error("metadata hash collision");
      return version;
    }
    if (this.#versions.size >= this.#maxVersions) this.#versions.delete(this.#versions.keys().next().value!);
    this.#versions.set(version, { canonical: encoded, entries: snapshot });
    return version;
  }

  resolve(version: string): RecordMetadataEntry[] {
    const found = this.#versions.get(version);
    if (!found) throw new MetadataVersionMissingError(version);
    return structuredClone(found.entries);
  }
}

// Deliberately narrow: never move readings, capacities/topology counts, addresses,
// timestamps, quality, status, configuration, or unknown fields into metadata.
const HARDWARE_FIELDS = new Set([
  "id", "hardwareId", "hardwareid", "name", "label", "model", "unit", "source", "sourceKey",
  "vendor", "physicalDevice", "interface", "interfaceType", "mountPoint", "filesystem", "temperatureSource", "rawName"
]);
const HARDWARE_COLLECTIONS: MetadataPath[] = [
  ...["cpus", "disks", "networks", "gpus", "fans"].map((key) => [key]),
  ...["cpuPackages", "disks", "storagePools", "networkInterfaces", "gpus", "fans", "temperatureSensors"]
    .map((key) => ["recordedDetails", key]),
  ...["cpus", "networks", "fans"].map((key) => ["recordedDetails", "aggregatedInstances", key])
];

function objectAt(root: unknown, path: MetadataPath): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

/** Lossless in-memory split; not a JSON codec, schema migration, or MySQL binding. */
export function splitRecordMetadata<T extends TimeSeriesRecord>(record: T, dictionary: RecordMetadataDictionary): SplitRecordMetadata<T> {
  const dynamicRecord = structuredClone(record);
  const entries: RecordMetadataEntry[] = [];
  for (const path of HARDWARE_COLLECTIONS) {
    const collection = objectAt(dynamicRecord, path);
    if (!Array.isArray(collection)) continue;
    collection.forEach((item: unknown, index) => {
      if (!isPlainObject(item)) return;
      const fields: Record<string, MetadataScalar> = {};
      for (const key of Object.keys(item).sort()) {
        const value = item[key];
        if (!HARDWARE_FIELDS.has(key) || (value !== null && typeof value === "object") ||
          !["string", "number", "boolean", "undefined", "object"].includes(typeof value)) continue;
        fields[key] = value as MetadataScalar;
        delete item[key];
      }
      if (Object.keys(fields).length) entries.push({ path: [...path, index], fields });
    });
  }
  return { schemaVersion: 1, metadataVersion: dictionary.intern(entries), dynamicRecord };
}

export function hydrateRecordMetadata<T extends TimeSeriesRecord>(split: SplitRecordMetadata<T>, dictionary: RecordMetadataDictionary): T {
  if (split.schemaVersion !== 1) throw new Error("unsupported metadata schema version");
  const entries = dictionary.resolve(split.metadataVersion);
  const result = structuredClone(split.dynamicRecord);
  for (const { path, fields } of entries) {
    const target = objectAt(result, path);
    if (!isPlainObject(target)) throw new Error("metadata target missing or invalid");
    for (const [key, value] of Object.entries(fields)) {
      if (!HARDWARE_FIELDS.has(key) || Object.hasOwn(target, key)) throw new Error("metadata field conflict");
      Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  return result;
}
