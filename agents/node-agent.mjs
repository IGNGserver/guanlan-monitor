import os from "node:os";
import { readFileSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const serverUrl = process.env.DSC_SERVER_URL ?? "http://127.0.0.1:4000";
const agentSecret = process.env.DSC_AGENT_SECRET ?? "replace-me-agent-secret";
const deviceId = process.env.DSC_DEVICE_ID ?? "开发机";
const hostname = process.env.DSC_HOSTNAME ?? deviceId;
const hardwareJsonUrl = process.env.DSC_HARDWARE_JSON_URL ?? "";
const pollIntervalMs = 5000;

let previousCpu = os.cpus();
let previousNet = await readNetCounters();
let previousDisk = await readDiskCounters();
let previousInterfaceStats = await readNetworkInterfaces();

setInterval(runOnce, pollIntervalMs);
await runOnce();

async function runOnce() {
  try {
    const timestamp = new Date().toISOString();
    const cpuUsagePercent = sampleCpuUsage();
    const cpuFrequencyMHz = await sampleCpuFrequency();
    const cpuPackages = await sampleCpuPackages(cpuFrequencyMHz);
    const memory = await sampleMemory();
    const { diskUsage, disks } = await sampleDiskUsage();
    const diskRate = await sampleDiskRate();
    const { networkRate, networkInterfaces } = await sampleNetworkRate();
    const cpuTemperatureC = await sampleCpuTemperature();
    const gpus = await sampleGpus();
    const fans = await sampleFans();

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
      fans
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
  return readSwapMemory().then((swap) => ({
    totalBytes,
    usedBytes: totalBytes - freeBytes,
    swapTotalBytes: swap.totalBytes,
    swapUsedBytes: swap.usedBytes
  }));
}

async function sampleCpuPackages(cpuFrequencyMHz) {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFile("powershell", [
        "-NoProfile",
        "-Command",
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
        ].join("; ")
      ]);
      const parsed = JSON.parse(String(stdout).trim() || "[]");
      const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      return rows.map((row, index) => ({
        id: String(row.Id ?? `cpu-${index}`),
        name: String(row.Name ?? `CPU ${index + 1}`),
        model: String(row.Model ?? row.Name ?? ""),
        coreCount: Number(row.CoreCount ?? 0),
        logicalCount: Number(row.LogicalCount ?? 0),
        frequencyMHz: Number.isFinite(Number(row.FrequencyMHz)) ? round(Number(row.FrequencyMHz)) : cpuFrequencyMHz
      }));
    } catch {
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

async function sampleDiskUsage() {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFile("powershell", [
        "-NoProfile",
        "-Command",
        `$ErrorActionPreference = 'Stop'
$volumes = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  $driveLetter = $_.DeviceID.TrimEnd(':')
  $partition = Get-Partition -DriveLetter $driveLetter -ErrorAction SilentlyContinue | Select-Object -First 1
  $disk = if ($partition) { Get-Disk -Number $partition.DiskNumber -ErrorAction SilentlyContinue } else { $null }
  [pscustomobject]@{
    DriveLetter = $driveLetter
    VolumeLabel = $_.VolumeName
    FileSystem = $_.FileSystem
    Size = [uint64]$_.Size
    SizeRemaining = [uint64]$_.FreeSpace
    DiskNumber = if ($disk) { $disk.Number } else { $null }
    Model = if ($disk) { $disk.FriendlyName } else { $null }
    Vendor = if ($disk) { $disk.Manufacturer } else { $null }
    BusType = if ($disk) { $disk.BusType.ToString() } else { $null }
    SerialNumber = if ($disk) { $disk.SerialNumber } else { $null }
  }
}
$volumes | ConvertTo-Json -Compress`
      ]);
      const rows = JSON.parse(String(stdout).trim() || "[]");
      const list = (Array.isArray(rows) ? rows : [rows])
        .filter(Boolean)
        .map((item) => {
          const totalBytes = Number(item.Size ?? 0);
          const freeBytes = Number(item.SizeRemaining ?? 0);
          const usedBytes = Math.max(0, totalBytes - freeBytes);
          const mountPoint = `${item.DriveLetter}:\\`;
          const sourceKey = item.DiskNumber != null ? `disk-${item.DiskNumber}` : mountPoint;
          return {
            id: item.DiskNumber != null ? `disk-${item.DiskNumber}-${mountPoint}` : mountPoint,
            name: item.VolumeLabel ? `${item.DriveLetter}: (${item.VolumeLabel})` : `${item.DriveLetter}:`,
            mountPoint,
            filesystem: [item.FileSystem, item.BusType].filter(Boolean).join(" · "),
            model: item.Model ?? "",
            vendor: item.Vendor ?? "",
            sourceKey,
            totalBytes,
            usedBytes
          };
        });
      return {
        diskUsage: summarizeDisks(list),
        disks: list
      };
    } catch {
      return { diskUsage: { totalBytes: 0, usedBytes: 0 }, disks: [] };
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
  const rxDelta = Math.max(0, current.rx - previousNet.rx);
  const txDelta = Math.max(0, current.tx - previousNet.tx);
  previousNet = current;
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
      rxBytesPerSec: round(rxDelta / seconds),
      txBytesPerSec: round(txDelta / seconds),
      totalRxBytes: current.rx,
      totalTxBytes: current.tx
    },
    networkInterfaces
  };
}

