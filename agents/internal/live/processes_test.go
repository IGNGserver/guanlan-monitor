package live

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestProcessSnapshotTracksOwnPIDByStartTimeAndDoesNotInventFirstCPU(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	collector := &ProcessCollector{}
	first, err := collector.Collect(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var own *Process
	for index := range first.Items {
		if first.Items[index].PID == int32(os.Getpid()) {
			own = &first.Items[index]
			break
		}
	}
	if own == nil {
		t.Fatal("current process absent from snapshot")
	}
	if own.ID == "" || own.StartedAt == nil || own.CPUPercent != nil || own.GPUPercent != nil {
		t.Fatal("unreliable first process identity or metric baseline", own)
	}
	second, err := collector.Collect(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range second.Items {
		if item.PID == own.PID {
			if item.ID != own.ID || item.CPUPercent == nil || *item.CPUPercent < 0 || *item.CPUPercent > 100 {
				t.Fatal("process delta/identity changed unexpectedly", item)
			}
			return
		}
	}
	t.Fatal("current process disappeared from second snapshot")
}

func TestProcessRankingKeepsTheBusiestAndPutsUnknownLast(t *testing.T) {
	cpu := func(value float64) *float64 { return &value }
	memory := func(value uint64) *uint64 { return &value }
	items := []Process{
		{PID: 1, CPUPercent: nil, MemoryBytes: memory(900)},
		{PID: 2, CPUPercent: cpu(5), MemoryBytes: memory(10)},
		{PID: 3, CPUPercent: cpu(50), MemoryBytes: nil},
		{PID: 4, CPUPercent: cpu(5), MemoryBytes: memory(20)},
		{PID: 5, CPUPercent: nil, MemoryBytes: nil},
	}
	rankProcesses(items)
	var order []int32
	for _, item := range items {
		order = append(order, item.PID)
	}
	want := []int32{3, 4, 2, 1, 5}
	for index := range want {
		if order[index] != want[index] {
			t.Fatal("unexpected ranking", order)
		}
	}
}

func TestLegacyProcessResultOmitsGPUField(t *testing.T) {
	value := 37.5
	legacy := (Processes{ObservedAt: "2026-10-17T00:00:00Z", CPUScale: "host", MemoryKind: "rss", Items: []Process{{ID: "p", PID: 42, Name: "renderer", GPUPercent: &value}}}).withoutGPU()
	raw, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "" || containsJSONField(raw, "gpuPercent") {
		t.Fatal("legacy process result leaked gpuPercent", string(raw))
	}
}

func containsJSONField(raw []byte, field string) bool {
	var value map[string]any
	if json.Unmarshal(raw, &value) != nil {
		return false
	}
	items, ok := value["items"].([]any)
	if !ok || len(items) == 0 {
		return false
	}
	_, ok = items[0].(map[string]any)[field]
	return ok
}

func TestProcessDiskRatesAndRevisionShapes(t *testing.T) {
	read, write := uint64(1000), uint64(4000)
	if rate := counterRate(&read, &write, 2); rate == nil || *rate != 1500 {
		t.Fatalf("rate=%v", rate)
	}
	if counterRate(&write, &read, 2) != nil || counterRate(nil, &read, 1) != nil || counterRate(&read, &read, 0) != nil {
		t.Fatal("invented a rate from a reset, missing reading or empty window")
	}
	value := 12.5
	result := Processes{Items: []Process{{ID: "p", PID: 1, Name: "x", GPUPercent: &value, DiskReadBytesPerSec: &value}}}
	raw, _ := json.Marshal(result.withoutDisk())
	if strings.Contains(string(raw), "diskRead") || !strings.Contains(string(raw), "gpuPercent") {
		t.Fatalf("revision-3 shape: %s", raw)
	}
	raw, _ = json.Marshal(result)
	if !strings.Contains(string(raw), `"diskReadBytesPerSec":12.5`) || !strings.Contains(string(raw), `"diskWriteBytesPerSec":null`) {
		t.Fatalf("revision-4 shape: %s", raw)
	}
}
