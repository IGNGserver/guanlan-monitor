#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  sudo bash deploy/install-agent.sh --server-url http://SERVER:3100 --secret AGENT_SECRET [--device-id node-001]
  sudo bash deploy/install-agent.sh --uninstall [--install-dir /opt/device-state-console-agent]

Options:
  --server-url URL     Device State Console server URL, for example http://192.168.1.10:3100
  --secret SECRET      Agent shared secret, must match AGENT_SHARED_SECRET
  --device-id ID       Device id shown in the console. Defaults to hostname
  --hostname NAME      Device display name shown in the console. Defaults to device id
  --install-dir DIR    Installation directory. Defaults to /opt/device-state-console-agent
  --service-user USER  Service user. Defaults to dsc-agent
  --agent-binary PATH  Prebuilt CLI binary. Defaults to a sibling binary in a release package
  --go-path PATH       Go executable path. Defaults to the current `go`
  --restart-count N    Max restarts allowed within the restart window. Defaults to 10
  --restart-window-minutes N
                       Restart window in minutes. Defaults to 5
  --uninstall          Stop and remove the CLI agent service and install directory
EOF
}

SERVER_URL=""
AGENT_SECRET=""
DEVICE_ID="$(hostname)"
HOSTNAME_VALUE=""
INSTALL_DIR="/opt/device-state-console-agent"
SERVICE_USER="dsc-agent"
GO_PATH=""
AGENT_BINARY=""
RESTART_COUNT="10"
RESTART_WINDOW_MINUTES="5"
UNINSTALL="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url)
      SERVER_URL="${2:-}"
      shift 2
      ;;
    --secret)
      AGENT_SECRET="${2:-}"
      shift 2
      ;;
    --device-id)
      DEVICE_ID="${2:-}"
      shift 2
      ;;
    --hostname)
      HOSTNAME_VALUE="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --service-user)
      SERVICE_USER="${2:-}"
      shift 2
      ;;
    --go-path)
      GO_PATH="${2:-}"
      shift 2
      ;;
    --agent-binary)
      AGENT_BINARY="${2:-}"
      shift 2
      ;;
    --restart-count)
      RESTART_COUNT="${2:-}"
      shift 2
      ;;
    --restart-window-minutes)
      RESTART_WINDOW_MINUTES="${2:-}"
      shift 2
      ;;
    --uninstall)
      UNINSTALL="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this script with sudo." >&2
  exit 1
fi

if [[ "${UNINSTALL}" == "true" ]]; then
  systemctl disable --now device-state-console-agent.service 2>/dev/null || true
  rm -f /etc/systemd/system/device-state-console-agent.service
  systemctl daemon-reload
  rm -rf "${INSTALL_DIR}"
  echo "Device State Console CLI agent uninstalled."
  exit 0
fi

if [[ -z "${SERVER_URL}" || -z "${AGENT_SECRET}" ]]; then
  usage
  exit 1
fi

if [[ -z "${HOSTNAME_VALUE}" ]]; then
  HOSTNAME_VALUE="${DEVICE_ID}"
fi

if ! [[ "${RESTART_COUNT}" =~ ^[0-9]+$ ]]; then
  echo "--restart-count must be a non-negative integer." >&2
  exit 1
fi

if ! [[ "${RESTART_WINDOW_MINUTES}" =~ ^[0-9]+$ ]] || [[ "${RESTART_WINDOW_MINUTES}" -lt 1 ]]; then
  echo "--restart-window-minutes must be an integer greater than or equal to 1." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${AGENT_BINARY}" && -x "${SCRIPT_DIR}/device-state-console-agent" ]]; then
  AGENT_BINARY="${SCRIPT_DIR}/device-state-console-agent"
fi

if [[ -z "${AGENT_BINARY}" && -z "${GO_PATH}" ]]; then
  if ! command -v go >/dev/null 2>&1; then
    echo "Go 1.24+ is required. Install Go first or pass --go-path." >&2
    exit 1
  fi
  GO_PATH="$(command -v go)"
fi

if [[ -z "${AGENT_BINARY}" && ! -x "${GO_PATH}" ]]; then
  echo "Go executable not found or not executable: ${GO_PATH}" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_SOURCE_DIR="${SOURCE_DIR}/agents"
VERSION_FILE="${SCRIPT_DIR}/VERSION"
if [[ ! -f "${VERSION_FILE}" ]]; then
  VERSION_FILE="${SOURCE_DIR}/VERSION"
