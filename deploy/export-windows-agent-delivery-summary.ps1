param(
  [string]$BuildPrereqsReportPath = "",
  [string]$ReleaseReadinessReportPath = "",
  [string]$ExternalPublishPackageReportPath = "",
  [string]$ObjectiveAuditPath = "",
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Resolve-RepoPath {
  param(
    [string]$RepoRoot,
    [string]$Value,
    [string]$FallbackPath
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return [System.IO.Path]::GetFullPath($FallbackPath)
  }

  if ([System.IO.Path]::IsPathRooted($Value)) {
    return [System.IO.Path]::GetFullPath($Value)
  }

  try {
    return (Resolve-Path -LiteralPath $Value -ErrorAction Stop).Path
  } catch {
  }

  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Value))
}

function Resolve-PreferredReportPath {
  param(
    [string]$RepoRoot,
    [string]$Value,
    [string[]]$PreferredPaths
  )

  if (-not [string]::IsNullOrWhiteSpace($Value)) {
    return Resolve-RepoPath -RepoRoot $RepoRoot -Value $Value -FallbackPath $PreferredPaths[0]
  }

  foreach ($candidate in $PreferredPaths) {
    $resolvedCandidate = [System.IO.Path]::GetFullPath($candidate)
    if (Test-Path -LiteralPath $resolvedCandidate) {
      return $resolvedCandidate
    }
  }

  return [System.IO.Path]::GetFullPath($PreferredPaths[0])
}

function Read-JsonRequired {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Required report not found: $Path"
  }

  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Add-Line {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    [AllowEmptyString()]
    [string]$Text = ""
  )

  $Lines.Add($Text) | Out-Null
}

function Add-Bullets {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    $Items
  )

  $resolvedItems = @()
  if ($null -ne $Items) {
    $resolvedItems = @($Items | Where-Object { $null -ne $_ -and "$_".Trim() -ne "" })
  }

  if ($resolvedItems.Count -eq 0) {
    Add-Line -Lines $Lines -Text "- None"
    return
  }

  foreach ($item in $resolvedItems) {
    Add-Line -Lines $Lines -Text ("- " + [string]$item)
  }
}

