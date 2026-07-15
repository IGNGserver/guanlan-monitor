param(
  [string]$SetupExePath = "",
  [string]$PortableBundleDir = "",
  [string]$InstallRoot = "",
  [string]$ConfigRoot = "",
  [string]$StartMenuProgramsRoot = "",
  [string]$DesktopRoot = "",
  [string]$OutputDir = "",
  [switch]$ForceCleanup
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Resolve-RepoPath {
  param(
    [string]$RepoRoot,
    [string]$PathValue,
    [string]$FallbackPath
  )

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return [System.IO.Path]::GetFullPath($FallbackPath)
  }

  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }

  try {
    return (Resolve-Path -LiteralPath $PathValue -ErrorAction Stop).Path
  } catch {
  }

  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $PathValue))
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function New-EmptyDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Find-Uninstaller {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  if (-not (Test-Path -LiteralPath $Root)) {
    return $null
  }

  return Get-ChildItem -LiteralPath $Root -Filter "unins*.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object Name |
    Select-Object -First 1
}

function Start-InstalledAgentAndWaitForConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [Parameter(Mandatory = $true)]
    [string]$ConfigRoot,
    [int]$TimeoutSeconds = 45
  )

  $launcher = Join-Path $InstallRoot "start-agent.vbs"
  $wscript = Join-Path $env:WINDIR "System32\wscript.exe"
  if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Installed launcher was not found: $launcher"
  }
  if (-not (Test-Path -LiteralPath $wscript)) {
    throw "Windows Script Host was not found: $wscript"
  }

  $launcherProcess = Start-Process -FilePath $wscript -ArgumentList @($launcher, "--minimized") -PassThru
  $launcherProcess.WaitForExit(10000) | Out-Null

  $configPath = Join-Path $ConfigRoot "agent-ui.config.json"
  $diagnosticsPath = Join-Path $ConfigRoot "agent-ui.backend.log"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if ((Test-Path -LiteralPath $configPath) -and (Test-Path -LiteralPath $diagnosticsPath)) {
      return
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  throw "Installed agent did not create first-run config artifacts within $TimeoutSeconds seconds."
}

function Stop-InstalledAgentProcesses {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot
  )

  $normalizedRoot = ([System.IO.Path]::GetFullPath($InstallRoot)).TrimEnd('\') + '\'
  $names = @("DeviceStateConsoleAgent.WinUI", "windows-agent-backend", "device-state-console-agent")
  foreach ($name in $names) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        if ($_.Path -and [System.IO.Path]::GetFullPath($_.Path).StartsWith($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
          Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
      } catch {
      }
    }
  }
  Start-Sleep -Milliseconds 800
}

function Invoke-ExternalProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [string[]]$ArgumentList = @(),

    [string]$WorkingDirectory = ""
  )

  $resolvedFilePath = if ($FilePath -eq "powershell.exe") {
    Join-Path $PSHOME "powershell.exe"
  } else {
    $FilePath
  }
  $startProcessParameters = @{
    FilePath = $resolvedFilePath
    ArgumentList = $ArgumentList
    PassThru = $true
    Wait = $true
    WindowStyle = "Hidden"
  }
  if (-not [string]::IsNullOrWhiteSpace($WorkingDirectory)) {
    $startProcessParameters.WorkingDirectory = $WorkingDirectory
  }

  $process = Start-Process @startProcessParameters

  if ($process.ExitCode -ne 0) {
    throw "Process failed with exit code $($process.ExitCode): $FilePath $($ArgumentList -join ' ')"
  }
}

function Invoke-PowerShellScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,

    [string[]]$Arguments = @()
  )

  $fullArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $ScriptPath
  ) + @($Arguments)
  Invoke-ExternalProcess -FilePath (Join-Path $PSHOME "powershell.exe") -ArgumentList $fullArguments
}

