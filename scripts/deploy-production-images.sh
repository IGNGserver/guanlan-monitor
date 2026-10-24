#!/usr/bin/env bash
set -Eeuo pipefail

mode="${1:-}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
: "${IMAGE_STAGE_DIR:?IMAGE_STAGE_DIR is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${DSC_VERSION:?DSC_VERSION is required}"
: "${DSC_RELEASE_CHANNEL:?DSC_RELEASE_CHANNEL is required}"
: "${DSC_ALLOW_HTTP:?DSC_ALLOW_HTTP is required}"
: "${PREVIOUS_VERSION:?PREVIOUS_VERSION is required}"
: "${PREVIOUS_CHANNEL:?PREVIOUS_CHANNEL is required}"
: "${ROLLBACK_COMPOSE_FILE:?ROLLBACK_COMPOSE_FILE is required}"
: "${EXPECTED_ARCHIVE_SHA256:?EXPECTED_ARCHIVE_SHA256 is required}"
: "${EXPECTED_PART_COUNT:?EXPECTED_PART_COUNT is required}"
: "${EXPECTED_SERVER_IMAGE_ID:?EXPECTED_SERVER_IMAGE_ID is required}"
: "${EXPECTED_WEB_IMAGE_ID:?EXPECTED_WEB_IMAGE_ID is required}"
: "${SERVER_IMAGE_REF:?SERVER_IMAGE_REF is required}"
: "${WEB_IMAGE_REF:?WEB_IMAGE_REF is required}"

server_tag="ghcr.io/igngserver/device-state-console-server:${DSC_VERSION}"
web_tag="ghcr.io/igngserver/device-state-console-web:${DSC_VERSION}"
state_file="$IMAGE_STAGE_DIR/deployment-state"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

