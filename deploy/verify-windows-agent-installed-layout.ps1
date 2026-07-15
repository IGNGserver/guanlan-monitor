param(
  [string]$InstallRoot = "",
  [string]$ConfigRoot = "",
  [string]$StartMenuProgramsRoot = "",
  [string]$DesktopRoot = "",
  [int]$ListenPort = 17981,
  [string]$ReportPath = "",
  [switch]$RequireConfigArtifacts,
  [switch]$RequireSyncStateAfterDisplayChange,
  [switch]$RequireDesktopShortcut,
  [switch]$RequireAutostartIntegration,
  [switch]$SkipBackendSmokeTest
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Resolve-OptionalPath {
  param(
    [string]$PathValue,
    [string]$FallbackPath
  )

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return [System.IO.Path]::GetFullPath($FallbackPath)
  }

  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }

  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $PathValue))
}

function Find-Uninstaller {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  return Get-ChildItem -LiteralPath $Root -Filter "unins*.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object Name |
    Select-Object -First 1
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedInstallRoot = Resolve-OptionalPath -PathValue $InstallRoot -FallbackPath (Join-Path $env:ProgramFiles "DeviceStateConsoleAgent")
$resolvedConfigRoot = Resolve-OptionalPath -PathValue $ConfigRoot -FallbackPath (Join-Path $env:LocalAppData "DeviceStateConsoleAgent")
$resolvedStartMenuProgramsRoot = Resolve-OptionalPath -PathValue $StartMenuProgramsRoot -FallbackPath ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonPrograms))
$resolvedDesktopRoot = Resolve-OptionalPath -PathValue $DesktopRoot -FallbackPath ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonDesktopDirectory))
$resolvedReportPath = Resolve-OptionalPath -PathValue $ReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-installed-layout-report.json")

$frontendExe = Join-Path $resolvedInstallRoot "DeviceStateConsoleAgent.WinUI.exe"
$backendDir = Join-Path $resolvedInstallRoot "backend"
$backendExe = Join-Path $backendDir "windows-agent-backend.exe"
$collectorExe = Join-Path $backendDir "device-state-console-agent.exe"
$hardwareDir = Join-Path $backendDir "windows-hardware"
$lhmDll = Join-Path $hardwareDir "librehardwaremonitor\LibreHardwareMonitorLib.dll"
$pawnInstaller = Join-Path $hardwareDir "pawnio\PawnIO_setup.exe"
$appDisplayName = ([string][char]0x89C2) + ([string][char]0x6F9C)
$startMenuShortcut = Join-Path $resolvedStartMenuProgramsRoot ("{0}.lnk" -f $appDisplayName)
$uninstallLabel = ([string][char]0x5378) + ([string][char]0x8F7D)
$startMenuUninstallShortcut = Join-Path $resolvedStartMenuProgramsRoot ("{0} DeviceStateConsoleAgent.lnk" -f $uninstallLabel)
$desktopShortcut = Join-Path $resolvedDesktopRoot ("{0}.lnk" -f $appDisplayName)
$runValueName = "DeviceStateConsoleAgent"
$runKeyPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
$runValueData = ""
if (Test-Path $runKeyPath) {
  try {
    $runValueData = [string](Get-ItemPropertyValue -Path $runKeyPath -Name $runValueName -ErrorAction Stop)
  } catch {
    $runValueData = ""
  }
}
$installConfigPath = Join-Path $resolvedInstallRoot "agent-ui.config.json"
$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$syncStatePath = Join-Path $resolvedConfigRoot "agent-ui.sync-state.json"
$diagnosticsPath = Join-Path $resolvedConfigRoot "agent-ui.backend.log"
$uninstaller = $null
if (Test-Path $resolvedInstallRoot) {
  $uninstaller = Find-Uninstaller -Root $resolvedInstallRoot
}

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  installRoot = $resolvedInstallRoot
  configRoot = $resolvedConfigRoot
  startMenuProgramsRoot = $resolvedStartMenuProgramsRoot
  desktopRoot = $resolvedDesktopRoot
  reportPath = $resolvedReportPath
  listenPort = $ListenPort
  requireConfigArtifacts = [bool]$RequireConfigArtifacts
  requireSyncStateAfterDisplayChange = [bool]$RequireSyncStateAfterDisplayChange
  requireDesktopShortcut = [bool]$RequireDesktopShortcut
  requireAutostartIntegration = [bool]$RequireAutostartIntegration
  checks = [ordered]@{
    installRootExists = (Test-Path $resolvedInstallRoot)
    frontendExeExists = (Test-Path $frontendExe)
    backendDirExists = (Test-Path $backendDir)
    backendExeExists = (Test-Path $backendExe)
    collectorExeExists = (Test-Path $collectorExe)
    hardwareDirExists = (Test-Path $hardwareDir)
    hardwareLhmExists = (Test-Path $lhmDll)
    hardwarePawnInstallerExists = (Test-Path $pawnInstaller)
    startMenuShortcutExists = (Test-Path $startMenuShortcut)
    startMenuUninstallShortcutExists = (Test-Path $startMenuUninstallShortcut)
    desktopShortcutExists = (Test-Path $desktopShortcut)
    startupRegistryValueExists = (-not [string]::IsNullOrWhiteSpace($runValueData))
    uninstallerExists = ($null -ne $uninstaller)
    installRootHasNoLocalConfig = (-not (Test-Path $installConfigPath))
    configRootExists = (Test-Path $resolvedConfigRoot)
    configFileExists = (Test-Path $configPath)
    diagnosticsFileExists = (Test-Path $diagnosticsPath)
    syncStateFileObserved = (Test-Path $syncStatePath)
  }
  observedPaths = [ordered]@{
    frontendExe = $frontendExe
    backendExe = $backendExe
    collectorExe = $collectorExe
    hardwareLhm = $lhmDll
    hardwarePawnInstaller = $pawnInstaller
    startMenuShortcut = $startMenuShortcut
    startMenuUninstallShortcut = $startMenuUninstallShortcut
    desktopShortcut = $desktopShortcut
    startupRegistryValue = $runValueData
    uninstaller = if ($uninstaller) { $uninstaller.FullName } else { "" }
    installConfigPath = $installConfigPath
    configPath = $configPath
    syncStatePath = $syncStatePath
    diagnosticsPath = $diagnosticsPath
  }
  backendSmokeTest = [ordered]@{
    attempted = (-not $SkipBackendSmokeTest)
    passed = $false
    stateEndpoint = ""
    configPath = ""
    syncStatePath = ""
    diagnosticsPath = ""
    connectionStatus = ""
    configMatchesLocalAppData = $false
    diagnosticsMatchLocalAppData = $false
    syncStateMatchesLocalAppData = $false
    configFileExistsReported = $false
    diagnosticsFileExistsReported = $false
    syncStateFileExistsReported = $false
    syncStateCreatedAfterDisplayChange = $false
    syncStateFileExistsReportedAfterDisplayChange = $false
    cloudConfigPendingAfterDisplayChange = $false
  }
}

