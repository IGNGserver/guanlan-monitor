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
grep -Fxq 'SESSION_COOKIE_SECURE=true' "$good_env"
grep -Fxq 'AGENT_REQUIRE_HTTPS=false' "$good_env"
grep -Fxq 'TRUST_PROXY=true' "$good_env"
compgen -G "$good_env.pre-compose-security.*" >/dev/null
grep -Fq 'AGENT_REQUIRE_HTTPS: "${AGENT_REQUIRE_HTTPS:-true}"' "$root/docker-compose.yml"

stable_env="$test_root/stable.env"
printf '%s\n' \
  'SESSION_SECRET=stable-session-secret-for-compose-migration-test-1234567890' \
  'ACCESS_KEY=stable-access-key-for-compose-migration-test-1234567890' \
  'MYSQL_ROOT_PASSWORD=StableRootSecret_1234567890' \
  'MYSQL_DATABASE=device_state_console' \
  'MYSQL_USER=dsc' \
  'MYSQL_PASSWORD=StableDatabaseSecret_1234567890' \
  'SESSION_COOKIE_SECURE=false' \
  'AGENT_REQUIRE_HTTPS=false' \
  'TRUST_PROXY=false' \
  'MYSQL_URL=mysql://dsc:old@127.0.0.1:3306/device_state_console' \
  > "$stable_env"

DSC_RELEASE_CHANNEL=stable bash "$root/scripts/prepare-compose-env.sh" "$stable_env"
grep -Fxq 'SESSION_COOKIE_SECURE=true' "$stable_env"
grep -Fxq 'AGENT_REQUIRE_HTTPS=true' "$stable_env"
grep -Fxq 'TRUST_PROXY=true' "$stable_env"

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

echo "Compose environment migration tests: PASS"
