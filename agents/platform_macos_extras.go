package main

import (
	"encoding/hex"
	"path/filepath"
	"strings"

	"device-state-console/agent/internal/macos"
)

// powerStats is an average over the last hardware sampling window. Every
// component is optional: a missing source leaves its field absent instead of
// zero, and the whole section is omitted when nothing was observed.
type powerStats struct {
	ObservedAt        string   `json:"observedAt"`
	Source            string   `json:"source"`
	SystemWatts       *float64 `json:"systemWatts,omitempty"`
	InputWatts        *float64 `json:"inputWatts,omitempty"`
	CPUWatts          *float64 `json:"cpuWatts,omitempty"`
	GPUWatts          *float64 `json:"gpuWatts,omitempty"`
	ANEWatts          *float64 `json:"aneWatts,omitempty"`
	DRAMWatts         *float64 `json:"dramWatts,omitempty"`
	MediaWatts        *float64 `json:"mediaWatts,omitempty"`
	AdapterRatedWatts *float64 `json:"adapterRatedWatts,omitempty"`
	ExternalPower     *bool    `json:"externalPower,omitempty"`
}

type batteryStats struct {
	ObservedAt            string   `json:"observedAt"`
	Source                string   `json:"source"`
	ChargePercent         *float64 `json:"chargePercent,omitempty"`
	HealthPercent         *float64 `json:"healthPercent,omitempty"`
	CycleCount            *int     `json:"cycleCount,omitempty"`
	DesignCapacityMAh     *float64 `json:"designCapacityMAh,omitempty"`
	FullChargeCapacityMAh *float64 `json:"fullChargeCapacityMAh,omitempty"`
	TemperatureC          *float64 `json:"temperatureC,omitempty"`
	VoltageV              *float64 `json:"voltageV,omitempty"`
	AmperageMA            *float64 `json:"amperageMA,omitempty"`
	NetPowerWatts         *float64 `json:"netPowerWatts,omitempty"`
	TimeRemainingMinutes  *float64 `json:"timeRemainingMinutes,omitempty"`
	Charging              *bool    `json:"charging,omitempty"`
	ExternalPower         *bool    `json:"externalPower,omitempty"`
	FullyCharged          *bool    `json:"fullyCharged,omitempty"`
	Condition             string   `json:"condition,omitempty"`
}

type thermalStats struct {
	ObservedAt    string `json:"observedAt"`
	Source        string `json:"source"`
	PressureLevel string `json:"pressureLevel"`
}

type darwinMemoryMetadata struct {
	speedMHz   *float64
	slotCount  *int
	formFactor string
	memoryType string
}

func collectDarwinMemoryMetadata() *darwinMemoryMetadata {
	recordProbeSpawn("system_profiler")
	value, err := macos.ReadMemoryProfile()
	if err != nil {
		return nil
	}
	return &darwinMemoryMetadata{speedMHz: value.SpeedMHz, slotCount: value.SlotCount, formFactor: value.FormFactor, memoryType: strings.TrimSpace(value.Type)}
}

// collectDarwinSystemStats reads process, thread and open-file totals from
// the kernel in one pass. HandleCount carries kern.num_files, the system-wide
// open file table: Darwin has no Windows handle table, and gopsutil cannot
// count descriptors per process on Darwin at all.
func collectDarwinSystemStats(uptime uint64) (systemStats, bool) {
	report, err := macos.ReadSystem(true)
	if err != nil || report.Processes == nil {
		return systemStats{}, false
	}
	result := systemStats{ProcessCount: int(*report.Processes), UptimeSeconds: uptime}
	if report.Threads != nil {
		result.ThreadCount = int(*report.Threads)
	}
	if report.OpenFiles != nil {
		result.HandleCount = *report.OpenFiles
	}
	return result, true
}

// darwinDiskRates drops the busy percentage. IOKit only publishes cumulative
// request time, which overlaps for parallel requests, so a "busy" figure from
// it would be invented. Average response time (time / operations) is real.
func darwinDiskRates(rates rateStats) rateStats {
	rates.ActivePercent = 0
	for key, rate := range rates.Instances {
		rate.ActivePercent = 0
		rates.Instances[key] = rate
	}
	return rates
}

func darwinWholeDiskName(sourceKey string) string {
	return regexpDarwinWholeDisk.FindString(filepath.Base(sourceKey))
}

