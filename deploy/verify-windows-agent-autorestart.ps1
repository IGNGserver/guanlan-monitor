param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$ListenPort = 17931,
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-autorestart"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-autorestart-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath($resolvedConfigRoot)

$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-autorestart-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
$collectorExe = Join-Path $backendDir "device-state-console-agent.exe"

if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}
if (-not (Test-Path $collectorExe)) {
  throw "Missing collector executable: $collectorExe"
}

New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null
$listenAddress = "127.0.0.1:$ListenPort"
$stateUrl = "http://$listenAddress/api/state"
$startUrl = "http://$listenAddress/api/control/start"
$shutdownUrl = "http://$listenAddress/api/control/shutdown"
$stubSource = Join-Path $resolvedConfigRoot "stub-collector.go"
$stubExe = Join-Path $resolvedConfigRoot "device-state-console-agent.exe"

$stubProgram = @'
package main

import (
  "fmt"
  "os"
)

func main() {
  fmt.Println("stub collector starting")
  os.Exit(7)
}
'@

Set-Content -LiteralPath $stubSource -Value $stubProgram -Encoding UTF8
$goCommand = (Get-Command go -ErrorAction Stop).Source
& $goCommand build -o $stubExe $stubSource

$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$config = @{
  connection = @{
    serverUrl = "http://127.0.0.1:4000"
    secret = "stub-secret"
    deviceId = "autorestart-test"
    hostname = "Auto Restart Test"
  }
  sampling = @{
    fastIntervalSeconds = 5
    slowIntervalSeconds = 30
  }
  enabledMetrics = @("cpuUsage")
  enabledDeviceIds = @{}
  instanceMetricConfig = @{}
  probeSelections = @(
    @{
      target = "cpu"
      provider = "builtin"
      enabled = $true
    }
  )
  cloudSyncEnabled = $true
  autoRestartCollector = $true
}
$config | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $configPath -Encoding UTF8

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  backendExe = $backendExe
  stubCollectorExe = $stubExe
  diagnosticsPath = ""
  listenPort = $ListenPort
  startAttempted = $false
  backendReachable = $false
  autoRestartObserved = $false
  diagnosticsObserved = $false
  restartCount = 0
  lastExitCode = $null
  connectionStatus = ""
  lastChildLog = ""
}

$process = $null
try {
  $process = Start-Process -FilePath $backendExe `
    -ArgumentList @("--listen", $listenAddress, "--bundle-root", $resolvedConfigRoot, "--config-root", $resolvedConfigRoot) `
    -WorkingDirectory $resolvedConfigRoot `
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

  Invoke-RestMethod -Uri $startUrl -Method Post -TimeoutSec 3 | Out-Null
  $report.startAttempted = $true

  $observedState = $null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $observedState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      if ($observedState.restartCount -ge 1 -and $observedState.lastExitCode -eq 7) {
        break
      }
    } catch {
    }
  }

  if (-not $observedState) {
    throw "Backend state could not be read after start."
  }

  $report.restartCount = [int]$observedState.restartCount
  $report.diagnosticsPath = [string]$observedState.diagnosticsPath
  if ($null -ne $observedState.lastExitCode) {
    $report.lastExitCode = [int]$observedState.lastExitCode
  }
  $report.connectionStatus = [string]$observedState.connectionStatus
  $report.lastChildLog = [string]$observedState.lastChildLog
  $report.autoRestartObserved = ($report.restartCount -ge 1 -and $report.lastExitCode -eq 7)
  if (-not [string]::IsNullOrWhiteSpace($report.diagnosticsPath) -and (Test-Path $report.diagnosticsPath)) {
    $diagnosticText = Get-Content -LiteralPath $report.diagnosticsPath -Raw -ErrorAction SilentlyContinue
    if ($diagnosticText -match "exitCode=7|exited with code 7") {
      $report.diagnosticsObserved = $true
    }
  }

  if (-not $report.autoRestartObserved) {
    throw "Auto restart was not observed. restartCount=$($report.restartCount), lastExitCode=$($report.lastExitCode)"
  }
  if (-not $report.diagnosticsObserved) {
    throw "Diagnostic log was not observed or did not contain exit details. diagnosticsPath=$($report.diagnosticsPath)"
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

Write-Host "Auto restart verification passed."
Write-Host "Restart count: $($report.restartCount)"
Write-Host "Last exit code: $($report.lastExitCode)"
Write-Host "Diagnostics path: $($report.diagnosticsPath)"