function Assert-CleanStartState {
  param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [Parameter(Mandatory = $true)]
    [string]$ConfigRoot,
    [Parameter(Mandatory = $true)]
    [string]$StartMenuProgramsRoot,
    [switch]$ForceCleanup
  )

  $existingPaths = @()
  if (Test-Path -LiteralPath $InstallRoot) { $existingPaths += $InstallRoot }
  if (Test-Path -LiteralPath $ConfigRoot) { $existingPaths += $ConfigRoot }
  $appDisplayName = ([string][char]0x89C2) + ([string][char]0x6F9C)
  $shortcutPaths = @(
    (Join-Path $StartMenuProgramsRoot "DeviceStateConsoleAgent.lnk"),
    (Join-Path $StartMenuProgramsRoot ("{0}.lnk" -f $appDisplayName))
  )
  foreach ($shortcutPath in $shortcutPaths) {
    if (Test-Path -LiteralPath $shortcutPath) { $existingPaths += $shortcutPath }
  }

  if ($existingPaths.Count -eq 0) {
    return
  }

  if (-not $ForceCleanup) {
    throw "Existing install/config/start-menu state detected. Re-run with -ForceCleanup on a disposable test machine. Paths: $($existingPaths -join ', ')"
  }

  $uninstaller = Find-Uninstaller -Root $InstallRoot
  if ($uninstaller) {
    Invoke-ExternalProcess -FilePath $uninstaller.FullName -ArgumentList @(
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/NORESTART",
      "/SP-",
      "/uninstallconfig=delete"
    )
  }

  foreach ($path in @($shortcutPaths + @($InstallRoot, $ConfigRoot))) {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedSetupExePath = Resolve-RepoPath -RepoRoot $repoRoot -PathValue $SetupExePath -FallbackPath (Join-Path $repoRoot "release\windows-agent-setup\DeviceStateConsoleAgent-setup.exe")
$resolvedPortableBundleDir = Resolve-RepoPath -RepoRoot $repoRoot -PathValue $PortableBundleDir -FallbackPath (Join-Path $repoRoot "release\windows-agent-portable\DeviceStateConsoleAgent")
$resolvedInstallRoot = Resolve-RepoPath -RepoRoot $repoRoot -PathValue $InstallRoot -FallbackPath (Join-Path $env:ProgramFiles "DeviceStateConsoleAgent")
$resolvedConfigRoot = Resolve-RepoPath -RepoRoot $repoRoot -PathValue $ConfigRoot -FallbackPath (Join-Path $env:LocalAppData "DeviceStateConsoleAgent")
$resolvedStartMenuProgramsRoot = Resolve-RepoPath -RepoRoot $repoRoot -PathValue $StartMenuProgramsRoot -FallbackPath ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonPrograms))
$resolvedDesktopRoot = Resolve-RepoPath -RepoRoot $repoRoot -PathValue $DesktopRoot -FallbackPath ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonDesktopDirectory))
$resolvedOutputDir = Resolve-RepoPath -RepoRoot $repoRoot -PathValue $OutputDir -FallbackPath (Join-Path $repoRoot "release\windows-agent-setup-execution")

$setupVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($resolvedSetupExePath).ProductVersion
if ([string]::IsNullOrWhiteSpace($setupVersion)) {
  throw "Could not determine setup version from $resolvedSetupExePath"
}

if (-not (Test-IsAdministrator)) {
  throw "verify-windows-agent-setup-execution.ps1 must run in an elevated administrator session."
}

if (-not (Test-Path -LiteralPath $resolvedSetupExePath)) {
  throw "Setup executable not found: $resolvedSetupExePath"
}

Assert-CleanStartState `
  -InstallRoot $resolvedInstallRoot `
  -ConfigRoot $resolvedConfigRoot `
  -StartMenuProgramsRoot $resolvedStartMenuProgramsRoot `
  -ForceCleanup:$ForceCleanup

New-EmptyDirectory -Path $resolvedOutputDir

$templateReportPath = Join-Path $resolvedOutputDir "setup-template-report.json"
$generatedReportPath = Join-Path $resolvedOutputDir "setup-generated-report.json"
$generatedSetupOutputDir = Join-Path $resolvedOutputDir "generated-setup"
$installedLayoutReportPath = Join-Path $resolvedOutputDir "installed-layout-report.json"
$uninstallRetainedReportPath = Join-Path $resolvedOutputDir "uninstall-retained-report.json"
$uninstallDeletedReportPath = Join-Path $resolvedOutputDir "uninstall-deleted-report.json"
$lifecycleReportPath = Join-Path $resolvedOutputDir "windows-agent-setup-lifecycle-report.json"
$executionReportPath = Join-Path $resolvedOutputDir "windows-agent-setup-execution-report.json"
$installLogPath = Join-Path $resolvedOutputDir "setup-install.log"
$uninstallRetainedLogPath = Join-Path $resolvedOutputDir "setup-uninstall-retained.log"
$uninstallDeletedLogPath = Join-Path $resolvedOutputDir "setup-uninstall-deleted.log"

