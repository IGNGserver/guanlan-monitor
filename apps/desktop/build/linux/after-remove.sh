#!/bin/bash
# Debian postrm for guanlan-desktop.
#
# The machine-scope service must be removed before the package files disappear,
# otherwise systemd keeps restarting a unit whose executable no longer exists.
# The configuration in /etc/guanlan is preserved: reinstalling or upgrading must
# not silently drop the Hub address and access key. Use "purge" to remove it.
#
# NOTE: electron-builder rewrites every dollar-brace-NAME sequence in this file
# with a build option value before shipping it, so shell variables must be
# written without braces (plain dollar-NAME) or with a default suffix such as
# dollar-brace-NAME:-default.
set -u

CONFIG_DIR=/etc/guanlan
ACTION="${1:-remove}"

AGENT_CLI=""
for candidate in /opt/*/resources/agent/guanlan-agent /usr/bin/guanlan-agent; do
  if [ -x "$candidate" ]; then
    AGENT_CLI="$candidate"
    break
  fi
done

if [ -n "$AGENT_CLI" ]; then
  "$AGENT_CLI" service uninstall >/dev/null 2>&1 || true
else
  # The binary is already gone (upgrade ordering); clean the unit directly.
  systemctl disable --now guanlan-agent.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/guanlan-agent.service
  systemctl daemon-reload >/dev/null 2>&1 || true
fi

rm -f /usr/bin/guanlan-agent /usr/bin/device-state-console-agent-backend 2>/dev/null || true

if [ "$ACTION" = "purge" ]; then
  rm -rf "$CONFIG_DIR"
  userdel guanlan >/dev/null 2>&1 || true
fi

exit 0
