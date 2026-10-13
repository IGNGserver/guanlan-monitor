#!/bin/bash
# Pure shell contract test: all product/build tools are mocks. No real app build,
# product installation, signing or launchctl operations occur.
set -euo pipefail
scratch="${1:?test scratch directory required}"
repo="$(pwd)"
mkdir -p "$scratch/bin" "$scratch/fixture/apps/desktop/build/macos/pkg-scripts" "$scratch/app/Contents/Resources/agent"
printf '3.0.151\n' > "$scratch/fixture/VERSION"
cp apps/desktop/build/macos/pkg-scripts/postinstall "$scratch/fixture/apps/desktop/build/macos/pkg-scripts/postinstall"
cp apps/desktop/build/macos/pkg-scripts/preinstall "$scratch/fixture/apps/desktop/build/macos/pkg-scripts/preinstall"
printf 'mock helper\n' > "$scratch/app/Contents/Resources/agent/guanlan-agent"
printf 'mock collector\n' > "$scratch/app/Contents/Resources/agent/device-state-console-agent"
cat > "$scratch/bin/ditto" <<'MOCK'
#!/bin/bash
set -eu
if [ "$1" = -c ]; then printf 'archive\n' > "${@: -1}"; else cp -R "$1" "$2"; fi
MOCK
cat > "$scratch/bin/pkgbuild" <<'MOCK'
#!/bin/bash
set -eu
if [ "${GUANLAN_MOCK_PACKAGE_FAIL:-0}" = 1 ]; then exit 42; fi
printf 'package\n' > "${@: -1}"
MOCK
chmod 0755 "$scratch/bin/ditto" "$scratch/bin/pkgbuild"
export PATH="$scratch/bin:$PATH"
cd "$scratch/fixture"
/bin/bash "$repo/deploy/build-macos-package.sh" "$scratch/app" arm64 "$scratch/success" unsigned
test -s "$scratch/success/DeviceStateConsole-macOS-arm64-Install-v3.0.151-UNSIGNED.pkg"
test -s "$scratch/success/DeviceStateConsole-macOS-arm64-Portable-v3.0.151-UNSIGNED.zip"
if GUANLAN_MOCK_PACKAGE_FAIL=1 /bin/bash "$repo/deploy/build-macos-package.sh" "$scratch/app" x64 "$scratch/failure" unsigned; then
  echo 'FAIL: packaging failure was hidden by cleanup' >&2
  exit 1
fi
if /bin/bash "$repo/deploy/build-macos-package.sh" "$scratch/app" i386 "$scratch/bad-arch" unsigned; then
  echo 'FAIL: unsupported architecture accepted' >&2
  exit 1
fi
echo 'PASS: macOS Bash 3.2 unsigned packaging arguments and failure propagation.'
