package main

import (
	"os"
	"path/filepath"
	"testing"

	"device-state-console/agent/internal/agentconfig"
)

// The Windows installer configures the agent with
// "guanlan-agent config set --config-root DIR --hub URL --key-file FILE".
// A strict flag set used to reject the global --config-root and exit 1, which
// left a freshly installed host unconfigured while the installation still
// looked successful.
func TestConfigSetAcceptsGlobalFlagsFromTheInstaller(t *testing.T) {
	configDir := t.TempDir()
	keyFile := filepath.Join(t.TempDir(), "access-key.txt")
	if err := os.WriteFile(keyFile, []byte("test-access-key"), 0o600); err != nil {
		t.Fatal(err)
	}

	handled, code := dispatchSubcommand([]string{
		"config", "set",
		"--config-root", configDir,
		"--hub", "https://hub.example.com",
		"--key-file", keyFile,
		"--device-id", "node-01",
		"--hostname", "节点 01",
	}, configDir, agentconfig.DefaultListenAddress)
	if !handled {
		t.Fatal("config set was not dispatched")
	}
	if code != exitOK {
		t.Fatalf("config set exited with %d, want %d", code, exitOK)
	}

	config, created, err := agentconfig.LoadWithOptions(
		agentconfig.ConfigPath(configDir),
		agentconfig.LoadOptions{ServiceScope: true},
	)
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("configuration document was not written")
	}
	if config.Connection.ServerURL != "https://hub.example.com" {
		t.Fatalf("serverUrl = %q", config.Connection.ServerURL)
	}
	if config.Connection.Secret != "test-access-key" {
		t.Fatalf("the access key from --key-file was not stored")
	}
	if config.Connection.DeviceID != "node-01" || config.Connection.Hostname != "节点 01" {
		t.Fatalf("identity was not applied: %+v", config.Connection)
	}
	if !config.AutoStartCollector {
		t.Fatal("service scope must collect continuously")
	}
}

// A long-running service must always be authenticated: an empty token would let
// any local process read the access key and control the collector.
func TestServiceModeAlwaysProvisionsAControlToken(t *testing.T) {
	dir := t.TempDir()
	tokenPath := agentconfig.TokenPath(dir)
	if err := ensureControlToken(tokenPath); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(tokenPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) < 16 {
		t.Fatalf("control token is too short: %q", raw)
	}

	// Running again must not rotate a token a client may already be using.
	first := string(raw)
	if err := ensureControlToken(tokenPath); err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(tokenPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(second) != first {
		t.Fatal("an existing control token must be preserved")
	}
}
