import { createHash } from "node:crypto";
import type {
  AgentMetricsPayload,
  DeviceMetricKey,
  DiskDeviceStats,
  NetworkInterfaceStats,
  VirtualMachineTelemetry,
  VirtualizationSnapshot
} from "@dsc/shared";
import type { VirtualMachineRecord } from "../repositories/virtual-machines.js";

export const VIRTUAL_MACHINE_RUNTIME_METRICS: DeviceMetricKey[] = [
  "cpuUsage",
  "cpuFrequency",
  "cpuTemperature",
  "systemOverview",
  "memoryUsage",
  "memoryAvailable",
  "memoryCached",
  "memoryCommitted",
  "memoryHardware",
  "swapUsage",
  "diskUsage",
  "diskRead",
  "diskWrite",
  "diskActivity",
  "networkRxRate",
  "networkTxRate",
  "networkTraffic"
];

export function unavailableMetricsForVirtualMachinePowerState(powerState: string | null | undefined): DeviceMetricKey[] {
  return powerState?.trim().toLowerCase() === "running" ? [] : [...VIRTUAL_MACHINE_RUNTIME_METRICS];
}

export function unavailableMetricsForVirtualMachine(vm: VirtualMachineTelemetry): DeviceMetricKey[] {
  const unavailable = new Set(unavailableMetricsForVirtualMachinePowerState(vm.powerState));
  if (unavailable.size > 0) return [...unavailable];

  // Proxmox exposes the VM configuration and cumulative counters without a
  // guest OS. Keep those static facts, but do not turn missing guest/runtime
  // fields into zero-valued telemetry.
  unavailable.add("cpuFrequency");
  unavailable.add("cpuTemperature");
  unavailable.add("systemOverview");
  unavailable.add("memoryAvailable");
  unavailable.add("memoryCached");
  unavailable.add("memoryCommitted");
  unavailable.add("memoryHardware");
  unavailable.add("swapUsage");

  if (vm.cpu?.usagePercent == null) unavailable.add("cpuUsage");
  if (vm.memory?.usedBytes == null) unavailable.add("memoryUsage");

  const hasDiskUsage = vm.disk?.usedBytes != null || (vm.disks ?? []).some((disk) => disk.usedBytes != null);
  if (!hasDiskUsage) unavailable.add("diskUsage");

  const hasDiskReadRate = vm.disk?.readBytesPerSec != null || (vm.disks ?? []).some((disk) => disk.readBytesPerSec != null);
  const hasDiskWriteRate = vm.disk?.writeBytesPerSec != null || (vm.disks ?? []).some((disk) => disk.writeBytesPerSec != null);
  if (!hasDiskReadRate) unavailable.add("diskRead");
  if (!hasDiskWriteRate) unavailable.add("diskWrite");
  unavailable.add("diskActivity");

  const hasNetworkRxRate = vm.network?.rxBytesPerSec != null || (vm.networks ?? []).some((network) => network.rxBytesPerSec != null);
  const hasNetworkTxRate = vm.network?.txBytesPerSec != null || (vm.networks ?? []).some((network) => network.txBytesPerSec != null);
  if (!hasNetworkRxRate) unavailable.add("networkRxRate");
  if (!hasNetworkTxRate) unavailable.add("networkTxRate");
  const hasNetworkTraffic = (
    vm.network?.totalRxBytes != null && vm.network?.totalTxBytes != null
  ) || (vm.networks ?? []).some((network) => network.totalRxBytes != null && network.totalTxBytes != null);
  if (!hasNetworkTraffic) unavailable.add("networkTraffic");

  return [...unavailable];
}

export function virtualMachineScopeKey(snapshot: VirtualizationSnapshot, hostDeviceId: string): string {
  const source = snapshot.source.trim() || hostDeviceId;
  return `${snapshot.platform}:${source}`;
}

export function virtualMachineExternalId(vm: VirtualMachineTelemetry): string {
  return vm.id.trim() || vm.name.trim();
}

export function virtualMachineId(scopeKey: string, externalId: string): string {
  const digest = createHash("sha256")
    .update(`${scopeKey}\u0000${externalId}`)
    .digest("hex")
    .slice(0, 48);
  return `vm:${digest}`;
}

