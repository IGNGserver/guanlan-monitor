import type { ConsoleSnapshot, ConsoleSnapshotRequest } from "@dsc/shared";
import { restoreSnapshotView, saveSnapshotView, type SnapshotRecord } from "./offline-snapshot.ts";

const DATABASE = "guanlan-web-offline-v1";
const STORE = "snapshots";
const STORAGE_TIMEOUT_MS = 500;
const CLEARED = "dsc-web-offline-cleared";
function wasCleared(): boolean {
  try { return localStorage.getItem(CLEARED) !== null; } catch { return false; }
}
/** A single active authenticated-session scope; no access key/cookie is stored. */
export class OfflineSnapshotCache {
  private record: SnapshotRecord | null = null;
  private loaded = false;
  private epoch = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private loading: Promise<void> | null = null;
  private async database(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") throw new Error("offline_storage_unavailable");
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DATABASE, 1);
      let settled = false;
      const fail = (error: unknown) => { settled = true; clearTimeout(timer); reject(error); };
      const timer = setTimeout(() => fail(new Error("offline_storage_timeout")), STORAGE_TIMEOUT_MS);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => {
        if (settled) { open.result.close(); return; }
        settled = true; clearTimeout(timer); resolve(open.result);
      };
      open.onerror = () => fail(open.error);
      open.onblocked = () => fail(new Error("offline_storage_blocked"));
    });
  }
  private async read(): Promise<void> {
    if (this.loaded) return;
    if (!this.loading) this.loading = this.loadRecord().finally(() => { this.loading = null; });
    await this.loading;
  }
  private async loadRecord(): Promise<void> {
    const epoch = this.epoch;
    if (wasCleared()) { this.loaded = true; return; }
    try {
      const db = await this.database();
      const value = await new Promise<SnapshotRecord | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const timer = setTimeout(() => { reject(new Error("offline_storage_timeout")); try { tx.abort(); } catch { /* Already ended. */ } }, STORAGE_TIMEOUT_MS);
        const read = tx.objectStore(STORE).get("active");
        read.onsuccess = () => { clearTimeout(timer); resolve(read.result ?? null); };
        read.onerror = () => { clearTimeout(timer); reject(read.error); };
        tx.onabort = () => { clearTimeout(timer); reject(tx.error ?? new Error("offline_storage_aborted")); };
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
          const timer = setTimeout(() => { resolve(false); try { tx.abort(); } catch { /* Already ended. */ } }, STORAGE_TIMEOUT_MS);
          if (record) tx.objectStore(STORE).put(record, "active");
          else tx.objectStore(STORE).clear();
          tx.oncomplete = () => { clearTimeout(timer); resolve(true); };
          tx.onerror = () => { clearTimeout(timer); reject(tx.error); };
          tx.onabort = () => { clearTimeout(timer); reject(tx.error); };
        }).finally(() => db.close());
      } catch { return false; }
    });
    this.queue = operation;
    return operation;
  }
  async activate(scope: string, current: () => boolean = () => true): Promise<boolean> {
    await this.read();
    const changed = !!this.record && this.record.scope !== scope;
    if (current() && changed) await this.clear();
    return changed;
  }
  async clear(): Promise<void> {
    // A blocked IDB transaction must not resurrect a signed-out snapshot on the
    // next navigation. This contains no identity or credential, only a tombstone.
    try { localStorage.setItem(CLEARED, "1"); } catch { /* Storage may be denied. */ }
    ++this.epoch;
    this.loaded = true;
    this.record = null;
    await this.write(null, this.epoch);
  }
  async restore(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot | null> {
    if (wasCleared()) return null;
    await this.read();
    if (wasCleared()) return null;
    return restoreSnapshotView(this.record, request);
  }
  async save(scope: string, snapshot: ConsoleSnapshot, request: ConsoleSnapshotRequest, current: () => boolean = () => true): Promise<boolean> {
    if (snapshot.source !== "live" || !snapshot.session.authenticated) return false;
    const epoch = this.epoch;
    await this.read();
    if (epoch !== this.epoch || !current()) return false;
    this.record = saveSnapshotView(this.record, scope, snapshot, request);
    if (!this.record.views.length) { await this.clear(); return false; }
    const written = await this.write(this.record, this.epoch);
    if (written && epoch === this.epoch && current()) {
      try { localStorage.removeItem(CLEARED); } catch { /* Storage may be denied. */ }
    }
    return written;
  }
}
