# Run the collector against the local stub hub for a fixed duration and capture
# its self-reported probe counters on Windows. Used by agent-performance-audit.yml.
#
# Intervals are shortened on purpose so a few minutes contain many collection
# cycles.
$ErrorActionPreference = "Stop"

$duration = if ($env:DURATION) { [int]$env:DURATION } else { 180 }
$port = if ($env:HUB_PORT) { $env:HUB_PORT } else { "3199" }
$key = if ($env:HUB_KEY) { $env:HUB_KEY } else { "ci-agent-footprint" }
# Kept in the environment so the report can state the cadence its rate belongs
# to; the workflow passes the same values. See agent-performance-audit.yml.
$fastInterval = if ($env:FAST_INTERVAL) { [int]$env:FAST_INTERVAL } else { 5 }
$slowInterval = if ($env:SLOW_INTERVAL) { [int]$env:SLOW_INTERVAL } else { 20 }

function Write-AgentConfig([string]$dir) {
  $config = @{
    configVersion        = 2
    connection           = @{
      serverUrl = "http://127.0.0.1:$port"
      secret    = $key
      deviceId  = "ci-footprint"
      hostname  = "ci-footprint"
    }
    sampling             = @{ normalIntervalSeconds = $fastInterval; slowIntervalSeconds = $slowInterval }
    cloudSyncEnabled     = $true
    dataRecordingEnabled = $true
  }
  $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $dir "agent-ui.config.json") -Encoding utf8
}

function Invoke-Variant([string]$label, [string]$binary) {
  $dir = Join-Path "run" $label
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-AgentConfig $dir
  $capture = Join-Path $dir "ingests.jsonl"
  if (Test-Path -LiteralPath $capture) { Remove-Item -LiteralPath $capture -Force }
  # Node accepts forward slashes; they also avoid Start-Process quoting issues.
  $captureArg = $capture.Replace("\", "/")

  $hub = Start-Process -FilePath "node" `
    -ArgumentList @("scripts/headless-hub-stub.mjs", "serve", "--port", $port, "--key", $key, "--capture", $captureArg) `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dir "hub.log") `
    -RedirectStandardError (Join-Path $dir "hub.err.log")
  Start-Sleep -Seconds 3

  $env:DSC_AGENT_CONFIG_FILE = (Resolve-Path (Join-Path $dir "agent-ui.config.json")).Path
  # The collector logs through `log.Printf`, i.e. to stderr. Start-Process cannot
  # merge the two streams, and capturing only stdout silently produced an empty
  # agent.log on Windows, so both are redirected and both are uploaded.
  $agent = Start-Process -FilePath $binary -PassThru -WindowStyle Hidden -WorkingDirectory $dir `
    -RedirectStandardOutput (Join-Path $dir "agent.log") `
    -RedirectStandardError (Join-Path $dir "agent.err.log")
  Start-Sleep -Seconds $duration

  Stop-Process -Id $agent.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Stop-Process -Id $hub.Id -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\DSC_AGENT_CONFIG_FILE -ErrorAction SilentlyContinue

  $count = if (Test-Path -LiteralPath $capture) { (Get-Content -LiteralPath $capture | Measure-Object -Line).Lines } else { 0 }
  if ($count -eq 0) {
    Write-Output "[$label] no ingests captured; collector stderr tail:"
    foreach ($log in @("agent.err.log", "agent.log")) {
      $path = Join-Path $dir $log
      if (Test-Path -LiteralPath $path) { Write-Output "--- $log ---"; Get-Content -LiteralPath $path -Tail 40 }
    }
    throw "[$label] the collector never reached the stub hub"
  }
  Write-Output "[$label] captured $count ingests"
}

Invoke-Variant -label "candidate" -binary ((Resolve-Path "run/candidate-bin/agent.exe").Path)
if (Test-Path "run/baseline-bin/agent.exe") {
  Invoke-Variant -label "baseline" -binary ((Resolve-Path "run/baseline-bin/agent.exe").Path)
}
