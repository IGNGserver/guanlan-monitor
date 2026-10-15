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
