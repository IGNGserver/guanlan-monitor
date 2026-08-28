#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-}"
if [[ -z "$env_file" || ! -f "$env_file" ]]; then
  echo "Usage: $0 /path/to/.env (the file must already exist)." >&2
  exit 1
fi

env_dir="$(cd "$(dirname "$env_file")" && pwd)"
env_file="$env_dir/$(basename "$env_file")"

read_env() {
  local key="$1"
  awk -v key="$key" '
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      sub(/\r$/, "", value)
      print value
      exit
    }
  ' "$env_file"
}

unquote() {
  local value="$1"
  if [[ ${#value} -ge 2 ]]; then
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf '%s' "$value"
}

is_weak_secret() {
  local value="$1"
  local minimum="$2"
  local lowered
  lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  if (( ${#value} < minimum )); then
    return 0
  fi
  case "$lowered" in
    *change-me*|*replace-me*|*change_me*|*replace_me*|*example*|*default*|*password*) return 0 ;;
  esac
  return 1
}

require_strong_secret() {
  local key="$1"
  local minimum="$2"
  local value
  value="$(unquote "$(read_env "$key")")"
  if is_weak_secret "$value" "$minimum"; then
    echo "$key must be an existing non-placeholder secret with at least $minimum characters; it was not changed." >&2
    exit 1
  fi
  printf '%s' "$value"
}

url_encode() {
  local value="$1"
  local output=""
  local character
  local encoded
  local index
  LC_ALL=C
  for ((index = 0; index < ${#value}; index++)); do
    character="${value:index:1}"
    case "$character" in
      [a-zA-Z0-9.~_-]) output+="$character" ;;
      *)
        printf -v encoded '%%%02X' "'$character"
        output+="$encoded"
        ;;
    esac
  done
  printf '%s' "$output"
}

session_secret="$(require_strong_secret SESSION_SECRET 32)"
access_key="$(require_strong_secret ACCESS_KEY 32)"
mysql_root_password="$(require_strong_secret MYSQL_ROOT_PASSWORD 16)"
mysql_password="$(require_strong_secret MYSQL_PASSWORD 16)"
mysql_database="$(unquote "$(read_env MYSQL_DATABASE)")"
mysql_user="$(unquote "$(read_env MYSQL_USER)")"

if [[ ! "$mysql_database" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "MYSQL_DATABASE must be present and contain only letters, digits, dot, underscore, or hyphen." >&2
  exit 1
fi
if [[ ! "$mysql_user" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "MYSQL_USER must be present and contain only letters, digits, dot, underscore, or hyphen." >&2
  exit 1
fi

redis_password="$(unquote "$(read_env REDIS_PASSWORD)")"
if is_weak_secret "$redis_password" 16; then
  command -v openssl >/dev/null 2>&1 || {
    echo "openssl is required to generate REDIS_PASSWORD safely." >&2
    exit 1
  }
  redis_password="$(openssl rand -hex 32)"
fi
if [[ ! "$redis_password" =~ ^[A-Za-z0-9.~_-]+$ ]]; then
  echo "Existing REDIS_PASSWORD contains characters that cannot be rewritten safely; replace it with a URL-safe secret and retry." >&2
  exit 1
fi

# Keep these reads so shellcheck and reviewers can see all validated, non-rotatable values.
[[ -n "$session_secret" && -n "$access_key" && -n "$mysql_root_password" ]]

backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$env_file.pre-compose-security.$backup_stamp"
counter=0
while [[ -e "$backup_file" ]]; do
  counter=$((counter + 1))
  backup_file="$env_file.pre-compose-security.$backup_stamp.$counter"
done
cp -p "$env_file" "$backup_file"

working_file="$(mktemp "$env_dir/.env.compose-security.XXXXXX")"
trap 'rm -f "$working_file" "$working_file.next"' EXIT
cp -p "$env_file" "$working_file"

set_env() {
  local key="$1"
  local value="$2"
  DSC_ENV_KEY="$key" DSC_ENV_VALUE="$value" awk '
    BEGIN { key = ENVIRON["DSC_ENV_KEY"]; value = ENVIRON["DSC_ENV_VALUE"]; found = 0 }
    index($0, key "=") == 1 {
      if (!found) print key "=" value
      found = 1
      next
    }
    { print }
    END { if (!found) print key "=" value }
  ' "$working_file" > "$working_file.next"
  mv "$working_file.next" "$working_file"
}

set_env REDIS_PASSWORD "$redis_password"
set_env REDIS_URL "redis://:$(url_encode "$redis_password")@redis:6379"
set_env MYSQL_URL "mysql://$(url_encode "$mysql_user"):$(url_encode "$mysql_password")@mysql:3306/$(url_encode "$mysql_database")"
set_env SESSION_COOKIE_SECURE true
set_env AGENT_REQUIRE_HTTPS true
set_env TRUST_PROXY true

mv "$working_file" "$env_file"
trap - EXIT

echo "Compose environment preflight: PASS"
echo "Backup: $backup_file"
echo "Updated keys: REDIS_PASSWORD REDIS_URL MYSQL_URL SESSION_COOKIE_SECURE AGENT_REQUIRE_HTTPS TRUST_PROXY"