fi
if [[ ! -f "${VERSION_FILE}" ]]; then
  echo "VERSION file not found beside the installer or repository root." >&2
  exit 1
fi
VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"

install -d -m 0755 "${INSTALL_DIR}"
printf '%s\n' "${VERSION}" > "${INSTALL_DIR}/VERSION"
if [[ -n "${AGENT_BINARY}" ]]; then
  if [[ ! -x "${AGENT_BINARY}" ]]; then
    echo "Agent binary not found or not executable: ${AGENT_BINARY}" >&2
    exit 1
  fi
  install -m 0755 "${AGENT_BINARY}" "${INSTALL_DIR}/device-state-console-agent"
else
  "${GO_PATH}" build -C "${AGENT_SOURCE_DIR}" -o "${INSTALL_DIR}/device-state-console-agent" .
fi
chmod 0755 "${INSTALL_DIR}/device-state-console-agent"

RESTART_WINDOW_SECONDS=$(( RESTART_WINDOW_MINUTES * 60 ))
if [[ "${RESTART_WINDOW_SECONDS}" -lt 60 ]]; then
  RESTART_WINDOW_SECONDS=60
fi
RESTART_DELAY_SECONDS=$(( RESTART_WINDOW_SECONDS / (RESTART_COUNT + 1) ))
if [[ "${RESTART_DELAY_SECONDS}" -lt 3 ]]; then
  RESTART_DELAY_SECONDS=3
fi
if [[ "${RESTART_DELAY_SECONDS}" -gt 30 ]]; then
  RESTART_DELAY_SECONDS=30
fi

cat > "${INSTALL_DIR}/agent.env" <<EOF
DSC_SERVER_URL=${SERVER_URL}
DSC_AGENT_SECRET=${AGENT_SECRET}
DSC_DEVICE_ID=${DEVICE_ID}
DSC_HOSTNAME=${HOSTNAME_VALUE}
EOF
chmod 0600 "${INSTALL_DIR}/agent.env"

cat > "${INSTALL_DIR}/run-agent.sh" <<EOF
#!/usr/bin/env bash
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR}"
MAX_RESTART_COUNT=${RESTART_COUNT}
RESTART_WINDOW_SECONDS=${RESTART_WINDOW_SECONDS}
RESTART_DELAY_SECONDS=${RESTART_DELAY_SECONDS}
OUT_LOG="\${INSTALL_DIR}/agent.out.log"
ERR_LOG="\${INSTALL_DIR}/agent.err.log"

cd "\${INSTALL_DIR}"
set -a
source "\${INSTALL_DIR}/agent.env"
set +a

declare -a RECENT_STARTS=()

while true; do
  NOW=\$(date +%s)
  FILTERED=()
  for START_AT in "\${RECENT_STARTS[@]:-}"; do
    if (( NOW - START_AT < RESTART_WINDOW_SECONDS )); then
      FILTERED+=("\${START_AT}")
    fi
  done
  RECENT_STARTS=("\${FILTERED[@]:-}")

  if (( MAX_RESTART_COUNT > 0 && \${#RECENT_STARTS[@]} >= MAX_RESTART_COUNT )); then
    printf '[%s] agent exited too frequently (%s times within %s seconds); stopping automatic restarts.\n' \
      "\$(date --iso-8601=seconds)" "\${#RECENT_STARTS[@]}" "\${RESTART_WINDOW_SECONDS}" >> "\${ERR_LOG}"
    exit 0
  fi

  RECENT_STARTS+=("\${NOW}")
  "\${INSTALL_DIR}/device-state-console-agent" >> "\${OUT_LOG}" 2>> "\${ERR_LOG}"
  EXIT_CODE=\$?
  printf '[%s] agent exited with code %s\n' "\$(date --iso-8601=seconds)" "\${EXIT_CODE}" >> "\${ERR_LOG}"
  sleep "\${RESTART_DELAY_SECONDS}"
done
EOF
chmod 0755 "${INSTALL_DIR}/run-agent.sh"

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${INSTALL_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

cat > /etc/systemd/system/device-state-console-agent.service <<EOF
[Unit]
Description=Device State Console Go Agent
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=${RESTART_WINDOW_SECONDS}
StartLimitBurst=$(( RESTART_COUNT + 1 ))

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/agent.env
ExecStart=${INSTALL_DIR}/run-agent.sh
Restart=on-failure
RestartSec=${RESTART_DELAY_SECONDS}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now device-state-console-agent.service
systemctl --no-pager --full status device-state-console-agent.service

echo "Device State Console Go agent installed."
