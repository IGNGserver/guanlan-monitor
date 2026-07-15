param(
  [string]$TemplateReportPath = "",
  [string]$GeneratedReportPath = "",
  [string]$InstalledLayoutReportPath = "",
  [string]$UninstallRetainedReportPath = "",
  [string]$UninstallDeletedReportPath = "",
  [string]$ReportPath = "",
  [switch]$RequireInstalledLayout,
  [switch]$RequireUninstallRetained,
  [switch]$RequireUninstallDeleted
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

function Read-JsonIfExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Test-Truthy {
  param($Value)

  return ($null -ne $Value -and [bool]$Value)
}

function Test-IsArtifactPath {
  param(
    [string]$RepoRoot,
    [string]$CandidatePath
  )

  if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
    return $false
  }

  $resolvedRepoArtifacts = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".codex-artifacts"))
  $resolvedCandidate = [System.IO.Path]::GetFullPath($CandidatePath)
  return $resolvedCandidate.StartsWith($resolvedRepoArtifacts, [System.StringComparison]::OrdinalIgnoreCase)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedTemplateReportPath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $TemplateReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-setup-template-report.json")
$resolvedGeneratedReportPath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $GeneratedReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-setup-generated-report.json")
$resolvedInstalledLayoutReportPath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $InstalledLayoutReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-installed-layout-report.json")
$resolvedUninstallRetainedReportPath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $UninstallRetainedReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-uninstall-retained-report.json")
$resolvedUninstallDeletedReportPath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $UninstallDeletedReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-uninstall-deleted-report.json")
$resolvedReportPath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $ReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-setup-lifecycle-report.json")

$templateReport = Read-JsonIfExists -Path $resolvedTemplateReportPath
$generatedReport = Read-JsonIfExists -Path $resolvedGeneratedReportPath
$installedLayoutReport = Read-JsonIfExists -Path $resolvedInstalledLayoutReportPath
$uninstallRetainedReport = Read-JsonIfExists -Path $resolvedUninstallRetainedReportPath
$uninstallDeletedReport = Read-JsonIfExists -Path $resolvedUninstallDeletedReportPath

$installedLayoutLooksSimulated = $false
if ($installedLayoutReport) {
  $installedLayoutLooksSimulated =
    (Test-IsArtifactPath -RepoRoot $repoRoot -CandidatePath ([string]$installedLayoutReport.installRoot)) -or
    (Test-IsArtifactPath -RepoRoot $repoRoot -CandidatePath ([string]$installedLayoutReport.configRoot)) -or
    (Test-IsArtifactPath -RepoRoot $repoRoot -CandidatePath ([string]$installedLayoutReport.startMenuProgramsRoot))
}

$uninstallRetainedLooksSimulated = $false
if ($uninstallRetainedReport) {
  $uninstallRetainedLooksSimulated =
    (Test-IsArtifactPath -RepoRoot $repoRoot -CandidatePath ([string]$uninstallRetainedReport.installRoot)) -or
    (Test-IsArtifactPath -RepoRoot $repoRoot -CandidatePath ([string]$uninstallRetainedReport.configRoot)) -or
    (Test-IsArtifactPath -RepoRoot $repoRoot -CandidatePath ([string]$uninstallRetainedReport.startMenuProgramsRoot))
}

