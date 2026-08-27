import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalStore, LocalDeviceRepository, LocalHistoryRepository } from "./local.js";

async function withTempStore<T>(callback: (filePath: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "dsc-local-store-"));
  const filePath = join(directory, "local-db.json");
  try {
    return await callback(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("does not turn a corrupt local database into an empty database", async () => {
  await withTempStore(async (filePath) => {
    await writeFile(filePath, "{", "utf8");
    await assert.rejects(() => createLocalStore(filePath).read());
  });
});

test("recovers the write queue after a failed mutation", async () => {
  await withTempStore(async (filePath) => {
    const store = createLocalStore(filePath);
    await assert.rejects(() => store.update(() => { throw new Error("mutation failed"); }));
    await store.update((db) => {
      db.fanNotes["device-1"] = { "fan-1": "kept" };
    });
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as { fanNotes: Record<string, Record<string, string>> };
    assert.equal(persisted.fanNotes["device-1"]["fan-1"], "kept");
  });
});

test("a closed physical device cannot be reopened by a later sample", async () => {
  await withTempStore(async (filePath) => {
    const devices = new LocalDeviceRepository(createLocalStore(filePath));
    await devices.registerOrUpdateDevice("device-1", "Host");
    await devices.deleteDevice("device-1");
    const result = await devices.registerOrUpdateDevice("device-1", "Host again");
    assert.equal(result.status, "closed");
    assert.deepEqual(await devices.listOpenDevices(), []);
  });
});

test("local history retention removes expired points", async () => {
  await withTempStore(async (filePath) => {
    const now = Date.now();
    await writeFile(filePath, JSON.stringify({
      history: { "device-1": [{ timestamp: now - 371 * 24 * 60 * 60 * 1000 }, { timestamp: now }] },
      minuteHistory: { "device-1": [{ timestamp: now - 91 * 24 * 60 * 60 * 1000 }, { timestamp: now }] }
    }), "utf8");
    const store = createLocalStore(filePath);
    await new LocalHistoryRepository(store).runRetentionCleanup();
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      history: Record<string, Array<{ timestamp: number }> >;
      minuteHistory: Record<string, Array<{ timestamp: number }> >;
    };
    assert.deepEqual(persisted.history["device-1"].map((point) => point.timestamp), [now]);
    assert.deepEqual(persisted.minuteHistory["device-1"].map((point) => point.timestamp), [now]);
  });
});
