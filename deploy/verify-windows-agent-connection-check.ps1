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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-connection-check"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-connection-check-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $BackendPort)))
if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null

$mockRoot = Join-Path (Split-Path $resolvedConfigRoot -Parent) ("verify-agent-connection-check-mock-" + $MockServerPort)
if (Test-Path $mockRoot) {
  Remove-Item -LiteralPath $mockRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $mockRoot | Out-Null

$mockLogPath = Join-Path $mockRoot "mock-server.log"
$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-connection-check-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js is required to run the mock connection-check server."
}

$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$mockServerUrl = "http://127.0.0.1:$MockServerPort"
@{
  connection = @{
    serverUrl = $mockServerUrl
    secret = "bad-secret"
    deviceId = "device-known"
    hostname = "Connection Check Test"
  }
  sampling = @{
    normalIntervalSeconds = 15
    fastIntervalSeconds = 5
    slowIntervalSeconds = 30
    realtimeModeEnabled = $false
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
$configUrl = "http://$backendListenAddress/api/config"
$checkUrl = "http://$backendListenAddress/api/control/check-connection"
$shutdownUrl = "http://$backendListenAddress/api/control/shutdown"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  mockServerUrl = $mockServerUrl
  backendPort = $BackendPort
  mockServerPort = $MockServerPort
  backendReachable = $false
  unauthorizedStatus = ""
  unauthorizedAuthorized = $false
  unauthorizedReachable = $false
  deviceUnknownStatus = ""
  deviceUnknownAuthorized = $false
  deviceUnknownReachable = $false
  deviceUnknownKnown = $false
  deviceKnownStatus = ""
  deviceKnownAuthorized = $false
  deviceKnownReachable = $false
  deviceKnownKnown = $false
  unreachableStatus = ""
  unreachableReachable = $true
}

function Invoke-JsonRequest {
  param(
    [string]$Uri,
    [string]$Method = "Get",
    [string]$ContentType = "",
    [string]$Body = "",
    [int]$TimeoutSec = 3
  )

  $request = [System.Net.HttpWebRequest]::Create($Uri)
  $request.Method = $Method
  $request.Timeout = $TimeoutSec * 1000
  $request.ReadWriteTimeout = $TimeoutSec * 1000
  $request.Accept = "application/json"

  if (-not [string]::IsNullOrWhiteSpace($ContentType)) {
    $request.ContentType = $ContentType
  }

  if (-not [string]::IsNullOrWhiteSpace($Body)) {
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $request.ContentLength = $bodyBytes.Length
    $requestStream = $request.GetRequestStream()
    try {
      $requestStream.Write($bodyBytes, 0, $bodyBytes.Length)
    } finally {
      $requestStream.Dispose()
    }
  }

  try {
    $response = $request.GetResponse()
  } catch [System.Net.WebException] {
    $response = $_.Exception.Response
    if (-not $response) {
      throw
    }
  }

  $stream = $response.GetResponseStream()
  if (-not $stream) {
    throw "No response stream returned for $Uri"
  }

  $reader = New-Object System.IO.StreamReader($stream)
  try {
    $raw = $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
    $stream.Dispose()
    $response.Dispose()
  }

  if ([string]::IsNullOrWhiteSpace($raw)) {
    throw "Empty response body returned for $Uri"
  }

  return $raw | ConvertFrom-Json
}

$mockServerScriptPath = Join-Path $mockRoot "mock-connection-check-server.cjs"
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
  const auth = req.headers.authorization || "";
  appendLog(new Date().toISOString() + " " + req.method + " " + url.pathname + url.search + " auth=" + auth);

  if (url.pathname === "/api/agent/ping") {
    if (auth !== "Bearer good-secret") {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "unauthorized_agent" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, serverTime: new Date().toISOString() }));
    return;
  }

  if (url.pathname === "/api/agent/device-realtime") {
    if (auth !== "Bearer good-secret") {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "unauthorized_agent" }));
      return;
    }

    const deviceId = url.searchParams.get("deviceId") || "";
    if (deviceId === "device-known") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        deviceId,
        enabled: false,
        viewerCount: 0,
        durationSeconds: 20,
        expiresAt: ""
      }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "device_not_found" }));
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

  $unauthorized = Invoke-JsonRequest -Uri $checkUrl -Method Post -TimeoutSec 3
  $report.unauthorizedStatus = [string]$unauthorized.status
  $report.unauthorizedAuthorized = [bool]$unauthorized.authorized
  $report.unauthorizedReachable = [bool]$unauthorized.reachable
  if ($report.unauthorizedStatus -ne "unauthorized" -or $report.unauthorizedAuthorized -or -not $report.unauthorizedReachable) {
    throw "Unauthorized connection-check result was not as expected."
  }

  $deviceUnknownConfig = @{
    connection = @{
      serverUrl = $mockServerUrl
      secret = "good-secret"
      deviceId = "device-unknown"
      hostname = "Connection Check Test"
    }
    sampling = @{
      normalIntervalSeconds = 15
      fastIntervalSeconds = 5
      slowIntervalSeconds = 30
      realtimeModeEnabled = $false
    }
    enabledMetrics = @("cpuUsage")
    enabledDeviceIds = @{}
    instanceMetricConfig = @{}
    probeSelections = @(
      @{ target = "cpu"; provider = "builtin"; enabled = $true }
    )
    cloudSyncEnabled = $true
    autoRestartCollector = $false
  }
  $deviceUnknownConfig | ConvertTo-Json -Depth 6 | Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json; charset=utf-8" -TimeoutSec 3 | Out-Null

  $deviceUnknown = Invoke-JsonRequest -Uri $checkUrl -Method Post -TimeoutSec 3
  $report.deviceUnknownStatus = [string]$deviceUnknown.status
  $report.deviceUnknownAuthorized = [bool]$deviceUnknown.authorized
  $report.deviceUnknownReachable = [bool]$deviceUnknown.reachable
  $report.deviceUnknownKnown = [bool]$deviceUnknown.deviceKnown
  if ($report.deviceUnknownStatus -ne "authorized_device_unknown" -or -not $report.deviceUnknownAuthorized -or -not $report.deviceUnknownReachable -or $report.deviceUnknownKnown) {
    throw "Authorized-but-unknown-device result was not as expected."
  }

  $deviceKnownConfig = @{
    connection = @{
      serverUrl = $mockServerUrl
      secret = "good-secret"
      deviceId = "device-known"
      hostname = "Connection Check Test"
    }
    sampling = @{
      normalIntervalSeconds = 15
      fastIntervalSeconds = 5
      slowIntervalSeconds = 30
      realtimeModeEnabled = $false
    }
    enabledMetrics = @("cpuUsage")
    enabledDeviceIds = @{}
    instanceMetricConfig = @{}
    probeSelections = @(
      @{ target = "cpu"; provider = "builtin"; enabled = $true }
    )
    cloudSyncEnabled = $true
    autoRestartCollector = $false
  }
  $deviceKnownConfig | ConvertTo-Json -Depth 6 | Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json; charset=utf-8" -TimeoutSec 3 | Out-Null

  $deviceKnown = Invoke-JsonRequest -Uri $checkUrl -Method Post -TimeoutSec 3
  $report.deviceKnownStatus = [string]$deviceKnown.status
  $report.deviceKnownAuthorized = [bool]$deviceKnown.authorized
  $report.deviceKnownReachable = [bool]$deviceKnown.reachable
  $report.deviceKnownKnown = [bool]$deviceKnown.deviceKnown
  if ($report.deviceKnownStatus -ne "authorized_device_known" -or -not $report.deviceKnownAuthorized -or -not $report.deviceKnownReachable -or -not $report.deviceKnownKnown) {
    throw "Authorized-and-known-device result was not as expected."
  }

  $unreachableConfig = @{
    connection = @{
      serverUrl = "http://127.0.0.1:39999"
      secret = "good-secret"
      deviceId = "device-known"
      hostname = "Connection Check Test"
    }
    sampling = @{
      normalIntervalSeconds = 15
      fastIntervalSeconds = 5
      slowIntervalSeconds = 30
      realtimeModeEnabled = $false
    }
    enabledMetrics = @("cpuUsage")
    enabledDeviceIds = @{}
    instanceMetricConfig = @{}
    probeSelections = @(
      @{ target = "cpu"; provider = "builtin"; enabled = $true }
    )
    cloudSyncEnabled = $true
    autoRestartCollector = $false
  }
  $unreachableConfig | ConvertTo-Json -Depth 6 | Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json; charset=utf-8" -TimeoutSec 3 | Out-Null

  $unreachable = Invoke-JsonRequest -Uri $checkUrl -Method Post -TimeoutSec 3
  $report.unreachableStatus = [string]$unreachable.status
  $report.unreachableReachable = [bool]$unreachable.reachable
  if ($report.unreachableStatus -ne "server_unreachable" -or $report.unreachableReachable) {
    throw "Unreachable-server result was not as expected."
  }
}
finally {
  if ($process -and -not $process.HasExited) {
    try {
      Invoke-RestMethod -Uri $shutdownUrl -Method Post -TimeoutSec 2 | Out-Null
    } catch {
    }
    Start-Sleep -Milliseconds 300
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
    }
  }

  if ($mockProcess -and -not $mockProcess.HasExited) {
    Stop-Process -Id $mockProcess.Id -Force
  }

  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8
}

Write-Host "Connection-check verification passed."
Write-Host "Report: $resolvedReportPath"
