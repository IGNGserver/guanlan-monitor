#!/usr/bin/env bash
#
# Run the collector against the local stub hub for a fixed duration and capture
# its self-reported probe counters. Used by agent-performance-audit.yml; keep it
# runnable by hand so the measurement can be reproduced on a workstation.
#
# Intervals are shortened on purpose: a few minutes must contain many collection
# cycles, otherwise the run only measures process startup.
set -euo pipefail

duration="${DURATION:-180}"
hub_port="${HUB_PORT:-3199}"
hub_key="${HUB_KEY:-ci-agent-footprint}"
# Kept in the environment so the report can state the cadence its rate belongs
# to; the workflow passes the same values. See agent-performance-audit.yml.
fast_interval="${FAST_INTERVAL:-5}"
slow_interval="${SLOW_INTERVAL:-20}"

write_config() {
  local dir="$1"
  cat > "$dir/agent-ui.config.json" <<JSON
{
  "configVersion": 2,
  "connection": { "serverUrl": "http://127.0.0.1:${hub_port}", "secret": "${hub_key}", "deviceId": "ci-footprint", "hostname": "ci-footprint" },
  "sampling": { "normalIntervalSeconds": ${fast_interval}, "slowIntervalSeconds": ${slow_interval} },
  "cloudSyncEnabled": true,
  "dataRecordingEnabled": true
}
JSON
}

run_variant() {
  local label="$1"
  local binary="$2"
  local dir="run/$label"
  mkdir -p "$dir"
  write_config "$dir"
  local capture="$dir/ingests.jsonl"
  : > "$capture"

  node scripts/headless-hub-stub.mjs serve --port "$hub_port" --key "$hub_key" --capture "$capture" > "$dir/hub.log" 2>&1 &
  local hub_pid=$!
  sleep 3

  DSC_AGENT_CONFIG_FILE="$PWD/$dir/agent-ui.config.json" "$binary" > "$dir/agent.log" 2>&1 &
  local agent_pid=$!
  sleep "$duration"

  # The collector listens for os.Interrupt (SIGINT), not SIGTERM.
  kill -INT "$agent_pid" 2>/dev/null || true
  sleep 2
  kill -9 "$agent_pid" 2>/dev/null || true
  kill "$hub_pid" 2>/dev/null || true
  wait "$hub_pid" 2>/dev/null || true

  if [ ! -s "$capture" ]; then
    echo "[$label] no ingests captured; collector log tail:" >&2
    tail -n 40 "$dir/agent.log" >&2 || true
    echo "[$label] hub log tail:" >&2
    tail -n 20 "$dir/hub.log" >&2 || true
    return 1
  fi
  echo "[$label] captured $(wc -l < "$capture") ingests"
}

run_variant candidate "$PWD/run/candidate-bin/agent"
if [ -x "run/baseline-bin/agent" ]; then
  run_variant baseline "$PWD/run/baseline-bin/agent"
fi
