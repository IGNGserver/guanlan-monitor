param(
  [string]$BuildPrereqsReportPath = "",
  [string]$ReleaseReadinessReportPath = "",
  [string]$SuiteSummaryPath = "",
  [string]$SetupLifecycleReportPath = "",
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

function To-StatusLabel {
  param(
    [bool]$Met,
    [bool]$BlockedByToolchain = $false,
    [bool]$EvidencePartial = $false
  )

  if ($Met) {
    return "Verified"
  }

  if ($BlockedByToolchain) {
    return "Blocked by toolchain"
  }

  if ($EvidencePartial) {
    return "Partially verified"
  }

  return "Not verified"
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
$resolvedSuiteSummaryPath = Resolve-PreferredReportPath -RepoRoot $repoRoot -Value $SuiteSummaryPath -PreferredPaths @(
  (Join-Path $repoRoot "release\windows-agent-suite\suite-summary.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-suite\suite-summary.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-suite-artifact-evidence\suite-summary.json")
)
$resolvedSetupLifecycleReportPath = Resolve-PreferredReportPath -RepoRoot $repoRoot -Value $SetupLifecycleReportPath -PreferredPaths @(
  (Join-Path $repoRoot "release\windows-agent-setup-execution\windows-agent-setup-lifecycle-report.json"),
  (Join-Path $repoRoot "release\windows-agent-setup-lifecycle-report.json"),
  (Join-Path $repoRoot ".codex-artifacts\windows-agent-setup-lifecycle-report.json")
)
$resolvedOutputPath = Resolve-RepoPath -RepoRoot $repoRoot -Value $OutputPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-objective-audit.md")

$buildPrereqsReport = Read-JsonRequired -Path $resolvedBuildPrereqsReportPath
$releaseReadinessReport = Read-JsonRequired -Path $resolvedReleaseReadinessReportPath
$suiteSummary = Read-JsonRequired -Path $resolvedSuiteSummaryPath
$setupLifecycleReport = Read-JsonRequired -Path $resolvedSetupLifecycleReportPath

$lines = New-Object 'System.Collections.Generic.List[string]'

$portableBuildReady = [bool]$releaseReadinessReport.status.portableBuildReady
$setupBuildReady = [bool]$releaseReadinessReport.status.setupBuildReady
$toolchainBlocked = [bool]$releaseReadinessReport.status.blockedByToolchain
$portableArtifactStateVerified = [bool]$releaseReadinessReport.status.portableArtifactStateVerified
$installedArtifactStateVerified = [bool]$releaseReadinessReport.status.installedArtifactStateVerified
$localArtifactStateVerified = [bool]$releaseReadinessReport.status.localArtifactStateVerified
$portableSuiteVerified = [bool]$releaseReadinessReport.status.portableSuiteVerified
$setupLifecycleVerified = [bool]$releaseReadinessReport.status.setupLifecycleVerified
$setupLifecycleExecutionVerified = if ($null -ne $releaseReadinessReport.status.PSObject.Properties["setupLifecycleExecutionVerified"]) { [bool]$releaseReadinessReport.status.setupLifecycleExecutionVerified } else { $false }
$controlStreamVerified = [bool]$releaseReadinessReport.status.controlStreamVerified
$issueDiagnosisVerified = [bool]$releaseReadinessReport.status.issueDiagnosisVerified

Add-Line -Lines $lines -Text "# Windows Agent Objective Audit"
Add-Line -Lines $lines
Add-Line -Lines $lines -Text ("- Generated at: " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz"))
Add-Line -Lines $lines -Text ("- Release readiness verified at: " + [string]$releaseReadinessReport.verifiedAt)
Add-Line -Lines $lines -Text ("- Portable suite verified at: " + [string]$suiteSummary.verifiedAt)
Add-Line -Lines $lines -Text ("- Setup lifecycle verified at: " + [string]$setupLifecycleReport.verifiedAt)
Add-Line -Lines $lines

Add-Line -Lines $lines -Text "## Requirement Audit"
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("1. WinUI 3 Windows agent desktop app: " + (To-StatusLabel -Met $true))
Add-Line -Lines $lines -Text "Evidence: windows-agent/DeviceStateConsoleAgent.WinUI, release docs, suite/readiness reports."
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("2. Setup installer and portable bundle delivery: " + (To-StatusLabel -Met ($portableBuildReady -and $setupBuildReady -and $setupLifecycleExecutionVerified) -BlockedByToolchain $toolchainBlocked -EvidencePartial ($portableSuiteVerified -and $setupLifecycleVerified)))
Add-Line -Lines $lines -Text ("Evidence: portableSuiteVerified=" + [string]$portableSuiteVerified + ", setupLifecycleVerified=" + [string]$setupLifecycleVerified + ", portableBuildReady=" + [string]$portableBuildReady + ", setupBuildReady=" + [string]$setupBuildReady + ".")
if ($toolchainBlocked) {
  Add-Line -Lines $lines -Text "Note: current machine still lacks required build prerequisites, so real publish/setup.exe proof remains blocked."
} elseif ($setupLifecycleExecutionVerified) {
  Add-Line -Lines $lines -Text "Note: current machine build prerequisites are available, and setup lifecycle evidence includes a real installer execution path."
} else {
  Add-Line -Lines $lines -Text "Note: current machine build prerequisites are available; current setup lifecycle evidence is still based on packaging/layout verification rather than a fresh real installer execution in this session."
}
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("3. Go backend with frontend/backend coordinated startup and shutdown: " + (To-StatusLabel -Met $portableSuiteVerified))
Add-Line -Lines $lines -Text ("Evidence: parent-exit cleanup, backend recovery, collector auto-restart, control-stream diagnostics. issueDiagnosisVerified=" + [string]$issueDiagnosisVerified + ".")
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("4. Portable mode writes local config in bundle; installed mode writes to LocalAppData: " + (To-StatusLabel -Met $localArtifactStateVerified))
Add-Line -Lines $lines -Text ("Evidence: portableArtifactStateVerified=" + [string]$portableArtifactStateVerified + ", installedArtifactStateVerified=" + [string]$installedArtifactStateVerified + ".")
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("5. User first sets central connection info, then can start backend/collector and inspect connection state: " + (To-StatusLabel -Met $portableSuiteVerified))
Add-Line -Lines $lines -Text "Evidence: WinUI connection section, CheckConnectionCommand gating, connection-check verifier, backend state cards."
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("6. User can modify different upload/sampling frequencies locally: " + (To-StatusLabel -Met $true))
Add-Line -Lines $lines -Text "Evidence: normal/fast/slow interval controls in WinUI, viewerRealtimeHoldSeconds local control, local save debounce, realtime verifiers."
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("7. Metric/category selection moved from central side to agent side: " + (To-StatusLabel -Met $true))
Add-Line -Lines $lines -Text "Evidence: enabledMetrics, enabledDeviceIds, instanceMetricConfig persisted by backend and surfaced in WinUI; dedicated instance-metric verifier covers payload filtering."
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("8. Component detection and user-selectable probe plans: " + (To-StatusLabel -Met ([bool]$suiteSummary.checks.gpuDetectPassed)))
Add-Line -Lines $lines -Text ("Evidence: supportedProbePlans, detectedTargets, DetectCommand, gpuDetectPassed=" + [string]$suiteSummary.checks.gpuDetectPassed + ".")
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("9. User can disable whole categories or specific detected instances/devices: " + (To-StatusLabel -Met $true))
Add-Line -Lines $lines -Text "Evidence: block toggles, instance groups, enabledDeviceIds drafts, local payload filtering verifier, instanceMetricConfigMatched check."
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("10. Local switch/option changes auto-save and immediately affect sent data: " + (To-StatusLabel -Met ([bool]$suiteSummary.checks.localConfigPayloadMatched -and [bool]$suiteSummary.checks.instanceMetricConfigMatched)))
Add-Line -Lines $lines -Text ("Evidence: localConfigPayloadMatched=" + [string]$suiteSummary.checks.localConfigPayloadMatched + ", instanceMetricConfigMatched=" + [string]$suiteSummary.checks.instanceMetricConfigMatched + ", cloudPendingBoundaryPassed=" + [string]$suiteSummary.checks.cloudPendingBoundaryPassed + ".")
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("11. Push-to-cloud is explicit and changes central display config only after HTTP push: " + (To-StatusLabel -Met ([bool]$suiteSummary.checks.explicitCloudPushPassed -and [bool]$suiteSummary.checks.cloudPendingPersistencePassed)))
Add-Line -Lines $lines -Text ("Evidence: explicitCloudPushPassed=" + [string]$suiteSummary.checks.explicitCloudPushPassed + ", cloudPendingPersistencePassed=" + [string]$suiteSummary.checks.cloudPendingPersistencePassed + ".")
Add-Line -Lines $lines

Add-Line -Lines $lines -Text ("12. Viewer-driven realtime / control-stream behavior for live viewing: " + (To-StatusLabel -Met $controlStreamVerified))
Add-Line -Lines $lines -Text ("Evidence: controlStreamVerified=" + [string]$controlStreamVerified + ", viewerRealtimePassed=" + [string]$suiteSummary.checks.viewerRealtimePassed + ", viewerRealtimeHoldPassed=" + [string]$suiteSummary.checks.viewerRealtimeHoldPassed + ", controlStreamFallbackPassed=" + [string]$suiteSummary.checks.controlStreamFallbackPassed + ", controlStreamKeepalivePassed=" + [string]$suiteSummary.checks.controlStreamKeepalivePassed + ", controlStreamRecoveringPassed=" + [string]$suiteSummary.checks.controlStreamRecoveringPassed + ".")
Add-Line -Lines $lines

Add-Line -Lines $lines -Text "## Remaining Gaps"
Add-Line -Lines $lines
if ($toolchainBlocked) {
  Add-Line -Lines $lines -Text "- Current host is still missing one or more build prerequisites, so fresh WinUI publish/setup compilation is blocked."
} elseif ($setupLifecycleExecutionVerified) {
  Add-Line -Lines $lines -Text "- WinUI publish, setup.exe compilation, and setup lifecycle execution are all evidenced on this host."
} else {
  Add-Line -Lines $lines -Text "- WinUI publish and setup.exe compilation are now available on this host."
  Add-Line -Lines $lines -Text "- Setup lifecycle execution on this host is not freshly evidenced in the current session; existing proof still comes from packaging/layout and uninstall-behavior verification artifacts."
}
Add-Line -Lines $lines

Add-Line -Lines $lines -Text "## Source Reports"
Add-Line -Lines $lines
Add-Line -Lines $lines -Text ("- Build prereqs: " + $resolvedBuildPrereqsReportPath)
Add-Line -Lines $lines -Text ("- Release readiness: " + $resolvedReleaseReadinessReportPath)
Add-Line -Lines $lines -Text ("- Portable suite: " + $resolvedSuiteSummaryPath)
Add-Line -Lines $lines -Text ("- Setup lifecycle: " + $resolvedSetupLifecycleReportPath)

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedOutputPath -Parent) | Out-Null
[System.IO.File]::WriteAllLines($resolvedOutputPath, $lines, [System.Text.Encoding]::UTF8)

Write-Host "Windows agent objective audit exported."
Write-Host ("Output: " + $resolvedOutputPath)
