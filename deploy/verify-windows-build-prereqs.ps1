param(
  [string]$DotnetPath = "",
  [string]$GoPath = "",
  [string]$IsccPath = "",
  [string]$ReportPath = "",
  [switch]$RequireAll
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Resolve-OptionalCommand {
  param(
    [string]$PreferredPath,
    [string]$CommandName
  )

  if (-not [string]::IsNullOrWhiteSpace($PreferredPath)) {
    if (-not (Test-Path $PreferredPath)) {
      return $null
    }
    return (Resolve-Path $PreferredPath).Path
  }

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $fallbackCandidates = @()
  if ($CommandName -eq "dotnet") {
    $fallbackCandidates = @(
      (Join-Path $env:USERPROFILE ".dotnet\dotnet.exe"),
      "C:\Program Files\dotnet\dotnet.exe",
      "C:\Program Files (x86)\dotnet\dotnet.exe"
    )
  }

  foreach ($candidate in $fallbackCandidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
      return (Resolve-Path $candidate).Path
    }
  }

  return $null
}

function Resolve-IsccPath {
  param([string]$PreferredPath)

  $candidateCommands = @(
    (Resolve-OptionalCommand -PreferredPath $PreferredPath -CommandName "ISCC"),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

  return $candidateCommands | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Parse-VersionPrefix {
  param(
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  $match = [regex]::Match($Value, '\d+(\.\d+){0,3}')
  if (-not $match.Success) {
    return $null
  }

  try {
    return [Version]$match.Value
  } catch {
    return $null
  }
}

function Add-UniqueString {
  param(
    [System.Collections.Generic.List[string]]$List,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }

  if (-not $List.Contains($Value)) {
    $List.Add($Value) | Out-Null
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$winUiProject = Join-Path $repoRoot "windows-agent\DeviceStateConsoleAgent.WinUI\DeviceStateConsoleAgent.WinUI.csproj"

$resolvedDotnetPath = Resolve-OptionalCommand -PreferredPath $DotnetPath -CommandName "dotnet"
$resolvedGoPath = Resolve-OptionalCommand -PreferredPath $GoPath -CommandName "go"
$resolvedIsccPath = Resolve-IsccPath -PreferredPath $IsccPath

$resolvedReportPath = if ([string]::IsNullOrWhiteSpace($ReportPath)) {
  Join-Path $repoRoot ".codex-artifacts\windows-build-prereqs-report.json"
} elseif ([System.IO.Path]::IsPathRooted($ReportPath)) {
  $ReportPath
} else {
  Join-Path $repoRoot $ReportPath
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$report = [ordered]@{
  checkedAt = (Get-Date).ToString("o")
  repoRoot = $repoRoot
  winUiProject = $winUiProject
  dotnet = [ordered]@{
    found = $false
    path = $resolvedDotnetPath
    version = ""
    sdk8OrNewer = $false
  }
  go = [ordered]@{
    found = $false
    path = $resolvedGoPath
    version = ""
    go124OrNewer = $false
  }
  innoSetup = [ordered]@{
    found = $false
    path = $resolvedIsccPath
  }
  winUiProjectConfig = [ordered]@{
    exists = (Test-Path $winUiProject)
    targetFramework = ""
    windowsAppSdkVersion = ""
    windowsAppSdkReferenced = $false
  }
  readiness = [ordered]@{
    portableBuildReady = $false
    setupBuildReady = $false
  }
  remediation = [ordered]@{
    portableBuildBlockedBy = @()
    setupBuildBlockedBy = @()
    nextSteps = @()
    recommendedCommands = @()
  }
}

if ($resolvedDotnetPath) {
  $dotnetVersionRaw = (& $resolvedDotnetPath --version 2>$null | Select-Object -First 1)
  $dotnetVersion = Parse-VersionPrefix -Value $dotnetVersionRaw
  $report.dotnet.found = $true
  $report.dotnet.version = $dotnetVersionRaw
  $report.dotnet.sdk8OrNewer = ($dotnetVersion -ne $null -and $dotnetVersion.Major -ge 8)
}

if ($resolvedGoPath) {
  $goVersionRaw = (& $resolvedGoPath version 2>$null | Select-Object -First 1)
  $goVersion = Parse-VersionPrefix -Value $goVersionRaw
  $report.go.found = $true
  $report.go.version = $goVersionRaw
  $report.go.go124OrNewer = ($goVersion -ne $null -and ($goVersion.Major -gt 1 -or ($goVersion.Major -eq 1 -and $goVersion.Minor -ge 24)))
}

if ($resolvedIsccPath) {
  $report.innoSetup.found = $true
}

if (Test-Path $winUiProject) {
  [xml]$csproj = Get-Content $winUiProject -Raw
  $targetFramework = @($csproj.Project.PropertyGroup.TargetFramework | Select-Object -First 1)[0]
  $windowsAppSdkVersion = @(
    $csproj.Project.ItemGroup.PackageReference |
      Where-Object { $_.Include -eq "Microsoft.WindowsAppSDK" } |
      Select-Object -First 1 -ExpandProperty Version
  )[0]
  $report.winUiProjectConfig.targetFramework = [string]$targetFramework
  $report.winUiProjectConfig.windowsAppSdkVersion = [string]$windowsAppSdkVersion
  $report.winUiProjectConfig.windowsAppSdkReferenced = -not [string]::IsNullOrWhiteSpace($windowsAppSdkVersion)
}

$report.readiness.portableBuildReady =
  $report.dotnet.sdk8OrNewer -and
  $report.go.go124OrNewer -and
  $report.winUiProjectConfig.exists -and
  $report.winUiProjectConfig.windowsAppSdkReferenced

$report.readiness.setupBuildReady =
  $report.readiness.portableBuildReady -and
  $report.innoSetup.found

$portableBlockedBy = New-Object 'System.Collections.Generic.List[string]'
$setupBlockedBy = New-Object 'System.Collections.Generic.List[string]'
$nextSteps = New-Object 'System.Collections.Generic.List[string]'
$recommendedCommands = New-Object 'System.Collections.Generic.List[string]'

if (-not $report.dotnet.found) {
  Add-UniqueString -List $portableBlockedBy -Value ".NET SDK 8 is missing or not available in PATH"
  Add-UniqueString -List $nextSteps -Value "Install .NET SDK 8 and confirm dotnet --version works."
  Add-UniqueString -List $recommendedCommands -Value "dotnet --version"
} elseif (-not $report.dotnet.sdk8OrNewer) {
  Add-UniqueString -List $portableBlockedBy -Value ".NET SDK version is lower than 8"
  Add-UniqueString -List $nextSteps -Value "Upgrade to .NET SDK 8 or newer, then rerun the prerequisite check."
  Add-UniqueString -List $recommendedCommands -Value "dotnet --version"
}

if (-not $report.winUiProjectConfig.exists) {
  Add-UniqueString -List $portableBlockedBy -Value "WinUI project file is missing"
  Add-UniqueString -List $nextSteps -Value "Confirm the source tree is complete and windows-agent\\DeviceStateConsoleAgent.WinUI\\DeviceStateConsoleAgent.WinUI.csproj exists."
}

if (-not $report.winUiProjectConfig.windowsAppSdkReferenced) {
  Add-UniqueString -List $portableBlockedBy -Value "WinUI project does not reference Windows App SDK"
  Add-UniqueString -List $nextSteps -Value "Check that the WinUI project still references Microsoft.WindowsAppSDK."
}

if (-not $report.go.found) {
  Add-UniqueString -List $portableBlockedBy -Value "Go is missing or not available in PATH"
  Add-UniqueString -List $nextSteps -Value "Install Go 1.24+ and confirm go version works."
  Add-UniqueString -List $recommendedCommands -Value "go version"
} elseif (-not $report.go.go124OrNewer) {
  Add-UniqueString -List $portableBlockedBy -Value "Go version is lower than 1.24"
  Add-UniqueString -List $nextSteps -Value "Upgrade to Go 1.24 or newer, then rerun the prerequisite check."
  Add-UniqueString -List $recommendedCommands -Value "go version"
}

if (-not $report.innoSetup.found) {
  Add-UniqueString -List $setupBlockedBy -Value "Inno Setup 6 is missing, so this machine cannot produce setup.exe directly"
  Add-UniqueString -List $nextSteps -Value "Install Inno Setup 6, or generate windows-agent-setup.generated.iss here and compile it on a machine that has ISCC.exe."
  Add-UniqueString -List $recommendedCommands -Value "powershell -ExecutionPolicy Bypass -File .\\deploy\\build-windows-agent-setup.ps1 -OutputDir .\\release\\windows-agent-setup -Version 0.1.0"
}

if ($portableBlockedBy.Count -gt 0) {
  Add-UniqueString -List $recommendedCommands -Value "powershell -ExecutionPolicy Bypass -File .\\deploy\\verify-windows-build-prereqs.ps1 -ReportPath .\\release\\windows-build-prereqs-report.json"
}

if ($report.dotnet.sdk8OrNewer -and $report.go.go124OrNewer -and $report.winUiProjectConfig.exists -and $report.winUiProjectConfig.windowsAppSdkReferenced) {
  Add-UniqueString -List $nextSteps -Value "Portable build prerequisites are satisfied. Continue with build-windows-agent-portable.ps1."
  Add-UniqueString -List $recommendedCommands -Value "powershell -ExecutionPolicy Bypass -File .\\deploy\\build-windows-agent-portable.ps1 -Zip"
}

if ($report.readiness.setupBuildReady) {
  Add-UniqueString -List $nextSteps -Value "Setup build prerequisites are satisfied. Continue with build-windows-agent-setup.ps1."
  Add-UniqueString -List $recommendedCommands -Value "powershell -ExecutionPolicy Bypass -File .\\deploy\\build-windows-agent-setup.ps1 -PortableBundleDir .\\release\\windows-agent-portable\\DeviceStateConsoleAgent -OutputDir .\\release\\windows-agent-setup -Version 0.1.0"
} elseif ($report.readiness.portableBuildReady) {
  Add-UniqueString -List $setupBlockedBy -Value "setup.exe output is still blocked by the missing Inno Setup compiler"
}

$report.remediation.portableBuildBlockedBy = @($portableBlockedBy.ToArray())
$report.remediation.setupBuildBlockedBy = @($setupBlockedBy.ToArray())
$report.remediation.nextSteps = @($nextSteps.ToArray())
$report.remediation.recommendedCommands = @($recommendedCommands.ToArray())

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8

Write-Host "Windows build prerequisite report written."
Write-Host "Report: $resolvedReportPath"
Write-Host "Portable build ready: $($report.readiness.portableBuildReady)"
Write-Host "Setup build ready: $($report.readiness.setupBuildReady)"
if ($report.remediation.portableBuildBlockedBy.Count -gt 0) {
  Write-Host "Portable build blocked by:"
  foreach ($item in $report.remediation.portableBuildBlockedBy) {
    Write-Host "  - $item"
  }
}
if ($report.remediation.setupBuildBlockedBy.Count -gt 0) {
  Write-Host "Setup build blocked by:"
  foreach ($item in $report.remediation.setupBuildBlockedBy) {
    Write-Host "  - $item"
  }
}
if ($report.remediation.nextSteps.Count -gt 0) {
  Write-Host "Suggested next steps:"
  foreach ($item in $report.remediation.nextSteps) {
    Write-Host "  - $item"
  }
}

if ($RequireAll -and (-not $report.readiness.setupBuildReady)) {
  throw "Windows build prerequisites are incomplete. See report: $resolvedReportPath"
}
