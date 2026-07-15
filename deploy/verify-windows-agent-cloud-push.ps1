param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$BackendPort = 17981,
  [int]$MockServerPort = 18981,
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-cloud-push"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-cloud-push-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $BackendPort)))
if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null

$mockRoot = Join-Path (Split-Path $resolvedConfigRoot -Parent) ("verify-agent-cloud-push-mock-" + $MockServerPort)
if (Test-Path $mockRoot) {
  Remove-Item -LiteralPath $mockRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $mockRoot | Out-Null

$capturePath = Join-Path $mockRoot "captured-request.json"
$mockLogPath = Join-Path $mockRoot "mock-server.log"
$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-cloud-push-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js is required to run the mock cloud push server."
}

$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$mockServerUrl = "http://127.0.0.1:$MockServerPort"
$expectedPayload = [ordered]@{
  deviceId = "cloud-push-test"
  enabledMetrics = @("cpuUsage", "networkTraffic")
  enabledDeviceIds = [ordered]@{
    disk = @("disk-1", "disk-2")
    network = @("nic-ethernet")
  }
  instanceMetricConfig = [ordered]@{
    "disk-1" = @("diskUsage")
    "nic-ethernet" = @("networkTraffic", "networkRxRate")
  }
}
@{
  connection = @{
    serverUrl = $mockServerUrl
    secret = "stub-secret"
    deviceId = $expectedPayload.deviceId
    hostname = "Cloud Push Test"
  }
  sampling = @{
    normalIntervalSeconds = 15
    fastIntervalSeconds = 5
    slowIntervalSeconds = 30
    realtimeModeEnabled = $false
  }
  enabledMetrics = $expectedPayload.enabledMetrics
  enabledDeviceIds = $expectedPayload.enabledDeviceIds
  instanceMetricConfig = $expectedPayload.instanceMetricConfig
  probeSelections = @(
    @{ target = "cpu"; provider = "builtin"; enabled = $true },
    @{ target = "disk"; provider = "builtin"; enabled = $true },
    @{ target = "network"; provider = "builtin"; enabled = $true }
  )
  cloudSyncEnabled = $true
  autoRestartCollector = $false
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding UTF8

$backendListenAddress = "127.0.0.1:$BackendPort"
$stateUrl = "http://$backendListenAddress/api/state"
$pushUrl = "http://$backendListenAddress/api/cloud/push"
$shutdownUrl = "http://$backendListenAddress/api/control/shutdown"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  mockServerUrl = $mockServerUrl
  backendPort = $BackendPort
  mockServerPort = $MockServerPort
  backendReachable = $false
  noImplicitPushObserved = $false
  pushAttempted = $false
  pushSucceeded = $false
  cloudSyncAt = ""
  cloudSyncError = ""
  requestCount = 0
  payloadMatched = $false
}

$mockServerScriptPath = Join-Path $mockRoot "mock-cloud-push-server.cjs"
@"
const http = require("node:http");
const fs = require("node:fs");

const port = Number(process.argv[2] || 0);
const capturePath = process.argv[3];
const logPath = process.argv[4];
let requestCount = 0;

function appendLog(message) {
  try {
    fs.appendFileSync(logPath, message + "\n", "utf8");
  } catch {}
}

function writeCapture(payload) {
  try {
    fs.writeFileSync(capturePath, JSON.stringify(payload, null, 2), "utf8");
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
      requestCount += 1;
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {}
      writeCapture({
        requestCount,
        body: parsed
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        requestCount,
        echoedDeviceId: parsed.deviceId || ""
      }));
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

Start-Sleep -Milliseconds 600

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

  Start-Sleep -Milliseconds 900
  $report.noImplicitPushObserved = (-not (Test-Path $capturePath))
  if (-not $report.noImplicitPushObserved) {
    throw "Cloud config was pushed before explicit /api/cloud/push call."
  }

  Invoke-RestMethod -Uri $pushUrl -Method Post -TimeoutSec 3 | Out-Null
  $report.pushAttempted = $true

  $captured = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-Path $capturePath) {
      try {
        $captured = Get-Content -LiteralPath $capturePath -Raw | ConvertFrom-Json
      } catch {
      }
      if ($captured) {
        break
      }
    }
  }

  if (-not $captured) {
    throw "Explicit cloud push did not reach the mock server."
  }

  $report.requestCount = [int]$captured.requestCount
  $body = $captured.body
  $report.payloadMatched =
    ([string]$body.deviceId -eq [string]$expectedPayload.deviceId) -and
    (@($body.enabledMetrics) -join ",") -eq (@($expectedPayload.enabledMetrics) -join ",") -and
    (@($body.enabledDeviceIds.disk) -join ",") -eq (@($expectedPayload.enabledDeviceIds.disk) -join ",") -and
    (@($body.enabledDeviceIds.network) -join ",") -eq (@($expectedPayload.enabledDeviceIds.network) -join ",") -and
    (@($body.instanceMetricConfig."disk-1") -join ",") -eq (@($expectedPayload.instanceMetricConfig."disk-1") -join ",") -and
    (@($body.instanceMetricConfig."nic-ethernet") -join ",") -eq (@($expectedPayload.instanceMetricConfig."nic-ethernet") -join ",")

  if (-not $report.payloadMatched) {
    throw "Cloud push payload did not match the expected local config."
  }

  $afterPushState = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $afterPushState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if (-not [string]::IsNullOrWhiteSpace([string]$afterPushState.lastCloudSyncAt)) {
        break
      }
    } catch {
    }
  }

  if (-not $afterPushState) {
    throw "Backend state was not readable after cloud push."
  }

  $report.cloudSyncAt = [string]$afterPushState.lastCloudSyncAt
  $report.cloudSyncError = [string]$afterPushState.lastCloudSyncError
  $report.pushSucceeded = (-not [string]::IsNullOrWhiteSpace($report.cloudSyncAt) -and [string]::IsNullOrWhiteSpace($report.cloudSyncError) -and $report.requestCount -ge 1 -and $report.payloadMatched)

  if (-not $report.pushSucceeded) {
    throw "Cloud push state did not reach the expected success state."
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

Write-Host "Cloud push verification passed."
Write-Host "Request count: $($report.requestCount)"
Write-Host "Cloud sync at: $($report.cloudSyncAt)"
