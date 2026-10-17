//go:build darwin

package live

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
)

// IOKit exposes aggregate GPU activity only. powermetrics is the supported
// macOS source for process GPU time, and is normally available to the root
// LaunchDaemon that runs the machine Agent. A normal user Agent returns null
// when macOS denies this privileged sampler.
type darwinGPUProcessSampler struct{}

func newGPUProcessSampler() gpuProcessSampler {
	return darwinGPUProcessSampler{}
}

func (darwinGPUProcessSampler) sample(ctx context.Context, observations []processObservation) map[processGPUKey]float64 {
	result := make(map[processGPUKey]float64)
	if ctx.Err() != nil {
		return result
	}
	candidates := make(map[int32]processGPUKey, len(observations))
	for _, observation := range observations {
		candidates[observation.item.PID] = processGPUKey{pid: observation.item.PID, started: observation.started}
	}
	command := exec.CommandContext(ctx, "/usr/bin/powermetrics", "--samplers", "tasks", "--show-process-gpu", "-n", "1", "-i", "1000")
	raw, err := command.Output()
	if err != nil {
		return result
	}
	return parsePowermetricsProcessGPU(string(raw), candidates)
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
