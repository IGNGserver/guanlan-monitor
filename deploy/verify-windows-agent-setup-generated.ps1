param(
  [string]$PortableBundleDir = "",
  [string]$OutputDir = "",
  [string]$Version = "0.1.0",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Resolve-OptionalPath {
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
    return (Resolve-Path $PathValue -ErrorAction Stop).Path
  } catch {
  }

  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $PathValue))
}

function Get-PortableBundleAssetReport {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BundleRoot
  )

  $backendDir = Join-Path $BundleRoot "backend"
  $runtimeDir = Join-Path $BundleRoot "runtime"

  return [ordered]@{
    bundleRootExists = (Test-Path $BundleRoot)
    frontendExeExists = (Test-Path (Join-Path $BundleRoot "DeviceStateConsoleAgent.WinUI.exe"))
    appIconExists = (Test-Path (Join-Path $BundleRoot "app-icon.ico"))
    readmeExists = (Test-Path (Join-Path $BundleRoot "README.md"))
    installerVersionExists = (Test-Path (Join-Path $BundleRoot "INSTALLER_VERSION.txt"))
    startAgentCmdExists = (Test-Path (Join-Path $BundleRoot "start-agent.cmd"))
    startAgentPs1Exists = (Test-Path (Join-Path $BundleRoot "start-agent.ps1"))
    startAgentVbsExists = (Test-Path (Join-Path $BundleRoot "start-agent.vbs"))
    installDotnetScriptExists = (Test-Path (Join-Path $BundleRoot "install-dotnet-runtime.ps1"))
    backendDirExists = (Test-Path $backendDir)
    backendExeExists = (Test-Path (Join-Path $backendDir "windows-agent-backend.exe"))
    collectorExeExists = (Test-Path (Join-Path $backendDir "device-state-console-agent.exe"))
    hardwareDirExists = (Test-Path (Join-Path $backendDir "windows-hardware"))
    hardwareLhmExists = (Test-Path (Join-Path $backendDir "windows-hardware\librehardwaremonitor\LibreHardwareMonitorLib.dll"))
    hardwarePawnInstallerExists = (Test-Path (Join-Path $backendDir "windows-hardware\pawnio\PawnIO_setup.exe"))
    dotnetRuntimeInstallerExists = (Test-Path (Join-Path $runtimeDir "windowsdesktop-runtime-win-x64.exe"))
  }
}

function Test-Contains {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Content,
    [Parameter(Mandatory = $true)]
    [string]$Pattern
  )

  return $Content.Contains($Pattern)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$buildScript = Join-Path $repoRoot "deploy\build-windows-agent-setup.ps1"
$prepareBundleScript = Join-Path $repoRoot "deploy\prepare-windows-agent-verify-bundle.ps1"

$resolvedOutputDir = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $OutputDir -FallbackPath (Join-Path $repoRoot ".codex-artifacts\verify-windows-agent-setup-generated")
$resolvedPortableBundleDir = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $PortableBundleDir -FallbackPath (Join-Path $resolvedOutputDir "DeviceStateConsoleAgent")
$resolvedReportPath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $ReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-setup-generated-report.json")

