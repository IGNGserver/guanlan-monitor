param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$BackendPort = 18071,
  [int]$MockServerPort = 19071,
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-cloud-pending-persist"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-cloud-pending-persist-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $BackendPort)))
if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null

$mockRoot = Join-Path (Split-Path $resolvedConfigRoot -Parent) ("verify-agent-cloud-pending-persist-mock-" + $MockServerPort)
if (Test-Path $mockRoot) {
  Remove-Item -LiteralPath $mockRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $mockRoot | Out-Null

$capturePath = Join-Path $mockRoot "captured-request.json"
$mockLogPath = Join-Path $mockRoot "mock-server.log"
$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-cloud-pending-persist-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js is required to run the mock cloud sync server."
}

$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$syncStatePath = Join-Path $resolvedConfigRoot "agent-ui.sync-state.json"
$mockServerUrl = "http://127.0.0.1:$MockServerPort"
@{
  connection = @{
    serverUrl = $mockServerUrl
    secret = "stub-secret"
    deviceId = "cloud-pending-persist-test"
    hostname = "Cloud Pending Persist Test"
  }
  sampling = @{
    normalIntervalSeconds = 15
    fastIntervalSeconds = 5
    slowIntervalSeconds = 30
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
  cloudSyncEnabled = $true
  autoRestartCollector = $false
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding UTF8

$backendListenAddress = "127.0.0.1:$BackendPort"
$stateUrl = "http://$backendListenAddress/api/state"
$configUrl = "http://$backendListenAddress/api/config"
$pushUrl = "http://$backendListenAddress/api/cloud/push"
$shutdownUrl = "http://$backendListenAddress/api/control/shutdown"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  syncStatePath = $syncStatePath
  backendPort = $BackendPort
  mockServerPort = $MockServerPort
  firstBootReachable = $false
  initialPending = $false
  localDisplayChangeApplied = $false
  pendingAfterLocalChange = $false
  syncStateWritten = $false
  secondBootReachable = $false
  pendingRestoredAfterRestart = $false
  pushSucceeded = $false
  pendingClearedAfterPush = $false
}

$mockServerScriptPath = Join-Path $mockRoot "mock-cloud-pending-server.cjs"
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
      url.pathname === "/api/agent/device-config") {
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

function Wait-BackendState {
  param(
    [string]$Uri,
    [int]$Attempts = 30
  )

  $state = $null
  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $state = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 2
      if ($state) {
        return $state
      }
    } catch {
    }
  }

  return $null
}

function Start-BackendProcess {
  param(
    [string]$Exe,
    [string]$BackendDir,
    [string]$ListenAddress,
    [string]$ConfigRoot
  )

  return Start-Process -FilePath $Exe `
    -ArgumentList @("--listen", $ListenAddress, "--bundle-root", $BackendDir, "--config-root", $ConfigRoot) `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -PassThru
}

$process = $null
try {
  $process = Start-BackendProcess -Exe $backendExe -BackendDir $backendDir -ListenAddress $backendListenAddress -ConfigRoot $resolvedConfigRoot

  $baselineState = Wait-BackendState -Uri $stateUrl
  if (-not $baselineState) {
    throw "Local backend did not become reachable at $stateUrl"
  }
  $report.firstBootReachable = $true
  $report.initialPending = [bool]$baselineState.cloudConfigPending
  if ($report.initialPending) {
    throw "Initial backend state unexpectedly reported cloudConfigPending=true."
  }

  $updatedConfig = @{
    connection = @{
      serverUrl = $mockServerUrl
      secret = "stub-secret"
      deviceId = "cloud-pending-persist-test"
      hostname = "Cloud Pending Persist Test"
    }
    sampling = @{
      normalIntervalSeconds = 15
      fastIntervalSeconds = 5
      slowIntervalSeconds = 30
      realtimeModeEnabled = $false
    }
    enabledMetrics = @("cpuUsage")
    enabledDeviceIds = @{
      cpu = @("cpu-0")
    }
    instanceMetricConfig = @{}
    probeSelections = @(
      @{ target = "cpu"; provider = "builtin"; enabled = $true },
      @{ target = "memory"; provider = "builtin"; enabled = $true },
      @{ target = "disk"; provider = "builtin"; enabled = $true },
      @{ target = "network"; provider = "builtin"; enabled = $true },
      @{ target = "gpu"; provider = "disabled"; enabled = $false },
      @{ target = "fan"; provider = "disabled"; enabled = $false }
    )
    cloudSyncEnabled = $true
    autoRestartCollector = $false
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json" -Body $updatedConfig -TimeoutSec 3 | Out-Null
  $report.localDisplayChangeApplied = $true

  $dirtyState = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $dirtyState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ($dirtyState -and [bool]$dirtyState.cloudConfigPending) {
        break
      }
    } catch {
    }
  }
  if (-not $dirtyState) {
    throw "Backend state was not readable after local config update."
  }
  $report.pendingAfterLocalChange = [bool]$dirtyState.cloudConfigPending
  if (-not $report.pendingAfterLocalChange) {
    throw "Local display config change did not mark cloudConfigPending=true."
  }

  $report.syncStateWritten = Test-Path $syncStatePath
  if (-not $report.syncStateWritten) {
    throw "Expected sync state file was not written: $syncStatePath"
  }

  Invoke-RestMethod -Uri $shutdownUrl -Method Post -TimeoutSec 3 | Out-Null
  Start-Sleep -Milliseconds 900
  if ($process -and -not $process.HasExited) {
    $process.WaitForExit(4000) | Out-Null
  }

  $process = Start-BackendProcess -Exe $backendExe -BackendDir $backendDir -ListenAddress $backendListenAddress -ConfigRoot $resolvedConfigRoot
  $restoredState = Wait-BackendState -Uri $stateUrl
  if (-not $restoredState) {
    throw "Local backend did not become reachable after restart."
  }
  $report.secondBootReachable = $true
  $report.pendingRestoredAfterRestart = [bool]$restoredState.cloudConfigPending
  if (-not $report.pendingRestoredAfterRestart) {
    throw "cloudConfigPending was not restored after backend restart."
  }

  Invoke-RestMethod -Uri $pushUrl -Method Post -TimeoutSec 3 | Out-Null
  $report.pushSucceeded = $true

  $finalState = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $finalState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ($finalState -and -not [bool]$finalState.cloudConfigPending) {
        break
      }
    } catch {
    }
  }
  if (-not $finalState) {
    throw "Backend state was not readable after explicit cloud push."
  }
  $report.pendingClearedAfterPush = -not [bool]$finalState.cloudConfigPending
  if (-not $report.pendingClearedAfterPush) {
    throw "cloudConfigPending was not cleared after explicit cloud push."
  }
}
finally {
  if ($process) {
    try {
      if (-not $process.HasExited) {
        try {
          Invoke-RestMethod -Uri $shutdownUrl -Method Post -TimeoutSec 2 | Out-Null
        } catch {
        }
        Start-Sleep -Milliseconds 400
        if (-not $process.HasExited) {
          Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
      }
    } catch {
    }
  }

  if ($mockProcess) {
    try {
      if (-not $mockProcess.HasExited) {
        Stop-Process -Id $mockProcess.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {
    }
  }

  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8
}

Write-Host "Cloud pending persistence verification passed."
Write-Host "Report: $resolvedReportPath"
