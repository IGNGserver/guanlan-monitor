#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "${REPO_ROOT}/VERSION")"
OUTPUT_DIR="${REPO_ROOT}/release/linux-agent-gui"

usage() {
  cat <<'EOF'
Usage: build-linux-agent-gui.sh [--output-dir DIR] [--version X.Y.Z]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUTPUT_DIR="${2:?missing output directory}"
      shift 2
      ;;
    --version)
      VERSION="${2:?missing version}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid version: ${VERSION}" >&2
  exit 1
fi

for command in gcc go pkg-config dpkg-deb; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "Required command not found: ${command}" >&2
    exit 1
  }
done

pkg-config --exists gtk4 libadwaita-1 webkitgtk-6.0 libsoup-3.0 json-glib-1.0 || {
  echo "GTK4/libadwaita/WebKitGTK build dependencies are missing." >&2
  exit 1
}

mkdir -p "${OUTPUT_DIR}"
OUTPUT_DIR="$(cd "${OUTPUT_DIR}" && pwd)"
STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGING_DIR}"' EXIT

APP_ROOT="${STAGING_DIR}/usr/lib/device-state-console"
mkdir -p "${APP_ROOT}" \
  "${STAGING_DIR}/usr/bin" \
  "${STAGING_DIR}/usr/share/applications" \
  "${STAGING_DIR}/usr/share/icons/hicolor/scalable/apps" \
  "${STAGING_DIR}/usr/lib/systemd/user" \
  "${STAGING_DIR}/DEBIAN"

go build -C "${REPO_ROOT}/agents/cmd/windows-agent-backend" \
  -trimpath -ldflags "-s -w -X main.BuildVersion=${VERSION}" \
  -o "${APP_ROOT}/device-state-console-agent-backend"
go build -C "${REPO_ROOT}/agents" \
  -trimpath -ldflags "-s -w -X main.BuildVersion=${VERSION}" \
  -o "${APP_ROOT}/device-state-console-agent"

read -r -a GTK_CFLAGS <<< "$(pkg-config --cflags gtk4 libadwaita-1 webkitgtk-6.0 libsoup-3.0 json-glib-1.0)"
read -r -a GTK_LIBS <<< "$(pkg-config --libs gtk4 libadwaita-1 webkitgtk-6.0 libsoup-3.0 json-glib-1.0)"
gcc -std=c17 -O2 -Wall -Wextra -Wno-unused-parameter \
  -DDSC_VERSION="\"${VERSION}\"" \
  "${GTK_CFLAGS[@]}" \
  "${REPO_ROOT}/linux-agent-gui/src/main.c" \
  -o "${APP_ROOT}/device-state-console-linux-gui" \
  "${GTK_LIBS[@]}"

install -m 0755 "${REPO_ROOT}/linux-agent-gui/assets/device-state-console" \
  "${STAGING_DIR}/usr/bin/device-state-console"
install -m 0644 "${REPO_ROOT}/linux-agent-gui/assets/org.igng.DeviceStateConsole.desktop" \
  "${STAGING_DIR}/usr/share/applications/org.igng.DeviceStateConsole.desktop"
install -m 0644 "${REPO_ROOT}/linux-agent-gui/assets/org.igng.DeviceStateConsole.svg" \
  "${STAGING_DIR}/usr/share/icons/hicolor/scalable/apps/org.igng.DeviceStateConsole.svg"
install -m 0644 "${REPO_ROOT}/linux-agent-gui/assets/device-state-console-agent-backend.service" \
  "${STAGING_DIR}/usr/lib/systemd/user/device-state-console-agent-backend.service"
install -m 0644 "${REPO_ROOT}/VERSION" "${APP_ROOT}/VERSION"

cat > "${STAGING_DIR}/DEBIAN/control" <<EOF
Package: device-state-console
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: IGNGserver <support@igngserver.example>
Depends: libc6 (>= 2.35), libgtk-4-1, libadwaita-1-0 (>= 1.2), libwebkitgtk-6.0-4, libsoup-3.0-0, libjson-glib-1.0-0
Description: Device State Console Linux GUI agent
 GTK4/libadwaita configuration client with an embedded Device State Console Hub view.
EOF

cat > "${STAGING_DIR}/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -eu
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi
exit 0
EOF
chmod 0755 "${STAGING_DIR}/DEBIAN/postinst"

PACKAGE="${OUTPUT_DIR}/DeviceStateConsole-Linux-GUI-Install-v${VERSION}.deb"
rm -f "${PACKAGE}"
dpkg-deb --build --root-owner-group "${STAGING_DIR}" "${PACKAGE}"
sha256sum "${PACKAGE}" > "${PACKAGE}.sha256"
echo "Created ${PACKAGE}"
