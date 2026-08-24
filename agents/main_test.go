package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPendingStoreEvictsOldestSamplesWithinByteLimit(t *testing.T) {
	root := t.TempDir()
	store := &pendingStore{
		path:      filepath.Join(root, "pending.jsonl"),
		statePath: filepath.Join(root, "pending.state.json"),
		maxBytes:  1200,
		maxAge:    24 * time.Hour,
	}
	for index := 0; index < 4; index++ {
		timestamp := time.Date(2026, 8, 4, 12, index, 0, 0, time.UTC).Format(time.RFC3339)
		payload := metricsPayload{
			Identity:  agentIdentity{DeviceID: "test-device"},
			Timestamp: timestamp,
		}
		payload.SampleID = sampleID(payload)
		if err := store.enqueue(pendingSample{ID: payload.SampleID, ServerURL: "https://hub.example", SampledAt: timestamp, Payload: payload}); err != nil {
			t.Fatal(err)
		}
	}

	entries, err := store.readEntries()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 || len(entries) >= 4 {
		t.Fatalf("expected oldest entries to be evicted, got %d entries", len(entries))
	}
	if entries[0].SampledAt == "2026-08-04T12:00:00Z" {
		t.Fatalf("oldest sample was not evicted: %#v", entries)
	}
}

func TestPendingStorePrunesExpiredAndDuplicateSamples(t *testing.T) {
	root := t.TempDir()
	store := &pendingStore{
		path:      filepath.Join(root, "pending.jsonl"),
		statePath: filepath.Join(root, "pending.state.json"),
		maxBytes:  1024 * 1024,
		maxAge:    time.Hour,
	}
	old := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	current := time.Now().UTC().Add(-5 * time.Minute).Format(time.RFC3339)
	payload := metricsPayload{Identity: agentIdentity{DeviceID: "test-device"}, Timestamp: current}
	payload.SampleID = sampleID(payload)
	if err := store.writeEntries([]pendingSample{
		{ID: "old", ServerURL: "https://hub.example", SampledAt: old, Payload: metricsPayload{Timestamp: old}},
		{ID: payload.SampleID, ServerURL: "https://hub.example", SampledAt: current, Payload: payload},
		{ID: payload.SampleID, ServerURL: "https://hub.example", SampledAt: current, Payload: payload},
	}); err != nil {
		t.Fatal(err)
	}
	entries, err := store.readEntries()
	if err != nil {
		t.Fatal(err)
	}
	entries = store.prune(entries, time.Now().UTC())
	if len(entries) != 1 || entries[0].ID != payload.SampleID {
		t.Fatalf("unexpected pruned entries: %#v", entries)
	}
}

