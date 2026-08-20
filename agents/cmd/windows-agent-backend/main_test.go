package main

import (
	"runtime"
	"testing"
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
	normalized := normalizeProbeSelections([]agentProbeSelection{
		{Target: "CPU", Provider: "not-supported", Enabled: true},
	}, defaults.ProbeSelections)
	if len(normalized) != 1 || normalized[0].Target != "cpu" || normalized[0].Provider != "gopsutil" || !normalized[0].Enabled {
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