function Get-CombinedBlockers {
  param(
    $PortableBuildBlockedBy,
    $SetupBuildBlockedBy
  )

  $items = @()
  if ($null -ne $PortableBuildBlockedBy) {
    $items += @($PortableBuildBlockedBy)
  }
  if ($null -ne $SetupBuildBlockedBy) {
    $items += @($SetupBuildBlockedBy)
  }

  return @(
    $items |
      Where-Object { $null -ne $_ -and "$_".Trim() -ne "" } |
      Select-Object -Unique
  )
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedBuildPrereqsReportPath = Resolve-PreferredReportPath -RepoRoot $repoRoot -Value $BuildPrereqsReportPath -PreferredPaths @(
  (Join-Path $repoRoot "release\windows-build-prereqs-report.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-build-prereqs-report.json")
)
$resolvedReleaseReadinessReportPath = Resolve-PreferredReportPath -RepoRoot $repoRoot -Value $ReleaseReadinessReportPath -PreferredPaths @(
  (Join-Path $repoRoot "release\windows-agent-release-readiness-report.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-release-readiness-report.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-release-readiness-artifact-evidence.json")
)
$resolvedExternalPublishPackageReportPath = Resolve-PreferredReportPath -RepoRoot $repoRoot -Value $ExternalPublishPackageReportPath -PreferredPaths @(
  (Join-Path $repoRoot "release\windows-agent-external-publish-package\external-publish-package-report.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-external-publish-package\external-publish-package-report.json")
)
$resolvedObjectiveAuditPath = Resolve-PreferredReportPath -RepoRoot $repoRoot -Value $ObjectiveAuditPath -PreferredPaths @(
  (Join-Path $repoRoot "release\windows-agent-objective-audit.md"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-objective-audit.md")
)
$resolvedOutputPath = Resolve-RepoPath -RepoRoot $repoRoot -Value $OutputPath -FallbackPath (Join-Path $repoRoot "release\windows-agent-delivery-summary.md")

$buildPrereqsReport = Read-JsonRequired -Path $resolvedBuildPrereqsReportPath
$releaseReadinessReport = Read-JsonRequired -Path $resolvedReleaseReadinessReportPath
$externalPublishPackageReport = Read-JsonRequired -Path $resolvedExternalPublishPackageReportPath
$suiteSummaryPath = if ($releaseReadinessReport.evidence -and $releaseReadinessReport.evidence.portableSuite) {
  [string]$releaseReadinessReport.evidence.portableSuite.summaryPath
} else {
  ""
}
$setupLifecycleSummaryPath = if ($releaseReadinessReport.evidence -and $releaseReadinessReport.evidence.setupLifecycle) {
  [string]$releaseReadinessReport.evidence.setupLifecycle.summaryPath
} else {
  ""
}
$suiteSummary = if ([string]::IsNullOrWhiteSpace($suiteSummaryPath)) { $null } else { Read-JsonRequired -Path $suiteSummaryPath }
$setupLifecycleSummary = if ([string]::IsNullOrWhiteSpace($setupLifecycleSummaryPath)) { $null } else { Read-JsonRequired -Path $setupLifecycleSummaryPath }

$lines = New-Object 'System.Collections.Generic.List[string]'

Add-Line -Lines $lines -Text "# Windows Agent Delivery Summary"
Add-Line -Lines $lines
Add-Line -Lines $lines -Text ("- Generated at: " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz"))
Add-Line -Lines $lines -Text ("- Repository: " + $repoRoot)
Add-Line -Lines $lines

Add-Line -Lines $lines -Text "## Overall Status"
Add-Line -Lines $lines
Add-Line -Lines $lines -Text ("- Release readiness passed: " + [string]$releaseReadinessReport.summary.passed)
Add-Line -Lines $lines -Text ("- Blocked by toolchain: " + [string]$releaseReadinessReport.status.blockedByToolchain)
Add-Line -Lines $lines -Text ("- Portable build ready: " + [string]$releaseReadinessReport.status.portableBuildReady)
Add-Line -Lines $lines -Text ("- Setup build ready: " + [string]$releaseReadinessReport.status.setupBuildReady)
Add-Line -Lines $lines -Text ("- External publish package verified: " + [string]$releaseReadinessReport.status.externalPublishPackageVerified)
Add-Line -Lines $lines -Text ("- Portable suite verified: " + [string]$releaseReadinessReport.status.portableSuiteVerified)
Add-Line -Lines $lines -Text ("- Setup lifecycle verified: " + [string]$releaseReadinessReport.status.setupLifecycleVerified)
if ($null -ne $releaseReadinessReport.status.PSObject.Properties["setupLifecycleExecutionVerified"]) {
  Add-Line -Lines $lines -Text ("- Setup lifecycle executed for real installer flow: " + [string]$releaseReadinessReport.status.setupLifecycleExecutionVerified)
}
Add-Line -Lines $lines -Text ("- Portable artifact state verified: " + [string]$releaseReadinessReport.status.portableArtifactStateVerified)
Add-Line -Lines $lines -Text ("- Installed artifact state verified: " + [string]$releaseReadinessReport.status.installedArtifactStateVerified)
Add-Line -Lines $lines -Text ("- Local artifact state verified: " + [string]$releaseReadinessReport.status.localArtifactStateVerified)
Add-Line -Lines $lines -Text ("- Issue diagnosis verified: " + [string]$releaseReadinessReport.status.issueDiagnosisVerified)
Add-Line -Lines $lines -Text ("- Control stream verified: " + [string]$releaseReadinessReport.status.controlStreamVerified)
if ($suiteSummary -and $suiteSummary.checks -and $null -ne $suiteSummary.checks.PSObject.Properties["instanceMetricConfigMatched"]) {
  Add-Line -Lines $lines -Text ("- Instance metric config verified: " + [string]$suiteSummary.checks.instanceMetricConfigMatched)
}
if ($suiteSummary -and $suiteSummary.checks -and $null -ne $suiteSummary.checks.PSObject.Properties["viewerRealtimeHoldPassed"]) {
  Add-Line -Lines $lines -Text ("- Viewer realtime hold-window verified: " + [string]$suiteSummary.checks.viewerRealtimeHoldPassed)
}
Add-Line -Lines $lines

Add-Line -Lines $lines -Text "## Current Blockers"
Add-Line -Lines $lines
$currentBlockers = Get-CombinedBlockers `
  -PortableBuildBlockedBy $releaseReadinessReport.remediation.portableBuildBlockedBy `
  -SetupBuildBlockedBy $releaseReadinessReport.remediation.setupBuildBlockedBy
Add-Bullets -Lines $lines -Items $currentBlockers
Add-Line -Lines $lines

Add-Line -Lines $lines -Text "## Next Steps"
Add-Line -Lines $lines
Add-Bullets -Lines $lines -Items $releaseReadinessReport.remediation.nextSteps
Add-Line -Lines $lines

Add-Line -Lines $lines -Text "## Recommended Commands"
Add-Line -Lines $lines
Add-Bullets -Lines $lines -Items $releaseReadinessReport.remediation.recommendedCommands
Add-Line -Lines $lines

Add-Line -Lines $lines -Text "## Evidence Snapshot"
Add-Line -Lines $lines
Add-Line -Lines $lines -Text ("- Build prereqs report: " + $resolvedBuildPrereqsReportPath)
Add-Line -Lines $lines -Text ("- Release readiness report: " + $resolvedReleaseReadinessReportPath)
Add-Line -Lines $lines -Text ("- Release readiness verified at: " + [string]$releaseReadinessReport.verifiedAt)
Add-Line -Lines $lines -Text ("- External publish package report: " + $resolvedExternalPublishPackageReportPath)
if (Test-Path -LiteralPath $resolvedObjectiveAuditPath) {
  Add-Line -Lines $lines -Text ("- Objective audit report: " + $resolvedObjectiveAuditPath)
}
Add-Line -Lines $lines -Text ("- External publish used mock publish dir: " + [string]$externalPublishPackageReport.usedMockPublishDir)
Add-Line -Lines $lines -Text ("- External publish used Go build: " + [string]$externalPublishPackageReport.usedGoBuild)
Add-Line -Lines $lines -Text ("- External publish dir: " + [string]$externalPublishPackageReport.publishDir)
Add-Line -Lines $lines -Text ("- External publish bundle root: " + [string]$externalPublishPackageReport.bundleRoot)
Add-Line -Lines $lines -Text ("- WinUI project target framework: " + [string]$buildPrereqsReport.winUiProjectConfig.targetFramework)
Add-Line -Lines $lines -Text ("- WinUI project Windows App SDK: " + [string]$buildPrereqsReport.winUiProjectConfig.windowsAppSdkVersion)
Add-Line -Lines $lines -Text ("- Go version: " + [string]$buildPrereqsReport.go.version)
if ($releaseReadinessReport.evidence.portableSuite.available) {
  Add-Line -Lines $lines -Text ("- Portable suite summary report: " + $suiteSummaryPath)
  if ($suiteSummary -and $suiteSummary.verifiedAt) {
    Add-Line -Lines $lines -Text ("- Portable suite verified at: " + [string]$suiteSummary.verifiedAt)
  }
  Add-Line -Lines $lines -Text ("- Portable artifact state verified in bundle flow: " + [string]$releaseReadinessReport.evidence.portableSuite.bundleArtifactStatePassed)
  Add-Line -Lines $lines -Text ("- Portable artifact state verified in first-run flow: " + [string]$releaseReadinessReport.evidence.portableSuite.firstRunArtifactStatePassed)
  if ($suiteSummary -and $suiteSummary.reports -and $null -ne $suiteSummary.reports.PSObject.Properties["instanceMetricConfig"]) {
    Add-Line -Lines $lines -Text ("- Instance metric config report: " + [string]$suiteSummary.reports.instanceMetricConfig)
  }
  if ($suiteSummary -and $suiteSummary.checks -and $null -ne $suiteSummary.checks.PSObject.Properties["instanceMetricConfigMatched"]) {
    Add-Line -Lines $lines -Text ("- Instance metric config matched in suite: " + [string]$suiteSummary.checks.instanceMetricConfigMatched)
  }
  if ($suiteSummary -and $suiteSummary.reports -and $null -ne $suiteSummary.reports.PSObject.Properties["viewerRealtimeHold"]) {
    Add-Line -Lines $lines -Text ("- Viewer realtime hold-window report: " + [string]$suiteSummary.reports.viewerRealtimeHold)
  }
  if ($suiteSummary -and $suiteSummary.checks -and $null -ne $suiteSummary.checks.PSObject.Properties["viewerRealtimePassed"]) {
    Add-Line -Lines $lines -Text ("- Viewer realtime passed in suite: " + [string]$suiteSummary.checks.viewerRealtimePassed)
  }
  if ($suiteSummary -and $suiteSummary.checks -and $null -ne $suiteSummary.checks.PSObject.Properties["viewerRealtimeHoldPassed"]) {
    Add-Line -Lines $lines -Text ("- Viewer realtime hold-window passed in suite: " + [string]$suiteSummary.checks.viewerRealtimeHoldPassed)
  }
}
if ($releaseReadinessReport.evidence.setupLifecycle.available) {
  Add-Line -Lines $lines -Text ("- Setup lifecycle summary report: " + $setupLifecycleSummaryPath)
  if ($setupLifecycleSummary -and $setupLifecycleSummary.verifiedAt) {
    Add-Line -Lines $lines -Text ("- Setup lifecycle verified at: " + [string]$setupLifecycleSummary.verifiedAt)
  }
  if ($releaseReadinessReport.evidence.setupLifecycle.PSObject.Properties["setupPackagingVerified"]) {
    Add-Line -Lines $lines -Text ("- Setup packaging verified: " + [string]$releaseReadinessReport.evidence.setupLifecycle.setupPackagingVerified)
  }
  if ($releaseReadinessReport.evidence.setupLifecycle.PSObject.Properties["setupInstalledLayoutVerified"]) {
    Add-Line -Lines $lines -Text ("- Setup installed-layout verified: " + [string]$releaseReadinessReport.evidence.setupLifecycle.setupInstalledLayoutVerified)
  }
  if ($releaseReadinessReport.evidence.setupLifecycle.PSObject.Properties["setupUninstallBehaviorVerified"]) {
    Add-Line -Lines $lines -Text ("- Setup uninstall behavior verified: " + [string]$releaseReadinessReport.evidence.setupLifecycle.setupUninstallBehaviorVerified)
  }
  if ($releaseReadinessReport.evidence.setupLifecycle.PSObject.Properties["setupLifecycleExecutionVerified"]) {
    Add-Line -Lines $lines -Text ("- Setup lifecycle real execution verified: " + [string]$releaseReadinessReport.evidence.setupLifecycle.setupLifecycleExecutionVerified)
  }
  if ($releaseReadinessReport.evidence.setupLifecycle.PSObject.Properties["setupLifecycleUsedSimulatedPaths"]) {
    Add-Line -Lines $lines -Text ("- Setup lifecycle used simulated paths: " + [string]$releaseReadinessReport.evidence.setupLifecycle.setupLifecycleUsedSimulatedPaths)
  }
  Add-Line -Lines $lines -Text ("- Setup lifecycle installed-layout report: " + [string]$releaseReadinessReport.evidence.setupLifecycle.installedLayoutReportPath)
}
Add-Line -Lines $lines

if ($releaseReadinessReport.evidence.portableSuite.available -and $releaseReadinessReport.evidence.portableSuite.portableArtifactState) {
  Add-Line -Lines $lines -Text "## Local Artifact Evidence"
  Add-Line -Lines $lines
  Add-Line -Lines $lines -Text ("- Bundle flow config file reported: " + [string]$releaseReadinessReport.evidence.portableSuite.portableArtifactState.bundleConfigFileExists)
  Add-Line -Lines $lines -Text ("- Bundle flow sync-state reported: " + [string]$releaseReadinessReport.evidence.portableSuite.portableArtifactState.bundleSyncStateFileExists)
  Add-Line -Lines $lines -Text ("- Bundle flow diagnostics reported: " + [string]$releaseReadinessReport.evidence.portableSuite.portableArtifactState.bundleDiagnosticsFileExists)
  Add-Line -Lines $lines -Text ("- First-run config file reported: " + [string]$releaseReadinessReport.evidence.portableSuite.portableArtifactState.firstRunConfigFileExists)
  Add-Line -Lines $lines -Text ("- First-run sync-state initially missing: " + [string]$releaseReadinessReport.evidence.portableSuite.portableArtifactState.firstRunSyncStateMissing)
  Add-Line -Lines $lines -Text ("- First-run diagnostics reported: " + [string]$releaseReadinessReport.evidence.portableSuite.portableArtifactState.firstRunDiagnosticsFileExists)
  Add-Line -Lines $lines -Text ("- First display-change sync-state reported: " + [string]$releaseReadinessReport.evidence.portableSuite.portableArtifactState.firstDisplayChangeSyncStateExists)
  Add-Line -Lines $lines
}

if (
  $releaseReadinessReport.evidence.setupLifecycle.available -and
  $releaseReadinessReport.evidence.setupLifecycle.installedArtifactState -and
  [bool]$releaseReadinessReport.evidence.setupLifecycle.installedArtifactState.available
) {
  Add-Line -Lines $lines -Text "## Installed Artifact Evidence"
  Add-Line -Lines $lines
  Add-Line -Lines $lines -Text ("- Installed-mode config file reported: " + [string]$releaseReadinessReport.evidence.setupLifecycle.installedArtifactState.configFileExistsReported)
  Add-Line -Lines $lines -Text ("- Installed-mode diagnostics reported: " + [string]$releaseReadinessReport.evidence.setupLifecycle.installedArtifactState.diagnosticsFileExistsReported)
  Add-Line -Lines $lines -Text ("- Installed-mode sync-state already present before display change: " + [string]$releaseReadinessReport.evidence.setupLifecycle.installedArtifactState.syncStateFileExistsReported)
  Add-Line -Lines $lines -Text ("- Installed-mode sync-state verified after display change: " + [string]$releaseReadinessReport.evidence.setupLifecycle.installedArtifactState.syncStateVerifiedAfterDisplayChange)
  Add-Line -Lines $lines -Text ("- Installed-mode cloudConfigPending observed after display change: " + [string]$releaseReadinessReport.evidence.setupLifecycle.installedArtifactState.cloudConfigPendingAfterDisplayChange)
  if (-not [bool]$releaseReadinessReport.evidence.setupLifecycle.installedArtifactState.syncStateFileExistsReported) {
    Add-Line -Lines $lines -Text "- Note: installed-mode sync-state is allowed to be absent before the first display-config change."
  }
  Add-Line -Lines $lines
}

Add-Line -Lines $lines -Text "## Failed Checks"
Add-Line -Lines $lines
Add-Bullets -Lines $lines -Items $releaseReadinessReport.summary.failedChecks
Add-Line -Lines $lines

if (Test-Path -LiteralPath $resolvedObjectiveAuditPath) {
  Add-Line -Lines $lines -Text "## Objective Audit"
  Add-Line -Lines $lines
  Add-Line -Lines $lines -Text ("- Objective audit report: " + $resolvedObjectiveAuditPath)
  Add-Line -Lines $lines -Text "- Use this report when you want requirement-by-requirement status against the original Windows agent objective, instead of only build and verification gates."
  Add-Line -Lines $lines
}

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedOutputPath -Parent) | Out-Null
[System.IO.File]::WriteAllLines($resolvedOutputPath, $lines, [System.Text.Encoding]::UTF8)

Write-Host "Windows agent delivery summary exported."
Write-Host ("Output: " + $resolvedOutputPath)
