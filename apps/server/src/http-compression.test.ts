import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import type { AgentMetricsPayload } from "@dsc/shared";
import { createSession } from "./auth.js";
import { env } from "./config.js";
import { registerAgentIngestRoute, registerHttpCompression } from "./http-compression.js";
import { AgentCredentials } from "./live/credentials.js";
import { LiveRegistry } from "./live/registry.js";
import { registerLiveRoutes } from "./live/routes.js";
import {
  createLocalStore,
  LocalDeviceMetricConfigStore,
  LocalDeviceRepository,
  LocalFanNoteStore,
  LocalHistoryRepository,
  LocalRealtimeRepository
} from "./repositories/local.js";
import { registerRoutes } from "./routes.js";
import { MetricsService } from "./services/metrics.js";
import type { Repositories } from "./types.js";

function samplePayload(timestamp: string, overrides: Partial<AgentMetricsPayload> = {}): AgentMetricsPayload {
  return {
    sampleId: `sample-${timestamp}`,
    inventoryHash: "inv-hash-v1",
    identity: {
      deviceId: "dev-perf-1",
      hostname: "nas-perf-host",
      os: "linux",
      platform: "debian-12",
      arch: "amd64",
      cpuModel: "Intel Xeon E-2388G",
      version: "3.0.174",
      channel: "test"
    },
    timestamp,
    heartbeatAt: timestamp,
    system: {
      processCount: 142,
      threadCount: 820,
      handleCount: 4096,
      uptimeSeconds: 86400
    },
    cpuUsagePercent: 28.5,
    cpuFrequencyMHz: 3200,
    cpuTemperatureC: 52,
    cpuPackages: [
      {
        id: "cpu0",
        name: "CPU 0",
        model: "Intel Xeon E-2388G",
        coreCount: 8,
        logicalCount: 16,
        l3CacheBytes: 16 * 1024 * 1024,
        l2CacheBytes: 4 * 1024 * 1024,
        usagePercent: 28.5,
        frequencyMHz: 3200,
        temperatureC: 52
      }
    ],
    memory: {
      totalBytes: 32 * 1024 * 1024 * 1024,
      usedBytes: 12 * 1024 * 1024 * 1024,
      availableBytes: 20 * 1024 * 1024 * 1024,
      cachedBytes: 4 * 1024 * 1024 * 1024,
      committedBytes: 14 * 1024 * 1024 * 1024,
      commitLimitBytes: 32 * 1024 * 1024 * 1024,
      swapTotalBytes: 8 * 1024 * 1024 * 1024,
      swapUsedBytes: 512 * 1024 * 1024,
      speedMHz: 3200,
      slotCount: 2,
      formFactor: "UDIMM",
      memoryType: "DDR4"
    },
    diskUsage: {
      totalBytes: 1000 * 1024 * 1024 * 1024,
      usedBytes: 420 * 1024 * 1024 * 1024
    },
    disks: [
      {
        id: "nvme0n1",
        name: "System NVMe",
        mountPoint: "/",
        filesystem: "ext4",
        model: "Samsung 990 PRO",
        vendor: "Samsung",
        sourceKey: "/dev/nvme0n1",
        physicalDevice: "/dev/nvme0n1",
        healthStatus: "healthy",
        healthReason: "SMART OK",
        smartAttributes: [{ id: 5, name: "Reallocated_Sector_Ct", value: 0, threshold: 10 }],
        interfaceType: "NVMe",
        totalBytes: 1000 * 1024 * 1024 * 1024,
        usedBytes: 420 * 1024 * 1024 * 1024,
        activePercent: 12,
        temperatureC: 41
      }
    ],
    diskRate: {
      readBytesPerSec: 1024 * 512,
      writeBytesPerSec: 1024 * 256,
      activePercent: 12
    },
    networkRate: {
      rxBytesPerSec: 1024 * 128,
      txBytesPerSec: 1024 * 64,
      totalRxBytes: 1024 * 1024 * 500,
      totalTxBytes: 1024 * 1024 * 200
    },
    networkInterfaces: [
      {
        id: "eth0",
        name: "eth0",
        model: "Intel I225-V",
        macAddress: "00:11:22:33:44:55",
        ipv4: ["192.168.1.10"],
        ipv6: ["fe80::1"],
        linkSpeedMbps: 2500,
        connectionType: "ethernet",
        rxBytesPerSec: 1024 * 128,
        txBytesPerSec: 1024 * 64,
        totalRxBytes: 1024 * 1024 * 500,
        totalTxBytes: 1024 * 1024 * 200
      }
    ],
    gpus: [
      {
        id: "gpu0",
        name: "NVIDIA T400",
        utilizationPercent: 15,
        memoryUsedBytes: 512 * 1024 * 1024,
        memoryTotalBytes: 4 * 1024 * 1024 * 1024,
        temperatureC: 47,
        driverVersion: "550.90.07"
      }
    ],
    fans: [
      {
        id: "fan1",
        label: "Chassis Fan 1",
        interface: "pwm1",
        rpm: 1350,
        rpmStatus: "observed"
      }
    ],
    sensorBackends: [
      { id: "hwmon", label: "Linux hwmon", ok: true, detail: "coretemp + nvme" }
    ],
    ...overrides
  };
}

