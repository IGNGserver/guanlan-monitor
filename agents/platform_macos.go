package main

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"device-state-console/agent/internal/macos"
	"github.com/shirou/gopsutil/v4/disk"
)

type metricQuality struct {
	State      string `json:"state"`
	Source     string `json:"source,omitempty"`
	Reason     string `json:"reason,omitempty"`
	ObservedAt string `json:"observedAt,omitempty"`
}

func collectDarwinHardwareSensors() hardwareSensorMetrics {
	result := hardwareSensorMetrics{gpus: []gpuDeviceStats{}, fans: []fanSensorStats{}, diskSensorMetadata: map[string]diskSensorMetadata{}}
	readings, err := macos.ReadHardware()
	if err != nil {
		result.sensorBackends = []sensorBackendStatus{{ID: "darwin-native", Label: "Darwin native bridge", Detail: err.Error()}}
		return result
	}
	result.sensorBackends = []sensorBackendStatus{
		{ID: "darwin-smc", Label: "AppleSMC (只读)", OK: readings.SMCError == "", Detail: readings.SMCError},
		{ID: "darwin-iokit", Label: "IOKit GPU", OK: readings.GPUError == "", Detail: readings.GPUError},
		{ID: "darwin-ioreport", Label: "IOReport CPU frequency", OK: false, Detail: "无明确频率标签或等待首个采样窗口"},
	}
	result.cpuFrequencyMHz = macos.Frequency(readings.CPUChannels)
	if result.cpuFrequencyMHz != nil {
		result.sensorBackends[2].OK = true
		result.sensorBackends[2].Detail = "活动驻留时间加权频率（非标称频率）"
	}
	if readings.FrequencyError != "" {
		result.sensorBackends[2].Detail = readings.FrequencyError
	}
	for _, entry := range readings.GPUs {
		gpu := gpuDeviceStats{ID: entry.ID, Name: entry.Name, MemoryKind: entry.MemoryKind, Integrated: entry.MemoryKind == "shared" || entry.MemoryKind == "unified", FrequencyMHz: entry.Frequency, TemperatureC: entry.Temperature, TemperatureSource: "IOKit", DriverVersion: entry.Driver}
		if entry.Usage != nil {
			gpu.UtilizationPercent = *entry.Usage
			gpu.utilizationObserved = true
		}
		if entry.MemoryUsed != nil {
			gpu.MemoryUsedBytes = *entry.MemoryUsed
			gpu.memoryObserved = true
		}
		if entry.MemoryTotal != nil {
			gpu.MemoryTotalBytes = *entry.MemoryTotal
			gpu.memoryObserved = true
		}
		result.gpus = append(result.gpus, gpu)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	var cpuZones []float64
	for _, entry := range readings.SMC {
		value, decodeErr := macos.DecodeSMC(entry.Type, entry.Data)
		if decodeErr != nil {
			continue
		}
		if strings.HasPrefix(entry.Key, "T") {
			if *value <= 0 || *value >= 125 {
				continue
			}
			role, confidence := "unknown", "unmapped"
			// TCAD is a documented package key. CPU diode/proximity and Apple
			// thermal-zone keys are retained without pretending to be core IDs.
			if entry.Key == "TCAD" {
				role = "cpu_package"
				confidence = "direct"
				result.cpuTemperatureC = value
				result.cpuTemperatureSampledAt = now
			}
			if readings.AppleSilicon && (strings.HasPrefix(entry.Key, "Tp") || strings.HasPrefix(entry.Key, "Te") || strings.HasPrefix(entry.Key, "Tf0") || strings.HasPrefix(entry.Key, "Tf4")) {
				cpuZones = append(cpuZones, *value)
			}
			result.temperatureSensors = append(result.temperatureSensors, temperatureSensorReading{ID: "smc-" + entry.Key, Source: "AppleSMC", Backend: "darwin-smc", RawName: entry.Key, DisplayName: "SMC " + entry.Key, Role: role, Confidence: confidence, Status: "valid", CurrentC: value, ObservedAt: now, Note: "只读 SMC；未映射键不作逐核或封装温度"})
		}
		if len(entry.Key) == 4 && entry.Key[0] == 'F' && entry.Key[2:] == "Ac" && *value >= 0 && *value <= 30000 {
			result.fans = append(result.fans, fanSensorStats{ID: "smc-" + entry.Key[:2], Label: "SMC " + entry.Key[:2], Interface: "AppleSMC", RPM: int(*value), RPMStatus: "valid", ChannelState: "observed"})
		}
	}
	if result.cpuTemperatureC == nil && len(cpuZones) > 0 {
		result.cpuTemperatureC = averagePointer(cpuZones)
		result.cpuTemperatureSource = "AppleSMC CPU thermal zones (derived mean)"
		result.cpuTemperatureSampledAt = now
	}
	for index := range result.fans {
		for _, entry := range readings.SMC {
			if "smc-"+entry.Key[:min(2, len(entry.Key))] != result.fans[index].ID || !strings.HasSuffix(entry.Key, "Md") {
				continue
			}
			value, err := macos.DecodeSMC(entry.Type, entry.Data)
			if err == nil && *value == 0 {
				result.fans[index].ControlMode = "automatic"
			} else if err == nil && *value == 1 {
				result.fans[index].ControlMode = "manual"
			}
		}
	}
	return result
}

var darwinDiskIdentifier = regexp.MustCompile(`^disk[0-9]+(s[0-9]+)*$`)
var regexpDarwinWholeDisk = regexp.MustCompile(`^disk[0-9]+`)

func collectDarwinDisks(cached map[string]*float64) ([]diskDeviceStats, storageUsage, map[string]*float64, error) {
	containers, err := macos.ReadAPFS()
	if err != nil {
		return nil, storageUsage{}, cached, fmt.Errorf("APFS container inventory: %w", err)
	}
	result := []diskDeviceStats{}
	aggregate := storageUsage{}
	for _, container := range containers {
		id, name, mount := macos.APFSIdentity(container)
		if mount == "" || container.CapacityCeiling == 0 {
			continue
		}
		physical := ""
		if len(container.PhysicalStores) == 1 {
			identifier := container.PhysicalStores[0].DeviceIdentifier
			if darwinDiskIdentifier.MatchString(identifier) {
				physical = "/dev/" + identifier
			}
		}
		// A physical store can be a partition. IO counters are whole disks;
		// never choose a single disk for a multi-store (Fusion) container.
		source := physical
		if physical != "" {
			source = "/dev/" + regexpDarwinWholeDisk.FindString(filepath.Base(physical))
		}
		used := container.CapacityCeiling - container.CapacityFree
		result = append(result, diskDeviceStats{ID: id, Name: name, MountPoint: mount, FileSystem: "apfs", SourceKey: source, PhysicalDevice: physical, TotalBytes: container.CapacityCeiling, UsedBytes: used})
		aggregate.TotalBytes += container.CapacityCeiling
		aggregate.UsedBytes += used
	}
	partitions, partitionErr := disk.Partitions(false)
	if partitionErr != nil {
		return nil, storageUsage{}, cached, partitionErr
	}
	seen := map[string]bool{}
	for _, partition := range partitions {
		if partition.Fstype == "apfs" || !strings.HasPrefix(partition.Device, "/dev/disk") || seen[partition.Device] || strings.HasPrefix(partition.Mountpoint, "/System/") {
			continue
		}
		usage, usageErr := diskUsageWithTimeout(partition.Mountpoint, diskUsageTimeout)
		if usageErr != nil || usage.Total == 0 {
			continue
		}
		seen[partition.Device] = true
		result = append(result, diskDeviceStats{ID: partition.Device, Name: partition.Device, MountPoint: partition.Mountpoint, FileSystem: partition.Fstype, SourceKey: partition.Device, PhysicalDevice: partition.Device, TotalBytes: usage.Total, UsedBytes: usage.Used})
		aggregate.TotalBytes += usage.Total
		aggregate.UsedBytes += usage.Used
	}
	return result, aggregate, cached, nil
}

func collectDarwinDiskSensors(disks []diskDeviceStats) map[string]diskSensorMetadata {
	result := map[string]diskSensorMetadata{}
	command := resolveSmartctlPath()
	if command == "" {
		return result
	}
	for _, entry := range disks {
		if entry.SourceKey == "" {
			continue
		}
		if _, exists := result[entry.SourceKey]; exists {
			continue
		}
		if sensor, ok := collectSmartctlDiskSensor(command, entry.SourceKey); ok {
			result[entry.SourceKey] = sensor
		}
	}
	return result
}

func applyDarwinMetricQuality(payload *metricsPayload, maxHardwareAge time.Duration) {
	quality := map[string]metricQuality{}
	set := func(key string, available bool, source string) {
		state := "unavailable"
		if available {
			state = "direct"
		}
		quality[key] = metricQuality{State: state, Source: source, ObservedAt: payload.Timestamp}
	}
	set("cpuUsage", true, "Mach CPU times")
	set("cpuFrequency", payload.CPUFrequencyMHz != nil, "IOReport active-residency weighted")
	if payload.CPUFrequencyMHz != nil {
		q := quality["cpuFrequency"]
		q.State = "derived"
		quality["cpuFrequency"] = q
	}
	set("cpuTemperature", payload.CPUTemperatureC != nil, "AppleSMC TCAD")
	if payload.CPUTemperatureC != nil {
		direct := false
		for _, sensor := range payload.TemperatureSensors {
			if sensor.RawName == "TCAD" && sensor.CurrentC != nil {
				direct = true
			}
		}
		if !direct {
			q := quality["cpuTemperature"]
			q.State = "derived"
			q.Source = "AppleSMC CPU thermal zones mean"
			q.Reason = "aggregate zones, not a physical per-core/package sensor"
			quality["cpuTemperature"] = q
		}
	}
	set("cpuTopology", len(payload.CPUPackages) > 0, "sysctl")
	set("systemOverview", payload.System.ProcessCount > 0, "accessible process enumeration")
	set("memoryUsage", payload.Memory.TotalBytes > 0, "Mach VM statistics64")
	set("swapUsage", payload.Memory.TotalBytes > 0, "sysctl vm.swapusage")
	set("memoryCached", payload.Memory.TotalBytes > 0, "external + purgeable physical pages")
	set("memoryAvailable", payload.Memory.TotalBytes > 0, "total - application - wired - compressor physical bytes")
	if payload.Memory.TotalBytes > 0 {
		q := quality["memoryAvailable"]
		q.State = "derived"
		q.Reason = "reclaimable estimate, not Linux MemAvailable"
		quality["memoryAvailable"] = q
	}
	quality["memoryCommitted"] = metricQuality{State: "not_applicable", Reason: "Darwin has no equivalent Windows commit limit"}
	quality["memoryHardware"] = metricQuality{State: "unavailable", Reason: "DIMM metadata not exposed by this collector"}
	set("diskUsage", len(payload.Disks) > 0, "APFS containers / mounted filesystems")
	set("diskMetadata", len(payload.Disks) > 0, "diskutil physical stores")
	// Rates have a legitimate zero at baseline/idle. Busy percent is not
	// derived from cumulative request latency (parallel requests overlap).
	set("diskRead", len(payload.Disks) > 0, "IOKit IO counters")
	set("diskWrite", len(payload.Disks) > 0, "IOKit IO counters")
	set("diskActivity", false, "no device busy-time counter")
	health := false
	for _, entry := range payload.Disks {
		health = health || entry.HealthStatus != "" || entry.TemperatureC != nil
	}
	set("diskHealth", health, "SMART")
	for _, key := range []string{"networkRxRate", "networkTxRate", "networkTraffic", "networkIdentity"} {
		set(key, len(payload.NetworkIfaces) > 0, "Darwin interface counters")
	}
	usage, memory, frequency, temperature, driver := false, false, false, false, false
	for _, gpu := range payload.GPUs {
		usage = usage || gpu.utilizationObserved
		memory = memory || gpu.memoryObserved
		frequency = frequency || gpu.FrequencyMHz != nil
		temperature = temperature || gpu.TemperatureC != nil
		driver = driver || gpu.DriverVersion != ""
	}
	set("gpuUsage", usage, "IOKit PerformanceStatistics")
	set("gpuMemory", memory, "driver allocation counters")
	set("gpuFrequency", frequency, "IOKit Core Clock")
	set("gpuTemperature", temperature, "IOKit GPU temperature")
	set("gpuDriverInfo", driver, "driver version")
	set("gpuEncode", false, "no encoder counter")
	set("gpuDecode", false, "no decoder counter")
	set("temperatureSources", len(payload.TemperatureSensors) > 0, "AppleSMC")
	set("fanRpm", len(payload.Fans) > 0, "AppleSMC F<n>Ac")
	mode := false
	for _, fan := range payload.Fans {
		mode = mode || fan.ControlMode != ""
	}
	set("fanControl", mode, "AppleSMC F<n>Md (read-only)")
	for _, key := range []string{"fanTargetTemperature", "fanPwm"} {
		quality[key] = metricQuality{State: "not_applicable", Reason: "no supported read-only mapping"}
	}
	set("fanChannelState", len(payload.Fans) > 0, "AppleSMC observation")
	set("fanNote", len(payload.Fans) > 0, "user configuration")
	hardwareKeys := []string{"cpuFrequency", "cpuTemperature", "gpuUsage", "gpuMemory", "gpuFrequency", "gpuTemperature", "gpuDriverInfo", "temperatureSources", "fanRpm", "fanChannelState"}
	sampledAt, err := time.Parse(time.RFC3339, payload.HardwareSampledAt)
	for _, key := range hardwareKeys {
		q := quality[key]
		q.ObservedAt = payload.HardwareSampledAt
		if (q.State == "direct" || q.State == "derived") && (err != nil || time.Since(sampledAt) > maxHardwareAge) {
			q.State = "stale"
			q.Reason = "hardware sample expired"
		}
		quality[key] = q
	}
	payload.MetricQuality = quality
	for _, key := range payload.UnavailableMetrics {
		q := quality[key]
		q.State = "unavailable"
		q.Reason = "counter source unreadable or sampling window not ready"
		quality[key] = q
	}
	for _, key := range allMetricKeys {
		state := quality[key].State
		if state == "unavailable" || state == "not_applicable" || state == "stale" {
			payload.UnavailableMetrics = append(payload.UnavailableMetrics, key)
		}
	}
	payload.UnavailableMetrics = uniqueStrings(payload.UnavailableMetrics)
}