func readDarwinStorageInventory(includeSMART bool) map[string]macos.DiskInfo {
	devices, err := macos.ReadStorage(includeSMART)
	if err != nil {
		logCategoryf(logCategoryDiskSlow, "IOKit storage inventory failed: %v", err)
		return map[string]macos.DiskInfo{}
	}
	return macos.StorageInventory(devices)
}

func darwinDiskMetadata(disks []diskDeviceStats, inventory map[string]macos.DiskInfo) map[string]diskHardwareMetadata {
	result := map[string]diskHardwareMetadata{}
	for _, entry := range disks {
		info, ok := inventory[darwinWholeDiskName(entry.SourceKey)]
		if !ok || entry.SourceKey == "" {
			continue
		}
		result[entry.SourceKey] = diskHardwareMetadata{Model: info.Model, Vendor: info.Vendor, InterfaceType: info.InterfaceType, PhysicalDevice: entry.PhysicalDevice}
	}
	return result
}

func darwinDiskSensorMetadata(info macos.DiskInfo, whole string) (diskSensorMetadata, bool) {
	if info.Health == nil {
		return diskSensorMetadata{}, false
	}
	health := info.Health
	metadata := diskSensorMetadata{TemperatureC: health.TemperatureC, HealthStatus: health.Status, HealthReason: health.Reason, HealthPercent: health.HealthPercent}
	for _, attribute := range health.Attributes {
		metadata.SmartAttributes = append(metadata.SmartAttributes, diskSmartAttribute{ID: attribute.ID, Name: attribute.Name, Value: attribute.Value, Threshold: attribute.Threshold})
	}
	if health.TemperatureC != nil {
		value := *health.TemperatureC
		hardware := info.Model
		if hardware == "" {
			hardware = whole
		}
		metadata.TemperatureSensors = append(metadata.TemperatureSensors, newTemperatureSensorReading(
			"temperature-darwin-smart-"+sanitizeKey(whole), health.Source, "darwin-smart", hardware, "storage", whole,
			"Composite", &value, nil, nil, nil, "storage_composite", "IOKit SMART user client (read-only)"))
	}
	return metadata, true
}

// collectDarwinDiskSensors prefers the native NVMe/ATA SMART user clients
// and falls back to smartctl only for disks they do not cover.
func collectDarwinDiskSensors(disks []diskDeviceStats) map[string]diskSensorMetadata {
	result := map[string]diskSensorMetadata{}
	inventory := readDarwinStorageInventory(true)
	command := resolveSmartctlPath()
	for _, entry := range disks {
		if entry.SourceKey == "" {
			continue
		}
		if _, exists := result[entry.SourceKey]; exists {
			continue
		}
		whole := darwinWholeDiskName(entry.SourceKey)
		if sensor, ok := darwinDiskSensorMetadata(inventory[whole], whole); ok {
			result[entry.SourceKey] = sensor
			continue
		}
		if command == "" {
			continue
		}
		if sensor, ok := collectSmartctlDiskSensor(command, "/dev/"+whole); ok {
			result[entry.SourceKey] = sensor
		}
	}
	return result
}

func collectDarwinNetworkMetadata() map[string]networkHardwareMetadata {
	report, err := macos.ReadNetwork()
	if err != nil {
		logCategoryf(logCategoryNetworkSlow, "IOKit network inventory failed: %v", err)
		return map[string]networkHardwareMetadata{}
	}
	result := map[string]networkHardwareMetadata{}
	for name, info := range macos.NetworkMetadata(report) {
		result[name] = networkHardwareMetadata{Model: info.Model, LinkSpeedMbps: info.LinkSpeedMbps, ConnectionType: info.ConnectionType, SignalStrengthPercent: info.SignalPercent, RSSIdBm: info.RSSIdBm, NoiseDbm: info.NoisedBm}
	}
	return result
}