$verifyTemplateScript = Join-Path $repoRoot "deploy\verify-windows-agent-setup-template.ps1"
$verifyGeneratedScript = Join-Path $repoRoot "deploy\verify-windows-agent-setup-generated.ps1"
$verifyInstalledLayoutScript = Join-Path $repoRoot "deploy\verify-windows-agent-installed-layout.ps1"
$verifyUninstallResultScript = Join-Path $repoRoot "deploy\verify-windows-agent-uninstall-result.ps1"
$verifyLifecycleScript = Join-Path $repoRoot "deploy\verify-windows-agent-setup-lifecycle.ps1"
$verifyReleaseReadinessScript = Join-Path $repoRoot "deploy\verify-windows-agent-release-readiness.ps1"
$exportObjectiveAuditScript = Join-Path $repoRoot "deploy\export-windows-agent-objective-audit.ps1"
$exportDeliverySummaryScript = Join-Path $repoRoot "deploy\export-windows-agent-delivery-summary.ps1"

$releaseReadinessReportPath = Join-Path $repoRoot "release\windows-agent-release-readiness-report.json"
$objectiveAuditPath = Join-Path $repoRoot "release\windows-agent-objective-audit.md"
$deliverySummaryPath = Join-Path $repoRoot "release\windows-agent-delivery-summary.md"

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  setupExePath = $resolvedSetupExePath
  installRoot = $resolvedInstallRoot
  configRoot = $resolvedConfigRoot
  startMenuProgramsRoot = $resolvedStartMenuProgramsRoot
  desktopRoot = $resolvedDesktopRoot
  outputDir = $resolvedOutputDir
  checks = [ordered]@{
    templateVerified = $false
    generatedVerified = $false
    installCompleted = $false
    installedLayoutVerified = $false
    uninstallRetainedCompleted = $false
    uninstallRetainedVerified = $false
    reinstallCompleted = $false
    uninstallDeletedCompleted = $false
    uninstallDeletedVerified = $false
    lifecycleVerified = $false
    releaseReadinessRefreshed = $false
    objectiveAuditExported = $false
    deliverySummaryExported = $false
  }
  reports = [ordered]@{
    template = $templateReportPath
    generated = $generatedReportPath
    installedLayout = $installedLayoutReportPath
    uninstallRetained = $uninstallRetainedReportPath
    uninstallDeleted = $uninstallDeletedReportPath
    lifecycle = $lifecycleReportPath
    releaseReadiness = $releaseReadinessReportPath
    objectiveAudit = $objectiveAuditPath
    deliverySummary = $deliverySummaryPath
  }
  logs = [ordered]@{
    install = $installLogPath
    uninstallRetained = $uninstallRetainedLogPath
    uninstallDeleted = $uninstallDeletedLogPath
  }
}

