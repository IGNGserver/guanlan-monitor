package agentconfig

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// On-disk file names inside the configuration directory. The names are kept
// from the desktop/CLI era so an existing installation keeps working; only the
// directory changed (per-user application data -> machine scope).
const (
	ConfigFileName      = "agent-ui.config.json"
	TokenFileName       = "agent-ui.local-token"
	SyncStateFileName   = "agent-ui.sync-state.json"
	DiagnosticsFileName = "agent-ui.backend.log"
	RuntimeFileName     = "agent-ui.runtime.json"
)

// Environment variables that select the configuration directory.
const (
	// EnvConfigRoot is the canonical machine-scope override consumed by the
	// service, the helper commands and the installers.
	EnvConfigRoot = "GUANLAN_CONFIG_ROOT"
	// EnvLegacyConfigRoot is the retired CLI-era override. It is still honoured
	// so existing automation does not silently fall back to another directory.
	EnvLegacyConfigRoot = "DSC_CLI_CONFIG_ROOT"
	// EnvAgentConfigFile points the collector at one exact document.
	EnvAgentConfigFile = "DSC_AGENT_CONFIG_FILE"
)

// DefaultListenAddress is the loopback control endpoint of the machine-scope
// service. It is fixed (unlike the desktop's per-run random port) because the
// GUI, the CLI and the onboarding page all have to find it without a handshake
// file.
const DefaultListenAddress = "127.0.0.1:17891"

// MachineDir returns the machine-scope configuration directory.
//
//	Windows: %ProgramData%\Guanlan
//	Linux:   /etc/guanlan
//
// It is the directory the service owns and the default target of every
// privileged command. Unprivileged callers get a permission error rather than a
// silent fallback, so the configuration can never split between two locations.
func MachineDir() string {
	if runtime.GOOS == "windows" {
		base := strings.TrimSpace(os.Getenv("ProgramData"))
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "Guanlan")
	}
	return "/etc/guanlan"
}

// UserDir returns the legacy per-user configuration directory. It is used for
// read-only migration and for portable/development runs that are explicitly
// pointed here.
func UserDir() string {
	if base := strings.TrimSpace(os.Getenv(EnvLegacyConfigRoot)); base != "" {
		if absolute, err := filepath.Abs(base); err == nil {
			return absolute
		}
		return base
	}
	if runtime.GOOS == "windows" {
		if base := strings.TrimSpace(os.Getenv("AppData")); base != "" {
			return filepath.Join(base, "device-state-console")
		}
	}
	if base, err := os.UserConfigDir(); err == nil && strings.TrimSpace(base) != "" {
		return filepath.Join(base, "device-state-console")
	}
	return "."
}

// ResolveDir applies the configuration-directory precedence:
// explicit flag > GUANLAN_CONFIG_ROOT > legacy DSC_CLI_CONFIG_ROOT > machine scope.
func ResolveDir(explicit string) string {
	if value := strings.TrimSpace(explicit); value != "" {
		return toAbsolute(value)
	}
	if value := strings.TrimSpace(os.Getenv(EnvConfigRoot)); value != "" {
		return toAbsolute(value)
	}
	if value := strings.TrimSpace(os.Getenv(EnvLegacyConfigRoot)); value != "" {
		return toAbsolute(value)
	}
	return MachineDir()
}

// ResolveDirAllowUser is ResolveDir with a platform user-scope fallback. Only
// portable and development entry points use it.
func ResolveDirAllowUser(explicit string) string {
	if value := strings.TrimSpace(explicit); value != "" {
		return toAbsolute(value)
	}
	if value := strings.TrimSpace(os.Getenv(EnvConfigRoot)); value != "" {
		return toAbsolute(value)
	}
	return UserDir()
}

// ConfigPath returns the configuration document path inside dir.
func ConfigPath(dir string) string { return filepath.Join(dir, ConfigFileName) }

// TokenPath returns the loopback control token path inside dir.
func TokenPath(dir string) string { return filepath.Join(dir, TokenFileName) }

// SyncStatePath returns the pending cloud-sync state path inside dir.
func SyncStatePath(dir string) string { return filepath.Join(dir, SyncStateFileName) }

// DiagnosticsPath returns the backend diagnostics log path inside dir.
func DiagnosticsPath(dir string) string { return filepath.Join(dir, DiagnosticsFileName) }

// PendingStatePath returns the collector's offline spool path.
//
// The collector derives it from the configuration document path unless
// DSC_AGENT_PENDING_FILE overrides it, so the backend mirrors that rule to
// report spool state. A relative override is resolved against dir.
func PendingStatePath(dir string) string {
	if override := strings.TrimSpace(os.Getenv("DSC_AGENT_PENDING_FILE")); override != "" {
		if filepath.IsAbs(override) {
			return filepath.Clean(override)
		}
		return filepath.Join(dir, override)
	}
	return ConfigPath(dir) + ".pending.jsonl"
}

// PendingStateCachePath returns the collector's spool counter cache, which the
// backend reports as pendingSampleCount/pendingBytes.
func PendingStateCachePath(dir string) string {
	return PendingStatePath(dir) + ".state.json"
}

// EnsureDir creates dir with owner-only permissions when it is missing.
func EnsureDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create configuration directory %s: %w", dir, err)
	}
	return nil
}

// Writable reports whether this process may create files in dir, returning an
// actionable error when it may not.
func Writable(dir string) error {
	if err := EnsureDir(dir); err != nil {
		return err
	}
	probe, err := os.CreateTemp(dir, ".dsc-write-probe-*")
	if err != nil {
		return fmt.Errorf("configuration directory %s is not writable (run this command elevated, or set %s): %w", dir, EnvConfigRoot, err)
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)
	return nil
}

func toAbsolute(path string) string {
	if absolute, err := filepath.Abs(path); err == nil {
		return absolute
	}
	return path
}