export function buildVirtualMachinePayload(
  hostPayload: AgentMetricsPayload,
  record: VirtualMachineRecord,
  vm: VirtualMachineTelemetry
): AgentMetricsPayload {
  const unavailableMetrics = unavailableMetricsForVirtualMachine(vm);
  const diskDevices = buildDiskDevices(vm);
  const diskTotalBytes = diskDevices.reduce((sum, disk) => sum + disk.totalBytes, 0) || unsigned(vm.disk?.provisionedBytes);
  const diskUsedBytes = diskDevices.reduce((sum, disk) => sum + disk.usedBytes, 0) || unsigned(vm.disk?.usedBytes ?? vm.disk?.allocatedBytes);
  const networkInterfaces = buildNetworkInterfaces(vm);
  const networkRxBytesPerSec = vm.network?.rxBytesPerSec ?? sumNetwork(networkInterfaces, "rxBytesPerSec");
  const networkTxBytesPerSec = vm.network?.txBytesPerSec ?? sumNetwork(networkInterfaces, "txBytesPerSec");
  const totalRxBytes = vm.network?.totalRxBytes ?? sumNetwork(networkInterfaces, "totalRxBytes");
  const totalTxBytes = vm.network?.totalTxBytes ?? sumNetwork(networkInterfaces, "totalTxBytes");
  const configuredMemory = unsigned(vm.memory?.configuredBytes);
  const observedUsedMemory = unsigned(vm.memory?.usedBytes);
  const usedMemory = configuredMemory > 0 ? Math.min(configuredMemory, observedUsedMemory) : observedUsedMemory;
  const availableMemory = unsigned(vm.memory?.availableBytes) || Math.max(configuredMemory - usedMemory, 0);
  const cpuUsagePercent = numeric(vm.cpu?.usagePercent);
  const vmName = record.name || vm.name || record.virtualMachineId;
  const diskRateInstances = Object.fromEntries(
    (vm.disks ?? []).map((disk) => [
      disk.id,
      {
        readBytesPerSec: numeric(disk.readBytesPerSec),
        writeBytesPerSec: numeric(disk.writeBytesPerSec)
      }
    ])
  );
  if (Object.keys(diskRateInstances).length === 0 && vm.disk) {
    diskRateInstances["vm-disk"] = {
      readBytesPerSec: numeric(vm.disk.readBytesPerSec),
      writeBytesPerSec: numeric(vm.disk.writeBytesPerSec)
    };
  }

  return {
    sampleId: `${hostPayload.sampleId ?? hostPayload.timestamp}:${record.virtualMachineId}`,
    identity: {
      deviceId: record.virtualMachineId,
      hostname: vmName,
      os: "unknown",
      platform: record.platform,
      arch: hostPayload.identity.arch,
      cpuModel: hostPayload.identity.cpuModel,
      version: hostPayload.identity.version,
      channel: hostPayload.identity.channel,
      instanceType: "virtual_machine",
      hostDeviceId: record.hostDeviceId,
      hostName: record.hostName,
      virtualMachine: {
        vmId: record.virtualMachineId,
        externalId: record.externalId,
        platform: record.platform,
        node: record.node,
        type: record.type,
        powerState: record.powerState,
        hostDeviceId: record.hostDeviceId,
        hostName: record.hostName
      }
    },
    timestamp: hostPayload.timestamp,
    heartbeatAt: hostPayload.heartbeatAt,
    unavailableMetrics,
    system: { processCount: 0, threadCount: 0, handleCount: 0 },
    cpuUsagePercent,
    cpuFrequencyMHz: null,
    cpuTemperatureC: null,
    cpuPackages: [
      {
        id: "vm-vcpu",
        name: "vCPU",
        model: hostPayload.identity.cpuModel,
        coreCount: vm.cpu?.configuredCores ?? undefined,
        logicalCount: vm.cpu?.configuredCores ?? undefined,
        usagePercent: cpuUsagePercent
      }
    ],
    memory: {
      totalBytes: configuredMemory,
      usedBytes: usedMemory,
      availableBytes: availableMemory,
      cachedBytes: 0,
      committedBytes: usedMemory,
      commitLimitBytes: configuredMemory,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      speedMHz: null,
      slotCount: null,
      formFactor: null
    },
    diskUsage: { totalBytes: diskTotalBytes, usedBytes: diskUsedBytes },
    disks: diskDevices,
    diskRate: {
      readBytesPerSec: numeric(vm.disk?.readBytesPerSec),
      writeBytesPerSec: numeric(vm.disk?.writeBytesPerSec),
      instances: diskRateInstances
    },
    networkRate: { rxBytesPerSec: networkRxBytesPerSec, txBytesPerSec: networkTxBytesPerSec, totalRxBytes, totalTxBytes },
    networkInterfaces,
    gpus: [],
    fans: [],
    sensorBackends: [],
    virtualization: null
  };
}

