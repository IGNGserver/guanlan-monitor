param(
  [string]$OutputDir = "",
  [switch]$SkipBundleSmokeTest,
  [string[]]$OnlyChecks = @(),
  [switch]$SummarizeOnly
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:NormalizedOnlyChecks = @()

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedOutputDir = if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  Join-Path $repoRoot ".codex-artifacts\windows-agent-suite"
} elseif ([System.IO.Path]::IsPathRooted($OutputDir)) {
  $OutputDir
} else {
  Join-Path $repoRoot $OutputDir
}
$resolvedOutputDir = [System.IO.Path]::GetFullPath($resolvedOutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

function Invoke-VerifyScript {
  param(
    [string]$ScriptName,
    [string[]]$ArgumentList
  )

  $scriptPath = Join-Path $repoRoot ("deploy\" + $ScriptName)
  Write-Host "Running $ScriptName"
  & powershell -ExecutionPolicy Bypass -File $scriptPath @ArgumentList
}

function Should-RunCheck {
  param(
    [string]$CheckName
  )

  if ($script:NormalizedOnlyChecks.Count -eq 0) {
    return $true
  }

  return $script:NormalizedOnlyChecks -contains $CheckName
}

function Get-NormalizedOnlyChecks {
  $normalizedOnlyChecks = @()
  foreach ($item in $OnlyChecks) {
    if ([string]::IsNullOrWhiteSpace($item)) {
      continue
    }

    $normalizedOnlyChecks += @(
      $item -split "," | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() }
    )
  }

  return @($normalizedOnlyChecks | Select-Object -Unique)
}

function Get-SelectedChecks {
  $normalizedOnlyChecks = $script:NormalizedOnlyChecks

  if ($normalizedOnlyChecks.Count -eq 0) {
    return @(
      "bundle",
      "autorestart",
      "issueCategory",
      "cloudPush",
      "cloudPendingPersist",
      "cloudPendingBoundary",
      "localConfigPayload",
      "instanceMetricConfig",
      "parentExit",
      "firstRun",
      "connectionCheck",
      "gpuDetect"
    )
  }

  return @($normalizedOnlyChecks | Select-Object -Unique)
}

$script:NormalizedOnlyChecks = Get-NormalizedOnlyChecks

function Read-JsonReport {
  param(
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    throw "Missing report: $Path"
  }

  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

$existingSummaryPath = Join-Path $resolvedOutputDir "suite-summary.json"
$existingSummary = $null
if (Test-Path $existingSummaryPath) {
  try {
    $existingSummary = Get-Content -LiteralPath $existingSummaryPath -Raw | ConvertFrom-Json
  } catch {
    throw "Failed to parse existing suite summary: $existingSummaryPath"
  }
}

function Get-ReportPathFromSummary {
  param(
    [object]$Summary,
    [string]$ReportKey
  )

  if (-not $Summary -or -not $Summary.reports) {
    return $null
  }

  $property = $Summary.reports.PSObject.Properties[$ReportKey]
  if ($null -eq $property) {
    return $null
  }

  $path = [string]$property.Value
  if ([string]::IsNullOrWhiteSpace($path)) {
    return $null
  }

  return $path
}

function Resolve-ReportPath {
  param(
    [string]$ReportKey,
    [string]$DefaultPath
  )

  if (Test-Path $DefaultPath) {
    return $DefaultPath
  }

  $summaryPath = Get-ReportPathFromSummary -Summary $existingSummary -ReportKey $ReportKey
  if (-not [string]::IsNullOrWhiteSpace($summaryPath) -and (Test-Path $summaryPath)) {
    return $summaryPath
  }

  throw "Missing report for '$ReportKey': $DefaultPath"
}

function Try-Resolve-ReportPath {
  param(
    [string]$ReportKey,
    [string]$DefaultPath
  )

  try {
    return Resolve-ReportPath -ReportKey $ReportKey -DefaultPath $DefaultPath
  } catch {
    return $null
  }
}

$bundleArgs = @(
  "-ReportPath", (Join-Path $resolvedOutputDir "bundle-report.json")
)
if ($SkipBundleSmokeTest) {
  $bundleArgs += "-SkipBackendSmokeTest"
}

if (-not $SummarizeOnly) {
  if (Should-RunCheck "bundle") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-bundle.ps1" -ArgumentList $bundleArgs
  }
  if (Should-RunCheck "autorestart") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-autorestart.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "autorestart-config"),
    "-ListenPort", "18031",
    "-ReportPath", (Join-Path $resolvedOutputDir "autorestart-report.json")
  )
  }
  if (Should-RunCheck "issueCategory") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-issue-category.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "issue-category-config"),
    "-ListenPort", "18041",
    "-ReportPath", (Join-Path $resolvedOutputDir "issue-category-report.json")
  )
  }
  if (Should-RunCheck "cloudPush") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-cloud-push.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "cloud-push-config"),
    "-BackendPort", "18043",
    "-MockServerPort", "19043",
    "-ReportPath", (Join-Path $resolvedOutputDir "cloud-push-report.json")
  )
  }
  if (Should-RunCheck "cloudPendingPersist") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-cloud-pending-persist.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "cloud-pending-persist-config"),
    "-BackendPort", "18045",
    "-MockServerPort", "19045",
    "-ReportPath", (Join-Path $resolvedOutputDir "cloud-pending-persist-report.json")
  )
  }
  if (Should-RunCheck "cloudPendingBoundary") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-cloud-pending-boundary.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "cloud-pending-boundary-config"),
    "-BackendPort", "18047",
    "-ReportPath", (Join-Path $resolvedOutputDir "cloud-pending-boundary-report.json")
  )
  }
  if (Should-RunCheck "localConfigPayload") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-local-config-payload.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "local-config-payload-config"),
    "-BackendPort", "18044",
    "-MockServerPort", "19044",
    "-ReportPath", (Join-Path $resolvedOutputDir "local-config-payload-report.json")
  )
  }
  if (Should-RunCheck "instanceMetricConfig") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-instance-metric-config.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "instance-metric-config-config"),
    "-BackendPort", "18049",
    "-MockServerPort", "19049",
    "-ReportPath", (Join-Path $resolvedOutputDir "instance-metric-config-report.json")
  )
  }
  if (Should-RunCheck "parentExit") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-parent-exit.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "parent-exit-config"),
    "-ListenPort", "18046",
    "-ReportPath", (Join-Path $resolvedOutputDir "parent-exit-report.json")
  )
  }
  if (Should-RunCheck "firstRun") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-first-run.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "first-run-config"),
    "-ListenPort", "18081",
    "-ReportPath", (Join-Path $resolvedOutputDir "first-run-report.json")
  )
  }
  if (Should-RunCheck "connectionCheck") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-connection-check.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "connection-check-config"),
    "-BackendPort", "18071",
    "-MockServerPort", "19071",
    "-ReportPath", (Join-Path $resolvedOutputDir "connection-check-report.json")
  )
  }
  if (Should-RunCheck "gpuDetect") {
    Invoke-VerifyScript -ScriptName "verify-windows-agent-gpu-detect.ps1" -ArgumentList @(
    "-ConfigRoot", (Join-Path $resolvedOutputDir "gpu-detect-config"),
    "-BackendPort", "18091",
    "-ReportPath", (Join-Path $resolvedOutputDir "gpu-detect-report.json")
  )
  }
}

