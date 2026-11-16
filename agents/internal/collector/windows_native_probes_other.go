//go:build !windows

package collector

func nativeWindowsCPUPerformancePercent() (float64, bool) {
	return 0, false
}

func nativeWindowsGPUPerformanceRecords() ([]windowsGPUAdapterMemoryRecord, []windowsGPUEngineRecord, bool) {
	return nil, nil, false
}

func nativeWindowsDiskPartitionRows() ([]windowsDiskPartitionRow, bool) {
	return nil, false
}

func nativeWindowsCPUPackagesFallback() (*float64, []cpuPackageStats, bool) {
	return nil, nil, false
}

func nativeWindowsWifiSignals() (map[string]*float64, bool) {
	return nil, false
}