// darwinClusterChannels maps an Apple performance level to its IOReport CPU
// complex channels. Unknown level names get no frequency rather than a guess.
func darwinClusterChannels(level string, channels []macos.FrequencyChannel) []macos.FrequencyChannel {
	prefixes := map[string][]string{"Performance": {"PCPU", "CPU1"}, "Efficiency": {"ECPU", "CPU0"}}[level]
	result := []macos.FrequencyChannel{}
	for _, channel := range channels {
		for _, prefix := range prefixes {
			// CPU0/CPU1 are whole names on older SoCs; PCPU/ECPU number their
			// clusters (PCPU, PCPU1, ...).
			exact := prefix == "CPU0" || prefix == "CPU1"
			if channel.Name == prefix || (!exact && strings.HasPrefix(channel.Name, prefix)) {
				result = append(result, channel)
				break
			}
		}
	}
	return result
}

func darwinCPUClusters(system macos.SystemReport, channels []macos.FrequencyChannel) []cpuClusterStats {
	// A single level (Intel, or a VM) is the package itself, not a cluster.
	if len(system.PerfLevels) < 2 {
		return nil
	}
	result := []cpuClusterStats{}
	for _, level := range system.PerfLevels {
		if level.Physical <= 0 {
			continue
		}
		name := level.Name
		if name == "" {
			name = "Cluster"
		}
		cluster := cpuClusterStats{Name: name, CoreCount: level.Physical, LogicalCount: level.Logical, L2CacheBytes: level.L2, L3CacheBytes: level.L3}
		if matched := darwinClusterChannels(level.Name, channels); len(matched) > 0 {
			cluster.FrequencyMHz = macos.Frequency(matched)
		}
		result = append(result, cluster)
	}
	return result
}

func applyDarwinCPUTopology(packages []cpuPackageStats, hardware hardwareSensorMetrics) {
	if len(packages) != 1 {
		return
	}
	if hardware.cpuL3CacheBytes > packages[0].L3CacheBytes {
		packages[0].L3CacheBytes = hardware.cpuL3CacheBytes
	}
	packages[0].L2CacheBytes = hardware.cpuL2CacheBytes
	packages[0].Clusters = hardware.cpuClusters
}

func darwinTemperatureSensor(name, role, confidence, note string, value float64, now string) temperatureSensorReading {
	reading := newTemperatureSensorReading("hid-"+sanitizeKey(name), "Apple HID", "darwin-hid", "", "", "", name, &value, nil, nil, nil, role, note)
	reading.Confidence = confidence
	reading.ObservedAt = now
	return reading
}

