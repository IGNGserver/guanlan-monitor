param(
  [string]$PublishDir = "",
  [string]$OutputDir = "",
  [string]$ReportPath = "",
  [string]$GoPath = "",
  [switch]$UseGoBuild
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
$resolvedOutputDir = Resolve-RepoPath -RepoRoot $repoRoot -Value $OutputDir
if (-not $resolvedOutputDir) {
  $resolvedOutputDir = Join-Path $repoRoot ".codex-artifacts\windows-agent-external-publish-package"
}
$resolvedOutputDir = [System.IO.Path]::GetFullPath($resolvedOutputDir)

$resolvedReportPath = Resolve-RepoPath -RepoRoot $repoRoot -Value $ReportPath
if (-not $resolvedReportPath) {
  $resolvedReportPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-external-publish-package-report.json"
}
$resolvedReportPath = [System.IO.Path]::GetFullPath($resolvedReportPath)

$resolvedPublishDir = Resolve-RepoPath -RepoRoot $repoRoot -Value $PublishDir
$usesMockPublishDir = [string]::IsNullOrWhiteSpace($resolvedPublishDir)
$mockPublishDir = Join-Path $resolvedOutputDir "mock-winui-publish"
$portableOutputDir = Join-Path $resolvedOutputDir "portable-output"
$bundleRoot = Join-Path $portableOutputDir "DeviceStateConsoleAgent"
$publishVerifyReport = Join-Path $resolvedOutputDir "winui-publish-report.json"
$bundleVerifyReport = Join-Path $resolvedOutputDir "bundle-report.json"
$buildScript = Join-Path $repoRoot "deploy\build-windows-agent-portable.ps1"
$verifyPublishScript = Join-Path $repoRoot "deploy\verify-windows-winui-publish.ps1"
$verifyBundleScript = Join-Path $repoRoot "deploy\verify-windows-agent-bundle.ps1"

if (Test-Path $resolvedOutputDir) {
  Remove-Item -LiteralPath $resolvedOutputDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $portableOutputDir | Out-Null

if ($usesMockPublishDir) {
  New-Item -ItemType Directory -Force -Path $mockPublishDir | Out-Null
  Set-Content -LiteralPath (Join-Path $mockPublishDir "DeviceStateConsoleAgent.WinUI.exe") -Value "" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $mockPublishDir "DeviceStateConsoleAgent.WinUI.dll") -Value "" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $mockPublishDir "DeviceStateConsoleAgent.WinUI.deps.json") -Value "{}" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $mockPublishDir "DeviceStateConsoleAgent.WinUI.runtimeconfig.json") -Value "{}" -Encoding UTF8
  $resolvedPublishDir = $mockPublishDir
}

& powershell -ExecutionPolicy Bypass -File $verifyPublishScript `
  -PublishDir $resolvedPublishDir `
  -ReportPath $publishVerifyReport | Out-Null

$buildArguments = @(
  "-ExecutionPolicy", "Bypass",
  "-File", $buildScript,
  "-OutputDir", $portableOutputDir,
  "-WinUIPublishDir", $resolvedPublishDir
)
if (-not $UseGoBuild) {
  $buildArguments += "-SkipGoBuild"
}
if (-not [string]::IsNullOrWhiteSpace($GoPath)) {
  $buildArguments += @("-GoPath", $GoPath)
}
& powershell @buildArguments | Out-Null

& powershell -ExecutionPolicy Bypass -File $verifyBundleScript `
  -BundleRoot $bundleRoot `
  -SkipBackendSmokeTest `
  -ReportPath $bundleVerifyReport | Out-Null

$publishReport = Get-Content -LiteralPath $publishVerifyReport -Raw | ConvertFrom-Json
$bundleReport = Get-Content -LiteralPath $bundleVerifyReport -Raw | ConvertFrom-Json

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  outputDir = $resolvedOutputDir
  publishDir = $resolvedPublishDir
  usedMockPublishDir = $usesMockPublishDir
  usedGoBuild = [bool]$UseGoBuild
  bundleRoot = $bundleRoot
  checks = [ordered]@{
    publishDirValidated = [bool]$publishReport.passed
    bundleFrontendPresent = [bool]$bundleReport.files.($bundleRoot + "\DeviceStateConsoleAgent.WinUI.exe").exists
    bundleBackendPresent = [bool]$bundleReport.files.((Join-Path $bundleRoot "backend\windows-agent-backend.exe")).exists
    bundleCollectorPresent = [bool]$bundleReport.files.((Join-Path $bundleRoot "backend\device-state-console-agent.exe")).exists
    bundleHardwarePresent = [bool]$bundleReport.files.((Join-Path $bundleRoot "backend\windows-hardware")).exists
  }
  reports = [ordered]@{
    publish = $publishVerifyReport
    bundle = $bundleVerifyReport
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8

if (-not $report.checks.publishDirValidated -or
    -not $report.checks.bundleFrontendPresent -or
    -not $report.checks.bundleBackendPresent -or
    -not $report.checks.bundleCollectorPresent -or
    -not $report.checks.bundleHardwarePresent) {
  throw "External WinUI publish package verification failed. See report: $resolvedReportPath"
}

Write-Host "External WinUI publish package verification passed."
Write-Host "Bundle root: $bundleRoot"
Write-Host "Report: $resolvedReportPath"
