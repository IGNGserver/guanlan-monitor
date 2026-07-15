param(
  [string]$OutputDir = "",
  [string]$PortableBuildOutputDir = "",
  [switch]$SkipGoBuild
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Resolve-OptionalPath {
  param(
    [string]$RepoRoot,
    [string]$PathValue,
    [string]$FallbackPath
  )

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return [System.IO.Path]::GetFullPath($FallbackPath)
  }

  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }

  try {
    return (Resolve-Path $PathValue -ErrorAction Stop).Path
  } catch {
  }

  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $PathValue))
}

function Remove-DirectoryWithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [int]$MaxAttempts = 8,
    [int]$DelayMilliseconds = 350
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      if (-not (Test-Path $Path)) {
        return
      }

      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      return
    } catch {
      if ($attempt -ge $MaxAttempts) {
        throw
      }

      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedOutputDir = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $OutputDir -FallbackPath (Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-latest")
$resolvedPortableBuildOutputDir = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $PortableBuildOutputDir -FallbackPath (Join-Path $repoRoot ".codex-artifacts\verify-agent-bundle-build")
$portableBuildScript = Join-Path $repoRoot "deploy\build-windows-agent-portable.ps1"
$builtBundleRoot = Join-Path $resolvedPortableBuildOutputDir "DeviceStateConsoleAgent"

if (Test-Path $resolvedOutputDir) {
  Remove-DirectoryWithRetry -Path $resolvedOutputDir
}
if (Test-Path $resolvedPortableBuildOutputDir) {
  Remove-DirectoryWithRetry -Path $resolvedPortableBuildOutputDir
}

$buildArgs = @(
  "-ExecutionPolicy", "Bypass",
  "-File", $portableBuildScript,
  "-OutputDir", $resolvedPortableBuildOutputDir
)
if ($SkipGoBuild) {
  $buildArgs += "-SkipGoBuild"
}

& powershell @buildArgs

if (-not (Test-Path $builtBundleRoot)) {
  throw "Portable verify bundle was not produced: $builtBundleRoot"
}

Move-Item -LiteralPath $builtBundleRoot -Destination $resolvedOutputDir

Write-Host "Windows verify bundle prepared."
Write-Host "Root: $resolvedOutputDir"
