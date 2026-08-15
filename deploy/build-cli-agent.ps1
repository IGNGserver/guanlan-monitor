param(
  [string]$OutputDir = "",
  [string]$GoPath = "",
  [switch]$Zip
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$version = (Get-Content -LiteralPath (Join-Path $repoRoot "VERSION") -Raw).Trim()
$channel = if ([string]::IsNullOrWhiteSpace($env:DSC_RELEASE_CHANNEL)) { "test" } else { $env:DSC_RELEASE_CHANNEL.Trim() }
if ($channel -notin @("stable", "test")) { throw "Invalid DSC_RELEASE_CHANNEL: $channel" }
$agentDir = Join-Path $repoRoot "agents"
$outputRoot = if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  Join-Path $repoRoot "release\cli-agent"
} elseif ([System.IO.Path]::IsPathRooted($OutputDir)) {
  $OutputDir
} else {
  Join-Path $repoRoot $OutputDir
}
$outputRoot = [System.IO.Path]::GetFullPath($outputRoot)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$go = $GoPath
if ([string]::IsNullOrWhiteSpace($go)) {
  $command = Get-Command go -ErrorAction SilentlyContinue
  if ($command) { $go = $command.Source }
}
if ([string]::IsNullOrWhiteSpace($go) -or -not (Test-Path $go)) {
  throw "Go executable not found. Pass -GoPath or install Go."
}

function Build-PlatformPackage {
  param(
    [string]$Name,
    [string]$Goos,
    [string]$Goarch,
    [string]$BinaryName,
    [string]$DscBinaryName,
    [string]$BackendBinaryName,
    [string]$InstallerName,
    [string]$CliInstallerPath,
    [string]$ReleaseAssetName
  )

  $directory = Join-Path $outputRoot $Name
  Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $env:GOOS = $Goos
  $env:GOARCH = $Goarch
  $env:CGO_ENABLED = "0"
  & $go -C $agentDir build -trimpath -ldflags "-s -w -X main.BuildVersion=$version -X main.BuildChannel=$channel" -o (Join-Path $directory $BinaryName) .
  if ($LASTEXITCODE -ne 0) { throw "Go build failed for $Name" }
  & $go -C $agentDir build -trimpath -ldflags "-s -w -X main.BuildVersion=$version -X main.BuildChannel=$channel" -o (Join-Path $directory $DscBinaryName) ./cmd/dsc
  if ($LASTEXITCODE -ne 0) { throw "Go dsc build failed for $Name" }
  & $go -C $agentDir build -trimpath -ldflags "-s -w -X main.BuildVersion=$version -X main.BuildChannel=$channel" -o (Join-Path $directory $BackendBinaryName) ./cmd/windows-agent-backend
  if ($LASTEXITCODE -ne 0) { throw "Go backend build failed for $Name" }
  Copy-Item -LiteralPath (Join-Path $repoRoot "VERSION") -Destination (Join-Path $directory "VERSION") -Force
  Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\$InstallerName") -Destination (Join-Path $directory $InstallerName) -Force
  Copy-Item -LiteralPath $CliInstallerPath -Destination (Join-Path $directory (Split-Path $CliInstallerPath -Leaf)) -Force
  "Device State Console CLI UI $ReleaseAssetName`r`nRun dsc to open the terminal UI." | Set-Content -LiteralPath (Join-Path $directory "README.txt") -Encoding ASCII
}

$windowsAssetName = "DeviceStateConsole-Windows-CLI-Install-v$version.zip"
$linuxAssetName = "DeviceStateConsole-Linux-CLI-Install-v$version.zip"
$generatedInstallCliSh = Join-Path $outputRoot "install-cli.sh"
$generatedInstallCliPs1 = Join-Path $outputRoot "install-cli.ps1"
$installCliSh = (Get-Content -LiteralPath (Join-Path $repoRoot "deploy\install-cli.sh") -Raw).Replace("__DSC_VERSION__", $version)
$installCliPs1 = (Get-Content -LiteralPath (Join-Path $repoRoot "deploy\install-cli.ps1") -Raw).Replace("__DSC_VERSION__", $version)
$utf8NoBom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($generatedInstallCliSh, $installCliSh.Replace("`r`n", "`n").Replace("`r", ""), $utf8NoBom)
[System.IO.File]::WriteAllText($generatedInstallCliPs1, $installCliPs1.Replace("`r`n", "`n").Replace("`r", ""), $utf8NoBom)

Build-PlatformPackage -Name "windows-x64" -Goos "windows" -Goarch "amd64" -BinaryName "device-state-console-agent.exe" -DscBinaryName "dsc.exe" -BackendBinaryName "device-state-console-agent-backend.exe" -InstallerName "install-agent.ps1" -CliInstallerPath $generatedInstallCliPs1 -ReleaseAssetName $windowsAssetName
Build-PlatformPackage -Name "linux-x64" -Goos "linux" -Goarch "amd64" -BinaryName "device-state-console-agent" -DscBinaryName "dsc" -BackendBinaryName "device-state-console-agent-backend" -InstallerName "install-agent.sh" -CliInstallerPath $generatedInstallCliSh -ReleaseAssetName $linuxAssetName

Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
if ($Zip) {
  Get-ChildItem -LiteralPath $outputRoot -Directory | ForEach-Object {
    $archiveName = if ($_.Name -eq "windows-x64") { $windowsAssetName } else { $linuxAssetName }
    $archivePath = Join-Path $outputRoot $archiveName
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $_.FullName "*") -DestinationPath $archivePath -Force
  }
}

Write-Host "CLI agent packages created at $outputRoot for version $version."
