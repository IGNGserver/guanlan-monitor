package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"device-state-console/agent/internal/agentconfig"
)

func TestNormalizeLocalConfigMigratesEnabledGpuMetrics(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("the WMI GPU migration applies to the Windows probe plan")
	}
	cfg := agentLocalConfig{
		EnabledMetrics: []string{"cpuUsage"},
		ProbeSelections: []agentProbeSelection{
			{Target: "gpu", Provider: "wmi", Enabled: true},
		},
	}

	normalized := normalizeLocalConfig(cfg, []byte(`{"gpuEnabled":true}`))
	for _, metric := range []string{"gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature"} {
		found := false
		for _, enabled := range normalized.EnabledMetrics {
			if enabled == metric {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("expected migrated metric %q in %#v", metric, normalized.EnabledMetrics)
		}
	}
}

func TestDefaultLocalConfigEnablesLinuxHwmonFans(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux hwmon defaults apply only to the Linux backend")
	}
	config := defaultLocalConfig()
	for _, selection := range config.ProbeSelections {
		if selection.Target == "fan" {
			if selection.Provider != "hwmon" || !selection.Enabled {
				t.Fatalf("Linux default fan probe must use hwmon, got %#v", selection)
			}
			return
		}
	}
	t.Fatal("Linux default config has no fan probe selection")
}

func TestNormalizeLocalConfigPreservesExplicitGpuMetricSelection(t *testing.T) {
	cfg := agentLocalConfig{
		EnabledMetrics: []string{"cpuUsage", "gpuTemperature"},
		ProbeSelections: []agentProbeSelection{
			{Target: "gpu", Provider: "wmi", Enabled: true},
		},
	}

	normalized := normalizeLocalConfig(cfg, []byte(`{"gpuEnabled":true}`))
	if len(normalized.EnabledMetrics) != 2 || normalized.EnabledMetrics[1] != "gpuTemperature" {
		t.Fatalf("explicit GPU metric selection was changed: %#v", normalized.EnabledMetrics)
	}
}

func TestNormalizeLocalConfigPreservesExplicitEmptyMetrics(t *testing.T) {
	cfg := agentLocalConfig{
		EnabledMetrics: []string{},
		ProbeSelections: []agentProbeSelection{
			{Target: "gpu", Provider: "wmi", Enabled: true},
		},
	}

	normalized := normalizeLocalConfig(cfg, []byte(`{"enabledMetrics":[]}`))
	if len(normalized.EnabledMetrics) != 0 {
		t.Fatalf("explicit empty metric selection was changed: %#v", normalized.EnabledMetrics)
	}
}

func TestNormalizeProbeSelectionsFallsBackFromUnsupportedProvider(t *testing.T) {
	defaults := defaultLocalConfig()
	normalized := agentconfig.NormalizeProbeSelections([]agentProbeSelection{
		{Target: "CPU", Provider: "not-supported", Enabled: true},
	}, defaults.ProbeSelections)
	var cpu agentProbeSelection
	found := false
	for _, selection := range normalized {
		if selection.Target == "cpu" {
			cpu = selection
			found = true
			break
		}
	}
	if !found || cpu.Provider != "gopsutil" || !cpu.Enabled {
		t.Fatalf("unexpected normalized probe selection: %#v", normalized)
	}
}

func TestValidateListenAddressRequiresTokenOutsideLoopback(t *testing.T) {
	if err := validateListenAddress("127.0.0.1:17891", ""); err != nil {
		t.Fatalf("loopback listener should not require a token: %v", err)
	}
	if err := validateListenAddress("0.0.0.0:17891", ""); err == nil {
		t.Fatal("non-loopback listener without a token must be rejected")
	}
	if err := validateListenAddress("0.0.0.0:17891", "local-token"); err != nil {
		t.Fatalf("token-protected non-loopback listener should be accepted: %v", err)
	}
}

func TestHardwareProbeResponseDecodesFans(t *testing.T) {
	var response temperatureProbeResponse
	if err := json.Unmarshal([]byte(`{"fans":[{"id":"fan-board-fan1","label":"CPU Fan","interface":"nct6775"}]}`), &response); err != nil {
		t.Fatalf("decode hardware probe response: %v", err)
	}
	if len(response.Fans) != 1 || response.Fans[0].ID != "fan-board-fan1" || response.Fans[0].Interface != "nct6775" {
		t.Fatalf("fan probe response was not decoded: %#v", response.Fans)
	}
}

