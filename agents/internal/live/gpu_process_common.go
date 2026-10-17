package live

import (
	"context"
	"math"
)

// processGPUKey includes the process start time so a recycled PID can never
// inherit a counter from the process that used that PID before it.
type processGPUKey struct {
	pid     int32
	started int64
}

type gpuProcessSampler interface {
	sample(context.Context, []processObservation) map[processGPUKey]float64
}

type unavailableGPUProcessSampler struct{}

func (unavailableGPUProcessSampler) sample(context.Context, []processObservation) map[processGPUKey]float64 {
	return nil
}

func validGPUPercent(value float64) (float64, bool) {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0, false
	}
	if value > 100 {
		value = 100
	}
	return value, true
}
