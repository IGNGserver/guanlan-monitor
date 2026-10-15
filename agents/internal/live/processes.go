package live

import (
	"context"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"
)

type Process struct {
	ID          string   `json:"id"`
	PID         int32    `json:"pid"`
	ParentPID   *int32   `json:"parentPid"`
	Name        string   `json:"name"`
	StartedAt   *string  `json:"startedAt"`
	CPUPercent  *float64 `json:"cpuPercent"`
	MemoryBytes *uint64  `json:"memoryBytes"`
	Threads     *int32   `json:"threads"`
	Status      *string  `json:"status"`
}

type Processes struct {
	ObservedAt string    `json:"observedAt"`
	CPUScale   string    `json:"cpuScale"`
	MemoryKind string    `json:"memoryKind"`
	TotalCount int       `json:"totalCount"`
	Truncated  bool      `json:"truncated"`
	Items      []Process `json:"items"`
}

type processSample struct {
	started int64
	total   float64
	at      time.Time
}

// One owner per Agent installation/topic. No samples cross installation restarts.
type ProcessCollector struct {
	previous map[int32]processSample
	epoch    string
}

func bounded(value string) string {
	if len(value) > 1024 {
		value = value[:1024]
		for !utf8.ValidString(value) {
			value = value[:len(value)-1]
		}
	}
	return strings.ToValidUTF8(value, "�")
}

func (c *ProcessCollector) Collect(ctx context.Context) (Processes, error) {
	result := Processes{ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), CPUScale: "host", MemoryKind: "rss", Items: []Process{}}
	if c.epoch == "" {
		id, err := newIdentity()
		if err != nil {
			return result, err
		}
		c.epoch = id.InstanceID
	}
	observations, count, err := readProcesses(ctx, c.epoch)
	if err != nil {
		return result, err
	}
	result.TotalCount, result.Truncated = count, count > 4096
	next := make(map[int32]processSample, len(observations))
	for _, observation := range observations {
		item := observation.item
		if observation.total != nil {
			total := *observation.total
			if old, ok := c.previous[item.PID]; ok && old.started == observation.started && total >= old.total && observation.at.After(old.at) {
				usage := (total - old.total) / observation.at.Sub(old.at).Seconds() / float64(runtime.NumCPU()) * 100
				if usage > 100 {
					usage = 100
				}
				item.CPUPercent = &usage
			}
			next[item.PID] = processSample{started: observation.started, total: total, at: observation.at}
		}
		result.Items = append(result.Items, item)
	}
	c.previous = next
	return result, nil
}

type processObservation struct {
	item    Process
	started int64
	total   *float64
	at      time.Time
}
