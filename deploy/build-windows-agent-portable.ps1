param(
  [string]$OutputDir = "",
  [string]$WinUIPublishDir = "",
  [string]$DotnetPath = "",
  [string]$GoPath = "",
  [string]$Configuration = "Release",
  [switch]$SkipGoBuild,
  [switch]$Zip
)

$ErrorActionPreference = "Stop"

function Resolve-CommandPath {
  param(
    [string]$PreferredPath,
    [string]$CommandName,
    [string]$RequiredMessage
  )

  if (-not [string]::IsNullOrWhiteSpace($PreferredPath)) {
    if (-not (Test-Path $PreferredPath)) {
      throw "$CommandName executable not found: $PreferredPath"
    }
    return (Resolve-Path $PreferredPath).Path
  }

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $fallbackCandidates = @()
  if ($CommandName -eq "dotnet") {
    $fallbackCandidates = @(
      (Join-Path $env:USERPROFILE ".dotnet\dotnet.exe"),
      "C:\Program Files\dotnet\dotnet.exe",
      "C:\Program Files (x86)\dotnet\dotnet.exe"
    )
  }

  foreach ($candidate in $fallbackCandidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw $RequiredMessage
}

function Copy-DirectoryContent {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path $Source)) {
    throw "Source directory not found: $Source"
  }

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Resolve-FirstExistingPath {
  param(
    [string[]]$Candidates,
    [string]$Description
  )

  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw "$Description not found. Checked:`n - $($Candidates -join "`n - ")"
}

function Resolve-WinUiPublishFallback {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$Configuration
  )

  $candidates = @(
    (Join-Path $RepoRoot ("windows-agent\DeviceStateConsoleAgent.WinUI\bin\x64\{0}\net8.0-windows10.0.19041.0\win-x64" -f $Configuration)),
    (Join-Path $RepoRoot ("windows-agent\DeviceStateConsoleAgent.WinUI\bin\win-x64\{0}\net8.0-windows10.0.19041.0\publish" -f $Configuration)),
    (Join-Path $RepoRoot ("windows-agent\DeviceStateConsoleAgent.WinUI\bin\{0}\net8.0-windows10.0.19041.0\win-x64" -f $Configuration)),
    (Join-Path $RepoRoot ("windows-agent\DeviceStateConsoleAgent.WinUI\bin\{0}\net8.0-windows10.0.19041.0\publish" -f $Configuration))
  )

  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path $candidate)) {
      continue
    }

    $frontendExe = Join-Path $candidate "DeviceStateConsoleAgent.WinUI.exe"
    $frontendDll = Join-Path $candidate "DeviceStateConsoleAgent.WinUI.dll"
    $runtimeConfig = Join-Path $candidate "DeviceStateConsoleAgent.WinUI.runtimeconfig.json"
    $iconPath = Join-Path $candidate "app-icon.ico"
    if ((Test-Path $frontendExe) -and (Test-Path $frontendDll) -and (Test-Path $runtimeConfig) -and (Test-Path $iconPath)) {
      return (Resolve-Path $candidate).Path
    }
  }

  return $null
}

function Test-DotnetSdkAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DotnetExecutable
  )

  $sdkOutput = & $DotnetExecutable --list-sdks 2>$null
  return $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($sdkOutput | Out-String).Trim())
}

function Resolve-DotnetDesktopRuntimeInstaller {
  param(
    [string]$RepoRoot
  )

  $cacheDir = Join-Path $RepoRoot ".codex-artifacts\dotnet"
  $installerPath = Join-Path $cacheDir "windowsdesktop-runtime-win-x64.exe"
  if (Test-Path $installerPath) {
    return (Resolve-Path $installerPath).Path
  }

  $downloadUrl = "https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe"
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
  Write-Host "Downloading .NET Windows Desktop Runtime installer from $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath
  return (Resolve-Path $installerPath).Path
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

function Stop-ProcessesForPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath
  )

  $normalizedRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd('\') + '\'
  $targets = @("DeviceStateConsoleAgent.WinUI", "device-state-console-agent", "windows-agent-backend")
  foreach ($name in $targets) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $processPath = $_.Path
        if ([string]::IsNullOrWhiteSpace($processPath)) {
          return
        }

        $normalizedProcessPath = [System.IO.Path]::GetFullPath($processPath)
        if ($normalizedProcessPath.StartsWith($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
          Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
      } catch {
      }
    }
  }

  Start-Sleep -Milliseconds 400
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$winUiProject = Join-Path $repoRoot "windows-agent\DeviceStateConsoleAgent.WinUI\DeviceStateConsoleAgent.WinUI.csproj"
$agentSourceDir = Join-Path $repoRoot "agents"
$backendSourcePackage = "./cmd/windows-agent-backend"
$hardwareAssetDir = Join-Path $repoRoot "agents\windows-hardware"
$defaultOutputDir = Join-Path $repoRoot "release\windows-agent-portable"
$resolvedOutputDir = if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $defaultOutputDir
} elseif ([System.IO.Path]::IsPathRooted($OutputDir)) {
  $OutputDir
} else {
  Join-Path $repoRoot $OutputDir
}
$resolvedOutputDir = [System.IO.Path]::GetFullPath($resolvedOutputDir)
$stagingDir = Join-Path $resolvedOutputDir "DeviceStateConsoleAgent"
$backendDir = Join-Path $stagingDir "backend"
$runtimeDir = Join-Path $stagingDir "runtime"
$tempDir = Join-Path $resolvedOutputDir ".tmp"
$tempWinUiDir = Join-Path $tempDir "winui-publish"
$zipPath = Join-Path $resolvedOutputDir "DeviceStateConsoleAgent-portable.zip"

New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null
if (Test-Path $stagingDir) {
  Stop-ProcessesForPath -RootPath $stagingDir
  Remove-DirectoryWithRetry -Path $stagingDir
}
if (Test-Path $tempDir) {
  Stop-ProcessesForPath -RootPath $tempDir
  Remove-DirectoryWithRetry -Path $tempDir
}
New-Item -ItemType Directory -Force -Path $backendDir, $runtimeDir, $tempDir | Out-Null

$resolvedGoPath = $null
if (-not $SkipGoBuild) {
  $resolvedGoPath = Resolve-CommandPath -PreferredPath $GoPath -CommandName "go" -RequiredMessage "Go is required to build windows-agent-backend.exe and device-state-console-agent.exe. Install Go or pass -GoPath."
  Write-Host "Building Go binaries with $resolvedGoPath"

  & $resolvedGoPath build -C $agentSourceDir -o (Join-Path $backendDir "windows-agent-backend.exe") $backendSourcePackage
  & $resolvedGoPath build -C $agentSourceDir -o (Join-Path $backendDir "device-state-console-agent.exe") .
} else {
  $prebuiltBackend = Resolve-FirstExistingPath -Candidates @(
    (Join-Path $repoRoot "agents\windows-agent-backend.exe"),
    (Join-Path $repoRoot "agents\release\windows-agent-backend.exe")
  ) -Description "Prebuilt backend"
  $prebuiltCollector = Resolve-FirstExistingPath -Candidates @(
    (Join-Path $repoRoot "agents\release\device-state-console-agent-windows-amd64.exe"),
    (Join-Path $repoRoot "agents\device-state-console-agent.exe"),
    (Join-Path $repoRoot "agents\agent.exe")
  ) -Description "Prebuilt collector"
  Copy-Item -LiteralPath $prebuiltBackend -Destination (Join-Path $backendDir "windows-agent-backend.exe") -Force
  Copy-Item -LiteralPath $prebuiltCollector -Destination (Join-Path $backendDir "device-state-console-agent.exe") -Force
}

Copy-DirectoryContent -Source $hardwareAssetDir -Destination (Join-Path $backendDir "windows-hardware")

$resolvedWinUiPublishDir = $null
if (-not [string]::IsNullOrWhiteSpace($WinUIPublishDir)) {
  $candidateWinUiPublishDir = if ([System.IO.Path]::IsPathRooted($WinUIPublishDir)) {
    $WinUIPublishDir
  } else {
    Join-Path $repoRoot $WinUIPublishDir
  }
  $resolvedWinUiPublishDir = (Resolve-Path $candidateWinUiPublishDir).Path
  $verifyWinUiPublishScript = Join-Path $repoRoot "deploy\verify-windows-winui-publish.ps1"
  $verifyWinUiPublishReport = Join-Path $tempDir "winui-publish-report.json"
  & powershell -ExecutionPolicy Bypass -File $verifyWinUiPublishScript `
    -PublishDir $resolvedWinUiPublishDir `
    -ReportPath $verifyWinUiPublishReport | Out-Null
} else {
  $verifyWinUiPublishScript = Join-Path $repoRoot "deploy\verify-windows-winui-publish.ps1"
  $verifyWinUiPublishReport = Join-Path $tempDir "winui-publish-report.json"
  $resolvedDotnetPath = Resolve-CommandPath -PreferredPath $DotnetPath -CommandName "dotnet" -RequiredMessage "WinUI publish output was not provided and dotnet was not found. Build the WinUI app on a machine with .NET and Windows App SDK, or pass -WinUIPublishDir."
  $publishSucceeded = $false
  $sdkAvailable = Test-DotnetSdkAvailable -DotnetExecutable $resolvedDotnetPath
  if ($sdkAvailable) {
    Write-Host "Publishing WinUI app with $resolvedDotnetPath"
  } else {
    Write-Warning "No .NET SDK was detected for $resolvedDotnetPath. Skipping dotnet publish and looking for reusable WinUI output."
  }

  if ($sdkAvailable) {
    try {
      & $resolvedDotnetPath publish $winUiProject `
        -c $Configuration `
        -p:Platform=x64 `
        -p:RuntimeIdentifier=win-x64 `
        -o $tempWinUiDir
      if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed with exit code $LASTEXITCODE"
      }

      & powershell -ExecutionPolicy Bypass -File $verifyWinUiPublishScript `
        -PublishDir $tempWinUiDir `
        -ReportPath $verifyWinUiPublishReport | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "verify-windows-winui-publish.ps1 failed for freshly published WinUI output."
      }
      $resolvedWinUiPublishDir = $tempWinUiDir
      $publishSucceeded = $true
    } catch {
      $fallbackWinUiPublishDir = Resolve-WinUiPublishFallback -RepoRoot $repoRoot -Configuration $Configuration
      if ([string]::IsNullOrWhiteSpace($fallbackWinUiPublishDir)) {
        throw
      }

      Write-Warning "dotnet publish failed. Falling back to existing WinUI output: $fallbackWinUiPublishDir"
      & powershell -ExecutionPolicy Bypass -File $verifyWinUiPublishScript `
        -PublishDir $fallbackWinUiPublishDir `
        -ReportPath $verifyWinUiPublishReport | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "verify-windows-winui-publish.ps1 failed for fallback WinUI output: $fallbackWinUiPublishDir"
      }
      $resolvedWinUiPublishDir = $fallbackWinUiPublishDir
    }
  } else {
    $fallbackWinUiPublishDir = Resolve-WinUiPublishFallback -RepoRoot $repoRoot -Configuration $Configuration
    if ([string]::IsNullOrWhiteSpace($fallbackWinUiPublishDir)) {
      throw "No .NET SDK was available and no reusable WinUI output directory was found."
    }

    Write-Warning "Falling back to existing WinUI output: $fallbackWinUiPublishDir"
    & powershell -ExecutionPolicy Bypass -File $verifyWinUiPublishScript `
      -PublishDir $fallbackWinUiPublishDir `
      -ReportPath $verifyWinUiPublishReport | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "verify-windows-winui-publish.ps1 failed for fallback WinUI output: $fallbackWinUiPublishDir"
    }
    $resolvedWinUiPublishDir = $fallbackWinUiPublishDir
  }

  if (-not $publishSucceeded -and [string]::IsNullOrWhiteSpace($resolvedWinUiPublishDir)) {
    throw "WinUI publish failed and no reusable WinUI output directory was found."
  }
}

Copy-DirectoryContent -Source $resolvedWinUiPublishDir -Destination $stagingDir

$readmeSource = Join-Path $repoRoot "windows-agent\README.md"
$releaseGuideSource = Join-Path $repoRoot "deploy\windows-agent-release.md"
$dotnetRuntimeInstallerScriptSource = Join-Path $repoRoot "windows-agent\install-dotnet-runtime.ps1"
$agentLauncherScriptSource = Join-Path $repoRoot "windows-agent\start-agent.ps1"
$agentLauncherCmdSource = Join-Path $repoRoot "windows-agent\start-agent.cmd"
$agentLauncherVbsSource = Join-Path $repoRoot "windows-agent\start-agent.vbs"
$dotnetDesktopRuntimeInstaller = Resolve-DotnetDesktopRuntimeInstaller -RepoRoot $repoRoot
$bundleVersionPath = Join-Path $stagingDir "INSTALLER_VERSION.txt"
Copy-Item -LiteralPath $readmeSource -Destination (Join-Path $stagingDir "README.md") -Force
Copy-Item -LiteralPath $dotnetRuntimeInstallerScriptSource -Destination (Join-Path $stagingDir "install-dotnet-runtime.ps1") -Force
Copy-Item -LiteralPath $agentLauncherScriptSource -Destination (Join-Path $stagingDir "start-agent.ps1") -Force
Copy-Item -LiteralPath $agentLauncherCmdSource -Destination (Join-Path $stagingDir "start-agent.cmd") -Force
Copy-Item -LiteralPath $agentLauncherVbsSource -Destination (Join-Path $stagingDir "start-agent.vbs") -Force
Copy-Item -LiteralPath $dotnetDesktopRuntimeInstaller -Destination (Join-Path $runtimeDir "windowsdesktop-runtime-win-x64.exe") -Force
"Windows Agent bundle prepared at $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")" | Set-Content -LiteralPath $bundleVersionPath -Encoding UTF8
if (Test-Path $releaseGuideSource) {
  Copy-Item -LiteralPath $releaseGuideSource -Destination (Join-Path $stagingDir "RELEASE.md") -Force
}

if ($Zip) {
  if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -Path $stagingDir -DestinationPath $zipPath -CompressionLevel Optimal
}

Write-Host "Windows portable agent package prepared."
Write-Host "Root: $stagingDir"
Write-Host "Frontend: $(Join-Path $stagingDir 'DeviceStateConsoleAgent.WinUI.exe')"
Write-Host "Backend: $(Join-Path $backendDir 'windows-agent-backend.exe')"
Write-Host "Collector: $(Join-Path $backendDir 'device-state-console-agent.exe')"
Write-Host "Hardware assets: $(Join-Path $backendDir 'windows-hardware')"
if ($Zip) {
  Write-Host "Zip: $zipPath"
}
