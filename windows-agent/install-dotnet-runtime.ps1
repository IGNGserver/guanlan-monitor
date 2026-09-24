param()

$ErrorActionPreference = "Stop"

$runtimeDir = Join-Path $PSScriptRoot "runtime"
$runtimeInstaller = Join-Path $runtimeDir "windowsdesktop-runtime-win-x64.exe"
$logDir = Join-Path $env:LOCALAPPDATA "DeviceStateConsoleAgent"
$logPath = Join-Path $logDir "dotnet-runtime-install.log"
$requiredVersion = [Version]"8.0.0"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Get-InstalledDesktopRuntimeVersion {
  $roots = @(
    "C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App",
    (Join-Path $env:USERPROFILE ".dotnet\shared\Microsoft.WindowsDesktop.App")
  )

  $versions = foreach ($root in $roots) {
    if (-not (Test-Path $root)) {
      continue
    }

    Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $parsed = $null
      if ([Version]::TryParse($_.Name, [ref]$parsed)) {
        $parsed
      }
    }
  }

  $versions | Sort-Object -Descending | Select-Object -First 1
}

if (-not (Test-Path $runtimeInstaller)) {
  throw ".NET Windows Desktop Runtime installer not found: $runtimeInstaller"
}

$installedVersion = Get-InstalledDesktopRuntimeVersion
if ($installedVersion -and $installedVersion -ge $requiredVersion) {
  Write-Log ".NET Windows Desktop Runtime already installed: $installedVersion"
  exit 0
}

Write-Log "Running bundled .NET Windows Desktop Runtime installer: $runtimeInstaller"
$arguments = @("/install", "/quiet", "/norestart")
$process = Start-Process -FilePath $runtimeInstaller -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
Write-Log ".NET Windows Desktop Runtime installer exit code: $($process.ExitCode)"
if ($process.ExitCode -ne 0) {
  throw ".NET Windows Desktop Runtime installer failed with exit code $($process.ExitCode)"
}

$installedVersion = Get-InstalledDesktopRuntimeVersion
if (-not $installedVersion -or $installedVersion -lt $requiredVersion) {
  throw ".NET Windows Desktop Runtime installation completed but no compatible runtime was detected."
}

Write-Log ".NET Windows Desktop Runtime installed successfully: $installedVersion"
exit 0
