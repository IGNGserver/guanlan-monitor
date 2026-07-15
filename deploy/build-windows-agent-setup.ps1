param(
  [string]$PortableBundleDir = "",
  [string]$OutputDir = "",
  [string]$Version = "",
  [string]$IsccPath = "",
  [switch]$BuildPortableIfMissing
)

$ErrorActionPreference = "Stop"

function Resolve-IsccPath {
  param([string]$PreferredPath)

  if (-not [string]::IsNullOrWhiteSpace($PreferredPath)) {
    if (-not (Test-Path $PreferredPath)) {
      throw "ISCC executable not found: $PreferredPath"
    }
    return (Resolve-Path $PreferredPath).Path
  }

  $isccCommand = Get-Command ISCC -ErrorAction SilentlyContinue
  $isccCommandSource = $null
  if ($isccCommand) {
    $isccCommandSource = $isccCommand.Source
  }

  $candidateCommands = @(
    $isccCommandSource,
    (Join-Path $env:LOCALAPPDATA "Programs\InnoSetup6Portable\ISCC.exe"),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

  return $candidateCommands | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Assert-PortableBundleAssets {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BundleRoot
  )

  $backendDir = Join-Path $BundleRoot "backend"
  $requiredPaths = @(
    (Join-Path $BundleRoot "DeviceStateConsoleAgent.WinUI.exe"),
    (Join-Path $BundleRoot "app-icon.ico"),
    (Join-Path $BundleRoot "INSTALLER_VERSION.txt"),
    (Join-Path $BundleRoot "install-dotnet-runtime.ps1"),
    (Join-Path $BundleRoot "start-agent.cmd"),
    (Join-Path $BundleRoot "start-agent.ps1"),
    (Join-Path $BundleRoot "start-agent.vbs"),
    (Join-Path $BundleRoot "README.md"),
    $backendDir,
    (Join-Path $BundleRoot "runtime\windowsdesktop-runtime-win-x64.exe"),
    (Join-Path $backendDir "windows-agent-backend.exe"),
    (Join-Path $backendDir "device-state-console-agent.exe"),
    (Join-Path $backendDir "windows-hardware"),
    (Join-Path $backendDir "windows-hardware\\librehardwaremonitor\\LibreHardwareMonitorLib.dll"),
    (Join-Path $backendDir "windows-hardware\\pawnio\\PawnIO_setup.exe")
  )

  $missing = @($requiredPaths | Where-Object { -not (Test-Path $_) })
  if ($missing.Count -gt 0) {
    throw "Portable bundle is incomplete. Missing required assets:`n - $($missing -join "`n - ")"
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = (Get-Content -LiteralPath (Join-Path $repoRoot "VERSION") -Raw).Trim()
}
$portableScript = Join-Path $repoRoot "deploy\build-windows-agent-portable.ps1"
$templatePath = Join-Path $repoRoot "deploy\windows-agent-setup.iss"
$resolvedOutputDir = if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  Join-Path $repoRoot "release\windows-agent-setup"
} elseif ([System.IO.Path]::IsPathRooted($OutputDir)) {
  $OutputDir
} else {
  Join-Path $repoRoot $OutputDir
}
$resolvedOutputDir = [System.IO.Path]::GetFullPath($resolvedOutputDir)
$portableBundleRoot = if ([string]::IsNullOrWhiteSpace($PortableBundleDir)) {
  Join-Path $repoRoot "release\windows-agent-portable\DeviceStateConsoleAgent"
} elseif ([System.IO.Path]::IsPathRooted($PortableBundleDir)) {
  $PortableBundleDir
} else {
  Join-Path $repoRoot $PortableBundleDir
}
$portableBundleRoot = [System.IO.Path]::GetFullPath($portableBundleRoot)
$generatedIss = Join-Path $resolvedOutputDir "windows-agent-setup.generated.iss"
$bundleVersionFile = Join-Path $portableBundleRoot "INSTALLER_VERSION.txt"
$versionedInstallerPath = Join-Path $resolvedOutputDir ("DeviceStateConsoleAgent-setup-{0}.exe" -f $Version)
$stableInstallerPath = Join-Path $resolvedOutputDir "DeviceStateConsoleAgent-setup.exe"
$updateZipPath = Join-Path $resolvedOutputDir ("DeviceStateConsoleAgent-update-{0}.zip" -f $Version)

if (-not (Test-Path $portableBundleRoot)) {
  if (-not $BuildPortableIfMissing) {
    throw "Portable bundle not found: $portableBundleRoot. Build it first or pass -BuildPortableIfMissing."
  }

  & powershell -ExecutionPolicy Bypass -File $portableScript -OutputDir (Split-Path $portableBundleRoot -Parent)
  if (-not (Test-Path $portableBundleRoot)) {
    throw "Portable bundle still missing after running build-windows-agent-portable.ps1"
  }
}

Assert-PortableBundleAssets -BundleRoot $portableBundleRoot

New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null
"InstallerVersion=$Version`r`nBuiltAt=$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")" | Set-Content -LiteralPath $bundleVersionFile -Encoding UTF8

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$issContent = [System.IO.File]::ReadAllText($templatePath, $utf8NoBom)
$issContent = $issContent.Replace('C:\build\DeviceStateConsoleAgent', $portableBundleRoot)
$issContent = $issContent.Replace('C:\build\installer', $resolvedOutputDir)
$issContent = $issContent.Replace('0.1.0', $Version)

# Inno Setup needs the generated script to preserve Chinese strings exactly.
$utf8WithBom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($generatedIss, $issContent, $utf8WithBom)

$resolvedIscc = Resolve-IsccPath -PreferredPath $IsccPath
if ([string]::IsNullOrWhiteSpace($resolvedIscc)) {
  Write-Warning "Inno Setup compiler (ISCC.exe) was not found. Generated installer script only: $generatedIss"
  exit 0
}

& $resolvedIscc $generatedIss
if ($LASTEXITCODE -ne 0) {
  throw "Inno Setup build failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path $versionedInstallerPath)) {
  throw "Initial installer build did not produce: $versionedInstallerPath"
}

# Keep a same-version installer beside the app so the uninstaller can offer repair.
$repairDir = Join-Path $portableBundleRoot "repair"
New-Item -ItemType Directory -Force -Path $repairDir | Out-Null
Copy-Item -LiteralPath $versionedInstallerPath -Destination (Join-Path $repairDir "DeviceStateConsoleAgent-setup.exe") -Force
$issContent = [System.IO.File]::ReadAllText($generatedIss, $utf8NoBom)
$issContent = $issContent.Replace(';__REPAIR_SETUP_FILE__', 'Source: "' + (Join-Path $portableBundleRoot 'repair\DeviceStateConsoleAgent-setup.exe') + '"; DestDir: "{app}\repair"; Flags: ignoreversion')
[System.IO.File]::WriteAllText($generatedIss, $issContent, $utf8WithBom)

& $resolvedIscc $generatedIss
if ($LASTEXITCODE -ne 0) {
  throw "Final installer build failed with exit code $LASTEXITCODE"
}

if (Test-Path $versionedInstallerPath) {
  Copy-Item -LiteralPath $versionedInstallerPath -Destination $stableInstallerPath -Force
  Write-Host "Stable setup alias updated: $stableInstallerPath"
} else {
  Write-Warning "Versioned installer was not found after ISCC build: $versionedInstallerPath"
}

if (Test-Path $updateZipPath) {
  Remove-Item -LiteralPath $updateZipPath -Force
}
Compress-Archive -LiteralPath $versionedInstallerPath -DestinationPath $updateZipPath -CompressionLevel Optimal
Write-Host "Update archive built: $updateZipPath"
Write-Host "Windows setup installer built."
Write-Host "Script: $generatedIss"
Write-Host "Output: $resolvedOutputDir"