$uninstallDeletedLooksSimulated = $false
if ($uninstallDeletedReport) {
  $uninstallDeletedLooksSimulated =
    (Test-IsArtifactPath -RepoRoot $repoRoot -CandidatePath ([string]$uninstallDeletedReport.installRoot)) -or
    (Test-IsArtifactPath -RepoRoot $repoRoot -CandidatePath ([string]$uninstallDeletedReport.configRoot)) -or
    (Test-IsArtifactPath -RepoRoot $repoRoot -CandidatePath ([string]$uninstallDeletedReport.startMenuProgramsRoot))
}

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  inputs = [ordered]@{
    templateReportPath = $resolvedTemplateReportPath
    generatedReportPath = $resolvedGeneratedReportPath
    installedLayoutReportPath = $resolvedInstalledLayoutReportPath
    uninstallRetainedReportPath = $resolvedUninstallRetainedReportPath
    uninstallDeletedReportPath = $resolvedUninstallDeletedReportPath
  }
  requirements = [ordered]@{
    installedLayoutRequired = [bool]$RequireInstalledLayout
    uninstallRetainedRequired = [bool]$RequireUninstallRetained
    uninstallDeletedRequired = [bool]$RequireUninstallDeleted
  }
  stages = [ordered]@{
    template = [ordered]@{
      reportExists = ($null -ne $templateReport)
      passed = $false
    }
    generated = [ordered]@{
      reportExists = ($null -ne $generatedReport)
      passed = $false
    }
    installedLayout = [ordered]@{
      reportExists = ($null -ne $installedLayoutReport)
      required = [bool]$RequireInstalledLayout
      passed = $false
      requireConfigArtifacts = $false
      requireSyncStateAfterDisplayChange = $false
      artifactState = [ordered]@{
        available = $false
        configFileExistsReported = $false
        diagnosticsFileExistsReported = $false
        syncStateFileExistsReported = $false
        syncStateVerifiedAfterDisplayChange = $false
        cloudConfigPendingAfterDisplayChange = $false
      }
    }
    uninstallRetained = [ordered]@{
      reportExists = ($null -ne $uninstallRetainedReport)
      required = [bool]$RequireUninstallRetained
      passed = $false
    }
    uninstallDeleted = [ordered]@{
      reportExists = ($null -ne $uninstallDeletedReport)
      required = [bool]$RequireUninstallDeleted
      passed = $false
    }
  }
  status = [ordered]@{
    setupPackagingVerified = $false
    setupInstalledLayoutVerified = $false
    setupUninstallBehaviorVerified = $false
    setupLifecycleExecutionVerified = $false
    setupLifecycleUsedSimulatedPaths = $false
    installedArtifactStateVerified = $false
    localArtifactStateVerified = $false
  }
}

if ($templateReport) {
  $checks = $templateReport.checks
  $report.stages.template.passed =
    (Test-Truthy $checks.appInstallDirConfigured) -and
    (Test-Truthy $checks.localConfigDirUsed) -and
    (Test-Truthy $checks.startMenuShortcutConfigured) -and
    (Test-Truthy $checks.desktopShortcutTaskConfigured) -and
    (Test-Truthy $checks.uninstallPromptPresent)
}

if ($generatedReport) {
  $checks = $generatedReport.checks
  $assets = $generatedReport.bundleAssets
  $report.stages.generated.passed =
    (Test-Truthy $checks.generatedIssExists) -and
    (Test-Truthy $checks.startMenuShortcutRetained) -and
    (Test-Truthy $checks.desktopShortcutTaskRetained) -and
    (Test-Truthy $checks.uninstallPromptRetained) -and
    (Test-Truthy $assets.frontendExeExists) -and
    (Test-Truthy $assets.backendExeExists) -and
    (Test-Truthy $assets.collectorExeExists)
}

