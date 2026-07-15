param(
  [string]$BuildPrereqsReportPath = "",
  [string]$SuiteSummaryPath = "",
  [string]$SetupLifecycleReportPath = "",
  [string]$ExternalPublishPackageReportPath = "",
  [string]$ReportPath = "",
  [switch]$RequirePortableSuite,
  [switch]$RequireSetupLifecycle
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-JsonReportWithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [object]$Data,

    [int]$MaxAttempts = 8,
    [int]$DelayMilliseconds = 250
  )

  $json = $Data | ConvertTo-Json -Depth 8
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      Set-Content -LiteralPath $Path -Value $json -Encoding UTF8
      return
    } catch {
      if ($attempt -ge $MaxAttempts) {
        throw
      }
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }
}

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

function Resolve-PreferredOptionalPath {
  param(
    [string]$RepoRoot,
    [string]$PathValue,
    [string[]]$PreferredPaths
  )

  if (-not [string]::IsNullOrWhiteSpace($PathValue)) {
    return Resolve-OptionalPath -RepoRoot $RepoRoot -PathValue $PathValue -FallbackPath $PreferredPaths[0]
  }

  foreach ($candidate in $PreferredPaths) {
    $resolvedCandidate = [System.IO.Path]::GetFullPath($candidate)
    if (Test-Path -LiteralPath $resolvedCandidate) {
      return $resolvedCandidate
    }
  }

  return [System.IO.Path]::GetFullPath($PreferredPaths[0])
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

function Get-BoolProperty {
  param(
    $Object,
    [string]$Name
  )

  if ($null -eq $Object) {
    return $false
  }

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $false
  }

  return Test-Truthy $property.Value
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedBuildPrereqsReportPath = Resolve-PreferredOptionalPath -RepoRoot $repoRoot -PathValue $BuildPrereqsReportPath -PreferredPaths @(
  (Join-Path $repoRoot "release\windows-build-prereqs-report.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-build-prereqs-report.json")
)
$resolvedSuiteSummaryPath = Resolve-PreferredOptionalPath -RepoRoot $repoRoot -PathValue $SuiteSummaryPath -PreferredPaths @(
  (Join-Path $repoRoot "release\windows-agent-suite\suite-summary.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-suite\suite-summary.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-suite-controlstream\suite-summary.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-suite-artifact-evidence\suite-summary.json")
)
$resolvedSetupLifecycleReportPath = Resolve-PreferredOptionalPath -RepoRoot $repoRoot -PathValue $SetupLifecycleReportPath -PreferredPaths @(
  (Join-Path $repoRoot "release\windows-agent-setup-execution\windows-agent-setup-lifecycle-report.json"),
  (Join-Path $repoRoot "release\windows-agent-setup-lifecycle-report.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-setup-lifecycle-report.json")
)
$resolvedExternalPublishPackageReportPath = Resolve-PreferredOptionalPath -RepoRoot $repoRoot -PathValue $ExternalPublishPackageReportPath -PreferredPaths @(
  (Join-Path $repoRoot "release\windows-agent-external-publish-package\external-publish-package-report.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-external-publish-package\external-publish-package-report.json")
)
$resolvedReportPath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $ReportPath -FallbackPath (Join-Path $repoRoot "release\windows-agent-release-readiness-report.json")

$buildPrereqsReport = Read-JsonIfExists -Path $resolvedBuildPrereqsReportPath
$suiteSummary = Read-JsonIfExists -Path $resolvedSuiteSummaryPath
$setupLifecycleReport = Read-JsonIfExists -Path $resolvedSetupLifecycleReportPath
$externalPublishPackageReport = Read-JsonIfExists -Path $resolvedExternalPublishPackageReportPath

$portableSuitePassed = $false
if ($suiteSummary -and $suiteSummary.checks) {
  $checks = $suiteSummary.checks
  $issueRecoveryCheckPassed = $true
  if ($null -ne $checks.PSObject.Properties["issueCategoryRecoveryObserved"]) {
    $issueRecoveryCheckPassed = Test-Truthy $checks.issueCategoryRecoveryObserved
  }
  $portableSuitePassed =
    (Test-Truthy $checks.bundleSmokePassed) -and
    (Test-Truthy $checks.autorestartObserved) -and
    (Test-Truthy $checks.issueCategoryObserved) -and
    $issueRecoveryCheckPassed -and
    (Test-Truthy $checks.explicitCloudPushPassed) -and
    (Test-Truthy $checks.cloudPendingPersistencePassed) -and
    (Test-Truthy $checks.cloudPendingBoundaryPassed) -and
    (Test-Truthy $checks.localConfigPayloadMatched) -and
    (Test-Truthy $checks.instanceMetricConfigMatched) -and
    (Test-Truthy $checks.parentExitCleanupPassed) -and
    (Test-Truthy $checks.manualRealtimePassed) -and
    (Test-Truthy $checks.viewerRealtimePassed) -and
    (Test-Truthy $checks.viewerRealtimeHoldPassed) -and
    (Test-Truthy $checks.controlStreamFallbackPassed) -and
    (Test-Truthy $checks.controlStreamKeepalivePassed) -and
    (Test-Truthy $checks.controlStreamRecoveringPassed) -and
    (Test-Truthy $checks.firstRunPathsPassed) -and
    (Test-Truthy $checks.firstRunArtifactStatePassed) -and
    (Test-Truthy $checks.firstRunControlStreamDefaultsPassed) -and
    (Test-Truthy $checks.bundleArtifactStatePassed) -and
    (Test-Truthy $checks.connectionCheckPassed)
}

$setupLifecyclePassed = $false
if ($setupLifecycleReport -and $setupLifecycleReport.summary) {
  $setupLifecyclePassed = Test-Truthy $setupLifecycleReport.summary.passed
}

$setupLifecycleExecutionVerified = $false
if ($setupLifecycleReport -and $setupLifecycleReport.status) {
  $setupLifecycleExecutionVerified = Get-BoolProperty -Object $setupLifecycleReport.status -Name "setupLifecycleExecutionVerified"
}

$externalPublishPackagePassed = $false
if ($externalPublishPackageReport -and $externalPublishPackageReport.checks) {
  $checks = $externalPublishPackageReport.checks
  $externalPublishPackagePassed =
    (Test-Truthy $checks.publishDirValidated) -and
    (Test-Truthy $checks.bundleFrontendPresent) -and
    (Test-Truthy $checks.bundleBackendPresent) -and
    (Test-Truthy $checks.bundleCollectorPresent) -and
    (Test-Truthy $checks.bundleHardwarePresent)
}

$portableArtifactStateVerified = $false
if ($suiteSummary -and $suiteSummary.status -and $null -ne $suiteSummary.status.PSObject.Properties["portableArtifactStateVerified"]) {
  $portableArtifactStateVerified = Test-Truthy $suiteSummary.status.portableArtifactStateVerified
} elseif ($suiteSummary -and $suiteSummary.checks) {
  $portableArtifactStateVerified =
    (Test-Truthy $suiteSummary.checks.bundleArtifactStatePassed) -and
    (Test-Truthy $suiteSummary.checks.firstRunArtifactStatePassed)
}

$installedArtifactStateVerified = $false
if ($setupLifecycleReport -and $setupLifecycleReport.status -and $null -ne $setupLifecycleReport.status.PSObject.Properties["installedArtifactStateVerified"]) {
  $installedArtifactStateVerified = Test-Truthy $setupLifecycleReport.status.installedArtifactStateVerified
} elseif (
  $setupLifecycleReport -and
  $setupLifecycleReport.stages -and
  $setupLifecycleReport.stages.installedLayout -and
  $setupLifecycleReport.stages.installedLayout.artifactState
) {
  $artifactState = $setupLifecycleReport.stages.installedLayout.artifactState
  $installedArtifactStateVerified =
    (Test-Truthy $artifactState.available) -and
    (Test-Truthy $artifactState.configFileExistsReported) -and
    (Test-Truthy $artifactState.diagnosticsFileExistsReported) -and
    (Test-Truthy $artifactState.syncStateVerifiedAfterDisplayChange) -and
    (Test-Truthy $artifactState.cloudConfigPendingAfterDisplayChange)
}

$blockedByToolchain = $true
$portableBuildReady = $false
$setupBuildReady = $false
if ($buildPrereqsReport -and $buildPrereqsReport.readiness) {
  $portableBuildReady = Test-Truthy $buildPrereqsReport.readiness.portableBuildReady
  $setupBuildReady = Test-Truthy $buildPrereqsReport.readiness.setupBuildReady
  $blockedByToolchain = -not $portableBuildReady
}

$failedChecks = @()
if (-not $buildPrereqsReport) { $failedChecks += "buildPrereqs.missing" }
if (-not $portableBuildReady) { $failedChecks += "buildPrereqs.portableBuildNotReady" }
if (-not $suiteSummary) { $failedChecks += "portableSuite.missing" }
elseif (-not $portableSuitePassed) { $failedChecks += "portableSuite.failed" }

if ($RequireSetupLifecycle) {
  if (-not $setupLifecycleReport) { $failedChecks += "setupLifecycle.missing" }
  elseif (-not $setupLifecyclePassed) { $failedChecks += "setupLifecycle.failed" }
}

if ($RequirePortableSuite -and (-not $suiteSummary -or -not $portableSuitePassed)) {
  if ($failedChecks -notcontains "portableSuite.requiredFailed") {
    $failedChecks += "portableSuite.requiredFailed"
  }
}

if ($setupBuildReady -and $setupLifecyclePassed -and (-not $setupLifecycleExecutionVerified)) {
  if ($failedChecks -notcontains "setupLifecycle.executionNotVerified") {
    $failedChecks += "setupLifecycle.executionNotVerified"
  }
}

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  inputs = [ordered]@{
    buildPrereqsReportPath = $resolvedBuildPrereqsReportPath
    suiteSummaryPath = $resolvedSuiteSummaryPath
    setupLifecycleReportPath = $resolvedSetupLifecycleReportPath
    externalPublishPackageReportPath = $resolvedExternalPublishPackageReportPath
  }
  requirements = [ordered]@{
    portableSuiteRequired = [bool]$RequirePortableSuite
    setupLifecycleRequired = [bool]$RequireSetupLifecycle
  }
  status = [ordered]@{
    blockedByToolchain = $blockedByToolchain
    portableBuildReady = $portableBuildReady
    setupBuildReady = $setupBuildReady
    externalPublishPackageVerified = $externalPublishPackagePassed
    portableSuiteVerified = $portableSuitePassed
    setupLifecycleVerified = $setupLifecyclePassed
    setupLifecycleExecutionVerified = $setupLifecycleExecutionVerified
    portableArtifactStateVerified = $portableArtifactStateVerified
    installedArtifactStateVerified = $installedArtifactStateVerified
    localArtifactStateVerified = if ($setupLifecycleReport -and $setupLifecycleReport.status -and $null -ne $setupLifecycleReport.status.PSObject.Properties["localArtifactStateVerified"]) {
      (Test-Truthy $setupLifecycleReport.status.localArtifactStateVerified) -and $portableArtifactStateVerified
    } else {
      ($portableArtifactStateVerified -and $installedArtifactStateVerified)
    }
    issueDiagnosisVerified = ($suiteSummary -and (Test-Truthy $suiteSummary.checks.issueCategoryObserved) -and (Test-Truthy $suiteSummary.checks.issueCategoryRecoveryObserved))
    controlStreamVerified = ($suiteSummary -and (Test-Truthy $suiteSummary.checks.viewerRealtimePassed) -and (Test-Truthy $suiteSummary.checks.viewerRealtimeHoldPassed) -and (Test-Truthy $suiteSummary.checks.controlStreamFallbackPassed) -and (Test-Truthy $suiteSummary.checks.controlStreamKeepalivePassed) -and (Test-Truthy $suiteSummary.checks.controlStreamRecoveringPassed) -and (Test-Truthy $suiteSummary.checks.firstRunControlStreamDefaultsPassed))
  }
  evidence = [ordered]@{
    externalPublishPackage = if ($externalPublishPackageReport) {
      [ordered]@{
        available = $true
        usedMockPublishDir = Test-Truthy $externalPublishPackageReport.usedMockPublishDir
        usedGoBuild = Test-Truthy $externalPublishPackageReport.usedGoBuild
        publishDir = [string]$externalPublishPackageReport.publishDir
        bundleRoot = [string]$externalPublishPackageReport.bundleRoot
      }
    } else {
      [ordered]@{
        available = $false
      }
    }
    portableSuite = if ($suiteSummary) {
      [ordered]@{
        available = $true
        summaryPath = $resolvedSuiteSummaryPath
        issueCategoryObserved = Test-Truthy $suiteSummary.checks.issueCategoryObserved
        issueCategoryRecoveryObserved = Test-Truthy $suiteSummary.checks.issueCategoryRecoveryObserved
        bundleArtifactStatePassed = Test-Truthy $suiteSummary.checks.bundleArtifactStatePassed
        firstRunArtifactStatePassed = Test-Truthy $suiteSummary.checks.firstRunArtifactStatePassed
        portableArtifactState = if ($suiteSummary.evidence -and $suiteSummary.evidence.portableArtifactState) {
          [ordered]@{
            bundleConfigFileExists = Test-Truthy $suiteSummary.evidence.portableArtifactState.bundleConfigFileExists
            bundleSyncStateFileExists = Test-Truthy $suiteSummary.evidence.portableArtifactState.bundleSyncStateFileExists
            bundleDiagnosticsFileExists = Test-Truthy $suiteSummary.evidence.portableArtifactState.bundleDiagnosticsFileExists
            firstRunConfigFileExists = Test-Truthy $suiteSummary.evidence.portableArtifactState.firstRunConfigFileExists
            firstRunSyncStateMissing = Test-Truthy $suiteSummary.evidence.portableArtifactState.firstRunSyncStateMissing
            firstRunDiagnosticsFileExists = Test-Truthy $suiteSummary.evidence.portableArtifactState.firstRunDiagnosticsFileExists
            firstDisplayChangeSyncStateExists = Test-Truthy $suiteSummary.evidence.portableArtifactState.firstDisplayChangeSyncStateExists
          }
        } else {
          [ordered]@{
            available = $false
          }
        }
      }
    } else {
      [ordered]@{
        available = $false
      }
    }
    setupLifecycle = if ($setupLifecycleReport) {
      [ordered]@{
        available = $true
        summaryPath = $resolvedSetupLifecycleReportPath
        installedLayoutReportPath = [string]$setupLifecycleReport.inputs.installedLayoutReportPath
        setupPackagingVerified = Get-BoolProperty -Object $setupLifecycleReport.status -Name "setupPackagingVerified"
        setupInstalledLayoutVerified = Get-BoolProperty -Object $setupLifecycleReport.status -Name "setupInstalledLayoutVerified"
        setupUninstallBehaviorVerified = Get-BoolProperty -Object $setupLifecycleReport.status -Name "setupUninstallBehaviorVerified"
        setupLifecycleExecutionVerified = $setupLifecycleExecutionVerified
        setupLifecycleUsedSimulatedPaths = Get-BoolProperty -Object $setupLifecycleReport.status -Name "setupLifecycleUsedSimulatedPaths"
        installedArtifactState = if ($setupLifecycleReport.stages -and $setupLifecycleReport.stages.installedLayout -and $setupLifecycleReport.stages.installedLayout.artifactState) {
          [ordered]@{
            available = Test-Truthy $setupLifecycleReport.stages.installedLayout.artifactState.available
            configFileExistsReported = (Test-Truthy $setupLifecycleReport.stages.installedLayout.artifactState.configFileExistsReported)
            diagnosticsFileExistsReported = (Test-Truthy $setupLifecycleReport.stages.installedLayout.artifactState.diagnosticsFileExistsReported)
            syncStateFileExistsReported = (Test-Truthy $setupLifecycleReport.stages.installedLayout.artifactState.syncStateFileExistsReported)
            syncStateVerifiedAfterDisplayChange = (Test-Truthy $setupLifecycleReport.stages.installedLayout.artifactState.syncStateVerifiedAfterDisplayChange)
            cloudConfigPendingAfterDisplayChange = (Test-Truthy $setupLifecycleReport.stages.installedLayout.artifactState.cloudConfigPendingAfterDisplayChange)
          }
        } else {
          [ordered]@{
            available = $false
          }
        }
      }
    } else {
      [ordered]@{
        available = $false
      }
    }
  }
  remediation = if ($buildPrereqsReport -and $buildPrereqsReport.remediation) {
    [ordered]@{
      portableBuildBlockedBy = @($buildPrereqsReport.remediation.portableBuildBlockedBy)
      setupBuildBlockedBy = @($buildPrereqsReport.remediation.setupBuildBlockedBy)
      nextSteps = @($buildPrereqsReport.remediation.nextSteps)
      recommendedCommands = @($buildPrereqsReport.remediation.recommendedCommands)
    }
  } else {
    [ordered]@{
      portableBuildBlockedBy = @()
      setupBuildBlockedBy = @()
      nextSteps = @()
      recommendedCommands = @()
    }
  }
  summary = [ordered]@{
    passed = ($failedChecks.Count -eq 0)
    failedChecks = $failedChecks
  }
}