// collectDarwinExtendedHardware adds the sources beyond AppleSMC/IOKit GPU:
// Apple HID die sensors, IOReport energy and GPU states, power sources and
// the thermal/topology sysctls. smcPower holds decoded SMC power keys.
func collectDarwinExtendedHardware(result *hardwareSensorMetrics, readings macos.Hardware, smcPower map[string]float64, now string) {
	hid, hidErr := macos.ReadHIDTemperatures()
	hidBackend := sensorBackendStatus{ID: "darwin-hid", Label: "Apple HID 温度传感器", OK: hidErr == nil && len(hid.Sensors) > 0}
	switch {
	case hidErr != nil:
		hidBackend.Detail = hidErr.Error()
	case hid.Error != "":
		hidBackend.Detail = hid.Error
	case len(hid.Sensors) == 0:
		hidBackend.Detail = "本机未暴露片上温度传感器（Intel Mac 或虚拟机）"
	default:
		hidBackend.Detail = "片上裸片/簇级温度；不作逐核读数"
	}
	cpuHID, gpuHID, hidList := macos.ClassifyHID(hid.Sensors)
	for _, sensor := range hidList {
		confidence, note := "unmapped", "未映射的 Apple 片上传感器，仅作诊断"
		if sensor.Role != "unknown" {
			confidence, note = "direct", "Apple 片上温度监测点（簇/裸片级，非逐核）"
		}
		result.temperatureSensors = append(result.temperatureSensors, darwinTemperatureSensor(sensor.Name, sensor.Role, confidence, note, sensor.Value, now))
	}
	if result.cpuTemperatureC == nil && cpuHID != nil {
		result.cpuTemperatureC = cpuHID
		result.cpuTemperatureSource = "Apple HID die sensors (derived mean)"
		result.cpuTemperatureSampledAt = now
	}

	energy, energyErr := macos.ReadEnergy()
	energyBackend := sensorBackendStatus{ID: "darwin-ioreport-energy", Label: "IOReport 能耗与 GPU 状态", OK: energyErr == nil && len(energy.Energy) > 0}
	switch {
	case energyErr != nil:
		energyBackend.Detail = energyErr.Error()
	case energy.EnergyError != "":
		energyBackend.Detail = energy.EnergyError
	default:
		energyBackend.Detail = "Energy Model 窗口平均功率"
	}
	breakdown := macos.PowerFromEnergy(energy.Energy, energy.EnergySeconds)
	var gpuFrequency *float64
	if table, err := hex.DecodeString(energy.GPUTable); err == nil {
		gpuFrequency = macos.GPUFrequency(energy.GPUStates, macos.ParseDVFSTable(table))
	}
	for index := range result.gpus {
		gpu := &result.gpus[index]
		if gpu.MemoryKind != "unified" {
			continue
		}
		if gpu.FrequencyMHz == nil && gpuFrequency != nil {
			gpu.FrequencyMHz = gpuFrequency
		}
		if gpu.TemperatureC == nil && gpuHID != nil {
			gpu.TemperatureC = gpuHID
			gpu.TemperatureSource = "Apple HID GPU sensors (mean)"
		}
	}

	sources, sourcesErr := macos.ReadPowerSources()
	if sourcesErr == nil {
		if battery := macos.Battery(sources); battery != nil {
			result.battery = &batteryStats{
				ObservedAt: now, Source: "IOPowerSources / AppleSmartBattery",
				ChargePercent: battery.ChargePercent, HealthPercent: battery.HealthPercent, CycleCount: battery.CycleCount,
				DesignCapacityMAh: battery.DesignCapacityMAh, FullChargeCapacityMAh: battery.FullChargeCapacityMAh,
				TemperatureC: battery.TemperatureC, VoltageV: battery.VoltageV, AmperageMA: battery.AmperageMA,
				NetPowerWatts: battery.NetPowerWatts, TimeRemainingMinutes: battery.TimeRemainingMinutes,
				Charging: battery.Charging, ExternalPower: battery.ExternalPower, FullyCharged: battery.FullyCharged, Condition: battery.Condition,
			}
		}
	}

	power := &powerStats{ObservedAt: now, CPUWatts: breakdown.CPU, GPUWatts: breakdown.GPU, ANEWatts: breakdown.ANE, DRAMWatts: breakdown.DRAM, MediaWatts: breakdown.Media}
	sourcesUsed := []string{}
	if breakdown.CPU != nil || breakdown.GPU != nil || breakdown.ANE != nil || breakdown.DRAM != nil {
		sourcesUsed = append(sourcesUsed, "IOReport Energy Model")
	}
	smcValue := func(key string) *float64 {
		value, ok := smcPower[key]
		if !ok || value < 0 || value > 2000 {
			return nil
		}
		return &value
	}
	power.SystemWatts, power.InputWatts = smcValue("PSTR"), smcValue("PDTR")
	if power.CPUWatts == nil {
		power.CPUWatts = smcValue("PCPC")
	}
	if power.GPUWatts == nil {
		power.GPUWatts = smcValue("PG0R")
	}
	if power.SystemWatts != nil || power.InputWatts != nil || (breakdown.CPU == nil && power.CPUWatts != nil) || (breakdown.GPU == nil && power.GPUWatts != nil) {
		sourcesUsed = append(sourcesUsed, "AppleSMC")
	}
	if sourcesErr == nil {
		power.AdapterRatedWatts = sources.AdapterWatts
		if sources.Providing != "" {
			external := sources.Providing == "AC Power"
			power.ExternalPower = &external
		}
	}
	if len(sourcesUsed) > 0 {
		power.Source = strings.Join(sourcesUsed, " + ")
		result.power = power
	}

	system, systemErr := macos.ReadSystem(false)
	if systemErr == nil {
		result.cpuClusters = darwinCPUClusters(system, readings.CPUChannels)
		if system.L2 != nil {
			result.cpuL2CacheBytes = *system.L2
		}
		if system.L3 != nil {
			result.cpuL3CacheBytes = *system.L3
		}
		if system.ThermalPressure != nil {
			if level := macos.ThermalPressureName(*system.ThermalPressure); level != "" {
				result.thermal = &thermalStats{ObservedAt: now, Source: "OSThermalPressureLevel notification", PressureLevel: level}
			}
		}
	}
	result.sensorBackends = append(result.sensorBackends, hidBackend, energyBackend)
}
