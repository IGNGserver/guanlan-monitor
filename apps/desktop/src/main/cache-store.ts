import path from "node:path";
import type { DesktopSnapshot } from "@dsc/shared";
import { readJsonFile, writeJsonAtomically } from "./atomic-json.js";

interface CacheEnvelope {
  version: 1;
  savedAt: string;
  snapshot: DesktopSnapshot;
}

export class DesktopCacheStore {
  private readonly filePath: string;
  private loaded: Promise<DesktopSnapshot | null> | null = null;
  private pending: DesktopSnapshot | null = null;
  private writing: Promise<void> | null = null;
  private savedAt = -Infinity;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "desktop-cache.json");
  }

  async read(): Promise<DesktopSnapshot | null> {
    this.loaded ??= readJsonFile<CacheEnvelope>(this.filePath)
      .then((envelope) => envelope?.version === 1 ? envelope.snapshot ?? null : null)
      .catch(() => null);
    return this.loaded;
  }

  async write(snapshot: DesktopSnapshot): Promise<void> {
    const safeSnapshot: DesktopSnapshot = {
      ...snapshot,
      session: {
        authenticated: snapshot.session.authenticated,
        accessKeyConfigured: snapshot.session.accessKeyConfigured
      }
    };
    this.loaded = Promise.resolve(safeSnapshot);
    this.pending = safeSnapshot;
    // Keep the latest offline snapshot in memory. Persist at most once per
    // minute during polling, and flush the latest state on orderly shutdown.
    if (Date.now() - this.savedAt >= 60_000) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.writing) await this.writing;
    if (!this.pending) return;
    const snapshot = this.pending;
    this.pending = null;
    const writing = writeJsonAtomically(this.filePath, {
      version: 1,
      savedAt: new Date().toISOString(),
      snapshot
    } satisfies CacheEnvelope, false);
    this.writing = writing;
    try {
      await writing;
      this.savedAt = Date.now();
    } catch (error) {
      this.pending ??= snapshot;
      throw error;
    } finally {
      if (this.writing === writing) this.writing = null;
    }
  }
}
