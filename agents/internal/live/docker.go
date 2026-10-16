package live

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type Container struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Image            string   `json:"image"`
	State            string   `json:"state"`
	Status           string   `json:"status"`
	Project          *string  `json:"project"`
	CPUPercent       *float64 `json:"cpuPercent"`
	MemoryBytes      *uint64  `json:"memoryBytes"`
	MemoryLimitBytes *uint64  `json:"memoryLimitBytes"`
	NetworkRxBytes   *uint64  `json:"networkRxBytes"`
	NetworkTxBytes   *uint64  `json:"networkTxBytes"`
	BlockReadBytes   *uint64  `json:"blockReadBytes"`
	BlockWriteBytes  *uint64  `json:"blockWriteBytes"`
}

type Docker struct {
	ObservedAt string      `json:"observedAt"`
	EngineID   string      `json:"engineId"`
	TotalCount int         `json:"totalCount"`
	Truncated  bool        `json:"truncated"`
	Items      []Container `json:"items"`
	// Hub revision 2+: how many running containers wanted stats and how many
	// were actually read, so missing values are explained instead of guessed.
	StatsCandidates *int `json:"statsCandidates,omitempty"`
	StatsRead       *int `json:"statsRead,omitempty"`
}

const (
	dockerStatsLimit = 32
	// Slots reserved for containers not sampled recently, so a host with more
	// running containers than the limit rotates instead of starving the tail.
	dockerStatsRotation = 8
)

type dockerRow struct {
	ID     string `json:"Id"`
	Names  []string
	Image  string
	State  string
	Status string
	Labels map[string]string
}
type dockerCPU struct {
	CPUUsage struct {
		TotalUsage  uint64   `json:"total_usage"`
		PerCPUUsage []uint64 `json:"percpu_usage"`
	} `json:"cpu_usage"`
	SystemCPUUsage uint64 `json:"system_cpu_usage"`
	OnlineCPUs     uint64 `json:"online_cpus"`
}
type dockerStats struct {
	CPU         dockerCPU `json:"cpu_stats"`
	PreviousCPU dockerCPU `json:"precpu_stats"`
	Memory      struct {
		Usage uint64
		Limit uint64
		Stats map[string]uint64
	} `json:"memory_stats"`
	Networks map[string]struct {
		Rx uint64 `json:"rx_bytes"`
		Tx uint64 `json:"tx_bytes"`
	}
	Block struct {
		Entries []struct {
			Op    string
			Value uint64
		} `json:"io_service_bytes_recursive"`
	} `json:"blkio_stats"`
}

var containerID = regexp.MustCompile(`^[a-f0-9]{12,64}$`)

// One owner per live topic; keys include the Engine identity, not container names.
type DockerCollector struct {
	previous  map[string]dockerCPU
	percent   map[string]float64
	sampledAt map[string]time.Time
}

// Only fixed GET endpoints on a local engine. Never expose an arbitrary Docker API proxy.
func dockerGet(ctx context.Context, client *http.Client, endpoint string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+endpoint, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(req)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return errors.New("docker_permission_denied")
		}
		return errors.New("docker_unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode == 401 || response.StatusCode == 403 {
		return errors.New("docker_permission_denied")
	}
	if response.StatusCode != http.StatusOK {
		return errors.New("docker_unavailable")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	if err != nil || len(raw) > 4*1024*1024 {
		return errors.New("docker_unavailable")
	}
	if json.Unmarshal(raw, target) != nil {
		return errors.New("docker_unavailable")
	}
	return nil
}

func (c *DockerCollector) Collect(ctx context.Context, extended bool) (Docker, error) {
	transport, err := dockerTransport()
	if err != nil {
		return Docker{}, err
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	return c.collect(ctx, client, extended)
}

func collectDocker(ctx context.Context, client *http.Client) (Docker, error) {
	return (&DockerCollector{}).collect(ctx, client, false)
}

func (c *DockerCollector) collect(ctx context.Context, client *http.Client, extended bool) (Docker, error) {
	var info struct{ ID string }
	if err := dockerGet(ctx, client, "/info", &info); err != nil {
		return Docker{}, err
	}
	if info.ID == "" {
		return Docker{}, errors.New("docker_unavailable")
	}
	var rows []dockerRow
	if err := dockerGet(ctx, client, "/containers/json?all=1", &rows); err != nil {
		return Docker{}, err
	}
	if rows == nil {
		return Docker{}, errors.New("docker_unavailable")
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
	result := Docker{ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), EngineID: bounded(info.ID), TotalCount: len(rows), Truncated: len(rows) > 512, Items: []Container{}}
	if len(rows) > 512 {
		rows = rows[:512]
	}
	var running []int
	for _, row := range rows {
		if !containerID.MatchString(row.ID) {
			return Docker{}, errors.New("docker_unavailable")
		}
		name := row.ID[:12]
		if len(row.Names) > 0 {
			name = strings.TrimPrefix(row.Names[0], "/")
		}
		item := Container{ID: row.ID, Name: bounded(name), Image: bounded(row.Image), State: bounded(row.State), Status: bounded(row.Status)}
		if project := row.Labels["com.docker.compose.project"]; project != "" {
			value := bounded(project)
			item.Project = &value
		}
		result.Items = append(result.Items, item)
		if row.State == "running" {
			running = append(running, len(result.Items)-1)
		}
	}
	// Bound expensive stats calls independently of list size; unavailable fields stay null.
	jobs := c.statsJobs(info.ID, result.Items, running)
	statsCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	queue := make(chan int, len(jobs))
	for _, index := range jobs {
		queue <- index
	}
	close(queue)
	var workers sync.WaitGroup
	var samplesMu sync.Mutex
	next := make(map[string]dockerCPU)
	percent := make(map[string]float64)
	read := 0
	for worker := 0; worker < 4; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range queue {
				if statsCtx.Err() != nil {
					return
				}
				var stats dockerStats
				if dockerGet(statsCtx, client, fmt.Sprintf("/containers/%s/stats?stream=false&one-shot=true", result.Items[index].ID), &stats) != nil {
					continue
				}
				key := info.ID + ":" + result.Items[index].ID
				if stats.PreviousCPU.SystemCPUUsage == 0 {
					stats.PreviousCPU = c.previous[key]
				}
				applyDockerStats(&result.Items[index], stats)
				samplesMu.Lock()
				next[key] = stats.CPU
				read++
				if result.Items[index].CPUPercent != nil {
					percent[key] = *result.Items[index].CPUPercent
				}
				samplesMu.Unlock()
			}
		}()
	}
	workers.Wait()
	if ctx.Err() != nil {
		return Docker{}, ctx.Err()
	}
	c.previous = next
	if c.sampledAt == nil {
		c.sampledAt = make(map[string]time.Time)
	}
	now := time.Now()
	live := make(map[string]time.Time, len(running))
	for _, index := range running {
		key := info.ID + ":" + result.Items[index].ID
		if at, ok := c.sampledAt[key]; ok {
			live[key] = at
		}
	}
	for key := range next {
		live[key] = now
	}
	c.sampledAt = live
	c.percent = percent
	if extended {
		candidates := len(running)
		result.StatsCandidates = &candidates
		result.StatsRead = &read
	}
	return result, nil
}