if ($setupLifecyclePassed -and (-not $setupLifecycleExecutionVerified)) {
  $setupExecutionNextStep = "Run the real setup.exe execution verifier on an elevated Windows validation machine to produce direct installer lifecycle evidence."
  $setupExecutionCommand = "powershell -ExecutionPolicy Bypass -File .\\deploy\\verify-windows-agent-setup-execution.ps1 -SetupExePath .\\release\\windows-agent-setup\\DeviceStateConsoleAgent-setup.exe -OutputDir .\\release\\windows-agent-setup-execution"

  if ($report.remediation.setupBuildBlockedBy -notcontains "Real setup.exe execution evidence has not been produced yet; current lifecycle proof still comes from packaging/layout verification artifacts") {
    $report.remediation.setupBuildBlockedBy = @($report.remediation.setupBuildBlockedBy) + @(
      "Real setup.exe execution evidence has not been produced yet; current lifecycle proof still comes from packaging/layout verification artifacts"
    )
  }
  if ($report.remediation.nextSteps -notcontains $setupExecutionNextStep) {
    $report.remediation.nextSteps = @($report.remediation.nextSteps) + @($setupExecutionNextStep)
  }
  if ($report.remediation.recommendedCommands -notcontains $setupExecutionCommand) {
    $report.remediation.recommendedCommands = @($report.remediation.recommendedCommands) + @($setupExecutionCommand)
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
Write-JsonReportWithRetry -Path $resolvedReportPath -Data $report

if ($failedChecks.Count -gt 0) {
  throw "Windows release readiness verification failed: $($failedChecks -join ', ')"
}

Write-Host "Windows release readiness verification passed."
Write-Host "Report: $resolvedReportPath"
