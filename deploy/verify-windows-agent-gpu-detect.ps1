param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$BackendPort = 18091,
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-gpu-detect"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-gpu-detect-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $BackendPort)))
if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null

$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-gpu-detect-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
if (-not (Test-Path $backendExe)) {
  throw "Missing backend executable: $backendExe"
}

$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
@{
  connection = @{
    serverUrl = "http://127.0.0.1:4000"
    secret = "stub-secret"
    deviceId = "gpu-detect-test"
    hostname = "GPU Detect Test"
  }
  sampling = @{
    normalIntervalSeconds = 15
    fastIntervalSeconds = 5
    slowIntervalSeconds = 30
    realtimeModeEnabled = $false
  }
  enabledMetrics = @(
    "cpuUsage",
    "gpuUsage",
    "gpuMemory",
    "gpuTemperature"
  )
  enabledDeviceIds = @{}
  instanceMetricConfig = @{}
  probeSelections = @(
    @{ target = "cpu"; provider = "builtin"; enabled = $true },
    @{ target = "memory"; provider = "builtin"; enabled = $true },
    @{ target = "disk"; provider = "builtin"; enabled = $true },
    @{ target = "network"; provider = "builtin"; enabled = $true },
    @{ target = "gpu"; provider = "builtin"; enabled = $true },
    @{ target = "fan"; provider = "disabled"; enabled = $false }
  )
  cloudSyncEnabled = $false
  autoRestartCollector = $false
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding UTF8

$backendListenAddress = "127.0.0.1:$BackendPort"
$stateUrl = "http://$backendListenAddress/api/state"
$detectUrl = "http://$backendListenAddress/api/probes/detect"
$configUrl = "http://$backendListenAddress/api/config"
$shutdownUrl = "http://$backendListenAddress/api/control/shutdown"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  backendPort = $BackendPort
  backendReachable = $false
  machineGpuQuerySucceeded = $false
  machineGpuCount = 0
  gpuProviderBuiltinAvailable = $false
  gpuProviderDisabledAvailable = $false
  gpuTargetPresent = $false
  gpuInstanceCount = 0
  firstGpuId = ""
  selectionPersisted = $false
  redetectSelectionObserved = $false
}

$process = $null
try {
  $process = Start-Process -FilePath $backendExe `
    -ArgumentList @("--listen", $backendListenAddress, "--bundle-root", $backendDir, "--config-root", $resolvedConfigRoot) `
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

  try {
    $machineGpuRows = @(Get-CimInstance Win32_VideoController -ErrorAction Stop)
    $report.machineGpuQuerySucceeded = $true
    $report.machineGpuCount = $machineGpuRows.Count
  } catch {
    $report.machineGpuQuerySucceeded = $false
    $report.machineGpuCount = 0
  }

  $detectResponse = Invoke-RestMethod -Uri $detectUrl -Method Post -TimeoutSec 5
  $gpuProvider = $detectResponse.providers | Where-Object { $_.target -eq "gpu" } | Select-Object -First 1
  $gpuTarget = $detectResponse.detectedTargets | Where-Object { $_.target -eq "gpu" } | Select-Object -First 1

  if ($gpuProvider) {
    $providerNames = @($gpuProvider.providers)
    $report.gpuProviderBuiltinAvailable = ($providerNames -contains "builtin")
    $report.gpuProviderDisabledAvailable = ($providerNames -contains "disabled")
  }

  if ($gpuTarget) {
    $report.gpuTargetPresent = $true
    $gpuInstances = @($gpuTarget.instances)
    $report.gpuInstanceCount = $gpuInstances.Count
    if ($gpuInstances.Count -gt 0) {
      $report.firstGpuId = [string]$gpuInstances[0].id
    }
  }

  if (-not $report.gpuProviderBuiltinAvailable -or -not $report.gpuProviderDisabledAvailable) {
    throw "GPU providers did not expose both builtin and disabled options."
  }

  if (-not $report.gpuTargetPresent) {
    throw "Probe detection did not return a gpu target."
  }

  if ($report.machineGpuQuerySucceeded -and $report.machineGpuCount -gt 0 -and $report.gpuInstanceCount -lt 1) {
    throw "This machine reports GPU adapters, but probe detection returned no GPU instances."
  }

  if ($report.gpuInstanceCount -gt 0) {
    $updatedConfig = $state.config
    $updatedConfig.enabledDeviceIds = @{
      gpu = @([string]$report.firstGpuId)
    }
    $updatedConfig.probeSelections = @(
      @{ target = "cpu"; provider = "builtin"; enabled = $true },
      @{ target = "memory"; provider = "builtin"; enabled = $true },
      @{ target = "disk"; provider = "builtin"; enabled = $true },
      @{ target = "network"; provider = "builtin"; enabled = $true },
      @{ target = "gpu"; provider = "builtin"; enabled = $true },
      @{ target = "fan"; provider = "disabled"; enabled = $false }
    )

    Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json" -Body ($updatedConfig | ConvertTo-Json -Depth 12) -TimeoutSec 5 | Out-Null

    $updatedState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 3
    $selectedGpuIds = @($updatedState.config.enabledDeviceIds.gpu)
    $report.selectionPersisted = ($selectedGpuIds.Count -eq 1 -and [string]$selectedGpuIds[0] -eq [string]$report.firstGpuId)

    $redetectResponse = Invoke-RestMethod -Uri $detectUrl -Method Post -TimeoutSec 5
    $redetectGpuTarget = $redetectResponse.detectedTargets | Where-Object { $_.target -eq "gpu" } | Select-Object -First 1
    if ($redetectGpuTarget) {
      $matchingGpu = @($redetectGpuTarget.instances | Where-Object { [string]$_.id -eq [string]$report.firstGpuId })
      if ($matchingGpu.Count -eq 1) {
        $report.redetectSelectionObserved = [bool]$matchingGpu[0].enabled
      }
    }

    if (-not $report.selectionPersisted) {
      throw "GPU enabledDeviceIds selection did not persist through backend config save."
    }
    if (-not $report.redetectSelectionObserved) {
      throw "GPU instance selection was not reflected by a follow-up probe detection result."
    }
  }
}
finally {
  try {
    Invoke-RestMethod -Uri $shutdownUrl -Method Post -TimeoutSec 2 | Out-Null
  } catch {
  }

  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8

Write-Host "GPU detect verification passed."
Write-Host "Report: $resolvedReportPath"
