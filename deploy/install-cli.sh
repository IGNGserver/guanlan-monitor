#!/usr/bin/env bash
set -euo pipefail

# This file is generated into a versioned Release asset by build-cli-agent.ps1.
# The placeholder remains here so the same script can also be fetched from a tag
# during development when --version is supplied explicitly.
DEFAULT_VERSION="__DSC_VERSION__"
REPOSITORY="IGNGserver/guanlan-monitor"
VERSION="${DSC_VERSION:-${DEFAULT_VERSION}}"
INSTALL_DIR=""
RUN_AFTER_INSTALL="false"
NO_PATH_NOTICE="false"

usage() {
  cat <<'EOF'
Usage:
  bash install-cli.sh [--version X.Y.Z] [--install-dir DIR] [--run]

Options:
  --version X.Y.Z     Fixed GitHub Release version. Required for an ungenerated tag script.
  --repository OWNER/REPO
  --install-dir DIR   User-local binary directory. Defaults to ~/.local/bin.
  --run               Enter the CLI UI after installation.
  --no-path-notice    Do not print the PATH guidance.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --repository)
      REPOSITORY="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --run)
      RUN_AFTER_INSTALL="true"
      shift
      ;;
    --no-path-notice)
      NO_PATH_NOTICE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${VERSION}" ]]; then
  VERSION=""
fi
if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "A fixed semantic version is required. Pass --version X.Y.Z." >&2
  exit 1
fi
if [[ "${EUID}" -eq 0 ]]; then
  echo "Run the user CLI installer without sudo. Use dsc start for the local agent." >&2
  exit 1
fi

USER_HOME="${HOME:-}"
if [[ -z "${USER_HOME}" ]]; then
  echo "HOME is not set; cannot select a user install directory." >&2
  exit 1
fi
if [[ -z "${INSTALL_DIR}" ]]; then
  INSTALL_DIR="${XDG_BIN_HOME:-${USER_HOME}/.local/bin}"
fi

for command in curl unzip sha256sum install; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "${command} is required." >&2
    exit 1
  }
done

case "$(uname -s)" in
  Linux) ;;
  *) echo "This installer currently supports Linux. Use install-cli.ps1 on Windows." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) echo "This release currently provides only Linux x64 CLI assets." >&2; exit 1 ;;
esac

ASSET="DeviceStateConsole-Linux-CLI-Install-v${VERSION}.zip"
BASE_URL="https://github.com/${REPOSITORY}/releases/download/v${VERSION}"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "${TEMP_ROOT}"' EXIT
ARCHIVE="${TEMP_ROOT}/${ASSET}"
CHECKSUM="${TEMP_ROOT}/${ASSET}.sha256"
PACKAGE_ROOT="${TEMP_ROOT}/package"

curl -fL --retry 3 "${BASE_URL}/${ASSET}" -o "${ARCHIVE}"
curl -fL --retry 3 "${BASE_URL}/${ASSET}.sha256" -o "${CHECKSUM}"
EXPECTED_SHA256=""
read -r EXPECTED_SHA256 _ < "${CHECKSUM}"
ACTUAL_SHA256="$(sha256sum "${ARCHIVE}")"
ACTUAL_SHA256="${ACTUAL_SHA256%% *}"
if [[ -z "${EXPECTED_SHA256}" || "${ACTUAL_SHA256,,}" != "${EXPECTED_SHA256,,}" ]]; then
  echo "SHA-256 verification failed for ${ASSET}." >&2
  exit 1
fi
mkdir -p "${PACKAGE_ROOT}"
unzip -q "${ARCHIVE}" -d "${PACKAGE_ROOT}"

for file in dsc device-state-console-agent device-state-console-agent-backend; do
  if [[ ! -f "${PACKAGE_ROOT}/${file}" ]]; then
    echo "Release asset is missing ${file}." >&2
    exit 1
  fi
done

install -d -m 0755 "${INSTALL_DIR}"
install -m 0755 "${PACKAGE_ROOT}/dsc" "${INSTALL_DIR}/dsc"
install -m 0755 "${PACKAGE_ROOT}/device-state-console-agent" "${INSTALL_DIR}/device-state-console-agent"
install -m 0755 "${PACKAGE_ROOT}/device-state-console-agent-backend" "${INSTALL_DIR}/device-state-console-agent-backend"
if [[ -f "${PACKAGE_ROOT}/VERSION" ]]; then
  install -m 0644 "${PACKAGE_ROOT}/VERSION" "${INSTALL_DIR}/VERSION"
fi

echo "观澜 CLI 已安装到 ${INSTALL_DIR}。"
if [[ "${NO_PATH_NOTICE}" != "true" ]] && [[ ":${PATH}:" != *":${INSTALL_DIR}:"* ]]; then
  echo "请将以下目录加入 PATH，或打开新终端后运行："
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
fi

if [[ "${RUN_AFTER_INSTALL}" == "true" ]]; then
  if [[ -r /dev/tty ]]; then
    exec "${INSTALL_DIR}/dsc" </dev/tty
  fi
  exec "${INSTALL_DIR}/dsc"
fi
