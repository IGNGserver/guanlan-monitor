param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$BackendPort = 17964,
  [int]$MockServerPort = 18964,
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

  $json = $Data | ConvertTo-Json -Depth 8
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-control-stream-recovering"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-control-stream-recovering-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $BackendPort)))
if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null
$mockRoot = Join-Path (Split-Path $resolvedConfigRoot -Parent) ("verify-agent-control-stream-recovering-mock-" + $MockServerPort)
if (Test-Path $mockRoot) {
  Remove-Item -LiteralPath $mockRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $mockRoot | Out-Null
$mockLogPath = Join-Path $mockRoot "mock-server.log"

$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-control-stream-recovering-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js is required to run the mock control-stream recovering server."
}

$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$mockServerUrl = "http://127.0.0.1:$MockServerPort"
@{
  connection = @{
    serverUrl = $mockServerUrl
    secret = "stub-secret"
    deviceId = "control-stream-recovering-test"
    hostname = "Control Stream Recovering Test"
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
  initialStreamConnected = $false
  initialEventObserved = $false
  recoveringObserved = $false
  reconnectCountObserved = 0
  reconnectAtObserved = ""
  staleErrorObserved = ""
  staleDiagnosticObserved = $false
  secondStreamConnectionObserved = $false
  reconnectedAfterRecovery = $false
  finalControlStreamConnected = $false
}

$mockServerScriptPath = Join-Path $mockRoot "mock-control-stream-recovering-server.cjs"
@"
const http = require("node:http");
const fs = require("node:fs");
const port = Number(process.argv[2] || 0);
const logPath = process.argv[3];
let connectionCount = 0;

function appendLog(message) {
  try {
    fs.appendFileSync(logPath, message + "\n", "utf8");
  } catch {}
}

function payload() {
  return {
    deviceId: "control-stream-recovering-test",
    enabled: true,
    viewerCount: 1,
    durationSeconds: 60,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
}

function sendEvent(res) {
  res.write("data: " + JSON.stringify({
    type: "viewer-realtime",
    ...payload(),
    emittedAt: new Date().toISOString()
  }) + "\n\n");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + port);
  appendLog(new Date().toISOString() + " " + req.method + " " + url.pathname + url.search + " auth=" + (req.headers.authorization || ""));

  if (req.headers.authorization === "Bearer stub-secret" &&
      url.pathname === "/api/agent/control-stream" &&
      url.searchParams.get("deviceId") === "control-stream-recovering-test") {
    connectionCount += 1;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive"
    });
    res.write(": connected\n\n");
    sendEvent(res);
    appendLog(new Date().toISOString() + " sse connection=" + connectionCount + " one-shot event sent");
    req.on("close", () => appendLog(new Date().toISOString() + " sse closed connection=" + connectionCount));
    return;
  }

  if (req.headers.authorization === "Bearer stub-secret" &&
      url.pathname === "/api/agent/device-realtime" &&
      url.searchParams.get("deviceId") === "control-stream-recovering-test") {
    const nextPayload = payload();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(nextPayload));
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
    $probe = Invoke-RestMethod -Uri "$mockServerUrl/api/agent/device-realtime?deviceId=control-stream-recovering-test" `
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
  throw "Mock recovering server did not become reachable at $mockServerUrl"
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

  $initialState = $null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $initialState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ($initialState.controlStreamConnected -and -not [string]::IsNullOrWhiteSpace([string]$initialState.lastControlStreamEventAt)) {
        break
      }
    } catch {
    }
  }

  if (-not $initialState) {
    throw "Initial control-stream connection was not observed."
  }

  $report.initialStreamConnected = [bool]$initialState.controlStreamConnected
  $report.initialEventObserved = -not [string]::IsNullOrWhiteSpace([string]$initialState.lastControlStreamEventAt)

  $recoveringState = $null
  $deadline = (Get-Date).AddSeconds(75)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
    try {
      $state = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ([int]$state.controlStreamReconnectCount -gt 0) {
        $report.reconnectCountObserved = [int]$state.controlStreamReconnectCount
        $report.reconnectAtObserved = [string]$state.lastControlStreamReconnectAt
      }
      if (([string]$state.lastControlStreamError).StartsWith("control_stream_stale_for_")) {
        $recoveringState = $state
        break
      }
    } catch {
    }
  }

  if ($recoveringState) {
    $report.recoveringObserved = $true
    $report.staleErrorObserved = [string]$recoveringState.lastControlStreamError
    $report.reconnectCountObserved = [Math]::Max($report.reconnectCountObserved, [int]$recoveringState.controlStreamReconnectCount)
    $report.reconnectAtObserved = if ([string]::IsNullOrWhiteSpace($report.reconnectAtObserved)) { [string]$recoveringState.lastControlStreamReconnectAt } else { $report.reconnectAtObserved }
  }

  $diagnosticsPath = Join-Path $resolvedConfigRoot "agent-ui.backend.log"
  $mockLogResolvedPath = $mockLogPath
  $deadlineReconnectEvidence = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadlineReconnectEvidence) {
    Start-Sleep -Milliseconds 500
    if (-not $report.staleDiagnosticObserved -and (Test-Path $diagnosticsPath)) {
      $diagnosticRaw = Get-Content -LiteralPath $diagnosticsPath -Raw
      if ($diagnosticRaw -match "canceling stale control stream: control_stream_stale_for_") {
        $report.staleDiagnosticObserved = $true
      }
    }

    if (-not $report.secondStreamConnectionObserved -and (Test-Path $mockLogResolvedPath)) {
      $mockRaw = Get-Content -LiteralPath $mockLogResolvedPath -Raw
      if ($mockRaw -match "sse connection=2 one-shot event sent") {
        $report.secondStreamConnectionObserved = $true
      }
    }

    try {
      $state = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ([int]$state.controlStreamReconnectCount -gt $report.reconnectCountObserved) {
        $report.reconnectCountObserved = [int]$state.controlStreamReconnectCount
      }
      if ([string]::IsNullOrWhiteSpace($report.reconnectAtObserved) -and -not [string]::IsNullOrWhiteSpace([string]$state.lastControlStreamReconnectAt)) {
        $report.reconnectAtObserved = [string]$state.lastControlStreamReconnectAt
      }
      if ([bool]$state.controlStreamConnected) {
        $report.finalControlStreamConnected = $true
      }
    } catch {
    }

    if ($report.staleDiagnosticObserved -and $report.secondStreamConnectionObserved -and $report.finalControlStreamConnected) {
      break
    }
  }

  if (-not $report.staleDiagnosticObserved) {
    throw "Stale control-stream diagnostic was not observed in backend log."
  }

  if (-not $report.secondStreamConnectionObserved) {
    throw "Mock server did not observe a second control-stream connection after stale recovery."
  }

  if ($report.reconnectCountObserved -lt 1 -or [string]::IsNullOrWhiteSpace($report.reconnectAtObserved)) {
    throw "Reconnect count or reconnect timestamp was not persisted after stale recovery."
  }

  if (-not $report.recoveringObserved) {
    $report.recoveringObserved = $report.staleDiagnosticObserved -and ($report.reconnectCountObserved -ge 1)
  }

  if ([string]::IsNullOrWhiteSpace($report.staleErrorObserved) -and $report.recoveringObserved) {
    $report.staleErrorObserved = "control_stream_stale_for_observed_via_diagnostics"
  }

  if (-not $report.finalControlStreamConnected) {
    throw "Control-stream did not report a connected state after stale recovery."
  }

  $report.reconnectedAfterRecovery = $true
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

Write-Host "Control-stream recovering verification passed."
Write-Host "Reconnect count: $($report.reconnectCountObserved)"
