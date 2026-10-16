package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"device-state-console/agent/internal/live"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	gnet "github.com/shirou/gopsutil/v4/net"
)

func startLiveClient(ctx context.Context, state *agentState, mu *sync.Mutex, defaults agentRuntimeConfig, directory string) {
	// Configuration checks must not wait for a metric probe, or that probe could
	// block the socket reader's heartbeat. This reader never touches sampling state.
	source := &liveConfigSource{path: state.configPath, defaults: defaults}
	identity := state.baseIdentity
	config := func() live.Config {
		cfg := source.load()
		id := (&agentState{baseIdentity: identity}).currentIdentity(cfg)
		return live.Config{ServerURL: cfg.Connection.ServerURL, AccessKey: cfg.Connection.Secret, DeviceID: id.DeviceID, Enabled: cfg.CloudSyncEnabled && cfg.DataRecordingEnabled}
	}
	client := &live.Client{Directory: filepath.Join(directory, "realtime"), Config: config, Handle: newLiveHandler(state, mu, defaults, source, func() bool { return config().Enabled })}
	go client.Run(ctx)
}

func newLiveHandler(state *agentState, mu *sync.Mutex, defaults agentRuntimeConfig, source *liveConfigSource, enabled func() bool) live.Handler {
	var processMu sync.Mutex
	processes := &live.ProcessCollector{}
	docker := &live.DockerCollector{}
	fast := &liveFastSampler{}
	return func(ctx context.Context, request live.Request) (any, error) {
		if !enabled() {
			return nil, errors.New("collection_disabled")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		switch request.Topic {
		case "metrics":
			if request.HubRevision >= 2 {
				return fast.sample(ctx, source.load()), nil
			}
			// A revision-1 Hub only accepts the full upload payload. Keep serving
			// it until that Hub is upgraded; this path shares the upload sampler.
			mu.Lock()
			defer mu.Unlock()
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			cfg := state.loadRuntimeConfig(defaults)
			if !cfg.CloudSyncEnabled || !cfg.DataRecordingEnabled {
				return nil, errors.New("collection_disabled")
			}
			return freezeMetricsPayload(state.collectPayload(cfg))
		case "processes":
			processMu.Lock()
			defer processMu.Unlock()
			return processes.Collect(ctx)
		case "docker":
			return docker.Collect(ctx, request.HubRevision >= 2)
		default:
			return nil, errors.New("collection_failed")
		}
	}
}

// liveConfigSource re-reads the config file only when it changes and keeps the
// last good configuration while the file is unreadable, empty or half-written:
// a transient read must not look like a Hub/credential change and drop the session.
type liveConfigSource struct {
	mu       sync.Mutex
	path     string
	defaults agentRuntimeConfig
	have     bool
	cfg      agentRuntimeConfig
	modTime  time.Time
	size     int64
	exists   bool
	readAt   time.Time
}

const liveConfigRecheck = 30 * time.Second

func (s *liveConfigSource) load() agentRuntimeConfig {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.path == "" {
		return s.defaults
	}
	now := time.Now()
	info, err := os.Stat(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			s.have, s.exists, s.cfg = true, false, s.defaults
			return s.cfg
		}
		return s.fallback()
	}
	if s.have && s.exists && info.ModTime().Equal(s.modTime) && info.Size() == s.size && now.Sub(s.readAt) < liveConfigRecheck {
		return s.cfg
	}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return s.fallback()
	}
	raw = trimUTF8BOM(raw)
	if len(bytes.TrimSpace(raw)) == 0 {
		return s.fallback()
	}
	var fileCfg agentConfigFile
	if json.Unmarshal(raw, &fileCfg) != nil {
		return s.fallback()
	}
	s.cfg = mergeConfig(s.defaults, fileCfg)
	s.have, s.exists, s.modTime, s.size, s.readAt = true, true, info.ModTime(), info.Size(), now
	return s.cfg
}

func (s *liveConfigSource) fallback() agentRuntimeConfig {
	if s.have {
		return s.cfg
	}
	return s.defaults
}

// liveMetrics is the revision-2 live payload: only values the live panel shows,
// each null until its own sampling window exists.
type liveMetrics struct {
	ObservedAt           string   `json:"observedAt"`
	CPUPercent           *float64 `json:"cpuPercent"`
	MemoryUsedBytes      *uint64  `json:"memoryUsedBytes"`
	MemoryTotalBytes     *uint64  `json:"memoryTotalBytes"`
	DiskReadBytesPerSec  *float64 `json:"diskReadBytesPerSec"`
	DiskWriteBytesPerSec *float64 `json:"diskWriteBytesPerSec"`
	NetworkRxBytesPerSec *float64 `json:"networkRxBytesPerSec"`
	NetworkTxBytesPerSec *float64 `json:"networkTxBytesPerSec"`
}

// liveFastSampler owns its own CPU and IO baselines. Sharing the upload
// sampler's baselines would shrink the uploaded averaging window to the time
// since the last live query, changing history whenever someone watches.
type liveFastSampler struct {
	mu       sync.Mutex
	lastCPU  *cpuSnapshot
	lastDisk *ioSnapshot
	lastNet  *ioSnapshot
}

