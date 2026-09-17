#!/bin/bash
# Debian postinst for guanlan-desktop.
#
# The desktop application is the control plane; this script registers the
# machine-scope agent service so the data plane starts at boot with nobody
# logged in.
#
# NOTE: electron-builder rewrites every dollar-brace-NAME sequence in this file
# with a build option value before shipping it, so shell variables must be
# written without braces (plain dollar-NAME) or with a default suffix such as
# dollar-brace-NAME:-default.
set -u

CONFIG_DIR=/etc/guanlan

# Resolve the bundled agent CLI instead of hardcoding the application directory,
# whose name is the (non-ASCII) product name.
AGENT_CLI=""
for candidate in /opt/*/resources/agent/guanlan-agent /opt/*/resources/agent/device-state-console-agent-backend; do
  if [ -f "$candidate" ]; then
    AGENT_CLI="$candidate"
    break
  fi
done

if [ -z "$AGENT_CLI" ]; then
  echo "guanlan-desktop: bundled agent CLI not found; the machine-scope service was not installed." >&2
  exit 0
fi

chmod 0755 "$AGENT_CLI" 2>/dev/null || true
ln -sf "$AGENT_CLI" /usr/bin/guanlan-agent 2>/dev/null || true
ln -sf "$AGENT_CLI" /usr/bin/device-state-console-agent-backend 2>/dev/null || true

install -d -m 0700 "$CONFIG_DIR" 2>/dev/null || true

# Unattended configuration: an operator-prepared environment file is sourced
# first, then the environment passed to dpkg/apt (for example
# "GUANLAN_HUB=... GUANLAN_KEY=... dpkg -i <package>") takes precedence.
if [ -f "$CONFIG_DIR/agent.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$CONFIG_DIR/agent.env"
  set +a
fi

"$AGENT_CLI" service install --config-root "$CONFIG_DIR" || {
  echo "guanlan-desktop: the machine-scope service could not be installed." >&2
  echo "guanlan-desktop: run 'sudo guanlan-agent service install' to retry." >&2
  exit 0
}

if [ -n "${GUANLAN_HUB:-}" ]; then
  KEY_FILE="$(mktemp)"
  chmod 0600 "$KEY_FILE"
  printf '%s' "${GUANLAN_KEY:-}" > "$KEY_FILE"
  "$AGENT_CLI" config set --config-root "$CONFIG_DIR" \
    --hub "$GUANLAN_HUB" \
    --device-id "${GUANLAN_DEVICE_ID:-}" \
    --hostname "${GUANLAN_HOSTNAME:-}" \
    --key-file "$KEY_FILE" || {
      echo "guanlan-desktop: unattended configuration failed; run 'sudo guanlan-agent config set' to finish." >&2
    }
  rm -f "$KEY_FILE"
fi

exit 0
