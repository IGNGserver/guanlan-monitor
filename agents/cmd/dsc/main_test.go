package main

import (
	"encoding/json"
	"testing"
)

func TestValidateServerURLRequiresHTTPSForPublicHosts(t *testing.T) {
	cases := []struct {
		name string
		url  string
		ok   bool
	}{
		{name: "private http", url: "http://192.168.1.20:3100", ok: true},
		{name: "loopback http", url: "http://127.0.0.1:3100", ok: true},
		{name: "public https", url: "https://hub.example.com", ok: true},
		{name: "public http", url: "http://hub.example.com", ok: false},
		{name: "userinfo", url: "https://user:pass@hub.example.com", ok: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateServerURL(tc.url)
			if (err == nil) != tc.ok {
				t.Fatalf("validateServerURL(%q) error = %v, want ok=%t", tc.url, err, tc.ok)
			}
		})
	}
}

func TestParseInstanceMetricsEnforcesGlobalAndTargetBounds(t *testing.T) {
	allowed := []string{"cpuUsage", "cpuTemperature"}
	global := []string{"cpuUsage"}
	if parsed, err := parseInstanceMetrics("cpuUsage", allowed, global); err != nil || len(parsed) != 1 || parsed[0] != "cpuUsage" {
		t.Fatalf("expected valid instance metric selection, got %#v, %v", parsed, err)
	}
	if _, err := parseInstanceMetrics("cpuTemperature", allowed, global); err == nil {
		t.Fatal("instance override must not enable a globally disabled metric")
	}
	if _, err := parseInstanceMetrics("memoryUsage", allowed, global); err == nil {
		t.Fatal("instance override must reject a metric outside the target")
	}
	if parsed, err := parseInstanceMetrics("none", allowed, global); err != nil || len(parsed) != 0 {
		t.Fatalf("none must produce an explicit empty override, got %#v, %v", parsed, err)
	}
}

func TestValidateAgentConfigRejectsUnsupportedFutureVersion(t *testing.T) {
	cfg := agentLocalConfig{
		ConfigVersion: 2,
		Connection:    agentConnectionConfig{ServerURL: "https://hub.example.com"},
		Sampling:      agentSamplingConfig{NormalIntervalSeconds: 30, SlowIntervalSeconds: 30},
	}
	if err := validateAgentConfig(cfg, nil); err == nil {
		t.Fatal("future config versions must be rejected")
	}
}

func TestBackendStateDecodesProbeDetails(t *testing.T) {
	raw := []byte(`{
    "lastDetectAt": "2026-08-21T03:04:05Z",
    "detectedTargets": [{"target":"gpu","label":"GPU 显卡","instances":[{"id":"gpu-0","name":"GPU 0","metrics":["使用率","编码利用率"]}]}],
    "temperatureSources": [{"id":"cpu-package","source":"librehardwaremonitor","rawName":"CPU Package","displayName":"CPU Package","role":"cpu_package","currentC":72.5,"status":"valid","confidence":"high"}],
    "temperatureSensorBackends": [{"id":"librehardwaremonitor","label":"LibreHardwareMonitor","ok":false,"detail":"library_missing"}],
    "temperatureProbeError": "temperature_probe_failed"
}`)
	var state backendState
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatalf("decode backend state: %v", err)
	}
	if state.LastDetectAt == "" || len(state.DetectedTargets) != 1 || len(state.DetectedTargets[0].Instances) != 1 {
		t.Fatalf("probe target state was not decoded: %#v", state)
	}
	if len(state.TemperatureSources) != 1 || state.TemperatureSources[0].CurrentC == nil || *state.TemperatureSources[0].CurrentC != 72.5 {
		t.Fatalf("temperature source was not decoded: %#v", state.TemperatureSources)
	}
	if len(state.TemperatureSensorBackends) != 1 || state.TemperatureSensorBackends[0].OK {
		t.Fatalf("temperature backend state was not decoded: %#v", state.TemperatureSensorBackends)
	}
	if state.TemperatureProbeError != "temperature_probe_failed" {
		t.Fatalf("temperature probe error was not decoded: %q", state.TemperatureProbeError)
	}
}

func TestMetricCatalogMatchesAllMetricKeys(t *testing.T) {
	known := make(map[string]bool, len(allMetricKeys))
	for _, key := range allMetricKeys {
		known[key] = true
	}
	seen := map[string]bool{}
	for _, group := range metricGroups {
		for _, item := range group.Items {
			if !known[item.Key] {
				t.Fatalf("metric catalog contains unknown key %q", item.Key)
			}
			if seen[item.Key] {
				t.Fatalf("metric catalog contains duplicate key %q", item.Key)
			}
			seen[item.Key] = true
		}
	}
	for _, key := range allMetricKeys {
		if !seen[key] {
			t.Fatalf("metric key %q is missing from the CLI catalog", key)
		}
		if metricLabel(key) == key {
			t.Fatalf("metric key %q has no friendly label", key)
		}
	}
}

func TestNeedsProbeDetectionRejectsStaleState(t *testing.T) {
	if !needsProbeDetection(&backendState{}) {
		t.Fatal("empty state must trigger detection")
	}
	if !needsProbeDetection(&backendState{DetectedTargets: []probeTargetState{{Target: "cpu"}}}) {
		t.Fatal("state without LastDetectAt must trigger detection")
	}
	if needsProbeDetection(&backendState{
		LastDetectAt:    "2026-08-21T03:04:05Z",
		DetectedTargets: []probeTargetState{{Target: "cpu"}},
	}) {
		t.Fatal("fresh state must not trigger detection")
	}
}

func TestRedactStateRedactsTemperatureProbeError(t *testing.T) {
	state := backendState{
		Config:                agentLocalConfig{Connection: agentConnectionConfig{Secret: "local-secret"}},
		TemperatureProbeError: "probe failed: local-secret",
	}
	redacted := redactState(&state)
	if redacted.TemperatureProbeError != "probe failed: [redacted]" {
		t.Fatalf("temperature probe error was not redacted: %q", redacted.TemperatureProbeError)
	}
}