if ($installedLayoutReport) {
  $checks = $installedLayoutReport.checks
  $backend = $installedLayoutReport.backendSmokeTest
  $report.stages.installedLayout.requireConfigArtifacts = (Test-Truthy $installedLayoutReport.requireConfigArtifacts)
  $report.stages.installedLayout.requireSyncStateAfterDisplayChange = (Test-Truthy $installedLayoutReport.requireSyncStateAfterDisplayChange)
  $report.stages.installedLayout.artifactState.available =
    ($null -ne $backend -and $null -ne $backend.PSObject.Properties["configFileExistsReported"])
  if ($report.stages.installedLayout.artifactState.available) {
    $report.stages.installedLayout.artifactState.configFileExistsReported = (Test-Truthy $backend.configFileExistsReported)
    $report.stages.installedLayout.artifactState.diagnosticsFileExistsReported = (Test-Truthy $backend.diagnosticsFileExistsReported)
    $report.stages.installedLayout.artifactState.syncStateFileExistsReported = (Test-Truthy $backend.syncStateFileExistsReported)
    $report.stages.installedLayout.artifactState.syncStateVerifiedAfterDisplayChange = (Test-Truthy $backend.syncStateFileExistsReportedAfterDisplayChange)
    $report.stages.installedLayout.artifactState.cloudConfigPendingAfterDisplayChange = (Test-Truthy $backend.cloudConfigPendingAfterDisplayChange)
  }
  $artifactStatePassed = $true
  if ($report.stages.installedLayout.requireConfigArtifacts) {
    $artifactStatePassed =
      $report.stages.installedLayout.artifactState.available -and
      $report.stages.installedLayout.artifactState.configFileExistsReported -and
      $report.stages.installedLayout.artifactState.diagnosticsFileExistsReported -and
      (
        (-not (Test-Truthy $checks.syncStateFileObserved)) -or
        $report.stages.installedLayout.artifactState.syncStateFileExistsReported
      )
  }
  if ($report.stages.installedLayout.requireSyncStateAfterDisplayChange) {
    $artifactStatePassed =
      $artifactStatePassed -and
      $report.stages.installedLayout.artifactState.syncStateVerifiedAfterDisplayChange -and
      $report.stages.installedLayout.artifactState.cloudConfigPendingAfterDisplayChange
  }
  $report.stages.installedLayout.passed =
    (Test-Truthy $checks.frontendExeExists) -and
    (Test-Truthy $checks.backendExeExists) -and
    (Test-Truthy $checks.collectorExeExists) -and
    (Test-Truthy $checks.startMenuShortcutExists) -and
    (Test-Truthy $checks.uninstallerExists) -and
    (Test-Truthy $checks.installRootHasNoLocalConfig) -and
    (Test-Truthy $backend.passed) -and
    $artifactStatePassed

  $report.status.installedArtifactStateVerified =
    $report.stages.installedLayout.artifactState.available -and
    $report.stages.installedLayout.artifactState.configFileExistsReported -and
    $report.stages.installedLayout.artifactState.diagnosticsFileExistsReported -and
    $report.stages.installedLayout.artifactState.syncStateVerifiedAfterDisplayChange -and
    $report.stages.installedLayout.artifactState.cloudConfigPendingAfterDisplayChange

  $report.status.setupInstalledLayoutVerified = $report.stages.installedLayout.passed
}

if ($uninstallRetainedReport) {
  $checks = $uninstallRetainedReport.checks
  $report.stages.uninstallRetained.passed =
    (Test-Truthy $checks.installRootRemoved) -and
    (Test-Truthy $checks.startMenuShortcutRemoved) -and
    (Test-Truthy $checks.uninstallRegistryEntryRemoved) -and
    (Test-Truthy $checks.configRootStateMatchesExpectation)
}

if ($uninstallDeletedReport) {
  $checks = $uninstallDeletedReport.checks
  $report.stages.uninstallDeleted.passed =
    (Test-Truthy $checks.installRootRemoved) -and
    (Test-Truthy $checks.startMenuShortcutRemoved) -and
    (Test-Truthy $checks.uninstallRegistryEntryRemoved) -and
    (Test-Truthy $checks.configRootStateMatchesExpectation)
}

$report.status.setupPackagingVerified =
  $report.stages.template.passed -and
  $report.stages.generated.passed

$report.status.setupUninstallBehaviorVerified =
  $report.stages.uninstallRetained.passed -and
  $report.stages.uninstallDeleted.passed

$report.status.setupLifecycleUsedSimulatedPaths =
  $installedLayoutLooksSimulated -or
  $uninstallRetainedLooksSimulated -or
  $uninstallDeletedLooksSimulated

$report.status.setupLifecycleExecutionVerified =
  $report.stages.installedLayout.passed -and
  $report.stages.uninstallRetained.passed -and
  $report.stages.uninstallDeleted.passed -and
  (-not $report.status.setupLifecycleUsedSimulatedPaths)

$failedStages = @()
foreach ($stageName in @("template", "generated", "installedLayout", "uninstallRetained", "uninstallDeleted")) {
  $stage = $report.stages[$stageName]
  if (-not $stage.reportExists) {
    if ($stage.required -or $stageName -in @("template", "generated")) {
      $failedStages += "$stageName.missing"
    }
    continue
  }

  if (-not $stage.passed) {
    $failedStages += "$stageName.failed"
  }
}

$report.summary = [ordered]@{
  passed = ($failedStages.Count -eq 0)
  failedStages = $failedStages
}

$report.status.localArtifactStateVerified = $report.status.installedArtifactStateVerified

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8

if ($failedStages.Count -gt 0) {
  throw "Setup lifecycle verification failed: $($failedStages -join ', ')"
}

Write-Host "Setup lifecycle verification passed."
Write-Host "Report: $resolvedReportPath"
