param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$Secret,
  [string]$DeviceId = $env:COMPUTERNAME,
  [string]$Hostname = "",
  [string]$InstallDir = "$env:ProgramData\DeviceStateConsoleAgent",
  [switch]$PreferCurrentUserAutostart,
  [string]$Repository = "IGNGserver/Device-State-Console"
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must be semantic x.y.z." }
$asset = "windows-x64-$Version.zip"
$url = "https://github.com/$Repository/releases/download/v$Version/$asset"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dsc-agent-$Version-" + [guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $tempRoot $asset
$extractPath = Join-Path $tempRoot "package"
New-Item -ItemType Directory -Force -Path $extractPath | Out-Null
try {
  Invoke-WebRequest -Uri $url -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force
  $installer = Join-Path $extractPath "install-agent.ps1"
  if (-not (Test-Path $installer)) { throw "Release asset is missing install-agent.ps1: $url" }
  $args = @("-ServerUrl", $ServerUrl, "-Secret", $Secret, "-DeviceId", $DeviceId, "-InstallDir", $InstallDir)
  if (-not [string]::IsNullOrWhiteSpace($Hostname)) { $args += @("-Hostname", $Hostname) }
  if ($PreferCurrentUserAutostart) { $args += "-PreferCurrentUserAutostart" }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer @args
  if ($LASTEXITCODE -ne 0) { throw "Agent installation failed with exit code $LASTEXITCODE." }
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
