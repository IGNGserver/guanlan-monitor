param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$Secret,

  [string]$DeviceId = $env:COMPUTERNAME,
  [string]$Hostname = "",
  [string]$HardwareJsonUrl = "",
  [string]$RedfishUrl = "",
  [string]$RedfishUsername = "",
  [string]$RedfishPassword = "",
  [switch]$RedfishInsecure,
  [switch]$EnablePawnIo,
  [switch]$AllowAcpiThermalZone,
  [string]$InstallDir = "$env:ProgramData\DeviceStateConsoleAgent",
  [string]$NodePath = "",
  [int]$RestartCount = 10,
  [int]$RestartIntervalMinutes = 5,
  [switch]$PreferCurrentUserAutostart
)

$ErrorActionPreference = "Stop"

if ($RestartCount -lt 0) {
  throw "RestartCount must be greater than or equal to 0."
}

if ($RestartIntervalMinutes -lt 1) {
  throw "RestartIntervalMinutes must be at least 1."
}

$resolvedNodePath = $NodePath
if ([string]::IsNullOrWhiteSpace($resolvedNodePath)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js is required. Install Node.js 22+ first or pass -NodePath."
  }
  $resolvedNodePath = $nodeCommand.Source
}

if (-not (Test-Path $resolvedNodePath)) {
  throw "Node executable not found: $resolvedNodePath"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$agentSource = Join-Path $repoRoot "agents\node-agent.mjs"
$hardwareSource = Join-Path $repoRoot "agents\windows-hardware"
if (-not (Test-Path $agentSource)) {
  throw "Cannot find agents\node-agent.mjs"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item $agentSource (Join-Path $InstallDir "node-agent.mjs") -Force
if (Test-Path $hardwareSource) {
  $hardwareTarget = Join-Path $InstallDir "windows-hardware"
  Remove-Item $hardwareTarget -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $hardwareTarget | Out-Null
  Copy-Item (Join-Path $hardwareSource "*") $hardwareTarget -Recurse -Force
}

function Get-PawnIoStatus {
  $dllDir = Join-Path $InstallDir "windows-hardware\librehardwaremonitor"
  $dllPath = Join-Path $dllDir "LibreHardwareMonitorLib.dll"
  if (-not (Test-Path $dllPath)) {
    return [pscustomobject]@{ Available = $false; Installed = $false; Loaded = $false; Detail = "dll missing" }
  }
  try {
    [System.IO.Directory]::SetCurrentDirectory($dllDir)
    Get-ChildItem -Path $dllDir -Filter '*.dll' -File | ForEach-Object {
      try { [System.Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null } catch {}
    }
    Add-Type -Path $dllPath
    return [pscustomobject]@{
      Available = $true
      Installed = [bool][LibreHardwareMonitor.PawnIo.PawnIo]::IsInstalled
      Loaded = [bool]([LibreHardwareMonitor.PawnIo.PawnIo]::IsLoaded)
      Detail = [string][LibreHardwareMonitor.PawnIo.PawnIo]::Version
    }
  } catch {
    return [pscustomobject]@{ Available = $true; Installed = $false; Loaded = $false; Detail = $_.Exception.Message }
  }
}

$pawnInstaller = Join-Path $InstallDir "windows-hardware\pawnio\PawnIO_setup.exe"
$pawnStatus = Get-PawnIoStatus
if ($EnablePawnIo.IsPresent -and $pawnStatus.Available -and -not $pawnStatus.Installed -and (Test-Path $pawnInstaller)) {
  Write-Host "PawnIO not installed. Installing bundled PawnIO driver..."
  try {
    $pawnProcess = Start-Process -FilePath $pawnInstaller -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART","/SP-" -PassThru -Wait
    Write-Host "PawnIO installer exit code: $($pawnProcess.ExitCode)"
    Start-Sleep -Seconds 3
    $pawnStatus = Get-PawnIoStatus
  } catch {
    Write-Warning "PawnIO installation failed: $($_.Exception.Message)"
  }
}
if (-not $EnablePawnIo.IsPresent) {
  Write-Host "PawnIO installation skipped. Use -EnablePawnIo to attempt low-level hardware driver installation."
}

$resolvedHostname = $Hostname
if ([string]::IsNullOrWhiteSpace($resolvedHostname)) {
  $resolvedHostname = $DeviceId
}

$restartWindowSeconds = [Math]::Max(60, $RestartIntervalMinutes * 60)
$restartDelaySeconds = [Math]::Min(30, [Math]::Max(3, [Math]::Floor($restartWindowSeconds / [Math]::Max(1, $RestartCount + 1))))

$runScript = Join-Path $InstallDir "run-agent.ps1"
@" 
`$env:DSC_SERVER_URL="$ServerUrl"
`$env:DSC_AGENT_SECRET="$Secret"
`$env:DSC_DEVICE_ID="$DeviceId"
`$env:DSC_HOSTNAME="$resolvedHostname"
`$env:DSC_HARDWARE_JSON_URL="$HardwareJsonUrl"
`$env:DSC_REDFISH_URL="$RedfishUrl"
`$env:DSC_REDFISH_USERNAME="$RedfishUsername"
`$env:DSC_REDFISH_PASSWORD="$RedfishPassword"
`$env:DSC_REDFISH_INSECURE="$($RedfishInsecure.IsPresent.ToString().ToLowerInvariant())"
`$env:DSC_ALLOW_ACPI_THERMAL_ZONE="$($AllowAcpiThermalZone.IsPresent.ToString().ToLowerInvariant())"
`$env:DSC_COMMAND_TIMEOUT_MS="2000"
`$ProgressPreference="SilentlyContinue"
Set-Location "$InstallDir"
`$maxRestartCount = $RestartCount
`$restartWindowSeconds = $restartWindowSeconds
`$restartDelaySeconds = $restartDelaySeconds
`$recentStarts = New-Object 'System.Collections.Generic.Queue[datetime]'
while (`$true) {
  `$now = Get-Date
  while (`$recentStarts.Count -gt 0 -and ((`$now - `$recentStarts.Peek()).TotalSeconds -ge `$restartWindowSeconds)) {
    [void]`$recentStarts.Dequeue()
  }
  if (`$maxRestartCount -gt 0 -and `$recentStarts.Count -ge `$maxRestartCount) {
    Write-Error \"Agent exited too frequently (`$(`$recentStarts.Count) times within `$restartWindowSeconds seconds). Stopping automatic restarts.\"
    exit 1
  }
  `$recentStarts.Enqueue(`$now)
  & "$resolvedNodePath" "$InstallDir\node-agent.mjs" *>> "$InstallDir\agent.out.log"
  `$exitCode = if (`$LASTEXITCODE -is [int]) { `$LASTEXITCODE } else { 1 }
  Add-Content -Path "$InstallDir\agent.err.log" -Value ("[{0}] agent exited with code {1}" -f (Get-Date -Format o), `$exitCode)
  Start-Sleep -Seconds `$restartDelaySeconds
}
"@ | Set-Content -Encoding UTF8 $runScript

$taskName = "DeviceStateConsoleAgent"
$legacyTaskName = "Device State Console Agent"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount $RestartCount -RestartInterval (New-TimeSpan -Minutes $RestartIntervalMinutes) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$startupCommand = "powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runScript`""

function Enable-CurrentUserAutostart {
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  New-Item -Path $runKey -Force | Out-Null
  Set-ItemProperty -Path $runKey -Name $taskName -Value $startupCommand
  Start-Process -FilePath "powershell.exe" -ArgumentList "-WindowStyle","Hidden","-NoProfile","-ExecutionPolicy","Bypass","-File",$runScript -WindowStyle Hidden
  Write-Host "Device State Console agent installed and started."
  Write-Host "Autostart: current-user Run registry"
  Write-Host "PawnIO: installed=$($pawnStatus.Installed) loaded=$($pawnStatus.Loaded) detail=$($pawnStatus.Detail)"
}

try {
  Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false -ErrorAction Stop
} catch {}

if ($PreferCurrentUserAutostart.IsPresent) {
  Enable-CurrentUserAutostart
  exit 0
}

try {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
} catch {
  Write-Warning "Scheduled task registration failed: $($_.Exception.Message)"
  Enable-CurrentUserAutostart
  exit 0
}

Write-Host "Device State Console agent installed and started."
Write-Host "Task name: $taskName"
Write-Host "PawnIO: installed=$($pawnStatus.Installed) loaded=$($pawnStatus.Loaded) detail=$($pawnStatus.Detail)"
