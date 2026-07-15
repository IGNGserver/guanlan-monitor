param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$ListenPort = 18081,
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-first-run"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-first-run-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $ListenPort)))
if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null

$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-first-run-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$listenAddress = "127.0.0.1:$ListenPort"
$stateUrl = "http://$listenAddress/api/state"
$configUrl = "http://$listenAddress/api/config"
$shutdownUrl = "http://$listenAddress/api/control/shutdown"

$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$syncStatePath = Join-Path $resolvedConfigRoot "agent-ui.sync-state.json"
$diagnosticsPath = Join-Path $resolvedConfigRoot "agent-ui.backend.log"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  listenPort = $ListenPort
  backendReachable = $false
  initialConfigMissing = $false
  initialSyncStateMissing = $false
  initialDiagnosticsMissing = $false
  configCreatedOnFirstRun = $false
  diagnosticsCreatedOnFirstRun = $false
  syncStateCreatedOnFirstRun = $false
  stateConfigPathMatched = $false
  stateSyncStatePathMatched = $false
  stateDiagnosticsPathMatched = $false
  stateConfigFileExistsOnFirstRun = $false
  stateSyncStateFileExistsOnFirstRun = $false
  stateDiagnosticsFileExistsOnFirstRun = $false
  controlStreamDisconnectedOnFirstRun = $false
  lastControlStreamEventMissingOnFirstRun = $false
  syncStateCreatedAfterDisplayChange = $false
  stateSyncStateFileExistsAfterDisplayChange = $false
  cloudConfigPendingAfterDisplayChange = $false
}

$process = $null
try {
  $report.initialConfigMissing = (-not (Test-Path $configPath))
  $report.initialSyncStateMissing = (-not (Test-Path $syncStatePath))
  $report.initialDiagnosticsMissing = (-not (Test-Path $diagnosticsPath))

  if (-not $report.initialConfigMissing -or -not $report.initialSyncStateMissing -or -not $report.initialDiagnosticsMissing) {
    throw "First-run verifier expected an empty config root before backend start."
  }

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

  $report.configCreatedOnFirstRun = (Test-Path $configPath)
  $report.diagnosticsCreatedOnFirstRun = (Test-Path $diagnosticsPath)
  $report.syncStateCreatedOnFirstRun = (Test-Path $syncStatePath)
  if (-not $report.configCreatedOnFirstRun) {
    throw "Expected config file to be created on first backend start."
  }
  if (-not $report.diagnosticsCreatedOnFirstRun) {
    throw "Expected diagnostics log to be created on first backend start."
  }
  if ($report.syncStateCreatedOnFirstRun) {
    throw "Sync-state file should not exist before a display-config change."
  }

  $report.stateConfigPathMatched = ([System.IO.Path]::GetFullPath([string]$state.configPath) -eq [System.IO.Path]::GetFullPath($configPath))
  $report.stateSyncStatePathMatched = ([System.IO.Path]::GetFullPath([string]$state.syncStatePath) -eq [System.IO.Path]::GetFullPath($syncStatePath))
  $report.stateDiagnosticsPathMatched = ([System.IO.Path]::GetFullPath([string]$state.diagnosticsPath) -eq [System.IO.Path]::GetFullPath($diagnosticsPath))
  $report.stateConfigFileExistsOnFirstRun = [bool]$state.configFileExists
  $report.stateSyncStateFileExistsOnFirstRun = [bool]$state.syncStateFileExists
  $report.stateDiagnosticsFileExistsOnFirstRun = [bool]$state.diagnosticsFileExists
  $report.controlStreamDisconnectedOnFirstRun = (-not [bool]$state.controlStreamConnected)
  $report.lastControlStreamEventMissingOnFirstRun = [string]::IsNullOrWhiteSpace([string]$state.lastControlStreamEventAt)
  if (-not $report.stateConfigPathMatched -or -not $report.stateSyncStatePathMatched -or -not $report.stateDiagnosticsPathMatched) {
    throw "Backend state paths did not match the empty first-run config root."
  }
  if (-not $report.stateConfigFileExistsOnFirstRun -or $report.stateSyncStateFileExistsOnFirstRun -or -not $report.stateDiagnosticsFileExistsOnFirstRun) {
    throw "Backend state file-existence flags did not match the expected first-run artifact state."
  }
  if (-not $report.controlStreamDisconnectedOnFirstRun -or -not $report.lastControlStreamEventMissingOnFirstRun) {
    throw "Expected first-run control stream state to remain disconnected with no prior events."
  }

  $updatedConfig = @{
    connection = @{
      serverUrl = "http://127.0.0.1:4000"
      secret = "first-run-secret"
      deviceId = "first-run-device"
      hostname = "First Run Device"
    }
    sampling = @{
      normalIntervalSeconds = 15
      fastIntervalSeconds = 5
      slowIntervalSeconds = 30
      realtimeModeEnabled = $false
    }
    enabledMetrics = @("cpuUsage", "networkTraffic")
    enabledDeviceIds = @{
      network = @("nic-first")
    }
    instanceMetricConfig = @{}
    probeSelections = @(
      @{ target = "cpu"; provider = "builtin"; enabled = $true },
      @{ target = "network"; provider = "builtin"; enabled = $true }
    )
    cloudSyncEnabled = $true
    autoRestartCollector = $false
  }
  $updatedConfig | ConvertTo-Json -Depth 6 | Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json; charset=utf-8" -TimeoutSec 3 | Out-Null
  Start-Sleep -Milliseconds 300

  $updatedState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
  $report.syncStateCreatedAfterDisplayChange = (Test-Path $syncStatePath)
  $report.stateSyncStateFileExistsAfterDisplayChange = [bool]$updatedState.syncStateFileExists
  $report.cloudConfigPendingAfterDisplayChange = [bool]$updatedState.cloudConfigPending
  if (-not $report.syncStateCreatedAfterDisplayChange) {
    throw "Expected sync-state file after first local display-config change."
  }
  if (-not $report.stateSyncStateFileExistsAfterDisplayChange) {
    throw "Backend state did not report syncStateFileExists after first local display-config change."
  }
  if (-not $report.cloudConfigPendingAfterDisplayChange) {
    throw "Expected cloudConfigPending after first local display-config change."
  }
}
finally {
  if ($process -and -not $process.HasExited) {
    try {
      Invoke-RestMethod -Uri $shutdownUrl -Method Post -TimeoutSec 2 | Out-Null
      Start-Sleep -Milliseconds 500
    } catch {
    }

    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 300
    }
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8
}

Write-Host "First-run verifier passed."
Write-Host "Report: $resolvedReportPath"