// The pending-spool scan is O(spool) and runs on every /api/state request. The
// size/mtime fingerprint must let an unchanged spool reuse the previous result,
// while a real change (and a missing spool) must still be reported correctly.
func TestReadCollectorPendingStateReusesUnchangedSpool(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "agent-ui.config.json.pending.jsonl.state.json")
	spoolPath := filepath.Join(dir, "agent-ui.config.json.pending.jsonl")

	write := func(entries ...string) {
		t.Helper()
		body := strings.Join(entries, "\n")
		if len(entries) > 0 {
			body += "\n"
		}
		if err := os.WriteFile(spoolPath, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(
		`{"sampledAt":"2026-01-02T00:00:00Z"}`,
		`{"sampledAt":"2026-01-01T00:00:00Z"}`,
	)

	firstServer := &server{pendingStatePath: statePath}
	first := firstServer.readCollectorPendingState()
	if first.PendingCount != 2 || first.OldestSampledAt != "2026-01-01T00:00:00Z" {
		t.Fatalf("unexpected first scan: %#v", first)
	}
	if first.SpoolSize == 0 || first.SpoolModTime == 0 {
		t.Fatalf("expected a fingerprint to be recorded: %#v", first)
	}

	// Touch the spool to a different size; the memo must not hide the change.
	write(`{"sampledAt":"2026-01-03T00:00:00Z"}`)
	second := (&server{pendingStatePath: statePath, pendingCache: &first}).readCollectorPendingState()
	if second.PendingCount != 1 || second.OldestSampledAt != "2026-01-03T00:00:00Z" {
		t.Fatalf("a changed spool must be rescanned: %#v", second)
	}

	// A memo whose fingerprint still matches must be reused without a rescan,
	// even when the state file on disk is absent.
	cache := second
	reused := (&server{pendingStatePath: statePath, pendingCache: &cache}).snapshotLockedPending()
	if reused.PendingCount != 1 || reused.OldestSampledAt != "2026-01-03T00:00:00Z" {
		t.Fatalf("an unchanged spool must reuse the memo: %#v", reused)
	}

	// Removing the spool clears the counters.
	if err := os.Remove(spoolPath); err != nil {
		t.Fatal(err)
	}
	cleared := firstServer.readCollectorPendingState()
	if cleared.PendingCount != 0 || cleared.PendingBytes != 0 || cleared.OldestSampledAt != "" {
		t.Fatalf("a missing spool must clear the counters: %#v", cleared)
	}
}

func TestDecorateDetectedFanTargetsUsesProbeIDsAndSelections(t *testing.T) {
	targets := []probeTargetState{{Target: "fan", Label: "风扇实例"}}
	cfg := agentLocalConfig{EnabledDeviceIDs: map[string][]string{"fan": []string{"fan-board-fan1"}}}
	decorateDetectedFanTargets(targets, []fanSensorReading{
		{ID: "fan-board-fan1", Label: "CPU Fan", Interface: "nct6775"},
		{ID: "fan-board-fan2", Label: "Case Fan", Interface: "nct6775"},
	}, cfg)
	if len(targets[0].Instances) != 2 {
		t.Fatalf("expected two detected fans, got %#v", targets[0].Instances)
	}
	if !targets[0].Instances[0].Enabled || targets[0].Instances[1].Enabled {
		t.Fatalf("fan enabled selections were not preserved: %#v", targets[0].Instances)
	}
	if targets[0].Instances[0].Subtitle != "nct6775" {
		t.Fatalf("fan interface was not preserved: %#v", targets[0].Instances[0])
	}
}

// The diagnostics log must stay bounded on a long-lived machine-scope service.
func TestTrimDiagnosticLogKeepsTailWithinCap(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-ui.backend.log")
	line := strings.Repeat("x", 1024) + "\n"
	content := strings.Repeat(line, (diagnosticsLogMaxBytes/1024)+64)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	trimDiagnosticLog(path)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() > diagnosticsLogMaxBytes {
		t.Fatalf("trimmed log is still %d bytes", info.Size())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 || !strings.HasSuffix(string(data), "x\n") {
		t.Fatal("the trimmed log must keep the most recent lines")
	}
	// A log inside the cap must not be rewritten.
	trimDiagnosticLog(path)
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if after.Size() != info.Size() {
		t.Fatal("a log inside the cap must not be rewritten")
	}
}
