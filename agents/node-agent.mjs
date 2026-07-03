import os from "node:os";
import { readFileSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const commandTimeoutMs = Number(process.env.DSC_COMMAND_TIMEOUT_MS ?? 2000);
const hardwareMonitorTimeoutMs = Number(process.env.DSC_HARDWARE_MONITOR_TIMEOUT_MS ?? 15000);
const windowsCommandTimeoutMs = Number(process.env.DSC_WINDOWS_COMMAND_TIMEOUT_MS ?? Math.max(commandTimeoutMs, 15000));

const serverUrl = process.env.DSC_SERVER_URL ?? "http://127.0.0.1:4000";
const agentSecret = process.env.DSC_AGENT_SECRET ?? "replace-me-agent-secret";
const deviceId = process.env.DSC_DEVICE_ID ?? "开发机";
const hostname = process.env.DSC_HOSTNAME ?? deviceId;
const hardwareJsonUrl = process.env.DSC_HARDWARE_JSON_URL ?? "";
const hardwareDllPath = process.env.DSC_HARDWARE_DLL_PATH ?? "";
const allowAcpiThermalZone = process.env.DSC_ALLOW_ACPI_THERMAL_ZONE === "true";
const redfishUrl = trimTrailingSlash(process.env.DSC_REDFISH_URL ?? "");
const redfishUsername = process.env.DSC_REDFISH_USERNAME ?? "";
const redfishPassword = process.env.DSC_REDFISH_PASSWORD ?? "";
const redfishInsecure = process.env.DSC_REDFISH_INSECURE === "true";
const redfishTimeoutMs = Number(process.env.DSC_REDFISH_TIMEOUT_MS ?? 5000);
const pollIntervalMs = 5000;
const sensorCacheTtlMs = 60_000;
const agentDir = path.dirname(fileURLToPath(import.meta.url));
const bundledHardwareDllPath = path.join(agentDir, "windows-hardware", "librehardwaremonitor", "LibreHardwareMonitorLib.dll");

let previousCpu = os.cpus();
const metricCache = new Map();
let previousNet = await readNetCounters();
let previousDisk = await readDiskCounters();
let previousInterfaceStats = await readNetworkInterfaces();
let windowsHardwareSensorsCache = { at: 0, value: [] };
let lastWindowsHardwareSensorError = "";
let redfishCache = { at: 0, value: { cpuTemperatureC: null, fans: [], status: { ok: false, detail: "not configured" } } };
let lastWindowsHardwareBackendStatus = { ok: false, detail: "not probed" };
let lastPawnIoStatus = { ok: false, detail: "not probed" };
let lastRedfishBackendStatus = { ok: false, detail: redfishUrl ? "not probed" : "not configured" };
let lastWindowsHardwareProbeSummary = null;

setInterval(runOnce, pollIntervalMs);
await runOnce();

async function runOnce() {
  try {
    const timestamp = new Date().toISOString();
    const cpuUsagePercent = sampleCpuUsage();
    const [
      cpuFrequencyMHz,
      memory,
      diskSample,
      diskRate,
      networkSample,
      cpuTemperatureC,
      gpus,
      fans,
      sensorBackends
    ] = await Promise.all([
      sampleCpuFrequency(),
      sampleMemory(),
      sampleDiskUsage(),
      sampleDiskRate(),
      sampleNetworkRate(),
      sampleCpuTemperature(),
      sampleGpus(),
      sampleFans(),
      sampleSensorBackends()
    ]);
    const cpuPackages = await sampleCpuPackages(cpuFrequencyMHz);
    const { diskUsage, disks } = diskSample;
    const { networkRate, networkInterfaces } = networkSample;

    const payload = {
      identity: {
        deviceId,
        hostname,
        os: process.platform === "win32" ? "windows" : "linux",
        platform: process.platform,
        arch: process.arch,
        cpuModel: os.cpus()[0]?.model
      },
      timestamp,
      heartbeatAt: timestamp,
      cpuUsagePercent,
      cpuFrequencyMHz,
      cpuTemperatureC,
      cpuPackages,
      memory,
      diskUsage,
      disks,
      diskRate,
      networkRate,
      networkInterfaces,
      gpus,
      fans,
      sensorBackends
    };

    const response = await fetch(`${serverUrl}/api/agent/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentSecret}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`upload failed: ${response.status}`);
    }
    console.log(`[agent] uploaded ${timestamp}`);
  } catch (error) {
    console.error("[agent] upload error", error);
  }
}

function sampleCpuUsage() {
  const current = os.cpus();
  let idleDiff = 0;
  let totalDiff = 0;
  for (let index = 0; index < current.length; index += 1) {
    const prev = previousCpu[index];
    const next = current[index];
    const prevTotal = Object.values(prev.times).reduce((sum, value) => sum + value, 0);
    const nextTotal = Object.values(next.times).reduce((sum, value) => sum + value, 0);
    idleDiff += next.times.idle - prev.times.idle;
    totalDiff += nextTotal - prevTotal;
  }
  previousCpu = current;
  const usage = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;
  return round(usage);
}

function sampleMemory() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  return readSwapMemory().then((swap) => {
    const cachedSwapTotal = metricCache.get("swapTotalBytes")?.value ?? 0;
    const cachedSwapUsed = metricCache.get("swapUsedBytes")?.value ?? 0;
    const swapTotalBytes = Number(swap.totalBytes ?? 0) > 0 ? Number(swap.totalBytes) : Number(cachedSwapTotal);
    const swapUsedBytes = Number(swap.usedBytes ?? 0) > 0 ? Number(swap.usedBytes) : Number(cachedSwapUsed);
    if (swapTotalBytes > 0) metricCache.set("swapTotalBytes", { value: swapTotalBytes, at: Date.now(), source: "memory-swap" });
    if (swapUsedBytes > 0 || swapTotalBytes > 0) {
      metricCache.set("swapUsedBytes", { value: swapUsedBytes, at: Date.now(), source: "memory-swap" });
    }
    return {
      totalBytes,
      usedBytes: totalBytes - freeBytes,
      swapTotalBytes,
      swapUsedBytes
    };
  });
}

function getCachedMetricValue(key, maxAgeMs = sensorCacheTtlMs) {
  const cached = metricCache.get(key);
  if (!cached) return null;
  if (Date.now() - Number(cached.at ?? 0) > maxAgeMs) return null;
  return cached.value;
}

async function sampleCpuPackages(cpuFrequencyMHz) {
  if (process.platform === "win32") {
    const hardwarePackages = await readWindowsCpuPackagesFromDll(cpuFrequencyMHz);
    try {
      const { stdout } = await runPowerShell(
        [
          "$ErrorActionPreference = 'Stop'",
          "Get-CimInstance Win32_Processor | ForEach-Object {",
          "  [pscustomobject]@{",
          "    Id = $_.DeviceID",
          "    Name = $_.Name",
          "    Model = $_.Name",
          "    CoreCount = $_.NumberOfCores",
          "    LogicalCount = $_.NumberOfLogicalProcessors",
          "    FrequencyMHz = $_.CurrentClockSpeed",
          "  }",
          "} | ConvertTo-Json -Compress"
        ].join("; "),
        { timeoutMs: windowsCommandTimeoutMs }
      );
      const parsed = JSON.parse(String(stdout).trim() || "[]");
      const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      const wmiPackages = rows.map((row, index) => ({
        id: String(row.Id ?? `cpu-${index}`),
        name: String(row.Name ?? `CPU ${index + 1}`),
        model: String(row.Model ?? row.Name ?? ""),
        coreCount: Number(row.CoreCount ?? 0),
        logicalCount: Number(row.LogicalCount ?? 0),
        frequencyMHz: Number.isFinite(Number(row.FrequencyMHz)) ? round(Number(row.FrequencyMHz)) : cpuFrequencyMHz
      }));
      return hardwarePackages.length ? mergeCpuPackageInventory(hardwarePackages, wmiPackages) : wmiPackages;
    } catch {
      if (hardwarePackages.length) return mergeCpuPackageInventory(hardwarePackages, []);
      return [
        {
          id: "cpu-0",
          name: "CPU 1",
          model: os.cpus()[0]?.model ?? "",
          coreCount: os.cpus().length,
          logicalCount: os.cpus().length,
          frequencyMHz: cpuFrequencyMHz
        }
      ];
    }
  }
  return [
    {
      id: "cpu-0",
      name: "CPU 1",
      model: os.cpus()[0]?.model ?? "",
      coreCount: os.cpus().length,
      logicalCount: os.cpus().length,
      frequencyMHz: cpuFrequencyMHz
    }
  ];
}

async function readWindowsCpuPackagesFromDll(cpuFrequencyMHz) {
  const sensors = await readWindowsHardwareMonitorSensorsFromDll();
  if (!sensors.length) return [];
  const grouped = new Map();
  for (const sensor of sensors) {
    const hardwareType = String(sensor.hardwareType ?? "").toLowerCase();
    const identifier = String(sensor.identifier ?? "");
    const hardware = String(sensor.hardware ?? "");
    const match = identifier.match(/\/(?:intelcpu|amdcpu)\/(\d+)(?:\/|$)/i);
    if (!match && !hardwareType.includes("cpu")) continue;
    const index = match ? Number(match[1]) : grouped.size;
    const key = `cpu-${index}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key,
        name: hardware || `CPU ${index + 1}`,
        model: hardware || os.cpus()[0]?.model || "",
        coreCount: 0,
        logicalCount: 0,
        frequencyMHz: cpuFrequencyMHz,
        usagePercent: null,
        temperatureC: null,
        clockValues: [],
        temperatureCandidates: [],
        threadIds: new Set()
      });
    }
    const current = grouped.get(key);
    const sensorType = String(sensor.sensorType ?? "").toLowerCase();
    const sensorName = String(sensor.name ?? "").toLowerCase();
    const value = Number(sensor.value);
    if (!Number.isFinite(value)) continue;
    if (sensorType === "load" && (sensorName === "cpu total" || sensorName.includes("total"))) {
      current.usagePercent = round(value);
    }
    if (sensorType === "clock" && isReasonableCpuFrequency(value)) {
      current.clockValues.push(value);
    }
    if (sensorType === "temperature") {
      const score = scoreCpuTemperatureSensor({
        name: sensorName,
        identifier: identifier.toLowerCase(),
        hardwareType
      });
      current.temperatureCandidates.push({ value, score });
    }
    const threadMatch = identifier.match(/\/thread\/(\d+)(?:\/|$)/i);
    if (threadMatch) current.threadIds.add(Number(threadMatch[1]));
  }
  return [...grouped.values()]
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
    .map((entry, index) => {
      const clockValues = entry.clockValues.filter(isReasonableCpuFrequency);
      const logicalCount = entry.threadIds.size;
      return {
        id: entry.id || `cpu-${index}`,
        name: entry.name || `CPU ${index + 1}`,
        model: entry.model || entry.name || "",
        coreCount: 0,
        logicalCount,
        frequencyMHz: clockValues.length ? round(clockValues.reduce((sum, value) => sum + value, 0) / clockValues.length) : entry.frequencyMHz,
        usagePercent: entry.usagePercent,
        temperatureC: selectBestCpuTemperature(entry.temperatureCandidates)
      };
    });
}

function mergeCpuPackageInventory(hardwarePackages, inventoryPackages) {
  const totalCores = inventoryPackages.reduce((sum, cpu) => sum + (Number(cpu.coreCount) || 0), 0);
  const totalLogical = inventoryPackages.reduce((sum, cpu) => sum + (Number(cpu.logicalCount) || 0), 0);
  const osLogical = os.cpus().length;
  const fallbackLogical = hardwarePackages.length > 0 && osLogical > 0 ? Math.round(osLogical / hardwarePackages.length) : 0;
  const perPackageCores = hardwarePackages.length > 0 && totalCores > 0 ? Math.round(totalCores / hardwarePackages.length) : fallbackLogical;
  const perPackageLogical = hardwarePackages.length > 0 && totalLogical > 0 ? Math.round(totalLogical / hardwarePackages.length) : fallbackLogical;
  const inventoryMatchesHardware = inventoryPackages.length === hardwarePackages.length;
  return hardwarePackages.map((cpu, index) => {
    const inventory = inventoryPackages[index] ?? inventoryPackages[0];
    return {
      ...cpu,
      name: cpu.name || inventory?.name || `CPU ${index + 1}`,
      model: cpu.model || inventory?.model || inventory?.name || "",
      coreCount: cpu.coreCount || (inventoryMatchesHardware ? inventory?.coreCount : perPackageCores) || inventory?.coreCount || 0,
      logicalCount: cpu.logicalCount || (inventoryMatchesHardware ? inventory?.logicalCount : perPackageLogical) || inventory?.logicalCount || 0,
      frequencyMHz: cpu.frequencyMHz ?? inventory?.frequencyMHz ?? null
    };
  });
}

