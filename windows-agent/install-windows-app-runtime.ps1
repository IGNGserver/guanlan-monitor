param()

$ErrorActionPreference = "Stop"

$logDir = Join-Path $env:LOCALAPPDATA "DeviceStateConsoleAgent"
$logPath = Join-Path $logDir "runtime-install.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

Write-Log "Windows App Runtime prerequisite skipped because the WinUI frontend is published as self-contained."
exit 0
