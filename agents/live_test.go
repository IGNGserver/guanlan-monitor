package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"device-state-console/agent/internal/live"
)

func TestBackgroundSlowProbeCannotBlockOrStackOnFastRefresh(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	state := &agentState{asyncSlow: true, slowCollector: func(assets hardwareAssetCache, plan collectionPlan) slowCollectionOutcome {
		started <- struct{}{}
		<-release
		return slowCollectionOutcome{metrics: emptySlowMetrics(), assets: assets}
	}}
	cfg := newDefaultRuntimeConfig(agentConnectionConfig{})
	now := time.Now()
	state.refreshSlowAsync(cfg, collectionPlan{}, now)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("slow worker was not started")
	}
	for index := 0; index < 10; index++ {
		state.refreshSlowAsync(cfg, collectionPlan{}, now.Add(time.Hour))
	}
	if !state.slowPending {
		t.Fatal("worker ownership was lost")
	}
	select {
	case <-started:
		t.Fatal("slow worker stacked")
	default:
	}
	close(release)
	select {
	case outcome := <-state.slowResults:
		state.slowResults <- outcome
	case <-time.After(time.Second):
		t.Fatal("worker did not return")
	}
	state.refreshSlowAsync(cfg, collectionPlan{}, now)
	if !state.hasSlow || state.slowStats.runs != 1 || state.slowPending {
		t.Fatal("completed slow observation not adopted")
	}
}

func TestFrozenMetricsDoNotShareMutableSlices(t *testing.T) {
	original := metricsPayload{Disks: []diskDeviceStats{{ID: "fixture", Name: "before"}}}
	frozen, err := freezeMetricsPayload(original)
	if err != nil {
		t.Fatal(err)
	}
	original.Disks[0].Name = "after"
	if frozen.Disks[0].Name != "before" {
		t.Fatal("network writer retained mutable sampling state")
	}
}

func TestRevisionTwoLiveMetricsNeverTouchTheUploadSampler(t *testing.T) {
	state := &agentState{}
	var mu sync.Mutex
	defaults := newDefaultRuntimeConfig(agentConnectionConfig{})
	handle := newLiveHandler(state, &mu, defaults, &liveConfigSource{defaults: defaults}, func() bool { return true })
	// The upload loop may hold its lock for a whole slow cycle; live metrics must not wait for it.
	mu.Lock()
	defer mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	// A single window can legitimately be unavailable (counter glitches on
	// virtualised macOS); a few windows must yield a real delta.
	var second liveMetrics
	for round := 0; round < 6 && (round < 2 || second.CPUPercent == nil); round++ {
		if round > 0 {
			time.Sleep(300 * time.Millisecond)
		}
		data, err := handle(ctx, live.Request{Topic: "metrics", HubRevision: 2})
		if err != nil {
			t.Fatal(err)
		}
		sample, ok := data.(liveMetrics)
		if !ok {
			t.Fatalf("revision-2 Hub received %T", data)
		}
		if round == 0 && (sample.CPUPercent != nil || sample.DiskReadBytesPerSec != nil || sample.NetworkRxBytesPerSec != nil) {
			t.Fatal("first live window must be unavailable, not zero", sample)
		}
		second = sample
	}
	if second.CPUPercent == nil || *second.CPUPercent < 0 || *second.CPUPercent > 100 {
		t.Fatal("later live windows did not produce a CPU delta", second.CPUPercent)
	}
	if second.MemoryTotalBytes == nil || *second.MemoryTotalBytes == 0 {
		t.Fatal("memory unavailable", second)
	}
	if state.hasLastCPU || state.lastDiskIO != nil || state.lastNetIO != nil || state.hasConfig {
		t.Fatal("live sampling advanced the upload sampler's baselines")
	}
}

func TestLiveMetricsHonourDisabledMetricKeys(t *testing.T) {
	cfg := newDefaultRuntimeConfig(agentConnectionConfig{})
	cfg.EnabledMetrics = []string{"memoryUsage"}
	sampler := &liveFastSampler{}
	sampler.sample(context.Background(), cfg)
	time.Sleep(200 * time.Millisecond)
	sample := sampler.sample(context.Background(), cfg)
	if sample.CPUPercent != nil || sample.DiskReadBytesPerSec != nil || sample.NetworkTxBytesPerSec != nil || sample.MemoryUsedBytes == nil {
		t.Fatal("disabled metrics leaked into live view", sample)
	}
}

func TestLiveConfigKeepsLastGoodConfigurationThroughPartialWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.json")
	defaults := newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "http://default.invalid", Secret: "default-secret"})
	source := &liveConfigSource{path: path, defaults: defaults}
	if got := source.load(); got.Connection.ServerURL != "http://default.invalid" {
		t.Fatal("absent file must use defaults", got.Connection.ServerURL)
	}
	write := func(content string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(`{"connection":{"serverUrl":"https://hub.example","secret":"good-secret"}}`)
	if got := source.load(); got.Connection.ServerURL != "https://hub.example" || got.Connection.Secret != "good-secret" {
		t.Fatal("valid config not adopted", got.Connection)
	}
	for _, broken := range []string{"", "   ", `{"connection":{"serverUrl":"https://other`} {
		write(broken)
		if got := source.load(); got.Connection.ServerURL != "https://hub.example" || got.Connection.Secret != "good-secret" {
			t.Fatalf("partial write %q replaced the last good config with %v", broken, got.Connection)
		}
	}
	write(`{"connection":{"serverUrl":"https://moved.example","secret":"rotated-secret-value"}}`)
	if got := source.load(); got.Connection.ServerURL != "https://moved.example" {
		t.Fatal("a real change was not picked up", got.Connection)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if got := source.load(); got.Connection.ServerURL != "http://default.invalid" {
		t.Fatal("deleting the file must return to defaults", got.Connection)
	}
}
