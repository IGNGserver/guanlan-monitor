param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ForwardArgs = @()
)

$ErrorActionPreference = "Stop"

$appDir = $PSScriptRoot
$exePath = Join-Path $appDir "DeviceStateConsoleAgent.WinUI.exe"
$dotnetRuntimeInstaller = Join-Path $appDir "install-dotnet-runtime.ps1"
$powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$logDir = Join-Path $env:LOCALAPPDATA "DeviceStateConsoleAgent"
$startupLogPath = Join-Path $logDir "launcher.log"
$runtimeLogPath = Join-Path $logDir "runtime-install.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class DeviceStateConsoleAgentLauncherNative
{
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

function Write-Log {
  param([string]$Message)

  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $startupLogPath -Value $line -Encoding UTF8
}

function Show-LauncherError {
  param([string]$Message)

  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    $Message,
    "DeviceStateConsoleAgent",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
}

function Get-ExistingFrontendProcess {
  Get-Process DeviceStateConsoleAgent.WinUI -ErrorAction SilentlyContinue |
    Where-Object {
      try {
        -not [string]::IsNullOrWhiteSpace($_.Path) -and
        [System.IO.Path]::GetFullPath($_.Path).Equals(
          [System.IO.Path]::GetFullPath($exePath),
          [System.StringComparison]::OrdinalIgnoreCase)
      } catch {
        $false
      }
    } |
    Sort-Object StartTime |
    Select-Object -First 1
}

function Try-ActivateExistingFrontend {
  param([System.Diagnostics.Process]$Process)

  try {
    $handle = $Process.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero) {
      return $false
    }

    [DeviceStateConsoleAgentLauncherNative]::ShowWindowAsync($handle, 9) | Out-Null
    Start-Sleep -Milliseconds 250
    return [DeviceStateConsoleAgentLauncherNative]::SetForegroundWindow($handle)
  } catch {
    return $false
  }
}

if (-not (Test-Path $exePath)) {
  throw "Agent executable not found: $exePath"
}

if (-not (Test-Path $dotnetRuntimeInstaller)) {
  throw ".NET runtime installer script not found: $dotnetRuntimeInstaller"
}

try {
  Write-Log "Launcher start. Dotnet runtime installer: $dotnetRuntimeInstaller"
  $existingFrontend = Get-ExistingFrontendProcess
  if ($existingFrontend) {
    if (($ForwardArgs | Where-Object { $_ -eq "--minimized" }).Count -gt 0) {
      Write-Log "Frontend already running for this bundle; minimized launch request will reuse existing instance."
      exit 0
    }

    $activated = Try-ActivateExistingFrontend -Process $existingFrontend
    Write-Log "Frontend already running for this bundle; activation result=$activated pid=$($existingFrontend.Id)"
    exit 0
  }

  & $powershellPath -NoProfile -ExecutionPolicy Bypass -File $dotnetRuntimeInstaller

  Start-Sleep -Seconds 2

  $argumentLine = @($ForwardArgs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  Write-Log "Launching frontend: $exePath args=$($argumentLine -join ' ')"
  if ($argumentLine.Count -gt 0) {
    Start-Process -FilePath $exePath -ArgumentList $argumentLine
  } else {
    Start-Process -FilePath $exePath
  }
} catch {
  $message = $_.Exception.Message
  Write-Log "Launch failed: $message"
  Show-LauncherError "启动前端失败。`r`n`r`n$message`r`n`r`n请查看日志：`r`n$startupLogPath`r`n$runtimeLogPath"
  exit 1
}
