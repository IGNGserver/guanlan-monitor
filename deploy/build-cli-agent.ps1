param(
  [string]$OutputDir = "",
  [string]$GoPath = "",
  [switch]$Zip
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$version = (Get-Content -LiteralPath (Join-Path $repoRoot "VERSION") -Raw).Trim()
$agentDir = Join-Path $repoRoot "agents"
$outputRoot = if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  Join-Path $repoRoot "release\cli-agent"
} elseif ([System.IO.Path]::IsPathRooted($OutputDir)) {
  $OutputDir
} else {
  Join-Path $repoRoot $OutputDir
}
$outputRoot = [System.IO.Path]::GetFullPath($outputRoot)

$go = $GoPath
if ([string]::IsNullOrWhiteSpace($go)) {
  $command = Get-Command go -ErrorAction SilentlyContinue
  if ($command) { $go = $command.Source }
}
if ([string]::IsNullOrWhiteSpace($go) -or -not (Test-Path $go)) {
  throw "Go executable not found. Pass -GoPath or install Go."
}

function Build-PlatformPackage {
  param([string]$Name, [string]$Goos, [string]$Goarch, [string]$BinaryName, [string]$InstallerName)

  $directory = Join-Path $outputRoot $Name
  Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $env:GOOS = $Goos
  $env:GOARCH = $Goarch
  $env:CGO_ENABLED = "0"
  & $go -C $agentDir build -trimpath -ldflags "-s -w" -o (Join-Path $directory $BinaryName) .
  if ($LASTEXITCODE -ne 0) { throw "Go build failed for $Name" }
  Copy-Item -LiteralPath (Join-Path $repoRoot "VERSION") -Destination (Join-Path $directory "VERSION") -Force
  Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\$InstallerName") -Destination (Join-Path $directory $InstallerName) -Force
  "Device State Console CLI Agent $version ($Name)" | Set-Content -LiteralPath (Join-Path $directory "README.txt") -Encoding ASCII
}

Build-PlatformPackage -Name "windows-x64" -Goos "windows" -Goarch "amd64" -BinaryName "device-state-console-agent.exe" -InstallerName "install-agent.ps1"
Build-PlatformPackage -Name "linux-x64" -Goos "linux" -Goarch "amd64" -BinaryName "device-state-console-agent" -InstallerName "install-agent.sh"

Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
if ($Zip) {
  Get-ChildItem -LiteralPath $outputRoot -Directory | ForEach-Object {
    $archivePath = Join-Path $outputRoot ($_.Name + "-$version.zip")
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $_.FullName "*") -DestinationPath $archivePath -Force
  }
}

Write-Host "CLI agent packages created at $outputRoot for version $version."
