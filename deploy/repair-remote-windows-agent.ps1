param(
  [Parameter(Mandatory = $true)]
  [string]$DeviceId,

  [Parameter(Mandatory = $true)]
  [string]$HostnameValue,

  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$Secret,

  [string]$PreferredGo = ""
)

$ErrorActionPreference = "Stop"

$installDir = "C:\ProgramData\DeviceStateConsoleAgent"
$runScript = Join-Path $installDir "run-agent.ps1"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$agentSourceDir = Join-Path $repoRoot "agents"
$agentBinary = Join-Path $installDir "device-state-console-agent.exe"

$goCandidates = @(
  $PreferredGo,
  "C:\Program Files\Go\bin\go.exe",
  "D:\apps\go\bin\go.exe"
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

$resolvedGoPath = $goCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $resolvedGoPath) {
  throw "No go executable found."
}

$runScriptContent = @"
`$ErrorActionPreference = 'Stop'
`$env:DSC_SERVER_URL = '$ServerUrl'
`$env:DSC_AGENT_SECRET = '$Secret'
`$env:DSC_DEVICE_ID = '$DeviceId'
`$env:DSC_HOSTNAME = '$HostnameValue'
`$ProgressPreference = 'SilentlyContinue'
Set-Location '$installDir'
`$maxRestartCount = 10
`$restartWindowSeconds = 300
`$restartDelaySeconds = 27
`$recentStarts = New-Object 'System.Collections.Generic.Queue[datetime]'
while (`$true) {
  `$now = Get-Date
  while (`$recentStarts.Count -gt 0 -and ((`$now - `$recentStarts.Peek()).TotalSeconds -ge `$restartWindowSeconds)) {
    [void]`$recentStarts.Dequeue()
  }
  if (`$maxRestartCount -gt 0 -and `$recentStarts.Count -ge `$maxRestartCount) {
    Add-Content -Path '$installDir\agent.err.log' -Value ('[' + (Get-Date -Format o) + '] agent exited too frequently; stopping automatic restarts')
    exit 1
  }
  `$recentStarts.Enqueue(`$now)
  & '$agentBinary' *>> '$installDir\agent.out.log'
  `$exitCode = if (`$LASTEXITCODE -is [int]) { `$LASTEXITCODE } else { 1 }
  Add-Content -Path '$installDir\agent.err.log' -Value ('[' + (Get-Date -Format o) + '] agent exited with code ' + `$exitCode)
  Start-Sleep -Seconds `$restartDelaySeconds
}
"@

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
if (-not (Test-Path (Join-Path $agentSourceDir "main.go"))) {
  throw "Agent source not found: $agentSourceDir"
}
& $resolvedGoPath build -C $agentSourceDir -o $agentBinary .
if (-not (Test-Path $agentBinary)) {
  throw "Go build did not produce $agentBinary"
}
$runScriptContent | Set-Content -Encoding UTF8 $runScript
if (-not (Test-Path (Join-Path $installDir "agent.out.log"))) {
  New-Item -ItemType File -Path (Join-Path $installDir "agent.out.log") | Out-Null
}
if (-not (Test-Path (Join-Path $installDir "agent.err.log"))) {
  New-Item -ItemType File -Path (Join-Path $installDir "agent.err.log") | Out-Null
}

Get-Process -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.Path -like "*DeviceStateConsoleAgent*" -or $_.Path -eq $agentBinary) -and
    ($_.ProcessName -like "powershell*" -or $_.ProcessName -like "device-state-console-agent*")
  } |
  Stop-Process -Force -ErrorAction SilentlyContinue

Unregister-ScheduledTask -TaskName "DeviceStateConsoleAgent" -Confirm:$false -ErrorAction SilentlyContinue

$actionArgs = '-NoProfile -ExecutionPolicy Bypass -File "' + $runScript + '"'
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
$triggers = @(
  New-ScheduledTaskTrigger -AtStartup
  New-ScheduledTaskTrigger -AtLogOn
)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

Register-ScheduledTask -TaskName "DeviceStateConsoleAgent" -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "DeviceStateConsoleAgent"
Start-Sleep -Seconds 6

Write-Output ("GO=" + $resolvedGoPath)
Get-ScheduledTask -TaskName "DeviceStateConsoleAgent" | Select-Object TaskName, State | Format-List
schtasks /Query /TN DeviceStateConsoleAgent /V /FO LIST
Get-Content (Join-Path $installDir "agent.out.log") -Tail 8 -ErrorAction SilentlyContinue
Get-Content (Join-Path $installDir "agent.err.log") -Tail 8 -ErrorAction SilentlyContinue
