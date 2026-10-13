#!/bin/bash
# CI ephemeral-runner acceptance only. Explicitly installs/removes the test
# package; never use as a read-only host inventory tool.
set -euo pipefail
package="${1:?validation pkg required}"
output="${2:?evidence directory required}"
mkdir -p "$output"
cli='/Library/PrivilegedHelperTools/Guanlan/guanlan-agent'
config='/Library/Application Support/Guanlan/agent-ui.config.json'
sudo /usr/sbin/installer -pkg "$package" -target / > "$output/installer.log"
for attempt in $(seq 1 20); do
  sudo "$cli" status --json > "$output/status.json"
  if python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["serviceRunning"]' "$output/status.json"; then break; fi
  sleep 1
done
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["serviceRunning"] and d["serviceKind"]=="launchd"' "$output/status.json"
if "$cli" service stop > "$output/unprivileged-stop.log" 2>&1; then
  echo 'Unprivileged caller unexpectedly stopped the system service' >&2
  exit 1
fi
sudo "$cli" service stop
sudo "$cli" service start
sudo /bin/launchctl print system/org.igng.guanlan.agent > "$output/launchd.txt"
sudo "$cli" service uninstall
sudo test -f "$config"
sudo "$cli" service status --json > "$output/uninstalled.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert not d["installed"] and not d["running"]' "$output/uninstalled.json"
echo 'PASS: system service start/stop/restart; non-root denial; uninstall preserves config.' > "$output/lifecycle-result.txt"
