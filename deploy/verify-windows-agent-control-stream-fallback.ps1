param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$BackendPort = 17962,
  [int]$MockServerPort = 18962,
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-control-stream-fallback"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-control-stream-fallback-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $BackendPort)))
if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null
$mockRoot = Join-Path (Split-Path $resolvedConfigRoot -Parent) ("verify-agent-control-stream-fallback-mock-" + $MockServerPort)
if (Test-Path $mockRoot) {
  Remove-Item -LiteralPath $mockRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $mockRoot | Out-Null
$mockLogPath = Join-Path $mockRoot "mock-server.log"

$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-control-stream-fallback-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js is required to run the mock control-stream fallback server."
}

New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null
$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$mockServerUrl = "http://127.0.0.1:$MockServerPort"
@{
  connection = @{
    serverUrl = $mockServerUrl
    secret = "stub-secret"
    deviceId = "control-stream-fallback-test"
    hostname = "Control Stream Fallback Test"
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
  controlStreamConnected = $false
  controlStreamEventObserved = $false
  controlStreamDisconnectObserved = $false
  controlStreamDisconnectAt = ""
  controlStreamError = ""
  fallbackPollDrivenRealtimeObserved = $false
  fallbackRealtimeSource = ""
  fallbackEffectiveIntervalSeconds = 0
  fallbackRealtimeReverted = $false
  revertedEffectiveIntervalSeconds = 0
}

$mockServerScriptPath = Join-Path $mockRoot "mock-control-stream-fallback-server.cjs"
@"
const http = require("node:http");
const fs = require("node:fs");
const port = Number(process.argv[2] || 0);
const startedAt = Date.now();
const logPath = process.argv[3];

function appendLog(message) {
  try {
    fs.appendFileSync(logPath, message + "\n", "utf8");
  } catch {}
}

function buildPayload() {
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const enabled = elapsedSeconds < 20;
  return {
    deviceId: "control-stream-fallback-test",
    enabled,
    viewerCount: enabled ? 1 : 0,
    durationSeconds: 20,
    expiresAt: enabled ? new Date(Date.now() + 20_000).toISOString() : ""
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + port);
  appendLog(new Date().toISOString() + " " + req.method + " " + url.pathname + url.search + " auth=" + (req.headers.authorization || ""));

  if (req.headers.authorization === "Bearer stub-secret" &&
      url.pathname === "/api/agent/control-stream" &&
      url.searchParams.get("deviceId") === "control-stream-fallback-test") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "control_stream_unavailable" }));
    return;
  }

  if (req.headers.authorization === "Bearer stub-secret" &&
      url.pathname === "/api/agent/device-realtime" &&
      url.searchParams.get("deviceId") === "control-stream-fallback-test") {
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
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
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
    $probe = Invoke-RestMethod -Uri "$mockServerUrl/api/agent/device-realtime?deviceId=control-stream-fallback-test" `
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
  throw "Mock fallback server did not become reachable at $mockServerUrl"
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

  $fallbackState = $null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $fallbackState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if (-not $fallbackState.controlStreamConnected -and
          [string]$fallbackState.realtimeModeSource -eq "viewer" -and
          [bool]$fallbackState.realtimeModeEnabled) {
        break
      }
    } catch {
    }
  }

  if (-not $fallbackState) {
    throw "Fallback poll-driven realtime mode was not observed."
  }

  $report.controlStreamConnected = [bool]$fallbackState.controlStreamConnected
  $report.controlStreamEventObserved = -not [string]::IsNullOrWhiteSpace([string]$fallbackState.lastControlStreamEventAt)
  $report.controlStreamDisconnectAt = [string]$fallbackState.lastControlStreamDisconnectAt
  $report.controlStreamDisconnectObserved = -not [string]::IsNullOrWhiteSpace($report.controlStreamDisconnectAt)
  $report.controlStreamError = [string]$fallbackState.lastControlStreamError
  $report.fallbackPollDrivenRealtimeObserved = [bool]$fallbackState.realtimeModeEnabled
  $report.fallbackRealtimeSource = [string]$fallbackState.realtimeModeSource
  $report.fallbackEffectiveIntervalSeconds = [int]$fallbackState.effectiveUploadIntervalSeconds

  if ($report.controlStreamConnected -or
      $report.controlStreamEventObserved -or
      -not $report.controlStreamDisconnectObserved -or
      [string]::IsNullOrWhiteSpace($report.controlStreamError) -or
      -not $report.fallbackPollDrivenRealtimeObserved -or
      $report.fallbackRealtimeSource -ne "viewer" -or
      $report.fallbackEffectiveIntervalSeconds -ne 5) {
    throw "Fallback poll-driven realtime mode did not reach the expected state."
  }

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
    throw "Fallback poll-driven realtime mode did not revert back to normal mode."
  }

  $report.fallbackRealtimeReverted = (-not [bool]$revertedState.realtimeModeEnabled)
  $report.revertedEffectiveIntervalSeconds = [int]$revertedState.effectiveUploadIntervalSeconds

  if (-not $report.fallbackRealtimeReverted -or $report.revertedEffectiveIntervalSeconds -ne 15) {
    throw "Fallback poll-driven realtime revert was not observed."
  }
}
finally {
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

Write-Host "Control-stream fallback verification passed."
Write-Host "Fallback interval: $($report.fallbackEffectiveIntervalSeconds)"
Write-Host "Reverted interval: $($report.revertedEffectiveIntervalSeconds)"
