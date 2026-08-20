package main

import "testing"

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
