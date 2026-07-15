param(
  [string]$TemplatePath = "",
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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedTemplatePath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $TemplatePath -FallbackPath (Join-Path $repoRoot "deploy\windows-agent-setup.iss")
$resolvedReportPath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $ReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-setup-template-report.json")

if (-not (Test-Path $resolvedTemplatePath)) {
  throw "Setup template not found: $resolvedTemplatePath"
}

$content = Get-Content -LiteralPath $resolvedTemplatePath -Raw

function Test-Contains {
  param([string]$Pattern)
  return $content -match [regex]::Escape($Pattern)
}

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  templatePath = $resolvedTemplatePath
  checks = [ordered]@{
    appInstallDirConfigured = Test-Contains 'DefaultDirName={autopf}\{#MyAppInstallDirName}'
    adminInstallRequired = Test-Contains 'PrivilegesRequired=admin'
    setupIconConfigured = Test-Contains 'SetupIconFile={#MyAppSourceDir}\{#MyAppIconName}'
    uninstallDisplayIconConfigured = Test-Contains 'UninstallDisplayIcon={app}\{#MyAppExeName}'
    localConfigDirMacroDefined = Test-Contains '#define MyAppConfigDirName "DeviceStateConsoleAgent"'
    localConfigDirUsed = Test-Contains "ExpandConstant('{localappdata}\{#MyAppConfigDirName}')"
    startMenuShortcutConfigured = Test-Contains 'Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\start-agent.vbs"; IconFilename: "{app}\{#MyAppExeName}"'
    startMenuUninstallShortcutConfigured = Test-Contains 'Name: "{autoprograms}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"; IconFilename: "{app}\{#MyAppExeName}"'
    desktopShortcutTaskConfigured = Test-Contains 'Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"; Flags: unchecked'
    desktopShortcutBoundToTask = Test-Contains 'Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\start-agent.vbs"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon'
    startupShortcutRemoved = (-not (Test-Contains 'Name: "{commonstartup}\{#MyAppName}"; Filename: "{app}\start-agent.vbs"; Parameters: "--minimized"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: autostart'))
    startupRegistryConfigured = Test-Contains 'Filename: "{sys}\reg.exe"; Parameters: "add ""HKCU\Software\Microsoft\Windows\CurrentVersion\Run"" /v ""{#MyAppName}"" /t REG_SZ /d """"{sys}\wscript.exe"" ""{app}\start-agent.vbs"""" /f"; Flags: runhidden runasoriginaluser; Tasks: autostart'
    startupRegistryRemovedOnUninstall = (Test-Contains 'ExecAsOriginalUser(') -and (Test-Contains 'delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "{#MyAppName}" /f')
    legacyMachineStartupRemoved = Test-Contains 'Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "{#MyAppName}"; Flags: deletevalue'
    windowsAppRuntimePrereqRemoved = (-not (Test-Contains 'Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-windows-app-runtime.ps1""'))
    legacyWindowsAppRuntimeFileCleanupConfigured = Test-Contains 'Type: files; Name: "{app}\install-windows-app-runtime.ps1"'
    dotnetRuntimePrereqConfigured = Test-Contains 'Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-dotnet-runtime.ps1"""; StatusMsg: "正在校验 .NET Desktop Runtime 8..."; Flags: runhidden waituntilterminated'
    postInstallLaunchUsesBootstrap = Test-Contains 'Filename: "{sys}\wscript.exe"; Parameters: """{app}\start-agent.vbs"""; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent runasoriginaluser'
    uninstallPromptPresent = Test-Contains '是否在卸载时一并删除这些本地配置与同步状态文件？'
    uninstallDefaultKeepsConfig = Test-Contains 'MB_YESNO or MB_DEFBUTTON2'
    uninstallConfigParamRecognized = Test-Contains "ExpandConstant('{param:uninstallconfig|}')"
    uninstallConfigDeleteModeSupported = Test-Contains "UninstallConfigMode = 'delete'"
    uninstallConfigKeepModeSupported = Test-Contains "(UninstallConfigMode = 'keep') or (UninstallConfigMode = 'retain')"
    uninstallDeleteChoiceStored = Test-Contains 'RemoveLocalConfigOnUninstall := (Response = IDYES);'
    uninstallDecisionBypassSupported = Test-Contains 'and (not RemoveLocalConfigDecisionProvided) then'
    silentUninstallKeepsConfig = Test-Contains 'if UninstallSilent() then'
    silentUninstallDecisionRecorded = Test-Contains 'RemoveLocalConfigDecisionProvided := True;'
    localConfigDeletionGuarded = Test-Contains 'if RemoveLocalConfigOnUninstall and DirExists(GetLocalConfigDir()) then'
    localConfigDeleteImplemented = Test-Contains 'DelTree(GetLocalConfigDir(), True, True, True);'
  }
}

$failedChecks = @($report.checks.GetEnumerator() | Where-Object { -not $_.Value } | Select-Object -ExpandProperty Key)
if ($failedChecks.Count -gt 0) {
  $report.failedChecks = $failedChecks
}

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8

if ($failedChecks.Count -gt 0) {
  throw "Setup template verification failed: $($failedChecks -join ', ')"
}

Write-Host "Setup template verification passed."
Write-Host "Report: $resolvedReportPath"