$selectedChecks = Get-SelectedChecks
$isPartialRun = $OnlyChecks.Count -gt 0

$reportDefaults = [ordered]@{
  bundle = Join-Path $resolvedOutputDir "bundle-report.json"
  autorestart = Join-Path $resolvedOutputDir "autorestart-report.json"
  issueCategory = Join-Path $resolvedOutputDir "issue-category-report.json"
  cloudPush = Join-Path $resolvedOutputDir "cloud-push-report.json"
  cloudPendingPersist = Join-Path $resolvedOutputDir "cloud-pending-persist-report.json"
  cloudPendingBoundary = Join-Path $resolvedOutputDir "cloud-pending-boundary-report.json"
  localConfigPayload = Join-Path $resolvedOutputDir "local-config-payload-report.json"
  instanceMetricConfig = Join-Path $resolvedOutputDir "instance-metric-config-report.json"
  parentExit = Join-Path $resolvedOutputDir "parent-exit-report.json"
  firstRun = Join-Path $resolvedOutputDir "first-run-report.json"
  connectionCheck = Join-Path $resolvedOutputDir "connection-check-report.json"
  gpuDetect = Join-Path $resolvedOutputDir "gpu-detect-report.json"
}

$reportPaths = [ordered]@{}
$reports = [ordered]@{}
foreach ($checkName in $selectedChecks) {
  $defaultPath = $reportDefaults[$checkName]
  if ([string]::IsNullOrWhiteSpace($defaultPath)) {
    throw "Unknown check name: $checkName"
  }

  $resolvedPath = if ($isPartialRun) {
    Try-Resolve-ReportPath -ReportKey $checkName -DefaultPath $defaultPath
  } else {
    Resolve-ReportPath -ReportKey $checkName -DefaultPath $defaultPath
  }

  if (-not [string]::IsNullOrWhiteSpace($resolvedPath)) {
    $reportPaths[$checkName] = $resolvedPath
    $reports[$checkName] = Read-JsonReport -Path $resolvedPath
  }
}

