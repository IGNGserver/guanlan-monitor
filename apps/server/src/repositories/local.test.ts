import assert from "node:assert/strict";
import fs, { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createLocalStore,
  LocalDeviceMetricConfigStore,
  LocalDeviceRepository,
  LocalFanNoteStore,
  LocalHistoryRepository,
  LocalRealtimeRepository
} from "./local.js";
import type { DeviceMetricConfigValue } from "../types.js";

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

test("history cannot reopen a closed physical device, but an authoritative sample can", async () => {
  await withTempStore(async (filePath) => {
    const devices = new LocalDeviceRepository(createLocalStore(filePath));
    await devices.registerOrUpdateDevice("device-1", "Host");
    await devices.deleteDevice("device-1");
    const result = await devices.registerOrUpdateDevice("device-1", "Host again");
    assert.equal(result.status, "closed");
    assert.deepEqual(await devices.listOpenDevices(), []);

    const reopened = await devices.registerOrUpdateDevice(
      "device-1",
      "Host reporting again",
      { reopenClosed: true }
    );
    assert.equal(reopened.status, "open");
    assert.equal(reopened.name, "Host reporting again");
    assert.deepEqual((await devices.listOpenDevices()).map((device) => device.deviceId), ["device-1"]);
  });
});

test("steady local registration skips disk writes, preserves touch time and still reopens authoritative devices", async (t) => {
  await withTempStore(async (filePath) => {
    const devices = new LocalDeviceRepository(createLocalStore(filePath));
    const first = await devices.registerOrUpdateDevice("steady", "Host", { reopenClosed: true, skipUnchanged: true });
    const writes = t.mock.method(fs, "writeFile");
    const clones = t.mock.method(globalThis, "structuredClone");
    for (let index = 0; index < 100; index++) {
      const record = await devices.registerOrUpdateDevice("steady", "Host", { reopenClosed: true, skipUnchanged: true });
      assert.equal(record.updatedAt, first.updatedAt);
      record.name = "mutated copy";
    }
    assert.equal(writes.mock.callCount(), 0);
    assert.equal(clones.mock.callCount(), 0, "unchanged registration must not clone the fallback history database");
    assert.equal((await devices.listOpenDevices())[0].name, "Host");
    await devices.registerOrUpdateDevice("steady", "Renamed", { reopenClosed: true, skipUnchanged: true });
    assert.equal(writes.mock.callCount(), 1);
    await devices.deleteDevice("steady");
    assert.equal((await devices.registerOrUpdateDevice("steady", "Renamed", { skipUnchanged: true })).status, "closed");
    assert.equal((await devices.registerOrUpdateDevice("steady", "Renamed", { reopenClosed: true, skipUnchanged: true })).status, "open");
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

test("local traffic projection has exclusive bounds, one-year horizon and no hardware detail", async () => {
  await withTempStore(async (filePath) => {
    const now = Date.now();
    const hour = 3600_000;
    const point = (timestamp: number) => ({ timestamp, trafficRxBytes: 100, trafficTxBytes: 200, recordedDetails: { private: "unused" } });
    await writeFile(filePath, JSON.stringify({ history: { node: [point(now - 400 * 24 * hour), point(now - 2 * hour), point(now - hour), point(now)] } }), "utf8");
    const history = new LocalHistoryRepository(createLocalStore(filePath));
    assert.deepEqual(await history.getTrafficSeries("node", now - 2 * hour, now), [now - 2 * hour, now - hour].map((timestamp) => ({ timestamp, trafficRxBytes: 100, trafficTxBytes: 200 })));
    assert.equal((await history.getTrafficSeries("node", now - 401 * 24 * hour, now)).length, 2);
    assert.deepEqual(await history.getTrafficSeries("missing", now - hour, now), []);
  });
});

/**
 * Registry ids on disk, with a missing file meaning nothing was ever written.
 *
 * A refused registration must not touch the store at all, so the file genuinely does not exist
 * yet; reading through the repository would hide that behind its empty-database default.
 */
async function readPersistedRegistryIds(filePath: string): Promise<string[]> {
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? null : Promise.reject(error)
  );
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { deviceRegistry?: Record<string, unknown> };
  return Object.keys(parsed.deviceRegistry ?? {});
}

test("the device registry refuses legacy virtual machine ids", async () => {
  await withTempStore(async (filePath) => {
    const devices = new LocalDeviceRepository(createLocalStore(filePath));

    // The startup sweep deletes these rows; a concurrent device listing re-registering them from
    // realtime state is what made the phantom devices permanent.
    const refused = await devices.registerOrUpdateDevice("vm:05c91cad", "ubuntu-vm", { reopenClosed: true });
    assert.equal(refused.status, "closed");
    assert.deepEqual(await devices.listOpenDevices(), []);
    assert.deepEqual(await readPersistedRegistryIds(filePath), []);

    await devices.registerOrUpdateDevice("device-1", "Host");
    await devices.deleteDevice("vm:05c91cad");
    assert.deepEqual((await devices.listOpenDevices()).map((device) => device.deviceId), ["device-1"]);
    assert.deepEqual(await readPersistedRegistryIds(filePath), ["device-1"]);
  });
});

test("device listings hide legacy virtual machine rows an older hub left behind", async () => {
  await withTempStore(async (filePath) => {
    await writeFile(filePath, JSON.stringify({
      devices: {},
      series: {},
      minuteHistory: {},
      history: {},
      fanNotes: {},
      deviceMetricConfigs: {},
      deviceRegistry: {
        "node-1": { deviceId: "node-1", name: "node-1", status: "open", sortOrder: 0, registeredAt: "2026-09-25T00:00:00.000Z", updatedAt: "2026-09-25T00:00:00.000Z" },
        "vm:05c91cad": { deviceId: "vm:05c91cad", name: "vm:05c91cad", status: "open", sortOrder: 1, registeredAt: "2026-09-25T00:00:00.000Z", updatedAt: "2026-09-25T00:00:00.000Z" }
      }
    }), "utf8");

    const devices = new LocalDeviceRepository(createLocalStore(filePath));

    assert.deepEqual((await devices.listOpenDevices()).map((device) => device.deviceId), ["node-1"]);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("lazily loads once for concurrent config/note reads and never rereads on updates", async (t) => {
  await withTempStore(async (filePath) => {
    await writeFile(filePath, JSON.stringify({
      fanNotes: { node: { fan: "old" } },
      deviceMetricConfigs: { node: { enabledMetrics: ["fanRpm"] } }
    }));
    const started = deferred();
    const release = deferred();
    const reads = t.mock.method(fs, "readFile", async (...args: Parameters<typeof readFile>) => {
      started.resolve();
      await release.promise;
      return readFile(...args);
    });
    const store = createLocalStore(filePath);
    const configs = new LocalDeviceMetricConfigStore(store);
    const notes = new LocalFanNoteStore(store);
    assert.equal(reads.mock.callCount(), 0, "constructors must not read the file");
    const pending = Array.from({ length: 20 }, () => Promise.all([configs.get("node"), notes.get("node")]));
    try {
      await started.promise;
      assert.equal(reads.mock.callCount(), 1, "first reads share one in-flight load");
    } finally { release.resolve(); }
    for (const [config, note] of await Promise.all(pending)) {
      assert.deepEqual(config, { enabledMetrics: ["fanRpm"] });
      assert.deepEqual(note, { fan: "old" });
    }
    await Promise.all([
      configs.set("node", { enabledMetrics: ["cpuUsage"] }),
      notes.set("node", "fan", "new")
    ]);
    assert.deepEqual((await configs.get("node"))?.enabledMetrics, ["cpuUsage"]);
    assert.deepEqual(await notes.get("node"), { fan: "new" });
    assert.equal(reads.mock.callCount(), 1, "warm reads and writes must use the committed cache");
  });
});

test("config and note projections clone only their results, not the cached database", async (t) => {
  await withTempStore(async (filePath) => {
    const config = { enabledMetrics: ["fanRpm"] };
    const note = { fan: "quiet" };
    await writeFile(filePath, JSON.stringify({
      deviceMetricConfigs: { node: config }, fanNotes: { node: note },
      history: { unrelated: Array.from({ length: 100 }, (_, timestamp) => ({ timestamp })) }
    }));
    const store = createLocalStore(filePath);
    await store.read();
    const clones = t.mock.method(globalThis, "structuredClone");
    assert.deepEqual(await new LocalDeviceMetricConfigStore(store).get("node"), config);
    assert.deepEqual(await new LocalFanNoteStore(store).get("node"), note);
    assert.deepEqual(clones.mock.calls.map((call) => call.arguments[0]), [config, note]);
  });
});

test("config/note getters and full snapshots cannot mutate committed data or retain set inputs", async () => {
  await withTempStore(async (filePath) => {
    const store = createLocalStore(filePath);
    const configs = new LocalDeviceMetricConfigStore(store);
    const notes = new LocalFanNoteStore(store);
    const input: DeviceMetricConfigValue = {
      enabledMetrics: ["fanRpm", "fanRpm"],
      enabledDeviceIds: { fan: ["fan"] },
      instanceMetricConfig: { fan: ["fanRpm", "fanRpm"] }
    };
    await configs.set("node", input);
    await notes.set("node", "fan", "quiet");
    input.enabledMetrics.length = 0;
    input.enabledDeviceIds!.fan!.push("outside");
    input.instanceMetricConfig!.fan.length = 0;
    const expected = {
      enabledMetrics: ["fanRpm"], enabledDeviceIds: { fan: ["fan"] }, instanceMetricConfig: { fan: ["fanRpm"] }
    };
    const config = await configs.get("node");
    assert.deepEqual(config, expected);
    config!.enabledMetrics.length = 0;
    config!.enabledDeviceIds!.fan!.push("get mutation");
    config!.instanceMetricConfig!.fan.length = 0;
    const note = await notes.get("node");
    note.fan = "get mutation";
    const snapshot = await store.read();
    snapshot.fanNotes.node.fan = "snapshot mutation";
    delete snapshot.deviceMetricConfigs.node;
    assert.deepEqual(await configs.get("node"), expected);
    assert.deepEqual(await notes.get("node"), { fan: "quiet" });
    const missing = await notes.get("missing");
    missing.fan = "not persisted";
    assert.deepEqual(await notes.get("missing"), {});
    assert.equal(await configs.get("missing"), null);
    assert.deepEqual((await createLocalStore(filePath).read()).deviceMetricConfigs.node, expected);
  });
});

test("realtime, series, history and registry projections return isolated records", async () => {
  await withTempStore(async (filePath) => {
    const now = Date.now();
    await writeFile(filePath, JSON.stringify({
      devices: { node: { identity: { deviceId: "node" }, latest: { cpuUsagePercent: 50 } } },
      series: { node: { "1m": [{ timestamp: now, cpuUsagePercent: 50 }] } },
      minuteHistory: { node: [{ timestamp: now, cpuUsagePercent: 50 }] },
      deviceRegistry: { node: { deviceId: "node", name: "Host", status: "open", sortOrder: 0 } }
    }));
    const store = createLocalStore(filePath);
    const realtime = new LocalRealtimeRepository(store);
    const history = new LocalHistoryRepository(store);
    const devices = new LocalDeviceRepository(store);
    (await realtime.getDevice("node"))!.latest.cpuUsagePercent = 0;
    (await realtime.listDevices())[0].identity.deviceId = "changed";
    (await realtime.readSeries("node", "1m"))[0].cpuUsagePercent = 0;
    (await history.getHistoricalSeries("node", "1d"))[0].cpuUsagePercent = 0;
    (await devices.listOpenDevices())[0].name = "changed";
    assert.equal((await realtime.getDevice("node"))!.latest.cpuUsagePercent, 50);
    assert.equal((await realtime.listDevices())[0].identity.deviceId, "node");
    assert.equal((await realtime.readSeries("node", "1m"))[0].cpuUsagePercent, 50);
    assert.equal((await history.getHistoricalSeries("node", "1d"))[0].cpuUsagePercent, 50);
    assert.equal((await devices.listOpenDevices())[0].name, "Host");
  });
});

test("reads and cross-store writes follow invocation order across an asynchronous mutation", async () => {
  await withTempStore(async (filePath) => {
    const store = createLocalStore(filePath);
    const notes = new LocalFanNoteStore(store);
    const configs = new LocalDeviceMetricConfigStore(store);
    await notes.set("node", "fan", "before");
    const started = deferred();
    const release = deferred();
    const before = notes.get("node");
    const mutation = store.update(async (db) => {
      db.fanNotes.node.fan = "after";
      started.resolve();
      await release.promise;
    });
    let readFinished = false;
    const after = notes.get("node").then((value) => { readFinished = true; return value; });
    const write = configs.set("node", { enabledMetrics: ["fanRpm"] });
    const config = configs.get("node");
    try {
      await started.promise;
      assert.deepEqual(await before, { fan: "before" });
      await new Promise<void>((done) => setImmediate(done));
      assert.equal(readFinished, false, "a queued read cannot observe an uncommitted draft");
    } finally { release.resolve(); }
    await Promise.all([mutation, write]);
    assert.deepEqual(await after, { fan: "after" });
    assert.deepEqual((await config)?.enabledMetrics, ["fanRpm"]);
    assert.deepEqual((await createLocalStore(filePath).read()).fanNotes.node, { fan: "after" });
  });
});

test("failed asynchronous mutations roll back drafts and do not poison queued reads/writes", async () => {
  await withTempStore(async (filePath) => {
    const store = createLocalStore(filePath);
    const notes = new LocalFanNoteStore(store);
    const configs = new LocalDeviceMetricConfigStore(store);
    await notes.set("node", "fan", "kept");
    const onDisk = await readFile(filePath, "utf8");
    const failure = store.update(async (db) => {
      db.fanNotes.node.fan = "must roll back";
      db.deviceMetricConfigs.node = { enabledMetrics: ["fanRpm"] };
      await Promise.resolve();
      throw new Error("mutation failed after modifying draft");
    });
    const rejected = assert.rejects(failure, /mutation failed/);
    const read = notes.get("node");
    const config = configs.get("node");
    await rejected;
    assert.deepEqual(await read, { fan: "kept" });
    assert.equal(await config, null);
    assert.equal(await readFile(filePath, "utf8"), onDisk);
    await configs.set("node", { enabledMetrics: ["cpuUsage"] });
    assert.deepEqual(await notes.get("node"), { fan: "kept" });
    assert.deepEqual((await configs.get("node"))?.enabledMetrics, ["cpuUsage"]);
  });
});

for (const method of ["writeFile", "rename"] as const) {
  test(`${method} failures preserve committed memory/disk, remove temp files and recover the queue`, async (t) => {
    await withTempStore(async (filePath) => {
      const store = createLocalStore(filePath);
      const notes = new LocalFanNoteStore(store);
      await notes.set("node", "fan", "kept");
      const onDisk = await readFile(filePath, "utf8");
      const injected = t.mock.method(fs, method, async () => { throw new Error(`injected ${method} failure`); });
      const failure = notes.set("node", "fan", "must roll back");
      const rejected = assert.rejects(failure, /injected/);
      const read = notes.get("node");
      await rejected;
      assert.deepEqual(await read, { fan: "kept" });
      assert.equal(await readFile(filePath, "utf8"), onDisk);
      assert.deepEqual(await readdir(join(filePath, "..")), ["local-db.json"]);
      injected.mock.restore();
      await notes.set("node", "other-fan", "next write");
      assert.deepEqual(await notes.get("node"), { fan: "kept", "other-fan": "next write" });
      assert.deepEqual((await createLocalStore(filePath).read()).fanNotes.node, { fan: "kept", "other-fan": "next write" });
    });
  });
}

test("successful commits detach retained drafts as well as caller-owned objects", async () => {
  await withTempStore(async (filePath) => {
    const store = createLocalStore(filePath);
    const input = { fan: "kept" };
    let retained!: Awaited<ReturnType<typeof store.read>>;
    await store.update((db) => { db.fanNotes.node = input; retained = db; });
    input.fan = "outside mutation";
    retained.fanNotes.node = { fan: "retained draft mutation" };
    assert.deepEqual(await new LocalFanNoteStore(store).get("node"), { fan: "kept" });
    assert.deepEqual((await createLocalStore(filePath).read()).fanNotes.node, { fan: "kept" });
  });
});

test("invalid initial JSON/shapes are not cached as empty and the same store can retry", async () => {
  await withTempStore(async (filePath) => {
    const store = createLocalStore(filePath);
    for (const invalid of ["{", "[]", '{"fanNotes":[]}']) {
      await writeFile(filePath, invalid);
      await assert.rejects(store.read());
      await assert.rejects(store.update((db) => { db.fanNotes.node = { fan: "must not persist" }; }));
      assert.equal(await readFile(filePath, "utf8"), invalid);
    }
    await writeFile(filePath, JSON.stringify({ fanNotes: { node: { fan: "repaired" } } }));
    assert.deepEqual(await new LocalFanNoteStore(store).get("node"), { fan: "repaired" });
  });
});

test("non-ENOENT load failures propagate and a later queued load retries", async (t) => {
  await withTempStore(async (filePath) => {
    await writeFile(filePath, JSON.stringify({ fanNotes: { node: { fan: "kept" } } }));
    const store = createLocalStore(filePath);
    const injected = t.mock.method(fs, "readFile", async () => { throw Object.assign(new Error("read denied"), { code: "EACCES" }); });
    await assert.rejects(store.read(), /read denied/);
    injected.mock.restore();
    assert.deepEqual(await new LocalFanNoteStore(store).get("node"), { fan: "kept" });
  });
});

test("a missing file initializes once without writing and stays cached until a store update", async (t) => {
  await withTempStore(async (filePath) => {
    const reads = t.mock.method(fs, "readFile");
    const store = createLocalStore(filePath);
    const notes = new LocalFanNoteStore(store);
    assert.deepEqual(await notes.get("node"), {});
    assert.deepEqual(await notes.get("node"), {});
    assert.equal(reads.mock.callCount(), 1);
    assert.deepEqual(await readdir(join(filePath, "..")), []);
    await notes.set("node", "fan", "first write");
    assert.deepEqual(await notes.get("node"), { fan: "first write" });
    assert.equal(reads.mock.callCount(), 1);
  });
});

test("legacy root-only cleanup survives cache warmup and is idempotent without rereading", async (t) => {
  await withTempStore(async (filePath) => {
    await writeFile(filePath, JSON.stringify({ virtualMachines: {}, fanNotes: { node: { fan: "kept" } } }));
    const store = createLocalStore(filePath);
    await store.read();
    const reads = t.mock.method(fs, "readFile");
    const writes = t.mock.method(fs, "writeFile");
    await store.removeLegacyVirtualMachineData();
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(Object.hasOwn(persisted, "virtualMachines"), false);
    assert.deepEqual(persisted.fanNotes.node, { fan: "kept" });
    await store.removeLegacyVirtualMachineData();
    assert.equal(reads.mock.callCount(), 0);
    assert.equal(writes.mock.callCount(), 1);
  });
});

test("legacy cleanup is ordered with writes and retains physical metrics and storage pools", async () => {
  await withTempStore(async (filePath) => {
    const point = { timestamp: Date.now(), trafficRxBytes: 100, recordedDetails: { virtualization: {}, storagePools: [{ id: "pool" }] } };
    await writeFile(filePath, JSON.stringify({
      devices: {
        node: { identity: { deviceId: "node", virtualization: {} }, latest: { virtualization: {}, storagePools: [{ id: "pool" }] } },
        "vm:old": { identity: { deviceId: "vm:old" }, latest: {} }
      },
      deviceRegistry: { node: { deviceId: "node", status: "open" }, "vm:old": { deviceId: "vm:old", status: "open" } },
      series: { node: { "1m": [point] }, "vm:old": { "1m": [point] } },
      minuteHistory: { node: [point], "vm:old": [point] }, history: { node: [point], "vm:old": [point] },
      deviceMetricConfigs: { node: { enabledMetrics: ["fanRpm"], instanceMetricConfig: { fan: ["fanRpm"], "vm:old": ["cpuUsage"] } }, "vm:old": { enabledMetrics: [] } },
      fanNotes: { "vm:old": { fan: "remove" } }
    }));
    const store = createLocalStore(filePath);
    const started = deferred();
    const release = deferred();
    const write = store.update(async (db) => {
      db.fanNotes.node = { fan: "kept" };
      db.fanNotes["vm:late"] = { fan: "remove" };
      started.resolve();
      await release.promise;
    });
    const cleanup = store.removeLegacyVirtualMachineData();
    const read = store.read();
    try { await started.promise; } finally { release.resolve(); }
    await Promise.all([write, cleanup]);
    const db = await read;
    for (const map of [db.devices, db.deviceRegistry, db.series, db.minuteHistory, db.history, db.deviceMetricConfigs, db.fanNotes]) {
      assert.deepEqual(Object.keys(map!), ["node"]);
    }
    assert.deepEqual(db.fanNotes.node, { fan: "kept" });
    assert.equal(Object.hasOwn(db.devices.node.identity, "virtualization"), false);
    assert.equal(Object.hasOwn(db.devices.node.latest, "virtualization"), false);
    assert.deepEqual(db.devices.node.latest.storagePools, [{ id: "pool" }]);
    for (const cleaned of [db.series.node["1m"][0], db.minuteHistory.node[0], db.history.node[0]]) {
      assert.equal(Object.hasOwn(cleaned.recordedDetails!, "virtualization"), false);
      assert.equal(cleaned.trafficRxBytes, 100);
      assert.deepEqual(cleaned.recordedDetails!.storagePools, [{ id: "pool" }]);
    }
    assert.deepEqual(db.deviceMetricConfigs.node.instanceMetricConfig, { fan: ["fanRpm"] });
    assert.deepEqual(await createLocalStore(filePath).read(), db);
  });
});

test("device group assignment persists across registrations and supports batch rename/clear", async () => {
  await withTempStore(async (filePath) => {
    const devices = new LocalDeviceRepository(createLocalStore(filePath));
    await devices.registerOrUpdateDevice("pve-1", "PVE 1");
    await devices.registerOrUpdateDevice("pve-2", "PVE 2");
    await devices.registerOrUpdateDevice("nas-1", "NAS 1");

    await devices.updateDeviceGroup(["pve-1", "pve-2"], "  宿主机  ");
    let list = await devices.listOpenDevices();
    assert.equal(list.find((d) => d.deviceId === "pve-1")?.group, "宿主机");
    assert.equal(list.find((d) => d.deviceId === "pve-2")?.group, "宿主机");
    assert.equal(list.find((d) => d.deviceId === "nas-1")?.group, null);

    // Subsequent heartbeat registration must preserve the assigned group
    const updated = await devices.registerOrUpdateDevice("pve-1", "PVE 1 Updated", { reopenClosed: true, skipUnchanged: true });
    assert.equal(updated.group, "宿主机");

    // Dissolve group
    await devices.updateDeviceGroup(["pve-1", "pve-2"], "");
    list = await devices.listOpenDevices();
    assert.equal(list.find((d) => d.deviceId === "pve-1")?.group, null);
    assert.equal(list.find((d) => d.deviceId === "pve-2")?.group, null);
  });
});
