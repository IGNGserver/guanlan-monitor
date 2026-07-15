param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$BackendPort = 17991,
  [int]$MockServerPort = 18991,
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Resolve-BundlePath {
  param(
    [string]$RepoRoot,
    [string]$PathValue
  )

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $null
  }

  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }

  try {
    return (Resolve-Path $PathValue -ErrorAction Stop).Path
  } catch {
  }

  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $PathValue))
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedBundleRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $BundleRoot
if (-not $resolvedBundleRoot) {
  $prepareBundleScript = Join-Path $repoRoot "deploy\prepare-windows-agent-verify-bundle.ps1"
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-local-config-payload"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-local-config-payload-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $BackendPort)))
if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null

$mockRoot = Join-Path (Split-Path $resolvedConfigRoot -Parent) ("verify-agent-local-config-payload-mock-" + $MockServerPort)
if (Test-Path $mockRoot) {
  Remove-Item -LiteralPath $mockRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $mockRoot | Out-Null

$capturePath = Join-Path $mockRoot "captured-ingest.json"
$mockLogPath = Join-Path $mockRoot "mock-server.log"
$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-local-config-payload-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js is required to run the mock ingest server."
}

$mockServerUrl = "http://127.0.0.1:$MockServerPort"
$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
@{
  connection = @{
    serverUrl = $mockServerUrl
    secret = "stub-secret"
    deviceId = "local-config-payload-test"
    hostname = "Local Config Payload Test"
  }
  sampling = @{
    normalIntervalSeconds = 1
    fastIntervalSeconds = 1
    slowIntervalSeconds = 1
    realtimeModeEnabled = $false
  }
  enabledMetrics = @("cpuUsage", "diskUsage")
  enabledDeviceIds = @{}
  instanceMetricConfig = @{}
  probeSelections = @(
    @{ target = "cpu"; provider = "builtin"; enabled = $true },
    @{ target = "memory"; provider = "builtin"; enabled = $true },
    @{ target = "disk"; provider = "builtin"; enabled = $true },
    @{ target = "network"; provider = "builtin"; enabled = $true },
    @{ target = "gpu"; provider = "disabled"; enabled = $false },
    @{ target = "fan"; provider = "disabled"; enabled = $false }
  )
  cloudSyncEnabled = $false
  autoRestartCollector = $false
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding UTF8

$backendListenAddress = "127.0.0.1:$BackendPort"
$stateUrl = "http://$backendListenAddress/api/state"
$detectUrl = "http://$backendListenAddress/api/probes/detect"
$configUrl = "http://$backendListenAddress/api/config"
$startUrl = "http://$backendListenAddress/api/control/start"
$shutdownUrl = "http://$backendListenAddress/api/control/shutdown"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  backendPort = $BackendPort
  mockServerPort = $MockServerPort
  backendReachable = $false
  detectSucceeded = $false
  selectedCpuId = ""
  selectedDiskId = ""
  selectedCpuCount = 0
  selectedDiskCount = 0
  collectorStarted = $false
  ingestObserved = $false
  cpuKept = $false
  cpuPackagesFiltered = $false
  cpuFrequencyCleared = $false
  cpuTemperatureCleared = $false
  memoryCleared = $false
  networkCleared = $false
  disksFiltered = $false
  diskRateCleared = $false
  payloadMatched = $false
}

$mockServerScriptPath = Join-Path $mockRoot "mock-ingest-server.cjs"
@"
const http = require("node:http");
const fs = require("node:fs");

const port = Number(process.argv[2] || 0);
const capturePath = process.argv[3];
const logPath = process.argv[4];

function appendLog(message) {
  try {
    fs.appendFileSync(logPath, message + "\n", "utf8");
  } catch {}
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + port);
  appendLog(new Date().toISOString() + " " + req.method + " " + url.pathname + " auth=" + (req.headers.authorization || ""));

  if (req.method === "POST" &&
      req.headers.authorization === "Bearer stub-secret" &&
      url.pathname === "/api/agent/ingest") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {}
      try {
        fs.writeFileSync(capturePath, JSON.stringify(parsed, null, 2), "utf8");
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "127.0.0.1");
appendLog(new Date().toISOString() + " listening port=" + port);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
"@ | Set-Content -LiteralPath $mockServerScriptPath -Encoding UTF8

$mockProcess = Start-Process -FilePath $nodeCommand.Source `
  -ArgumentList @($mockServerScriptPath, $MockServerPort, $capturePath, $mockLogPath) `
  -WorkingDirectory $mockRoot `
  -WindowStyle Hidden `
  -PassThru

Start-Sleep -Milliseconds 500

$process = $null
try {
  $process = Start-Process -FilePath $backendExe `
    -ArgumentList @("--listen", $backendListenAddress, "--bundle-root", $backendDir, "--config-root", $resolvedConfigRoot) `
    -WorkingDirectory $backendDir `
    -WindowStyle Hidden `
    -PassThru

  $state = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $state = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ($state) {
        break
      }
    } catch {
    }
  }

  if (-not $state) {
    throw "Local backend did not become reachable at $stateUrl"
  }
  $report.backendReachable = $true

  $detectResponse = Invoke-RestMethod -Uri $detectUrl -Method Post -TimeoutSec 3
  $cpuTarget = $detectResponse.detectedTargets | Where-Object { $_.target -eq "cpu" } | Select-Object -First 1
  $diskTarget = $detectResponse.detectedTargets | Where-Object { $_.target -eq "disk" } | Select-Object -First 1
  $selectedCpu = $cpuTarget.instances | Select-Object -First 1
  $selectedDisk = $diskTarget.instances | Select-Object -First 1
  if (-not $selectedCpu) {
    throw "No CPU instance was returned by probe detection."
  }
  if (-not $selectedDisk) {
    throw "No disk instance was returned by probe detection."
  }
  $report.detectSucceeded = $true
  $report.selectedCpuId = [string]$selectedCpu.id
  $report.selectedDiskId = [string]$selectedDisk.id

  $updatedConfig = @{
    connection = @{
      serverUrl = $mockServerUrl
      secret = "stub-secret"
      deviceId = "local-config-payload-test"
      hostname = "Local Config Payload Test"
    }
    sampling = @{
      normalIntervalSeconds = 1
      fastIntervalSeconds = 1
      slowIntervalSeconds = 1
      realtimeModeEnabled = $false
    }
    enabledMetrics = @("cpuUsage", "diskUsage")
    enabledDeviceIds = @{
      cpu = @([string]$selectedCpu.id)
      disk = @([string]$selectedDisk.id)
    }
    instanceMetricConfig = @{}
    probeSelections = @(
      @{ target = "cpu"; provider = "builtin"; enabled = $true },
      @{ target = "memory"; provider = "builtin"; enabled = $false },
      @{ target = "disk"; provider = "builtin"; enabled = $true },
      @{ target = "network"; provider = "builtin"; enabled = $false },
      @{ target = "gpu"; provider = "disabled"; enabled = $false },
      @{ target = "fan"; provider = "disabled"; enabled = $false }
    )
    cloudSyncEnabled = $false
    autoRestartCollector = $false
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json" -Body $updatedConfig -TimeoutSec 3 | Out-Null
  Invoke-RestMethod -Uri $startUrl -Method Post -TimeoutSec 12 | Out-Null
  $report.collectorStarted = $true

  $payload = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $capturePath) {
      try {
        $payload = Get-Content -LiteralPath $capturePath -Raw | ConvertFrom-Json
      } catch {
      }
      if ($payload) {
        break
      }
    }
  }

  if (-not $payload) {
    throw "No ingest payload was captured from the collector."
  }

  $report.ingestObserved = $true
  $cpuPackages = @()
  if ($null -ne $payload.cpuPackages) {
    $cpuPackages = @($payload.cpuPackages)
  }
  $report.selectedCpuCount = $cpuPackages.Count
  $report.selectedDiskCount = @($payload.disks).Count
  $report.cpuKept = ($null -ne $payload.cpuUsagePercent)
  $report.cpuPackagesFiltered = (
    $cpuPackages.Count -ge 1 -and
    ($cpuPackages | Where-Object { [string]$_.id -ne [string]$selectedCpu.id }).Count -eq 0
  )
  $report.cpuFrequencyCleared = (
    $null -eq $payload.cpuFrequencyMHz -and
    ($cpuPackages | Where-Object { $null -ne $_.frequencyMHz }).Count -eq 0
  )
  $report.cpuTemperatureCleared = (
    $null -eq $payload.cpuTemperatureC -and
    ($cpuPackages | Where-Object { $null -ne $_.temperatureC }).Count -eq 0
  )
  $report.memoryCleared = (
    [uint64]$payload.memory.totalBytes -eq 0 -and
    [uint64]$payload.memory.usedBytes -eq 0 -and
    [uint64]$payload.memory.swapTotalBytes -eq 0 -and
    [uint64]$payload.memory.swapUsedBytes -eq 0
  )
  $networkInterfaces = @()
  if ($null -ne $payload.networkInterfaces) {
    $networkInterfaces = @($payload.networkInterfaces)
  }
  $report.networkCleared = (
    [double]$payload.networkRate.rxBytesPerSec -eq 0 -and
    [double]$payload.networkRate.txBytesPerSec -eq 0 -and
    [uint64]$payload.networkRate.totalRxBytes -eq 0 -and
    [uint64]$payload.networkRate.totalTxBytes -eq 0 -and
    $networkInterfaces.Count -eq 0
  )
  $report.disksFiltered = (
    @($payload.disks).Count -eq 1 -and
    [string]$payload.disks[0].id -eq [string]$selectedDisk.id
  )
  $report.diskRateCleared = (
    [double]$payload.diskRate.readBytesPerSec -eq 0 -and
    [double]$payload.diskRate.writeBytesPerSec -eq 0
  )
  $report.payloadMatched = (
    $report.cpuKept -and
    $report.cpuPackagesFiltered -and
    $report.cpuFrequencyCleared -and
    $report.cpuTemperatureCleared -and
    $report.memoryCleared -and
    $report.networkCleared -and
    $report.disksFiltered -and
    $report.diskRateCleared
  )

  if (-not $report.payloadMatched) {
    throw "Captured ingest payload did not reflect the expected local config filtering."
  }
} finally {
  try {
    Invoke-RestMethod -Uri $shutdownUrl -Method Post -TimeoutSec 2 | Out-Null
    Start-Sleep -Milliseconds 600
  } catch {
  }

  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }

  if ($mockProcess -and -not $mockProcess.HasExited) {
    Stop-Process -Id $mockProcess.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 200
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8
  Write-Host "Report: $resolvedReportPath"
}

Write-Host "Local config payload verification passed."
Write-Host "Selected disk: $($report.selectedDiskId)"
