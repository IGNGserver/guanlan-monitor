/**
 * Guanlan Spectrum Adaptive - Safe Typed Stateful Mock Data Adapter
 * Strictly aligned with contract definitions in @dsc/shared:
 * DeviceSummary, MetricsResponse (latest/series), DesktopAgentBackendState, TrafficCalendarResponse.
 * Uses safe test values (http://127.0.0.1:3100) and configured-only secret flags.
 */

import type {
  DesktopSnapshot,
  DesktopSnapshotRequest,
  DesktopConfigPatch,
  DesktopAgentControlAction,
  DesktopStartupSettings,
  DeviceSummary,
  DeviceDetail,
  MetricsResponse,
  MetricsLatest,
  MetricSeries,
  DesktopAgentBackendState,
  DesktopAgentConfig,
  TrafficCalendarResponse,
  TrafficCalendarCell
} from "@dsc/shared";
import type { IGuanlanDataAdapter, MockStateFlags } from "./adapter";

export class MockGuanlanDataAdapter implements IGuanlanDataAdapter {
  private flags: MockStateFlags = {
    simulateEmpty: false,
    simulateCached: false,
    simulateAgentStopped: false,
    simulateError: false
  };

  private listeners: Set<(snapshot: DesktopSnapshot) => void> = new Set();

  private isRunning = true;
  private backendStartedAt = new Date(Date.now() - 3600000 * 24).toISOString();
  private frontendParentPid = 14820;

  private config: DesktopAgentConfig = {
    connection: {
      serverUrl: "http://127.0.0.1:3100",
      deviceId: "dev-win-01",
      hostname: "GUANLAN-WIN11-PRO",
      secretConfigured: true
    },
    sampling: {
      normalIntervalSeconds: 5,
      slowIntervalSeconds: 15
    },
    enabledMetrics: [
      "cpuUsage",
      "cpuTemperature",
      "memoryUsage",
      "gpuUsage",
      "diskUsage",
      "networkTraffic",
      "fanRpm"
    ],
    enabledDeviceIds: {},
    instanceMetricConfig: {},
    probeSelections: [
      { target: "cpu", provider: "builtin", enabled: true },
      { target: "gpu", provider: "libreHardwareMonitor", enabled: true },
      { target: "memory", provider: "builtin", enabled: true },
      { target: "disk", provider: "wmi", enabled: true },
      { target: "network", provider: "builtin", enabled: true },
      { target: "fan", provider: "openHardwareMonitor", enabled: true }
    ],
    cloudSyncEnabled: true,
    dataRecordingEnabled: true,
    autoRestartCollector: true,
    autoStartCollector: true
  };

  private startupSettings: DesktopStartupSettings = {
    openAtLogin: true,
    startMinimized: false
  };

  private fanNotes: Record<string, string> = {
    "dev-win-01:fan-0": "主板 CPU 散热风扇",
    "dev-win-01:fan-1": "机箱前置进风风扇"
  };

  setMockFlags(flags: Partial<MockStateFlags>): void {
    this.flags = { ...this.flags, ...flags };
    this.notify();
  }

  getMockFlags(): MockStateFlags {
    return { ...this.flags };
  }

