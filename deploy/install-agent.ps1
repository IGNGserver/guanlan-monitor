param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$Secret,

  [string]$DeviceId = $env:COMPUTERNAME,
  [string]$HardwareJsonUrl = "",
  [switch]$AllowAcpiThermalZone,
  [string]$InstallDir = "$env:ProgramData\DeviceStateConsoleAgent"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Install Node.js 22+ first."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$agentSource = Join-Path $repoRoot "agents\node-agent.mjs"
if (-not (Test-Path $agentSource)) {
  throw "Cannot find agents\node-agent.mjs"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item $agentSource (Join-Path $InstallDir "node-agent.mjs") -Force

$envFile = Join-Path $InstallDir "agent.env.ps1"
@"
`$env:DSC_SERVER_URL="$ServerUrl"
`$env:DSC_AGENT_SECRET="$Secret"
`$env:DSC_DEVICE_ID="$DeviceId"
`$env:DSC_HOSTNAME="$DeviceId"
`$env:DSC_HARDWARE_JSON_URL="$HardwareJsonUrl"
`$env:DSC_ALLOW_ACPI_THERMAL_ZONE="$($AllowAcpiThermalZone.IsPresent.ToString().ToLowerInvariant())"
node "$InstallDir\node-agent.mjs"
"@ | Set-Content -Encoding UTF8 $envFile

$taskName = "Device State Console Agent"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$envFile`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Device State Console agent installed and started."
Write-Host "Task name: $taskName"
