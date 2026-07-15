param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$BackendPort = 17961,
  [int]$MockServerPort = 18961,
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-JsonReportWithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [object]$Data,

    [int]$MaxAttempts = 8,
    [int]$DelayMilliseconds = 250
  )

  $json = $Data | ConvertTo-Json -Depth 6
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      Set-Content -LiteralPath $Path -Value $json -Encoding UTF8
      return
    } catch {
      if ($attempt -ge $MaxAttempts) {
        throw
      }
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }
}

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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-viewer-realtime"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-viewer-realtime-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $BackendPort)))
if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null
$mockRoot = Join-Path (Split-Path $resolvedConfigRoot -Parent) ("verify-agent-viewer-realtime-mock-" + $MockServerPort)
if (Test-Path $mockRoot) {
  Remove-Item -LiteralPath $mockRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $mockRoot | Out-Null
$mockLogPath = Join-Path $mockRoot "mock-server.log"

$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-viewer-realtime-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js is required to run the mock viewer realtime server."
}

New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null
$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$mockServerUrl = "http://127.0.0.1:$MockServerPort"
@{
  connection = @{
    serverUrl = $mockServerUrl
    secret = "stub-secret"
    deviceId = "viewer-realtime-test"
    hostname = "Viewer Realtime Test"
  }
  sampling = @{
    normalIntervalSeconds = 15
    fastIntervalSeconds = 5
    slowIntervalSeconds = 30
    realtimeModeEnabled = $false
    realtimeModeSource = ""
  }
  enabledMetrics = @("cpuUsage")
  enabledDeviceIds = @{}
  instanceMetricConfig = @{}
  probeSelections = @(
    @{ target = "cpu"; provider = "builtin"; enabled = $true }
  )
  cloudSyncEnabled = $true
  autoRestartCollector = $false
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $configPath -Encoding UTF8

$backendListenAddress = "127.0.0.1:$BackendPort"
$stateUrl = "http://$backendListenAddress/api/state"
$shutdownUrl = "http://$backendListenAddress/api/control/shutdown"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  mockServerUrl = $mockServerUrl
  backendPort = $BackendPort
  mockServerPort = $MockServerPort
  backendReachable = $false
  baselineRealtimeMode = $false
  controlStreamConnected = $false
  controlStreamEventObserved = $false
  controlStreamEventAt = ""
  controlStreamStableBeyondTimeoutWindow = $false
  viewerDrivenRealtimeObserved = $false
  viewerDrivenRealtimeSource = ""
  viewerDrivenRealtimePhase = ""
  viewerDrivenEffectiveIntervalSeconds = 0
  viewerDrivenExpiresAt = ""
  viewerDrivenRealtimeReverted = $false
  revertedEffectiveIntervalSeconds = 0
}

$mockServerScriptPath = Join-Path $mockRoot "mock-viewer-realtime-server.cjs"
@"
const http = require("node:http");
const fs = require("node:fs");
const port = Number(process.argv[2] || 0);
const startedAt = Date.now();
const logPath = process.argv[3];
const clients = new Set();

function appendLog(message) {
  try {
    fs.appendFileSync(logPath, message + "\n", "utf8");
  } catch {}
}

function buildPayload() {
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const enabled = elapsedSeconds < 20;
  return {
    deviceId: "viewer-realtime-test",
    enabled,
    viewerCount: enabled ? 1 : 0,
    durationSeconds: 20,
    expiresAt: enabled ? new Date(Date.now() + 20_000).toISOString() : ""
  };
}

function writeEvent(res) {
  const payload = buildPayload();
  appendLog(new Date().toISOString() + " sse enabled=" + payload.enabled + " expiresAt=" + payload.expiresAt);
  res.write("data: " + JSON.stringify({
    type: "viewer-realtime",
    ...payload,
    emittedAt: new Date().toISOString()
  }) + "\n\n");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + port);
  appendLog(new Date().toISOString() + " " + req.method + " " + url.pathname + url.search + " auth=" + (req.headers.authorization || ""));
  if (req.headers.authorization === "Bearer stub-secret" &&
      url.pathname === "/api/agent/control-stream" &&
      url.searchParams.get("deviceId") === "viewer-realtime-test") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive"
    });
    res.write(": connected\n\n");
    clients.add(res);
    writeEvent(res);
    req.on("close", () => {
      clients.delete(res);
    });
    return;
  }

  if (req.headers.authorization === "Bearer stub-secret" &&
      url.pathname === "/api/agent/device-realtime" &&
      url.searchParams.get("deviceId") === "viewer-realtime-test") {
    const payload = buildPayload();
    appendLog(new Date().toISOString() + " payload enabled=" + payload.enabled + " expiresAt=" + payload.expiresAt);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "127.0.0.1");
appendLog(new Date().toISOString() + " listening port=" + port);
const timer = setInterval(() => {
  for (const client of [...clients]) {
    try {
      writeEvent(client);
    } catch {
      clients.delete(client);
    }
  }
}, 1000);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("exit", () => clearInterval(timer));
"@ | Set-Content -LiteralPath $mockServerScriptPath -Encoding UTF8