if (Test-Path $resolvedOutputDir) {
  Remove-Item -LiteralPath $resolvedOutputDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

if (-not (Test-Path $resolvedPortableBundleDir)) {
  & powershell -ExecutionPolicy Bypass -File $prepareBundleScript -OutputDir $resolvedPortableBundleDir | Out-Null
}

& powershell -ExecutionPolicy Bypass -File $buildScript `
  -PortableBundleDir $resolvedPortableBundleDir `
  -OutputDir $resolvedOutputDir `
  -Version $Version | Out-Null

$generatedIss = Join-Path $resolvedOutputDir "windows-agent-setup.generated.iss"
if (-not (Test-Path $generatedIss)) {
  throw "Generated ISS file was not produced: $generatedIss"
}

$content = Get-Content -LiteralPath $generatedIss -Raw
$bundleAssetChecks = Get-PortableBundleAssetReport -BundleRoot $resolvedPortableBundleDir

$checks = [ordered]@{
  generatedIssExists = (Test-Path $generatedIss)
  sourceDirReplaced = (Test-Contains -Content $content -Pattern ('#define MyAppSourceDir "' + $resolvedPortableBundleDir + '"'))
  outputDirReplaced = (Test-Contains -Content $content -Pattern ('#define MyAppOutputDir "' + $resolvedOutputDir + '"'))
  versionReplaced = (Test-Contains -Content $content -Pattern ('#define MyAppVersion "' + $Version + '"'))
  sourcePlaceholderRemoved = (-not (Test-Contains -Content $content -Pattern '#define MyAppSourceDir "C:\build\DeviceStateConsoleAgent"'))
  outputPlaceholderRemoved = (-not (Test-Contains -Content $content -Pattern '#define MyAppOutputDir "C:\build\installer"'))
  startMenuShortcutRetained = (Test-Contains -Content $content -Pattern 'Filename: "{app}\start-agent.vbs"')
  startMenuUninstallShortcutRetained = (Test-Contains -Content $content -Pattern 'Filename: "{uninstallexe}"')
  desktopShortcutTaskRetained = (Test-Contains -Content $content -Pattern 'Name: "desktopicon"')
  desktopShortcutBindingRetained = (Test-Contains -Content $content -Pattern 'Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\start-agent.vbs"')
  startupShortcutRemoved = (-not (Test-Contains -Content $content -Pattern 'Name: "{commonstartup}\{#MyAppName}"; Filename: "{app}\start-agent.vbs"; Parameters: "--minimized"'))
  startupRegistryRetained = (Test-Contains -Content $content -Pattern 'Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#MyAppName}"; ValueData: """{sys}\wscript.exe"" ""{app}\start-agent.vbs"" --minimized"; Flags: uninsdeletevalue; Tasks: autostart')
  windowsAppRuntimeCheckRemoved = (-not (Test-Contains -Content $content -Pattern 'Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-windows-app-runtime.ps1""'))
  legacyWindowsAppRuntimeFileCleanupRetained = (Test-Contains -Content $content -Pattern 'Type: files; Name: "{app}\install-windows-app-runtime.ps1"')
  dotnetRuntimeCheckRetained = (Test-Contains -Content $content -Pattern 'install-dotnet-runtime.ps1')
  uninstallPromptRetained = (Test-Contains -Content $content -Pattern 'MsgBox(') -and (Test-Contains -Content $content -Pattern 'GetLocalConfigDir()')
  uninstallConfigParamRetained = (Test-Contains -Content $content -Pattern "{param:uninstallconfig|}")
  uninstallConfigDeleteModeRetained = (Test-Contains -Content $content -Pattern "UninstallConfigMode = 'delete'")
  uninstallConfigKeepModeRetained = (Test-Contains -Content $content -Pattern "UninstallConfigMode = 'keep'")
  uninstallChoiceRetained = (Test-Contains -Content $content -Pattern 'RemoveLocalConfigOnUninstall := (Response = IDYES);')
  uninstallDecisionBypassRetained = (Test-Contains -Content $content -Pattern 'and (not RemoveLocalConfigDecisionProvided) then')
  silentUninstallKeepRetained = (Test-Contains -Content $content -Pattern 'if UninstallSilent() then')
  localConfigDeletionRetained = (Test-Contains -Content $content -Pattern 'DelTree(GetLocalConfigDir(), True, True, True);')
}

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  portableBundleDir = $resolvedPortableBundleDir
  outputDir = $resolvedOutputDir
  generatedIss = $generatedIss
  version = $Version
  bundleAssets = $bundleAssetChecks
  checks = $checks
}

$failedChecks = @(
  $bundleAssetChecks.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { "bundleAssets.$($_.Key)" }
)
$failedChecks += @($checks.GetEnumerator() | Where-Object { -not $_.Value } | Select-Object -ExpandProperty Key)
if ($failedChecks.Count -gt 0) {
  $report.failedChecks = $failedChecks
}

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8

if ($failedChecks.Count -gt 0) {
  throw "Generated ISS verification failed: $($failedChecks -join ', ')"
}

Write-Host "Generated ISS verification passed."
Write-Host "Report: $resolvedReportPath"
