//go:build !darwin && !linux && !windows

package live

func newGPUProcessSampler() gpuProcessSampler {
	return unavailableGPUProcessSampler{}
}