$failedChecks = @(
  $report.checks.GetEnumerator() |
    Where-Object {
      if ($RequireConfigArtifacts) {
        if ($_.Key -eq "syncStateFileObserved") {
          return $false
        }
        return -not $_.Value
      }

      if ($_.Key -in @("configRootExists", "configFileExists", "diagnosticsFileExists", "syncStateFileObserved")) {
        return $false
      }

      if (-not $RequireDesktopShortcut -and $_.Key -eq "desktopShortcutExists") {
        return $false
      }

      if (-not $RequireAutostartIntegration -and $_.Key -eq "startupRegistryValueExists") {
        return $false
      }

      return -not $_.Value
    } |
    Select-Object -ExpandProperty Key
)

$process = $null
if (-not $SkipBackendSmokeTest -and $failedChecks.Count -eq 0) {
  $listenAddress = "127.0.0.1:$ListenPort"
  $stateUrl = "http://$listenAddress/api/state"
  $configUrl = "http://$listenAddress/api/config"
  $report.backendSmokeTest.stateEndpoint = $stateUrl

  try {
    $process = Start-Process -FilePath $backendExe `
      -ArgumentList @(
        "--listen", $listenAddress,
        "--bundle-root", ('"{0}"' -f $backendDir),
        "--config-root", ('"{0}"' -f $resolvedConfigRoot)
      ) `
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
      throw "Installed backend did not become reachable at $stateUrl"
    }

    $report.backendSmokeTest.configPath = [string]$state.configPath
    $report.backendSmokeTest.syncStatePath = [string]$state.syncStatePath
    $report.backendSmokeTest.diagnosticsPath = [string]$state.diagnosticsPath
    $report.backendSmokeTest.connectionStatus = [string]$state.connectionStatus
    $report.backendSmokeTest.configMatchesLocalAppData =
      ([System.IO.Path]::GetFullPath([string]$state.configPath) -eq [System.IO.Path]::GetFullPath($configPath))
    $report.backendSmokeTest.syncStateMatchesLocalAppData =
      ([System.IO.Path]::GetFullPath([string]$state.syncStatePath) -eq [System.IO.Path]::GetFullPath($syncStatePath))
    $report.backendSmokeTest.diagnosticsMatchLocalAppData =
      ([System.IO.Path]::GetFullPath([string]$state.diagnosticsPath) -eq [System.IO.Path]::GetFullPath($diagnosticsPath))
    $report.backendSmokeTest.configFileExistsReported = [bool]$state.configFileExists
    $report.backendSmokeTest.diagnosticsFileExistsReported = [bool]$state.diagnosticsFileExists
    $report.backendSmokeTest.syncStateFileExistsReported = [bool]$state.syncStateFileExists
    $report.backendSmokeTest.passed =
      $report.backendSmokeTest.configMatchesLocalAppData -and
      $report.backendSmokeTest.syncStateMatchesLocalAppData -and
      $report.backendSmokeTest.diagnosticsMatchLocalAppData -and
      (
        (-not $RequireConfigArtifacts) -or
        (
          $report.backendSmokeTest.configFileExistsReported -and
          $report.backendSmokeTest.diagnosticsFileExistsReported
        )
      )

    if ($RequireConfigArtifacts) {
      if (-not $report.backendSmokeTest.configFileExistsReported) {
        $failedChecks += "backendSmokeTest.configFileExistsReported"
      }
      if (-not $report.backendSmokeTest.diagnosticsFileExistsReported) {
        $failedChecks += "backendSmokeTest.diagnosticsFileExistsReported"
      }
      if ($report.checks.syncStateFileObserved -and -not $report.backendSmokeTest.syncStateFileExistsReported) {
        $failedChecks += "backendSmokeTest.syncStateFileExistsReported"
      }
    }

    if ($RequireSyncStateAfterDisplayChange) {
      $currentConfig = Invoke-RestMethod -Uri $configUrl -Method Get -TimeoutSec 2
      $enabledMetrics = @($currentConfig.enabledMetrics)
      if ($enabledMetrics.Count -eq 0) {
        $enabledMetrics = @("cpuUsage")
      }
      $enabledDeviceIds = @{}
      foreach ($property in $currentConfig.enabledDeviceIds.PSObject.Properties) {
        $enabledDeviceIds[$property.Name] = @($property.Value)
      }
      if (-not $enabledDeviceIds.ContainsKey("network")) {
        $enabledDeviceIds["network"] = @()
      }

      $marker = "installed-layout-" + [Guid]::NewGuid().ToString("N")
      $networkIds = [System.Collections.Generic.List[string]]::new()
      foreach ($value in @($enabledDeviceIds["network"])) {
        $networkIds.Add([string]$value) | Out-Null
      }
      $networkIds.Add($marker) | Out-Null
      $enabledDeviceIds["network"] = @($networkIds)

      $updatedConfig = [ordered]@{
        connection = $currentConfig.connection
        sampling = $currentConfig.sampling
        enabledMetrics = $enabledMetrics
        enabledDeviceIds = $enabledDeviceIds
        instanceMetricConfig = $currentConfig.instanceMetricConfig
        probeSelections = $currentConfig.probeSelections
        cloudSyncEnabled = [bool]$currentConfig.cloudSyncEnabled
        autoRestartCollector = [bool]$currentConfig.autoRestartCollector
      }

      $updatedConfig | ConvertTo-Json -Depth 8 | Invoke-RestMethod -Uri $configUrl -Method Put -ContentType "application/json; charset=utf-8" -TimeoutSec 3 | Out-Null
      Start-Sleep -Milliseconds 300

      $updatedState = Invoke-RestMethod -Uri $stateUrl -Method Get -TimeoutSec 2
      $report.backendSmokeTest.syncStateCreatedAfterDisplayChange = (Test-Path $syncStatePath)
      $report.backendSmokeTest.syncStateFileExistsReportedAfterDisplayChange = [bool]$updatedState.syncStateFileExists
      $report.backendSmokeTest.cloudConfigPendingAfterDisplayChange = [bool]$updatedState.cloudConfigPending

      if (-not $report.backendSmokeTest.syncStateCreatedAfterDisplayChange) {
        $failedChecks += "backendSmokeTest.syncStateCreatedAfterDisplayChange"
      }
      if (-not $report.backendSmokeTest.syncStateFileExistsReportedAfterDisplayChange) {
        $failedChecks += "backendSmokeTest.syncStateFileExistsReportedAfterDisplayChange"
      }
      if (-not $report.backendSmokeTest.cloudConfigPendingAfterDisplayChange) {
        $failedChecks += "backendSmokeTest.cloudConfigPendingAfterDisplayChange"
      }
    }

    if (-not $report.backendSmokeTest.passed) {
      $failedChecks += "backendSmokeTest"
    }
  } finally {
    if ($process) {
      try {
        if (-not $process.HasExited) {
          Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
      } catch {
      }
    }
  }
}

$failedChecks = $failedChecks | Select-Object -Unique
if ($failedChecks.Count -gt 0) {
  $report.failedChecks = $failedChecks
}

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8

if ($failedChecks.Count -gt 0) {
  throw "Installed layout verification failed: $($failedChecks -join ', ')"
}

Write-Host "Installed layout verification passed."
Write-Host "Report: $resolvedReportPath"
