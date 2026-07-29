package main

import "testing"

func TestNormalizeLocalConfigMigratesEnabledGpuMetrics(t *testing.T) {
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
