param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$BackendPort = 18047,
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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedBundleRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $BundleRoot
if (-not $resolvedBundleRoot) {
  $prepareBundleScript = Join-Path $repoRoot "deploy\prepare-windows-agent-verify-bundle.ps1"
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-cloud-pending-boundary"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-cloud-pending-boundary-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $BackendPort)))
if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null

$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-cloud-pending-boundary-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$syncStatePath = Join-Path $resolvedConfigRoot "agent-ui.sync-state.json"
@{
  connection = @{
    serverUrl = "http://127.0.0.1:19999"
    secret = "stub-secret"
    deviceId = "cloud-pending-boundary-test"
    hostname = "Cloud Pending Boundary Test"
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
$shutdownUrl = "http://$backendListenAddress/api/control/shutdown"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  syncStatePath = $syncStatePath
  backendPort = $BackendPort
  backendReachable = $false
  initialPending = $false
  runtimeOnlyChangeApplied = $false
  pendingAfterRuntimeChange = $false
  syncStateStillMissing = $false
}

$process = $null
try {
  $process = Start-Process -FilePath $backendExe `
    -ArgumentList @("--listen", $backendListenAddress, "--bundle-root", $backendDir, "--config-root", $resolvedConfigRoot) `
    -WorkingDirectory $backendDir `
    -WindowStyle Hidden `
    -PassThru

  $baselineState = Wait-BackendState -Uri $stateUrl
  if (-not $baselineState) {
    throw "Local backend did not become reachable at $stateUrl"
  }
  $report.backendReachable = $true
  $report.initialPending = [bool]$baselineState.cloudConfigPending
  if ($report.initialPending) {
    throw "Initial backend state unexpectedly reported cloudConfigPending=true."
  }

  $updatedConfig = @"
{
  "connection": {
    "serverUrl": "http://127.0.0.1:19999",
    "secret": "stub-secret",
    "deviceId": "cloud-pending-boundary-test",
    "hostname": "Cloud Pending Boundary Test"
  },
  "sampling": {
    "normalIntervalSeconds": 11,
    "fastIntervalSeconds": 3,
    "slowIntervalSeconds": 41,
    "realtimeModeEnabled": false
  },
  "enabledMetrics": ["cpuUsage", "diskUsage"],
  "enabledDeviceIds": {},
  "instanceMetricConfig": {},
  "probeSelections": [
    { "target": "cpu", "provider": "builtin", "enabled": true },
    { "target": "memory", "provider": "builtin", "enabled": true },
    { "target": "disk", "provider": "builtin", "enabled": true },
    { "target": "network", "provider": "builtin", "enabled": true },
    { "target": "gpu", "provider": "disabled", "enabled": false },
    { "target": "fan", "provider": "disabled", "enabled": false }
  ],
  "cloudSyncEnabled": true,
  "autoRestartCollector": true
}
"@

  Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json" -Body $updatedConfig -TimeoutSec 3 | Out-Null
  $report.runtimeOnlyChangeApplied = $true

  Start-Sleep -Milliseconds 500
  $runtimeState = Wait-BackendState -Uri $stateUrl -Attempts 8
  if (-not $runtimeState) {
    throw "Backend state was not readable after runtime-only config update."
  }

  $report.pendingAfterRuntimeChange = [bool]$runtimeState.cloudConfigPending
  if ($report.pendingAfterRuntimeChange) {
    throw "Runtime-only config change unexpectedly marked cloudConfigPending=true."
  }

  $report.syncStateStillMissing = -not (Test-Path $syncStatePath)
  if (-not $report.syncStateStillMissing) {
    throw "Runtime-only config change unexpectedly created sync state file: $syncStatePath"
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

  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8
}

Write-Host "Cloud pending boundary verification passed."
Write-Host "Report: $resolvedReportPath"
