//go:build !darwin && !windows

package live

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

func readProcesses(ctx context.Context, epoch string) ([]processObservation, int, error) {
	pids, err := process.PidsWithContext(ctx)
	if err != nil {
		return nil, 0, err
	}
	count := len(pids)
	sort.Slice(pids, func(i, j int) bool { return pids[i] < pids[j] })
	if len(pids) > processReadLimit {
		pids = pids[:processReadLimit]
	}
	result := make([]processObservation, 0, len(pids))
	for _, pid := range pids {
		if ctx.Err() != nil {
			return nil, count, ctx.Err()
		}
		p, err := process.NewProcessWithContext(ctx, pid)
		if err != nil {
			continue
		}
		started, err := p.CreateTimeWithContext(ctx)
		if err != nil || started <= 0 {
			continue
		}
		name, err := p.NameWithContext(ctx)
		if err != nil {
			continue
		}
		startedText := time.UnixMilli(started).UTC().Format(time.RFC3339Nano)
		item := Process{ID: fmt.Sprintf("%s:%d:%d", epoch, pid, started), PID: pid, Name: bounded(name), StartedAt: &startedText}
		if value, err := p.PpidWithContext(ctx); err == nil {
			item.ParentPID = &value
		}
		if value, err := p.MemoryInfoWithContext(ctx); err == nil && value != nil {
			item.MemoryBytes = &value.RSS
		}
		if value, err := p.NumThreadsWithContext(ctx); err == nil && value > 0 {
			item.Threads = &value
		}
		if value, err := p.StatusWithContext(ctx); err == nil {
			status := bounded(strings.Join(value, ","))
			item.Status = &status
		}
		observation := processObservation{item: item, started: started, at: time.Now()}
		if value, err := p.TimesWithContext(ctx); err == nil && value != nil {
			total := value.User + value.System
			observation.total = &total
		}
		result = append(result, observation)
	}
	return result, count, nil
}