func TestPendingStateIsWrittenWithoutPayloadData(t *testing.T) {
	root := t.TempDir()
	store := &pendingStore{
		path:          filepath.Join(root, "pending.jsonl"),
		statePath:     filepath.Join(root, "pending.state.json"),
		maxBytes:      1024,
		maxAge:        time.Hour,
		lastUploadErr: "redacted upload failure",
	}
	store.writeState()
	raw, err := os.ReadFile(store.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "" || string(raw) == "null" {
		t.Fatalf("expected pending state file, got %q", string(raw))
	}
}

func TestComputeRatesKeepsPerInterfaceNetworkActivity(t *testing.T) {
	previousAt := time.Unix(100, 0)
	currentAt := previousAt.Add(2 * time.Second)
	previous := &ioSnapshot{
		netByKey: map[string]netSnapshot{
			"Ethernet": {rx: 100, tx: 200},
			"Wi-Fi":    {rx: 500, tx: 700},
		},
		at: previousAt,
	}
	current := &ioSnapshot{
		netByKey: map[string]netSnapshot{
			"Ethernet": {rx: 1100, tx: 2200},
			"Wi-Fi":    {rx: 500, tx: 700},
		},
		rx: 1600,
		tx: 2900,
		at: currentAt,
	}

	_, network := computeRates(previous, current, 2)
	ethernet := network.Instances["Ethernet"]
	wifi := network.Instances["Wi-Fi"]
	if ethernet.RxBytesPerSec != 500 || ethernet.TxBytesPerSec != 1000 {
		t.Fatalf("unexpected Ethernet rates: %#v", ethernet)
	}
	if wifi.RxBytesPerSec != 0 || wifi.TxBytesPerSec != 0 {
		t.Fatalf("inactive Wi-Fi must remain zero: %#v", wifi)
	}
}

func TestMapHardwareSensorsIntelGPU(t *testing.T) {
	dedicatedUsed := 4.5
	dedicatedTotal := 128.0
	sharedUsed := 1990.164
	sharedTotal := 16281.93
	load := 1.100329
	clock := 550.0

	metrics := mapHardwareSensors([]hardwareSensorSnapshot{{
		HardwareType: "GpuIntel",
		Name:         "Intel(R) UHD Graphics",
		InstanceID:   `PCI\VEN_8086&DEV_A788\3&11583659&0&10`,
		Sensors: []hardwareSensor{
			{SensorType: "Clock", Name: "GPU Core", Value: &clock},
			{SensorType: "Load", Name: "D3D 3D", Value: &load},
			{SensorType: "SmallData", Name: "D3D Shared Memory Used", Value: &sharedUsed},
			{SensorType: "SmallData", Name: "D3D Shared Memory Total", Value: &sharedTotal},
			{SensorType: "SmallData", Name: "D3D Dedicated Memory Used", Value: &dedicatedUsed},
			{SensorType: "SmallData", Name: "D3D Dedicated Memory Total", Value: &dedicatedTotal},
		},
	}})

	if len(metrics.gpus) != 1 {
		t.Fatalf("expected one GPU, got %d", len(metrics.gpus))
	}
	gpu := metrics.gpus[0]
	if gpu.ID != "gpu-pci-ven-8086&dev-a788-3&11583659&0&10" {
		t.Fatalf("unexpected GPU id: %q", gpu.ID)
	}
	if gpu.UtilizationPercent != load {
		t.Fatalf("unexpected GPU load: %v", gpu.UtilizationPercent)
	}
	if gpu.FrequencyMHz == nil || *gpu.FrequencyMHz != clock {
		t.Fatalf("unexpected GPU clock: %v", gpu.FrequencyMHz)
	}
	expectedUsedBytes := uint64(sharedUsed * 1024 * 1024)
	expectedTotalBytes := uint64(sharedTotal * 1024 * 1024)
	if gpu.MemoryUsedBytes != expectedUsedBytes || gpu.MemoryTotalBytes != expectedTotalBytes {
		t.Fatalf("expected shared memory used=%d total=%d, got used=%d total=%d", expectedUsedBytes, expectedTotalBytes, gpu.MemoryUsedBytes, gpu.MemoryTotalBytes)
	}
	if !gpu.Integrated || gpu.MemoryKind != "shared" {
		t.Fatalf("expected Intel UHD to be an integrated shared-memory GPU, got integrated=%v kind=%q", gpu.Integrated, gpu.MemoryKind)
	}
}

func TestApplyIntegratedGPUTemperatureUsesCPUValue(t *testing.T) {
	independentTemperature := 37.0
	gpus := []gpuDeviceStats{
		{Name: "Intel(R) UHD Graphics", Integrated: true, TemperatureC: &independentTemperature, TemperatureSource: "device"},
		{Name: "NVIDIA GeForce RTX 2060 SUPER", TemperatureC: &independentTemperature, TemperatureSource: "device"},
	}

	applyIntegratedGPUTemperature(gpus, 54.5)
	if gpus[0].TemperatureC == nil || *gpus[0].TemperatureC != 54.5 || gpus[0].TemperatureSource != "cpuPackageShared" {
		t.Fatalf("expected iGPU temperature to follow CPU package temperature, got %#v", gpus[0])
	}
	if gpus[1].TemperatureC == nil || *gpus[1].TemperatureC != independentTemperature || gpus[1].TemperatureSource != "device" {
		t.Fatalf("discrete GPU temperature must remain independent, got %#v", gpus[1])
	}
}

func TestApplyCPUPackageTemperatureCopiesAggregateForSinglePackage(t *testing.T) {
	temperature := 66.5
	packages := []cpuPackageStats{{ID: "package-0"}}

	applyCPUPackageTemperature(packages, &temperature)
	if packages[0].TemperatureC == nil || *packages[0].TemperatureC != temperature {
		t.Fatalf("expected single CPU package temperature to be copied, got %#v", packages)
	}
}

func TestApplyCPUPackageTemperatureDoesNotMislabelMultiplePackages(t *testing.T) {
	temperature := 66.5
	packages := []cpuPackageStats{{ID: "package-0"}, {ID: "package-1"}}

	applyCPUPackageTemperature(packages, &temperature)
	for _, packageStats := range packages {
		if packageStats.TemperatureC != nil {
			t.Fatalf("aggregate temperature must not be copied to multiple packages: %#v", packages)
		}
	}
}

func TestCPUUsagePercentBetweenCalculatesSocketDelta(t *testing.T) {
	value, ok := cpuUsagePercentBetween(
		cpuSnapshot{idle: 100, total: 1_000},
		cpuSnapshot{idle: 150, total: 1_100},
	)
	if !ok || value != 50 {
		t.Fatalf("expected 50%% CPU usage from counter delta, got value=%v ok=%v", value, ok)
	}
}

func TestCPUUsagePercentBetweenRejectsCounterReset(t *testing.T) {
	if _, ok := cpuUsagePercentBetween(cpuSnapshot{idle: 200, total: 1_000}, cpuSnapshot{idle: 100, total: 1_100}); ok {
		t.Fatal("counter reset must not produce a CPU usage sample")
	}
}

func TestApplyCPUPackageRuntimeMetricsKeepsSocketValuesIndependent(t *testing.T) {
	usage0, frequency0, temperature0 := 20.0, 2_400.0, 85.0
	usage1, frequency1, temperature1 := 60.0, 3_100.0, 73.0
	packages := []cpuPackageStats{{ID: "cpu-0", SocketIndex: 0}, {ID: "cpu-1", SocketIndex: 1}}
	runtimeMetrics := cpuRuntimeMetrics{
		linuxDynamic: true,
		packages: map[string]cpuPackageRuntimeMetrics{
			"cpu-0": {usagePercent: &usage0, frequencyMHz: &frequency0, temperatureC: &temperature0},
			"cpu-1": {usagePercent: &usage1, frequencyMHz: &frequency1, temperatureC: &temperature1},
		},
	}
	updated := applyCPUPackageRuntimeMetrics(packages, runtimeMetrics)
	if len(updated) != 2 || updated[0].UsagePercent == nil || updated[1].UsagePercent == nil {
		t.Fatalf("expected runtime values on both packages, got %#v", updated)
	}
	if *updated[0].UsagePercent != usage0 || *updated[1].UsagePercent != usage1 || *updated[0].FrequencyMHz != frequency0 || *updated[1].FrequencyMHz != frequency1 || *updated[0].TemperatureC != temperature0 || *updated[1].TemperatureC != temperature1 {
		t.Fatalf("socket runtime values were not kept independent: %#v", updated)
	}
}

func TestApplyCPUPackageRuntimeMetricsDoesNotReuseUnavailableSocketValues(t *testing.T) {
	staleFrequency, staleTemperature := 2_400.0, 85.0
	packages := []cpuPackageStats{{
		ID:           "cpu-1",
		FrequencyMHz: &staleFrequency,
		TemperatureC: &staleTemperature,
	}}
	updated := applyCPUPackageRuntimeMetrics(packages, cpuRuntimeMetrics{
		linuxDynamic: true,
		packages:     map[string]cpuPackageRuntimeMetrics{"cpu-1": {}},
	})
	if updated[0].FrequencyMHz != nil || updated[0].TemperatureC != nil || updated[0].UsagePercent != nil {
		t.Fatalf("unavailable socket metrics must remain nil, got %#v", updated[0])
	}
}

func TestLinuxCPUPackageIDMapsKnownSensorNames(t *testing.T) {
	cases := []struct {
		hardware string
		label    string
		identity string
		want     string
	}{
		{hardware: "coretemp", label: "Package id 0", identity: "coretemp-/sys/devices/platform/coretemp.0", want: "cpu-0"},
		{hardware: "nct6779", label: "PECI Agent 1", identity: "nct6779-/sys/devices/platform/nct6775.2592", want: "cpu-1"},
		{hardware: "coretemp", label: "Core 0", identity: "coretemp-/sys/devices/platform/coretemp.1", want: "cpu-1"},
		{hardware: "x86_pkg_temp", label: "x86_pkg_temp", identity: "thermal_zone1", want: "cpu-1"},
	}
	for _, testCase := range cases {
		if got := linuxCPUPackageID(testCase.hardware, testCase.label, testCase.identity); got != testCase.want {
			t.Errorf("linuxCPUPackageID(%q, %q, %q) = %q, want %q", testCase.hardware, testCase.label, testCase.identity, got, testCase.want)
		}
	}
}

func TestMergeSlowMetricsReappliesCurrentCPUTemperatureToIntegratedGPU(t *testing.T) {
	previousTemperature := 85.0
	currentTemperature := 87.0
	previous := emptySlowMetrics()
	previous.hardwareCollected = true
	previous.gpus = []gpuDeviceStats{{
		ID:                "gpu-intel-uhd",
		Name:              "Intel(R) UHD Graphics",
		Integrated:        true,
		MemoryKind:        "shared",
		TemperatureC:      &previousTemperature,
		TemperatureSource: "cpuPackageShared",
		MemoryTotalBytes:  16 * 1024 * 1024 * 1024,
		memoryObserved:    true,
	}}

	next := emptySlowMetrics()
	next.hardwareCollected = true
	next.cpuTemperatureC = &currentTemperature
	next.gpus = []gpuDeviceStats{{
		ID:                "gpu-intel-uhd",
		Name:              "Intel(R) UHD Graphics",
		Integrated:        true,
		MemoryKind:        "shared",
		TemperatureC:      &currentTemperature,
		TemperatureSource: "cpuPackageShared",
		MemoryTotalBytes:  16 * 1024 * 1024 * 1024,
		memoryObserved:    true,
	}}

	merged := mergeSlowMetrics(previous, next)
	if len(merged.gpus) != 1 || merged.gpus[0].TemperatureC == nil || *merged.gpus[0].TemperatureC != currentTemperature {
		t.Fatalf("expected integrated GPU to follow current CPU temperature, got %#v", merged.gpus)
	}
	if merged.gpus[0].TemperatureSource != "cpuPackageShared" {
		t.Fatalf("expected integrated GPU temperature source to remain CPU package, got %#v", merged.gpus[0])
	}
}

func TestHardwareSensorCacheRoundTrip(t *testing.T) {
	root := t.TempDir()
	temperature := 68.0
	path := filepath.Join(root, "hardware-sensors.json")
	if err := writeHardwareSensorCache(path, []hardwareSensorSnapshot{{
		HardwareType: "Cpu",
		Name:         "Intel CPU",
		Sensors:      []hardwareSensor{{SensorType: "Temperature", Name: "CPU Package", Value: &temperature}},
	}}); err != nil {
		t.Fatal(err)
	}
	cache, err := readHardwareSensorCache(path)
	if err != nil {
		t.Fatal(err)
	}
	metrics := mapHardwareSensors(cache.Snapshots)
	if metrics.cpuTemperatureC == nil || *metrics.cpuTemperatureC != temperature {
		t.Fatalf("unexpected cached CPU temperature: %#v", metrics.cpuTemperatureC)
	}
}

func TestHardwareSensorCacheRejectsStaleData(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hardware-sensors.json")
	raw := []byte(`{"updatedAt":"2020-01-01T00:00:00Z","snapshots":[]}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readHardwareSensorCache(path); err == nil {
		t.Fatal("expected stale hardware sensor cache to be rejected")
	}
}

func TestCommandArgument(t *testing.T) {
	if got := commandArgument([]string{"--output", `C:\ProgramData\sensor.json`}, "--output"); got != `C:\ProgramData\sensor.json` {
		t.Fatalf("unexpected command argument: %q", got)
	}
	if got := commandArgument([]string{"--other", "value"}, "--output"); got != "" {
		t.Fatalf("missing command argument should be empty, got %q", got)
	}
}

func TestHardwareMonitorPathCandidatesPreferBundledLibrary(t *testing.T) {
	candidates := hardwareMonitorPathCandidates(
		filepath.Join("/opt", "DeviceStateConsoleAgent", "backend.exe"),
		filepath.Join("/workspace"),
		filepath.Join("/Program Files (x86)"),
		filepath.Join("/Program Files"),
	)
	if len(candidates) < 3 {
		t.Fatalf("expected bundled and external candidates, got %#v", candidates)
	}
	if !strings.Contains(candidates[0], `DeviceStateConsoleAgent`) || !strings.Contains(candidates[0], `windows-hardware`) {
		t.Fatalf("bundled executable directory must be tried first, got %#v", candidates)
	}
	if strings.Contains(candidates[0], "FanControl") {
		t.Fatalf("external FanControl library must not be first, got %#v", candidates)
	}
}

func TestDecodeHardwareProbeResultIncludesPawnIOStatus(t *testing.T) {
	installed := true
	loaded := true
	snapshots, status, err := decodeHardwareProbeResult([]byte(`{"snapshots":[{"hardwareType":"Cpu","name":"Intel CPU","sensors":[]}],"pawnIo":{"available":true,"installed":true,"loaded":true,"version":"2.2.0"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 || snapshots[0].Name != "Intel CPU" {
		t.Fatalf("unexpected snapshots: %#v", snapshots)
	}
	if status.Installed == nil || *status.Installed != installed || status.Loaded == nil || *status.Loaded != loaded || status.Version != "2.2.0" {
		t.Fatalf("unexpected PawnIO status: %#v", status)
	}
}

func TestMapHardwareSensorsIntegratedGPUIgnoresDedicatedAperture(t *testing.T) {
	dedicatedUsed := 128.0
	dedicatedTotal := 512.0
	metrics := mapHardwareSensors([]hardwareSensorSnapshot{{
		HardwareType: "GpuIntel",
		Name:         "Intel(R) UHD Graphics",
		Sensors: []hardwareSensor{
			{SensorType: "SmallData", Name: "D3D Dedicated Memory Used", Value: &dedicatedUsed},
			{SensorType: "SmallData", Name: "D3D Dedicated Memory Total", Value: &dedicatedTotal},
		},
	}})

	if len(metrics.gpus) != 1 {
		t.Fatalf("expected one GPU, got %d", len(metrics.gpus))
	}
	gpu := metrics.gpus[0]
	if gpu.MemoryUsedBytes != 0 || gpu.MemoryTotalBytes != 0 || gpu.MemoryKind != "shared" {
		t.Fatalf("dedicated aperture must not become iGPU VRAM: %#v", gpu)
	}
}

func TestGPUAdapterMemorySemantics(t *testing.T) {
	tests := []struct {
		name  string
		ram   uint64
		kind  string
		total uint64
	}{
		{name: "Intel(R) UHD Graphics", ram: 2 * 1024 * 1024 * 1024, kind: "shared", total: 0},
		{name: "NVIDIA GeForce RTX 2060 SUPER", ram: 8 * 1024 * 1024 * 1024, kind: "dedicated", total: 8 * 1024 * 1024 * 1024},
		{name: "Microsoft Remote Display Adapter", ram: 0, kind: "unknown", total: 0},
	}
	for _, test := range tests {
		if got := gpuMemoryKindForAdapter(test.name, test.ram); got != test.kind {
			t.Errorf("gpuMemoryKindForAdapter(%q) = %q, want %q", test.name, got, test.kind)
		}
		if got := gpuMemoryTotalForAdapter(test.name, test.ram); got != test.total {
			t.Errorf("gpuMemoryTotalForAdapter(%q) = %d, want %d", test.name, got, test.total)
		}
	}
}

func TestMergeGPUMemoryStatsDoesNotMixMemoryKinds(t *testing.T) {
	target := gpuDeviceStats{
		MemoryKind:      "shared",
		MemoryUsedBytes: 2 * 1024 * 1024 * 1024,
		memoryObserved:  true,
	}
	candidate := gpuDeviceStats{
		MemoryKind:       "dedicated",
		MemoryUsedBytes:  512 * 1024 * 1024,
		MemoryTotalBytes: 8 * 1024 * 1024 * 1024,
		memoryObserved:   true,
	}
	mergeGPUMemoryStats(&target, candidate)
	if target.MemoryKind != "shared" || target.MemoryUsedBytes != 2*1024*1024*1024 || target.MemoryTotalBytes != 0 {
		t.Fatalf("dedicated memory must not overwrite shared memory: %#v", target)
	}
}

func TestMergeGPUStatsCoalescesDuplicateIDs(t *testing.T) {
	merged := mergeGPUStats(
		[]gpuDeviceStats{{
			ID:         "gpu-pci-ven-8086&dev-a788",
			Name:       "Intel(R) UHD Graphics",
			Integrated: true,
			MemoryKind: "shared",
		}},
		[]gpuDeviceStats{
			{
				ID:               "gpu-pci-ven-8086&dev-a788",
				Name:             "Intel(R) UHD Graphics",
				Integrated:       true,
				MemoryKind:       "shared",
				MemoryUsedBytes:  256 * 1024,
				MemoryTotalBytes: 128 * 1024 * 1024,
				memoryObserved:   true,
			},
			{
				ID:               "gpu-pci-ven-8086&dev-a788",
				Name:             "Intel(R) UHD Graphics",
				Integrated:       true,
				MemoryKind:       "shared",
				MemoryUsedBytes:  3 * 1024 * 1024 * 1024,
				MemoryTotalBytes: 16 * 1024 * 1024 * 1024,
				memoryObserved:   true,
			},
		},
	)

	if len(merged) != 1 {
		t.Fatalf("expected duplicate GPU IDs to coalesce, got %d entries: %#v", len(merged), merged)
	}
	if merged[0].MemoryUsedBytes != 3*1024*1024*1024 || merged[0].MemoryTotalBytes != 16*1024*1024*1024 {
		t.Fatalf("expected the fullest shared-memory observation to win, got %#v", merged[0])
	}
}

func TestMapHardwareSensorsStorage(t *testing.T) {
	temperature := 42.0
	life := 97.0
	metrics := mapHardwareSensors([]hardwareSensorSnapshot{{
		HardwareType: "Storage",
		Name:         "KINGSTON SNV2S1000G",
		HealthStatus: "Good",
		HealthReason: "SMART status is healthy",
		SmartAttributes: []hardwareSmartAttribute{{
			ID:        194,
			Name:      "Temperature",
			Value:     42,
			Threshold: 0,
		}},
		Sensors: []hardwareSensor{
			{SensorType: "Temperature", Name: "Temperature", Value: &temperature},
			{SensorType: "Level", Name: "Life", Value: &life},
		},
	}})

	metadata, ok := metrics.diskSensorMetadata[sanitizeKey("KINGSTON SNV2S1000G")]
	if !ok {
		t.Fatalf("expected storage metadata, got %#v", metrics.diskSensorMetadata)
	}
	if metadata.TemperatureC == nil || *metadata.TemperatureC != temperature {
		t.Fatalf("unexpected storage temperature: %#v", metadata.TemperatureC)
	}
	if metadata.HealthStatus != "good" || metadata.HealthPercent == nil || *metadata.HealthPercent != life {
		t.Fatalf("unexpected storage health: %#v", metadata)
	}
	if len(metadata.SmartAttributes) != 1 || metadata.SmartAttributes[0].ID != 194 {
		t.Fatalf("unexpected SMART attributes: %#v", metadata.SmartAttributes)
	}
	if len(metrics.temperatureSensors) != 1 || metrics.temperatureSensors[0].Role != "storage_composite" {
		t.Fatalf("expected storage temperature source metadata, got %#v", metrics.temperatureSensors)
	}
}

func TestMapHardwareSensorsExportsTemperatureSourcesAndDiagnostics(t *testing.T) {
	cpuPackage := 82.0
	cpuCore := 78.0
	board := 40.0
	unwired := 1.0
	gpu := 43.0
	disk := 52.0
	threshold := 90.0
	metrics := mapHardwareSensors([]hardwareSensorSnapshot{
		{
			HardwareType: "Cpu",
			Name:         "Intel Core",
			Sensors: []hardwareSensor{
				{SensorType: "Temperature", Name: "CPU Package", Value: &cpuPackage},
				{SensorType: "Temperature", Name: "Core #1", Value: &cpuCore},
			},
		},
		{
			HardwareType: "SuperIO",
			Name:         "ITE IT8613E",
			Sensors: []hardwareSensor{
				{SensorType: "Temperature", Name: "Temperature #1", Value: &board},
				{SensorType: "Temperature", Name: "Temperature #2", Value: &unwired},
				{SensorType: "Temperature", Name: "Temperature Warning", Value: &threshold},
			},
		},
		{
			HardwareType: "GpuNvidia",
			Name:         "NVIDIA GPU",
			Sensors: []hardwareSensor{
				{SensorType: "Temperature", Name: "GPU Core", Value: &gpu},
			},
		},
		{
			HardwareType: "Storage",
			Name:         "NVMe Disk",
			Sensors: []hardwareSensor{
				{SensorType: "Temperature", Name: "Composite", Value: &disk},
			},
		},
	})

	if len(metrics.temperatureSensors) != 7 {
		t.Fatalf("expected every temperature source to be retained, got %d: %#v", len(metrics.temperatureSensors), metrics.temperatureSensors)
	}
	byName := map[string]temperatureSensorReading{}
	for _, reading := range metrics.temperatureSensors {
		byName[reading.RawName] = reading
	}
	if byName["CPU Package"].Role != "cpu_package" || byName["Core #1"].Role != "cpu_core" {
		t.Fatalf("unexpected CPU temperature roles: %#v", byName)
	}
	if byName["GPU Core"].Role != "gpu_core" || byName["Composite"].Role != "storage_composite" {
		t.Fatalf("unexpected GPU/storage temperature roles: %#v", byName)
	}
	if byName["Temperature #2"].Status != "invalid" || byName["Temperature #2"].Confidence != "diagnostic" {
		t.Fatalf("unwired SuperIO channel must remain visible as diagnostic: %#v", byName["Temperature #2"])
	}
	if byName["Temperature Warning"].Status != "threshold" || byName["Temperature Warning"].Confidence != "diagnostic" {
		t.Fatalf("threshold channel must not become a historical reading: %#v", byName["Temperature Warning"])
	}
}

func TestMergeTemperatureSensorsKeepsLatestObservationBySourceID(t *testing.T) {
	oldValue := 40.0
	newValue := 44.0
	previous := []temperatureSensorReading{{ID: "sensor-a", RawName: "SYSTIN", CurrentC: &oldValue, Status: "valid"}}
	next := []temperatureSensorReading{{ID: "sensor-a", RawName: "SYSTIN", CurrentC: &newValue, Status: "valid"}}
	merged := mergeTemperatureSensors(previous, next)
	if len(merged) != 1 || merged[0].CurrentC == nil || *merged[0].CurrentC != newValue {
		t.Fatalf("expected latest sensor observation to replace previous value, got %#v", merged)
	}
}

func TestDiskRateLookupNormalizesLinuxPartitionNames(t *testing.T) {
	rate := rateStats{ReadBytesPerSec: 123, WriteBytesPerSec: 456}
	got, ok := lookupDiskRate(map[string]rateStats{"sda": rate}, "/dev/sda2", "/")
	if !ok || got.ReadBytesPerSec != rate.ReadBytesPerSec || got.WriteBytesPerSec != rate.WriteBytesPerSec {
		t.Fatalf("expected /dev/sda2 to resolve to sda, got %#v, ok=%v", got, ok)
	}
}

func TestDiskSensorLookupNormalizesLinuxPartitionNames(t *testing.T) {
	temperature := 41.0
	sensor := diskSensorMetadata{TemperatureC: &temperature, HealthStatus: "good"}
	got, ok := lookupDiskSensorMetadata(map[string]diskSensorMetadata{"sda": sensor}, "/dev/sda2")
	if !ok || got.TemperatureC == nil || *got.TemperatureC != temperature || got.HealthStatus != "good" {
		t.Fatalf("expected /dev/sda2 to resolve to sda sensor, got %#v, ok=%v", got, ok)
	}
}

func TestLinuxBlockDeviceName(t *testing.T) {
	tests := map[string]string{
		"/dev/sda2":      "sda",
		"/dev/nvme0n1p2": "nvme0n1",
		"/dev/mmcblk0p1": "mmcblk0",
		"/dev/dm-0":      "dm-0",
	}
	for input, expected := range tests {
		if got := linuxBlockDeviceName(input); got != expected {
			t.Fatalf("linuxBlockDeviceName(%q) = %q, want %q", input, got, expected)
		}
	}
}

func TestGPUCounterLUID(t *testing.T) {
	input := "pid_1664_luid_0x00000000_0x0000EE48_phys_0_eng_0_engtype_3D"
	if got := gpuCounterLUID(input); got != "luid_0x00000000_0x0000ee48" {
		t.Fatalf("unexpected LUID: %q", got)
	}
}

func TestDecodeJSONListAcceptsObjectOrArray(t *testing.T) {
	for _, raw := range []string{`{"name":"one"}`, `[{"name":"one"}]`} {
		items, err := decodeJSONList[struct {
			Name string `json:"name"`
		}](json.RawMessage(raw))
		if err != nil || len(items) != 1 || items[0].Name != "one" {
			t.Fatalf("decodeJSONList(%s) = %#v, err=%v", raw, items, err)
		}
	}
}

func TestParseSmartctlTemperature(t *testing.T) {
	ata := []byte("194 Temperature_Celsius     0x0022   117   117   000    Old_age   Always       -       33")
	if value := parseSmartctlTemperature(ata); value == nil || *value != 33 {
		t.Fatalf("unexpected ATA temperature: %v", value)
	}

	nvme := []byte("Temperature:                        41 Celsius")
	if value := parseSmartctlTemperature(nvme); value == nil || *value != 41 {
		t.Fatalf("unexpected NVMe temperature: %v", value)
	}
}

func TestParseSmartctlJSON(t *testing.T) {
	raw := []byte(`{
  "smart_status": {"passed": true},
  "temperature": {"current": 38},
  "nvme_smart_health_information_log": {"percentage_used": 7},
  "ata_smart_data": {"table": [{"id": 194, "name": "Temperature_Celsius", "raw": {"value": 38}, "thresh": 0}]}
}`)

	metadata, ok := parseSmartctlJSON(raw)
	if !ok {
		t.Fatal("expected smartctl JSON to produce metadata")
	}
	if metadata.HealthStatus != "good" || metadata.HealthPercent == nil || *metadata.HealthPercent != 93 {
		t.Fatalf("unexpected SMART health: %#v", metadata)
	}
	if metadata.TemperatureC == nil || *metadata.TemperatureC != 38 {
		t.Fatalf("unexpected SMART temperature: %#v", metadata.TemperatureC)
	}
	if len(metadata.SmartAttributes) != 1 || metadata.SmartAttributes[0].ID != 194 {
		t.Fatalf("unexpected SMART attributes: %#v", metadata.SmartAttributes)
	}
}

func TestParseSmartctlJSONPreservesNVMeTemperatureSensors(t *testing.T) {
	raw := []byte(`{
  "nvme_smart_health_information_log": {
    "temperature": 58,
    "temperature_sensor_1": 61
  }
}`)

	metadata, ok := parseSmartctlJSON(raw)
	if !ok || metadata.TemperatureC == nil || *metadata.TemperatureC != 58 {
		t.Fatalf("expected NVMe composite temperature, got %#v, ok=%v", metadata, ok)
	}
	if len(metadata.TemperatureSensors) != 2 {
		t.Fatalf("expected composite and sensor 1 temperature sources, got %#v", metadata.TemperatureSensors)
	}
	if metadata.TemperatureSensors[0].RawName != "NVMe Composite" || metadata.TemperatureSensors[1].RawName != "NVMe Temperature Sensor 1" {
		t.Fatalf("unexpected NVMe temperature source names: %#v", metadata.TemperatureSensors)
	}
}

func TestNormalizeGPUNameAndMatch(t *testing.T) {
	tests := []struct {
		a        string
		b        string
		expected bool
	}{
		{"NVIDIA GeForce RTX 4060 Laptop GPU", "NVIDIA GeForce RTX 4060", true},
		{"Intel(R) UHD Graphics 630", "Intel UHD Graphics", true},
		{"AMD Radeon(TM) Graphics", "AMD Radeon Graphics", true},
		{"NVIDIA GeForce RTX 3080 with Max-Q Design", "GeForce RTX 3080", true},
		{"Intel(R) UHD Graphics", "NVIDIA GeForce RTX 4060", false},
	}
	for _, tc := range tests {
		got := matchGPUName(tc.a, tc.b)
		if got != tc.expected {
			t.Errorf("matchGPUName(%q, %q) = %v; want %v", tc.a, tc.b, got, tc.expected)
		}
	}
}

func TestMergeGPUStatsPreservesAllPhysicalGPUs(t *testing.T) {
	base := []gpuDeviceStats{
		{
			ID:               "gpu-pci-ven-8086&dev-a788",
			Name:             "Intel(R) UHD Graphics",
			MemoryTotalBytes: 1024 * 1024 * 1024,
		},
		{
			ID:               "gpu-pci-ven-10de&dev-28e0",
			Name:             "NVIDIA GeForce RTX 4060 Laptop GPU",
			MemoryTotalBytes: 8 * 1024 * 1024 * 1024,
		},
	}
	lhmOverlay := []gpuDeviceStats{
		{
			ID:                 "gpu-intel-uhd-graphics",
			Name:               "Intel(R) UHD Graphics",
			UtilizationPercent: 15,
			MemoryUsedBytes:    512 * 1024 * 1024,
		},
	}
	nvidiaTemp := 48.0
	nvidiaOverlay := []gpuDeviceStats{
		{
			ID:                 "gpu-nvidia-geforce-rtx-4060-0",
			Name:               "NVIDIA GeForce RTX 4060 Laptop GPU",
			UtilizationPercent: 42,
			TemperatureC:       &nvidiaTemp,
			TemperatureSource:  "device",
			MemoryUsedBytes:    2048 * 1024 * 1024,
			MemoryTotalBytes:   8 * 1024 * 1024 * 1024,
		},
	}

	merged := mergeGPUStats(base, lhmOverlay, nvidiaOverlay)
	if len(merged) != 2 {
		t.Fatalf("expected 2 merged GPUs, got %d", len(merged))
	}

	// First GPU: Intel iGPU
	if merged[0].ID != "gpu-pci-ven-8086&dev-a788" {
		t.Errorf("expected Intel GPU ID to be preserved, got %q", merged[0].ID)
	}
	if merged[0].UtilizationPercent != 15 {
		t.Errorf("expected Intel GPU utilization to be 15, got %v", merged[0].UtilizationPercent)
	}
	if merged[0].MemoryUsedBytes != 512*1024*1024 {
		t.Errorf("expected Intel GPU memory used to be 512MB, got %d", merged[0].MemoryUsedBytes)
	}

	// Second GPU: NVIDIA dGPU
	if merged[1].ID != "gpu-pci-ven-10de&dev-28e0" {
		t.Errorf("expected NVIDIA GPU ID to be preserved, got %q", merged[1].ID)
	}
	if merged[1].UtilizationPercent != 42 {
		t.Errorf("expected NVIDIA GPU utilization to be 42, got %v", merged[1].UtilizationPercent)
	}
	if merged[1].TemperatureC == nil || *merged[1].TemperatureC != 48.0 {
		t.Errorf("expected NVIDIA GPU temp to be 48.0, got %v", merged[1].TemperatureC)
	}
	if merged[1].MemoryUsedBytes != 2048*1024*1024 {
		t.Errorf("expected NVIDIA GPU memory used to be 2048MB, got %d", merged[1].MemoryUsedBytes)
	}
}

func TestMergeGPUStatsWithAliasedNvidiaGPU(t *testing.T) {
	base := []gpuDeviceStats{
		{
			ID:               "gpu-pci-ven-10de-dev-1f0b-subsys-88041043",
			Name:             "NVIDIA GeForce RTX 2060 SUPER",
			MemoryTotalBytes: 4293918720,
		},
		{
			ID:               "gpu-pci-ven-8086-dev-a788",
			Name:             "Intel(R) UHD Graphics",
			MemoryTotalBytes: 2147479552,
		},
	}
	nvidiaFreq := 1860.0
	nvidiaTemp := 49.0
	nvidiaOverlay := []gpuDeviceStats{
		{
			ID:                 "gpu-nvidia-cmp-40hx-0",
			Name:               "NVIDIA CMP 40HX",
			UtilizationPercent: 0,
			FrequencyMHz:       &nvidiaFreq,
			TemperatureC:       &nvidiaTemp,
			MemoryUsedBytes:    0,
			MemoryTotalBytes:   8 * 1024 * 1024 * 1024,
		},
	}

	merged := mergeGPUStats(base, nvidiaOverlay)
	if len(merged) != 2 {
		t.Fatalf("expected 2 merged GPUs, got %d", len(merged))
	}

	// First GPU: NVIDIA dGPU (RTX 2060 SUPER matched with CMP 40HX via vendor matching)
	if merged[0].ID != "gpu-pci-ven-10de-dev-1f0b-subsys-88041043" {
		t.Errorf("expected NVIDIA GPU ID to be preserved, got %q", merged[0].ID)
	}
	if merged[0].UtilizationPercent != 0 {
		t.Errorf("expected NVIDIA GPU utilization to be 0, got %v", merged[0].UtilizationPercent)
	}
	if merged[0].FrequencyMHz == nil || *merged[0].FrequencyMHz != 1860.0 {
		t.Errorf("expected NVIDIA GPU freq to be 1860.0, got %v", merged[0].FrequencyMHz)
	}
	if merged[0].TemperatureC == nil || *merged[0].TemperatureC != 49.0 {
		t.Errorf("expected NVIDIA GPU temp to be 49.0, got %v", merged[0].TemperatureC)
	}
	if merged[0].MemoryTotalBytes != 8*1024*1024*1024 {
		t.Errorf("expected NVIDIA GPU total memory to be 8GB (8589934592), got %d", merged[0].MemoryTotalBytes)
	}
	if merged[0].MemoryUsedBytes != 0 {
		t.Errorf("expected NVIDIA GPU used memory to be 0, got %d", merged[0].MemoryUsedBytes)
	}
}

func TestVirtualGPUAdapterFiltering(t *testing.T) {
	virtualAdapters := []struct {
		name string
		pnp  string
	}{
		{"GameViewer Virtual Display Adapter", "ROOT\\DISPLAY\\0000"},
		{"Parsec Virtual Display Adapter", "ROOT\\DISPLAY\\0001"},
		{"Microsoft Remote Display Adapter", "SWD\\REMOTEDISPLAYENUM\\RDPIDD_INDIRECTDISPLAY&SESSIONID_0002"},
		{"Spacedesk Virtual Display", "ROOT\\SPACEDESK"},
	}
	for _, va := range virtualAdapters {
		if !isVirtualGPUAdapter(va.name, va.pnp) {
			t.Errorf("expected isVirtualGPUAdapter(%q, %q) to be true", va.name, va.pnp)
		}
	}

	physicalAdapters := []struct {
		name string
		pnp  string
	}{
		{"NVIDIA GeForce RTX 2060 SUPER", "PCI\\VEN_10DE&DEV_1F0B&SUBSYS_88041043&REV_A1\\4&323F4879&0&0008"},
		{"Intel(R) UHD Graphics", "PCI\\VEN_8086&DEV_A788&SUBSYS_22128086&REV_04\\3&11583659&0&10"},
		{"AMD Radeon RX 7900 XTX", "PCI\\VEN_1002&DEV_744C&SUBSYS_00001002"},
	}
	for _, pa := range physicalAdapters {
		if isVirtualGPUAdapter(pa.name, pa.pnp) {
			t.Errorf("expected isVirtualGPUAdapter(%q, %q) to be false", pa.name, pa.pnp)
		}
	}
}

func TestParseNonNegativeFloat(t *testing.T) {
	cases := []struct {
		input    string
		expected float64
		ok       bool
	}{
		{"0", 0, true},
		{"0.0", 0, true},
		{"49", 49, true},
		{"1860.5", 1860.5, true},
		{"-1", 0, false},
		{"", 0, false},
		{"abc", 0, false},
	}
	for _, tc := range cases {
		val, ok := parseNonNegativeFloat(tc.input)
		if ok != tc.ok || (ok && val != tc.expected) {
			t.Errorf("parseNonNegativeFloat(%q) = (%v, %v); want (%v, %v)", tc.input, val, ok, tc.expected, tc.ok)
		}
	}
}

func TestMergeConfigPreservesExplicitEmptyMetrics(t *testing.T) {
	defaults := newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "https://hub.example", Secret: "secret"})
	empty := []string{}
	merged := mergeConfig(defaults, agentConfigFile{EnabledMetrics: &empty})
	if merged.EnabledMetrics == nil || len(merged.EnabledMetrics) != 0 {
		t.Fatalf("explicit empty metrics must remain disabled: %#v", merged.EnabledMetrics)
	}
	if len(makeEnabledMetricSet(merged.EnabledMetrics)) != 0 {
		t.Fatalf("explicit empty metrics must not be expanded by the collector: %#v", merged.EnabledMetrics)
	}
}

func TestMergeConfigDefaultsOmittedCloudSyncAndAcceptsExplicitDisable(t *testing.T) {
	defaults := newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "https://hub.example", Secret: "secret"})
	if !mergeConfig(defaults, agentConfigFile{}).CloudSyncEnabled {
		t.Fatal("omitted cloudSyncEnabled must preserve the default")
	}
	disabled := false
	if mergeConfig(defaults, agentConfigFile{CloudSyncEnabled: &disabled}).CloudSyncEnabled {
		t.Fatal("explicit cloudSyncEnabled=false must disable uploads")
	}
}
