#!/usr/bin/env bash
set -euo pipefail

: "${SMOKE_BASE_URL:=http://127.0.0.1:3100}"
: "${SMOKE_COMPOSE_DIR:?SMOKE_COMPOSE_DIR is required}"
: "${SMOKE_SCOPE:?SMOKE_SCOPE is required}"
: "${DSC_VERSION:?DSC_VERSION is required}"
: "${DSC_RELEASE_CHANNEL:=test}"
: "${WEB_PORT:=3100}"
: "${DSC_SERVER_IMAGE:=ghcr.io/igngserver/device-state-console-server}"
: "${DSC_WEB_IMAGE:=ghcr.io/igngserver/device-state-console-web}"

cd "$SMOKE_COMPOSE_DIR"
export WEB_PORT DSC_VERSION DSC_RELEASE_CHANNEL DSC_SERVER_IMAGE DSC_WEB_IMAGE

if [[ -f .env ]]; then
  legacy_mysql_url="$(sed -n 's/^MYSQL_URL=//p' .env | head -n 1 | tr -d '\r')"
  if [[ -n "$legacy_mysql_url" ]]; then
    legacy_mysql_url="${legacy_mysql_url/@127.0.0.1:/@mysql:}"
    legacy_mysql_url="${legacy_mysql_url/@localhost:/@mysql:}"
    export MYSQL_URL="$legacy_mysql_url"
  fi
fi

access_key="$(docker compose exec -T server node -p 'process.env.ACCESS_KEY' | tr -d '\r\n')"
test -n "$access_key"
headers_file="$(mktemp)"
session_cookie=""
seeded=0

cleanup() {
  if [[ "$seeded" -eq 1 && -n "$session_cookie" ]]; then
    local delete_payload
    delete_payload="$(jq -cn \
      --arg scope "$SMOKE_SCOPE" \
      --arg template 'device-type:device:panel-index' \
      --arg linked_scope "device:__codex-smoke__:panel" \
      --arg linked_template 'device-type:device:panel' \
      '{scopeKey:$scope, templateKey:$template, instanceLayout:null, linkedInstance:{scopeKey:$linked_scope,templateKey:$linked_template,instanceLayout:null}}')"
    curl -fsS -H "Cookie: $session_cookie" -H 'Content-Type: application/json' \
      -X PUT --data-raw "$delete_payload" "$SMOKE_BASE_URL/api/widget-layouts" >/dev/null || true
  fi
  rm -f "$headers_file"
}
trap cleanup EXIT

login_payload="$(jq -cn --arg accessKey "$access_key" '{accessKey:$accessKey}')"
login_response="$(curl -fsS -D "$headers_file" -H 'Content-Type: application/json' \
  -X POST --data-raw "$login_payload" "$SMOKE_BASE_URL/api/auth/login")"
printf '%s' "$login_response" | jq -e '.ok == true' >/dev/null
session_cookie="$(sed -n 's/^[Ss][Ee][Tt]-[Cc][Oo][Oo][Kk][Ii][Ee]:[[:space:]]*\(dsc_session=[^;[:space:]]*\).*/\1/p' "$headers_file" | head -n 1 | tr -d '\r')"
test -n "$session_cookie"

index_layout='{"version":4,"placements":{},"catalog":{},"snapToGrid":true,"panels":[{"id":"panel-smoke","name":"部署持久化验证","kind":"custom","order":0}]}'
panel_layout='{"version":4,"placements":{},"catalog":{},"snapToGrid":true}'
seed_payload="$(jq -cn \
  --arg scope "$SMOKE_SCOPE" \
  --arg template 'device-type:device:panel-index' \
  --arg linked_scope "device:__codex-smoke__:panel" \
  --arg linked_template 'device-type:device:panel' \
  --argjson instance "$index_layout" \
  --argjson linked "$panel_layout" \
  '{scopeKey:$scope, templateKey:$template, instanceLayout:$instance, linkedInstance:{scopeKey:$linked_scope,templateKey:$linked_template,instanceLayout:$linked}}')"
seeded=1
curl -fsS -H "Cookie: $session_cookie" -H 'Content-Type: application/json' \
  -X PUT --data-raw "$seed_payload" "$SMOKE_BASE_URL/api/widget-layouts" \
  | jq -e --arg id panel-smoke '.instanceLayout.panels | any(.[]; .id == $id)' >/dev/null

docker compose up -d --no-deps --pull never --force-recreate server
healthy=0
for attempt in $(seq 1 30); do
  if docker compose exec -T server node -e "fetch('http://127.0.0.1:4000/api/system/version').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    healthy=1
    break
  fi
  sleep 5
done
if [[ "$healthy" -ne 1 ]]; then
  echo 'Widget layout persistence smoke test: server did not become healthy after recreation.' >&2
  exit 1
fi

index_after="$(curl -fsS -H "Cookie: $session_cookie" --get \
  --data-urlencode "scopeKey=$SMOKE_SCOPE" \
  --data-urlencode 'templateKey=device-type:device:panel-index' \
  "$SMOKE_BASE_URL/api/widget-layouts")"
printf '%s' "$index_after" | jq -e --arg id panel-smoke '.instanceLayout.panels | any(.[]; .id == $id)' >/dev/null

panel_after="$(curl -fsS -H "Cookie: $session_cookie" --get \
  --data-urlencode 'scopeKey=device:__codex-smoke__:panel' \
  --data-urlencode 'templateKey=device-type:device:panel' \
  "$SMOKE_BASE_URL/api/widget-layouts")"
printf '%s' "$panel_after" | jq -e '.instanceLayout != null' >/dev/null

echo 'Widget layout persistence smoke test: PASS (save, server recreation, read, linked layout).'
