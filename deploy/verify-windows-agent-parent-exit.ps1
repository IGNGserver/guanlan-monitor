param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$ListenPort = 17971,
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-parent-exit"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-parent-exit-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath($resolvedConfigRoot)

$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-parent-exit-report.json"
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
$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
@{
  connection = @{
    serverUrl = "http://127.0.0.1:1"
    secret = "stub-secret"
    deviceId = "parent-exit-test"
    hostname = "Parent Exit Test"
  }
  sampling = @{
    normalIntervalSeconds = 15
    fastIntervalSeconds = 5
    slowIntervalSeconds = 30
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
$startUrl = "http://$listenAddress/api/control/start"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  listenPort = $ListenPort
  parentProcessPid = $null
  backendReachable = $false
  collectorStarted = $false
  collectorPid = $null
  backendExitedAfterParent = $false
  collectorExitedWithBackend = $false
}

$frontendStub = $null
$process = $null
try {
  $frontendStub = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-Command", "Start-Sleep -Seconds 120") `
    -WindowStyle Hidden `
    -PassThru
  $report.parentProcessPid = $frontendStub.Id

  $process = Start-Process -FilePath $backendExe `
    -ArgumentList @("--listen", $listenAddress, "--bundle-root", $backendDir, "--config-root", $resolvedConfigRoot, "--parent-pid", $frontendStub.Id) `
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

  Invoke-RestMethod -Uri $startUrl -Method Post -TimeoutSec 3 | Out-Null

  $collectorProcess = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 300
    $collectorProcess = Get-Process -Name "device-state-console-agent" -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $collectorExe } |
      Select-Object -First 1
    if ($collectorProcess) {
      break
    }
  }

  if (-not $collectorProcess) {
    throw "Collector process was not observed for $collectorExe"
  }

  $report.collectorStarted = $true
  $report.collectorPid = $collectorProcess.Id

  Stop-Process -Id $frontendStub.Id -Force -ErrorAction Stop
  $frontendStub = $null

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 250
    $backendAlive = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if (-not $backendAlive) {
      $report.backendExitedAfterParent = $true
      break
    }
  }

  if (-not $report.backendExitedAfterParent) {
    throw "Backend stayed alive after the frontend parent process exited."
  }

  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    $matching = Get-Process -Name "device-state-console-agent" -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $collectorExe }
    if (-not $matching) {
      $report.collectorExitedWithBackend = $true
      break
    }
    $stillRunning = $true
  }

  if (-not $report.collectorExitedWithBackend) {
    throw "Collector stayed alive after backend exited with its frontend parent."
  }
} finally {
  if ($frontendStub) {
    Stop-Process -Id $frontendStub.Id -Force -ErrorAction SilentlyContinue
  }
  Get-Process -Name "device-state-console-agent","windows-agent-backend" -ErrorAction SilentlyContinue |
    Where-Object {
      try {
        $_.Path -and [System.IO.Path]::GetFullPath($_.Path).StartsWith($resolvedBundleRoot, [System.StringComparison]::OrdinalIgnoreCase)
      } catch {
        $false
      }
    } |
    Stop-Process -Force -ErrorAction SilentlyContinue

  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8
  Write-Host "Report: $resolvedReportPath"
}

Write-Host "Frontend-parent exit verification passed."
Write-Host "Collector pid: $($report.collectorPid)"
