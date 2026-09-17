//go:build linux

package agentservice

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/user"
	"strings"
)

// unitPath is the system-level unit the Debian package and `service install`
// both own. It deliberately lives in /etc/systemd/system (not the user manager)
// so the agent starts at boot with nobody logged in.
const unitPath = "/etc/systemd/system/guanlan-agent.service"

// unitName is the systemd unit identity.
const unitName = "guanlan-agent.service"

// defaultServiceUser is the least-privileged account the unit prefers. The unit
// falls back to root when the account cannot be created.
const defaultServiceUser = "guanlan"

// Name returns the service identity used in messages and JSON output.
func Name() string { return strings.TrimSuffix(unitName, ".service") }

// Install writes the unit and enables it.
func Install(spec Spec) (Status, error) {
	if strings.TrimSpace(spec.Executable) == "" {
		return Status{Kind: KindNone}, errors.New("agentservice: executable path is required")
	}
	if os.Geteuid() != 0 {
		return Status{Kind: KindNone}, errors.New("installing the agent service requires root (run with sudo)")
	}

	serviceUser, userDetail := resolveServiceUser(spec.ServiceUser)
	unit := renderUnit(spec, serviceUser)
	if err := os.WriteFile(unitPath, []byte(unit), 0o644); err != nil {
		return Status{Kind: KindSystemd}, fmt.Errorf("write %s: %w", unitPath, err)
	}
	if output, err := runCommand("systemctl", "daemon-reload"); err != nil {
		return Status{Kind: KindSystemd}, fmt.Errorf("systemctl daemon-reload: %w: %s", err, firstLine(output))
	}
	if output, err := runCommand("systemctl", "enable", "--now", unitName); err != nil {
		status, _ := Query()
		return status, fmt.Errorf("systemctl enable --now %s: %w: %s", unitName, err, firstLine(output))
	}
	status, err := Query()
	if userDetail != "" {
		status.Detail = strings.TrimSpace(status.Detail + "; " + userDetail)
	}
	return status, err
}

// Uninstall disables and removes the unit. Configuration is preserved.
func Uninstall() (Status, error) {
	if os.Geteuid() != 0 {
		return Status{Kind: KindNone}, errors.New("removing the agent service requires root (run with sudo)")
	}
	_, _ = runCommand("systemctl", "disable", "--now", unitName)
	if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
		return Status{Kind: KindSystemd}, fmt.Errorf("remove %s: %w", unitPath, err)
	}
	_, _ = runCommand("systemctl", "daemon-reload")
	_, _ = runCommand("systemctl", "reset-failed", unitName)
	return Status{Kind: KindNone, Installed: false, Running: false}, nil
}

// Start starts the unit.
func Start() (Status, error) {
	if output, err := runCommand("systemctl", "start", unitName); err != nil {
		return Status{Kind: KindSystemd, Installed: unitExists()}, fmt.Errorf("systemctl start: %w: %s", err, firstLine(output))
	}
	return Query()
}

// Stop stops the unit.
func Stop() (Status, error) {
	if output, err := runCommand("systemctl", "stop", unitName); err != nil {
		return Status{Kind: KindSystemd, Installed: unitExists()}, fmt.Errorf("systemctl stop: %w: %s", err, firstLine(output))
	}
	return Query()
}

// Query reports whether the unit exists, is enabled and is active.
func Query() (Status, error) {
	if !unitExists() {
		return Status{Kind: KindNone, Installed: false, Running: false}, nil
	}
	status := Status{Kind: KindSystemd, Installed: true, Detail: "system systemd unit"}
	if _, err := runCommand("systemctl", "is-active", "--quiet", unitName); err == nil {
		status.Running = true
	}
	if output, err := runCommand("systemctl", "is-enabled", unitName); err == nil {
		status.Detail = fmt.Sprintf("system systemd unit (%s)", firstLine(output))
	}
	return status, nil
}

// runAsService always reports handled=false on Linux: systemd owns the process
// lifecycle and the daemon runs in the foreground.
func runAsService(_ func(context.Context) error) (bool, error) {
	return false, nil
}

func unitExists() bool {
	_, err := os.Stat(unitPath)
	return err == nil
}

// resolveServiceUser returns the account to run as, creating the dedicated
// system user when possible. It falls back to root rather than failing the
// installation, and reports which choice it made.
func resolveServiceUser(requested string) (string, string) {
	name := strings.TrimSpace(requested)
	if name == "" {
		name = defaultServiceUser
	}
	if name == "root" {
		return "", "running as root"
	}
	if _, err := user.Lookup(name); err == nil {
		return name, ""
	}
	if output, err := runCommand("useradd", "--system", "--no-create-home", "--shell", "/usr/sbin/nologin", name); err != nil {
		return "", fmt.Sprintf("service user %q unavailable (%s); running as root", name, firstLine(output))
	}
	return name, ""
}

func renderUnit(spec Spec, serviceUser string) string {
	execStart := strings.Join(append([]string{quoteUnit(spec.Executable)}, spec.Arguments...), " ")
	description := spec.DisplayName
	if strings.TrimSpace(description) == "" {
		description = "Guanlan device status agent"
	}

	userLine := ""
	if serviceUser != "" {
		userLine = fmt.Sprintf("User=%s\n", serviceUser)
	}

	return fmt.Sprintf(`[Unit]
Description=%s
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=11

[Service]
Type=simple
%sExecStart=%s
Restart=always
RestartSec=5
# Give the collector time to flush its upload spool on stop.
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
`, description, userLine, execStart)
}

func quoteUnit(value string) string {
	if strings.ContainsAny(value, " \t\"'\\") {
		return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
	}
	return value
}
