param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$ListenPort = 17951,
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-realtime"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-realtime-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath($resolvedConfigRoot)

$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-realtime-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null
$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
@{
  connection = @{
    serverUrl = "http://127.0.0.1:4000"
    secret = "stub-secret"
    deviceId = "realtime-mode-test"
    hostname = "Realtime Mode Test"
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

$listenAddress = "127.0.0.1:$ListenPort"
$stateUrl = "http://$listenAddress/api/state"
$realtimeUrl = "http://$listenAddress/api/control/realtime"
$shutdownUrl = "http://$listenAddress/api/control/shutdown"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  backendExe = $backendExe
  listenPort = $ListenPort
  backendReachable = $false
  baselineRealtimeMode = $false
  baselineEffectiveIntervalSeconds = 0
  toggledRealtimeMode = $false
  toggledEffectiveIntervalSeconds = 0
  toggledRealtimeExpiresAt = ""
  toggleObserved = $false
  revertedRealtimeMode = $false
  revertedEffectiveIntervalSeconds = 0
  autoRevertObserved = $false
}

$process = $null
try {
  $process = Start-Process -FilePath $backendExe `
    -ArgumentList @("--listen", $listenAddress, "--bundle-root", $backendDir, "--config-root", $resolvedConfigRoot) `
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
  $report.baselineEffectiveIntervalSeconds = [int]$baselineState.effectiveUploadIntervalSeconds

  @{ enabled = $true; durationSeconds = 3 } | ConvertTo-Json | Invoke-RestMethod -Uri $realtimeUrl -Method Post -ContentType "application/json" -TimeoutSec 3 | Out-Null

  $toggledState = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $toggledState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ($toggledState.realtimeModeEnabled -and [int]$toggledState.effectiveUploadIntervalSeconds -eq 5) {
        break
      }
    } catch {
    }
  }

  if (-not $toggledState) {
    throw "Realtime mode state was not observable after toggle."
  }

  $report.toggledRealtimeMode = [bool]$toggledState.realtimeModeEnabled
  $report.toggledEffectiveIntervalSeconds = [int]$toggledState.effectiveUploadIntervalSeconds
  $report.toggledRealtimeExpiresAt = [string]$toggledState.realtimeModeExpiresAt
  $report.toggleObserved = ($report.baselineRealtimeMode -eq $false -and $report.baselineEffectiveIntervalSeconds -eq 15 -and $report.toggledRealtimeMode -eq $true -and $report.toggledEffectiveIntervalSeconds -eq 5 -and -not [string]::IsNullOrWhiteSpace($report.toggledRealtimeExpiresAt))

  if (-not $report.toggleObserved) {
    throw "Realtime mode toggle was not observed."
  }

  $revertedState = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
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
    throw "Realtime mode did not revert back to normal mode."
  }

  $report.revertedRealtimeMode = [bool]$revertedState.realtimeModeEnabled
  $report.revertedEffectiveIntervalSeconds = [int]$revertedState.effectiveUploadIntervalSeconds
  $report.autoRevertObserved = (-not $report.revertedRealtimeMode -and $report.revertedEffectiveIntervalSeconds -eq 15)

  if (-not $report.autoRevertObserved) {
    throw "Realtime mode auto revert was not observed."
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

  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8
  Write-Host "Report: $resolvedReportPath"
}

Write-Host "Realtime mode verification passed."
Write-Host "Baseline interval: $($report.baselineEffectiveIntervalSeconds)"
Write-Host "Realtime interval: $($report.toggledEffectiveIntervalSeconds)"
Write-Host "Reverted interval: $($report.revertedEffectiveIntervalSeconds)"
