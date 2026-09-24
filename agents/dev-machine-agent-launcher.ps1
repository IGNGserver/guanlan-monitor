$ErrorActionPreference = "Stop"

param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$Secret,

  [string]$DeviceId = "dev-machine",
  [string]$HostnameValue = "Development Machine",
  [string]$GoPath = ""
)

$agentDir = $PSScriptRoot
$agentBinary = Join-Path $agentDir "dev-machine-agent.exe"

$env:DSC_SERVER_URL = $ServerUrl
$env:DSC_AGENT_SECRET = $Secret
$env:DSC_DEVICE_ID = $DeviceId
$env:DSC_HOSTNAME = $HostnameValue
$env:DSC_REDFISH_URL = ""
$env:DSC_REDFISH_USERNAME = ""
$env:DSC_REDFISH_PASSWORD = ""
$env:DSC_REDFISH_INSECURE = "false"
$ProgressPreference = "SilentlyContinue"

if ([string]::IsNullOrWhiteSpace($GoPath)) {
  $GoPath = (Get-Command go.exe -ErrorAction SilentlyContinue).Source
}
if ([string]::IsNullOrWhiteSpace($GoPath) -or -not (Test-Path $GoPath)) {
  throw "Go executable not found. Pass -GoPath with the full go.exe path."
}

if (-not (Test-Path (Join-Path $agentDir "main.go"))) {
  throw "Agent source not found: $agentDir"
}

Set-Location $agentDir
& $goPath build -C $agentDir -o $agentBinary .
if (-not (Test-Path $agentBinary)) {
  throw "Go build did not produce: $agentBinary"
}

while ($true) {
  & $agentBinary
  Start-Sleep -Seconds 10
}
