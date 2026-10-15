package main

import (
	"testing"
	"time"
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
