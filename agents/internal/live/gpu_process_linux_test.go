//go:build linux

package live

import "testing"

func TestLinuxDRMEngineCountersIgnoreNonEngineFields(t *testing.T) {
	result := parseLinuxDRMEngineCounters("drm-engine-render: 100\ndrm-engine-copy: 20\ndrm-total-time: 999\ninvalid: x\n")
	if result["render"] != 100 || result["copy"] != 20 || len(result) != 2 {
		t.Fatalf("unexpected DRM counters: %#v", result)
	}
}
