param(
  [ValidateSet("Install", "Uninstall")]
  [string]$Action = "Install",

  [string]$ServerUrl,

  [string]$Secret,

  [string]$DeviceId = $env:COMPUTERNAME,
  [string]$Hostname = "",
  [string]$InstallDir = "$env:ProgramData\DeviceStateConsoleAgent",
  [string]$AgentBinary = "",
  [string]$GoPath = "",
  [int]$RestartCount = 10,
  [int]$RestartIntervalMinutes = 5,
  [switch]$PreferCurrentUserAutostart
)

$ErrorActionPreference = "Stop"

$taskName = "DeviceStateConsoleAgent"
$legacyTaskName = "Device State Console Agent"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

if ($Action -eq "Uninstall") {
  foreach ($name in @($taskName, $legacyTaskName)) {
    try { Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue } catch {}
    try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue } catch {}
  }
  Remove-ItemProperty -Path $runKey -Name $taskName -ErrorAction SilentlyContinue
  & sc.exe stop $taskName 2>$null | Out-Null
  & sc.exe delete $taskName 2>$null | Out-Null
  if (Test-Path $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
  }
  Write-Host "Device State Console CLI agent uninstalled."
  exit 0
}

if ([string]::IsNullOrWhiteSpace($ServerUrl) -or [string]::IsNullOrWhiteSpace($Secret)) {
  throw "-ServerUrl and -Secret are required for installation."
}

if ($RestartCount -lt 0) {
  throw "RestartCount must be greater than or equal to 0."
}

if ($RestartIntervalMinutes -lt 1) {
  throw "RestartIntervalMinutes must be at least 1."
}

$resolvedAgentBinary = $AgentBinary
if ([string]::IsNullOrWhiteSpace($resolvedAgentBinary)) {
  $bundledBinary = Join-Path $PSScriptRoot "device-state-console-agent.exe"
  if (Test-Path $bundledBinary) {
    $resolvedAgentBinary = $bundledBinary
  }
}

$resolvedGoPath = $GoPath
if ([string]::IsNullOrWhiteSpace($resolvedAgentBinary) -and [string]::IsNullOrWhiteSpace($resolvedGoPath)) {
  $goCommand = Get-Command go -ErrorAction SilentlyContinue
  if (-not $goCommand) {
    throw "Go 1.24+ is required. Install Go first or pass -GoPath."
  }
  $resolvedGoPath = $goCommand.Source
}

if ([string]::IsNullOrWhiteSpace($resolvedAgentBinary) -and -not (Test-Path $resolvedGoPath)) {
  throw "Go executable not found: $resolvedGoPath"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$versionPath = Join-Path $PSScriptRoot "VERSION"
if (-not (Test-Path $versionPath)) { $versionPath = Join-Path $repoRoot "VERSION" }
if (-not (Test-Path $versionPath)) { throw "VERSION file not found beside the installer or repository root." }
$version = (Get-Content -LiteralPath $versionPath -Raw).Trim()
$agentSourceDir = Join-Path $repoRoot "agents"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$version | Set-Content -LiteralPath (Join-Path $InstallDir "VERSION") -Encoding ASCII
$binaryPath = Join-Path $InstallDir "device-state-console-agent.exe"
if (-not [string]::IsNullOrWhiteSpace($resolvedAgentBinary)) {
  if (-not (Test-Path $resolvedAgentBinary)) { throw "Agent binary not found: $resolvedAgentBinary" }
  Copy-Item -LiteralPath $resolvedAgentBinary -Destination $binaryPath -Force
} else {
  if (-not (Test-Path (Join-Path $agentSourceDir "main.go"))) { throw "Cannot find agents\main.go" }
  & $resolvedGoPath build -C $agentSourceDir -ldflags "-X main.BuildVersion=$version" -o $binaryPath .
}
if (-not (Test-Path $binaryPath)) {
  throw "Go build did not produce $binaryPath"
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
    Write-Error "Agent exited too frequently (`$(`$recentStarts.Count) times within `$restartWindowSeconds seconds). Stopping automatic restarts."
    exit 1
  }
  `$recentStarts.Enqueue(`$now)
  & "$binaryPath" *>> "$InstallDir\agent.out.log"
  `$exitCode = if (`$LASTEXITCODE -is [int]) { `$LASTEXITCODE } else { 1 }
  Add-Content -Path "$InstallDir\agent.err.log" -Value ("[{0}] agent exited with code {1}" -f (Get-Date -Format o), `$exitCode)
  Start-Sleep -Seconds `$restartDelaySeconds
}
"@ | Set-Content -Encoding UTF8 $runScript

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount $RestartCount -RestartInterval (New-TimeSpan -Minutes $RestartIntervalMinutes) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$startupCommand = "powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runScript`""

function Enable-CurrentUserAutostart {
  New-Item -Path $runKey -Force | Out-Null
  Set-ItemProperty -Path $runKey -Name $taskName -Value $startupCommand
  Start-Process -FilePath "powershell.exe" -ArgumentList "-WindowStyle","Hidden","-NoProfile","-ExecutionPolicy","Bypass","-File",$runScript -WindowStyle Hidden
  Write-Host "Device State Console Go agent installed and started."
  Write-Host "Autostart: current-user Run registry"
  Write-Host "Binary: $binaryPath"
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

Write-Host "Device State Console Go agent installed and started."
Write-Host "Task name: $taskName"
Write-Host "Binary: $binaryPath"
