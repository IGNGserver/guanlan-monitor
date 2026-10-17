//go:build linux

package live

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ebitengine/purego"
)

// Linux exposes per-client GPU engine time in /proc/<pid>/fdinfo for DRM
// clients. NVIDIA's proprietary driver does not expose all of its process
// engines there, so NVML fills only the PIDs that DRM did not report.
type linuxGPUProcessSampler struct {
	drm  linuxDRMProcessSampler
	nvml *linuxNVMLProcessSampler
}

func newGPUProcessSampler() gpuProcessSampler {
	return &linuxGPUProcessSampler{nvml: newLinuxNVMLProcessSampler()}
}

func (s *linuxGPUProcessSampler) sample(ctx context.Context, observations []processObservation) map[processGPUKey]float64 {
	result := s.drm.sample(ctx, observations)
	if s.nvml == nil || ctx.Err() != nil {
		return result
	}
	candidates := make(map[int32]processGPUKey, len(observations))
	for _, observation := range observations {
		candidates[observation.item.PID] = processGPUKey{pid: observation.item.PID, started: observation.started}
	}
	for key, value := range s.nvml.sample(ctx, candidates) {
		// DRM has a more precise engine-time definition. NVML is a fallback
		// for an otherwise missing process, not a second value to average in.
		if _, exists := result[key]; !exists {
			result[key] = value
		}
	}
	return result
}

type linuxDRMProcessSample struct {
	engines map[string]uint64
	at      time.Time
}

type linuxDRMProcessSampler struct {
	previous map[processGPUKey]linuxDRMProcessSample
}

func (s *linuxDRMProcessSampler) sample(ctx context.Context, observations []processObservation) map[processGPUKey]float64 {
	now := time.Now()
	next := make(map[processGPUKey]linuxDRMProcessSample, len(observations))
	result := make(map[processGPUKey]float64)
	for _, observation := range observations {
		if ctx.Err() != nil {
			break
		}
		engines, ok := readLinuxDRMEngineCounters(ctx, observation.item.PID)
		if !ok {
			continue
		}
		key := processGPUKey{pid: observation.item.PID, started: observation.started}
		current := linuxDRMProcessSample{engines: engines, at: now}
		next[key] = current
		old, exists := s.previous[key]
		if !exists {
			continue
		}
		seconds := now.Sub(old.at).Seconds()
		if seconds <= 0 {
			continue
		}
		var busiest float64
		valid := false
		for engine, value := range engines {
			before, found := old.engines[engine]
			if !found || value < before {
				continue
			}
			percent := float64(value-before) / 1e9 / seconds * 100
			if math.IsNaN(percent) || math.IsInf(percent, 0) || percent < 0 {
				continue
			}
			if percent > busiest {
				busiest = percent
			}
			valid = true
		}
		if valid {
			if busiest > 100 {
				busiest = 100
			}
			result[key] = busiest
		}
	}
	s.previous = next
	return result
}

func readLinuxDRMEngineCounters(ctx context.Context, pid int32) (map[string]uint64, bool) {
	entries, err := os.ReadDir(filepath.Join("/proc", strconv.FormatInt(int64(pid), 10), "fdinfo"))
	if err != nil {
		return nil, false
	}
	result := make(map[string]uint64)
	for _, entry := range entries {
		if ctx.Err() != nil {
			return nil, false
		}
		raw, err := os.ReadFile(filepath.Join("/proc", strconv.FormatInt(int64(pid), 10), "fdinfo", entry.Name()))
		if err != nil {
			continue
		}
		for engine, value := range parseLinuxDRMEngineCounters(string(raw)) {
			if ^uint64(0)-result[engine] < value {
				result[engine] = ^uint64(0)
			} else {
				result[engine] += value
			}
		}
	}
	return result, len(result) > 0
}

func parseLinuxDRMEngineCounters(raw string) map[string]uint64 {
	result := make(map[string]uint64)
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || !strings.HasPrefix(fields[0], "drm-engine-") {
			continue
		}
		name := strings.TrimSuffix(strings.TrimPrefix(fields[0], "drm-engine-"), ":")
		if name == "" {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		if ^uint64(0)-result[name] < value {
			result[name] = ^uint64(0)
		} else {
			result[name] += value
		}
	}
	return result
}

const (
	nvmlSuccess                 = 0
	nvmlErrorAlreadyInitialized = 5
	nvmlErrorInsufficient       = 7
	nvmlInitialUtilization      = 256
	nvmlMaxUtilizationRows      = 4096
)