try {
  Invoke-PowerShellScript -ScriptPath $verifyTemplateScript -Arguments @(
    "-ReportPath", $templateReportPath
  )
  $report.checks.templateVerified = $true

  Invoke-PowerShellScript -ScriptPath $verifyGeneratedScript -Arguments @(
    "-PortableBundleDir", $resolvedPortableBundleDir,
    "-OutputDir", $generatedSetupOutputDir,
    "-Version", $setupVersion,
    "-ReportPath", $generatedReportPath
  )
  $report.checks.generatedVerified = $true

  Invoke-ExternalProcess -FilePath $resolvedSetupExePath -ArgumentList @(
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/SP-",
    "/TASKS=""desktopicon,autostart""",
    "/LOG=$installLogPath"
  )
  $report.checks.installCompleted = $true

  Start-InstalledAgentAndWaitForConfig -InstallRoot $resolvedInstallRoot -ConfigRoot $resolvedConfigRoot

  Invoke-PowerShellScript -ScriptPath $verifyInstalledLayoutScript -Arguments @(
    "-InstallRoot", $resolvedInstallRoot,
    "-ConfigRoot", $resolvedConfigRoot,
    "-StartMenuProgramsRoot", $resolvedStartMenuProgramsRoot,
    "-DesktopRoot", $resolvedDesktopRoot,
    "-RequireConfigArtifacts",
    "-RequireSyncStateAfterDisplayChange",
    "-RequireDesktopShortcut",
    "-RequireAutostartIntegration",
    "-ReportPath", $installedLayoutReportPath
  )
  $report.checks.installedLayoutVerified = $true

  Stop-InstalledAgentProcesses -InstallRoot $resolvedInstallRoot

  $retainedUninstaller = Find-Uninstaller -Root $resolvedInstallRoot
  if (-not $retainedUninstaller) {
    throw "Installed uninstaller was not found under $resolvedInstallRoot"
  }
  Invoke-ExternalProcess -FilePath $retainedUninstaller.FullName -ArgumentList @(
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/SP-",
    "/LOG=$uninstallRetainedLogPath",
    "/uninstallconfig=retain"
  )
  $report.checks.uninstallRetainedCompleted = $true

  Invoke-PowerShellScript -ScriptPath $verifyUninstallResultScript -Arguments @(
    "-InstallRoot", $resolvedInstallRoot,
    "-ConfigRoot", $resolvedConfigRoot,
    "-StartMenuProgramsRoot", $resolvedStartMenuProgramsRoot,
    "-DesktopRoot", $resolvedDesktopRoot,
    "-ConfigExpectation", "retained",
    "-RequireDesktopShortcutRemoved",
    "-RequireAutostartRemoved",
    "-ReportPath", $uninstallRetainedReportPath
  )
  $report.checks.uninstallRetainedVerified = $true

  Invoke-ExternalProcess -FilePath $resolvedSetupExePath -ArgumentList @(
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/SP-",
    "/TASKS=""desktopicon,autostart"""
  )
  $report.checks.reinstallCompleted = $true

  Invoke-ExternalProcess -FilePath (Find-Uninstaller -Root $resolvedInstallRoot).FullName -ArgumentList @(
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/SP-",
    "/LOG=$uninstallDeletedLogPath",
    "/uninstallconfig=delete"
  )
  $report.checks.uninstallDeletedCompleted = $true

  Invoke-PowerShellScript -ScriptPath $verifyUninstallResultScript -Arguments @(
    "-InstallRoot", $resolvedInstallRoot,
    "-ConfigRoot", $resolvedConfigRoot,
    "-StartMenuProgramsRoot", $resolvedStartMenuProgramsRoot,
    "-DesktopRoot", $resolvedDesktopRoot,
    "-ConfigExpectation", "deleted",
    "-RequireDesktopShortcutRemoved",
    "-RequireAutostartRemoved",
    "-ReportPath", $uninstallDeletedReportPath
  )
  $report.checks.uninstallDeletedVerified = $true

  Invoke-PowerShellScript -ScriptPath $verifyLifecycleScript -Arguments @(
    "-TemplateReportPath", $templateReportPath,
    "-GeneratedReportPath", $generatedReportPath,
    "-InstalledLayoutReportPath", $installedLayoutReportPath,
    "-UninstallRetainedReportPath", $uninstallRetainedReportPath,
    "-UninstallDeletedReportPath", $uninstallDeletedReportPath,
    "-ReportPath", $lifecycleReportPath,
    "-RequireInstalledLayout",
    "-RequireUninstallRetained",
    "-RequireUninstallDeleted"
  )
  $report.checks.lifecycleVerified = $true

  Invoke-PowerShellScript -ScriptPath $verifyReleaseReadinessScript -Arguments @(
    "-SetupLifecycleReportPath", $lifecycleReportPath,
    "-ReportPath", $releaseReadinessReportPath
  )
  $report.checks.releaseReadinessRefreshed = $true

  Invoke-PowerShellScript -ScriptPath $exportObjectiveAuditScript -Arguments @(
    "-SetupLifecycleReportPath", $lifecycleReportPath,
    "-ReleaseReadinessReportPath", $releaseReadinessReportPath,
    "-OutputPath", $objectiveAuditPath
  )
  $report.checks.objectiveAuditExported = $true

  Invoke-PowerShellScript -ScriptPath $exportDeliverySummaryScript -Arguments @(
    "-ReleaseReadinessReportPath", $releaseReadinessReportPath,
    "-ObjectiveAuditPath", $objectiveAuditPath,
    "-OutputPath", $deliverySummaryPath
  )
  $report.checks.deliverySummaryExported = $true
}
finally {
  $failedChecks = @($report.checks.GetEnumerator() | Where-Object { -not $_.Value } | Select-Object -ExpandProperty Key)
  if ($failedChecks.Count -gt 0) {
    $report.failedChecks = $failedChecks
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $executionReportPath -Encoding UTF8
}

Write-Host "Real setup execution verification passed."
Write-Host "Report: $executionReportPath"