validate_inputs() {
  [[ "$DEPLOY_PATH" == /* ]] || die "DEPLOY_PATH must be absolute."
  [[ "$DEPLOY_PATH" != / && "$DEPLOY_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "DEPLOY_PATH must be an absolute, shell-safe non-root path."
  case "$DEPLOY_PATH" in
    */../*|*/./*|*/..|*/.) die "DEPLOY_PATH must not contain dot segments." ;;
  esac
  [[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]] || die "GITHUB_RUN_ID must be numeric."
  [[ "$IMAGE_STAGE_DIR" == "$DEPLOY_PATH/.deploy-staging-$GITHUB_RUN_ID" ]] || die "Unexpected production staging directory."
  [[ ! -L "$IMAGE_STAGE_DIR" ]] || die "Production staging path must not be a symbolic link."
  [[ "$DSC_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "DSC_VERSION must be semantic versioning."
  [[ "$DSC_RELEASE_CHANNEL" == stable || "$DSC_RELEASE_CHANNEL" == test ]] || die "Invalid release channel."
  [[ "$DSC_ALLOW_HTTP" == true || "$DSC_ALLOW_HTTP" == false ]] || die "DSC_ALLOW_HTTP must be true or false."
  [[ "$PREVIOUS_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Invalid previous production version."
  [[ "$PREVIOUS_CHANNEL" == stable || "$PREVIOUS_CHANNEL" == test ]] || die "Invalid previous production channel."
  [[ "$ROLLBACK_COMPOSE_FILE" == "$IMAGE_STAGE_DIR/rollback-compose.yml" ]] || die "Unexpected rollback Compose definition path."
  [[ "$EXPECTED_ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]] || die "Invalid image archive checksum."
  [[ "$EXPECTED_PART_COUNT" =~ ^[1-9][0-9]*$ ]] || die "Invalid image archive part count."
  [[ "$EXPECTED_SERVER_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || die "Invalid server image ID."
  [[ "$EXPECTED_WEB_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || die "Invalid web image ID."
  [[ "$SERVER_IMAGE_REF" =~ ^ghcr\.io/igngserver/device-state-console-server@sha256:[0-9a-f]{64}$ ]] || die "Invalid immutable server image reference."
  [[ "$WEB_IMAGE_REF" =~ ^ghcr\.io/igngserver/device-state-console-web@sha256:[0-9a-f]{64}$ ]] || die "Invalid immutable web image reference."
}

image_id() {
  docker image inspect --format '{{.Id}}' "$1"
}

read_state() {
  local -a fields=()
  local field
  [[ -s "$state_file" ]] || return 1
  while IFS= read -r field || [[ -n "$field" ]]; do
    fields+=("$field")
  done < "$state_file"
  [[ ${#fields[@]} -eq 11 ]] || die "Invalid production deployment state file."
  STATE_STATUS="${fields[0]}"
  STATE_CONFIG_CHANGED="${fields[1]}"
  STATE_DEPLOYMENT_STARTED="${fields[2]}"
  STATE_COMPOSE_BACKUP="${fields[3]}"
  STATE_ENV_BACKUP="${fields[4]}"
  STATE_PREVIOUS_SERVER_REF="${fields[5]}"
  STATE_PREVIOUS_WEB_REF="${fields[6]}"
  STATE_PREVIOUS_SERVER_ID="${fields[7]}"
  STATE_PREVIOUS_WEB_ID="${fields[8]}"
  STATE_PREVIOUS_VERSION="${fields[9]}"
  STATE_PREVIOUS_CHANNEL="${fields[10]}"
  [[ "$STATE_CONFIG_CHANGED" == 0 || "$STATE_CONFIG_CHANGED" == 1 ]] || die "Invalid config state marker."
  [[ "$STATE_DEPLOYMENT_STARTED" == 0 || "$STATE_DEPLOYMENT_STARTED" == 1 ]] || die "Invalid deployment state marker."
  [[ "$STATE_COMPOSE_BACKUP" =~ ^docker-compose\.yml\.production-[0-9]+$ ]] || die "Invalid Compose backup name."
  [[ "$STATE_ENV_BACKUP" =~ ^\.env\.production-[0-9]+$ ]] || die "Invalid environment backup name."
  [[ -z "$STATE_PREVIOUS_VERSION" || "$STATE_PREVIOUS_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Invalid previous deployment version."
  [[ -z "$STATE_PREVIOUS_CHANNEL" || "$STATE_PREVIOUS_CHANNEL" == stable || "$STATE_PREVIOUS_CHANNEL" == test ]] || die "Invalid previous deployment channel."
}

write_state() {
  local next_status="$1"
  local config_changed="$2"
  local deployment_started="$3"
  local temporary="$state_file.tmp"
  umask 077
  printf '%s\n' \
    "$next_status" \
    "$config_changed" \
    "$deployment_started" \
    "$STATE_COMPOSE_BACKUP" \
    "$STATE_ENV_BACKUP" \
    "$STATE_PREVIOUS_SERVER_REF" \
    "$STATE_PREVIOUS_WEB_REF" \
    "$STATE_PREVIOUS_SERVER_ID" \
    "$STATE_PREVIOUS_WEB_ID" \
    "$STATE_PREVIOUS_VERSION" \
    "$STATE_PREVIOUS_CHANNEL" > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$state_file"
  STATE_STATUS="$next_status"
  STATE_CONFIG_CHANGED="$config_changed"
  STATE_DEPLOYMENT_STARTED="$deployment_started"
}

restore_config() {
  if [[ "$STATE_CONFIG_CHANGED" == 1 ]]; then
    local env_backup="$DEPLOY_PATH/backups/$STATE_ENV_BACKUP"
    local compose_backup="$DEPLOY_PATH/backups/$STATE_COMPOSE_BACKUP"
    [[ -s "$env_backup" && -s "$compose_backup" ]] || die "Production config backup is missing; refusing to continue rollback."
    cp -p "$env_backup" "$DEPLOY_PATH/.env.restore-$GITHUB_RUN_ID.tmp"
    mv "$DEPLOY_PATH/.env.restore-$GITHUB_RUN_ID.tmp" "$DEPLOY_PATH/.env"
    cp -p "$compose_backup" "$DEPLOY_PATH/.docker-compose.restore-$GITHUB_RUN_ID.tmp"
    mv "$DEPLOY_PATH/.docker-compose.restore-$GITHUB_RUN_ID.tmp" "$DEPLOY_PATH/docker-compose.yml"
    if [[ -n "$STATE_PREVIOUS_VERSION" && -n "$STATE_PREVIOUS_CHANNEL" ]]; then
      DSC_ENV_KEY=DSC_VERSION DSC_ENV_VALUE="$STATE_PREVIOUS_VERSION" awk '
        BEGIN { key = ENVIRON["DSC_ENV_KEY"]; value = ENVIRON["DSC_ENV_VALUE"]; found = 0 }
        index($0, key "=") == 1 { if (!found) print key "=" value; found = 1; next }
        { print }
        END { if (!found) print key "=" value }
      ' "$DEPLOY_PATH/.env" > "$DEPLOY_PATH/.env.restore-version-$GITHUB_RUN_ID.tmp"
      DSC_ENV_KEY=DSC_RELEASE_CHANNEL DSC_ENV_VALUE="$STATE_PREVIOUS_CHANNEL" awk '
        BEGIN { key = ENVIRON["DSC_ENV_KEY"]; value = ENVIRON["DSC_ENV_VALUE"]; found = 0 }
        index($0, key "=") == 1 { if (!found) print key "=" value; found = 1; next }
        { print }
        END { if (!found) print key "=" value }
      ' "$DEPLOY_PATH/.env.restore-version-$GITHUB_RUN_ID.tmp" > "$DEPLOY_PATH/.env.restore-channel-$GITHUB_RUN_ID.tmp"
      mv "$DEPLOY_PATH/.env.restore-channel-$GITHUB_RUN_ID.tmp" "$DEPLOY_PATH/.env"
      rm -f "$DEPLOY_PATH/.env.restore-version-$GITHUB_RUN_ID.tmp"
    fi
  fi
}

rollback_deployment() {
  local -a rollback_env=()
  read_state || return 0
  if [[ "$STATE_STATUS" == complete || "$STATE_STATUS" == rolled-back ]]; then
    return 0
  fi

  restore_config
  if [[ "$STATE_DEPLOYMENT_STARTED" == 1 && -n "$STATE_PREVIOUS_SERVER_REF" && -n "$STATE_PREVIOUS_WEB_REF" ]]; then
    unset DSC_VERSION DSC_RELEASE_CHANNEL DSC_SERVER_IMAGE DSC_WEB_IMAGE DSC_SERVER_IMAGE_REF DSC_WEB_IMAGE_REF
    unset DSC_REDIS_IMAGE_REF DSC_MYSQL_IMAGE_REF MYSQL_URL
    [[ -z "$STATE_PREVIOUS_VERSION" ]] || rollback_env+=("DSC_VERSION=$STATE_PREVIOUS_VERSION")
    [[ -z "$STATE_PREVIOUS_CHANNEL" ]] || rollback_env+=("DSC_RELEASE_CHANNEL=$STATE_PREVIOUS_CHANNEL")
    if ! env "${rollback_env[@]}" \
      DSC_SERVER_IMAGE_REF="$STATE_PREVIOUS_SERVER_REF" \
      DSC_WEB_IMAGE_REF="$STATE_PREVIOUS_WEB_REF" \
      WEB_PORT="${WEB_PORT:-38472}" \
      docker compose -f "$DEPLOY_PATH/docker-compose.yml" -p device-state-console \
        up -d --no-build --pull never --no-deps server web; then
      printf '%s\n' "Rollback could not restart the previous production containers." >&2
      write_state rollback-failed "$STATE_CONFIG_CHANGED" "$STATE_DEPLOYMENT_STARTED"
      return 1
    fi
    if [[ -n "$STATE_PREVIOUS_SERVER_ID" && -n "$STATE_PREVIOUS_WEB_ID" ]]; then
      local server_container web_container actual_server_id actual_web_id
      server_container="$(docker ps -q --filter name=device-state-console-server-1 | head -n 1)"
      web_container="$(docker ps -q --filter name=device-state-console-web-1 | head -n 1)"
      actual_server_id="$(docker inspect --format '{{.Image}}' "$server_container")"
      actual_web_id="$(docker inspect --format '{{.Image}}' "$web_container")"
      if [[ "$actual_server_id" != "$STATE_PREVIOUS_SERVER_ID" || "$actual_web_id" != "$STATE_PREVIOUS_WEB_ID" ]]; then
        printf '%s\n' "Rollback image ID did not match the previously running production containers." >&2
        write_state rollback-failed "$STATE_CONFIG_CHANGED" "$STATE_DEPLOYMENT_STARTED"
        return 1
      fi
    fi
  fi
  write_state rolled-back "$STATE_CONFIG_CHANGED" "$STATE_DEPLOYMENT_STARTED"
  if [[ "$STATE_DEPLOYMENT_STARTED" == 1 ]]; then
    printf '%s\n' "Previous production configuration and containers were restored."
  else
    printf '%s\n' "Previous production configuration was restored; application containers were not changed."
  fi
}

load_images() {
  local actual_sha
  [[ "$EXPECTED_PART_COUNT" == 1 ]] || die "Production image archive manifest must describe exactly one archive."
  [[ -s "$IMAGE_STAGE_DIR/dsc-production-images.tar.gz" ]] || die "Production image archive is missing."
  actual_sha="$(sha256sum "$IMAGE_STAGE_DIR/dsc-production-images.tar.gz" | awk '{print $1}')"
  [[ "$actual_sha" == "$EXPECTED_ARCHIVE_SHA256" ]] || die "Production image archive checksum mismatch."
  gzip -t "$IMAGE_STAGE_DIR/dsc-production-images.tar.gz"
  gzip -dc "$IMAGE_STAGE_DIR/dsc-production-images.tar.gz" | docker load

  [[ "$(image_id "$server_tag")" == "$EXPECTED_SERVER_IMAGE_ID" ]] || die "Loaded server image ID does not match the digest-pinned source."
  [[ "$(image_id "$web_tag")" == "$EXPECTED_WEB_IMAGE_ID" ]] || die "Loaded web image ID does not match the digest-pinned source."
  rm -f -- "$IMAGE_STAGE_DIR/dsc-production-images.tar.gz"
  printf 'Loaded and verified digest-pinned production images for v%s.\n' "$DSC_VERSION"
}

sync_definition() {
  local backup_stamp compose_backup_path env_backup_path preflight_output server_container web_container server_env_value
  [[ -d "$DEPLOY_PATH" ]] || die "Production deployment path does not exist."
  [[ -s "$DEPLOY_PATH/.env" && -s "$DEPLOY_PATH/docker-compose.yml" ]] || die "Existing production .env and Compose files are required for rollback."
  [[ ! -L "$IMAGE_STAGE_DIR" ]] || die "Production staging path must not be a symbolic link."
  mkdir -m 700 -p "$IMAGE_STAGE_DIR"
  chmod 700 "$IMAGE_STAGE_DIR"
  [[ -s "$IMAGE_STAGE_DIR/docker-compose.yml" ]] || die "Pinned Compose definition was not staged."
  [[ -s "$IMAGE_STAGE_DIR/prepare-compose-env.sh" ]] || die "Pinned Compose environment preflight was not staged."
  bash -n "$IMAGE_STAGE_DIR/prepare-compose-env.sh"
  grep -Fq './data:/app/data' "$IMAGE_STAGE_DIR/docker-compose.yml"

  mkdir -p "$DEPLOY_PATH/data" "$DEPLOY_PATH/backups"
  backup_stamp="$GITHUB_RUN_ID"
  STATE_COMPOSE_BACKUP="docker-compose.yml.production-$backup_stamp"
  STATE_ENV_BACKUP=".env.production-$backup_stamp"
  compose_backup_path="$DEPLOY_PATH/backups/$STATE_COMPOSE_BACKUP"
  env_backup_path="$DEPLOY_PATH/backups/$STATE_ENV_BACKUP"

  server_container="$(docker ps -aq --filter name=device-state-console-server-1 | head -n 1 || true)"
  web_container="$(docker ps -aq --filter name=device-state-console-web-1 | head -n 1 || true)"
  STATE_PREVIOUS_SERVER_REF=""
  STATE_PREVIOUS_WEB_REF=""
  STATE_PREVIOUS_SERVER_ID=""
  STATE_PREVIOUS_WEB_ID=""
  STATE_PREVIOUS_VERSION=""
  STATE_PREVIOUS_CHANNEL=""
  if [[ -n "$server_container" ]]; then
    STATE_PREVIOUS_SERVER_REF="$(docker inspect --format '{{.Config.Image}}' "$server_container")"
    STATE_PREVIOUS_SERVER_ID="$(docker inspect --format '{{.Image}}' "$server_container")"
    server_env_value="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$server_container")"
    STATE_PREVIOUS_VERSION="$(awk -F= '$1 == "DSC_VERSION" { print substr($0, index($0, "=") + 1); exit }' <<< "$server_env_value")"
    STATE_PREVIOUS_CHANNEL="$(awk -F= '$1 == "DSC_RELEASE_CHANNEL" { print substr($0, index($0, "=") + 1); exit }' <<< "$server_env_value")"
  fi
  if [[ -n "$web_container" ]]; then
    STATE_PREVIOUS_WEB_REF="$(docker inspect --format '{{.Config.Image}}' "$web_container")"
    STATE_PREVIOUS_WEB_ID="$(docker inspect --format '{{.Image}}' "$web_container")"
  fi

  if [[ -n "$STATE_PREVIOUS_VERSION" && ! "$STATE_PREVIOUS_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    STATE_PREVIOUS_VERSION=""
  fi
  if [[ "$STATE_PREVIOUS_CHANNEL" != stable && "$STATE_PREVIOUS_CHANNEL" != test ]]; then
    STATE_PREVIOUS_CHANNEL=""
  fi
  [[ -n "$server_container" && -n "$web_container" ]] || die "Both existing production application containers are required for rollback."
  [[ -n "$STATE_PREVIOUS_SERVER_REF" && -n "$STATE_PREVIOUS_WEB_REF" \
    && -n "$STATE_PREVIOUS_SERVER_ID" && -n "$STATE_PREVIOUS_WEB_ID" ]] || die "Could not capture the current production image references and IDs."
  [[ -n "$STATE_PREVIOUS_VERSION" && -n "$STATE_PREVIOUS_CHANNEL" ]] || die "Could not capture the current production version and channel for rollback."
  [[ "$STATE_PREVIOUS_VERSION" == "$PREVIOUS_VERSION" && "$STATE_PREVIOUS_CHANNEL" == "$PREVIOUS_CHANNEL" ]] || die "Production version changed after the rollback definition was resolved."

  [[ -s "$ROLLBACK_COMPOSE_FILE" ]] || die "Pinned rollback Compose definition is missing."
  grep -Fq './data:/app/data' "$ROLLBACK_COMPOSE_FILE"
  cp -p "$ROLLBACK_COMPOSE_FILE" "$compose_backup_path"
  cp -p "$DEPLOY_PATH/.env" "$env_backup_path"

  server_container="$(docker ps -aq --filter name=device-state-console-server-1 | head -n 1 || true)"
  if [[ -n "$server_container" ]]; then
    docker cp "$server_container:/app/data/local-db.json" "$DEPLOY_PATH/backups/local-db.json.$backup_stamp" 2>/dev/null || true
  fi
  if [[ ! -s "$DEPLOY_PATH/data/local-db.json" && -s "$DEPLOY_PATH/backups/local-db.json.$backup_stamp" ]]; then
    cp "$DEPLOY_PATH/backups/local-db.json.$backup_stamp" "$DEPLOY_PATH/data/local-db.json.tmp"
    mv "$DEPLOY_PATH/data/local-db.json.tmp" "$DEPLOY_PATH/data/local-db.json"
  fi
  write_state prepared 1 0

  preflight_output="$(DSC_RECOVER_EXISTING_MYSQL=true \
    DSC_MYSQL_CONTAINER=device-state-console-mysql-1 \
    DSC_ALLOW_HTTP="$DSC_ALLOW_HTTP" \
    DSC_RELEASE_CHANNEL="$DSC_RELEASE_CHANNEL" \
    DSC_VERSION="$DSC_VERSION" \
    bash "$IMAGE_STAGE_DIR/prepare-compose-env.sh" "$DEPLOY_PATH/.env")"
  grep -Fq 'Compose environment preflight: PASS' <<< "$preflight_output" || die "Compose environment preflight did not pass."

  if [[ -n "$STATE_PREVIOUS_VERSION" && -n "$STATE_PREVIOUS_CHANNEL" ]]; then
    DSC_ENV_KEY=DSC_VERSION DSC_ENV_VALUE="$STATE_PREVIOUS_VERSION" awk '
      BEGIN { key = ENVIRON["DSC_ENV_KEY"]; value = ENVIRON["DSC_ENV_VALUE"]; found = 0 }
      index($0, key "=") == 1 { if (!found) print key "=" value; found = 1; next }
      { print }
      END { if (!found) print key "=" value }
    ' "$env_backup_path" > "$DEPLOY_PATH/.env.previous-version-$GITHUB_RUN_ID.tmp"
    DSC_ENV_KEY=DSC_RELEASE_CHANNEL DSC_ENV_VALUE="$STATE_PREVIOUS_CHANNEL" awk '
      BEGIN { key = ENVIRON["DSC_ENV_KEY"]; value = ENVIRON["DSC_ENV_VALUE"]; found = 0 }
      index($0, key "=") == 1 { if (!found) print key "=" value; found = 1; next }
      { print }
      END { if (!found) print key "=" value }
    ' "$DEPLOY_PATH/.env.previous-version-$GITHUB_RUN_ID.tmp" > "$env_backup_path"
    rm -f "$DEPLOY_PATH/.env.previous-version-$GITHUB_RUN_ID.tmp"
  fi

  cp -p "$IMAGE_STAGE_DIR/docker-compose.yml" "$DEPLOY_PATH/.docker-compose.production-$GITHUB_RUN_ID.tmp"
  mv "$DEPLOY_PATH/.docker-compose.production-$GITHUB_RUN_ID.tmp" "$DEPLOY_PATH/docker-compose.yml"
  printf 'Prepared fixed-version Compose configuration for v%s; rollback backups are retained under DEPLOY_PATH/backups.\n' "$DSC_VERSION"
}

deploy_images() {
  local server_container web_container actual_server_id actual_web_id actual_server_ref actual_web_ref
  local infra_healthy healthy attempt legacy_mysql_url

  read_state || die "Production configuration was not prepared."
  [[ "$STATE_STATUS" == prepared ]] || die "Production configuration is not ready for deployment."
  [[ "$(image_id "$server_tag")" == "$EXPECTED_SERVER_IMAGE_ID" ]] || die "Staged server image is missing or changed."
  [[ "$(image_id "$web_tag")" == "$EXPECTED_WEB_IMAGE_ID" ]] || die "Staged web image is missing or changed."

  export WEB_PORT=38472
  export DSC_VERSION DSC_RELEASE_CHANNEL
  export DSC_SERVER_IMAGE_REF="$server_tag"
  export DSC_WEB_IMAGE_REF="$web_tag"
  export DSC_SERVER_IMAGE='ghcr.io/igngserver/device-state-console-server'
  export DSC_WEB_IMAGE='ghcr.io/igngserver/device-state-console-web'

  legacy_mysql_url="$(sed -n 's/^MYSQL_URL=//p' "$DEPLOY_PATH/.env" | head -n 1 | tr -d '\r')"
  if [[ -n "$legacy_mysql_url" ]]; then
    legacy_mysql_url="${legacy_mysql_url/@127.0.0.1:/@mysql:}"
    legacy_mysql_url="${legacy_mysql_url/@localhost:/@mysql:}"
    export MYSQL_URL="$legacy_mysql_url"
  fi

  write_state started "$STATE_CONFIG_CHANGED" 1
  if ! timeout 180 docker compose -f "$DEPLOY_PATH/docker-compose.yml" -p device-state-console \
    up -d --no-build --pull never redis mysql; then
    die "Redis/MySQL did not start using the existing pinned local images."
  fi

  infra_healthy=0
  for attempt in $(seq 1 30); do
    if docker compose -f "$DEPLOY_PATH/docker-compose.yml" -p device-state-console exec -T redis \
      sh -c 'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" ping | grep -q PONG' \
      && docker compose -f "$DEPLOY_PATH/docker-compose.yml" -p device-state-console exec -T mysql \
        sh -c 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent'; then
      infra_healthy=1
      break
    fi
    sleep 5
  done
  [[ "$infra_healthy" -eq 1 ]] || die "Redis/MySQL readiness check failed."

  if ! timeout 180 docker compose -f "$DEPLOY_PATH/docker-compose.yml" -p device-state-console \
    up -d --no-build --pull never --no-deps server web; then
    die "Fixed-version application restart failed."
  fi

  server_container="$(docker compose -f "$DEPLOY_PATH/docker-compose.yml" -p device-state-console ps -q server)"
  web_container="$(docker compose -f "$DEPLOY_PATH/docker-compose.yml" -p device-state-console ps -q web)"
  actual_server_ref="$(docker inspect --format '{{.Config.Image}}' "$server_container")"
  actual_web_ref="$(docker inspect --format '{{.Config.Image}}' "$web_container")"
  actual_server_id="$(docker inspect --format '{{.Image}}' "$server_container")"
  actual_web_id="$(docker inspect --format '{{.Image}}' "$web_container")"
  if [[ "$actual_server_ref" != "$server_tag" || "$actual_web_ref" != "$web_tag" \
    || "$actual_server_id" != "$EXPECTED_SERVER_IMAGE_ID" || "$actual_web_id" != "$EXPECTED_WEB_IMAGE_ID" ]]; then
    die "Running container image reference or image ID does not match the staged release."
  fi

  healthy=0
  for attempt in $(seq 1 30); do
    if docker compose -f "$DEPLOY_PATH/docker-compose.yml" -p device-state-console exec -T server \
      node -e "fetch('http://127.0.0.1:4000/api/health/readiness').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))" \
      && curl --fail --silent --show-error --max-time 5 --output /dev/null http://127.0.0.1:38472/; then
      healthy=1
      break
    fi
    sleep 5
  done
  [[ "$healthy" -eq 1 ]] || die "Production readiness check failed."

  write_state complete "$STATE_CONFIG_CHANGED" 1
  printf 'Production deployment completed: version=%s channel=%s\n' "$DSC_VERSION" "$DSC_RELEASE_CHANNEL"
  printf 'Server image=%s digest-ref=%s image-id=%s\n' "$actual_server_ref" "$SERVER_IMAGE_REF" "$actual_server_id"
  printf 'Web image=%s digest-ref=%s image-id=%s\n' "$actual_web_ref" "$WEB_IMAGE_REF" "$actual_web_id"
  docker compose -f "$DEPLOY_PATH/docker-compose.yml" -p device-state-console ps
}

cleanup_stage() {
  if read_state; then
    if [[ "$STATE_STATUS" != complete && "$STATE_STATUS" != rolled-back ]]; then
      rollback_deployment || return 1
    fi
  fi
  rm -rf -- "$IMAGE_STAGE_DIR"
  printf '%s\n' "Production deployment staging files cleaned."
}

validate_inputs
case "$mode" in
  load)
    load_images
    ;;
  sync)
    sync_definition
    ;;
  deploy)
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap 'code=$?; trap - EXIT; if [[ $code -ne 0 ]]; then rollback_deployment || true; fi; exit "$code"' EXIT
    deploy_images
    ;;
  cleanup)
    cleanup_stage
    ;;
  *)
    die "Usage: $0 {load|sync|deploy|cleanup}"
    ;;
esac