$summary = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  outputDir = $resolvedOutputDir
  selectedChecks = $selectedChecks
  partialRun = $isPartialRun
  checks = [ordered]@{}
}

if ($reports.Contains("bundle")) {
  $bundleReport = $reports["bundle"]
  $summary.checks.bundleSmokePassed = [bool]$bundleReport.backendSmokeTest.passed
  $summary.checks.bundleArtifactStatePassed = ([bool]$bundleReport.backendSmokeTest.configFileExists -and [bool]$bundleReport.backendSmokeTest.syncStateFileExists -and [bool]$bundleReport.backendSmokeTest.diagnosticsFileExists)
}
if ($reports.Contains("autorestart")) {
  $autorestartReport = $reports["autorestart"]
  $summary.checks.autorestartObserved = ([int]$autorestartReport.restartCount -ge 1)
}
if ($reports.Contains("issueCategory")) {
  $issueCategoryReport = $reports["issueCategory"]
  $summary.checks.issueCategoryObserved = [bool]$issueCategoryReport.issueObserved
  $summary.checks.issueCategoryRecoveryObserved = ([bool]$issueCategoryReport.recoveryObserved -and -not [string]::IsNullOrWhiteSpace([string]$issueCategoryReport.issueRecoveredAt) -and [string]$issueCategoryReport.recoveredConnectionStatus -eq "connected")
}
if ($reports.Contains("cloudPush")) {
  $cloudPushReport = $reports["cloudPush"]
  $summary.checks.explicitCloudPushPassed = ([bool]$cloudPushReport.noImplicitPushObserved -and [bool]$cloudPushReport.pushSucceeded)
}
if ($reports.Contains("cloudPendingPersist")) {
  $cloudPendingPersistReport = $reports["cloudPendingPersist"]
  $summary.checks.cloudPendingPersistencePassed = ([bool]$cloudPendingPersistReport.pendingAfterLocalChange -and [bool]$cloudPendingPersistReport.pendingRestoredAfterRestart -and [bool]$cloudPendingPersistReport.pendingClearedAfterPush)
}
if ($reports.Contains("cloudPendingBoundary")) {
  $cloudPendingBoundaryReport = $reports["cloudPendingBoundary"]
  $summary.checks.cloudPendingBoundaryPassed = ((-not [bool]$cloudPendingBoundaryReport.initialPending) -and [bool]$cloudPendingBoundaryReport.runtimeOnlyChangeApplied -and (-not [bool]$cloudPendingBoundaryReport.pendingAfterRuntimeChange) -and [bool]$cloudPendingBoundaryReport.syncStateStillMissing)
}
if ($reports.Contains("localConfigPayload")) {
  $localConfigPayloadReport = $reports["localConfigPayload"]
  $summary.checks.localConfigPayloadMatched = [bool]$localConfigPayloadReport.payloadMatched
}
if ($reports.Contains("instanceMetricConfig")) {
  $instanceMetricConfigReport = $reports["instanceMetricConfig"]
  $summary.checks.instanceMetricConfigMatched = [bool]$instanceMetricConfigReport.payloadMatched
}
if ($reports.Contains("parentExit")) {
  $parentExitReport = $reports["parentExit"]
  $summary.checks.parentExitCleanupPassed = ([bool]$parentExitReport.backendExitedAfterParent -and [bool]$parentExitReport.collectorExitedWithBackend)
}
if ($reports.Contains("firstRun")) {
  $firstRunReport = $reports["firstRun"]
  $summary.checks.firstRunPathsPassed = ([bool]$firstRunReport.stateConfigPathMatched -and [bool]$firstRunReport.stateSyncStatePathMatched -and [bool]$firstRunReport.stateDiagnosticsPathMatched)
  $summary.checks.firstRunArtifactStatePassed = ([bool]$firstRunReport.stateConfigFileExistsOnFirstRun -and (-not [bool]$firstRunReport.stateSyncStateFileExistsOnFirstRun) -and [bool]$firstRunReport.stateDiagnosticsFileExistsOnFirstRun -and [bool]$firstRunReport.stateSyncStateFileExistsAfterDisplayChange)
}
if ($reports.Contains("connectionCheck")) {
  $connectionCheckReport = $reports["connectionCheck"]
  $summary.checks.connectionCheckPassed = (
    [bool]$connectionCheckReport.backendReachable -and
    [string]$connectionCheckReport.unauthorizedStatus -eq "unauthorized" -and
    [string]$connectionCheckReport.deviceUnknownStatus -eq "authorized_device_unknown" -and
    [string]$connectionCheckReport.deviceKnownStatus -eq "authorized_device_known" -and
    [string]$connectionCheckReport.unreachableStatus -eq "server_unreachable"
  )
}
if ($reports.Contains("gpuDetect")) {
  $gpuDetectReport = $reports["gpuDetect"]
  $summary.checks.gpuDetectPassed = (
    [bool]$gpuDetectReport.backendReachable -and
      [bool]$gpuDetectReport.gpuProviderBuiltinAvailable -and
      [bool]$gpuDetectReport.gpuProviderDisabledAvailable -and
      [bool]$gpuDetectReport.gpuTargetPresent -and
      (
        [int]$gpuDetectReport.gpuInstanceCount -eq 0 -or
        ([bool]$gpuDetectReport.selectionPersisted -and [bool]$gpuDetectReport.redetectSelectionObserved)
      )
    )
}

