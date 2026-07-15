param(
  [string]$ServiceName = "DeviceStateConsoleAgent",
  [string]$DisplayName = "Device State Console Agent",
  [string]$InstallDir = "$env:ProgramData\DeviceStateConsoleAgent",
  [string]$NssmPath = ""
)

$ErrorActionPreference = "Stop"

$runScript = Join-Path $InstallDir "run-agent.ps1"
if (-not (Test-Path $runScript)) {
  throw "Run script not found: $runScript"
}

$nssm = $NssmPath
if ([string]::IsNullOrWhiteSpace($nssm)) {
  $nssmCommand = Get-Command nssm -ErrorAction SilentlyContinue
  if ($nssmCommand) {
    $nssm = $nssmCommand.Source
  }
}
if ([string]::IsNullOrWhiteSpace($nssm) -or -not (Test-Path $nssm)) {
  throw "nssm is required but was not found in PATH."
}
$stdoutLog = Join-Path $InstallDir "service.stdout.log"
$stderrLog = Join-Path $InstallDir "service.stderr.log"
$serviceArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`""

try {
  & sc.exe stop $ServiceName | Out-Null
} catch {}

try {
  & $nssm remove $ServiceName confirm | Out-Null
} catch {}

& $nssm install $ServiceName "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" $serviceArgs | Out-Null
& $nssm set $ServiceName DisplayName $DisplayName | Out-Null
& $nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $nssm set $ServiceName AppStdout $stdoutLog | Out-Null
& $nssm set $ServiceName AppStderr $stderrLog | Out-Null
& $nssm set $ServiceName AppRotateFiles 1 | Out-Null
& $nssm set $ServiceName AppRotateOnline 1 | Out-Null
& $nssm set $ServiceName AppRestartDelay 5000 | Out-Null
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null

& sc.exe start $ServiceName | Out-Null
Start-Sleep -Seconds 5

Get-Service -Name $ServiceName | Select-Object Name, Status, StartType | Format-List
Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" | Select-Object Name, DisplayName, StartMode, State, PathName | Format-List