test("gzip ingest, liveWanted signaling, inventory delta hydration, ETag 304, gzip JSON response, and incremental metrics", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-http-compression-"));
  const store = createLocalStore(path.join(tmpDir, "db.json"));
  const metricConfigs = new LocalDeviceMetricConfigStore(store);
  const fanNotes = new LocalFanNoteStore(store);
  const repositories: Repositories = {
    realtime: new LocalRealtimeRepository(store),
    history: new LocalHistoryRepository(store),
    devices: new LocalDeviceRepository(store)
  };
  const metricsService = new MetricsService(repositories, () => {}, metricConfigs);
  const liveRegistry = new LiveRegistry();
  const credentials = new AgentCredentials(path.join(tmpDir, "creds.json"), env.ACCESS_KEY);
  await credentials.load();

  const app = Fastify({ bodyLimit: 4 * 1024 * 1024 });
  registerHttpCompression(app);
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerLiveRoutes(app, {
    accessKey: env.ACCESS_KEY,
    requireHttps: false,
    credentials,
    registry: liveRegistry
  });
  await registerRoutes(app, repositories, metricsService, {
    fanNotes,
    metricConfigs
  });
  registerAgentIngestRoute(app, {
    accessKey: env.ACCESS_KEY,
    requireHttps: false,
    metricsService,
    liveRegistry
  });
  await app.ready();

  const signed = app.signCookie(Buffer.from(JSON.stringify(createSession(env.ACCESS_KEY))).toString("base64url"));
  const sessionHeaders = { cookie: `dsc_session=${encodeURIComponent(signed)}` };
  const agentHeaders = { authorization: `Bearer ${env.ACCESS_KEY}` };

  try {
    const baseMs = Date.now() - 20_000;
    const t1 = new Date(baseMs).toISOString();
    const t2 = new Date(baseMs + 5_000).toISOString();
    const t3 = new Date(baseMs + 10_000).toISOString();

    // 1. Unknown inventoryHash when inventoryOmitted=true asks agent for full inventory first
    const prematureDelta = samplePayload(t1, {
      inventoryHash: "inv-hash-v1",
      inventoryOmitted: true
    });
    const needFullRes = await app.inject({
      method: "POST",
      url: "/api/agent/ingest",
      headers: {
        ...agentHeaders,
        "content-type": "application/json",
        "content-encoding": "gzip"
      },
      payload: gzipSync(Buffer.from(JSON.stringify(prematureDelta), "utf8"))
    });
    assert.equal(needFullRes.statusCode, 200);
    assert.deepEqual(needFullRes.json(), {
      ok: true,
      capabilities: { gzip: true, liveOnDemand: true, inventoryDelta: true },
      liveWanted: false,
      needInventory: true
    });

    // 2. Full gzipped ingest succeeds and stores static inventory baseline
    const fullPayload = samplePayload(t1);
    const ingest1 = await app.inject({
      method: "POST",
      url: "/api/agent/ingest",
      headers: {
        ...agentHeaders,
        "content-type": "application/json",
        "content-encoding": "gzip"
      },
      payload: gzipSync(Buffer.from(JSON.stringify(fullPayload), "utf8"))
    });
    assert.equal(ingest1.statusCode, 200);
    assert.deepEqual(ingest1.json(), {
      ok: true,
      capabilities: { gzip: true, liveOnDemand: true, inventoryDelta: true },
      liveWanted: false
    });

    // 3. Viewing /api/devices/:deviceId/live marks liveWanted=true on next ingest
    const liveStatusRes = await app.inject({
      method: "GET",
      url: "/api/devices/dev-perf-1/live",
      headers: sessionHeaders
    });
    assert.equal(liveStatusRes.statusCode, 200);

    // 4. Delta ingest with inventoryOmitted=true hydrates static metadata and reports liveWanted=true
    const strippedPayload = samplePayload(t2, {
      inventoryHash: "inv-hash-v1",
      inventoryOmitted: true,
      cpuUsagePercent: 61.2,
      cpuPackages: [
        {
          id: "cpu0",
          name: "CPU 0",
          usagePercent: 61.2,
          frequencyMHz: 3600,
          temperatureC: 63
        }
      ],
      memory: {
        totalBytes: fullPayload.memory.totalBytes,
        usedBytes: 15 * 1024 * 1024 * 1024,
        availableBytes: 17 * 1024 * 1024 * 1024,
        cachedBytes: fullPayload.memory.cachedBytes,
        committedBytes: fullPayload.memory.committedBytes,
        commitLimitBytes: fullPayload.memory.commitLimitBytes,
        swapTotalBytes: fullPayload.memory.swapTotalBytes,
        swapUsedBytes: fullPayload.memory.swapUsedBytes
      },
      disks: [
        {
          id: "nvme0n1",
          name: "System NVMe",
          mountPoint: "/",
          totalBytes: fullPayload.disks![0]!.totalBytes,
          usedBytes: 421 * 1024 * 1024 * 1024,
          activePercent: 34,
          temperatureC: 44
        }
      ],
      networkInterfaces: [
        {
          id: "eth0",
          name: "eth0",
          rxBytesPerSec: 1024 * 256,
          txBytesPerSec: 1024 * 128,
          totalRxBytes: 1024 * 1024 * 510,
          totalTxBytes: 1024 * 1024 * 205
        }
      ],
      gpus: [
        {
          id: "gpu0",
          name: "NVIDIA T400",
          utilizationPercent: 42,
          memoryUsedBytes: 768 * 1024 * 1024,
          memoryTotalBytes: 4 * 1024 * 1024 * 1024,
          temperatureC: 55
        }
      ],
      sensorBackends: undefined
    });

    const ingest2 = await app.inject({
      method: "POST",
      url: "/api/agent/ingest",
      headers: {
        ...agentHeaders,
        "content-type": "application/json",
        "content-encoding": "gzip"
      },
      payload: gzipSync(Buffer.from(JSON.stringify(strippedPayload), "utf8"))
    });
    assert.equal(ingest2.statusCode, 200);
    assert.deepEqual(ingest2.json(), {
      ok: true,
      capabilities: { gzip: true, liveOnDemand: true, inventoryDelta: true },
      liveWanted: true
    });

    // Mismatched inventoryHash triggers needInventory=true without corrupting latest state
    const mismatchRes = await app.inject({
      method: "POST",
      url: "/api/agent/ingest",
      headers: {
        ...agentHeaders,
        "content-type": "application/json"
      },
      payload: samplePayload(t3, {
        inventoryHash: "inv-hash-v2-changed",
        inventoryOmitted: true
      })
    });
    assert.equal(mismatchRes.statusCode, 200);
    assert.equal(mismatchRes.json().needInventory, true);

    // Send third sample at t3 with matching hash
    const ingest3 = await app.inject({
      method: "POST",
      url: "/api/agent/ingest",
      headers: {
        ...agentHeaders,
        "content-type": "application/json"
      },
      payload: {
        ...strippedPayload,
        sampleId: `sample-${t3}`,
        timestamp: t3,
        heartbeatAt: t3,
        cpuUsagePercent: 44.0
      }
    });
    assert.equal(ingest3.statusCode, 200);
    assert.equal(ingest3.json().needInventory, undefined);

    // 5. ETag & 304 Not Modified on GET /api/instances
    const instancesRes1 = await app.inject({
      method: "GET",
      url: "/api/instances",
      headers: sessionHeaders
    });
    assert.equal(instancesRes1.statusCode, 200);
    const etag = instancesRes1.headers.etag;
    assert.equal(typeof etag, "string");
    assert.ok(String(etag).startsWith('W/"'));

    const instancesRes304 = await app.inject({
      method: "GET",
      url: "/api/instances",
      headers: {
        ...sessionHeaders,
        "if-none-match": String(etag)
      }
    });
    assert.equal(instancesRes304.statusCode, 304);
    assert.equal(instancesRes304.body, "");

    // 6. Full metrics response is gzip-compressed when Accept-Encoding: gzip and >= 1 KB, with hydrated inventory
    const fullMetricsRes = await app.inject({
      method: "GET",
      url: "/api/devices/dev-perf-1/metrics?window=5m",
      headers: {
        ...sessionHeaders,
        "accept-encoding": "gzip"
      }
    });
    assert.equal(fullMetricsRes.statusCode, 200);
    assert.equal(fullMetricsRes.headers["content-encoding"], "gzip");
    const fullMetricsJson = JSON.parse(gunzipSync(fullMetricsRes.rawPayload).toString("utf8"));
    assert.equal(fullMetricsJson.incremental, undefined);
    assert.equal(fullMetricsJson.series.cpuUsagePercent.length, 3);
    assert.equal(fullMetricsJson.latest.memorySpeedMHz, 3200);
    assert.equal(fullMetricsJson.latest.memoryType, "DDR4");
    assert.equal(fullMetricsJson.latest.cpuPackages[0].model, "Intel Xeon E-2388G");
    assert.equal(fullMetricsJson.latest.cpuPackages[0].coreCount, 8);
    assert.equal(fullMetricsJson.latest.disks[0].model, "Samsung 990 PRO");
    assert.equal(fullMetricsJson.latest.disks[0].filesystem, "ext4");
    assert.equal(fullMetricsJson.latest.networkInterfaces[0].macAddress, "00:11:22:33:44:55");
    assert.equal(fullMetricsJson.latest.gpus[0].driverVersion, "550.90.07");
    assert.equal(fullMetricsJson.latest.sensorBackends.length, 1);

    // 7. Incremental metrics query (?since=t2) returns only t3 while preserving availableMetrics and latest
    const deltaMetricsRes = await app.inject({
      method: "GET",
      url: `/api/devices/dev-perf-1/metrics?window=5m&since=${encodeURIComponent(t2)}`,
      headers: sessionHeaders
    });
    assert.equal(deltaMetricsRes.statusCode, 200);
    const deltaMetricsJson = deltaMetricsRes.json();
    assert.equal(deltaMetricsJson.incremental, true);
    assert.equal(deltaMetricsJson.series.cpuUsagePercent.length, 1);
    assert.equal(deltaMetricsJson.series.cpuUsagePercent[0].timestamp, t3);
    assert.equal(deltaMetricsJson.series.cpuUsagePercent[0].value, 44);
    assert.deepEqual(deltaMetricsJson.availableMetrics, fullMetricsJson.availableMetrics);
    assert.equal(deltaMetricsJson.latest.cpuUsagePercent, 44);
  } finally {
    await app.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
