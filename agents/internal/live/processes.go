package live

import (
	"context"
	"runtime"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	// Reading is bounded separately from what is returned: the busiest
	// processes must survive truncation, so they are chosen after sampling.
	processReadLimit   = 16384
	processReturnLimit = 4096
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
	result.TotalCount = count
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
	rankProcesses(result.Items)
	// Exited or protected processes also make count exceed the item list; only
	// the limits themselves count as truncation.
	result.Truncated = count > processReadLimit || len(result.Items) > processReturnLimit
	if len(result.Items) > processReturnLimit {
		result.Items = result.Items[:processReturnLimit]
	}
	return result, nil
}

// rankProcesses orders by CPU, then resident memory, then PID. Unknown values
// sort after every known value instead of being treated as zero.
func rankProcesses(items []Process) {
	sort.SliceStable(items, func(i, j int) bool {
		left, right := items[i], items[j]
		if (left.CPUPercent == nil) != (right.CPUPercent == nil) {
			return left.CPUPercent != nil
		}
		if left.CPUPercent != nil && *left.CPUPercent != *right.CPUPercent {
			return *left.CPUPercent > *right.CPUPercent
		}
		if (left.MemoryBytes == nil) != (right.MemoryBytes == nil) {
			return left.MemoryBytes != nil
		}
		if left.MemoryBytes != nil && *left.MemoryBytes != *right.MemoryBytes {
			return *left.MemoryBytes > *right.MemoryBytes
		}
		return left.PID < right.PID
	})
}

type processObservation struct {
	item    Process
	started int64
	total   *float64
	at      time.Time
}