func (l *liveFastSampler) sample(ctx context.Context, cfg agentRuntimeConfig) liveMetrics {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now().UTC()
	result := liveMetrics{ObservedAt: now.Format(time.RFC3339Nano)}
	enabled := makeEnabledMetricSet(cfg.EnabledMetrics)

	cpuCtx, cancel := context.WithTimeout(ctx, cpuPackagesTimeout)
	times, err := cpu.TimesWithContext(cpuCtx, false)
	cancel()
	if err == nil && len(times) > 0 {
		current := cpuSnapshotFromTimes(times[0])
		if l.lastCPU != nil {
			if usage, ok := cpuUsagePercentBetween(*l.lastCPU, current); ok && enabled["cpuUsage"] {
				result.CPUPercent = &usage
			}
		}
		l.lastCPU = &current
	}

	if memory := sampleMemory(); memory.TotalBytes > 0 && enabled["memoryUsage"] {
		used, total := memory.UsedBytes, memory.TotalBytes
		result.MemoryUsedBytes, result.MemoryTotalBytes = &used, &total
	}

	diskCounters, diskErr := disk.IOCountersWithContext(ctx)
	netCounters, netErr := gnet.IOCountersWithContext(ctx, true)
	current := snapshotIO(diskCounters, netCounters, now)
	if diskErr == nil && len(diskCounters) > 0 {
		if l.lastDisk != nil && (runtime.GOOS != "darwin" || darwinDiskCounterWindowReady(l.lastDisk, current)) {
			rate, _ := computeRates(l.lastDisk, current, 1)
			if enabled["diskRead"] {
				result.DiskReadBytesPerSec = &rate.ReadBytesPerSec
			}
			if enabled["diskWrite"] {
				result.DiskWriteBytesPerSec = &rate.WriteBytesPerSec
			}
		}
		l.lastDisk = current
	}
	if netErr == nil && len(netCounters) > 0 {
		if l.lastNet != nil && (runtime.GOOS != "darwin" || darwinNetworkCounterWindowReady(l.lastNet, current)) {
			_, rate := computeRates(l.lastNet, current, 1)
			if enabled["networkRxRate"] {
				result.NetworkRxBytesPerSec = &rate.RxBytesPerSec
			}
			if enabled["networkTxRate"] {
				result.NetworkTxBytesPerSec = &rate.TxBytesPerSec
			}
		}
		l.lastNet = current
	}
	return result
}

// Both the HTTP uploader and the live writer outlive the state lock. Never hand
// either writer slices/maps that a subsequent fast sample can mutate.
func freezeMetricsPayload(payload metricsPayload) (metricsPayload, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return metricsPayload{}, err
	}
	var snapshot metricsPayload
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return metricsPayload{}, err
	}
	return snapshot, nil
}

// The production collector's slow probes run independently. Tests and one-shot
// callers retain the existing synchronous collection path unless explicitly enabled.
func (s *agentState) refreshSlowAsync(cfg agentRuntimeConfig, plan collectionPlan, now time.Time) {
	if s.slowResults == nil {
		s.slowResults = make(chan slowCollectionOutcome, 1)
	}
	select {
	case outcome := <-s.slowResults:
		s.slowPending = false
		s.assets = outcome.assets
		s.slowStats.runs++
		if outcome.overtime {
			s.slowStats.overruns++
		}
		s.slowStats.lastMillis = outcome.duration.Milliseconds()
		if !s.hasSlow {
			s.lastSlow = outcome.metrics
			s.hasSlow = true
		} else {
			s.lastSlow = mergeSlowMetrics(s.lastSlow, outcome.metrics)
		}
		if outcome.system != nil {
			s.lastSystem = *outcome.system
			s.lastSystemAt = now
		}
	default:
	}
	if s.slowPending || now.Before(s.nextSlowAt) {
		return
	}
	s.slowPending = true
	s.nextSlowAt = now.Add(time.Duration(cfg.slowIntervalSeconds()) * time.Second)
	assets := s.assets
	results := s.slowResults
	collector := s.slowCollector
	if collector == nil {
		collector = collectSlowBackground
	}
	go func() {
		results <- collector(assets, plan)
	}()
}

func collectSlowBackground(assets hardwareAssetCache, plan collectionPlan) (outcome slowCollectionOutcome) {
	started := time.Now()
	outcome.assets = assets
	outcome.metrics = emptySlowMetrics()
	defer func() {
		if recover() != nil {
			outcome.metrics = emptySlowMetrics()
		}
		outcome.duration = time.Since(started)
		outcome.overtime = outcome.duration > slowMetricsGlobalBudget
	}()
	// Do not abandon and stack workers when a provider ignores its timeout. One
	// stuck slow worker can delay slow metrics, but cannot block fast sampling.
	outcome.metrics, outcome.assets = collectSlowMetrics(assets, plan)
	if plan.systemStats && runtime.GOOS != "windows" {
		stats := systemStatsCollector()
		outcome.system = &stats
	}
	return outcome
}
