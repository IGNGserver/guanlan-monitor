//go:build darwin

package agentservice

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const launchdLabel = "org.igng.guanlan.agent"
const launchdPlist = "/Library/LaunchDaemons/" + launchdLabel + ".plist"
const launchdTarget = "system/" + launchdLabel

func Name() string                                             { return "guanlan-agent" }
func runAsService(_ func(context.Context) error) (bool, error) { return false, nil }

func launchctl(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "/bin/launchctl", args...).CombinedOutput()
	return strings.TrimSpace(string(output)), err
}
func requireDarwinRoot() error {
	if os.Geteuid() != 0 {
		return errors.New("managing the system agent LaunchDaemon requires root (run guanlan-agent with sudo; never run the GUI as root)")
	}
	return nil
}

// Root must never execute code from a user-writable .app/portable directory.
// Check all parents, not just the executable. Reject symlinks rather than
// silently resolving a target that could change after validation.
func trustedRootPath(path string) error {
	if !filepath.IsAbs(path) {
		return errors.New("service paths must be absolute")
	}
	for current := filepath.Clean(path); ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 || info.Mode().Perm()&0o022 != 0 || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("service path must be root-owned, non-symlink and not group/world writable: %s", current)
		}
		if current == "/" {
			break
		}
	}
	return nil
}

func renderLaunchDaemon(spec Spec) ([]byte, error) {
	if !filepath.IsAbs(spec.Executable) || !filepath.IsAbs(spec.ConfigDir) || !filepath.IsAbs(spec.BundleRoot) {
		return nil, errors.New("LaunchDaemon executable/config/bundle paths must be absolute")
	}
	var buffer bytes.Buffer
	buffer.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n")
	writeString := func(value string) {
		buffer.WriteString("<string>")
		_ = xml.EscapeText(&buffer, []byte(value))
		buffer.WriteString("</string>\n")
	}
	buffer.WriteString("<key>Label</key>")
	writeString(launchdLabel)
	buffer.WriteString("<key>ProgramArguments</key><array>\n")
	writeString(spec.Executable)
	for _, argument := range spec.Arguments {
		if strings.ContainsRune(argument, 0) {
			return nil, errors.New("NUL in service arguments")
		}
		writeString(argument)
	}
	buffer.WriteString("</array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>ThrottleInterval</key><integer>10</integer>\n<key>ExitTimeOut</key><integer>20</integer>\n<key>ProcessType</key><string>Background</string>\n<key>Umask</key><integer>63</integer>\n<key>WorkingDirectory</key>")
	writeString(spec.BundleRoot)
	buffer.WriteString("<key>EnvironmentVariables</key><dict><key>GUANLAN_CONFIG_ROOT</key>")
	writeString(spec.ConfigDir)
	buffer.WriteString("<key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>\n</dict></plist>\n")
	return buffer.Bytes(), nil
}

func Install(spec Spec) (Status, error) {
	status := Status{Kind: KindLaunchd}
	if err := requireDarwinRoot(); err != nil {
		return status, err
	}
	if spec.ServiceUser != "" && spec.ServiceUser != "root" {
		return status, errors.New("this LaunchDaemon requires the system account for protected hardware APIs")
	}
	if err := trustedRootPath(spec.Executable); err != nil {
		return status, err
	}
	if err := trustedRootPath(filepath.Join(spec.BundleRoot, "device-state-console-agent")); err != nil {
		return status, err
	}
	plist, err := renderLaunchDaemon(spec)
	if err != nil {
		return status, err
	}
	if err := trustedRootPath("/Library/LaunchDaemons"); err != nil {
		return status, err
	}
	if err := os.MkdirAll(spec.ConfigDir, 0o700); err != nil {
		return status, err
	}
	if err := trustedRootPath(spec.ConfigDir); err != nil {
		return status, err
	}
	if err := ensureConfigDocument(spec.ConfigDir); err != nil {
		return status, err
	}
	if _, err := launchctl("print", launchdTarget); err == nil {
		if output, err := launchctl("bootout", launchdTarget); err != nil {
			return status, fmt.Errorf("launchctl bootout: %w: %s", err, firstLine(output))
		}
	}
	// Local system filesystem, not the project's NAS: stage/rename a root-only
	// temporary plist to avoid exposing a partially written launch definition.
	file, err := os.CreateTemp(filepath.Dir(launchdPlist), ".guanlan-launchd-*")
	if err != nil {
		return status, err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(plist); err == nil {
		err = file.Chmod(0o644)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return status, err
	}
	if err = os.Rename(file.Name(), launchdPlist); err != nil {
		return status, err
	}
	return Start()
}

func Uninstall() (Status, error) {
	if err := requireDarwinRoot(); err != nil {
		return Status{Kind: KindLaunchd}, err
	}
	if _, err := launchctl("print", launchdTarget); err == nil {
		if output, err := launchctl("bootout", launchdTarget); err != nil {
			return Status{Kind: KindLaunchd, Installed: true}, fmt.Errorf("launchctl bootout: %w: %s", err, firstLine(output))
		}
	}
	if err := os.Remove(launchdPlist); err != nil && !os.IsNotExist(err) {
		return Status{Kind: KindLaunchd}, err
	}
	// Preserve configuration, credentials and pending samples.
	return Status{Kind: KindNone}, nil
}
func Start() (Status, error) {
	if err := requireDarwinRoot(); err != nil {
		return Status{Kind: KindLaunchd}, err
	}
	if _, err := os.Stat(launchdPlist); err != nil {
		return Status{Kind: KindNone}, err
	}
	if _, err := launchctl("print", launchdTarget); err != nil {
		if output, err := launchctl("bootstrap", "system", launchdPlist); err != nil {
			return Status{Kind: KindLaunchd, Installed: true}, fmt.Errorf("launchctl bootstrap: %w: %s", err, firstLine(output))
		}
	}
	if output, err := launchctl("kickstart", launchdTarget); err != nil {
		return Status{Kind: KindLaunchd, Installed: true}, fmt.Errorf("launchctl kickstart: %w: %s", err, firstLine(output))
	}
	return Query()
}
func Stop() (Status, error) {
	if err := requireDarwinRoot(); err != nil {
		return Status{Kind: KindLaunchd}, err
	}
	if _, err := launchctl("print", launchdTarget); err == nil {
		if output, err := launchctl("bootout", launchdTarget); err != nil {
			return Status{Kind: KindLaunchd, Installed: true}, fmt.Errorf("launchctl bootout: %w: %s", err, firstLine(output))
		}
	}
	return Query()
}
func Query() (Status, error) {
	if _, err := os.Stat(launchdPlist); os.IsNotExist(err) {
		return Status{Kind: KindNone}, nil
	} else if err != nil {
		return Status{Kind: KindLaunchd}, err
	}
	status := Status{Kind: KindLaunchd, Installed: true, Detail: "system LaunchDaemon"}
	output, err := launchctl("print", launchdTarget)
	if err != nil {
		status.Detail = "system LaunchDaemon not loaded (or inaccessible)"
		return status, nil
	}
	status.Running = strings.Contains(output, "state = running")
	return status, nil
}
