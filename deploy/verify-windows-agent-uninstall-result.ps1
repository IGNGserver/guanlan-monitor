param(
  [string]$InstallRoot = "",
  [string]$ConfigRoot = "",
  [string]$StartMenuProgramsRoot = "",
  [string]$DesktopRoot = "",
  [ValidateSet("retained", "deleted")]
  [string]$ConfigExpectation = "retained",
  [switch]$RequireDesktopShortcutRemoved,
  [switch]$RequireAutostartRemoved,
  [string]$ReportPath = ""
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

function Test-RunningProcessUnderRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath
  )

  if (-not (Test-Path $RootPath)) {
    return $false
  }

  $normalizedRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd('\') + '\'
  $targets = @("DeviceStateConsoleAgent.WinUI", "windows-agent-backend", "device-state-console-agent")

  foreach ($name in $targets) {
    $matches = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object {
      try {
        $_.Path -and [System.IO.Path]::GetFullPath($_.Path).StartsWith($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)
      } catch {
        $false
      }
    }
    if ($matches) {
      return $true
    }
  }

  return $false
}

function Find-UninstallRegistryEntries {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DisplayName
  )

  $roots = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )

  $result = @()
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) {
      continue
    }

    $result += Get-ChildItem -Path $root -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $item = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop
        if ($item.DisplayName -eq $DisplayName) {
          [pscustomobject]@{
            KeyPath = $_.PSPath
            DisplayName = [string]$item.DisplayName
            InstallLocation = [string]$item.InstallLocation
            UninstallString = [string]$item.UninstallString
          }
        }
      } catch {
      }
    }
  }

  return @($result)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedInstallRoot = Resolve-OptionalPath -PathValue $InstallRoot -FallbackPath (Join-Path $env:ProgramFiles "DeviceStateConsoleAgent")
$resolvedConfigRoot = Resolve-OptionalPath -PathValue $ConfigRoot -FallbackPath (Join-Path $env:LocalAppData "DeviceStateConsoleAgent")
$resolvedStartMenuProgramsRoot = Resolve-OptionalPath -PathValue $StartMenuProgramsRoot -FallbackPath ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonPrograms))
$resolvedDesktopRoot = Resolve-OptionalPath -PathValue $DesktopRoot -FallbackPath ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonDesktopDirectory))
$resolvedReportPath = Resolve-OptionalPath -PathValue $ReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-uninstall-result-report.json")

$appDisplayName = ([string][char]0x89C2) + ([string][char]0x6F9C)
$startMenuShortcut = Join-Path $resolvedStartMenuProgramsRoot ("{0}.lnk" -f $appDisplayName)
$uninstallLabel = ([string][char]0x5378) + ([string][char]0x8F7D)
$startMenuUninstallShortcut = Join-Path $resolvedStartMenuProgramsRoot ("{0} DeviceStateConsoleAgent.lnk" -f $uninstallLabel)
$desktopShortcut = Join-Path $resolvedDesktopRoot ("{0}.lnk" -f $appDisplayName)
$runKeyPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
$runValueName = "DeviceStateConsoleAgent"
$runValueExists = $false
if (Test-Path $runKeyPath) {
  try {
    $null = Get-ItemPropertyValue -Path $runKeyPath -Name $runValueName -ErrorAction Stop
    $runValueExists = $true
  } catch {
    $runValueExists = $false
  }
}
$configPath = Join-Path $resolvedConfigRoot "agent-ui.config.json"
$syncStatePath = Join-Path $resolvedConfigRoot "agent-ui.sync-state.json"
$diagnosticsPath = Join-Path $resolvedConfigRoot "agent-ui.backend.log"
$registryEntries = Find-UninstallRegistryEntries -DisplayName "DeviceStateConsoleAgent"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  installRoot = $resolvedInstallRoot
  configRoot = $resolvedConfigRoot
  startMenuProgramsRoot = $resolvedStartMenuProgramsRoot
  desktopRoot = $resolvedDesktopRoot
  configExpectation = $ConfigExpectation
  reportPath = $resolvedReportPath
  checks = [ordered]@{
    installRootRemoved = (-not (Test-Path $resolvedInstallRoot))
    startMenuShortcutRemoved = (-not (Test-Path $startMenuShortcut))
    startMenuUninstallShortcutRemoved = (-not (Test-Path $startMenuUninstallShortcut))
    desktopShortcutRemoved = (-not (Test-Path $desktopShortcut))
    startupRegistryValueRemoved = (-not $runValueExists)
    noInstalledProcessRunning = (-not (Test-RunningProcessUnderRoot -RootPath $resolvedInstallRoot))
    uninstallRegistryEntryRemoved = ($registryEntries.Count -eq 0)
    configRootStateMatchesExpectation = $false
  }
  observedState = [ordered]@{
    installRootExists = (Test-Path $resolvedInstallRoot)
    startMenuShortcutExists = (Test-Path $startMenuShortcut)
    startMenuUninstallShortcutExists = (Test-Path $startMenuUninstallShortcut)
    desktopShortcutExists = (Test-Path $desktopShortcut)
    startupRegistryValueExists = $runValueExists
    configRootExists = (Test-Path $resolvedConfigRoot)
    configFileExists = (Test-Path $configPath)
    syncStateFileExists = (Test-Path $syncStatePath)
    diagnosticsFileExists = (Test-Path $diagnosticsPath)
    uninstallRegistryEntries = @($registryEntries)
    startMenuShortcut = $startMenuShortcut
    startMenuUninstallShortcut = $startMenuUninstallShortcut
    desktopShortcut = $desktopShortcut
  }
}
if ($ConfigExpectation -eq "retained") {
  $report.checks.configRootStateMatchesExpectation =
    (Test-Path $resolvedConfigRoot) -and
    (
      (Test-Path $configPath) -or
      (Test-Path $syncStatePath) -or
      (Test-Path $diagnosticsPath)
    )
} else {
  $report.checks.configRootStateMatchesExpectation = (-not (Test-Path $resolvedConfigRoot))
}
$failedChecks = @($report.checks.GetEnumerator() | Where-Object {
  if (-not $RequireDesktopShortcutRemoved -and $_.Key -eq "desktopShortcutRemoved") {
    return $false
  }

  if (-not $RequireAutostartRemoved -and $_.Key -eq "startupRegistryValueRemoved") {
    return $false
  }

  return -not $_.Value
} | Select-Object -ExpandProperty Key)
if ($failedChecks.Count -gt 0) {
  $report.failedChecks = $failedChecks
}

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8

if ($failedChecks.Count -gt 0) {
  throw "Uninstall result verification failed: $($failedChecks -join ', ')"
}

Write-Host "Uninstall result verification passed."
Write-Host "Report: $resolvedReportPath"
