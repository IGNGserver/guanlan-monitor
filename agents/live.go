package main

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"device-state-console/agent/internal/live"
)

func startLiveClient(ctx context.Context, state *agentState, mu *sync.Mutex, defaults agentRuntimeConfig, directory string) {
	// Configuration checks must not wait for a metric probe, or that probe could
	// block the socket reader's heartbeat. This reader never touches sampling state.
	configState := &agentState{baseIdentity: state.baseIdentity, configPath: state.configPath}
	var configMu sync.Mutex
	config := func() live.Config {
		configMu.Lock()
		defer configMu.Unlock()
		cfg := configState.loadRuntimeConfig(defaults)
		identity := configState.currentIdentity(cfg)
		return live.Config{ServerURL: cfg.Connection.ServerURL, AccessKey: cfg.Connection.Secret, DeviceID: identity.DeviceID, Enabled: cfg.CloudSyncEnabled && cfg.DataRecordingEnabled}
	}
	var processMu sync.Mutex
	processes := &live.ProcessCollector{}
	docker := &live.DockerCollector{}
	client := &live.Client{Directory: filepath.Join(directory, "realtime"), Config: config, Handle: func(ctx context.Context, topic string) (any, error) {
		if !config().Enabled {
			return nil, errors.New("collection_disabled")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		switch topic {
		case "metrics":
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
			return docker.Collect(ctx)
		default:
			return nil, errors.New("collection_failed")
		}
	}}
	go client.Run(ctx)
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
