param(
  [int]$ServerPort = 19063,
  [int]$KeepAliveMs = 3000,
  [int]$ObservationSeconds = 8,
  [string]$ReportPath = ""
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

function Stop-ListeningProcessOnPort {
  param(
    [int]$Port
  )

  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($connections.Count -eq 0) {
    return
  }

  $owningProcessIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($owningProcessId in $owningProcessIds) {
    if ($owningProcessId -gt 0) {
      & cmd.exe /d /c "taskkill /PID $owningProcessId /T /F >nul 2>nul" | Out-Null
    }
  }
  Start-Sleep -Milliseconds 500
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedReportPath = Resolve-OptionalPath -RepoRoot $repoRoot -PathValue $ReportPath -FallbackPath (Join-Path $repoRoot ".codex-artifacts\windows-agent-control-stream-keepalive-report.json")

$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$pnpmInvocation = $null
if ($pnpmCommand) {
  $pnpmInvocation = "& '$($pnpmCommand.Source)' exec tsx src/index.ts"
} else {
  $corepackCommand = Get-Command corepack -ErrorAction SilentlyContinue
  if (-not $corepackCommand) {
    throw "pnpm or Corepack is required to start the server for keepalive verification."
  }
  $pnpmInvocation = "& '$($corepackCommand.Source)' pnpm exec tsx src/index.ts"
}
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js is required to observe the control-stream keepalive frames."
}

$serverWorkdir = Join-Path $repoRoot "apps\server"
$serverLogPath = Join-Path $repoRoot ".codex-artifacts\windows-agent-control-stream-keepalive-server.log"
$clientScriptPath = Join-Path $repoRoot ".codex-artifacts\verify-control-stream-keepalive-client.cjs"
$clientReportPath = Join-Path $repoRoot ".codex-artifacts\verify-control-stream-keepalive-client-report.json"
New-Item -ItemType Directory -Force -Path (Split-Path $serverLogPath -Parent) | Out-Null

$report = [ordered]@{
  verifiedAt = (Get-Date).ToString("o")
  serverPort = $ServerPort
  keepAliveMs = $KeepAliveMs
  observationSeconds = $ObservationSeconds
  serverReachable = $false
  statusCode = 0
  contentType = ""
  initialConnectedCommentObserved = $false
  keepaliveFramesObserved = 0
  keepaliveFrameIntervalsMs = @()
  linesSeen = @()
}

$serverProcess = $null

try {
  Stop-ListeningProcessOnPort -Port $ServerPort

  $serverStartCommand = @"
`$env:SESSION_SECRET='control-stream-keepalive-test'
`$env:ACCESS_KEY='control-stream-keepalive-access'
`$env:AGENT_SHARED_SECRET='control-stream-keepalive-secret'
`$env:SERVER_PORT='$ServerPort'
`$env:AGENT_CONTROL_KEEPALIVE_MS='$KeepAliveMs'
$pnpmInvocation *>> '$serverLogPath'
"@

  $serverProcess = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $serverStartCommand) `
    -WorkingDirectory $serverWorkdir `
    -WindowStyle Hidden `
    -PassThru

  $pingUrl = "http://127.0.0.1:$ServerPort/api/agent/ping"
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $ping = Invoke-RestMethod -Uri $pingUrl -Headers @{ Authorization = "Bearer control-stream-keepalive-secret" } -TimeoutSec 2
      if ($ping.ok) {
        $report.serverReachable = $true
        break
      }
    } catch {
    }
  }

  if (-not $report.serverReachable) {
    throw "Server did not become reachable at $pingUrl"
  }

  @"
const fs = require("node:fs");
const http = require("node:http");

const [url, authToken, observationMs, outputPath] = process.argv.slice(2);
const report = {
  statusCode: 0,
  contentType: "",
  initialConnectedCommentObserved: false,
  keepaliveFramesObserved: 0,
  keepaliveFrameIntervalsMs: [],
  linesSeen: []
};
const frameTimestamps = [];

const request = http.get(url, {
  headers: {
    Authorization: authToken,
    Accept: "text/event-stream"
  }
}, (response) => {
  report.statusCode = response.statusCode || 0;
  report.contentType = response.headers["content-type"] || "";
  response.setEncoding("utf8");

  let buffer = "";
  const finish = () => {
    for (let index = 1; index < frameTimestamps.length; index += 1) {
      report.keepaliveFrameIntervalsMs.push(frameTimestamps[index] - frameTimestamps[index - 1]);
    }
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    request.destroy();
  };

  response.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      if (report.linesSeen.length < 20) {
        report.linesSeen.push(line);
      }
      if (line.startsWith(": connected")) {
        report.initialConnectedCommentObserved = true;
      }
      if (line.startsWith("data:") && line.includes('"type":"viewer-realtime"')) {
        report.keepaliveFramesObserved += 1;
        frameTimestamps.push(Date.now());
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });

  response.on("error", (error) => {
    report.error = String(error);
  });

  setTimeout(finish, Number(observationMs));
});

request.on("error", (error) => {
  report.error = String(error);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  process.exit(1);
});
"@ | Set-Content -LiteralPath $clientScriptPath -Encoding UTF8

  if (Test-Path $clientReportPath) {
    Remove-Item -LiteralPath $clientReportPath -Force
  }

  & $nodeCommand.Source $clientScriptPath `
    "http://127.0.0.1:$ServerPort/api/agent/control-stream?deviceId=keepalive-test" `
    "Bearer control-stream-keepalive-secret" `
    ([Math]::Max(3000, $ObservationSeconds * 1000)) `
    $clientReportPath | Out-Null

  if (-not (Test-Path $clientReportPath)) {
    throw "Node keepalive observer did not produce a report."
  }

  $clientReport = Get-Content -LiteralPath $clientReportPath -Raw | ConvertFrom-Json
  $report.statusCode = [int]$clientReport.statusCode
  $report.contentType = [string]$clientReport.contentType
  $report.initialConnectedCommentObserved = [bool]$clientReport.initialConnectedCommentObserved
  $report.keepaliveFramesObserved = [int]$clientReport.keepaliveFramesObserved
  $report.keepaliveFrameIntervalsMs = @($clientReport.keepaliveFrameIntervalsMs)
  $report.linesSeen = @($clientReport.linesSeen)
  if ($clientReport.PSObject.Properties.Name -contains "error" -and -not [string]::IsNullOrWhiteSpace([string]$clientReport.error)) {
    $report.error = [string]$clientReport.error
  }

  if (-not $report.contentType.StartsWith("text/event-stream")) {
    throw "Control-stream did not return an SSE content-type."
  }

  if (-not $report.initialConnectedCommentObserved) {
    throw "Initial connected comment was not observed."
  }

  if ([int]$report.keepaliveFramesObserved -lt 2) {
    throw "Expected at least 2 control-stream snapshot frames during the observation window."
  }
}
finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    & cmd.exe /d /c "taskkill /PID $($serverProcess.Id) /T /F >nul 2>nul" | Out-Null
    Start-Sleep -Milliseconds 300
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $resolvedReportPath -Parent) | Out-Null
  Write-JsonReportWithRetry -Path $resolvedReportPath -Data $report
  Write-Host "Report: $resolvedReportPath"
}

Write-Host "Control-stream keepalive verification passed."
Write-Host "Keepalive frames: $($report.keepaliveFramesObserved)"
