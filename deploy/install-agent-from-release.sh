#!/usr/bin/env bash
set -euo pipefail

VERSION=""
SERVER_URL=""
SECRET=""
DEVICE_ID="$(hostname)"
HOSTNAME_VALUE=""
INSTALL_DIR="/opt/device-state-console-agent"
REPOSITORY="IGNGserver/Device-State-Console"

usage() { echo "Usage: sudo bash install-agent-from-release.sh --version X.Y.Z --server-url URL --secret SECRET [options]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --server-url) SERVER_URL="${2:-}"; shift 2 ;;
    --secret) SECRET="${2:-}"; shift 2 ;;
    --device-id) DEVICE_ID="${2:-}"; shift 2 ;;
    --hostname) HOSTNAME_VALUE="${2:-}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --repository) REPOSITORY="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done
if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || -z "${SERVER_URL}" || -z "${SECRET}" ]]; then usage; exit 1; fi
if [[ "${EUID}" -ne 0 ]]; then echo "Please run with sudo." >&2; exit 1; fi
for command in curl unzip; do command -v "${command}" >/dev/null 2>&1 || { echo "${command} is required." >&2; exit 1; }; done
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "${TEMP_ROOT}"' EXIT
ASSET="linux-x64-${VERSION}.zip"
URL="https://github.com/${REPOSITORY}/releases/download/v${VERSION}/${ASSET}"
curl -fL --retry 3 "${URL}" -o "${TEMP_ROOT}/${ASSET}"
unzip -q "${TEMP_ROOT}/${ASSET}" -d "${TEMP_ROOT}/package"
ARGS=(--server-url "${SERVER_URL}" --secret "${SECRET}" --device-id "${DEVICE_ID}" --install-dir "${INSTALL_DIR}")
if [[ -n "${HOSTNAME_VALUE}" ]]; then ARGS+=(--hostname "${HOSTNAME_VALUE}"); fi
bash "${TEMP_ROOT}/package/install-agent.sh" "${ARGS[@]}"