// statsJobs picks which running containers get a stats call: the busiest by
// last observed CPU first, plus rotation slots for the least recently sampled.
func (c *DockerCollector) statsJobs(engine string, items []Container, running []int) []int {
	if len(running) <= dockerStatsLimit {
		return running
	}
	key := func(index int) string { return engine + ":" + items[index].ID }
	busiest := append([]int(nil), running...)
	sort.SliceStable(busiest, func(i, j int) bool {
		left, leftOK := c.percent[key(busiest[i])]
		right, rightOK := c.percent[key(busiest[j])]
		if leftOK != rightOK {
			return leftOK
		}
		return left > right
	})
	chosen := make(map[int]bool, dockerStatsLimit)
	var jobs []int
	for _, index := range busiest {
		if len(jobs) >= dockerStatsLimit-dockerStatsRotation {
			break
		}
		if _, known := c.percent[key(index)]; !known {
			break
		}
		chosen[index] = true
		jobs = append(jobs, index)
	}
	stale := append([]int(nil), running...)
	sort.SliceStable(stale, func(i, j int) bool {
		left, right := c.sampledAt[key(stale[i])], c.sampledAt[key(stale[j])]
		return left.Before(right)
	})
	for _, index := range stale {
		if len(jobs) >= dockerStatsLimit {
			break
		}
		if !chosen[index] {
			chosen[index] = true
			jobs = append(jobs, index)
		}
	}
	return jobs
}

func applyDockerStats(item *Container, stats dockerStats) {
	if stats.PreviousCPU.SystemCPUUsage > 0 && stats.CPU.SystemCPUUsage > stats.PreviousCPU.SystemCPUUsage && stats.CPU.CPUUsage.TotalUsage >= stats.PreviousCPU.CPUUsage.TotalUsage {
		cpus := stats.CPU.OnlineCPUs
		if cpus == 0 {
			cpus = uint64(len(stats.CPU.CPUUsage.PerCPUUsage))
		}
		if cpus > 0 {
			usage := float64(stats.CPU.CPUUsage.TotalUsage-stats.PreviousCPU.CPUUsage.TotalUsage) / float64(stats.CPU.SystemCPUUsage-stats.PreviousCPU.SystemCPUUsage) * float64(cpus) * 100
			item.CPUPercent = &usage
		}
	}
	if stats.Memory.Limit > 0 {
		usage := dockerMemoryUsage(stats.Memory.Usage, stats.Memory.Stats)
		limit := stats.Memory.Limit
		item.MemoryBytes = &usage
		item.MemoryLimitBytes = &limit
	}
	if stats.Networks != nil {
		var rx, tx uint64
		for _, network := range stats.Networks {
			rx += network.Rx
			tx += network.Tx
		}
		item.NetworkRxBytes = &rx
		item.NetworkTxBytes = &tx
	}
	if stats.Block.Entries != nil {
		var read, write uint64
		for _, entry := range stats.Block.Entries {
			if strings.EqualFold(entry.Op, "read") {
				read += entry.Value
			}
			if strings.EqualFold(entry.Op, "write") {
				write += entry.Value
			}
		}
		item.BlockReadBytes = &read
		item.BlockWriteBytes = &write
	}
}

// dockerMemoryUsage matches `docker stats`: reclaimable inactive file cache is
// not reported as container memory (cgroup v1 total_inactive_file, v2 inactive_file).
func dockerMemoryUsage(usage uint64, stats map[string]uint64) uint64 {
	if value, ok := stats["total_inactive_file"]; ok && value < usage {
		return usage - value
	}
	if value, ok := stats["inactive_file"]; ok && value < usage {
		return usage - value
	}
	return usage
}
