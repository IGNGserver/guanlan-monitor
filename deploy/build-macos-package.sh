#!/bin/bash
# CI-only packaging. No installation or launchctl operations on the build host.
set -euo pipefail
app_bundle="${1:?app bundle required}"
architecture="${2:?x64 or arm64 required}"
output="${3:?output directory required}"
mode="${4:-unsigned}"
case "$architecture" in x64|arm64) ;; *) echo 'Unsupported macOS architecture' >&2; exit 1 ;; esac
case "$mode" in signed|unsigned) ;; *) echo 'Expected signed or unsigned' >&2; exit 1 ;; esac
version="$(tr -d '[:space:]' < VERSION)"
test -d "$app_bundle"
mkdir -p "$output"
suffix='-UNSIGNED'
if [ "$mode" = signed ]; then
  : "${MACOS_INSTALLER_IDENTITY:?Developer ID Installer identity required}"
  : "${MACOS_APPLICATION_IDENTITY:?Developer ID Application identity required}"
  codesign --verify --deep --strict "$app_bundle"
  # An ad-hoc signature must never be labelled a signed delivery.
  codesign -dv "$app_bundle" 2>&1 | grep -F 'Authority=Developer ID Application:' >/dev/null
  suffix=''
  : "${MACOS_NOTARY_PROFILE:?notarytool keychain profile required}"
  : "${MACOS_NOTARY_KEYCHAIN:?notarytool credential keychain required}"
  app_archive="$output/notary-app-${architecture}.zip"
  ditto -c -k --sequesterRsrc --keepParent "$app_bundle" "$app_archive"
  xcrun notarytool submit "$app_archive" --keychain "$MACOS_NOTARY_KEYCHAIN" --keychain-profile "$MACOS_NOTARY_PROFILE" --wait --output-format json > "$output/notary-app-${architecture}.json"
  python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["status"] == "Accepted", "app notarization rejected"' "$output/notary-app-${architecture}.json"
  xcrun stapler staple "$app_bundle"
  xcrun stapler validate "$app_bundle"
fi
package="$output/DeviceStateConsole-macOS-${architecture}-Install-v${version}${suffix}.pkg"
scripts="$(pwd)/apps/desktop/build/macos/pkg-scripts"
chmod 0755 "$scripts/preinstall" "$scripts/postinstall"
staging="$(mktemp -d "${output}/.guanlan-pkg.XXXXXX")"
trap 'status=$?; rm -rf "$staging"; exit "$status"' EXIT
mkdir -p "$staging/Applications" "$staging/Library/PrivilegedHelperTools/Guanlan"
ditto "$app_bundle" "$staging/Applications/$(basename "$app_bundle")"
# Dedicated root-owned helper payload: never execute a root service from
# /Applications, whose admin-group-writable parent allows an app swap.
install -m 0755 "$app_bundle/Contents/Resources/agent/guanlan-agent" "$staging/Library/PrivilegedHelperTools/Guanlan/guanlan-agent"
install -m 0755 "$app_bundle/Contents/Resources/agent/device-state-console-agent" "$staging/Library/PrivilegedHelperTools/Guanlan/device-state-console-agent"
if [ "$mode" = signed ]; then
  pkgbuild --root "$staging" --ownership recommended --install-location / --identifier org.igng.guanlan.desktop --version "$version" --scripts "$scripts" --sign "$MACOS_INSTALLER_IDENTITY" "$package"
else
  # macOS /bin/bash is 3.2: an empty array with nounset is not portable.
  pkgbuild --root "$staging" --ownership recommended --install-location / --identifier org.igng.guanlan.desktop --version "$version" --scripts "$scripts" "$package"
fi
test -s "$package"
if [ "$mode" = signed ]; then
  : "${MACOS_NOTARY_PROFILE:?notarytool keychain profile required}"
  xcrun notarytool submit "$package" --keychain "$MACOS_NOTARY_KEYCHAIN" --keychain-profile "$MACOS_NOTARY_PROFILE" --wait --output-format json > "$output/notary-package-${architecture}.json"
  python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["status"] == "Accepted", "package notarization rejected"' "$output/notary-package-${architecture}.json"
  xcrun stapler staple "$package"
  xcrun stapler validate "$package"
  pkgutil --check-signature "$package"
  spctl --assess --type install --verbose=2 "$package"
else
  echo 'UNSIGNED validation artifact: not an approved installation/update source.'
fi
(cd "$output" && shasum -a 256 "$(basename "$package")" > "$(basename "$package").sha256")
portable="$output/DeviceStateConsole-macOS-${architecture}-Portable-v${version}${suffix}.zip"
ditto -c -k --sequesterRsrc --keepParent "$app_bundle" "$portable"
(cd "$output" && shasum -a 256 "$(basename "$portable")" > "$(basename "$portable").sha256")
