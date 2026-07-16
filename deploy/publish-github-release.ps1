param(
  [string]$Version = "",
  [string]$NotesFile = "",
  [string]$WindowsSetup = "",
  [string]$WindowsUpdate = "",
  [string]$AndroidApk = ""
)

$ErrorActionPreference = "Stop"

function Resolve-ReleasePath {
  param([string]$Value, [string]$Fallback, [string]$RepoRoot)

  $candidate = if ([string]::IsNullOrWhiteSpace($Value)) { $Fallback } else { $Value }
  if (-not [System.IO.Path]::IsPathRooted($candidate)) {
    $candidate = Join-Path $RepoRoot $candidate
  }

  $resolved = [System.IO.Path]::GetFullPath($candidate)
  if (-not (Test-Path -LiteralPath $resolved)) {
    throw "Required release asset was not found: $resolved"
  }

  return $resolved
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = (Get-Content -LiteralPath (Join-Path $repoRoot "VERSION") -Raw).Trim()
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must be semantic x.y.z: $Version"
}

$tag = "v$Version"
$notes = Resolve-ReleasePath -Value $NotesFile -Fallback "release-notes-v$Version.md" -RepoRoot $repoRoot
$setup = Resolve-ReleasePath -Value $WindowsSetup -Fallback "release/windows-agent-setup/DeviceStateConsoleAgent-setup-$Version.exe" -RepoRoot $repoRoot
$update = Resolve-ReleasePath -Value $WindowsUpdate -Fallback "release/windows-agent-setup/DeviceStateConsoleAgent-update-$Version.zip" -RepoRoot $repoRoot
$apk = Resolve-ReleasePath -Value $AndroidApk -Fallback "release/android/guanlan-android-v$Version.apk" -RepoRoot $repoRoot

$gh = Get-Command gh -ErrorAction Stop
& $gh.Source auth status --hostname github.com | Out-Host

$releaseExists = $false
try {
  & $gh.Source release view $tag --repo IGNGserver/Device-State-Console 2>$null
  $releaseExists = $LASTEXITCODE -eq 0
} catch {
  # PowerShell 7 can promote a non-zero native exit code to an exception.
  if ($LASTEXITCODE -eq 0) {
    throw
  }
}

if ($releaseExists) {
  & $gh.Source release upload $tag $setup $update $apk --clobber --repo IGNGserver/Device-State-Console
  & $gh.Source release edit $tag --title "Device State Console $tag" --notes-file $notes --repo IGNGserver/Device-State-Console
} else {
  & $gh.Source release create $tag $setup $update $apk --title "Device State Console $tag" --notes-file $notes --repo IGNGserver/Device-State-Console
}

if ($LASTEXITCODE -ne 0) {
  throw "GitHub Release publication failed for $tag"
}

Write-Host "Published $tag with Windows setup, Windows update ZIP, and Android APK."