async function sampleDiskUsage() {
  if (process.platform === "win32") {
    try {
      const { stdout } = await runPowerShell(`$ErrorActionPreference = 'Stop'
$logicalDisks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3")
$partitions = @(Get-Partition)
$disks = @(Get-Disk)
$physicalDisks = @{}
try {
  Get-PhysicalDisk | ForEach-Object { $physicalDisks[[int]$_.DeviceId] = $_ }
} catch {}
$rows = foreach ($logicalDisk in $logicalDisks) {
  $driveLetter = $logicalDisk.DeviceID.TrimEnd(':')
  $partition = $partitions | Where-Object { $_.DriveLetter -eq $driveLetter } | Select-Object -First 1
  $disk = if ($partition) { $disks | Where-Object { $_.Number -eq $partition.DiskNumber } | Select-Object -First 1 } else { $null }
  $physical = if ($disk -and $physicalDisks.ContainsKey([int]$disk.Number)) { $physicalDisks[[int]$disk.Number] } else { $null }
  [pscustomobject]@{
    DriveLetter = $driveLetter
    VolumeLabel = $logicalDisk.VolumeName
    FileSystem = $logicalDisk.FileSystem
    Size = [uint64]$logicalDisk.Size
    SizeRemaining = [uint64]$logicalDisk.FreeSpace
    DiskNumber = if ($disk) { [int]$disk.Number } else { $null }
    PartitionNumber = if ($partition) { [int]$partition.PartitionNumber } else { $null }
    PartitionSize = if ($partition) { [uint64]$partition.Size } else { $null }
    Model = if ($disk) { $disk.FriendlyName } else { $null }
    Vendor = if ($physical) { $physical.Manufacturer } else { $null }
    BusType = if ($disk) { $disk.BusType.ToString() } else { $null }
    SerialNumber = if ($disk) { $disk.SerialNumber } else { $null }
    MediaType = if ($physical) { $physical.MediaType.ToString() } else { $null }
    PhysicalSize = if ($disk) { [uint64]$disk.Size } else { $null }
  }
}
$rows | ConvertTo-Json -Compress -Depth 5`, { encoded: true, timeoutMs: windowsCommandTimeoutMs });
      const rows = JSON.parse(String(stdout).trim() || "[]");
      const diskTemperatures = await readWindowsDiskTemperaturesFromDll();
      const list = (Array.isArray(rows) ? rows : [rows])
        .filter(Boolean)
        .map((item) => {
          const totalBytes = Number(item.Size ?? 0);
          const freeBytes = Number(item.SizeRemaining ?? 0);
          const usedBytes = Math.max(0, totalBytes - freeBytes);
          const mountPoint = `${item.DriveLetter}:\\`;
          const diskNumber = item.DiskNumber != null ? Number(item.DiskNumber) : null;
          const partitionNumber = item.PartitionNumber != null ? Number(item.PartitionNumber) : null;
          const sourceKey = diskNumber != null ? `disk-${diskNumber}` : mountPoint;
          const detailParts = [item.FileSystem, item.BusType, item.MediaType].filter(Boolean);
          const partitionSuffix =
            diskNumber != null && partitionNumber != null ? ` [Disk ${diskNumber} / Partition ${partitionNumber}]` : "";
          const model = String(item.Model ?? "");
          return {
            id: diskNumber != null ? `disk-${diskNumber}-part-${partitionNumber ?? item.DriveLetter}` : mountPoint,
            name: item.VolumeLabel
              ? `${item.DriveLetter}: (${item.VolumeLabel})${partitionSuffix}`
              : `${item.DriveLetter}:${partitionSuffix}`,
            mountPoint,
            filesystem: detailParts.join(" · "),
            model,
            vendor: item.Vendor ?? "",
            sourceKey,
            totalBytes,
            usedBytes,
            temperatureC: matchDiskTemperature(diskTemperatures, {
              diskNumber,
              model,
              serialNumber: item.SerialNumber
            })
          };
        });
      if (list.length === 0) {
        const cachedDisks = getCachedMetricValue("windowsDisks");
        if (Array.isArray(cachedDisks) && cachedDisks.length > 0) {
          return {
            diskUsage: summarizeDisks(cachedDisks),
            disks: cachedDisks
          };
        }
      }
      metricCache.set("windowsDisks", { value: list, at: Date.now(), source: "disk-primary" });
      return {
        diskUsage: summarizeDisks(list),
        disks: list
      };
    } catch {
      try {
        const { stdout } = await runPowerShell(`$ErrorActionPreference = 'Stop'
$rows = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  [pscustomobject]@{
    DriveLetter = $_.DeviceID.TrimEnd(':')
    VolumeLabel = $_.VolumeName
    FileSystem = $_.FileSystem
    Size = [uint64]$_.Size
    SizeRemaining = [uint64]$_.FreeSpace
  }
}
$rows | ConvertTo-Json -Compress -Depth 5`, { encoded: true, timeoutMs: windowsCommandTimeoutMs });
        const rows = JSON.parse(String(stdout).trim() || "[]");
        const list = (Array.isArray(rows) ? rows : [rows])
          .filter(Boolean)
          .map((item) => {
            const totalBytes = Number(item.Size ?? 0);
            const freeBytes = Number(item.SizeRemaining ?? 0);
            const usedBytes = Math.max(0, totalBytes - freeBytes);
            const mountPoint = `${item.DriveLetter}:\\`;
            return {
              id: mountPoint,
              name: item.VolumeLabel ? `${item.DriveLetter}: (${item.VolumeLabel})` : `${item.DriveLetter}:`,
              mountPoint,
              filesystem: String(item.FileSystem ?? ""),
              model: "",
              vendor: "",
              sourceKey: mountPoint,
              totalBytes,
              usedBytes,
              temperatureC: null
            };
          });
        if (list.length === 0) {
          const cachedDisks = getCachedMetricValue("windowsDisks");
          if (Array.isArray(cachedDisks) && cachedDisks.length > 0) {
            return {
              diskUsage: summarizeDisks(cachedDisks),
              disks: cachedDisks
            };
          }
        }
        metricCache.set("windowsDisks", { value: list, at: Date.now(), source: "disk-fallback" });
        return {
          diskUsage: summarizeDisks(list),
          disks: list
        };
      } catch {
        const cachedDisks = metricCache.get("windowsDisks")?.value;
        if (Array.isArray(cachedDisks) && cachedDisks.length > 0) {
          return {
            diskUsage: summarizeDisks(cachedDisks),
            disks: cachedDisks
          };
        }
        return { diskUsage: { totalBytes: 0, usedBytes: 0 }, disks: [] };
      }
    }
  }
  try {
    const disks = await readLinuxDisks();
    return {
      diskUsage: summarizeDisks(disks),
      disks
    };
  } catch {
    return { diskUsage: { totalBytes: 0, usedBytes: 0 }, disks: [] };
  }
}

async function sampleDiskRate() {
  if (process.platform === "win32") {
    return await sampleWindowsDiskRate();
  }
  const current = await readDiskCounters();
  const seconds = pollIntervalMs / 1000;
  const readBytesPerSec = Math.max(0, current.read - previousDisk.read) / seconds;
  const writeBytesPerSec = Math.max(0, current.write - previousDisk.write) / seconds;
  previousDisk = current;
  return {
    readBytesPerSec: round(readBytesPerSec),
    writeBytesPerSec: round(writeBytesPerSec)
  };
}

async function sampleNetworkRate() {
  const current = await readNetCounters();
  const currentInterfaces = await readNetworkInterfaces();
  const seconds = pollIntervalMs / 1000;
  const aggregateFromInterfaces = currentInterfaces.reduce(
    (acc, item) => ({
      rx: acc.rx + Number(item.totalRxBytes ?? 0),
      tx: acc.tx + Number(item.totalTxBytes ?? 0)
    }),
    { rx: 0, tx: 0 }
  );
  const currentTotals =
    aggregateFromInterfaces.rx > 0 || aggregateFromInterfaces.tx > 0 ? aggregateFromInterfaces : current;
  const rxDelta = Math.max(0, current.rx - previousNet.rx);
  const txDelta = Math.max(0, current.tx - previousNet.tx);
  const safeRxDelta = Math.max(0, currentTotals.rx - previousNet.rx);
  const safeTxDelta = Math.max(0, currentTotals.tx - previousNet.tx);
  previousNet = currentTotals;
  const previousById = new Map(previousInterfaceStats.map((item) => [item.id, item]));
  const networkInterfaces = currentInterfaces.map((item) => {
    const previous = previousById.get(item.id);
    const deltaRx = Math.max(0, Number(item.totalRxBytes ?? 0) - Number(previous?.totalRxBytes ?? 0));
    const deltaTx = Math.max(0, Number(item.totalTxBytes ?? 0) - Number(previous?.totalTxBytes ?? 0));
    return {
      ...item,
      rxBytesPerSec: round(deltaRx / seconds),
      txBytesPerSec: round(deltaTx / seconds)
    };
  });
  previousInterfaceStats = currentInterfaces;
  return {
    networkRate: {
      rxBytesPerSec: round(safeRxDelta / seconds),
      txBytesPerSec: round(safeTxDelta / seconds),
      totalRxBytes: currentTotals.rx,
      totalTxBytes: currentTotals.tx
    },
    networkInterfaces
  };
}

async function sampleWindowsDiskRate() {
  try {
    const { stdout } = await runPowerShell(
      [
        "$ProgressPreference = 'SilentlyContinue'",
        "$ErrorActionPreference = 'Stop'",
        "$rows = Get-Counter '\\PhysicalDisk(*)\\Disk Read Bytes/sec','\\PhysicalDisk(*)\\Disk Write Bytes/sec' | Select-Object -ExpandProperty CounterSamples",
        "$rows | Select-Object Path,InstanceName,CookedValue | ConvertTo-Json -Compress -Depth 4"
      ].join("; "),
      { timeoutMs: windowsCommandTimeoutMs }
    );
    const parsed = JSON.parse(String(stdout).trim() || "[]");
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const instances = {};
    let readBytesPerSec = 0;
    let writeBytesPerSec = 0;

    for (const row of rows) {
      const instanceName = String(row.InstanceName ?? "");
      if (!instanceName || instanceName === "_Total") continue;
      const match = instanceName.match(/^(\d+)/);
      const sourceKey = match ? `disk-${match[1]}` : instanceName;
      instances[sourceKey] ??= { readBytesPerSec: 0, writeBytesPerSec: 0 };
      const value = round(Number(row.CookedValue ?? 0));
      const path = String(row.Path ?? "").toLowerCase();
      if (path.endsWith("\\disk read bytes/sec")) {
        instances[sourceKey].readBytesPerSec += value;
        readBytesPerSec += value;
      }
      if (path.endsWith("\\disk write bytes/sec")) {
        instances[sourceKey].writeBytesPerSec += value;
        writeBytesPerSec += value;
      }
    }

    return {
      readBytesPerSec,
      writeBytesPerSec,
      instances
    };
  } catch {
    return {
      readBytesPerSec: 0,
      writeBytesPerSec: 0,
      instances: {}
    };
  }
}

async function sampleCpuTemperature() {
  const hardwareSnapshot = await readHardwareMonitorSnapshot();
  const candidates = [];
  if (hardwareSnapshot) {
    const cpuTemp = extractHardwareMonitorCpuTemperature(hardwareSnapshot);
    if (cpuTemp != null) {
      candidates.push({ source: "hardware-json", score: 120, value: cpuTemp });
    }
  }
  if (process.platform === "win32") {
    const windowsCandidates = await readWindowsCpuTemperatureCandidates();
    candidates.push(...windowsCandidates);
    const redfish = await readRedfishSensors();
    if (redfish.cpuTemperatureC != null) {
      candidates.push({ source: "redfish", score: 95, value: redfish.cpuTemperatureC });
    }
    if (allowAcpiThermalZone) {
      const acpiTemperature = await readWindowsAcpiThermalZoneTemperature();
      if (acpiTemperature != null) {
        candidates.push({ source: "windows-acpi", score: 10, value: acpiTemperature });
      }
    }
    return selectCachedMetric("cpuTemperatureC", candidates, isReasonableCpuTemperature, round);
  }
  if (process.platform !== "linux") return null;
  const sensorsTemp = await readCpuTemperatureFromSensors();
  if (sensorsTemp != null) {
    candidates.push({ source: "linux-sensors", score: 100, value: sensorsTemp });
  }
  const redfish = await readRedfishSensors();
  if (redfish.cpuTemperatureC != null) {
    candidates.push({ source: "redfish", score: 95, value: redfish.cpuTemperatureC });
  }
  const paths = [
    "/sys/class/thermal/thermal_zone0/temp",
    "/sys/class/hwmon/hwmon0/temp1_input"
  ];
  for (const path of paths) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      candidates.push({
        source: `linux-sysfs:${path}`,
        score: 80,
        value: value >= 1000 ? value / 1000 : value
      });
    } catch {}
  }
  return selectCachedMetric("cpuTemperatureC", candidates, isReasonableCpuTemperature, round);
}

