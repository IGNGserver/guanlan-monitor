import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeEqual } from "../auth.js";

interface Credential { instanceId: string; digest: string; credentialVersion: string; revoked: boolean }
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Device keys are only hashed on the Hub. Single writer, fail closed on corrupt storage. */
export class AgentCredentials {
  private records: Record<string, Credential> = Object.create(null) as Record<string, Credential>;
  /** Last refused enrollment per device, in memory only: lets the console explain a dead live channel. */
  private readonly conflicts = new Map<string, string>();
  private queue = Promise.resolve();
  constructor(private readonly file: string, private readonly accessKey: string) {}

  async load(): Promise<void> {
    try {
      const records: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!records || typeof records !== "object" || Array.isArray(records)) throw new Error("invalid_agent_credentials_store");
      for (const value of Object.values(records)) {
        if (!value || typeof value.instanceId !== "string" || !/^[a-f0-9]{64}$/.test(value.digest) || typeof value.credentialVersion !== "string" || typeof value.revoked !== "boolean") throw new Error("invalid_agent_credentials_store");
      }
      this.records = Object.assign(Object.create(null) as Record<string, Credential>, records);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  enroll(deviceId: string, instanceId: string, token: string): Promise<boolean> {
    return this.update(async () => {
      // Records revoked by older Hub versions behave like removed ones: the device
      // keeps reporting over HTTP and reappears, so a tombstone only left its
      // live channel permanently dead with no way to recover it from the console.
      const previous = this.records[deviceId]?.revoked ? undefined : this.records[deviceId];
      const hash = digest(token);
      if (previous && (previous.instanceId !== instanceId || !safeEqual(previous.digest, hash))) {
        this.conflicts.set(deviceId, new Date().toISOString());
        return false;
      }
      this.conflicts.delete(deviceId);
      if (previous?.credentialVersion === digest(this.accessKey)) return true;
      const record = { instanceId, digest: hash, credentialVersion: digest(this.accessKey), revoked: false };
      await this.persist({ ...this.records, [deviceId]: record });
      return true;
    });
  }

  verify(deviceId: string, instanceId: string, token: string): boolean {
    const record = this.records[deviceId];
    return Boolean(record && !record.revoked && record.instanceId === instanceId && safeEqual(record.credentialVersion, digest(this.accessKey)) && safeEqual(record.digest, digest(token)));
  }

  /** Forget a device's enrollment; the next enrollment binds whichever installation presents itself. */
  remove(deviceId: string): Promise<void> {
    return this.update(async () => {
      this.conflicts.delete(deviceId);
      if (!(deviceId in this.records)) return;
      const records = Object.assign(Object.create(null) as Record<string, Credential>, this.records);
      delete records[deviceId];
      await this.persist(records);
    });
  }

  conflictAt(deviceId: string): string | null {
    return this.conflicts.get(deviceId) ?? null;
  }

  private update<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async persist(records: Record<string, Credential>): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(records), { mode: 0o600 });
    await rename(temporary, this.file);
    this.records = Object.assign(Object.create(null) as Record<string, Credential>, records);
  }
}
