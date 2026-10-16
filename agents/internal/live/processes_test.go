package live

import (
	"context"
	"os"
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
	if own.ID == "" || own.StartedAt == nil || own.CPUPercent != nil {
		t.Fatal("unreliable first process identity or CPU baseline", own)
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
