//go:build darwin

package live

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"device-state-console/agent/internal/macos"
)

// The primary source is the accelerator user clients' cumulative GPU time
// (IOKit AppUsage), the counter Activity Monitor uses: a registry read, no
// subprocess and no privilege. powermetrics remains the fallback for GPUs
// whose driver publishes no AppUsage; it needs the root LaunchDaemon, and a
// normal user Agent returns null when macOS denies that sampler.
type darwinGPUProcessSampler struct {
	previous   map[processGPUKey]uint64
	previousAt time.Time
	readClient func() (map[int32]uint64, bool, error)
}

func newGPUProcessSampler() gpuProcessSampler {
	return &darwinGPUProcessSampler{readClient: macos.ReadGPUClientTime}
}

func (s *darwinGPUProcessSampler) sample(ctx context.Context, observations []processObservation) map[processGPUKey]float64 {
	result := make(map[processGPUKey]float64)
	if ctx.Err() != nil {
		return result
	}
	candidates := make(map[int32]processGPUKey, len(observations))
	for _, observation := range observations {
		candidates[observation.item.PID] = processGPUKey{pid: observation.item.PID, started: observation.started}
	}
	if times, ok, err := s.readClient(); err == nil && ok {
		return s.fromCounters(times, candidates, time.Now())
	}
	s.previous = nil
	command := exec.CommandContext(ctx, "/usr/bin/powermetrics", "--samplers", "tasks", "--show-process-gpu", "-n", "1", "-i", "1000")
	raw, err := command.Output()
	if err != nil {
		return result
	}
	return parsePowermetricsProcessGPU(string(raw), candidates)
}

// fromCounters converts cumulative GPU nanoseconds into percent of wall time
// since the previous sample. A process seen for the first time, or whose
// counter went backwards (client recreated), has no value yet.
func (s *darwinGPUProcessSampler) fromCounters(times map[int32]uint64, candidates map[int32]processGPUKey, now time.Time) map[processGPUKey]float64 {
	result := make(map[processGPUKey]float64)
	next := make(map[processGPUKey]uint64, len(times))
	elapsed := now.Sub(s.previousAt).Nanoseconds()
	for pid, total := range times {
		key, exists := candidates[pid]
		if !exists {
			continue
		}
		next[key] = total
		before, seen := s.previous[key]
		if !seen || s.previousAt.IsZero() || elapsed <= 0 || total < before {
			continue
		}
		if value, valid := validGPUPercent(float64(total-before) / float64(elapsed) * 100); valid {
			result[key] = value
		}
	}
	// Candidates without a GPU client did no GPU work in the window.
	if !s.previousAt.IsZero() && elapsed > 0 {
		for _, key := range candidates {
			if _, exists := next[key]; !exists {
				result[key] = 0
			}
		}
	}
	s.previous, s.previousAt = next, now
	return result
}

func parsePowermetricsProcessGPU(raw string, candidates map[int32]processGPUKey) map[processGPUKey]float64 {
	result := make(map[processGPUKey]float64)
	active := false
	scale := 1.0
	for _, line := range strings.Split(raw, "\n") {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "gpu ms/s") {
			active = true
			scale = 0.1 // GPU milliseconds per second / 10 = percent.
			continue
		}
		if strings.Contains(lower, "gpu %") || strings.Contains(lower, "gpu%") {
			active = true
			scale = 1
			continue
		}
		if !active {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		gpu, err := strconv.ParseFloat(strings.TrimSuffix(fields[len(fields)-1], "%"), 64)
		if err != nil {
			continue
		}
		for index := 1; index < len(fields)-1; index++ {
			pid, parseErr := strconv.ParseInt(fields[index], 10, 32)
			if parseErr != nil {
				continue
			}
			key, exists := candidates[int32(pid)]
			if !exists {
				continue
			}
			if value, valid := validGPUPercent(gpu * scale); valid {
				if previous, exists := result[key]; !exists || value > previous {
					result[key] = value
				}
			}
			break
		}
	}
	return result
}
