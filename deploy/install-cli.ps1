param(
  [string]$Version = "__DSC_VERSION__",
  [string]$Repository = "IGNGserver/guanlan-monitor",
  [string]$InstallDir = "",
  [switch]$Run,
  [switch]$NoPathNotice
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Version)) {
  throw "A fixed semantic version is required. Pass -Version X.Y.Z."
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must use semantic versioning: $Version"
}
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw "LOCALAPPDATA is not set; pass -InstallDir explicitly."
  }
  $InstallDir = Join-Path $env:LOCALAPPDATA "Guanlan\bin"
}

$asset = "DeviceStateConsole-Windows-CLI-Install-v$Version.zip"
$baseUrl = "https://github.com/$Repository/releases/download/v$Version"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("guanlan-cli-" + [guid]::NewGuid().ToString("N"))
$archive = Join-Path $tempRoot $asset
$checksum = "$archive.sha256"
$packageRoot = Join-Path $tempRoot "package"

New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
try {
  Invoke-WebRequest -Uri "$baseUrl/$asset" -OutFile $archive
  Invoke-WebRequest -Uri "$baseUrl/$asset.sha256" -OutFile $checksum
  $expected = ((Get-Content -LiteralPath $checksum -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    throw "SHA-256 verification failed for $asset."
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $packageRoot -Force

  foreach ($file in @("dsc.exe", "device-state-console-agent.exe", "device-state-console-agent-backend.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $packageRoot $file))) {
      throw "Release asset is missing $file."
    }
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  foreach ($file in @("dsc.exe", "device-state-console-agent.exe", "device-state-console-agent-backend.exe", "VERSION")) {
    $source = Join-Path $packageRoot $file
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $InstallDir $file) -Force
    }
  }

  if (-not $NoPathNotice) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathParts = @($userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($pathParts -notcontains $InstallDir) {
      $newPath = (($pathParts + $InstallDir) -join ';')
      [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
      $env:Path = "$InstallDir;$env:Path"
      Write-Host "已将 $InstallDir 加入当前用户 PATH。新终端会自动生效。"
    }
  }

  Write-Host "观澜 CLI 已安装到 $InstallDir。"
  if ($Run) {
    & (Join-Path $InstallDir "dsc.exe")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
