param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$ListenPort = 17941,
  [int]$MockServerPort = 18941,
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-issue-category"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-issue-category"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath($resolvedConfigRoot)

$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-issue-category-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js is required to run the mock recovery server."
}

New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null
$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
@{
  connection = @{
    serverUrl = "http://127.0.0.1:1"
    secret = "bad-secret"
    deviceId = "issue-category-test"
    hostname = "Issue Category Test"
  }
  sampling = @{
    fastIntervalSeconds = 1
    slowIntervalSeconds = 5
  }
  enabledMetrics = @("cpuUsage")
  enabledDeviceIds = @{}
  instanceMetricConfig = @{}
  probeSelections = @(
    @{ target = "cpu"; provider = "builtin"; enabled = $true },
    @{ target = "memory"; provider = "builtin"; enabled = $false },
    @{ target = "disk"; provider = "builtin"; enabled = $false },
    @{ target = "network"; provider = "builtin"; enabled = $false },
    @{ target = "gpu"; provider = "disabled"; enabled = $false },
    @{ target = "fan"; provider = "disabled"; enabled = $false }
  )
  cloudSyncEnabled = $true
  autoRestartCollector = $false
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $configPath -Encoding UTF8

$listenAddress = "127.0.0.1:$ListenPort"
$stateUrl = "http://$listenAddress/api/state"
$startUrl = "http://$listenAddress/api/control/start"
$configUrl = "http://$listenAddress/api/config"
$shutdownUrl = "http://$listenAddress/api/control/shutdown"
$mockServerUrl = "http://127.0.0.1:$MockServerPort"
$mockRoot = Join-Path $resolvedConfigRoot "mock-server"
New-Item -ItemType Directory -Force -Path $mockRoot | Out-Null
$mockLogPath = Join-Path $mockRoot "mock-server.log"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  backendExe = $backendExe
  listenPort = $ListenPort
  backendReachable = $false
  startAttempted = $false
  issueObserved = $false
  issueCategory = ""
  issueDetail = ""
  issueAt = ""
  issueCount = 0
  issueRecoveredAt = ""
  recoveryObserved = $false
  recoveredConnectionStatus = ""
  connectionStatus = ""
  diagnosticsPath = ""
}

$mockServerScriptPath = Join-Path $mockRoot "mock-issue-recovery-server.cjs"
@"
const http = require("node:http");
const fs = require("node:fs");
const port = Number(process.argv[2] || 0);
const logPath = process.argv[3];

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
    req.on("data", (chunk) => body += chunk);
    req.on("end", () => {
      appendLog(new Date().toISOString() + " ingest bytes=" + body.length);
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
  -ArgumentList @($mockServerScriptPath, $MockServerPort, $mockLogPath) `
  -WorkingDirectory $mockRoot `
  -WindowStyle Hidden `
  -PassThru

$mockReady = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 250
  try {
    $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port $MockServerPort -WarningAction SilentlyContinue
    if ($tcp.TcpTestSucceeded) {
      $mockReady = $true
      break
    }
  } catch {
  }
}

if (-not $mockReady) {
  throw "Mock recovery server did not become reachable at $mockServerUrl"
}

$process = $null
try {
  $process = Start-Process -FilePath $backendExe `
    -ArgumentList @("--listen", $listenAddress, "--bundle-root", $backendDir, "--config-root", $resolvedConfigRoot) `
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

  Invoke-RestMethod -Uri $startUrl -Method Post -TimeoutSec 12 | Out-Null
  $report.startAttempted = $true

  $observedState = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 750
    try {
      $observedState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ($observedState.lastIssueCategory -eq "upload") {
        break
      }
    } catch {
    }
  }

  if (-not $observedState) {
    throw "Backend state could not be read after start."
  }

  $report.issueCategory = [string]$observedState.lastIssueCategory
  $report.issueDetail = [string]$observedState.lastIssueDetail
  $report.issueAt = [string]$observedState.lastIssueAt
  $report.issueCount = [int]$observedState.lastIssueCount
  $report.issueRecoveredAt = [string]$observedState.lastIssueRecoveredAt
  $report.connectionStatus = [string]$observedState.connectionStatus
  $report.diagnosticsPath = [string]$observedState.diagnosticsPath
  $report.issueObserved = ($report.issueCategory -eq "upload")

  if (-not $report.issueObserved) {
    throw "Expected issue category 'upload' was not observed. actual=$($report.issueCategory)"
  }
  if ($report.issueCount -lt 1) {
    throw "Expected issue count >= 1 after upload failures. actual=$($report.issueCount)"
  }
  if (-not [string]::IsNullOrWhiteSpace($report.issueRecoveredAt)) {
    throw "Issue should not be marked recovered while upload failure is still being observed. actual=$($report.issueRecoveredAt)"
  }

  $recoveryConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $recoveryConfig.connection.serverUrl = $mockServerUrl
  $recoveryConfig.connection.secret = "stub-secret"
  $recoveryConfig | ConvertTo-Json -Depth 6 | Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json; charset=utf-8" -TimeoutSec 3 | Out-Null

  $recoveredState = $null
  for ($attempt = 0; $attempt -lt 24; $attempt++) {
    Start-Sleep -Milliseconds 750
    try {
      $recoveredState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if (-not [string]::IsNullOrWhiteSpace([string]$recoveredState.lastIssueRecoveredAt) -and
          [int]$recoveredState.lastIssueCount -eq 0) {
        break
      }
    } catch {
    }
  }

  if (-not $recoveredState) {
    throw "Issue recovery state was not observed after switching collector upload to the mock server."
  }

  $report.issueRecoveredAt = [string]$recoveredState.lastIssueRecoveredAt
  $report.recoveredConnectionStatus = [string]$recoveredState.connectionStatus
  $report.recoveryObserved = -not [string]::IsNullOrWhiteSpace($report.issueRecoveredAt)

  if (-not $report.recoveryObserved) {
    throw "Expected issueRecoveredAt to be populated after upload recovery."
  }
  if ($report.recoveredConnectionStatus -ne "connected") {
    throw "Expected connectionStatus to return to 'connected' after recovery. actual=$($report.recoveredConnectionStatus)"
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
    Start-Sleep -Milliseconds 300
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8
  Write-Host "Report: $resolvedReportPath"
}

Write-Host "Issue category verification passed."
Write-Host "Issue category: $($report.issueCategory)"
Write-Host "Initial connection status: $($report.connectionStatus)"
Write-Host "Recovered connection status: $($report.recoveredConnectionStatus)"