$mockProcess = Start-Process -FilePath $nodeCommand.Source `
  -ArgumentList @($mockServerScriptPath, $MockServerPort, $mockLogPath) `
  -WorkingDirectory $mockRoot `
  -WindowStyle Hidden `
  -PassThru

$mockReady = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 250
  try {
    $probe = Invoke-RestMethod -Uri "$mockServerUrl/api/agent/device-realtime?deviceId=viewer-realtime-test" `
      -Headers @{ Authorization = "Bearer stub-secret" } `
      -TimeoutSec 2
    if ($probe) {
      $mockReady = $true
      break
    }
  } catch {
  }
}

if (-not $mockReady) {
  throw "Mock viewer realtime server did not become reachable at $mockServerUrl"
}

$process = $null
try {
  $process = Start-Process -FilePath $backendExe `
    -ArgumentList @("--listen", $backendListenAddress, "--bundle-root", $backendDir, "--config-root", $resolvedConfigRoot) `
    -WorkingDirectory $backendDir `
    -WindowStyle Hidden `
    -PassThru

  $baselineState = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $baselineState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ($baselineState) {
        break
      }
    } catch {
    }
  }

  if (-not $baselineState) {
    throw "Local backend did not become reachable at $stateUrl"
  }

  $report.backendReachable = $true
  $report.baselineRealtimeMode = [bool]$baselineState.realtimeModeEnabled

  $viewerState = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $viewerState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ($viewerState.controlStreamConnected -and
          -not [string]::IsNullOrWhiteSpace([string]$viewerState.lastControlStreamEventAt) -and
          $viewerState.realtimeModeEnabled -and
          [string]$viewerState.realtimeModeSource -eq "viewer") {
        break
      }
    } catch {
    }
  }

  if (-not $viewerState) {
    throw "Viewer-driven realtime mode was not observed."
  }

  $report.viewerDrivenRealtimeObserved = [bool]$viewerState.realtimeModeEnabled
  $report.viewerDrivenRealtimeSource = [string]$viewerState.realtimeModeSource
  $report.viewerDrivenRealtimePhase = [string]$viewerState.viewerRealtimePhase
  $report.viewerDrivenEffectiveIntervalSeconds = [int]$viewerState.effectiveUploadIntervalSeconds
  $report.viewerDrivenExpiresAt = [string]$viewerState.realtimeModeExpiresAt
  $report.controlStreamConnected = [bool]$viewerState.controlStreamConnected
  $report.controlStreamEventAt = [string]$viewerState.lastControlStreamEventAt
  $report.controlStreamEventObserved = -not [string]::IsNullOrWhiteSpace($report.controlStreamEventAt)

  if (-not $report.controlStreamConnected -or
      -not $report.controlStreamEventObserved -or
      -not $report.viewerDrivenRealtimeObserved -or
      $report.viewerDrivenRealtimeSource -ne "viewer" -or
      $report.viewerDrivenRealtimePhase -ne "active" -or
      $report.viewerDrivenEffectiveIntervalSeconds -ne 5) {
    throw "Viewer-driven realtime mode did not reach the expected state."
  }

  $stableState = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $stableState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      $eventAt = [string]$stableState.lastControlStreamEventAt
      if ($stableState.controlStreamConnected -and
          -not [string]::IsNullOrWhiteSpace($eventAt) -and
          ((Get-Date) - [DateTime]::Parse($eventAt).ToLocalTime()).TotalSeconds -ge 11) {
        break
      }
    } catch {
    }
  }

  if (-not $stableState) {
    throw "Control-stream connection did not stay connected beyond the previous 10-second timeout window."
  }

  $report.controlStreamStableBeyondTimeoutWindow = [bool]$stableState.controlStreamConnected

  $revertedState = $null
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $revertedState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if (-not $revertedState.realtimeModeEnabled -and [int]$revertedState.effectiveUploadIntervalSeconds -eq 15) {
        break
      }
    } catch {
    }
  }

  if (-not $revertedState) {
    throw "Viewer-driven realtime mode did not revert back to normal mode."
  }

  $report.viewerDrivenRealtimeReverted = (-not [bool]$revertedState.realtimeModeEnabled)
  $report.revertedEffectiveIntervalSeconds = [int]$revertedState.effectiveUploadIntervalSeconds

  if (-not $report.viewerDrivenRealtimeReverted -or $report.revertedEffectiveIntervalSeconds -ne 15) {
    throw "Viewer-driven realtime mode revert was not observed."
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
  Write-JsonReportWithRetry -Path $resolvedReportPath -Data $report
  Write-Host "Report: $resolvedReportPath"
}

Write-Host "Viewer-driven realtime verification passed."
Write-Host "Viewer interval: $($report.viewerDrivenEffectiveIntervalSeconds)"
Write-Host "Reverted interval: $($report.revertedEffectiveIntervalSeconds)"
