package main

import (
	"testing"
	"time"
)

func TestDarwinQualityCoversEveryMetricAndValidZeros(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	payload := metricsPayload{Timestamp: now, HardwareSampledAt: now, Memory: memoryStats{TotalBytes: 100, AvailableBytes: 100}, Fans: []fanSensorStats{{RPM: 0, RPMStatus: "valid"}}}
	applyDarwinMetricQuality(&payload, time.Minute)
	for _, key := range allMetricKeys {
		if payload.MetricQuality[key].State == "" {
			t.Fatalf("missing quality for %s", key)
		}
	}
	if payload.MetricQuality["swapUsage"].State != "direct" || payload.MetricQuality["fanRpm"].State != "direct" {
		t.Fatal("real zero was marked unavailable")
	}
	if payload.MetricQuality["memoryCommitted"].State != "not_applicable" || payload.MetricQuality["gpuUsage"].State != "unavailable" {
		t.Fatal("invented platform metric")
	}
}

func TestDarwinQualityExpiresHardwareWithoutChangingSourceTimestamp(t *testing.T) {
	old := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	frequency := 2000.0
	payload := metricsPayload{Timestamp: time.Now().UTC().Format(time.RFC3339), HardwareSampledAt: old, CPUFrequencyMHz: &frequency}
	applyDarwinMetricQuality(&payload, time.Minute)
	if q := payload.MetricQuality["cpuFrequency"]; q.State != "stale" || q.ObservedAt != old {
		t.Fatalf("stale quality=%+v", q)
	}
}

func TestDarwinDiskAliasesDoNotTruncateDiskNameAtLetterS(t *testing.T) {
	found := false
	for _, candidate := range diskRateCandidates("/dev/disk12s3") {
		if candidate == "disk12" {
			found = true
		}
	}
	if !found {
		t.Fatal("Darwin partition did not resolve to its whole disk")
	}
}

func TestDarwinCounterFailureOverridesARealLookingZero(t *testing.T) {
	payload := metricsPayload{UnavailableMetrics: []string{"cpuUsage", "diskRead"}, Disks: []diskDeviceStats{{TotalBytes: 100}}}
	applyDarwinMetricQuality(&payload, time.Minute)
	if payload.MetricQuality["cpuUsage"].State != "unavailable" || payload.MetricQuality["diskRead"].State != "unavailable" {
		t.Fatal("unreadable counters were advertised as zero")
	}
}

func TestNormalizeOSNeverClassifiesDarwinOrUnknownAsLinux(t *testing.T) {
	if normalizeOS("darwin") != "macos" || normalizeOS("freebsd") != "unknown" || normalizeOS("linux") != "linux" {
		t.Fatal("incorrect OS classification")
	}
}