type nvmlProcessUtilizationSample struct {
	pid       uint32
	_padding  uint32
	timestamp uint64
	smUtil    uint32
	memUtil   uint32
	encUtil   uint32
	decUtil   uint32
}

type linuxNVMLAPI struct {
	init                   func() uint32
	getDeviceCount         func(*uint32) uint32
	getDeviceHandleByIndex func(uint32, *uintptr) uint32
	getProcessUtilization  func(uintptr, *nvmlProcessUtilizationSample, *uint32, uint64) uint32
}

type linuxNVMLProcessSampler struct {
	library  uintptr
	api      linuxNVMLAPI
	lastSeen map[uint32]uint64
}

func newLinuxNVMLProcessSampler() *linuxNVMLProcessSampler {
	paths := []string{
		"libnvidia-ml.so.1",
		"/usr/lib/x86_64-linux-gnu/libnvidia-ml.so.1",
		"/usr/lib/aarch64-linux-gnu/libnvidia-ml.so.1",
	}
	for _, path := range paths {
		library, err := purego.Dlopen(path, purego.RTLD_LAZY|purego.RTLD_LOCAL)
		if err != nil {
			continue
		}
		if !hasLinuxNVMLEntryPoints(library) {
			_ = purego.Dlclose(library)
			continue
		}
		api := linuxNVMLAPI{}
		purego.RegisterLibFunc(&api.init, library, "nvmlInit_v2")
		purego.RegisterLibFunc(&api.getDeviceCount, library, "nvmlDeviceGetCount_v2")
		purego.RegisterLibFunc(&api.getDeviceHandleByIndex, library, "nvmlDeviceGetHandleByIndex_v2")
		purego.RegisterLibFunc(&api.getProcessUtilization, library, "nvmlDeviceGetProcessUtilization")
		status := api.init()
		if status != nvmlSuccess && status != nvmlErrorAlreadyInitialized {
			_ = purego.Dlclose(library)
			continue
		}
		return &linuxNVMLProcessSampler{library: library, api: api, lastSeen: make(map[uint32]uint64)}
	}
	return nil
}

func hasLinuxNVMLEntryPoints(library uintptr) bool {
	for _, name := range []string{"nvmlInit_v2", "nvmlDeviceGetCount_v2", "nvmlDeviceGetHandleByIndex_v2", "nvmlDeviceGetProcessUtilization"} {
		if _, err := purego.Dlsym(library, name); err != nil {
			return false
		}
	}
	return true
}

func (s *linuxNVMLProcessSampler) sample(ctx context.Context, candidates map[int32]processGPUKey) map[processGPUKey]float64 {
	result := make(map[processGPUKey]float64)
	var count uint32
	if s.api.getDeviceCount(&count) != nvmlSuccess {
		return result
	}
	for index := uint32(0); index < count; index++ {
		if ctx.Err() != nil {
			return result
		}
		var device uintptr
		if s.api.getDeviceHandleByIndex(index, &device) != nvmlSuccess {
			continue
		}
		rows, ok := s.deviceRows(device, s.lastSeen[index])
		if !ok {
			continue
		}
		var newest uint64
		for _, row := range rows {
			if row.timestamp > newest {
				newest = row.timestamp
			}
			key, exists := candidates[int32(row.pid)]
			if !exists {
				continue
			}
			value := float64(row.smUtil)
			for _, utilization := range []uint32{row.memUtil, row.encUtil, row.decUtil} {
				if float64(utilization) > value {
					value = float64(utilization)
				}
			}
			if previous, exists := result[key]; !exists || value > previous {
				result[key] = value
			}
		}
		if newest > s.lastSeen[index] {
			s.lastSeen[index] = newest
		}
	}
	return result
}

func (s *linuxNVMLProcessSampler) deviceRows(device uintptr, lastSeen uint64) ([]nvmlProcessUtilizationSample, bool) {
	rows := make([]nvmlProcessUtilizationSample, nvmlInitialUtilization)
	count := uint32(len(rows))
	status := s.api.getProcessUtilization(device, &rows[0], &count, lastSeen)
	if status == nvmlErrorInsufficient && count > uint32(len(rows)) && count <= nvmlMaxUtilizationRows {
		rows = make([]nvmlProcessUtilizationSample, count)
		count = uint32(len(rows))
		status = s.api.getProcessUtilization(device, &rows[0], &count, lastSeen)
	}
	if status != nvmlSuccess || count == 0 {
		return nil, false
	}
	if count > uint32(len(rows)) {
		count = uint32(len(rows))
	}
	return rows[:count], true
}
