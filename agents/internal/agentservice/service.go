// Package agentservice installs and controls the machine-scope agent service.
//
// The service is the data plane: it runs the collector with no desktop session,
// starts at boot and owns the machine-scope configuration. A desktop UI or a
// helper command is only a control plane on top of it.
//
// Platform behaviour:
//
//	Windows: a native service registered with the Service Control Manager. When
//	         the SCM refuses the registration (locked-down SKU, host policy) the
//	         package falls back to an AtStartup SYSTEM scheduled task. It never
//	         falls back to a per-user Run key, because that would silently
//	         require an interactive login.
//	Linux:   a system-level systemd unit at /etc/systemd/system/guanlan-agent.service.
package agentservice

import (
	"context"
	"os"
	"os/exec"
	"strings"

	"device-state-console/agent/internal/agentconfig"
)

// Kind identifies which mechanism currently provides the service.
type Kind string

const (
	// KindNone means no service is installed.
	KindNone Kind = "none"
	// KindWindowsService is a native Windows service.
	KindWindowsService Kind = "service"
	// KindScheduledTask is the AtStartup + SYSTEM scheduled-task fallback.
	KindScheduledTask Kind = "scheduled-task"
	// KindSystemd is a system-level systemd unit.
	KindSystemd Kind = "systemd"
)

// Spec describes the service to install.
type Spec struct {
	// Executable is the absolute path of the daemon binary.
	Executable string
	// Arguments are passed to the daemon on every start.
	Arguments []string
	// DisplayName is the human-readable name shown by the platform tools.
	DisplayName string
	// ServiceUser is the Linux account the unit runs as. When empty the unit
	// tries a dedicated system account and falls back to root. On Windows the
	// account is always LocalSystem.
	ServiceUser string
	// ConfigDir is the machine-scope configuration directory. On Linux it is
	// created and handed to ServiceUser so the service can read and write it.
	ConfigDir string
	// BundleRoot is the directory that holds the collector binary. It defaults
	// to the directory of the daemon executable, which is correct when both
	// binaries ship side by side; a packaged layout that keeps the CLI in a
	// separate bin directory must point this at the real agent directory.
	BundleRoot string
}

// Status is the observed service state.
type Status struct {
	Kind      Kind   `json:"kind"`
	Installed bool   `json:"installed"`
	Running   bool   `json:"running"`
	Detail    string `json:"detail,omitempty"`
}

// commandLine renders the executable plus arguments the way the platform
// service tooling expects to receive it.
//
// Every element is quoted independently: the Service Control Manager and
// schtasks split this string on spaces, so an unquoted argument value such as
// "C:\Program Files\..." would silently become several arguments.
func (s Spec) commandLine() string {
	parts := []string{quoteWindows(s.Executable)}
	for _, argument := range s.Arguments {
		parts = append(parts, quoteWindows(argument))
	}
	return strings.Join(parts, " ")
}

func quoteWindows(value string) string {
	if strings.ContainsAny(value, " \t") {
		return `"` + value + `"`
	}
	return value
}

// runCommand executes a platform tool and returns its combined output.
func runCommand(name string, args ...string) (string, error) {
	command := exec.Command(name, args...)
	output, commandErr := command.CombinedOutput()
	return strings.TrimSpace(string(output)), commandErr
}

// RunAsService hosts run under the platform service manager. handled is false
// when the process was not started by that manager, so the caller can keep
// running in the foreground.
func RunAsService(run func(context.Context) error) (handled bool, err error) {
	return runAsService(run)
}

// ensureConfigDocument creates the machine-scope configuration document when it
// does not exist yet, using the service defaults (continuous collection). Without
// this an existing-but-empty state would be indistinguishable from an operator
// deliberately turning auto-start off.
func ensureConfigDocument(configDir string) error {
	dir := strings.TrimSpace(configDir)
	if dir == "" {
		return nil
	}
	// Load with the service semantics, then persist: this creates the document
	// when it is missing and migrates a legacy one whose recorded intent does
	// not match how a machine-scope service behaves.
	path := agentconfig.ConfigPath(dir)
	config, _, err := agentconfig.LoadWithOptions(path, agentconfig.LoadOptions{ServiceScope: true})
	if err != nil {
		return err
	}
	return agentconfig.Save(path, config)
}

func firstLine(value string) string {
	trimmed := strings.TrimSpace(value)
	if index := strings.IndexByte(trimmed, '\n'); index >= 0 {
		trimmed = strings.TrimSpace(trimmed[:index])
	}
	if trimmed == "" {
		return "no output"
	}
	return trimmed
}
