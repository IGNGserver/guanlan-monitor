package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeAgentConfig(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestUploadLoopKeepsLastGoodConfigurationThroughPartialWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.json")
	defaults := newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "http://default.invalid", Secret: "default-secret"})
	state := &agentState{configPath: path}
	if got := state.loadRuntimeConfig(defaults); got.Connection.ServerURL != "http://default.invalid" {
		t.Fatal("an absent file must use defaults", got.Connection.ServerURL)
	}
	writeAgentConfig(t, path, `{"connection":{"serverUrl":"https://hub.example","secret":"good-secret"},"cloudSyncEnabled":false}`)
	if got := state.loadRuntimeConfig(defaults); got.Connection.ServerURL != "https://hub.example" || got.Connection.Secret != "good-secret" || got.CloudSyncEnabled {
		t.Fatal("valid config not adopted", got.Connection, got.CloudSyncEnabled)
	}
	for _, broken := range []string{"", "  \n", "\xEF\xBB\xBF", `{"connection":{"serverUrl":"https://other`} {
		writeAgentConfig(t, path, broken)
		got := state.loadRuntimeConfig(defaults)
		if got.Connection.ServerURL != "https://hub.example" || got.Connection.Secret != "good-secret" || got.CloudSyncEnabled {
			t.Fatalf("partial write %q replaced the last good config with %v (cloud sync %v)", broken, got.Connection, got.CloudSyncEnabled)
		}
	}
	writeAgentConfig(t, path, `{"connection":{"serverUrl":"https://moved.example","secret":"rotated-secret-value"}}`)
	if got := state.loadRuntimeConfig(defaults); got.Connection.ServerURL != "https://moved.example" || !got.CloudSyncEnabled {
		t.Fatal("a real change was not picked up", got.Connection, got.CloudSyncEnabled)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if got := state.loadRuntimeConfig(defaults); got.Connection.ServerURL != "http://default.invalid" {
		t.Fatal("deleting the file must return to defaults", got.Connection)
	}
	writeAgentConfig(t, path, `{broken`)
	if got := state.loadRuntimeConfig(defaults); got.Connection.ServerURL != "http://default.invalid" {
		t.Fatal("with no earlier good content a broken file can only mean defaults", got.Connection)
	}
}

func TestUnreadableConfigKeepsLastGoodConfiguration(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("root ignores file permissions")
	}
	path := filepath.Join(t.TempDir(), "agent.json")
	defaults := newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "http://default.invalid"})
	source := newConfigSource(path)
	writeAgentConfig(t, path, `{"connection":{"serverUrl":"https://hub.example"}}`)
	source.load(defaults)
	writeAgentConfig(t, path, `{"connection":{"serverUrl":"https://hub.example","secret":"changed-while-locked"}}`)
	if err := os.Chmod(path, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0o600) })
	if got := source.load(defaults); got.Connection.ServerURL != "https://hub.example" {
		t.Fatal("a read error must not fall back to defaults", got.Connection)
	}
}

func TestConfigSourceReturnsIndependentCopies(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.json")
	writeAgentConfig(t, path, `{"enabledMetrics":["cpuUsage","memoryUsage"],"enabledDeviceIds":{"gpu":["0"]}}`)
	source := newConfigSource(path)
	defaults := newDefaultRuntimeConfig(agentConnectionConfig{})
	first := source.load(defaults)
	first.EnabledMetrics[0] = "mutated"
	first.EnabledDeviceIDs["gpu"][0] = "mutated"
	second := source.load(defaults)
	if second.EnabledMetrics[0] != "cpuUsage" || second.EnabledDeviceIDs["gpu"][0] != "0" {
		t.Fatal("cached configuration leaked a mutation between callers", second.EnabledMetrics, second.EnabledDeviceIDs)
	}
}
