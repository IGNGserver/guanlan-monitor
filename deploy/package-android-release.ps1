param(
  [string]$ApkPath = "",
  [string]$OutputDir = "release\android",
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = (Get-Content -LiteralPath (Join-Path $repoRoot "VERSION") -Raw).Trim()
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must be semantic x.y.z: $Version"
}

$source = if ([string]::IsNullOrWhiteSpace($ApkPath)) {
  Join-Path $repoRoot "android\app\build\outputs\apk\release\app-release.apk"
} elseif ([System.IO.Path]::IsPathRooted($ApkPath)) {
  $ApkPath
} else {
  Join-Path $repoRoot $ApkPath
}
$resolvedSource = [System.IO.Path]::GetFullPath($source)
if (-not (Test-Path -LiteralPath $resolvedSource)) {
  throw "Signed Android APK was not found: $resolvedSource"
}

$resolvedOutputDir = if ([System.IO.Path]::IsPathRooted($OutputDir)) {
  $OutputDir
} else {
  Join-Path $repoRoot $OutputDir
}
$resolvedOutputDir = [System.IO.Path]::GetFullPath($resolvedOutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null
$destination = Join-Path $resolvedOutputDir "DeviceStateConsole-Android-v$Version.apk"
Copy-Item -LiteralPath $resolvedSource -Destination $destination -Force
Write-Host "Android release asset created: $destination"
