param(
  [string]$PublishDir = "",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Resolve-RepoPath {
  param(
    [string]$RepoRoot,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  if ([System.IO.Path]::IsPathRooted($Value)) {
    return [System.IO.Path]::GetFullPath($Value)
  }

  try {
    return (Resolve-Path $Value -ErrorAction Stop).Path
  } catch {
  }

  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Value))
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedPublishDir = Resolve-RepoPath -RepoRoot $repoRoot -Value $PublishDir
if (-not $resolvedPublishDir) {
  throw "PublishDir is required."
}

$resolvedReportPath = Resolve-RepoPath -RepoRoot $repoRoot -Value $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-winui-publish-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$frontendExe = Join-Path $resolvedPublishDir "DeviceStateConsoleAgent.WinUI.exe"
$frontendDll = Join-Path $resolvedPublishDir "DeviceStateConsoleAgent.WinUI.dll"
$depsJson = Join-Path $resolvedPublishDir "DeviceStateConsoleAgent.WinUI.deps.json"
$runtimeConfig = Join-Path $resolvedPublishDir "DeviceStateConsoleAgent.WinUI.runtimeconfig.json"
$iconPath = Join-Path $resolvedPublishDir "app-icon.ico"

$requiredPaths = @(
  $resolvedPublishDir,
  $frontendExe,
  $frontendDll,
  $depsJson,
  $runtimeConfig,
  $iconPath
)

$missing = @($requiredPaths | Where-Object { -not (Test-Path $_) })
$publishFiles = @(Get-ChildItem -LiteralPath $resolvedPublishDir -File -ErrorAction SilentlyContinue)

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  publishDir = $resolvedPublishDir
  fileCount = $publishFiles.Count
  files = [ordered]@{
    frontendExeExists = (Test-Path $frontendExe)
    frontendDllExists = (Test-Path $frontendDll)
    depsJsonExists = (Test-Path $depsJson)
    runtimeConfigExists = (Test-Path $runtimeConfig)
    appIconExists = (Test-Path $iconPath)
  }
  passed = ($missing.Count -eq 0 -and $publishFiles.Count -gt 0)
  missing = @($missing)
}

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8

if ($missing.Count -gt 0) {
  throw "WinUI publish directory is incomplete. Missing:`n - $($missing -join "`n - ")"
}

if ($publishFiles.Count -le 0) {
  throw "WinUI publish directory is empty: $resolvedPublishDir"
}

Write-Host "WinUI publish directory looks valid."
Write-Host "Publish dir: $resolvedPublishDir"
Write-Host "Report: $resolvedReportPath"