$summary.status = [ordered]@{}
if ($reports.Contains("bundle") -and $reports.Contains("firstRun")) {
  $bundleReport = $reports["bundle"]
  $firstRunReport = $reports["firstRun"]
  $summary.status.portableArtifactStateVerified = (
    ([bool]$bundleReport.backendSmokeTest.configFileExists -and [bool]$bundleReport.backendSmokeTest.syncStateFileExists -and [bool]$bundleReport.backendSmokeTest.diagnosticsFileExists) -and
    ([bool]$firstRunReport.stateConfigFileExistsOnFirstRun -and (-not [bool]$firstRunReport.stateSyncStateFileExistsOnFirstRun) -and [bool]$firstRunReport.stateDiagnosticsFileExistsOnFirstRun -and [bool]$firstRunReport.stateSyncStateFileExistsAfterDisplayChange)
  )
}

$summary.reports = [ordered]@{}
foreach ($entry in $reportPaths.GetEnumerator()) {
  $summary.reports[$entry.Key] = $entry.Value
}

$summary.evidence = [ordered]@{}
if ($reports.Contains("bundle") -and $reports.Contains("firstRun")) {
  $bundleReport = $reports["bundle"]
  $firstRunReport = $reports["firstRun"]
  $summary.evidence.portableArtifactState = [ordered]@{
    bundleConfigFileExists = [bool]$bundleReport.backendSmokeTest.configFileExists
    bundleSyncStateFileExists = [bool]$bundleReport.backendSmokeTest.syncStateFileExists
    bundleDiagnosticsFileExists = [bool]$bundleReport.backendSmokeTest.diagnosticsFileExists
    firstRunConfigFileExists = [bool]$firstRunReport.stateConfigFileExistsOnFirstRun
    firstRunSyncStateMissing = (-not [bool]$firstRunReport.stateSyncStateFileExistsOnFirstRun)
    firstRunDiagnosticsFileExists = [bool]$firstRunReport.stateDiagnosticsFileExistsOnFirstRun
    firstDisplayChangeSyncStateExists = [bool]$firstRunReport.stateSyncStateFileExistsAfterDisplayChange
  }
}

$summaryPath = Join-Path $resolvedOutputDir "suite-summary.json"
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host "Windows agent verify suite passed."
Write-Host "Summary: $summaryPath"
