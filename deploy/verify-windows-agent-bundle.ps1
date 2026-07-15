param(
  [string]$BundleRoot = "",
  [string]$ConfigRoot = "",
  [int]$ListenPort = 17911,
  [string]$ReportPath = "",
  [switch]$SkipBackendSmokeTest
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
  $defaultVerifyBundleRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-bundle"
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $defaultVerifyBundleRoot | Out-Null
  $resolvedBundleRoot = $defaultVerifyBundleRoot
}
$resolvedBundleRoot = [System.IO.Path]::GetFullPath($resolvedBundleRoot)

$resolvedConfigRoot = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ConfigRoot
if (-not $resolvedConfigRoot) {
  $resolvedConfigRoot = Join-Path $repoRoot ".codex-artifacts\verify-agent-config"
}
$resolvedConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedConfigRoot ("run-" + $ListenPort)))
$resolvedReportPath = Resolve-BundlePath -RepoRoot $repoRoot -PathValue $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-bundle-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$backendDir = Join-Path $resolvedBundleRoot "backend"
$frontendExe = Join-Path $resolvedBundleRoot "DeviceStateConsoleAgent.WinUI.exe"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
$collectorExe = Join-Path $backendDir "device-state-console-agent.exe"
$hardwareDir = Join-Path $backendDir "windows-hardware"
$lhmDll = Join-Path $hardwareDir "librehardwaremonitor\LibreHardwareMonitorLib.dll"
$pawnInstaller = Join-Path $hardwareDir "pawnio\PawnIO_setup.exe"
$dotnetRuntimeInstaller = Join-Path $resolvedBundleRoot "runtime\windowsdesktop-runtime-win-x64.exe"
$launcherScript = Join-Path $resolvedBundleRoot "start-agent.ps1"

$requiredPaths = @(
  $resolvedBundleRoot,
  $backendDir,
  $frontendExe,
  $backendExe,
  $collectorExe,
  $hardwareDir,
  $lhmDll,
  $pawnInstaller,
  $dotnetRuntimeInstaller,
  $launcherScript
)

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  bundleRoot = $resolvedBundleRoot
  configRoot = $resolvedConfigRoot
  reportPath = $resolvedReportPath
  listenPort = $ListenPort
  files = [ordered]@{}
  backendSmokeTest = [ordered]@{
    attempted = (-not $SkipBackendSmokeTest)
    passed = $false
    stateEndpoint = ""
    configPath = ""
    rawConfigPath = ""
    syncStatePath = ""
    rawSyncStatePath = ""
    diagnosticsPath = ""
    rawDiagnosticsPath = ""
    connectionStatus = ""
    configFileExists = $false
    syncStateFileExists = $false
    diagnosticsFileExists = $false
    cloudConfigPending = $false
  }
}

foreach ($path in $requiredPaths) {
  if (-not (Test-Path $path)) {
    throw "Missing required bundle asset: $path"
  }
  $report.files[$path] = [ordered]@{
    exists = $true
    type = if ((Get-Item $path) -is [System.IO.DirectoryInfo]) { "directory" } else { "file" }
  }
}

foreach ($path in @($frontendExe, $backendExe, $collectorExe, $lhmDll, $pawnInstaller)) {
  if (Test-Path $path) {
    $hash = Get-FileHash -LiteralPath $path -Algorithm SHA256
    $report.files[$path].sha256 = $hash.Hash
    $report.files[$path].length = (Get-Item $path).Length
  }
}

$launcherContent = Get-Content -LiteralPath $launcherScript -Raw
$report.files[$launcherScript] = [ordered]@{
  exists = $true
  type = "file"
  referencesRemovedWindowsAppRuntimeInstaller = (-not $launcherContent.Contains("install-windows-app-runtime.ps1"))
}
if (-not $report.files[$launcherScript].referencesRemovedWindowsAppRuntimeInstaller) {
  throw "Launcher script still references removed Windows App Runtime installer: $launcherScript"
}

Write-Host "Bundle layout looks valid."
Write-Host "Bundle root: $resolvedBundleRoot"
Write-Host "Backend dir: $backendDir"

if ($SkipBackendSmokeTest) {
  Write-Host "Skipped backend smoke test."
  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
  $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $resolvedReportPath
  Write-Host "Report: $resolvedReportPath"
  exit 0
}