async function sampleCpuFrequency() {
  if (process.platform === "win32") {
    const frequency = await readBestWindowsCpuFrequency();
    const fallbackSpeed = averageCpuSpeed();
    return selectCachedMetric(
      "cpuFrequencyMHz",
      [
        ...(frequency != null ? [{ source: "windows-best", score: 200, value: frequency }] : []),
        ...(fallbackSpeed != null ? [{ source: "os-cpus-speed", score: 60, value: fallbackSpeed }] : [])
      ],
      isReasonableCpuFrequency,
      round
    );
  }
  if (process.platform !== "linux") return null;
  const candidates = [];
  try {
    const cpuinfo = requireText("/proc/cpuinfo");
    const matches = [...cpuinfo.matchAll(/^cpu MHz\s*:\s*([0-9.]+)$/gm)].map((match) => Number(match[1]));
    const values = matches.filter((value) => Number.isFinite(value) && value > 0);
    if (values.length) {
      candidates.push({
        source: "linux-proc-cpuinfo",
        score: 100,
        value: values.reduce((sum, value) => sum + value, 0) / values.length
      });
    }
  } catch {}
  return selectCachedMetric("cpuFrequencyMHz", candidates, isReasonableCpuFrequency, round);
}

function averageCpuSpeed() {
  const values = os.cpus()
    .map((cpu) => Number(cpu?.speed ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function readBestWindowsCpuFrequency() {
  const fastFallback = averageCpuSpeed();
  if (fastFallback != null) {
    return round(fastFallback);
  }
  try {
    const { stdout } = await runPowerShell(
      [
        "$ProgressPreference = 'SilentlyContinue'",
        "$ErrorActionPreference = 'Stop'",
        "$perfFormatted = @()",
        "$perfCounter = @()",
        "$wmi = @()",
        "$maxClock = @()",
        "try {",
        "  $perfFormatted = @(Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -ErrorAction Stop | Where-Object { $_.Name -notmatch '_Total' -and $_.ProcessorFrequency -gt 0 } | Select-Object -ExpandProperty ProcessorFrequency)",
        "} catch {}",
        "try {",
        "  $perfCounter = @((Get-Counter '\\Processor Information(*)\\Processor Frequency' -ErrorAction Stop).CounterSamples | Where-Object { $_.InstanceName -notmatch '_Total' -and $_.CookedValue -gt 0 } | Select-Object -ExpandProperty CookedValue)",
        "} catch {}",
        "try {",
        "  $wmi = @(Get-CimInstance Win32_Processor -ErrorAction Stop | Where-Object { $_.CurrentClockSpeed -gt 0 } | Select-Object -ExpandProperty CurrentClockSpeed)",
        "  $maxClock = @(Get-CimInstance Win32_Processor -ErrorAction Stop | Where-Object { $_.MaxClockSpeed -gt 0 } | Select-Object -ExpandProperty MaxClockSpeed)",
        "} catch {}",
        "$perfFormattedAvg = if ($perfFormatted.Count -gt 0) { ($perfFormatted | Measure-Object -Average).Average } else { $null }",
        "$perfCounterAvg = if ($perfCounter.Count -gt 0) { ($perfCounter | Measure-Object -Average).Average } else { $null }",
        "$wmiAvg = if ($wmi.Count -gt 0) { ($wmi | Measure-Object -Average).Average } else { $null }",
        "$maxClockAvg = if ($maxClock.Count -gt 0) { ($maxClock | Measure-Object -Average).Average } else { $null }",
        "$perfFormattedMin = if ($perfFormatted.Count -gt 0) { ($perfFormatted | Measure-Object -Minimum).Minimum } else { $null }",
        "$perfFormattedMax = if ($perfFormatted.Count -gt 0) { ($perfFormatted | Measure-Object -Maximum).Maximum } else { $null }",
        "$perfCounterMin = if ($perfCounter.Count -gt 0) { ($perfCounter | Measure-Object -Minimum).Minimum } else { $null }",
        "$perfCounterMax = if ($perfCounter.Count -gt 0) { ($perfCounter | Measure-Object -Maximum).Maximum } else { $null }",
        "$choice = $null",
        "if ($perfCounterAvg -and $perfCounterAvg -gt 0) {",
        "  $choice = $perfCounterAvg",
        "} elseif ($perfFormattedAvg -and $perfFormattedAvg -gt 0) {",
        "  $looksStaticMax = $maxClockAvg -and [math]::Abs($perfFormattedAvg - $maxClockAvg) -lt 1 -and $perfCounterAvg -and [math]::Abs($perfCounterAvg - $perfFormattedAvg) -gt 50",
        "  if (-not $looksStaticMax) { $choice = $perfFormattedAvg }",
        "} ",
        "if (-not $choice -and $wmiAvg -and $wmiAvg -gt 0) { $choice = $wmiAvg }",
        "$choice"
      ].join("; "),
      { encoded: true, timeoutMs: Math.max(windowsCommandTimeoutMs, 8000) }
    );
    const value = Number(String(stdout).trim().split(/\r?\n/).at(-1));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function sampleGpus() {
  const hardwareSnapshot = await readHardwareMonitorSnapshot();
  if (hardwareSnapshot) {
    const gpus = extractHardwareMonitorGpus(hardwareSnapshot);
    if (gpus.length) return gpus;
  }
  if (process.platform === "win32") {
    const [sampledGpus, dllGpus] = await Promise.all([
      sampleWindowsGpus(),
      readWindowsHardwareMonitorGpusFromDll()
    ]);
    return mergeWindowsGpuTelemetry(sampledGpus, dllGpus);
  }
  const intelGpus = await sampleIntelGpus();
  if (intelGpus.length) return intelGpus;
  const drmGpus = await sampleDrmGpus();
  if (drmGpus.length) return drmGpus;
  try {
    const { stdout } = await execFile("nvidia-smi", [
      "--query-gpu=index,name,utilization.gpu,utilization.encoder,utilization.decoder,memory.used,memory.total,temperature.gpu",
      "--format=csv,noheader,nounits"
    ]);
    return await Promise.all(
      String(stdout)
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(async (line) => {
        const [index, name, utilization, encodeUtilization, decodeUtilization, memoryUsedMb, memoryTotalMb, temperature] = line
          .split(",")
          .map((item) => item.trim());
        return {
          id: `gpu-${index}`,
          name,
          utilizationPercent: round(Number(utilization ?? 0)),
          encodeUtilizationPercent: parseOptionalPercent(encodeUtilization),
          decodeUtilizationPercent: parseOptionalPercent(decodeUtilization),
          frequencyMHz: await sampleNvidiaFrequency(index),
          memoryUsedBytes: Number(memoryUsedMb ?? 0) * 1024 * 1024,
          memoryTotalBytes: Number(memoryTotalMb ?? 0) * 1024 * 1024,
          temperatureC: Number.isFinite(Number(temperature)) ? round(Number(temperature)) : null
        };
        })
    );
  } catch {
    return [];
  }
}

async function sampleWindowsGpus() {
  try {
    const nvidiaGpus = await sampleWindowsNvidiaGpus();
    if (nvidiaGpus.length) return nvidiaGpus;

    const [controllers, counterSamples] = await Promise.all([
      readWindowsVideoControllers(),
      readWindowsGpuCounterSamples()
    ]);

    const physicalControllers = controllers.filter(isPhysicalWindowsGpuController);
    const grouped = new Map();

    for (const sample of counterSamples) {
      const instanceName = String(sample.InstanceName ?? "");
      const path = String(sample.Path ?? "").toLowerCase();
      const cookedValue = Number(sample.CookedValue ?? 0);
      if (!Number.isFinite(cookedValue)) continue;

      const adapterKey = extractWindowsGpuAdapterKey(instanceName);
      if (!adapterKey) continue;

      if (!grouped.has(adapterKey)) {
        grouped.set(adapterKey, {
          key: adapterKey,
          utilizationPercent: 0,
          encodeUtilizationPercent: null,
          decodeUtilizationPercent: null,
          memoryUsedBytes: 0
        });
      }

      const current = grouped.get(adapterKey);
      if (path.includes("\\gpu engine(") && path.endsWith("\\utilization percentage")) {
        current.utilizationPercent = Math.max(current.utilizationPercent, cookedValue);
        const engineType = extractWindowsGpuEngineType(instanceName);
        if (engineType.includes("videoencode")) {
          current.encodeUtilizationPercent = Math.max(current.encodeUtilizationPercent ?? 0, cookedValue);
        }
        if (engineType.includes("videodecode") || engineType.includes("videoenhance")) {
          current.decodeUtilizationPercent = Math.max(current.decodeUtilizationPercent ?? 0, cookedValue);
        }
      }
      if (path.includes("\\gpu adapter memory(") && path.endsWith("\\dedicated usage")) {
        current.memoryUsedBytes += cookedValue;
      }
      if (path.includes("\\gpu adapter memory(") && path.endsWith("\\shared usage")) {
        current.memoryUsedBytes += cookedValue;
      }
    }

    const adapterEntries = [...grouped.values()].sort((left, right) => left.key.localeCompare(right.key));
    if (!adapterEntries.length && !physicalControllers.length) return [];

    return adapterEntries.map((entry, index) => {
      const controller = physicalControllers[index] ?? physicalControllers.at(-1) ?? null;
      return {
        id: entry.key,
        name: controller?.Name ?? `GPU ${index}`,
        utilizationPercent: round(entry.utilizationPercent),
        encodeUtilizationPercent:
          entry.encodeUtilizationPercent != null ? round(entry.encodeUtilizationPercent) : null,
        decodeUtilizationPercent:
          entry.decodeUtilizationPercent != null ? round(entry.decodeUtilizationPercent) : null,
        frequencyMHz: null,
        memoryUsedBytes: Math.round(entry.memoryUsedBytes),
        memoryTotalBytes: Number(controller?.AdapterRAM ?? 0),
        temperatureC: null
      };
    });
  } catch {
    return [];
  }
}

async function readWindowsVideoControllers() {
  const { stdout } = await runPowerShell(
    [
      "$ProgressPreference = 'SilentlyContinue'",
      "$ErrorActionPreference = 'Stop'",
      "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,PNPDeviceID,VideoProcessor,DriverVersion | ConvertTo-Json -Compress"
    ].join("; ")
  );
  const rows = JSON.parse(String(stdout).trim() || "[]");
  return Array.isArray(rows) ? rows.filter(Boolean) : rows ? [rows] : [];
}

async function readWindowsGpuCounterSamples() {
  const { stdout } = await runPowerShell(
    [
      "$ProgressPreference = 'SilentlyContinue'",
      "$ErrorActionPreference = 'Stop'",
      "$samples = Get-Counter '\\GPU Engine(*)\\Utilization Percentage','\\GPU Adapter Memory(*)\\Dedicated Usage','\\GPU Adapter Memory(*)\\Shared Usage'",
      "$samples.CounterSamples | Select-Object Path,InstanceName,CookedValue | ConvertTo-Json -Compress -Depth 4"
    ].join("; ")
  );
  const rows = JSON.parse(String(stdout).trim() || "[]");
  return Array.isArray(rows) ? rows.filter(Boolean) : rows ? [rows] : [];
}

function extractWindowsGpuAdapterKey(instanceName) {
  const match = String(instanceName).match(/(luid_0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function extractWindowsGpuEngineType(instanceName) {
  const match = String(instanceName).match(/engtype_([^)_]+)/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function isPhysicalWindowsGpuController(controller) {
  const name = String(controller?.Name ?? "").toLowerCase();
  const processor = String(controller?.VideoProcessor ?? "").toLowerCase();
  const pnpDeviceId = String(controller?.PNPDeviceID ?? "").toLowerCase();
  const hasMemory = Number(controller?.AdapterRAM ?? 0) > 0;
  if (!hasMemory && !pnpDeviceId.startsWith("pci\\")) return false;
  return !/(virtual|remote|microsoft remote|indirect|gameviewer)/i.test(`${name} ${processor} ${pnpDeviceId}`);
}

async function sampleWindowsNvidiaGpus() {
  try {
    const { stdout } = await execFileWithTimeout("nvidia-smi", [
      "--query-gpu=index,name,uuid,pci.bus_id,utilization.gpu,utilization.encoder,utilization.decoder,memory.used,memory.total,temperature.gpu,clocks.current.graphics",
      "--format=csv,noheader,nounits"
    ], { timeout: 4000 });
    const lines = String(stdout)
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map((line, index) => {
      const [
        gpuIndex,
        name,
        uuid,
        pciBusId,
        utilization,
        encodeUtilization,
        decodeUtilization,
        memoryUsedMb,
        memoryTotalMb,
        temperature,
        frequencyMHz
      ] = line.split(",").map((item) => item.trim());
      return {
        id: String(uuid || `gpu-${gpuIndex || index}`),
        name: String(name || `GPU ${index}`),
        utilizationPercent: round(Number(utilization ?? 0)),
        encodeUtilizationPercent: parseOptionalPercent(encodeUtilization),
        decodeUtilizationPercent: parseOptionalPercent(decodeUtilization),
        frequencyMHz: Number.isFinite(Number(frequencyMHz)) ? round(Number(frequencyMHz)) : null,
        memoryUsedBytes: Number(memoryUsedMb ?? 0) * 1024 * 1024,
        memoryTotalBytes: Number(memoryTotalMb ?? 0) * 1024 * 1024,
        temperatureC: Number.isFinite(Number(temperature)) ? round(Number(temperature)) : null,
        pciBusId: pciBusId || ""
      };
    });
  } catch {
    return [];
  }
}

async function sampleFans() {
  const hardwareSnapshot = await readHardwareMonitorSnapshot();
  const candidates = [];
  if (hardwareSnapshot) {
    const fans = extractHardwareMonitorFans(hardwareSnapshot);
    if (fans.length) {
      candidates.push({ source: "hardware-json", score: scoreFanCollection(fans, 120), value: fans });
    }
  }
  if (process.platform === "win32") {
    candidates.push(...(await readWindowsFanCandidates()));
    const redfish = await readRedfishSensors();
    if (redfish.fans.length) {
      candidates.push({ source: "redfish", score: scoreFanCollection(redfish.fans, 95), value: redfish.fans });
    }
    return selectCachedMetric("fans", candidates, isUsableFanCollection, null, []);
  }
  if (process.platform !== "linux") return [];
  const sensorFans = await readFansFromSensors();
  if (sensorFans.length) {
    candidates.push({ source: "linux-sensors", score: scoreFanCollection(sensorFans, 100), value: sensorFans });
  }
  const sensors = [];
  try {
    const hwmonRoot = "/sys/class/hwmon";
    const { readdir } = await import("node:fs/promises");
    for (const dirent of await readdir(hwmonRoot)) {
      const base = `${hwmonRoot}/${dirent}`;
      let chipName = dirent;
      try {
        chipName = readFileSync(`${base}/name`, "utf8").trim() || dirent;
      } catch {}
      for (let index = 1; index <= 8; index += 1) {
        try {
          const rpm = Number(readFileSync(`${base}/fan${index}_input`, "utf8").trim());
          if (!Number.isFinite(rpm) || rpm <= 0) continue;
          let label = `fan${index}`;
          try {
            label = readFileSync(`${base}/fan${index}_label`, "utf8").trim() || label;
          } catch {}
          sensors.push({
            id: `${chipName}-fan${index}`,
            label,
            interface: `${chipName}/fan${index}`,
            rpm: Math.round(rpm),
            note: ""
          });
        } catch {}
      }
    }
  } catch {}
  if (sensors.length) {
    candidates.push({ source: "linux-sysfs", score: scoreFanCollection(sensors, 80), value: sensors });
  }
  const redfish = await readRedfishSensors();
  if (redfish.fans.length) {
    candidates.push({ source: "redfish", score: scoreFanCollection(redfish.fans, 95), value: redfish.fans });
  }
  return selectCachedMetric("fans", candidates, isUsableFanCollection, null, []);
}

async function sampleSensorBackends() {
  await readWindowsHardwareMonitorSensorsFromDll();
  const backends = [];
  if (process.platform === "win32") {
    backends.push({
      id: "windows-hardware-dll",
      label: "LibreHardwareMonitor",
      ok: lastWindowsHardwareBackendStatus.ok,
      detail: lastWindowsHardwareBackendStatus.detail
    });
    backends.push({
      id: "pawnio",
      label: "PawnIO",
      ok: lastPawnIoStatus.ok,
      detail: lastPawnIoStatus.detail
    });
  }
  if (redfishUrl) {
    await readRedfishSensors();
  }
  backends.push({
    id: "redfish",
    label: "Redfish / BMC",
    ok: lastRedfishBackendStatus.ok,
    detail: lastRedfishBackendStatus.detail
  });
  return backends;
}

async function readHardwareMonitorSnapshot() {
  if (!hardwareJsonUrl) return null;
  try {
    const response = await fetch(hardwareJsonUrl, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function readRedfishSensors() {
  if (!redfishUrl) {
    lastRedfishBackendStatus = { ok: false, detail: "not configured" };
    return redfishCache.value;
  }
  if (Date.now() - redfishCache.at <= 15_000) return redfishCache.value;
  const empty = { cpuTemperatureC: null, fans: [], status: { ok: false, detail: "not probed" } };
  try {
    const chassisRoot = await redfishGet("/redfish/v1/Chassis");
    const members = Array.isArray(chassisRoot?.Members) ? chassisRoot.Members : [];
    const chassisPaths = members
      .map((member) => String(member?.["@odata.id"] ?? ""))
      .filter(Boolean);
    if (!chassisPaths.length) {
      const value = { ...empty, status: { ok: false, detail: "no chassis members" } };
      redfishCache = { at: Date.now(), value };
      lastRedfishBackendStatus = value.status;
      return value;
    }

    const temperatures = [];
    const fans = [];
    const errors = [];
    for (const chassisPath of chassisPaths) {
      try {
        await collectRedfishThermal(chassisPath, temperatures, fans);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    const cpuCandidates = temperatures.filter((sensor) => isRedfishCpuTemperature(sensor.name, sensor.context));
    const source = cpuCandidates.length ? cpuCandidates : temperatures.filter((sensor) => isReasonableCpuTemperature(sensor.value));
    const cpuTemperatureC = source.length ? round(Math.max(...source.map((sensor) => sensor.value))) : null;
    const status = {
      ok: temperatures.length > 0 || fans.length > 0,
      detail: `temperature=${temperatures.length}, fan=${fans.length}${errors.length ? `, errors=${errors.slice(0, 2).join(" | ")}` : ""}`
    };
    const value = { cpuTemperatureC, fans: dedupeFans(fans), status };
    redfishCache = { at: Date.now(), value };
    lastRedfishBackendStatus = status;
    return value;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const value = { ...empty, status: { ok: false, detail } };
    redfishCache = { at: Date.now(), value };
    lastRedfishBackendStatus = value.status;
    return value;
  }
}

async function collectRedfishThermal(chassisPath, temperatures, fans) {
  const chassis = await redfishGet(chassisPath);
  const links = [
    String(chassis?.Thermal?.["@odata.id"] ?? ""),
    String(chassis?.ThermalSubsystem?.["@odata.id"] ?? ""),
    String(chassis?.Sensors?.["@odata.id"] ?? "")
  ].filter(Boolean);
  for (const link of links) {
    await collectRedfishResource(link, temperatures, fans, chassisPath);
  }
}

async function collectRedfishResource(resourcePath, temperatures, fans, context) {
  const resource = await redfishGet(resourcePath);
  const members = Array.isArray(resource?.Members) ? resource.Members : [];
  for (const member of members) {
    const memberPath = String(member?.["@odata.id"] ?? "");
    if (memberPath) {
      try {
        await collectRedfishResource(memberPath, temperatures, fans, context);
      } catch {}
    }
  }

  for (const item of Array.isArray(resource?.Temperatures) ? resource.Temperatures : []) {
    const value = Number(item?.ReadingCelsius ?? item?.Reading);
    if (isReasonableCpuTemperature(value)) {
      temperatures.push({
        name: String(item?.Name ?? item?.MemberId ?? item?.PhysicalContext ?? ""),
        context: String(item?.PhysicalContext ?? item?.RelatedItem?.[0]?.["@odata.id"] ?? context),
        value
      });
    }
  }
  for (const item of Array.isArray(resource?.Fans) ? resource.Fans : []) {
    const fan = mapRedfishFan(item, context);
    if (fan) fans.push(fan);
  }
  const sensorType = String(resource?.ReadingType ?? resource?.SensorType ?? "").toLowerCase();
  const reading = Number(resource?.Reading);
  const name = String(resource?.Name ?? resource?.Id ?? resource?.MemberId ?? "");
  const physicalContext = String(resource?.PhysicalContext ?? resource?.PhysicalSubContext ?? context);
  if ((sensorType.includes("temperature") || resource?.ReadingCelsius != null) && isReasonableCpuTemperature(Number(resource?.ReadingCelsius ?? reading))) {
    temperatures.push({
      name,
      context: physicalContext,
      value: Number(resource?.ReadingCelsius ?? reading)
    });
  }
  if ((sensorType.includes("fan") || sensorType.includes("rpm") || /fan/i.test(name)) && Number.isFinite(reading) && reading > 0) {
    fans.push({
      id: `redfish:${String(resource?.["@odata.id"] ?? name)}`,
      label: name || "Redfish Fan",
      interface: physicalContext || "Redfish",
      rpm: Math.round(reading),
      note: ""
    });
  }
}

function mapRedfishFan(item, context) {
  const reading = Number(item?.Reading ?? item?.SpeedRPM);
  const units = String(item?.ReadingUnits ?? item?.ReadingUnit ?? "").toLowerCase();
  if (!Number.isFinite(reading) || reading <= 0 || (units && !units.includes("rpm"))) return null;
  const name = String(item?.Name ?? item?.MemberId ?? "Redfish Fan");
  return {
    id: `redfish:${String(item?.MemberId ?? item?.Name ?? name)}`,
    label: name,
    interface: String(item?.PhysicalContext ?? context ?? "Redfish"),
    rpm: Math.round(reading),
    note: ""
  };
}

function dedupeFans(fans) {
  const byId = new Map();
  for (const fan of fans) {
    if (!byId.has(fan.id)) byId.set(fan.id, fan);
  }
  return [...byId.values()];
}

function isRedfishCpuTemperature(name, context) {
  const haystack = `${name} ${context}`;
  return /(cpu|processor|package|proc|socket)/i.test(haystack) && !/(gpu|nvme|disk|drive|ssd|hdd|inlet|outlet|ambient|system|pch|memory|dimm)/i.test(haystack);
}

async function redfishGet(resourcePath) {
  const url = resourcePath.startsWith("http")
    ? resourcePath
    : `${redfishUrl}${resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), redfishTimeoutMs);
  try {
    const headers = { Accept: "application/json" };
    if (redfishUsername || redfishPassword) {
      headers.Authorization = `Basic ${Buffer.from(`${redfishUsername}:${redfishPassword}`).toString("base64")}`;
    }
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function walkHardwareTree(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  const children = Array.isArray(node.Children) ? node.Children : Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    walkHardwareTree(child, visit);
  }
}

function extractHardwareMonitorCpuTemperature(snapshot) {
  const candidates = [];
  walkHardwareTree(snapshot, (node) => {
    const type = String(node.SensorType ?? node.sensorType ?? "").toLowerCase();
    const name = String(node.Name ?? node.name ?? "").toLowerCase();
    const identifier = String(node.Identifier ?? node.identifier ?? "").toLowerCase();
    const hardwareType = String(node.HardwareType ?? node.hardwareType ?? "").toLowerCase();
    const value = Number(node.Value ?? node.value);
    if (type !== "temperature" || !Number.isFinite(value)) return;
    const score = scoreCpuTemperatureSensor({ name, identifier, hardwareType });
    if (score > 0) {
      candidates.push({ value, score });
    }
  });
  return selectBestCpuTemperature(candidates);
}

async function readWindowsCpuTemperatureCandidates() {
  const candidates = [];
  const dllSensors = await readWindowsHardwareMonitorSensorsFromDll();
  if (dllSensors.length) {
    const selected = selectBestCpuTemperature(
      dllSensors
        .filter((sensor) => sensor.sensorType === "temperature")
        .map((sensor) => ({
          value: Number(sensor.value),
          score: scoreCpuTemperatureSensor({
            name: String(sensor.name ?? "").toLowerCase(),
            identifier: String(sensor.identifier ?? "").toLowerCase(),
            hardwareType: String(sensor.hardwareType ?? "").toLowerCase()
          })
        }))
    );
    if (selected != null) {
      candidates.push({ source: "windows-hardware-dll", score: 110, value: selected });
    }
  }

  const wmiSensors = await readWindowsHardwareMonitorSensorsFromWmi();
  for (const entry of wmiSensors) {
    const selected = selectBestCpuTemperature(
      entry.sensors
        .filter((sensor) => sensor.sensorType === "temperature")
        .map((sensor) => ({
          value: Number(sensor.value),
          score: scoreCpuTemperatureSensor({
            name: String(sensor.name ?? "").toLowerCase(),
            identifier: String(sensor.identifier ?? "").toLowerCase(),
            hardwareType: String(sensor.hardwareType ?? "").toLowerCase()
          })
        }))
    );
    if (selected != null) {
      candidates.push({ source: `windows-wmi:${entry.namespace}`, score: 100, value: selected });
    }
  }
  return candidates;
}

async function readWindowsFanCandidates() {
  const candidates = [];
  const dllSensors = await readWindowsHardwareMonitorSensorsFromDll();
  const dllFans = mapHardwareMonitorFanSensors(dllSensors);
  if (dllFans.length) {
    candidates.push({ source: "windows-hardware-dll", score: scoreFanCollection(dllFans, 110), value: dllFans });
  }

  const wmiSensors = await readWindowsHardwareMonitorSensorsFromWmi();
  for (const entry of wmiSensors) {
    const fans = mapHardwareMonitorFanSensors(entry.sensors);
    if (fans.length) {
      candidates.push({
        source: `windows-wmi:${entry.namespace}`,
        score: scoreFanCollection(fans, 100),
        value: fans
      });
    }
  }
  return candidates;
}

function mapHardwareMonitorFanSensors(sensors) {
  return sensors
    .filter((sensor) => sensor.sensorType === "fan" && Number.isFinite(Number(sensor.value)) && Number(sensor.value) > 0)
    .map((sensor, index) => ({
      id: String(sensor.identifier ?? `fan-${index}`),
      label: String(sensor.name ?? `Fan ${index + 1}`),
      interface: String(sensor.hardware ?? sensor.hardwareType ?? "fan"),
      rpm: Math.round(Number(sensor.value)),
      note: ""
    }));
}

async function readWindowsHardwareMonitorSensorsFromWmi() {
  if (process.platform !== "win32") return [];
  const namespaces = ["root\\LibreHardwareMonitor", "root\\OpenHardwareMonitor"];
  const results = [];
  for (const namespace of namespaces) {
    try {
      const { stdout } = await runPowerShell(
        [
          "$ProgressPreference = 'SilentlyContinue'",
          "$ErrorActionPreference = 'Stop'",
          `$namespace = '${namespace}'`,
          "Get-CimInstance -Namespace $namespace -ClassName Sensor |",
          "  Select-Object Name,Identifier,Parent,SensorType,Value |",
          "  ConvertTo-Json -Compress -Depth 4"
        ].join("; "),
        { encoded: true, timeoutMs: 5000 }
      );
      const rows = JSON.parse(String(stdout).trim() || "[]");
      const sensors = (Array.isArray(rows) ? rows : rows ? [rows] : [])
        .filter(Boolean)
        .map((row) => ({
          hardware: String(row.Parent ?? ""),
          hardwareType: "",
          name: String(row.Name ?? ""),
          sensorType: normalizeSensorType(row.SensorType),
          identifier: String(row.Identifier ?? row.Parent ?? ""),
          value: Number(row.Value)
        }));
      if (sensors.length) {
        results.push({ namespace, sensors });
      }
    } catch {}
  }
  return results;
}

async function readWindowsHardwareMonitorSensorsFromDll() {
  if (process.platform !== "win32") return [];
  if (Date.now() - windowsHardwareSensorsCache.at <= 30_000) {
    return windowsHardwareSensorsCache.value;
  }
  try {
    const candidatePaths = [
      hardwareDllPath,
      bundledHardwareDllPath,
      "C:\\Program Files (x86)\\FanControl\\LibreHardwareMonitorLib.dll",
      "C:\\Program Files\\FanControl\\LibreHardwareMonitorLib.dll"
    ].filter(Boolean);
    const escapedPaths = candidatePaths.map((path) => path.replace(/'/g, "''"));
    const { stdout } = await runPowerShell(
      `$ErrorActionPreference = 'Stop'
$paths = @('${escapedPaths.join("','")}')
$dll = $paths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $dll) { '[]'; return }
$dllDir = Split-Path -Parent $dll
[System.IO.Directory]::SetCurrentDirectory($dllDir)
Get-ChildItem -Path $dllDir -Filter '*.dll' -File | ForEach-Object {
  try { [System.Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null } catch {}
}
Add-Type -Path $dll
$pawnStatus = $null
try {
  $pawnStatus = [pscustomobject]@{
    IsInstalled = [LibreHardwareMonitor.PawnIo.PawnIo]::IsInstalled
    IsLoaded = [LibreHardwareMonitor.PawnIo.PawnIo]::IsLoaded
    Version = [string][LibreHardwareMonitor.PawnIo.PawnIo]::Version
  }
} catch {}
$computer = [LibreHardwareMonitor.Hardware.Computer]::new()
$computer.IsCpuEnabled = $true
$computer.IsGpuEnabled = $true
$computer.IsMotherboardEnabled = $true
$computer.IsControllerEnabled = $true
$computer.IsStorageEnabled = $true
$computer.Open()
foreach ($hardware in $computer.Hardware) {
  $hardware.Update()
  foreach ($subHardware in $hardware.SubHardware) { $subHardware.Update() }
}
$hardwareRows = foreach ($hardware in $computer.Hardware) {
  [pscustomobject]@{
    Name = $hardware.Name
    HardwareType = $hardware.HardwareType.ToString()
    SubHardwareCount = @($hardware.SubHardware).Count
  }
  foreach ($subHardware in $hardware.SubHardware) {
    [pscustomobject]@{
      Name = ($hardware.Name + '/' + $subHardware.Name)
      HardwareType = $subHardware.HardwareType.ToString()
      SubHardwareCount = 0
    }
  }
}
$rows = foreach ($hardware in $computer.Hardware) {
  foreach ($sensor in $hardware.Sensors) {
    [pscustomobject]@{
      Hardware = $hardware.Name
      HardwareType = $hardware.HardwareType.ToString()
      Name = $sensor.Name
      SensorType = $sensor.SensorType.ToString()
      Identifier = $sensor.Identifier.ToString()
      HasValue = $sensor.Value -ne $null
      Value = if ($sensor.Value -eq $null) { $null } else { [double]$sensor.Value }
    }
  }
  foreach ($subHardware in $hardware.SubHardware) {
    foreach ($sensor in $subHardware.Sensors) {
      [pscustomobject]@{
        Hardware = ($hardware.Name + '/' + $subHardware.Name)
        HardwareType = $subHardware.HardwareType.ToString()
        Name = $sensor.Name
        SensorType = $sensor.SensorType.ToString()
        Identifier = $sensor.Identifier.ToString()
        HasValue = $sensor.Value -ne $null
        Value = if ($sensor.Value -eq $null) { $null } else { [double]$sensor.Value }
      }
    }
  }
}
([pscustomobject]@{
  Dll = $dll
  PawnStatus = $pawnStatus
  Hardware = $hardwareRows
  Sensors = $rows
}) | ConvertTo-Json -Compress -Depth 6`,
      { encoded: true, timeoutMs: hardwareMonitorTimeoutMs }
    );
    const parsed = JSON.parse(String(stdout).trim() || "{}");
    const rows = Array.isArray(parsed?.Sensors) ? parsed.Sensors : parsed?.Sensors ? [parsed.Sensors] : [];
    const sensors = rows
      .filter((row) => Boolean(row?.HasValue))
      .map((row) => ({
      hardware: String(row.Hardware ?? ""),
      hardwareType: String(row.HardwareType ?? "").toLowerCase(),
      name: String(row.Name ?? ""),
      sensorType: normalizeSensorType(row.SensorType),
      identifier: String(row.Identifier ?? ""),
      value: Number(row.Value)
      }));
    lastWindowsHardwareProbeSummary = summarizeWindowsHardwareProbe(parsed, rows, sensors);
    windowsHardwareSensorsCache = { at: Date.now(), value: sensors };
    lastWindowsHardwareBackendStatus = {
      ok: sensors.length > 0,
      detail: formatWindowsHardwareBackendDetail(parsed, sensors.length, lastWindowsHardwareProbeSummary)
    };
    lastPawnIoStatus = mapPawnIoStatus(parsed?.pawnStatus);
    lastWindowsHardwareSensorError = "";
    return sensors;
  } catch (error) {
    lastWindowsHardwareSensorError = error instanceof Error ? error.message : String(error);
    lastWindowsHardwareProbeSummary = null;
    if (process.env.DSC_AGENT_DEBUG === "true") {
      console.error("[agent] windows hardware sensor read failed", lastWindowsHardwareSensorError);
    }
    lastWindowsHardwareBackendStatus = { ok: false, detail: `probe failed: ${lastWindowsHardwareSensorError}` };
    return [];
  }
}

async function readWindowsHardwareMonitorGpusFromDll() {
  const sensors = await readWindowsHardwareMonitorSensorsFromDll();
  if (!sensors.length) return [];
  const grouped = new Map();
  for (const sensor of sensors) {
    const hardwareType = String(sensor.hardwareType ?? "").toLowerCase();
    if (!hardwareType.includes("gpu")) continue;
    const key = String(sensor.hardware ?? sensor.identifier ?? sensor.name ?? "").trim();
    if (!key) continue;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key,
        name: String(sensor.hardware ?? key),
        utilizationPercent: 0,
        encodeUtilizationPercent: null,
        decodeUtilizationPercent: null,
        frequencyMHz: null,
        memoryUsedBytes: 0,
        memoryTotalBytes: 0,
        temperatureC: null
      });
    }
    const current = grouped.get(key);
    const sensorType = String(sensor.sensorType ?? "").toLowerCase();
    const sensorName = String(sensor.name ?? "").toLowerCase();
    const value = Number(sensor.value);
    if (!Number.isFinite(value)) continue;
    if (sensorType === "load" && sensorName.includes("core")) current.utilizationPercent = Math.max(current.utilizationPercent, round(value));
    if (sensorType === "load" && (sensorName.includes("video engine") || sensorName.includes("encoder"))) {
      current.encodeUtilizationPercent = round(Math.max(current.encodeUtilizationPercent ?? 0, value));
    }
    if (sensorType === "load" && (sensorName.includes("video decode") || sensorName.includes("decoder") || sensorName.includes("video enhance"))) {
      current.decodeUtilizationPercent = round(Math.max(current.decodeUtilizationPercent ?? 0, value));
    }
    if (sensorType === "clock" && (sensorName.includes("gpu core") || sensorName.includes("graphics") || sensorName.includes("core"))) {
      current.frequencyMHz = round(value);
    }
    if (isDataSensorType(sensorType) && sensorName.includes("memory used")) current.memoryUsedBytes = Math.round(value * 1024 * 1024);
    if (isDataSensorType(sensorType) && sensorName.includes("memory total")) current.memoryTotalBytes = Math.round(value * 1024 * 1024);
    if (sensorType === "temperature" && (sensorName.includes("core") || sensorName.includes("hot spot") || sensorName.includes("hotspot"))) {
      current.temperatureC = current.temperatureC == null ? round(value) : Math.max(current.temperatureC, round(value));
    }
  }
  return [...grouped.values()];
}

function mergeWindowsGpuTelemetry(sampledGpus, dllGpus) {
  if (!dllGpus.length) return sampledGpus;
  if (!sampledGpus.length) return dllGpus;
  const dllByName = new Map(dllGpus.map((gpu) => [normalizeGpuName(gpu.name), gpu]));
  const unusedDllGpus = [...dllGpus];
  const merged = sampledGpus.map((gpu, index) => {
    const normalizedName = normalizeGpuName(gpu.name);
    let dllGpu = dllByName.get(normalizedName) ?? findBestMatchingGpu(gpu, unusedDllGpus);
    if (!dllGpu && dllGpus.length === sampledGpus.length) {
      dllGpu = dllGpus[index] ?? null;
    }
    if (dllGpu) {
      const removeIndex = unusedDllGpus.indexOf(dllGpu);
      if (removeIndex >= 0) unusedDllGpus.splice(removeIndex, 1);
    }
    return {
      ...gpu,
      utilizationPercent: gpu.utilizationPercent || dllGpu?.utilizationPercent || 0,
      encodeUtilizationPercent: gpu.encodeUtilizationPercent ?? dllGpu?.encodeUtilizationPercent ?? null,
      decodeUtilizationPercent: gpu.decodeUtilizationPercent ?? dllGpu?.decodeUtilizationPercent ?? null,
      frequencyMHz: gpu.frequencyMHz ?? dllGpu?.frequencyMHz ?? null,
      memoryUsedBytes: gpu.memoryUsedBytes || dllGpu?.memoryUsedBytes || 0,
      memoryTotalBytes: gpu.memoryTotalBytes || dllGpu?.memoryTotalBytes || 0,
      temperatureC: gpu.temperatureC ?? dllGpu?.temperatureC ?? null
    };
  });
  return [...merged, ...unusedDllGpus];
}

function normalizeGpuName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\b(amd|ati|nvidia|intel|radeon|geforce|graphics|series|adapter)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findBestMatchingGpu(gpu, candidates) {
  const sourceTokens = hardwareNameTokens(gpu?.name);
  if (!sourceTokens.size) return null;
  let best = null;
  for (const candidate of candidates) {
    const candidateTokens = hardwareNameTokens(candidate?.name);
    if (!candidateTokens.size) continue;
    const intersection = [...sourceTokens].filter((token) => candidateTokens.has(token)).length;
    const union = new Set([...sourceTokens, ...candidateTokens]).size;
    const score = union > 0 ? intersection / union : 0;
    if (score >= 0.45 && (!best || score > best.score)) {
      best = { gpu: candidate, score };
    }
  }
  return best?.gpu ?? null;
}

function normalizeSensorType(value) {
  return String(value ?? "").toLowerCase().replace(/[\s_-]+/g, "");
}

function isDataSensorType(sensorType) {
  return sensorType === "data" || sensorType === "smalldata";
}

async function readWindowsDiskTemperaturesFromDll() {
  const sensors = await readWindowsHardwareMonitorSensorsFromDll();
  const temperatures = [];
  for (const sensor of sensors) {
    const hardwareType = String(sensor.hardwareType ?? "").toLowerCase();
    const sensorType = String(sensor.sensorType ?? "").toLowerCase();
    const value = Number(sensor.value);
    if (!hardwareType.includes("storage") || sensorType !== "temperature" || !Number.isFinite(value) || value <= 0 || value >= 130) {
      continue;
    }
    temperatures.push({
      hardware: String(sensor.hardware ?? ""),
      identifier: String(sensor.identifier ?? ""),
      name: String(sensor.name ?? ""),
      diskNumber: parseDiskNumberFromHardwareSensor(sensor),
      index: temperatures.length,
      value: round(value)
    });
  }
  return temperatures;
}

function matchDiskTemperature(temperatures, disk) {
  const diskNumber = disk?.diskNumber != null ? Number(disk.diskNumber) : null;
  if (diskNumber != null) {
    const byNumber = temperatures.find((item) => item.diskNumber === diskNumber);
    if (byNumber) return byNumber.value;
  }
  const normalizedModel = normalizeHardwareName(disk?.model);
  const normalizedSerial = normalizeHardwareName(disk?.serialNumber);
  const match = temperatures.find((item) => {
    const normalizedHardware = normalizeHardwareName(item.hardware);
    const normalizedIdentifier = normalizeHardwareName(item.identifier);
    const haystack = `${normalizedHardware} ${normalizedIdentifier}`.trim();
    return (
      (normalizedModel && haystack && (haystack.includes(normalizedModel) || normalizedModel.includes(normalizedHardware))) ||
      (normalizedSerial && haystack.includes(normalizedSerial))
    );
  });
  if (match) return match.value;
  if (diskNumber != null && temperatures[diskNumber]) return temperatures[diskNumber].value;
  return match?.value ?? null;
}

function parseDiskNumberFromHardwareSensor(sensor) {
  const identifier = String(sensor?.identifier ?? "").toLowerCase();
  const match = identifier.match(/\/(?:hdd|storage)\/(\d+)(?:\/|$)/i);
  return match ? Number(match[1]) : null;
}

function normalizeHardwareName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(nvme|scsi|sata|ssd|hdd|usb|disk|drive)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hardwareNameTokens(value) {
  return new Set(
    normalizeHardwareName(value)
      .split(" ")
      .filter((token) => token.length >= 2)
  );
}

async function readWindowsAcpiThermalZoneTemperature() {
  try {
    const { stdout } = await runPowerShell(
      "Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/wmi | Select-Object -ExpandProperty CurrentTemperature"
    );
    const values = String(stdout)
      .trim()
      .split(/\s+/)
      .map((raw) => Number(raw))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => value / 10 - 273.15)
      .filter((value) => Number.isFinite(value) && value > 0);
    return values.length ? round(Math.max(...values)) : null;
  } catch {
    return null;
  }
}

function scoreCpuTemperatureSensor({ name, identifier, hardwareType }) {
  const haystack = `${name} ${identifier} ${hardwareType}`;
  if (/(gpu|graphics|video|nvme|ssd|hdd|drive|disk|memory|dimm|pch|chipset|vrm|ambient|mainboard|motherboard|system|acpi|thermal zone)/i.test(haystack)) {
    return 0;
  }
  let score = 0;
  if (/(intelcpu|amdcpu|\/cpu|cpu)/i.test(haystack)) score += 4;
  if (/(package|cpu package|tdie|tctl|die)/i.test(name)) score += 6;
  if (/(core|ccd|ccx)/i.test(name)) score += 5;
  if (/(max|hot spot|hotspot)/i.test(name)) score += 3;
  if (/(temperature|temp)/i.test(name)) score += 1;
  return score;
}

function selectBestCpuTemperature(candidates) {
  const valid = candidates.filter(
    (candidate) =>
      Number.isFinite(candidate.value) &&
      candidate.value > 0 &&
      candidate.value < 130 &&
      candidate.score > 0
  );
  if (!valid.length) return null;
  const bestScore = Math.max(...valid.map((candidate) => candidate.score));
  const bestValues = valid.filter((candidate) => candidate.score === bestScore).map((candidate) => candidate.value);
  return round(Math.max(...bestValues));
}

function selectCachedMetric(key, candidates, validator, transform = null, fallback = null) {
  const validCandidates = candidates
    .filter((candidate) => candidate && validator(candidate.value))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Number(right.value) - Number(left.value);
    });

  if (validCandidates.length) {
    const selected = validCandidates[0];
    metricCache.set(key, { value: selected.value, at: Date.now(), source: selected.source });
    return transform ? transform(selected.value) : selected.value;
  }

  const cached = metricCache.get(key);
  if (cached && Date.now() - cached.at <= sensorCacheTtlMs && validator(cached.value)) {
    return transform ? transform(cached.value) : cached.value;
  }
  return fallback;
}

function isReasonableCpuFrequency(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 100 && Number(value) <= 10000;
}

function isReasonableCpuTemperature(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 130;
}

function isUsableFanCollection(value) {
  return Array.isArray(value) && value.some((fan) => Number.isFinite(Number(fan?.rpm)) && Number(fan.rpm) > 0);
}

function scoreFanCollection(fans, baseScore) {
  const count = Array.isArray(fans) ? fans.length : 0;
  const totalRpm = Array.isArray(fans)
    ? fans.reduce((sum, fan) => sum + Math.max(0, Number(fan?.rpm) || 0), 0)
    : 0;
  return baseScore + Math.min(count, 16) * 5 + Math.min(totalRpm / 1000, 20);
}

function mapPawnIoStatus(status) {
  if (!status || typeof status !== "object") {
    return { ok: false, detail: "unavailable" };
  }
  const installed = Boolean(status.IsInstalled);
  const loaded = status.IsLoaded == null ? null : Boolean(status.IsLoaded);
  const version = String(status.Version ?? "").trim();
  return {
    ok: installed && loaded !== false,
    detail: `installed=${installed}, loaded=${loaded == null ? "unknown" : loaded}${version ? `, version=${version}` : ""}`
  };
}

function summarizeWindowsHardwareProbe(parsed, rawRows, usableSensors) {
  const hardwareRows = Array.isArray(parsed?.Hardware) ? parsed.Hardware : parsed?.Hardware ? [parsed.Hardware] : [];
  const rawSensors = Array.isArray(rawRows) ? rawRows : [];
  const cpuTempRows = rawSensors.filter((row) => {
    const sensorType = normalizeSensorType(row?.SensorType);
    if (sensorType !== "temperature") return false;
    return (
      scoreCpuTemperatureSensor({
        name: String(row?.Name ?? "").toLowerCase(),
        identifier: String(row?.Identifier ?? "").toLowerCase(),
        hardwareType: String(row?.HardwareType ?? "").toLowerCase()
      }) > 0
    );
  });
  const cpuTempWithValue = cpuTempRows.filter((row) => row?.HasValue && isReasonableCpuTemperature(Number(row?.Value)));
  const fanRows = rawSensors.filter((row) => normalizeSensorType(row?.SensorType) === "fan");
  const fanWithValue = fanRows.filter((row) => row?.HasValue && Number.isFinite(Number(row?.Value)) && Number(row?.Value) > 0);
  const motherboardHardware = hardwareRows.filter((row) => /motherboard|superio|embeddedcontroller|controller/i.test(String(row?.HardwareType ?? "")));
  return {
    hardwareCount: hardwareRows.length,
    motherboardHardwareCount: motherboardHardware.length,
    sensorCount: rawSensors.length,
    usableSensorCount: usableSensors.length,
    cpuTempCount: cpuTempRows.length,
    cpuTempValueCount: cpuTempWithValue.length,
    fanCount: fanRows.length,
    fanValueCount: fanWithValue.length
  };
}

function formatWindowsHardwareBackendDetail(parsed, sensorCount, summary) {
  const dllName = path.basename(String(parsed?.Dll ?? parsed?.dll ?? "")) || "loaded";
  if (!summary) return `dll=${dllName}, sensors=${sensorCount}`;
  return [
    `dll=${dllName}`,
    `usable=${summary.usableSensorCount}/${summary.sensorCount}`,
    `hw=${summary.hardwareCount}`,
    `board=${summary.motherboardHardwareCount}`,
    `cpuTemp=${summary.cpuTempValueCount}/${summary.cpuTempCount}`,
    `fan=${summary.fanValueCount}/${summary.fanCount}`
  ].join(", ");
}

function trimTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function extractHardwareMonitorGpus(snapshot) {
  const gpus = new Map();
  walkHardwareTree(snapshot, (node) => {
    const hardwareType = String(node.HardwareType ?? node.hardwareType ?? "").toLowerCase();
    const hardwareName = String(node.Name ?? node.name ?? "");
    const identifier = String(node.Identifier ?? node.identifier ?? hardwareName);
    if (!hardwareType.includes("gpu")) return;
    if (!gpus.has(identifier)) {
      gpus.set(identifier, {
        id: identifier,
        name: hardwareName || identifier,
        utilizationPercent: 0,
        encodeUtilizationPercent: null,
        decodeUtilizationPercent: null,
        frequencyMHz: null,
        memoryUsedBytes: 0,
        memoryTotalBytes: 0,
        temperatureC: null
      });
    }
    const current = gpus.get(identifier);
    const sensorType = normalizeSensorType(node.SensorType ?? node.sensorType);
    const sensorName = String(node.Name ?? node.name ?? "").toLowerCase();
    const value = Number(node.Value ?? node.value);
    if (!Number.isFinite(value)) return;
    if (sensorType === "load" && sensorName.includes("core")) current.utilizationPercent = round(value);
    if (sensorType === "load" && (sensorName.includes("video engine") || sensorName.includes("encoder"))) {
      current.encodeUtilizationPercent = round(value);
    }
    if (sensorType === "load" && (sensorName.includes("video decode") || sensorName.includes("decoder") || sensorName.includes("video enhance"))) {
      current.decodeUtilizationPercent = round(value);
    }
    if (sensorType === "clock" && (sensorName.includes("gpu core") || sensorName.includes("graphics") || sensorName.includes("core"))) {
      current.frequencyMHz = round(value);
    }
    if (isDataSensorType(sensorType) && sensorName.includes("memory used")) current.memoryUsedBytes = Math.round(value * 1024 * 1024);
    if (isDataSensorType(sensorType) && sensorName.includes("memory total")) current.memoryTotalBytes = Math.round(value * 1024 * 1024);
    if (sensorType === "temperature" && sensorName.includes("core")) current.temperatureC = round(value);
  });
  return [...gpus.values()];
}

function extractHardwareMonitorFans(snapshot) {
  const fans = [];
  walkHardwareTree(snapshot, (node) => {
    const type = String(node.SensorType ?? node.sensorType ?? "").toLowerCase();
    const value = Number(node.Value ?? node.value);
    if (type !== "fan" || !Number.isFinite(value) || value <= 0) return;
    const name = String(node.Name ?? node.name ?? "fan");
    const identifier = String(node.Identifier ?? node.identifier ?? name);
    fans.push({
      id: identifier,
      label: name,
      interface: identifier,
      rpm: Math.round(value),
      note: ""
    });
  });
  return fans;
}

async function readCpuTemperatureFromSensors() {
  try {
    const { stdout } = await execFile("sensors", ["-j"]);
    const data = JSON.parse(String(stdout));
    for (const [chipName, chipData] of Object.entries(data)) {
      if (!chipData || typeof chipData !== "object") continue;
      const chipKey = chipName.toLowerCase();
      if (!chipKey.includes("coretemp") && !chipKey.includes("k10temp") && !chipKey.includes("cpu")) continue;
      for (const [label, values] of Object.entries(chipData)) {
        if (!values || typeof values !== "object") continue;
        const current = Number(values.temp1_input ?? values.temp2_input ?? values.temp3_input ?? values.temp_input);
        if (Number.isFinite(current) && current > 0) return round(current);
        if (String(label).toLowerCase().includes("package")) {
          const packageTemp = Number(values.temp1_input ?? values.temp2_input ?? values.temp3_input);
          if (Number.isFinite(packageTemp) && packageTemp > 0) return round(packageTemp);
        }
      }
    }
  } catch {}
  return null;
}

async function readFansFromSensors() {
  try {
    const { stdout } = await execFile("sensors", ["-j"]);
    const data = JSON.parse(String(stdout));
    const fans = [];
    for (const [chipName, chipData] of Object.entries(data)) {
      if (!chipData || typeof chipData !== "object") continue;
      for (const [label, values] of Object.entries(chipData)) {
        if (!values || typeof values !== "object") continue;
        const rpm = Number(values.fan1_input ?? values.fan2_input ?? values.fan3_input ?? values.fan_input);
        if (!Number.isFinite(rpm) || rpm <= 0) continue;
        fans.push({
          id: `${chipName}-${label}`,
          label: String(label),
          interface: `${chipName}/${label}`,
          rpm: Math.round(rpm),
          note: ""
        });
      }
    }
    return fans;
  } catch {
    return [];
  }
}

async function sampleDrmGpus() {
  if (process.platform !== "linux") return [];
  try {
    const { readdir, readFile } = await import("node:fs/promises");
    const cards = await readdir("/sys/class/drm");
    const gpus = [];
    for (const card of cards.filter((item) => /^card\d+$/.test(item))) {
      const deviceBase = `/sys/class/drm/${card}/device`;
      let vendor = "";
      try {
        vendor = (await readFile(`${deviceBase}/vendor`, "utf8")).trim();
      } catch {}
      if (!vendor) continue;
      let busy = 0;
      let encodeBusy = null;
      let decodeBusy = null;
      let frequencyMHz = null;
      let vramUsed = 0;
      let vramTotal = 0;
      let temperatureC = null;
      try {
        busy = Number((await readFile(`${deviceBase}/gpu_busy_percent`, "utf8")).trim());
      } catch {}
      encodeBusy = await readFirstNumber(
        [`${deviceBase}/amdgpu_pm_info`, `/sys/kernel/debug/dri/${card.replace("card", "")}/amdgpu_pm_info`],
        /VCN Enc(?:oder)?[^0-9]*([0-9.]+)/i
      );
      decodeBusy = await readFirstNumber(
        [`${deviceBase}/amdgpu_pm_info`, `/sys/kernel/debug/dri/${card.replace("card", "")}/amdgpu_pm_info`],
        /VCN Dec(?:oder)?[^0-9]*([0-9.]+)/i
      );
      frequencyMHz = await readGpuFrequency(deviceBase, vendor);
      try {
        vramUsed = Number((await readFile(`${deviceBase}/mem_info_vram_used`, "utf8")).trim());
      } catch {}
      try {
        vramTotal = Number((await readFile(`${deviceBase}/mem_info_vram_total`, "utf8")).trim());
      } catch {}
      for (const hwmonIndex of [0, 1, 2]) {
        try {
          const temp = Number((await readFile(`${deviceBase}/hwmon/hwmon${hwmonIndex}/temp1_input`, "utf8")).trim());
          if (Number.isFinite(temp) && temp > 0) {
            temperatureC = round(temp / 1000);
            break;
          }
        } catch {}
      }
      gpus.push({
        id: card,
        name: vendor === "0x1002" ? "AMD GPU" : vendor === "0x8086" ? "Intel GPU" : `${vendor} GPU`,
        utilizationPercent: Number.isFinite(busy) ? round(busy) : 0,
        encodeUtilizationPercent: Number.isFinite(encodeBusy) ? round(encodeBusy) : null,
        decodeUtilizationPercent: Number.isFinite(decodeBusy) ? round(decodeBusy) : null,
        frequencyMHz,
        memoryUsedBytes: Number.isFinite(vramUsed) ? vramUsed : 0,
        memoryTotalBytes: Number.isFinite(vramTotal) ? vramTotal : 0,
        temperatureC
      });
    }
    return gpus;
  } catch {
    return [];
  }
}

async function sampleIntelGpus() {
  if (process.platform !== "linux") return [];
  try {
    let text = "";
    try {
      const { stdout } = await execFile("sh", [
        "-lc",
        "timeout 1.5s intel_gpu_top -J -s 100 -o - 2>/dev/null"
      ]);
      text = String(stdout).trim();
    } catch (error) {
      text = String(error?.stdout ?? "").trim();
    }

    return await parseIntelGpuSample(text);
  } catch {
    return [];
  }
}

async function parseIntelGpuSample(text) {
  const sample = extractIntelGpuTopSample(text);
  if (!sample || typeof sample !== "object") return [];

  const engines = sample.engines && typeof sample.engines === "object" ? sample.engines : {};
  const engineBusyValues = Object.values(engines)
    .map((engine) => Number(engine?.busy))
    .filter((value) => Number.isFinite(value));
  const videoBusyValues = Object.entries(engines)
    .filter(([name]) => String(name).toLowerCase().includes("video") && !String(name).toLowerCase().includes("enhance"))
    .map(([, engine]) => Number(engine?.busy))
    .filter((value) => Number.isFinite(value));
  const videoEnhanceBusyValues = Object.entries(engines)
    .filter(([name]) => String(name).toLowerCase().includes("enhance"))
    .map(([, engine]) => Number(engine?.busy))
    .filter((value) => Number.isFinite(value));
  const utilizationPercent = engineBusyValues.length
    ? round(engineBusyValues.reduce((sum, value) => sum + value, 0) / engineBusyValues.length)
    : 0;

  let memoryUsedBytes = 0;
  const clients = sample.clients && typeof sample.clients === "object" ? Object.values(sample.clients) : [];
  for (const client of clients) {
    const total = Number(client?.memory?.system?.total ?? 0);
    if (Number.isFinite(total) && total > 0) memoryUsedBytes += total;
  }

  const temperatureC = await readIntelGpuTemperature();
  const frequencyMHz = await readIntelGpuFrequency();
  return [
    {
      id: "intel-card0",
      name: "Intel GPU",
      utilizationPercent,
      encodeUtilizationPercent: videoBusyValues.length
        ? round(videoBusyValues.reduce((sum, value) => sum + value, 0) / videoBusyValues.length)
        : null,
      decodeUtilizationPercent: videoEnhanceBusyValues.length
        ? round(videoEnhanceBusyValues.reduce((sum, value) => sum + value, 0) / videoEnhanceBusyValues.length)
        : null,
      frequencyMHz,
      memoryUsedBytes: Math.round(memoryUsedBytes),
      memoryTotalBytes: 0,
      temperatureC
    }
  ];
}

function extractIntelGpuTopSample(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function readIntelGpuTemperature() {
  try {
    const { readdir, readFile } = await import("node:fs/promises");
    const entries = await readdir("/sys/class/drm");
    for (const card of entries.filter((item) => /^card\d+$/.test(item))) {
      const deviceBase = `/sys/class/drm/${card}/device`;
      let vendor = "";
      try {
        vendor = (await readFile(`${deviceBase}/vendor`, "utf8")).trim();
      } catch {}
      if (vendor !== "0x8086") continue;
      for (let hwmonIndex = 0; hwmonIndex < 8; hwmonIndex += 1) {
        try {
          const temp = Number((await readFile(`${deviceBase}/hwmon/hwmon${hwmonIndex}/temp1_input`, "utf8")).trim());
          if (Number.isFinite(temp) && temp > 0) {
            return round(temp / 1000);
          }
        } catch {}
      }
    }
  } catch {}
  return null;
}

async function readIntelGpuFrequency() {
  try {
    const { readdir, readFile } = await import("node:fs/promises");
    const entries = await readdir("/sys/class/drm");
    for (const card of entries.filter((item) => /^card\d+$/.test(item))) {
      const cardBase = `/sys/class/drm/${card}`;
      const deviceBase = `/sys/class/drm/${card}/device`;
      let vendor = "";
      try {
        vendor = (await readFile(`${deviceBase}/vendor`, "utf8")).trim();
      } catch {}
      if (vendor !== "0x8086") continue;
      for (const path of [
        `${cardBase}/gt_cur_freq_mhz`,
        `${cardBase}/gt_act_freq_mhz`,
        `${cardBase}/gt/gt0/rps_cur_freq_mhz`,
        `${cardBase}/gt/gt0/rps_act_freq_mhz`
      ]) {
        try {
          const raw = Number((await readFile(path, "utf8")).trim());
          if (Number.isFinite(raw) && raw > 0) return round(raw);
        } catch {}
      }
    }
  } catch {}
  return null;
}

async function sampleNvidiaFrequency(index) {
  try {
    const { stdout } = await execFile("nvidia-smi", [
      `--query-gpu=clocks.current.graphics`,
      "--format=csv,noheader,nounits",
      "-i",
      String(index)
    ]);
    const value = Number(String(stdout).trim().split("\n")[0]);
    return Number.isFinite(value) ? round(value) : null;
  } catch {
    return null;
  }
}

async function readGpuFrequency(deviceBase, vendor) {
  const { readFile } = await import("node:fs/promises");
  if (vendor === "0x1002") {
    for (const path of [`${deviceBase}/pp_dpm_sclk`, `${deviceBase}/pp_dpm_mclk`]) {
      try {
        const text = await readFile(path, "utf8");
        const activeLine = text
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.includes("*"));
        const match = activeLine?.match(/([0-9]+)\s*Mhz/i);
        const value = Number(match?.[1] ?? NaN);
        if (Number.isFinite(value) && value > 0) return round(value);
      } catch {}
    }
  }
  return null;
}

async function readSwapMemory() {
  if (process.platform === "win32") {
    return await readWindowsSwapMemory();
  }
  try {
    const meminfo = requireText("/proc/meminfo");
    const totalKb = parseMeminfoField(meminfo, "SwapTotal");
    const freeKb = parseMeminfoField(meminfo, "SwapFree");
    const totalBytes = totalKb * 1024;
    const usedBytes = Math.max(0, totalKb - freeKb) * 1024;
    return { totalBytes, usedBytes };
  } catch {
    return { totalBytes: 0, usedBytes: 0 };
  }
}

async function readWindowsSwapMemory() {
  try {
    const { stdout } = await runPowerShell(
      [
        "$ErrorActionPreference = 'Stop'",
        "$usage = Get-CimInstance Win32_PageFileUsage",
        "$totalMb = ($usage | Measure-Object -Property AllocatedBaseSize -Sum).Sum",
        "$usedMb = ($usage | Measure-Object -Property CurrentUsage -Sum).Sum",
        "[pscustomobject]@{ TotalMb = $totalMb; UsedMb = $usedMb } | ConvertTo-Json -Compress"
      ].join("; "),
      { timeoutMs: windowsCommandTimeoutMs }
    );
    const parsed = JSON.parse(String(stdout).trim() || "{}");
    const result = {
      totalBytes: Number(parsed.TotalMb ?? 0) * 1024 * 1024,
      usedBytes: Number(parsed.UsedMb ?? 0) * 1024 * 1024
    };
    if (result.totalBytes > 0 || result.usedBytes > 0) {
      metricCache.set("windowsSwap", { value: result, at: Date.now(), source: "swap-primary" });
      return result;
    }
    const cachedSwap = getCachedMetricValue("windowsSwap", 10 * 60_000);
    if (cachedSwap) {
      return cachedSwap;
    }
    return result;
  } catch {
    const cachedSwap = getCachedMetricValue("windowsSwap", 10 * 60_000);
    if (cachedSwap) {
      return cachedSwap;
    }
    return { totalBytes: 0, usedBytes: 0 };
  }
}

async function readNetCounters() {
  if (process.platform === "win32") {
    try {
      const { stdout } = await runPowerShell(
        [
          "$ProgressPreference = 'SilentlyContinue'",
          "$ErrorActionPreference = 'Stop'",
          "$rows = Get-NetAdapterStatistics | Where-Object { $_.Name -notmatch 'Loopback|isatap|Teredo' } | Select-Object ReceivedBytes,SentBytes",
          "$rows | ConvertTo-Json -Compress"
        ].join("; "),
        { timeoutMs: windowsCommandTimeoutMs }
      );
      const parsed = JSON.parse(String(stdout).trim() || "[]");
      const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      return rows.reduce(
        (acc, row) => ({
          rx: acc.rx + Number(row.ReceivedBytes ?? 0),
          tx: acc.tx + Number(row.SentBytes ?? 0)
        }),
        { rx: 0, tx: 0 }
      );
    } catch {
      const cachedInterfaces = getCachedMetricValue("networkInterfaces");
      if (Array.isArray(cachedInterfaces) && cachedInterfaces.length > 0) {
        return cachedInterfaces.reduce(
          (acc, item) => ({
            rx: acc.rx + Number(item.totalRxBytes ?? 0),
            tx: acc.tx + Number(item.totalTxBytes ?? 0)
          }),
          { rx: 0, tx: 0 }
        );
      }
      try {
        const interfaces = os.networkInterfaces();
        let rx = 0;
        let tx = 0;
        for (const addresses of Object.values(interfaces)) {
          if (!Array.isArray(addresses) || addresses.length === 0) continue;
          const first = addresses[0];
          if (!first || first.internal) continue;
          rx += 1;
          tx += 1;
        }
        return { rx, tx };
      } catch {
        return { rx: 0, tx: 0 };
      }
    }
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile("/proc/net/dev", "utf8");
    return parseNetCounters(text);
  } catch {
    return { rx: 0, tx: 0 };
  }
}

function parseNetCounters(text) {
  let rx = 0;
  let tx = 0;
  for (const line of text.split("\n").slice(2)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("lo:")) continue;
    const [namePart, statsPart] = trimmed.split(":");
    if (!namePart || !statsPart) continue;
    const columns = statsPart.trim().split(/\s+/).map(Number);
    rx += columns[0] ?? 0;
    tx += columns[8] ?? 0;
  }
  return { rx, tx };
}

async function readNetworkInterfaces() {
  if (process.platform === "win32") {
    try {
      const script = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$stats = @(Get-NetAdapterStatistics | Where-Object { $_.Name -notmatch 'Loopback|isatap|Teredo' })
$configs = @(Get-NetIPConfiguration | Where-Object { $_.NetAdapter -and $_.NetAdapter.Status -eq 'Up' -and $_.InterfaceAlias -notmatch 'Loopback|isatap|Teredo' })
$rows = foreach ($config in $configs) {
  $stat = $stats | Where-Object {
    $_.InterfaceDescription -eq $config.NetAdapter.InterfaceDescription -or
    $_.Name -eq $config.InterfaceAlias
  } | Select-Object -First 1
  [pscustomobject]@{
    Id = if ($config.InterfaceIndex -ne $null) { 'nic-' + $config.InterfaceIndex } else { $config.InterfaceAlias }
    Name = $config.InterfaceAlias
    MacAddress = if ($config.NetAdapter) { $config.NetAdapter.MacAddress } else { '' }
    IPv4 = @($config.IPv4Address | ForEach-Object { $_.IPAddress })
    IPv6 = @($config.IPv6Address | ForEach-Object { $_.IPAddress })
    TotalRxBytes = if ($stat) { [uint64]$stat.ReceivedBytes } else { 0 }
    TotalTxBytes = if ($stat) { [uint64]$stat.SentBytes } else { 0 }
  }
}
$rows | ConvertTo-Json -Compress -Depth 5
      `.trim();
      const { stdout } = await runPowerShell(script, { encoded: true, timeoutMs: windowsCommandTimeoutMs });
      const parsed = JSON.parse(String(stdout).trim() || "[]");
      const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      const normalized = rows.map((row) => ({
        id: String(row.Id ?? row.Name ?? "nic"),
        name: String(row.Name ?? row.Id ?? "NIC"),
        macAddress: row.MacAddress ? String(row.MacAddress) : "",
        ipv4: Array.isArray(row.IPv4) ? row.IPv4.map(String) : [],
        ipv6: Array.isArray(row.IPv6) ? row.IPv6.map(String) : [],
        totalRxBytes: Number(row.TotalRxBytes ?? 0),
        totalTxBytes: Number(row.TotalTxBytes ?? 0)
      }));
      if (normalized.length > 0) {
        metricCache.set("networkInterfaces", { value: normalized, at: Date.now(), source: "network-primary" });
      }
      return normalized;
    } catch {
      const cachedInterfaces = getCachedMetricValue("networkInterfaces");
      if (Array.isArray(cachedInterfaces) && cachedInterfaces.length > 0) {
        return cachedInterfaces;
      }
      try {
        const interfaces = os.networkInterfaces();
        const normalized = Object.entries(interfaces)
          .filter(([name, addresses]) => {
            if (!Array.isArray(addresses) || addresses.length === 0) return false;
            if (/loopback|isatap|teredo/i.test(name)) return false;
            return addresses.some((item) => item && !item.internal);
          })
          .map(([name, addresses]) => {
            const activeAddresses = addresses.filter((item) => item && !item.internal);
            const first = activeAddresses[0] ?? {};
            return {
              id: `nic-${name}`,
              name,
              macAddress: typeof first.mac === "string" ? first.mac : "",
              ipv4: activeAddresses.filter((item) => item.family === "IPv4").map((item) => item.address),
              ipv6: activeAddresses.filter((item) => item.family === "IPv6").map((item) => item.address),
              totalRxBytes: 0,
              totalTxBytes: 0
            };
          });
        if (normalized.length > 0) {
          metricCache.set("networkInterfaces", { value: normalized, at: Date.now(), source: "network-os-fallback" });
        }
        return normalized;
      } catch {
        return [];
      }
    }
  }

  try {
    const interfaces = os.networkInterfaces();
    const countersText = requireText("/proc/net/dev");
    const counters = new Map();
    for (const line of countersText.split("\n").slice(2)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [namePart, statsPart] = trimmed.split(":");
      if (!namePart || !statsPart) continue;
      const name = namePart.trim();
      const columns = statsPart.trim().split(/\s+/).map(Number);
      counters.set(name, {
        totalRxBytes: Number(columns[0] ?? 0),
        totalTxBytes: Number(columns[8] ?? 0)
      });
    }

    return Object.entries(interfaces)
      .filter(([name, addresses]) => name !== "lo" && Array.isArray(addresses) && addresses.length > 0)
      .map(([name, addresses]) => {
        const first = addresses[0] ?? {};
        const counter = counters.get(name) ?? { totalRxBytes: 0, totalTxBytes: 0 };
        return {
          id: name,
          name,
          macAddress: typeof first.mac === "string" ? first.mac : "",
          ipv4: addresses.filter((item) => item.family === "IPv4").map((item) => item.address),
          ipv6: addresses.filter((item) => item.family === "IPv6").map((item) => item.address),
          totalRxBytes: counter.totalRxBytes,
          totalTxBytes: counter.totalTxBytes
        };
      });
  } catch {
    return [];
  }
}

function parseMeminfoField(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, "m"));
  return Number(match?.[1] ?? 0);
}

function requireText(path) {
  return process.platform === "linux" ? readFileSync(path, "utf8") : "";
}

async function readDiskCounters() {
  if (process.platform === "win32") {
    return { read: 0, write: 0 };
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile("/proc/diskstats", "utf8");
    let read = 0;
    let write = 0;
    for (const line of text.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      const name = parts[2] ?? "";
      if (!name || /^loop|^ram|^sr/.test(name)) continue;
      read += (Number(parts[5] ?? 0) * 512);
      write += (Number(parts[9] ?? 0) * 512);
    }
    return { read, write };
  } catch {
    return { read: 0, write: 0 };
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function summarizeDisks(disks) {
  return disks.reduce(
    (acc, disk) => ({
      totalBytes: acc.totalBytes + (Number(disk.totalBytes) || 0),
      usedBytes: acc.usedBytes + (Number(disk.usedBytes) || 0)
    }),
    { totalBytes: 0, usedBytes: 0 }
  );
}

async function readLinuxDisks() {
  const { stdout } = await execFile("lsblk", [
    "-b",
    "-J",
    "-o",
    "NAME,PATH,TYPE,MOUNTPOINT,FSTYPE,MODEL,VENDOR,SIZE,FSUSED"
  ]);
  const parsed = JSON.parse(String(stdout).trim() || "{}");
  const devices = Array.isArray(parsed.blockdevices) ? parsed.blockdevices : [];
  const disks = [];

  function visit(node, inherited = {}) {
    const nextInherited = {
      model: inherited.model || normalizeDiskText(node.model),
      vendor: inherited.vendor || normalizeDiskText(node.vendor),
      rootName: inherited.rootName || node.name || "",
      rootPath: inherited.rootPath || node.path || ""
    };

    const mountPoint = typeof node.mountpoint === "string" ? node.mountpoint.trim() : "";
    const totalBytes = Number(node.size ?? 0);
    const usedBytes = Number(node.fsused ?? 0);
    const fileSystemType = typeof node.fstype === "string" ? node.fstype.trim() : "";
    const devicePath = typeof node.path === "string" ? node.path.trim() : "";

    if (mountPoint && totalBytes > 0 && !shouldSkipLinuxMount(mountPoint, devicePath)) {
      disks.push({
        id: `${devicePath || nextInherited.rootPath || nextInherited.rootName}:${mountPoint}`,
        name: nextInherited.rootName || node.name || devicePath || mountPoint,
        mountPoint,
        filesystem: fileSystemType || devicePath,
        model: nextInherited.model || "",
        vendor: nextInherited.vendor || "",
        sourceKey: nextInherited.rootName || node.name || devicePath || mountPoint,
        totalBytes,
        usedBytes: Number.isFinite(usedBytes) && usedBytes >= 0 ? usedBytes : 0
      });
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child, nextInherited);
      }
    }
  }

  for (const device of devices) {
    visit(device);
  }

  return disks;
}

function normalizeDiskText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function shouldSkipLinuxMount(mountPoint, devicePath) {
  if (!mountPoint || mountPoint === "[SWAP]") return true;
  const skipPrefixes = ["/snap", "/boot/efi"];
  if (skipPrefixes.some((prefix) => mountPoint.startsWith(prefix))) return true;
  return typeof devicePath === "string" && devicePath.startsWith("/dev/loop");
}

function parseOptionalPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? round(numeric) : null;
}

async function readFirstNumber(paths, pattern) {
  const { readFile } = await import("node:fs/promises");
  for (const path of paths) {
    try {
      const text = await readFile(path, "utf8");
      const match = text.match(pattern);
      const value = Number(match?.[1] ?? NaN);
      if (Number.isFinite(value)) return value;
    } catch {}
  }
  return null;
}

async function execFileWithTimeout(command, args, options = {}) {
  return await execFile(command, args, {
    windowsHide: true,
    timeout: options.timeout ?? commandTimeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    ...options
  });
}

async function runPowerShell(script, options = {}) {
  const normalizedScript = [
    "[Console]::InputEncoding = [System.Text.Encoding]::UTF8",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    script
  ].join("; ");
  const args = options.encoded
    ? ["-NoProfile", "-EncodedCommand", Buffer.from(normalizedScript, "utf16le").toString("base64")]
    : ["-NoProfile", "-Command", normalizedScript];
  return await execFileWithTimeout("powershell", args, { timeout: options.timeoutMs ?? commandTimeoutMs });
}
