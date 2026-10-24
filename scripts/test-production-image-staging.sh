#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

deploy_path="$test_root/production"
run_id=123456
stage_dir="$deploy_path/.deploy-staging-$run_id"
mock_bin="$test_root/mock-bin"
mkdir -p "$stage_dir" "$mock_bin"

server_image_id="sha256:$(printf 'a%.0s' {1..64})"
web_image_id="sha256:$(printf 'b%.0s' {1..64})"
cat > "$mock_bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  load)
    cat >/dev/null
    printf '%s\n' load >> "$DOCKER_TEST_LOG"
    ;;
  image)
    [[ "${2:-}" == inspect ]] || exit 2
    image_ref="${@: -1}"
    case "$image_ref" in
      ghcr.io/igngserver/device-state-console-server:3.0.167)
        printf '%s\n' "$SERVER_IMAGE_TEST_ID"
        ;;
      ghcr.io/igngserver/device-state-console-web:3.0.167)
        printf '%s\n' "$WEB_IMAGE_TEST_ID"
        ;;
      *) exit 3 ;;
    esac
    ;;
  *) exit 4 ;;
esac
MOCK
chmod +x "$mock_bin/docker"

printf 'test image archive\n' | gzip -1 > "$stage_dir/dsc-production-images.tar.gz"
archive_sha256="$(sha256sum "$stage_dir/dsc-production-images.tar.gz" | awk '{print $1}')"
export PATH="$mock_bin:$PATH"
export DOCKER_TEST_LOG="$test_root/docker.log"
export SERVER_IMAGE_TEST_ID="$server_image_id"
export WEB_IMAGE_TEST_ID="$web_image_id"

helper_env=(
  "DEPLOY_PATH=$deploy_path"
  "IMAGE_STAGE_DIR=$stage_dir"
  "GITHUB_RUN_ID=$run_id"
  "DSC_VERSION=3.0.167"
  "DSC_RELEASE_CHANNEL=stable"
  "DSC_ALLOW_HTTP=true"
  "PREVIOUS_VERSION=3.0.166"
  "PREVIOUS_CHANNEL=stable"
  "ROLLBACK_COMPOSE_FILE=$stage_dir/rollback-compose.yml"
  "EXPECTED_ARCHIVE_SHA256=$archive_sha256"
  "EXPECTED_PART_COUNT=1"
  "EXPECTED_SERVER_IMAGE_ID=$server_image_id"
  "EXPECTED_WEB_IMAGE_ID=$web_image_id"
  "SERVER_IMAGE_REF=ghcr.io/igngserver/device-state-console-server@sha256:$(printf 'c%.0s' {1..64})"
  "WEB_IMAGE_REF=ghcr.io/igngserver/device-state-console-web@sha256:$(printf 'd%.0s' {1..64})"
)

env "${helper_env[@]}" bash "$root/scripts/deploy-production-images.sh" load
[[ ! -e "$stage_dir/dsc-production-images.tar.gz" ]]
[[ "$(grep -c '^load$' "$DOCKER_TEST_LOG")" == 1 ]]

printf 'test image archive\n' | gzip -1 > "$stage_dir/dsc-production-images.tar.gz"
if env "${helper_env[@]/EXPECTED_ARCHIVE_SHA256=$archive_sha256/EXPECTED_ARCHIVE_SHA256=$(printf 'e%.0s' {1..64})}" \
  bash "$root/scripts/deploy-production-images.sh" load >/dev/null 2>&1; then
  echo "A mismatched production image archive checksum unexpectedly passed." >&2
  exit 1
fi
[[ -s "$stage_dir/dsc-production-images.tar.gz" ]]
[[ "$(grep -c '^load$' "$DOCKER_TEST_LOG")" == 1 ]]