async function sampleWindowsDiskRate() {
  try {
    const { stdout } = await execFile("powershell", [
      "-NoProfile",
      "-Command",
      [
        "$ProgressPreference = 'SilentlyContinue'",
        "$ErrorActionPreference = 'Stop'",
        "$rows = Get-Counter '\\PhysicalDisk(*)\\Disk Read Bytes/sec','\\PhysicalDisk(*)\\Disk Write Bytes/sec' | Select-Object -ExpandProperty CounterSamples",
        "$rows | Select-Object Path,InstanceName,CookedValue | ConvertTo-Json -Compress -Depth 4"
      ].join("; ")
    ]);
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
  if (hardwareSnapshot) {
    const cpuTemp = extractHardwareMonitorCpuTemperature(hardwareSnapshot);
    if (cpuTemp != null) return cpuTemp;
  }
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFile("powershell", [
        "-NoProfile",
        "-Command",
        "Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/wmi | Select-Object -ExpandProperty CurrentTemperature"
      ]);
      const raw = String(stdout).trim().split(/\s+/)[0];
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) return null;
      return round(value / 10 - 273.15);
    } catch {
      return null;
    }
  }
  if (process.platform !== "linux") return null;
  const sensorsTemp = await readCpuTemperatureFromSensors();
  if (sensorsTemp != null) return sensorsTemp;
  const paths = [
    "/sys/class/thermal/thermal_zone0/temp",
    "/sys/class/hwmon/hwmon0/temp1_input"
  ];
  for (const path of paths) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      return round(value >= 1000 ? value / 1000 : value);
    } catch {}
  }
  return null;
}

async function sampleCpuFrequency() {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFile("powershell", [
        "-NoProfile",
        "-Command",
        "(Get-CimInstance Win32_Processor | Measure-Object -Property CurrentClockSpeed -Average).Average"
      ]);
      const value = Number(String(stdout).trim());
      return Number.isFinite(value) ? round(value) : null;
    } catch {
      return null;
    }
  }
  if (process.platform !== "linux") return null;
  try {
    const cpuinfo = requireText("/proc/cpuinfo");
    const matches = [...cpuinfo.matchAll(/^cpu MHz\s*:\s*([0-9.]+)$/gm)].map((match) => Number(match[1]));
    const values = matches.filter((value) => Number.isFinite(value) && value > 0);
    if (values.length) {
      return round(values.reduce((sum, value) => sum + value, 0) / values.length);
    }
  } catch {}
  return null;
}