  async getSnapshot(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot> {
    return this.buildSnapshot(request);
  }

  async refresh(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot> {
    return this.buildSnapshot(request);
  }

  async updateLocalConfig(patch: DesktopConfigPatch): Promise<DesktopSnapshot> {
    if (patch.connection) {
      if (patch.connection.serverUrl !== undefined) {
        this.config.connection.serverUrl = patch.connection.serverUrl;
      }
      if (patch.connection.hostname !== undefined) {
        this.config.connection.hostname = patch.connection.hostname;
      }
    }
    if (patch.sampling) {
      if (patch.sampling.normalIntervalSeconds !== undefined) {
        this.config.sampling.normalIntervalSeconds = patch.sampling.normalIntervalSeconds;
      }
      if (patch.sampling.slowIntervalSeconds !== undefined) {
        this.config.sampling.slowIntervalSeconds = patch.sampling.slowIntervalSeconds;
      }
    }
    if (patch.autoStartCollector !== undefined) {
      this.config.autoStartCollector = patch.autoStartCollector;
    }
    if (patch.autoRestartCollector !== undefined) {
      this.config.autoRestartCollector = patch.autoRestartCollector;
    }
    if (patch.cloudSyncEnabled !== undefined) {
      this.config.cloudSyncEnabled = patch.cloudSyncEnabled;
    }
    if (patch.dataRecordingEnabled !== undefined) {
      this.config.dataRecordingEnabled = patch.dataRecordingEnabled;
    }
    this.notify();
    return this.buildSnapshot();
  }

  async controlAgent(action: DesktopAgentControlAction): Promise<DesktopSnapshot> {
    if (action === "start") {
      this.isRunning = true;
      this.backendStartedAt = new Date().toISOString();
    } else if (action === "stop") {
      this.isRunning = false;
    } else if (action === "check-connection") {
      // Simulate check connection
    } else if (action === "detect-probes") {
      // Simulate detect probes
    }
    this.notify();
    return this.buildSnapshot();
  }

  async setAgentSecret(_secret: string): Promise<DesktopSnapshot> {
    this.config.connection.secretConfigured = true;
    this.notify();
    return this.buildSnapshot();
  }

  async saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot> {
    this.fanNotes[`${deviceId}:${fanId}`] = note;
    this.notify();
    return this.buildSnapshot();
  }

  async updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot> {
    this.startupSettings = { ...this.startupSettings, ...settings };
    this.notify();
    return this.buildSnapshot();
  }

  async cloudPush(): Promise<DesktopSnapshot> {
    return this.buildSnapshot();
  }

  async openExternal(url: string): Promise<void> {
    console.log(`[MockGuanlanAdapter] Opening external URL: ${url}`);
  }

  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const snapshot = this.buildSnapshot();
    this.listeners.forEach((fn) => fn(snapshot));
  }

  private buildSnapshot(request?: DesktopSnapshotRequest): DesktopSnapshot {
    if (this.flags.simulateEmpty) {
      return {
        generatedAt: new Date().toISOString(),
        source: "empty",
        cache: { available: false, savedAt: null, ageSeconds: null },
        session: { authenticated: true, accessKeyConfigured: true },
        localBackend: null,
        devices: [],
        selectedDeviceId: null,
        metrics: null,
        trafficCalendar: null,
        update: null,
        startup: this.startupSettings
      };
    }

    const isCached = this.flags.simulateCached;
    const stopped = this.flags.simulateAgentStopped || !this.isRunning;

    const devices: DeviceSummary[] = [
      {
        deviceId: "dev-win-01",
        hostname: "GUANLAN-WIN11-PRO",
        os: "windows",
        agentVersion: "0.2.77",
        agentChannel: "stable",
        status: stopped ? "offline" : "online",
        lastSeenAt: new Date().toISOString(),
        cpuUsagePercent: 24.5,
        gpuUsagePercent: 12.0,
        gpuMemoryUsagePercent: 35.0,
        memoryUsagePercent: 48.2,
        diskUsagePercent: 52.8
      },
      {
        deviceId: "dev-lin-02",
        hostname: "guanlan-edge-node02",
        os: "linux",
        agentVersion: "0.2.70",
        agentChannel: "test",
        status: "online",
        lastSeenAt: new Date().toISOString(),
        cpuUsagePercent: 62.1,
        gpuUsagePercent: null,
        gpuMemoryUsagePercent: null,
        memoryUsagePercent: 71.8,
        diskUsagePercent: 81.4
      },
      {
        deviceId: "dev-win-03",
        hostname: "GUANLAN-WORKSTATION-03",
        os: "windows",
        agentVersion: "0.2.68",
        agentChannel: "stable",
        status: "offline",
        lastSeenAt: new Date(Date.now() - 3600000 * 5).toISOString(),
        cpuUsagePercent: null,
        gpuUsagePercent: null,
        gpuMemoryUsagePercent: null,
        memoryUsagePercent: null,
        diskUsagePercent: null
      }
    ];

    const selectedDeviceId = request?.selectedDeviceId ?? "dev-win-01";

    const localBackend: DesktopAgentBackendState = {
      running: !stopped,
      backendStartedAt: this.backendStartedAt,
      frontendParentPid: this.frontendParentPid,
      childStartedAt: this.backendStartedAt,
      connectionStatus: stopped ? "disconnected" : "connected",
      cloudConfigPending: false,
      restartCount: 2,
      lastExitCode: stopped ? 0 : null,
      autoRestartPending: false,
      effectiveUploadIntervalSeconds: this.config.sampling.normalIntervalSeconds,
      configPath: "C:\\ProgramData\\Guanlan\\agent.json",
      configFileExists: true,
      syncStatePath: "C:\\ProgramData\\Guanlan\\sync.json",
      syncStateFileExists: true,
      diagnosticsPath: "C:\\ProgramData\\Guanlan\\diagnostics.log",
      diagnosticsFileExists: true,
      pendingStatePath: "C:\\ProgramData\\Guanlan\\spool.db",
      pendingStateFileExists: true,
      pendingSampleCount: this.flags.simulateError ? 18 : 0,
      pendingBytes: this.flags.simulateError ? 14280 : 0,
      lastIssueCount: this.flags.simulateError ? 1 : 0,
      lastUploadError: this.flags.simulateError
        ? "Failed to connect to Hub at http://127.0.0.1:3100: ECONNREFUSED"
        : undefined,
      config: this.config,
      supportedProbePlans: [
        { target: "cpu", providers: ["builtin", "wmi"], default: "builtin" },
        { target: "gpu", providers: ["libreHardwareMonitor", "openHardwareMonitor"], default: "libreHardwareMonitor" },
        { target: "memory", providers: ["builtin"], default: "builtin" },
        { target: "disk", providers: ["wmi", "builtin"], default: "wmi" },
        { target: "network", providers: ["builtin"], default: "builtin" },
        { target: "fan", providers: ["openHardwareMonitor"], default: "openHardwareMonitor" }
      ],
      detectedTargets: [
        {
          target: "cpu",
          label: "CPU 处理器探针",
          instances: [{ id: "cpu-0", name: "13th Gen Intel(R) Core(TM) i7-13700K", enabled: true, metrics: ["usage", "freq", "temp"] }]
        },
        {
          target: "gpu",
          label: "GPU 独立显卡探针",
          instances: [{ id: "gpu-0", name: "NVIDIA GeForce RTX 4080", enabled: true, metrics: ["usage", "memory", "temp"] }]
        }
      ]
    };

    const latest: MetricsLatest = {
      system: { processCount: 248, threadCount: 3120, handleCount: 94200 },
      cpuUsagePercent: 24.5,
      cpuFrequencyMHz: 4200,
      cpuTemperatureC: 48,
      cpuPackages: [{ id: "cpu-0", name: "Intel i7-13700K", coreCount: 16, logicalCount: 24, frequencyMHz: 4200, usagePercent: 24.5, temperatureC: 48 }],
      memoryUsedBytes: 15485760000,
      memoryTotalBytes: 34359738368,
      memoryAvailableBytes: 18873978368,
      memoryCachedBytes: 4294967296,
      memoryCommittedBytes: 21474836480,
      memorySpeedMHz: 5600,
      memorySlotCount: 4,
      memoryFormFactor: "DIMM",
      swapUsedBytes: 1073741824,
      swapTotalBytes: 8589934592,
      diskUsedBytes: 566935683072,
      diskTotalBytes: 1073741824000,
      networkRxBytesPerSec: 1048576,
      networkTxBytesPerSec: 524288,
      disks: [
        { id: "disk-0", name: "Samsung SSD 980 PRO 1TB", mountPoint: "C:", filesystem: "NTFS", totalBytes: 1073741824000, usedBytes: 566935683072, temperatureC: 41, healthStatus: "Good", healthPercent: 99 }
      ],
      networkInterfaces: [
        { id: "net-0", name: "Intel Ethernet Controller I225-V", macAddress: "00:1A:2B:3C:4D:5E", ipv4: ["192.168.1.100"], rxBytesPerSec: 1048576, txBytesPerSec: 524288 }
      ],
      gpus: [
        { id: "gpu-0", name: "NVIDIA GeForce RTX 4080", utilizationPercent: 12, memoryUsedBytes: 5798205849, memoryTotalBytes: 17179869184, temperatureC: 44, driverVersion: "551.86" }
      ],
      sensorBackends: [
        { id: "wmi", label: "Windows Management Instrumentation", ok: true },
        { id: "lhm", label: "LibreHardwareMonitor Driver", ok: true }
      ],
      fans: [
        { id: "fan-0", label: "CPU Fan", interface: "Motherboard PWM", rpm: 1240, note: this.fanNotes["dev-win-01:fan-0"] || "主板 CPU 散热风扇" },
        { id: "fan-1", label: "System Fan 1", interface: "Front Intake", rpm: 980, note: this.fanNotes["dev-win-01:fan-1"] || "机箱前置进风风扇" }
      ]
    };

    const metricWindow = request?.metricWindow ?? "1h";
    const sampleCount = 12;
    const now = Date.now();
    const intervalMs = metricWindow === "5m" ? 25000 : metricWindow === "1h" ? 300000 : 7200000;

    const samplePoints = Array.from({ length: sampleCount }, (_, i) => ({
      timestamp: new Date(now - (sampleCount - 1 - i) * intervalMs).toISOString(),
      value: Math.round(15 + Math.sin(i) * 10 + (i % 3) * 4)
    }));

    const series: MetricSeries = {
      cpuUsagePercent: samplePoints,
      cpuFrequencyMHz: samplePoints.map((p) => ({ ...p, value: p.value * 40 + 3200 })),
      cpuTemperatureC: samplePoints.map((p) => ({ ...p, value: Math.round(40 + p.value * 0.3) })),
      gpuUsagePercent: samplePoints.map((p) => ({ ...p, value: Math.round(p.value * 0.6) })),
      gpuEncodePercent: [],
      gpuDecodePercent: [],
      gpuFrequencyMHz: [],
      gpuMemoryUsagePercent: samplePoints.map((p) => ({ ...p, value: Math.round(20 + p.value * 0.4) })),
      gpuTemperatureC: [],
      memoryUsagePercent: samplePoints.map((p) => ({ ...p, value: Math.round(40 + (p.value % 5)) })),
      swapUsagePercent: [],
      memoryUsedBytes: [],
      swapUsedBytes: [],
      memoryAvailableBytes: [],
      memoryCachedBytes: [],
      memoryCommittedBytes: [],
      systemProcessCount: [],
      systemThreadCount: [],
      systemHandleCount: [],
      diskUsagePercent: samplePoints.map((p) => ({ ...p, value: 52.8 })),
      diskUsedBytes: [],
      diskReadBytesPerSec: [],
      diskWriteBytesPerSec: [],
      networkRxBytesPerSec: samplePoints.map((p) => ({ ...p, value: Math.round(p.value * 50000) })),
      networkTxBytesPerSec: samplePoints.map((p) => ({ ...p, value: Math.round(p.value * 25000) })),
      trafficRxBytes: [],
      trafficTxBytes: [],
      cpus: [],
      disks: [],
      networks: [],
      gpus: [],
      fans: []
    };

    const deviceDetail: DeviceDetail = {
      ...devices[0],
      platform: "win32",
      arch: "x64",
      cpuModel: "13th Gen Intel(R) Core(TM) i7-13700K"
    };

    const metrics: MetricsResponse = {
      device: deviceDetail,
      status: stopped ? "offline" : "online",
      lastSeenAt: new Date().toISOString(),
      enabledMetrics: this.config.enabledMetrics,
      enabledDeviceIds: this.config.enabledDeviceIds || {},
      instanceMetricConfig: this.config.instanceMetricConfig || {},
      availableMetrics: [
        { key: "cpuUsage", available: true },
        { key: "memoryUsage", available: true },
        { key: "gpuUsage", available: true },
        { key: "diskUsage", available: true }
      ],
      latest,
      series
    };

    const trafficMode = request?.trafficMode ?? "day";
    const cells: TrafficCalendarCell[] = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const dateStr = d.toISOString().slice(0, 10);
      const rx = 500000000 + Math.floor((i + 1) * 75000000);
      const tx = 200000000 + Math.floor((i + 1) * 35000000);
      return {
        key: dateStr,
        label: dateStr,
        rangeStart: `${dateStr}T00:00:00.000Z`,
        rangeEnd: `${dateStr}T23:59:59.999Z`,
        totalRxBytes: rx,
        totalTxBytes: tx,
        isSelected: i === 13,
        isCurrentPeriod: i === 13,
        isInPrimaryScope: true
      };
    });

