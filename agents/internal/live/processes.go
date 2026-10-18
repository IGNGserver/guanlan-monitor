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
	GPUPercent  *float64 `json:"gpuPercent"`
	MemoryBytes *uint64  `json:"memoryBytes"`
	Threads     *int32   `json:"threads"`
	Status      *string  `json:"status"`
	// Revision 4: storage bytes per second from the kernel's per-process disk
	// counters (Linux read_bytes/write_bytes, Darwin rusage diskio). Null where
	// the platform has no disk-only counter or on the first sample.
	DiskReadBytesPerSec  *float64 `json:"diskReadBytesPerSec"`
	DiskWriteBytesPerSec *float64 `json:"diskWriteBytesPerSec"`
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
	// Cumulative disk bytes; nil when the platform could not read them.
	read, write *uint64
}

// One owner per Agent installation/topic. No samples cross installation restarts.
type ProcessCollector struct {
	previous map[int32]processSample
	epoch    string
	gpu      gpuProcessSampler
	// The first GPU query establishes a provider-specific baseline. Keep its
	// values null even when a provider (for example NVML or powermetrics) can
	// return a value immediately, so every platform has the same first-sample
	// contract as CPU and counter-based providers.
	gpuSampled bool
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
	return c.collect(ctx, true)
}

// CollectForRevision keeps the process result compatible with older Hubs. Hub
// revision 4 understands per-process disk rates, revision 3 gpuPercent;
// revisions 1 and 2 use the original process item shape. Every older shape
// rejects unknown fields.
func (c *ProcessCollector) CollectForRevision(ctx context.Context, hubRevision int) (any, error) {
	result, err := c.collect(ctx, hubRevision >= 3)
	switch {
	case err != nil || hubRevision >= 4:
		return result, err
	case hubRevision == 3:
		return result.withoutDisk(), nil
	}
	return result.withoutGPU(), nil
}

func (c *ProcessCollector) collect(ctx context.Context, includeGPU bool) (Processes, error) {
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
			old, ok := c.previous[item.PID]
			same := ok && old.started == observation.started && observation.at.After(old.at)
			if same && total >= old.total {
				usage := (total - old.total) / observation.at.Sub(old.at).Seconds() / float64(runtime.NumCPU()) * 100
				if usage > 100 {
					usage = 100
				}
				item.CPUPercent = &usage
			}
			if same {
				seconds := observation.at.Sub(old.at).Seconds()
				item.DiskReadBytesPerSec = counterRate(old.read, observation.diskRead, seconds)
				item.DiskWriteBytesPerSec = counterRate(old.write, observation.diskWrite, seconds)
			}
			next[item.PID] = processSample{started: observation.started, total: total, at: observation.at, read: observation.diskRead, write: observation.diskWrite}
		}
		result.Items = append(result.Items, item)
	}
	c.previous = next
	if includeGPU {
		if c.gpu == nil {
			c.gpu = newGPUProcessSampler()
		}
		usage := c.gpu.sample(ctx, observations)
		if c.gpuSampled {
			for index, observation := range observations {
				value, ok := usage[processGPUKey{pid: observation.item.PID, started: observation.started}]
				if !ok {
					continue
				}
				value, ok = validGPUPercent(value)
				if ok {
					result.Items[index].GPUPercent = &value
				}
			}
		}
		c.gpuSampled = true
	}
	rankProcesses(result.Items)
	// Exited or protected processes also make count exceed the item list; only
	// the limits themselves count as truncation.
	result.Truncated = count > processReadLimit || len(result.Items) > processReturnLimit
	if len(result.Items) > processReturnLimit {
		result.Items = result.Items[:processReturnLimit]
	}
	return result, nil
}

type legacyProcess struct {
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

type legacyProcesses struct {
	ObservedAt string          `json:"observedAt"`
	CPUScale   string          `json:"cpuScale"`
	MemoryKind string          `json:"memoryKind"`
	TotalCount int             `json:"totalCount"`
	Truncated  bool            `json:"truncated"`
	Items      []legacyProcess `json:"items"`
}

func (p Processes) withoutGPU() legacyProcesses {
	items := make([]legacyProcess, 0, len(p.Items))
	for _, item := range p.Items {
		items = append(items, legacyProcess{
			ID: item.ID, PID: item.PID, ParentPID: item.ParentPID, Name: item.Name,
			StartedAt: item.StartedAt, CPUPercent: item.CPUPercent, MemoryBytes: item.MemoryBytes,
			Threads: item.Threads, Status: item.Status,
		})
	}
	return legacyProcesses{ObservedAt: p.ObservedAt, CPUScale: p.CPUScale, MemoryKind: p.MemoryKind, TotalCount: p.TotalCount, Truncated: p.Truncated, Items: items}
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
	// Cumulative storage bytes read/written, nil when unreadable.
	diskRead, diskWrite *uint64
}

// counterRate is a per-second rate between two cumulative readings. A missing
// reading or a counter that went backwards yields null, never a zero.
func counterRate(previous, current *uint64, seconds float64) *float64 {
	if previous == nil || current == nil || *current < *previous || seconds <= 0 {
		return nil
	}
	rate := float64(*current-*previous) / seconds
	return &rate
}

type rev3Process struct {
	ID          string   `json:"id"`
	PID         int32    `json:"pid"`
	ParentPID   *int32   `json:"parentPid"`
	Name        string   `json:"name"`
	StartedAt   *string  `json:"startedAt"`
	CPUPercent  *float64 `json:"cpuPercent"`
	GPUPercent  *float64 `json:"gpuPercent"`
	MemoryBytes *uint64  `json:"memoryBytes"`
	Threads     *int32   `json:"threads"`
	Status      *string  `json:"status"`
}

type rev3Processes struct {
	ObservedAt string        `json:"observedAt"`
	CPUScale   string        `json:"cpuScale"`
	MemoryKind string        `json:"memoryKind"`
	TotalCount int           `json:"totalCount"`
	Truncated  bool          `json:"truncated"`
	Items      []rev3Process `json:"items"`
}

func (p Processes) withoutDisk() rev3Processes {
	items := make([]rev3Process, 0, len(p.Items))
	for _, item := range p.Items {
		items = append(items, rev3Process{
			ID: item.ID, PID: item.PID, ParentPID: item.ParentPID, Name: item.Name, StartedAt: item.StartedAt,
			CPUPercent: item.CPUPercent, GPUPercent: item.GPUPercent, MemoryBytes: item.MemoryBytes, Threads: item.Threads, Status: item.Status,
		})
	}
	return rev3Processes{ObservedAt: p.ObservedAt, CPUScale: p.CPUScale, MemoryKind: p.MemoryKind, TotalCount: p.TotalCount, Truncated: p.Truncated, Items: items}
}