async function sampleGpus() {
  const hardwareSnapshot = await readHardwareMonitorSnapshot();
  if (hardwareSnapshot) {
    const gpus = extractHardwareMonitorGpus(hardwareSnapshot);
    if (gpus.length) return gpus;
  }
  if (process.platform === "win32") {
    return await sampleWindowsGpus();
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
    const [controllers, counterSamples] = await Promise.all([
      readWindowsVideoControllers(),
      readWindowsGpuCounterSamples()
    ]);

    const physicalControllers = controllers.filter((controller) => Number(controller.AdapterRAM ?? 0) > 0);
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
  const { stdout } = await execFile("powershell", [
    "-NoProfile",
    "-Command",
    [
      "$ProgressPreference = 'SilentlyContinue'",
      "$ErrorActionPreference = 'Stop'",
      "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,PNPDeviceID,VideoProcessor | ConvertTo-Json -Compress"
    ].join("; ")
  ]);
  const rows = JSON.parse(String(stdout).trim() || "[]");
  return Array.isArray(rows) ? rows.filter(Boolean) : rows ? [rows] : [];
}

async function readWindowsGpuCounterSamples() {
  const { stdout } = await execFile("powershell", [
    "-NoProfile",
    "-Command",
    [
      "$ProgressPreference = 'SilentlyContinue'",
      "$ErrorActionPreference = 'Stop'",
      "$samples = Get-Counter '\\GPU Engine(*)\\Utilization Percentage','\\GPU Adapter Memory(*)\\Dedicated Usage','\\GPU Adapter Memory(*)\\Shared Usage'",
      "$samples.CounterSamples | Select-Object Path,InstanceName,CookedValue | ConvertTo-Json -Compress -Depth 4"
    ].join("; ")
  ]);
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

async function sampleFans() {
  const hardwareSnapshot = await readHardwareMonitorSnapshot();
  if (hardwareSnapshot) {
    const fans = extractHardwareMonitorFans(hardwareSnapshot);
    if (fans.length) return fans;
  }
  if (process.platform === "win32") {
    return [];
  }
  if (process.platform !== "linux") return [];
  const sensorFans = await readFansFromSensors();
  if (sensorFans.length) return sensorFans;
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
  return sensors;
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

function walkHardwareTree(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  const children = Array.isArray(node.Children) ? node.Children : Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    walkHardwareTree(child, visit);
  }
}

function extractHardwareMonitorCpuTemperature(snapshot) {
  let found = null;
  walkHardwareTree(snapshot, (node) => {
    const type = String(node.SensorType ?? node.sensorType ?? "").toLowerCase();
    const name = String(node.Name ?? node.name ?? "").toLowerCase();
    const value = Number(node.Value ?? node.value);
    if (type !== "temperature" || !Number.isFinite(value)) return;
    if (name.includes("cpu package") || name.includes("cpu core") || name.includes("package")) {
      found = round(value);
    }
  });
  return found;
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
    const sensorType = String(node.SensorType ?? node.sensorType ?? "").toLowerCase();
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
    if (sensorType === "small data" && sensorName.includes("memory used")) current.memoryUsedBytes = Math.round(value * 1024 * 1024);
    if (sensorType === "small data" && sensorName.includes("memory total")) current.memoryTotalBytes = Math.round(value * 1024 * 1024);
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
    const { stdout } = await execFile("powershell", [
      "-NoProfile",
      "-Command",
      [
        "$ErrorActionPreference = 'Stop'",
        "$usage = Get-CimInstance Win32_PageFileUsage",
        "$totalMb = ($usage | Measure-Object -Property AllocatedBaseSize -Sum).Sum",
        "$usedMb = ($usage | Measure-Object -Property CurrentUsage -Sum).Sum",
        "[pscustomobject]@{ TotalMb = $totalMb; UsedMb = $usedMb } | ConvertTo-Json -Compress"
      ].join("; ")
    ]);
    const parsed = JSON.parse(String(stdout).trim() || "{}");
    return {
      totalBytes: Number(parsed.TotalMb ?? 0) * 1024 * 1024,
      usedBytes: Number(parsed.UsedMb ?? 0) * 1024 * 1024
    };
  } catch {
    return { totalBytes: 0, usedBytes: 0 };
  }
}

async function readNetCounters() {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFile("powershell", [
        "-NoProfile",
        "-Command",
        [
          "$ProgressPreference = 'SilentlyContinue'",
          "$ErrorActionPreference = 'Stop'",
          "$rows = Get-NetAdapterStatistics | Where-Object { $_.Name -notmatch 'Loopback|isatap|Teredo' } | Select-Object ReceivedBytes,SentBytes",
          "$rows | ConvertTo-Json -Compress"
        ].join("; ")
      ]);
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
      return { rx: 0, tx: 0 };
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
      const { stdout } = await execFile("powershell", [
        "-NoProfile",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64")
      ]);
      const parsed = JSON.parse(String(stdout).trim() || "[]");
      const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      return rows.map((row) => ({
        id: String(row.Id ?? row.Name ?? "nic"),
        name: String(row.Name ?? row.Id ?? "NIC"),
        macAddress: row.MacAddress ? String(row.MacAddress) : "",
        ipv4: Array.isArray(row.IPv4) ? row.IPv4.map(String) : [],
        ipv6: Array.isArray(row.IPv6) ? row.IPv6.map(String) : [],
        totalRxBytes: Number(row.TotalRxBytes ?? 0),
        totalTxBytes: Number(row.TotalTxBytes ?? 0)
      }));
    } catch {
      return [];
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