if (Test-Path $resolvedConfigRoot) {
  Remove-Item -LiteralPath $resolvedConfigRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedConfigRoot | Out-Null
$listenAddress = "127.0.0.1:$ListenPort"
$expectedConfigPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$expectedSyncStatePath = Join-Path $resolvedConfigRoot "agent-ui.sync-state.json"
$expectedDiagnosticsPath = Join-Path $resolvedConfigRoot "agent-ui.backend.log"
$process = $null

try {
  $process = Start-Process -FilePath $backendExe `
    -ArgumentList @("--listen", $listenAddress, "--bundle-root", $backendDir, "--config-root", $resolvedConfigRoot) `
    -WorkingDirectory $backendDir `
    -WindowStyle Hidden `
    -PassThru

  $stateUrl = "http://$listenAddress/api/state"
  $state = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $state = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      break
    } catch {
    }
  }

  if (-not $state) {
    throw "Local backend did not become reachable at $stateUrl"
  }

  if (-not $state.configPath) {
    throw "Backend responded but configPath was empty."
  }
  if (-not $state.syncStatePath) {
    throw "Backend responded but syncStatePath was empty."
  }
  if (-not $state.diagnosticsPath) {
    throw "Backend responded but diagnosticsPath was empty."
  }

  $rawConfigPath = [string]$state.configPath
  $rawSyncStatePath = [string]$state.syncStatePath
  $rawDiagnosticsPath = [string]$state.diagnosticsPath

  if ([System.IO.Path]::GetFullPath($rawConfigPath) -ne [System.IO.Path]::GetFullPath($expectedConfigPath)) {
    throw "Backend configPath did not match the requested config root."
  }
  if ([System.IO.Path]::GetFullPath($rawSyncStatePath) -ne [System.IO.Path]::GetFullPath($expectedSyncStatePath)) {
    throw "Backend syncStatePath did not match the requested config root."
  }
  if ([System.IO.Path]::GetFullPath($rawDiagnosticsPath) -ne [System.IO.Path]::GetFullPath($expectedDiagnosticsPath)) {
    throw "Backend diagnosticsPath did not match the requested config root."
  }

  if (-not (Test-Path $expectedConfigPath)) {
    throw "Expected config file was not created."
  }
  if (-not (Test-Path $expectedDiagnosticsPath)) {
    throw "Expected diagnostics log was not created."
  }
  if (-not [bool]$state.configFileExists) {
    throw "Backend state did not report configFileExists on first start."
  }
  if ([bool]$state.syncStateFileExists) {
    throw "Backend state should not report syncStateFileExists before a display-config change."
  }
  if (-not [bool]$state.diagnosticsFileExists) {
    throw "Backend state did not report diagnosticsFileExists on first start."
  }

  $updatedConfig = @{
    connection = @{
      serverUrl = "http://127.0.0.1:4000"
      secret = "bundle-test-secret"
      deviceId = "bundle-test"
      hostname = "Bundle Test"
    }
    sampling = @{
      normalIntervalSeconds = 15
      fastIntervalSeconds = 5
      slowIntervalSeconds = 30
      realtimeModeEnabled = $false
    }
    enabledMetrics = @("cpuUsage", "networkTraffic")
    enabledDeviceIds = @{
      network = @("nic-1")
    }
    instanceMetricConfig = @{}
    probeSelections = @(
      @{ target = "cpu"; provider = "builtin"; enabled = $true },
      @{ target = "network"; provider = "builtin"; enabled = $true }
    )
    cloudSyncEnabled = $true
    autoRestartCollector = $false
  }
  $configUrl = "http://$listenAddress/api/config"
  $updatedConfig | ConvertTo-Json -Depth 6 | Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json; charset=utf-8" -TimeoutSec 3 | Out-Null
  Start-Sleep -Milliseconds 300

  $updatedState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
  if (-not $updatedState.cloudConfigPending) {
    throw "Expected cloudConfigPending after local display-config change."
  }
  if (-not (Test-Path $expectedSyncStatePath)) {
    throw "Expected sync-state file was not created after local display-config change."
  }
  if (-not [bool]$updatedState.syncStateFileExists) {
    throw "Backend state did not report syncStateFileExists after local display-config change."
  }

  $report.backendSmokeTest.passed = $true
  $report.backendSmokeTest.stateEndpoint = $stateUrl
  $report.backendSmokeTest.configPath = $expectedConfigPath
  $report.backendSmokeTest.rawConfigPath = $rawConfigPath
  $report.backendSmokeTest.syncStatePath = $expectedSyncStatePath
  $report.backendSmokeTest.rawSyncStatePath = $rawSyncStatePath
  $report.backendSmokeTest.diagnosticsPath = $expectedDiagnosticsPath
  $report.backendSmokeTest.rawDiagnosticsPath = $rawDiagnosticsPath
  $report.backendSmokeTest.connectionStatus = [string]$state.connectionStatus
  $report.backendSmokeTest.configFileExists = [bool]$updatedState.configFileExists
  $report.backendSmokeTest.syncStateFileExists = [bool]$updatedState.syncStateFileExists
  $report.backendSmokeTest.diagnosticsFileExists = [bool]$updatedState.diagnosticsFileExists
  $report.backendSmokeTest.cloudConfigPending = [bool]$updatedState.cloudConfigPending

  Write-Host "Backend smoke test passed."
  Write-Host "State endpoint: $stateUrl"
  Write-Host "Config path: $expectedConfigPath"
  Write-Host "Sync-state path: $expectedSyncStatePath"
  Write-Host "Diagnostics path: $expectedDiagnosticsPath"
  Write-Host "Connection status: $($state.connectionStatus)"
} finally {
  if ($process -and -not $process.HasExited) {
    try {
      Invoke-RestMethod -Uri "http://$listenAddress/api/control/shutdown" -Method Post -TimeoutSec 2 | Out-Null
      Start-Sleep -Milliseconds 600
    } catch {
    }

    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 300
    }
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
  $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $resolvedReportPath
  Write-Host "Report: $resolvedReportPath"
}
