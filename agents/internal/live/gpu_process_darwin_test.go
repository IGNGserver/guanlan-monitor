//go:build darwin

package live

import (
	"context"
	"testing"
	"time"
)

func TestPowermetricsProcessGPUParsesMillisecondsPerSecond(t *testing.T) {
	key := processGPUKey{pid: 123, started: 456}
	result := parsePowermetricsProcessGPU(`
*** Running tasks ***
Name ID CPU ms/s User% Wakeups GPU ms/s
Safari 123 10.00 50.00 2.00 80.00
Other 456 1.00 20.00 0.00 0.00
`, map[int32]processGPUKey{123: key})
	if got := result[key]; got != 8 {
		t.Fatalf("GPU ms/s was not converted to percent: %v", got)
	}
}

func TestGPUClientCountersBecomePercentOfWallTime(t *testing.T) {
	busy, idle, recycled := processGPUKey{pid: 10, started: 1}, processGPUKey{pid: 11, started: 1}, processGPUKey{pid: 12, started: 1}
	candidates := map[int32]processGPUKey{10: busy, 11: idle, 12: recycled}
	sampler := &darwinGPUProcessSampler{}
	start := time.Unix(1000, 0)
	if first := sampler.fromCounters(map[int32]uint64{10: 5_000_000_000, 12: 9_000_000_000}, candidates, start); len(first) != 0 {
		t.Fatalf("baseline produced values: %v", first)
	}
	second := sampler.fromCounters(map[int32]uint64{10: 5_250_000_000, 12: 1_000}, candidates, start.Add(time.Second))
	if second[busy] != 25 {
		t.Fatalf("busy=%v", second[busy])
	}
	if value, ok := second[idle]; !ok || value != 0 {
		t.Fatalf("process without a GPU client should be 0, got %v %v", value, ok)
	}
	if _, ok := second[recycled]; ok {
		t.Fatal("a counter that went backwards produced a value")
	}
}

func TestGPUSamplerFallsBackWhenNoClientPublishesUsage(t *testing.T) {
	sampler := &darwinGPUProcessSampler{readClient: func() (map[int32]uint64, bool, error) { return nil, false, nil }, previous: map[processGPUKey]uint64{{pid: 1}: 1}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if result := sampler.sample(ctx, nil); len(result) != 0 {
		t.Fatalf("cancelled sample returned %v", result)
	}
	sampler.readClient = func() (map[int32]uint64, bool, error) { return map[int32]uint64{}, false, nil }
	// With no AppUsage the counter baseline is dropped before powermetrics.
	_ = sampler.sample(context.Background(), nil)
	if sampler.previous != nil {
		t.Fatal("kept a stale counter baseline after falling back")
	}
}