    const trafficCalendar: TrafficCalendarResponse = {
      mode: trafficMode,
      anchor: new Date().toISOString().slice(0, 10),
      title: "每日数据网络流量统计",
      rangeStart: cells[0]?.rangeStart ?? new Date().toISOString(),
      rangeEnd: cells[cells.length - 1]?.rangeEnd ?? new Date().toISOString(),
      cells,
      records: cells.map((c) => ({
        timestamp: c.rangeStart,
        rxBytes: c.totalRxBytes,
        txBytes: c.totalTxBytes,
        totalBytes: c.totalRxBytes + c.totalTxBytes
      })),
      totalRxBytes: cells.reduce((acc, c) => acc + c.totalRxBytes, 0),
      totalTxBytes: cells.reduce((acc, c) => acc + c.totalTxBytes, 0)
    };

    return {
      generatedAt: new Date().toISOString(),
      source: isCached ? "cache" : "live",
      cache: {
        available: isCached,
        savedAt: isCached ? new Date(Date.now() - 120000).toISOString() : null,
        ageSeconds: isCached ? 120 : null
      },
      session: { authenticated: true, accessKeyConfigured: true },
      localBackend,
      devices,
      selectedDeviceId,
      metrics,
      trafficCalendar,
      update: null,
      startup: this.startupSettings
    };
  }
}