sync_path="$test_root/production-sync"
sync_stage="$sync_path/.deploy-staging-234567"
mkdir -p "$sync_path/backups" "$sync_path/data" "$sync_stage"
cat > "$sync_path/.env" <<'ENV'
SESSION_SECRET=existing-session-secret
ACCESS_KEY=existing-access-key
MYSQL_ROOT_PASSWORD=existing-mysql-root-password
MYSQL_DATABASE=device_state_console
MYSQL_USER=dsc
MYSQL_PASSWORD=existing-mysql-password
DSC_VERSION=3.0.167
DSC_RELEASE_CHANNEL=stable
ENV
printf 'old compose definition\n' > "$sync_path/docker-compose.yml"
printf './data:/app/data\n' > "$sync_stage/docker-compose.yml"
printf 'pinned previous release compose\n./data:/app/data\n' > "$sync_stage/rollback-compose.yml"
cat > "$sync_stage/prepare-compose-env.sh" <<'PREPARE'
#!/usr/bin/env bash
set -euo pipefail
printf 'DSC_VERSION=%s\nDSC_RELEASE_CHANNEL=%s\n' "$DSC_VERSION" "$DSC_RELEASE_CHANNEL" >> "$1"
echo 'Compose environment preflight: PASS'
PREPARE
chmod +x "$sync_stage/prepare-compose-env.sh"
cat > "$mock_bin/docker" <<'MOCK_SYNC'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  ps)
    if [[ "$*" == *server-1* ]]; then printf '%s\n' server-container; else printf '%s\n' web-container; fi
    ;;
  inspect)
    format="${3:-}"
    container="${4:-}"
    case "$format:$container" in
      '{{.Config.Image}}:server-container') printf '%s\n' ghcr.io/igngserver/device-state-console-server:3.0.166 ;;
      '{{.Config.Image}}:web-container') printf '%s\n' ghcr.io/igngserver/device-state-console-web:3.0.166 ;;
      '{{.Image}}:server-container') printf '%s\n' "$SERVER_IMAGE_TEST_ID" ;;
      '{{.Image}}:web-container') printf '%s\n' "$WEB_IMAGE_TEST_ID" ;;
      '{{range .Config.Env}}{{println .}}{{end}}:server-container') printf 'DSC_VERSION=3.0.166\nDSC_RELEASE_CHANNEL=stable\n' ;;
      *) exit 3 ;;
    esac
    ;;
  cp) exit 1 ;;
  *) exit 4 ;;
esac
MOCK_SYNC
chmod +x "$mock_bin/docker"

sync_env=(
  "DEPLOY_PATH=$sync_path"
  "IMAGE_STAGE_DIR=$sync_stage"
  "GITHUB_RUN_ID=234567"
  "DSC_VERSION=3.0.167"
  "DSC_RELEASE_CHANNEL=stable"
  "DSC_ALLOW_HTTP=true"
  "PREVIOUS_VERSION=3.0.166"
  "PREVIOUS_CHANNEL=stable"
  "ROLLBACK_COMPOSE_FILE=$sync_stage/rollback-compose.yml"
  "EXPECTED_ARCHIVE_SHA256=$(printf 'f%.0s' {1..64})"
  "EXPECTED_PART_COUNT=1"
  "EXPECTED_SERVER_IMAGE_ID=$server_image_id"
  "EXPECTED_WEB_IMAGE_ID=$web_image_id"
  "SERVER_IMAGE_REF=ghcr.io/igngserver/device-state-console-server@sha256:$(printf 'c%.0s' {1..64})"
  "WEB_IMAGE_REF=ghcr.io/igngserver/device-state-console-web@sha256:$(printf 'd%.0s' {1..64})"
)
env "${sync_env[@]}" bash "$root/scripts/deploy-production-images.sh" sync
grep -Fxq 'DSC_VERSION=3.0.167' "$sync_path/.env"
grep -Fxq 'DSC_VERSION=3.0.166' "$sync_path/backups/.env.production-234567"
grep -Fxq './data:/app/data' "$sync_path/docker-compose.yml"
env "${sync_env[@]}" bash "$root/scripts/deploy-production-images.sh" cleanup
grep -Fxq 'DSC_VERSION=3.0.166' "$sync_path/.env"
grep -Fxq 'pinned previous release compose' "$sync_path/docker-compose.yml"
[[ ! -e "$sync_stage" ]]

mv "$stage_dir" "$deploy_path/stage-target"
ln -s "$deploy_path/stage-target" "$stage_dir"
if env "${helper_env[@]}" bash "$root/scripts/deploy-production-images.sh" load >/dev/null 2>&1; then
  echo "A symbolic-link production staging path unexpectedly passed validation." >&2
  exit 1
fi
[[ -L "$stage_dir" ]]

echo "Production image archive integrity and staging-path checks: PASS"
