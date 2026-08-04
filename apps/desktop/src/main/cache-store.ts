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

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "desktop-cache.json");
  }

  async read(): Promise<DesktopSnapshot | null> {
    const envelope = await readJsonFile<CacheEnvelope>(this.filePath);
    if (!envelope || envelope.version !== 1 || !envelope.snapshot) return null;
    return envelope.snapshot;
  }

  async write(snapshot: DesktopSnapshot): Promise<void> {
    const safeSnapshot: DesktopSnapshot = {
      ...snapshot,
      session: {
        authenticated: snapshot.session.authenticated,
        accessKeyConfigured: snapshot.session.accessKeyConfigured
      }
    };
    await writeJsonAtomically(this.filePath, {
      version: 1,
      savedAt: new Date().toISOString(),
      snapshot: safeSnapshot
    } satisfies CacheEnvelope);
  }
}
