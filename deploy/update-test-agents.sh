#!/usr/bin/env bash
set -euo pipefail

: "${REQUESTED_VERSION:?REQUESTED_VERSION is required}"
: "${TARGETS:?TARGETS is required}"

if [[ ! "$REQUESTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Agent update requires a fixed semantic version." >&2
  exit 1
fi

for command in dpkg dpkg-deb dpkg-query grep journalctl python3 sha256sum ssh scp sudo systemctl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required on the NAS Actions runner." >&2
    exit 1
  }
done

work_root="${RUNNER_TEMP:-/tmp}"
run_id="${GITHUB_RUN_ID:-manual}"
work_dir="$work_root/dsc-agent-update-$run_id"
artifact_dir="$work_root/dsc-agent-artifact-$run_id"
trap 'rm -rf "$work_dir"' EXIT
package="$(find "$artifact_dir" -maxdepth 1 -type f -name "DeviceStateConsole-Linux-Install-v$REQUESTED_VERSION.deb" -print -quit)"
[[ -n "$package" && -f "$package" ]] || {
  echo "The fixed-version Linux package is unavailable." >&2
  exit 1
}
checksum="$package.sha256"
[[ -f "$checksum" ]] || {
  echo "The Linux package checksum is unavailable." >&2
  exit 1
}

verify_asset_checksum() {
  local file="$1"
  local manifest="$2"
  local expected actual
  expected="$(awk 'NR == 1 { print $1 }' "$manifest")"
  [[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || {
    echo "The checksum manifest is invalid: $manifest" >&2
    return 1
  }
  actual="$(sha256sum "$file" | awk '{ print $1 }')"
  [[ "$actual" == "$expected" ]] || {
    echo "The checksum does not match the manifest: $file" >&2
    return 1
  }
}

verify_asset_checksum "$package" "$checksum"

rm -rf "$work_dir"
mkdir -p "$work_dir/package" "$work_dir/rollback"
dpkg-deb -x "$package" "$work_dir/package"
agent_binary="$(find "$work_dir/package" -type f -path '*/resources/agent/device-state-console-agent' -print -quit)"
[[ -n "$agent_binary" && -x "$agent_binary" ]] || {
  echo "The Linux package does not contain an executable collector." >&2
  exit 1
}
agent_reported="$("$agent_binary" version)"
[[ "$agent_reported" == "$REQUESTED_VERSION (test)" ]] || {
  echo "The package collector reported '$agent_reported', expected '$REQUESTED_VERSION (test)'." >&2
  exit 1
}

remote_user="${DEPLOY_USER:-root}"
remote_password="${DEPLOY_PASSWORD:-}"
target_list=()
for target in $TARGETS; do
  [[ "$target" =~ ^[A-Za-z0-9_.:-]+$ ]] || {
    echo "Invalid SSH target: $target" >&2
    exit 1
  }
  target_list+=("$target")
done
(( ${#target_list[@]} > 0 )) || {
  echo "At least one Agent target is required." >&2
  exit 1
}

ssh_options=(-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${HOME}/.ssh/known_hosts")
if [[ -s "${HOME}/.ssh/id_ed25519" ]]; then
  ssh_options+=(-i "${HOME}/.ssh/id_ed25519")
fi

is_local_target() {
  [[ "$1" == "nas" || "$1" == "localhost" || "$1" == "127.0.0.1" ]]
}

sudo_run() {
  if [[ -n "$remote_password" ]]; then
    printf '%s\n' "$remote_password" | sudo -S -p '' "$@"
  else
    sudo -n "$@"
  fi
}

run_target_script() {
  local target="$1"
  local script_path="$2"
  shift 2
  if is_local_target "$target"; then
    if [[ -n "$remote_password" ]]; then
      {
        printf '%s\n' "$remote_password"
        cat "$script_path"
      } | sudo -S -p '' bash -s -- "$@"
    else
      sudo -n bash -s -- "$@" < "$script_path"
    fi
  else
    ssh "${ssh_options[@]}" "$remote_user@$target" bash -s -- "$@" < "$script_path"
  fi
}

preflight_script="$work_dir/preflight.sh"
cat > "$preflight_script" <<'REMOTE'
set -euo pipefail

if systemctl is-active --quiet guanlan-agent.service && systemctl is-enabled --quiet guanlan-agent.service; then
  package_version="$(dpkg-query -W -f='${Version}' guanlan-desktop 2>/dev/null)"
  [[ "$package_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "The installed Guanlan desktop package version is not a fixed semantic version." >&2
    exit 1
  }
  version_report="$(guanlan-agent version)"
  [[ "$version_report" == "$package_version (test)" ]] || {
    echo "The installed package and Agent versions disagree or are not on the test channel." >&2
    exit 1
  }
  status_json="$(guanlan-agent status --json)"
  python3 -c 'import json,sys; d=json.load(sys.stdin); ok=(d.get("serviceInstalled") and d.get("serviceRunning") and d.get("configured") and d.get("daemonReachable") and d.get("collectorRunning") and d.get("connectionStatus")=="connected" and d.get("channel")=="test"); sys.exit(0 if ok else 1)' <<< "$status_json" || {
    echo "The installed Guanlan Agent is not configured, connected, and healthy." >&2
    exit 1
  }
  printf 'modern|%s\n' "$package_version"
elif systemctl is-active --quiet device-state-console-agent.service && systemctl is-enabled --quiet device-state-console-agent.service; then
  [[ -x /opt/device-state-console-agent/device-state-console-agent ]] || {
    echo "The legacy Agent service has no executable at its expected install path." >&2
    exit 1
  }
  printf 'legacy|%s\n' "$(cat /opt/device-state-console-agent/VERSION 2>/dev/null || printf unknown)"
else
  echo "No supported active and enabled Guanlan Agent service was found." >&2
  exit 1
fi
REMOTE

modern_update_script="$work_dir/update-modern.sh"
cat > "$modern_update_script" <<'REMOTE'
set -euo pipefail
version="$1"
expected_previous_version="$2"
stage_dir="$3"
new_package="$stage_dir/new.deb"
rollback_package="$stage_dir/rollback.deb"
unit="guanlan-agent.service"

[[ -f "$new_package" && -f "$rollback_package" ]] || {
  echo "New or rollback package is missing on the target." >&2
  exit 1
}
installed_version="$(dpkg-query -W -f='${Version}' guanlan-desktop 2>/dev/null)"
[[ "$installed_version" == "$expected_previous_version" ]] || {
  echo "The installed package changed after preflight; refusing to update." >&2
  exit 1
}

status_before="$(guanlan-agent status --json)"
last_upload_before="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("lastUploadAt") or "")' <<< "$status_before")"
started_at="$(date --iso-8601=seconds)"

rollback() {
  set +e
  DEBIAN_FRONTEND=noninteractive dpkg --force-confold -i "$rollback_package" >&2
  systemctl daemon-reload
  systemctl restart "$unit"
  if systemctl is-active --quiet "$unit" &&
    [[ "$(guanlan-agent version 2>/dev/null)" == "$expected_previous_version (test)" ]]; then
    echo "The previous Guanlan package was restored." >&2
    return 0
  fi
  echo "Rollback could not restore the previous Agent; staged files remain at $stage_dir." >&2
  return 1
}

if ! DEBIAN_FRONTEND=noninteractive dpkg --force-confold -i "$new_package" >&2; then
  rollback || true
  exit 1
fi
systemctl daemon-reload
if ! systemctl restart "$unit" || ! systemctl is-active --quiet "$unit"; then
  rollback || true
  exit 1
fi

reported="$(guanlan-agent version)"
if [[ "$reported" != "$version (test)" ]]; then
  echo "Updated Agent reported '$reported', expected '$version (test)'." >&2
  rollback || true
  exit 1
fi

validate_status() {
  local json="$1"
  python3 -c 'import json,sys; d=json.load(sys.stdin); v=sys.argv[1]; ok=(d.get("serviceInstalled") and d.get("serviceRunning") and d.get("configured") and d.get("daemonReachable") and d.get("collectorRunning") and d.get("connectionStatus")=="connected" and d.get("channel")=="test" and d.get("version")==v); sys.exit(0 if ok else 1)' "$version" <<< "$json"
}

upload_confirmed=false
for _ in $(seq 1 90); do
  current_status="$(guanlan-agent status --json 2>/dev/null || true)"
  current_upload="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("lastUploadAt") or "")' <<< "$current_status" 2>/dev/null || true)"
  if [[ -n "$current_upload" && "$current_upload" != "$last_upload_before" ]] &&
    validate_status "$current_status"; then
    upload_confirmed=true
    break
  fi
  sleep 2
done
if [[ "$upload_confirmed" != true ]]; then
  echo "The updated Agent did not confirm a new upload; restoring the previous package." >&2
  rollback || true
  exit 1
fi

new_package_version="$(dpkg-query -W -f='${Version}' guanlan-desktop)"
[[ "$new_package_version" == "$version" ]] || {
  echo "The installed package version does not match the requested Agent version." >&2
  rollback || true
  exit 1
}
rm -rf "$stage_dir"
printf '%s\n' "$version"
REMOTE

legacy_update_script="$work_dir/update-legacy.sh"
cat > "$legacy_update_script" <<'REMOTE'
set -euo pipefail
version="$1"
stage_dir="$2"
unit="device-state-console-agent.service"
install_dir="/opt/device-state-console-agent"
target="$install_dir/device-state-console-agent"
version_file="$install_dir/VERSION"
staged="$stage_dir/device-state-console-agent"
backup="$target.backup-$version-$$"
version_backup="$version_file.backup-$version-$$"

[[ -f "$staged" && -x "$target" ]] || {
  echo "The staged or installed legacy Agent binary is missing." >&2
  exit 1
}
systemctl is-active --quiet "$unit" && systemctl is-enabled --quiet "$unit" || {
  echo "The legacy Agent service is not active and enabled." >&2
  exit 1
}

owner="$(stat -c '%u:%g' "$target")"
mode="$(stat -c '%a' "$target")"
had_version_file=false
if [[ -f "$version_file" ]]; then
  cp -p "$version_file" "$version_backup"
  had_version_file=true
fi
started_at="$(date --iso-8601=seconds)"

restore() {
  set +e
  systemctl stop "$unit"
  rm -f "$target.new" "$version_file.new"
  rm -f "$target"
  if [[ -f "$backup" ]]; then mv "$backup" "$target"; fi
  if [[ "$had_version_file" == true && -f "$version_backup" ]]; then
    mv "$version_backup" "$version_file"
  else
    rm -f "$version_file"
  fi
  systemctl start "$unit"
  if systemctl is-active --quiet "$unit"; then
    echo "The previous legacy Agent binary was restored." >&2
    return 0
  fi
  echo "Rollback could not restart the previous legacy Agent." >&2
  return 1
}

install -m "$mode" -o "$owner" "$staged" "$target.new"
if [[ "$had_version_file" == true ]]; then
  install -m 0644 -o "$owner" "$version_backup" "$version_file.new"
else
  install -m 0644 -o "$owner" /dev/null "$version_file.new"
fi
printf '%s\n' "$version" > "$version_file.new"
systemctl stop "$unit"
if ! mv "$target" "$backup"; then
  systemctl start "$unit" || true
  exit 1
fi
if ! mv "$target.new" "$target"; then
  rm -f "$target.new" "$version_file.new"
  mv "$backup" "$target"
  systemctl start "$unit" || true
  exit 1
fi
if ! mv "$version_file.new" "$version_file"; then
  rm -f "$version_file.new"
  rm -f "$target"
  mv "$backup" "$target"
  systemctl start "$unit" || true
  exit 1
fi

if ! systemctl start "$unit" || ! systemctl is-active --quiet "$unit"; then
  restore || true
  exit 1
fi
reported="$("$target" version)"
if [[ "$reported" != "$version (test)" ]]; then
  echo "Updated legacy Agent reported '$reported', expected '$version (test)'." >&2
  restore || true
  exit 1
fi

upload_confirmed=false
for _ in $(seq 1 90); do
  if journalctl -u "$unit" --since "$started_at" --no-pager -o cat 2>/dev/null |
    grep -Fq 'uploaded metrics at '; then
    upload_confirmed=true
    break
  fi
  sleep 2
done
if [[ "$upload_confirmed" != true ]]; then
  echo "The updated legacy Agent did not confirm a new upload; restoring the previous binary." >&2
  restore || true
  exit 1
fi

rm -f "$backup" "$version_backup" "$staged"
rm -rf "$stage_dir"
printf '%s\n' "$version"
REMOTE

declare -A layout_by_target
declare -A version_by_target

echo "Preflighting all Agent targets before making any change."
for target in "${target_list[@]}"; do
  result="$(run_target_script "$target" "$preflight_script")"
  IFS='|' read -r layout installed_version <<< "$result"
  case "$layout" in
    modern)
      [[ "$installed_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
        echo "Invalid installed Guanlan package version on $target." >&2
        exit 1
      }
      if ! dpkg --compare-versions "$REQUESTED_VERSION" gt "$installed_version"; then
        echo "Requested version $REQUESTED_VERSION is not newer than $installed_version on $target." >&2
        exit 1
      fi
      layout_by_target["$target"]="$layout"
      version_by_target["$target"]="$installed_version"
      echo "$target: modern client $installed_version is healthy and connected."
      ;;
    legacy)
      layout_by_target["$target"]="$layout"
      version_by_target["$target"]="$installed_version"
      echo "$target: legacy client service is active and enabled."
      ;;
    *)
      echo "Unrecognized Agent layout returned by $target." >&2
      exit 1
      ;;
  esac
done

download_rollback_package() {
  local version="$1"
  local directory="$work_dir/rollback/$version"
  local asset="DeviceStateConsole-Linux-Install-v$version.deb"
  local staged_asset="$artifact_dir/rollback/$asset"
  local staged_checksum="$staged_asset.sha256"
  [[ -f "$staged_asset" && -f "$staged_checksum" ]] || {
    echo "The rollback package for installed version $version was not staged." >&2
    exit 1
  }
  mkdir -p "$directory"
  cp "$staged_asset" "$directory/$asset"
  cp "$staged_checksum" "$directory/$asset.sha256"
  verify_asset_checksum "$directory/$asset" "$directory/$asset.sha256"
  [[ "$(dpkg-deb -f "$directory/$asset" Version)" == "$version" ]] || {
    echo "Rollback asset version does not match $version." >&2
    exit 1
  }
  local extracted="$directory/extracted"
  mkdir -p "$extracted"
  dpkg-deb -x "$directory/$asset" "$extracted"
  local cli
  cli="$(find "$extracted" -type f -path '*/resources/agent/guanlan-agent' -print -quit)"
  [[ -n "$cli" && -x "$cli" ]] || {
    echo "Rollback package has no Guanlan Agent CLI." >&2
    exit 1
  }
  case "$("$cli" version)" in
    "$version (test)"|"$version (stable)") ;;
    *)
      echo "Rollback Agent CLI version does not match its package version." >&2
      exit 1
      ;;
  esac
}

for target in "${target_list[@]}"; do
  if [[ "${layout_by_target[$target]}" == "modern" ]]; then
    previous_version="${version_by_target[$target]}"
    if [[ ! -f "$work_dir/rollback/$previous_version/DeviceStateConsole-Linux-Install-v$previous_version.deb" ]]; then
      download_rollback_package "$previous_version"
    fi
  fi
done

for target in "${target_list[@]}"; do
  layout="${layout_by_target[$target]}"
  stage_name="dsc-agent-$run_id-$RANDOM"
  remote_stage_dir="/tmp/$stage_name"
  echo "Updating $target ($layout client)."

  if is_local_target "$target"; then
    sudo_run install -d -m 0700 "$remote_stage_dir"
    if [[ "$layout" == "legacy" ]]; then
      sudo_run install -m 0755 "$agent_binary" "$remote_stage_dir/device-state-console-agent"
    else
      previous_version="${version_by_target[$target]}"
      old_asset="DeviceStateConsole-Linux-Install-v$previous_version.deb"
      sudo_run install -m 0600 "$package" "$remote_stage_dir/new.deb"
      sudo_run install -m 0600 "$work_dir/rollback/$previous_version/$old_asset" "$remote_stage_dir/rollback.deb"
    fi
  else
    ssh "${ssh_options[@]}" "$remote_user@$target" install -d -m 0700 "$remote_stage_dir"
    if [[ "$layout" == "legacy" ]]; then
      scp "${ssh_options[@]}" "$agent_binary" "$remote_user@$target:$remote_stage_dir/device-state-console-agent"
    else
      previous_version="${version_by_target[$target]}"
      old_asset="DeviceStateConsole-Linux-Install-v$previous_version.deb"
      scp "${ssh_options[@]}" "$package" "$remote_user@$target:$remote_stage_dir/new.deb"
      scp "${ssh_options[@]}" "$work_dir/rollback/$previous_version/$old_asset" "$remote_user@$target:$remote_stage_dir/rollback.deb"
    fi
  fi

  if [[ "$layout" == "legacy" ]]; then
    reported="$(run_target_script "$target" "$legacy_update_script" "$REQUESTED_VERSION" "$remote_stage_dir")"
  else
    reported="$(run_target_script "$target" "$modern_update_script" "$REQUESTED_VERSION" "${version_by_target[$target]}" "$remote_stage_dir")"
  fi
  [[ "$reported" == "$REQUESTED_VERSION" ]] || {
    echo "$target reported unexpected Agent version '$reported'." >&2
    exit 1
  }
  echo "$target: Agent $reported (test), new upload confirmed."
done

echo "All requested Linux Agents are updated and verified."
