#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

good_env="$test_root/good.env"
printf '%s\n' \
  'SESSION_SECRET=session-secret-for-compose-migration-test-1234567890' \
  'ACCESS_KEY=abc123' \
  'MYSQL_ROOT_PASSWORD=StrongRootSecret_1234567890' \
  'MYSQL_DATABASE=device_state_console' \
  'MYSQL_USER=dsc' \
  'MYSQL_PASSWORD=Strong-db/secret:1234567890' \
  'SESSION_COOKIE_SECURE=false' \
  'AGENT_REQUIRE_HTTPS=false' \
  'TRUST_PROXY=false' \
  'MYSQL_URL=mysql://dsc:old@127.0.0.1:3306/device_state_console' \
  > "$good_env"

DSC_RELEASE_CHANNEL=test bash "$root/scripts/prepare-compose-env.sh" "$good_env"
redis_password="$(sed -n 's/^REDIS_PASSWORD=//p' "$good_env")"
[[ "$redis_password" =~ ^[0-9a-f]{64}$ ]]
grep -Fxq "REDIS_URL=redis://:${redis_password}@redis:6379" "$good_env"
grep -Fxq 'MYSQL_URL=mysql://dsc:Strong-db%2Fsecret%3A1234567890@mysql:3306/device_state_console' "$good_env"
grep -Fxq 'SESSION_COOKIE_SECURE=false' "$good_env"
grep -Fxq 'AGENT_REQUIRE_HTTPS=false' "$good_env"
grep -Fxq 'TRUST_PROXY=true' "$good_env"
compgen -G "$good_env.pre-compose-security.*" >/dev/null
grep -Fq 'SESSION_COOKIE_SECURE: "${SESSION_COOKIE_SECURE:-true}"' "$root/docker-compose.yml"
grep -Fq 'AGENT_REQUIRE_HTTPS: "${AGENT_REQUIRE_HTTPS:-true}"' "$root/docker-compose.yml"

stable_env="$test_root/stable.env"
printf '%s\n' \
  'SESSION_SECRET=stable-session-secret-for-compose-migration-test-1234567890' \
  'ACCESS_KEY=abcdef' \
  'MYSQL_ROOT_PASSWORD=StableRootSecret_1234567890' \
  'MYSQL_DATABASE=device_state_console' \
  'MYSQL_USER=dsc' \
  'MYSQL_PASSWORD=StableDatabaseSecret_1234567890' \
  'SESSION_COOKIE_SECURE=true' \
  'AGENT_REQUIRE_HTTPS=true' \
  'TRUST_PROXY=false' \
  'MYSQL_URL=mysql://dsc:old@127.0.0.1:3306/device_state_console' \
  > "$stable_env"

DSC_RELEASE_CHANNEL=stable DSC_ALLOW_HTTP=true bash "$root/scripts/prepare-compose-env.sh" "$stable_env"
grep -Fxq 'SESSION_COOKIE_SECURE=false' "$stable_env"
grep -Fxq 'AGENT_REQUIRE_HTTPS=false' "$stable_env"
grep -Fxq 'TRUST_PROXY=true' "$stable_env"

weak_stable_env="$test_root/weak-stable.env"
printf '%s\n' \
  'SESSION_SECRET=stable-session-secret-for-compose-migration-test-1234567890' \
  'ACCESS_KEY=stableabc123' \
  'MYSQL_ROOT_PASSWORD=StableRootSecret_1234567890' \
  'MYSQL_DATABASE=device_state_console' \
  'MYSQL_USER=dsc' \
  'MYSQL_PASSWORD=shortdb' \
  > "$weak_stable_env"
cp "$weak_stable_env" "$weak_stable_env.before"
if preflight_output="$(DSC_RELEASE_CHANNEL=stable bash "$root/scripts/prepare-compose-env.sh" "$weak_stable_env" 2>&1)"; then
  echo "Weak MYSQL_PASSWORD unexpectedly passed the stable Compose environment preflight." >&2
  exit 1
fi
printf '%s\n' "$preflight_output" | grep -Fq 'MYSQL_PASSWORD must be an existing non-placeholder secret with at least 16 characters' || {
  echo "Stable preflight failed for an unexpected reason." >&2
  exit 1
}
cmp "$weak_stable_env.before" "$weak_stable_env"
if compgen -G "$weak_stable_env.pre-compose-security.*" >/dev/null; then
  echo "Stable preflight created a backup despite rejecting a weak database password." >&2
  exit 1
fi

weak_env="$test_root/weak.env"
printf '%s\n' \
  'SESSION_SECRET=session-secret-for-compose-migration-test-1234567890' \
  'ACCESS_KEY=replace-me' \
  'MYSQL_ROOT_PASSWORD=StrongRootSecret_1234567890' \
  'MYSQL_DATABASE=device_state_console' \
  'MYSQL_USER=dsc' \
  'MYSQL_PASSWORD=StrongDatabaseSecret_1234567890' \
  > "$weak_env"
cp "$weak_env" "$weak_env.before"
if DSC_RELEASE_CHANNEL=test bash "$root/scripts/prepare-compose-env.sh" "$weak_env"; then
  echo "Weak ACCESS_KEY unexpectedly passed the Compose environment preflight." >&2
  exit 1
fi
cmp "$weak_env.before" "$weak_env"
if compgen -G "$weak_env.pre-compose-security.*" >/dev/null; then
  echo "Preflight created a backup even though validation failed before mutation." >&2
  exit 1
fi

python3 - "$root/.github/workflows/deploy-production.yml" <<'PY'
from pathlib import Path
import re
import subprocess
import sys

workflow = Path(sys.argv[1]).read_text()
wrappers = re.findall(
    r"(?ms)^ {10}(run_ssh|run_scp)\(\) \{\n(.*?)^ {10}\}", workflow
)
wrapper_names = [name for name, _ in wrappers]
if wrapper_names.count("run_ssh") != 4 or wrapper_names.count("run_scp") != 1:
    raise SystemExit("Expected four SSH and one SCP retry wrappers in the production workflow.")

for name, indented_body in wrappers:
    body = "\n".join(
        line[10:] if line.startswith(" " * 10) else line
        for line in indented_body.splitlines()
    )
    body = body.replace("local max_attempts=5", "local max_attempts=1")
    status = 37 if name == "run_ssh" else 43
    command = f"""
ssh() {{ return 37; }}
scp() {{ return 43; }}
sleep() {{ :; }}
{name}() {{
{body}
}}
{name} regression-destination
"""
    result = subprocess.run(["bash", "-c", command], check=False)
    if result.returncode != status:
        raise SystemExit(f"{name} converted a failed command into exit {result.returncode}; expected {status}.")
print("Production SSH/SCP failure propagation checks: PASS")
PY

echo "Compose environment migration tests: PASS"
