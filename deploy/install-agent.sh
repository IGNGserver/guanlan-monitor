#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  sudo bash deploy/install-agent.sh --server-url http://SERVER:4000 --secret AGENT_SECRET [--device-id node-001]

Options:
  --server-url URL     Device State Console server URL, for example http://192.168.1.10:4000
  --secret SECRET      Agent shared secret, must match AGENT_SHARED_SECRET
  --device-id ID       Device id shown in the console. Defaults to hostname
  --install-dir DIR    Installation directory. Defaults to /opt/device-state-console-agent
  --service-user USER  Service user. Defaults to dsc-agent
EOF
}

SERVER_URL=""
AGENT_SECRET=""
DEVICE_ID="$(hostname)"
INSTALL_DIR="/opt/device-state-console-agent"
SERVICE_USER="dsc-agent"

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
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --service-user)
      SERVICE_USER="${2:-}"
      shift 2
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

if [[ -z "${SERVER_URL}" || -z "${AGENT_SECRET}" ]]; then
  usage
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 22+ first." >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

install -d -m 0755 "${INSTALL_DIR}"
install -m 0755 "${SOURCE_DIR}/agents/node-agent.mjs" "${INSTALL_DIR}/node-agent.mjs"

cat > "${INSTALL_DIR}/agent.env" <<EOF
DSC_SERVER_URL=${SERVER_URL}
DSC_AGENT_SECRET=${AGENT_SECRET}
DSC_DEVICE_ID=${DEVICE_ID}
DSC_HOSTNAME=${DEVICE_ID}
EOF
chmod 0600 "${INSTALL_DIR}/agent.env"

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${INSTALL_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

cat > /etc/systemd/system/device-state-console-agent.service <<EOF
[Unit]
Description=Device State Console Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/agent.env
ExecStart=$(command -v node) ${INSTALL_DIR}/node-agent.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now device-state-console-agent.service
systemctl --no-pager --full status device-state-console-agent.service

echo "Device State Console agent installed."
