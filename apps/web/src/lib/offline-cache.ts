import type { ConsoleSnapshot, ConsoleSnapshotRequest } from "@dsc/shared";
import { restoreSnapshotView, saveSnapshotView, type SnapshotRecord } from "./offline-snapshot";

const DATABASE = "guanlan-web-offline-v1";
const STORE = "snapshots";
/** A single active authenticated-session scope; no access key/cookie is stored. */
export class OfflineSnapshotCache {
  private record: SnapshotRecord | null = null;
  private loaded = false;
  private epoch = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private async database(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") throw new Error("offline_storage_unavailable");
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DATABASE, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("offline_storage_blocked"));
    });
  }
  private async read(): Promise<void> {
    if (this.loaded) return;
    const epoch = this.epoch;
    try {
      const db = await this.database();
      const value = await new Promise<SnapshotRecord | null>((resolve, reject) => {
        const read = db.transaction(STORE, "readonly").objectStore(STORE).get("active");
        read.onsuccess = () => resolve(read.result ?? null);
        read.onerror = () => reject(read.error);
      }).finally(() => db.close());
      if (epoch === this.epoch && !this.loaded) this.record = value;
    } catch { /* Storage denial must not prevent live monitoring. */ }
    if (epoch === this.epoch) this.loaded = true;
  }
  private write(record: SnapshotRecord | null, epoch: number): Promise<boolean> {
    const operation = this.queue.then(async () => {
      if (epoch !== this.epoch) return false;
      try {
        const db = await this.database();
        return await new Promise<boolean>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          if (record) tx.objectStore(STORE).put(record, "active");
          else tx.objectStore(STORE).clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }).finally(() => db.close());
      } catch { return false; }
    });
    this.queue = operation;
    return operation;
  }
  async activate(scope: string, current: () => boolean = () => true): Promise<void> {
    await this.read();
    if (current() && this.record && this.record.scope !== scope) await this.clear();
  }
  async clear(): Promise<void> {
    ++this.epoch;
    this.loaded = true;
    this.record = null;
    await this.write(null, this.epoch);
  }
  async restore(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot | null> {
    await this.read();
    return restoreSnapshotView(this.record, request);
  }
  async save(scope: string, snapshot: ConsoleSnapshot, request: ConsoleSnapshotRequest, current: () => boolean = () => true): Promise<boolean> {
    if (snapshot.source !== "live" || !snapshot.session.authenticated) return false;
    const epoch = this.epoch;
    await this.read();
    if (epoch !== this.epoch || !current()) return false;
    this.record = saveSnapshotView(this.record, scope, snapshot, request);
    if (!this.record.views.length) { await this.clear(); return false; }
    return this.write(this.record, this.epoch);
  }
}