function buildDiskDevices(vm: VirtualMachineTelemetry): DiskDeviceStats[] {
  const disks = (vm.disks ?? []).map((disk) => ({
    id: disk.id,
    name: disk.name,
    mountPoint: disk.path ?? "",
    filesystem: undefined,
    model: undefined,
    vendor: disk.storage ?? undefined,
    sourceKey: disk.id,
    temperatureC: null,
    healthStatus: null,
    healthReason: null,
    healthPercent: null,
    smartAttributes: [],
    activePercent: null,
    averageResponseMs: disk.latencyMs ?? null,
    interfaceType: disk.storage ?? null,
    totalBytes: unsigned(disk.capacityBytes ?? disk.allocatedBytes),
    usedBytes: unsigned(disk.usedBytes ?? disk.allocatedBytes)
  } satisfies DiskDeviceStats));
  if (disks.length > 0) return disks;

  const totalBytes = unsigned(vm.disk?.provisionedBytes);
  const usedBytes = unsigned(vm.disk?.usedBytes ?? vm.disk?.allocatedBytes);
  if (totalBytes === 0 && usedBytes === 0) return [];
  return [{
    id: "vm-disk",
    name: "virtual-disk",
    mountPoint: "",
    sourceKey: "vm-disk",
    totalBytes,
    usedBytes,
    temperatureC: null,
    healthStatus: null,
    healthReason: null,
    healthPercent: null,
    smartAttributes: [],
    activePercent: null,
    averageResponseMs: null,
    interfaceType: null
  }];
}

function buildNetworkInterfaces(vm: VirtualMachineTelemetry): NetworkInterfaceStats[] {
  const networks = (vm.networks ?? []).map((network) => ({
    id: network.id,
    name: network.name,
    macAddress: network.macAddress || undefined,
    ipv4: [],
    ipv6: [],
    rxBytesPerSec: numeric(network.rxBytesPerSec),
    txBytesPerSec: numeric(network.txBytesPerSec),
    totalRxBytes: unsigned(network.totalRxBytes),
    totalTxBytes: unsigned(network.totalTxBytes),
    linkSpeedMbps: null,
    connectionType: network.network ?? network.bridge ?? network.switchName ?? null,
    signalStrengthPercent: null
  } satisfies NetworkInterfaceStats));
  if (networks.length > 0) return networks;
  if (!vm.network) return [];
  return [{
    id: "vm-network",
    name: "virtual-network",
    ipv4: [],
    ipv6: [],
    rxBytesPerSec: numeric(vm.network.rxBytesPerSec),
    txBytesPerSec: numeric(vm.network.txBytesPerSec),
    totalRxBytes: unsigned(vm.network.totalRxBytes),
    totalTxBytes: unsigned(vm.network.totalTxBytes),
    linkSpeedMbps: null,
    connectionType: null,
    signalStrengthPercent: null
  }];
}

function sumNetwork(items: NetworkInterfaceStats[], key: "rxBytesPerSec" | "txBytesPerSec" | "totalRxBytes" | "totalTxBytes"): number {
  return items.reduce((sum, item) => sum + numeric(item[key]), 0);
}

function numeric(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function unsigned(value: number | null | undefined): number {
  return Math.max(0, numeric(value));
}
