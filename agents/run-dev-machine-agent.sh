#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/dev-machine-agent.env"
OUT_LOG="${SCRIPT_DIR}/dev-machine-agent.out.log"
ERR_LOG="${SCRIPT_DIR}/dev-machine-agent.err.log"
NODE_PATH="${NODE_PATH:-/usr/bin/node}"
MAX_RESTART_COUNT="${MAX_RESTART_COUNT:-10}"
RESTART_WINDOW_SECONDS="${RESTART_WINDOW_SECONDS:-300}"
RESTART_DELAY_SECONDS="${RESTART_DELAY_SECONDS:-27}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

if [[ ! -x "${NODE_PATH}" ]]; then
  echo "Node executable not found: ${NODE_PATH}" >&2
  exit 1
fi

cd "${SCRIPT_DIR}"
set -a
source "${ENV_FILE}"
set +a

declare -a RECENT_STARTS=()

while true; do
  NOW=$(date +%s)
  FILTERED=()
  for START_AT in "${RECENT_STARTS[@]:-}"; do
    if (( NOW - START_AT < RESTART_WINDOW_SECONDS )); then
      FILTERED+=("${START_AT}")
    fi
  done
  RECENT_STARTS=("${FILTERED[@]:-}")

  if (( MAX_RESTART_COUNT > 0 && ${#RECENT_STARTS[@]} >= MAX_RESTART_COUNT )); then
    printf '[%s] agent exited too frequently (%s times within %s seconds); stopping automatic restarts.\n' \
      "$(date --iso-8601=seconds)" "${#RECENT_STARTS[@]}" "${RESTART_WINDOW_SECONDS}" >> "${ERR_LOG}"
    exit 0
  fi

  RECENT_STARTS+=("${NOW}")
  "${NODE_PATH}" "${SCRIPT_DIR}/node-agent.mjs" >> "${OUT_LOG}" 2>> "${ERR_LOG}"
  EXIT_CODE=$?
  printf '[%s] agent exited with code %s\n' "$(date --iso-8601=seconds)" "${EXIT_CODE}" >> "${ERR_LOG}"
  sleep "${RESTART_DELAY_SECONDS}"
done
