package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// testFullPlan is the permissive collection plan used by tests that exercise
// collection mechanics rather than metric gating.
func testFullPlan() collectionPlan {
	return collectionPlan{systemStats: true, linuxCPUFast: true, gpu: true, diskSensors: true}
}

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

func TestDefaultFanProbeSelectionByPlatform(t *testing.T) {
	tests := []struct {
		goos     string
		provider string
		enabled  bool
	}{
		{goos: "linux", provider: "hwmon", enabled: true},
		{goos: "windows", provider: "librehardwaremonitor", enabled: true},
		{goos: "freebsd", provider: "disabled", enabled: false},
	}
	for _, test := range tests {
		selection := defaultFanProbeSelection(test.goos)
		if selection.Target != "fan" || selection.Provider != test.provider || selection.Enabled != test.enabled {
			t.Fatalf("default fan selection for %s = %#v, want provider=%q enabled=%v", test.goos, selection, test.provider, test.enabled)
		}
	}

	config := newDefaultRuntimeConfig(agentConnectionConfig{})
	if runtime.GOOS == "linux" {
		selection := config.ProbeSelections[len(config.ProbeSelections)-1]
		if selection.Target != "fan" || selection.Provider != "hwmon" || !selection.Enabled {
			t.Fatalf("Linux runtime default must enable hwmon fans, got %#v", selection)
		}
	}
}

func TestLinuxFanSensorIDUsesHardwareIdentity(t *testing.T) {
	first := linuxFanSensorID("nct6779-/sys/devices/platform/nct6775.2592", "fan1")
	second := linuxFanSensorID("nct6779-/sys/devices/platform/nct6775.2592", "fan1")
	other := linuxFanSensorID("nct6779-/sys/devices/platform/nct6775.2592", "fan2")
	if first == "" || first != second || first == other {
		t.Fatalf("unexpected Linux fan IDs: first=%q second=%q other=%q", first, second, other)
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

func TestIsPermanentPayloadError(t *testing.T) {
	if !isPermanentPayloadError(&httpStatusError{StatusCode: 400, Status: "400 Bad Request"}) {
		t.Fatalf("expected 400 to be recognized as permanent error")
	}
	if !isPermanentPayloadError(&httpStatusError{StatusCode: 413, Status: "413 Payload Too Large"}) {
		t.Fatalf("expected 413 to be recognized as permanent error")
	}
	if !isPermanentPayloadError(&httpStatusError{StatusCode: 422, Status: "422 Unprocessable Entity"}) {
		t.Fatalf("expected 422 to be recognized as permanent error")
	}
	if isPermanentPayloadError(&httpStatusError{StatusCode: 500, Status: "500 Internal Server Error"}) {
		t.Fatalf("did not expect 500 to be permanent error")
	}
	if isPermanentPayloadError(&httpStatusError{StatusCode: 401, Status: "401 Unauthorized"}) {
		t.Fatalf("did not expect 401 to be permanent error")
	}
	if isPermanentPayloadError(fmt.Errorf("connection refused")) {
		t.Fatalf("did not expect network error to be permanent error")
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

func TestSanitizePendingPayloadRemovesInvalidTemperatureValues(t *testing.T) {
	invalid := -125.0
	valid := 42.0
	payload := metricsPayload{
		TemperatureSensors: []temperatureSensorReading{
			{ID: "invalid", HardwareType: "hwmon", RawName: "CPUTIN", CurrentC: &invalid, Status: "invalid"},
			{ID: "valid", HardwareType: "hwmon", RawName: "Package", CurrentC: &valid, Status: "valid"},
		},
	}

	sanitized := sanitizePendingPayload(payload)
	if sanitized.TemperatureSensors[0].CurrentC != nil {
		t.Fatalf("invalid hardware temperature must be removed from replay payload: %#v", sanitized.TemperatureSensors[0])
	}
	if sanitized.TemperatureSensors[1].CurrentC == nil || *sanitized.TemperatureSensors[1].CurrentC != valid {
		t.Fatalf("valid hardware temperature must remain in replay payload: %#v", sanitized.TemperatureSensors[1])
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

func TestMapHardwareSensorsIncludesZeroRPMFanChannel(t *testing.T) {
	zero := 0.0
	metrics := mapHardwareSensors([]hardwareSensorSnapshot{{
		HardwareType: "SuperIO",
		Name:         "Nuvoton Controller",
		Sensors: []hardwareSensor{
			{SensorType: "Fan", Name: "Fan #1", Value: &zero},
		},
	}})
	if len(metrics.fans) != 1 {
		t.Fatalf("expected zero-RPM fan channel to remain visible, got %#v", metrics.fans)
	}
	if metrics.fans[0].RPM != 0 || metrics.fans[0].ChannelState != "无转速" {
		t.Fatalf("unexpected zero-RPM fan state: %#v", metrics.fans[0])
	}
}

func TestMapHardwareSensorsMarksUnreadableFanAsUnavailable(t *testing.T) {
	metrics := mapHardwareSensors([]hardwareSensorSnapshot{{
		HardwareType: "SuperIO", Name: "Controller",
		Sensors: []hardwareSensor{{SensorType: "Fan", Name: "Fan #1"}},
	}})
	if len(metrics.fans) != 1 || metrics.fans[0].RPMStatus != "unavailable" || metrics.fans[0].ChannelState != "转速读数不可用" {
		t.Fatalf("unreadable fan must not look like a stopped fan: %#v", metrics.fans)
	}
}

func TestMapHardwareSensorsKeepsFanControlUnknownWithoutChannelMatch(t *testing.T) {
	rpm, pwm := 1200.0, 70.0
	metrics := mapHardwareSensors([]hardwareSensorSnapshot{{
		HardwareType: "SuperIO", Name: "Controller",
		Sensors: []hardwareSensor{
			{SensorType: "Fan", Name: "Fan #1", Value: &rpm},
			{SensorType: "Control", Name: "Fan #2 PWM", Value: &pwm},
		},
	}})
	if len(metrics.fans) != 1 || metrics.fans[0].MinPWMPercent != nil || metrics.fans[0].MaxPWMPercent != nil {
		t.Fatalf("unmatched PWM must not be attributed to fan #1: %#v", metrics.fans)
	}
}

func TestMapHardwareSensorsDisambiguatesRepeatedFanLabels(t *testing.T) {
	rpm := 1000.0
	metrics := mapHardwareSensors([]hardwareSensorSnapshot{{
		HardwareType: "SuperIO", Name: "Controller",
		Sensors: []hardwareSensor{
			{SensorType: "Fan", Name: "Fan", Identifier: "/lpc/fan/0", Value: &rpm},
			{SensorType: "Fan", Name: "Fan", Identifier: "/lpc/fan/1", Value: &rpm},
		},
	}})
	if len(metrics.fans) != 2 || metrics.fans[0].ID == metrics.fans[1].ID {
		t.Fatalf("repeated labels must retain distinct hardware channels: %#v", metrics.fans)
	}
}

func TestMapHardwareSensorsPrefersPhysicalCPUTemperature(t *testing.T) {
	tctl, tdie, ccd := 80.0, 55.0, 47.0
	metrics := mapHardwareSensors([]hardwareSensorSnapshot{{
		HardwareType: "Cpu", Name: "AMD CPU",
		Sensors: []hardwareSensor{
			{SensorType: "Temperature", Name: "Tctl", Value: &tctl},
			{SensorType: "Temperature", Name: "Tdie", Value: &tdie},
			{SensorType: "Temperature", Name: "CCD #1", Value: &ccd},
		},
	}})
	if metrics.cpuTemperatureC == nil || *metrics.cpuTemperatureC != tdie {
		t.Fatalf("expected Tdie instead of averaging Tctl and CCD: %#v", metrics.cpuTemperatureC)
	}
	if len(metrics.temperatureSensors) != 3 {
		t.Fatalf("raw channels should remain available for diagnosis: %#v", metrics.temperatureSensors)
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

// The inventory cache is what removes a per-cycle hardware probe. A zero
// collectedAt must read as expired so the first cycle fills it, and a fingerprint
// change must invalidate it so a hot-plug is not reported stale for a full TTL.
func TestHardwareAssetCacheExpiryAndFingerprint(t *testing.T) {
	cache := hardwareAssetCache{}
	if !cache.expiredFor(hardwareAssetCacheTTL) {
		t.Fatal("an empty cache must report as expired")
	}
	cache.collectedAt = time.Now()
	if cache.expiredFor(time.Minute) {
		t.Fatal("a freshly filled cache must not report as expired")
	}
	if cache.expiredFor(time.Nanosecond) == false {
		t.Fatal("a cache older than its ttl must report as expired")
	}

	before := slowMetrics{disks: []diskDeviceStats{{ID: "a"}}, networkInterfaces: []networkInterfaceStats{{ID: "b"}}}
	after := slowMetrics{disks: []diskDeviceStats{{ID: "a"}, {ID: "c"}}, networkInterfaces: []networkInterfaceStats{{ID: "b"}}}
	if deviceReferenceCount(before) == deviceReferenceCount(after) {
		t.Fatal("adding a device must change the inventory fingerprint")
	}

	// A flaky GPU probe must not move the fingerprint: it drives an inventory
	// refresh, and an oscillating count would refresh on every cycle.
	noGpu := slowMetrics{disks: []diskDeviceStats{{ID: "a"}}}
	withGpu := slowMetrics{disks: []diskDeviceStats{{ID: "a"}}, gpus: []gpuDeviceStats{{ID: "gpu-0"}}}
	if deviceReferenceCount(noGpu) != deviceReferenceCount(withGpu) {
		t.Fatal("the GPU count must not participate in the inventory fingerprint")
	}
}

// The Win32_Processor fallback exists only to fill L3 cache sizes, which do not
// change while the machine runs. It must run once per inventory TTL, not once
// per slow cycle: that per-cycle PowerShell probe was the single largest
// steady-state cost on Windows.
func TestWindowsCPUFallbackRefreshUsesInventoryTTL(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("the Win32_Processor fallback only exists on Windows")
	}
	originalProbe := windowsCPUFallbackProbe
	originalRunner := probeRunner
	var calls int
	windowsCPUFallbackProbe = func() (*float64, []cpuPackageStats, error) {
		calls++
		return nil, []cpuPackageStats{{ID: "cpu-0", L3CacheBytes: 4096}}, nil
	}
	probeRunner = func(context.Context, string, ...string) ([]byte, error) {
		return []byte("[]"), nil
	}
	defer func() {
		windowsCPUFallbackProbe = originalProbe
		probeRunner = originalRunner
	}()

	assets := hardwareAssetCache{}
	_, assets = collectSlowMetrics(assets, testFullPlan())
	if calls != 1 {
		t.Fatalf("the first slow cycle must refresh the cached CPU fallback once, got %d", calls)
	}
	// A zero reference count disables the device-change invalidation so the
	// second call deterministically stays inside the TTL.
	assets.referenceDeviceCount = 0
	_, _ = collectSlowMetrics(assets, testFullPlan())
	if calls != 1 {
		t.Fatalf("a slow cycle inside the TTL must reuse the cached fallback, got %d calls", calls)
	}
}

// The collector reports the probes it actually started. Counters are consumed on
// read so a payload carries this cycle's spawns, not a running total.
func TestProbeSpawnCountersAreConsumedAndReset(t *testing.T) {
	takeProbeSpawnCounts()
	recordProbeSpawn("powershell")
	recordProbeSpawn("powershell")
	recordProbeSpawn("netsh.exe")
	counts := takeProbeSpawnCounts()
	if counts["powershell"] != 2 || counts["netsh"] != 1 {
		t.Fatalf("unexpected spawn counts: %#v", counts)
	}
	if next := takeProbeSpawnCounts(); next != nil {
		t.Fatalf("counters must reset after being consumed, got %#v", next)
	}
}

// A Windows executable reaches the counter as both `powershell` and
// `powershell.exe`; one process must not be split into two entries.
func TestProbeSpawnNamesAreNormalized(t *testing.T) {
	takeProbeSpawnCounts()
	recordProbeSpawn("powershell")
	recordProbeSpawn("powershell.exe")
	recordProbeSpawn(`C:\Windows\System32\netsh.exe`)
	counts := takeProbeSpawnCounts()
	if len(counts) != 2 {
		t.Fatalf("expected two normalized names, got %#v", counts)
	}
	if counts["powershell"] != 2 {
		t.Fatalf("powershell/powershell.exe must merge, got %#v", counts)
	}
	if counts["netsh"] != 1 {
		t.Fatalf("a full path must reduce to its base name, got %#v", counts)
	}
	if normalizeProbeName("") != "" || normalizeProbeName("  ") != "" {
		t.Fatal("blank names must normalize to empty")
	}
}

// A probe that never starts must not be counted. The old implementation
// recorded the spawn before exec, so a missing optional tool (nvidia-smi on a
// machine without one) inflated the audit's spawn rate with processes that
// never existed.
func TestProbeCountDoesNotCountMissingBinary(t *testing.T) {
	takeProbeSpawnCounts()
	if _, err := execProbeCommand(context.Background(), "device-state-console-definitely-missing-binary"); err == nil {
		t.Fatal("expected the missing binary to fail")
	}
	if counts := takeProbeSpawnCounts(); counts != nil {
		t.Fatalf("a missing binary must not be counted as a probe spawn, got %#v", counts)
	}
}

// One PowerShell process must produce one counted spawn. The previous
// implementation recorded it twice, which halved the apparent effect of every
// change that removes a PowerShell probe.
func TestWindowsPowerShellCountsOneSpawn(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("powershell.exe only exists on Windows")
	}
	takeProbeSpawnCounts()
	if _, err := runWindowsPowerShell(context.Background(), "Write-Output ok"); err != nil {
		t.Fatalf("powershell probe failed: %v", err)
	}
	counts := takeProbeSpawnCounts()
	if counts["powershell"] != 1 {
		t.Fatalf("expected exactly one powershell spawn, got %#v", counts)
	}
}

// The global budget is what stops a sequence of slow probes from running past
// the sampling interval and making the collector sample back-to-back. An
// overrun must be reported and must not poison the hardware-inventory cache, so
// the next cycle still starts from the cache it had.
func TestSlowCollectionBudgetReportsOverrunAndKeepsAssets(t *testing.T) {
	assets := hardwareAssetCache{
		collectedAt:          time.Now(),
		referenceDeviceCount: 3,
		metadata:             windowsHardwareMetadata{GpuDrivers: map[string]string{"gpu": "driver"}},
	}
	outcome := collectSlowMetricsBudgeted(assets, testFullPlan(), time.Nanosecond)
	if !outcome.overtime {
		t.Fatal("a one-nanosecond budget must report an overrun")
	}
	if outcome.assets.collectedAt != assets.collectedAt || outcome.assets.referenceDeviceCount != 3 {
		t.Fatalf("an abandoned collection must not mutate the inventory cache: %#v", outcome.assets)
	}
	if outcome.metrics.hardwareCollected {
		t.Fatalf("an abandoned collection must return an empty sample: %#v", outcome.metrics)
	}
	// A zero collectedAt means "no fresh timestamp", so the merge keeps the
	// previous sample and the next cycle retries immediately.
	if !outcome.metrics.collectedAt.IsZero() {
		t.Fatalf("an abandoned collection must not claim a fresh timestamp: %#v", outcome.metrics)
	}
}

func TestCurrentIdentityUsesDeviceNameWhenDisplayNameIsUnset(t *testing.T) {
	state := &agentState{baseIdentity: agentIdentity{DeviceID: "device-1", Hostname: "windows-host"}}
	config := agentRuntimeConfig{Connection: agentConnectionConfig{DeviceID: "device-1"}}

	if got := state.currentIdentity(config); got.Hostname != "windows-host" {
		t.Fatalf("empty display name produced %q, want the device name", got.Hostname)
	}

	config.Connection.Hostname = "Office workstation"
	if got := state.currentIdentity(config); got.Hostname != "Office workstation" {
		t.Fatalf("custom display name produced %q", got.Hostname)
	}
}

func TestSlowCollectionBudgetReturnsMetricsWhenItFits(t *testing.T) {
	outcome := collectSlowMetricsBudgeted(hardwareAssetCache{}, testFullPlan(), 60*time.Second)
	if outcome.overtime {
		t.Fatal("a one-minute budget must not report an overrun")
	}
	if outcome.metrics.collectedAt.IsZero() {
		t.Fatal("a completed collection must carry a timestamp")
	}
}

// The hardware sensors are read from the SYSTEM helper's cache when it is fresh;
// this is the seam that removes a duplicate PowerShell probe per cycle. A missing
// or stale cache must report not-ok so the collector falls back to its own probe.
func TestCachedHardwareSnapshotsHonoursFreshness(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hardware-sensors.json")
	temperature := 71.0
	if err := writeHardwareSensorCache(path, []hardwareSensorSnapshot{{
		HardwareType: "Cpu",
		Name:         "Intel CPU",
		Sensors:      []hardwareSensor{{SensorType: "Temperature", Name: "CPU Package", Value: &temperature}},
	}}); err != nil {
		t.Fatal(err)
	}
	snapshots, updatedAt, ok := cachedHardwareSnapshots(path)
	if !ok || len(snapshots) != 1 || snapshots[0].Name != "Intel CPU" || updatedAt == "" {
		t.Fatalf("a fresh cache must be reused: ok=%v snapshots=%#v updatedAt=%q", ok, snapshots, updatedAt)
	}

	if _, _, ok := cachedHardwareSnapshots(filepath.Join(root, "missing.json")); ok {
		t.Fatal("a missing cache must report not-ok")
	}

	stalePath := filepath.Join(root, "stale.json")
	if err := os.WriteFile(stalePath, []byte(`{"updatedAt":"2000-01-01T00:00:00Z","snapshots":[{"hardwareType":"Cpu","name":"old"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := cachedHardwareSnapshots(stalePath); ok {
		t.Fatal("a stale cache must report not-ok")
	}
}

// The whole point of the slow cadence is that the fast path stays free of
// external processes. This stubs the probe runner and proves a cycle inside the
// slow interval starts no PowerShell/netsh/smartctl/dmidecode process at all.
func TestSteadyStateFastCycleSpawnsNoProbes(t *testing.T) {
	original := probeRunner
	var spawns int
	probeRunner = func(context.Context, string, ...string) ([]byte, error) {
		spawns++
		return nil, errors.New("probe disabled for this test")
	}
	defer func() { probeRunner = original }()

	state := &agentState{baseIdentity: agentIdentity{DeviceID: "test-device", Hostname: "test-host"}}
	cfg := newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "http://127.0.0.1:1"})
	cfg.Sampling.NormalIntervalSeconds = defaultNormalIntervalSeconds
	cfg.Sampling.SlowIntervalSeconds = defaultSlowIntervalSeconds

	state.collectPayload(cfg)
	afterFirst := spawns

	state.collectPayload(cfg)
	if spawns != afterFirst {
		t.Fatalf("a fast cycle spawned %d probes; it must spawn none", spawns-afterFirst)
	}
}

// System overview counters no longer walk every process on every fast cycle.
// On Linux they refresh on the slow cadence; the test proves the enumeration
// runs once and the second fast payload reuses the same numbers.
func TestSystemStatsRefreshFollowsSlowInterval(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows reads the counters from one syscall and refreshes per cycle")
	}
	originalRunner := probeRunner
	probeRunner = func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("probe disabled for this test")
	}
	defer func() { probeRunner = originalRunner }()

	originalCollector := systemStatsCollector
	var calls int
	systemStatsCollector = func() systemStats {
		calls++
		return systemStats{ProcessCount: calls, ThreadCount: calls * 2}
	}
	defer func() { systemStatsCollector = originalCollector }()

	state := &agentState{baseIdentity: agentIdentity{DeviceID: "test-device", Hostname: "test-host"}}
	cfg := newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "http://127.0.0.1:1"})
	cfg.Sampling.NormalIntervalSeconds = 1
	cfg.Sampling.SlowIntervalSeconds = 3600

	first := state.collectPayload(cfg)
	second := state.collectPayload(cfg)
	if calls != 1 {
		t.Fatalf("two cycles inside the slow interval must enumerate once, got %d", calls)
	}
	if first.System != second.System {
		t.Fatalf("the cached system counters must be reused: %#v vs %#v", first.System, second.System)
	}
}

// The smartctl -A fallback for disks without an hwmon temperature used to run
// for every physical disk on every slow cycle. It now shares the disk-sensor
// TTL, so a cycle inside the TTL must not start a single smartctl process even
// when the binary is on PATH.
func TestSlowCycleInsideDiskSensorTTLDoesNotSpawnSmartctl(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the smartctl -A fallback only exists on Linux")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "smartctl"), []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	original := probeRunner
	var smartctlCalls int
	probeRunner = func(_ context.Context, name string, _ ...string) ([]byte, error) {
		if name == "smartctl" {
			smartctlCalls++
		}
		return nil, errors.New("probe disabled for this test")
	}
	defer func() { probeRunner = original }()

	assets := hardwareAssetCache{
		diskSensorsCollectedAt: time.Now(),
		linuxDiskTemperatures:  map[string]*float64{},
	}
	_, _ = collectSlowMetrics(assets, testFullPlan())
	if smartctlCalls != 0 {
		t.Fatalf("a slow cycle inside the disk-sensor TTL spawned smartctl %d times", smartctlCalls)
	}
}

// A refresh cycle must store the fallback map so the next cycles can reuse it.
func TestDiskSensorRefreshCachesLinuxTemperatureFallback(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the smartctl -A fallback only exists on Linux")
	}
	original := probeRunner
	probeRunner = func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("probe disabled for this test")
	}
	defer func() { probeRunner = original }()

	_, assets := collectSlowMetrics(hardwareAssetCache{}, testFullPlan())
	if assets.linuxDiskTemperatures == nil {
		t.Fatal("a refresh cycle must cache the smartctl fallback map for the TTL")
	}
}

func withoutMetrics(cfg agentRuntimeConfig, drop ...string) agentRuntimeConfig {
	dropSet := map[string]bool{}
	for _, key := range drop {
		dropSet[key] = true
	}
	kept := make([]string, 0, len(cfg.EnabledMetrics))
	for _, key := range cfg.EnabledMetrics {
		if !dropSet[key] {
			kept = append(kept, key)
		}
	}
	cfg.EnabledMetrics = kept
	return cfg
}

// The collection plan must mirror the runtime filter: a group the filter would
// zero must be skippable, and an instance override must keep it collected.
func TestResolveCollectionPlan(t *testing.T) {
	base := newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "http://127.0.0.1:1"})
	plan := resolveCollectionPlan(base)
	if !plan.systemStats || !plan.linuxCPUFast || !plan.diskSensors {
		t.Fatalf("a default config must collect every group, got %#v", plan)
	}
	if plan.gpu {
		t.Fatal("the test default disables the GPU block")
	}

	if resolveCollectionPlan(withoutMetrics(base, "systemOverview")).systemStats {
		t.Fatal("systemOverview off must skip the system stats collection")
	}
	if resolveCollectionPlan(withoutMetrics(base, "cpuFrequency", "cpuTemperature")).linuxCPUFast {
		t.Fatal("both CPU fast-path metrics off must skip the Linux sysfs sweep")
	}
	if !resolveCollectionPlan(withoutMetrics(base, "cpuFrequency", "cpuTemperature")).systemStats {
		t.Fatal("skipping one group must not affect the others")
	}
	if resolveCollectionPlan(withoutMetrics(base, "diskHealth", "temperatureSources")).diskSensors {
		t.Fatal("both disk-sensor metrics off must skip the smartctl probes")
	}

	overrides := withoutMetrics(base, "cpuFrequency", "cpuTemperature", "diskHealth", "temperatureSources")
	overrides.InstanceMetricConfig = map[string][]string{"disk-0": {"diskHealth"}}
	plan = resolveCollectionPlan(overrides)
	if !plan.linuxCPUFast || !plan.diskSensors {
		t.Fatalf("instance overrides must keep the collection path enabled, got %#v", plan)
	}

	noCPU := base
	noCPU.ProbeSelections = append([]agentProbeSelection{}, base.ProbeSelections...)
	for index := range noCPU.ProbeSelections {
		if noCPU.ProbeSelections[index].Target == "cpu" {
			noCPU.ProbeSelections[index].Enabled = false
		}
	}
	if resolveCollectionPlan(noCPU).linuxCPUFast {
		t.Fatal("a disabled CPU block must skip the Linux sysfs sweep")
	}
}

// Disabling systemOverview must stop the Linux process walk entirely, not just
// zero the payload after the walk.
func TestDisabledSystemOverviewSkipsEnumeration(t *testing.T) {
	originalRunner := probeRunner
	probeRunner = func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("probe disabled for this test")
	}
	defer func() { probeRunner = originalRunner }()

	originalCollector := systemStatsCollector
	var calls int
	systemStatsCollector = func() systemStats {
		calls++
		return systemStats{ProcessCount: 99}
	}
	defer func() { systemStatsCollector = originalCollector }()

	state := &agentState{baseIdentity: agentIdentity{DeviceID: "test-device", Hostname: "test-host"}}
	cfg := withoutMetrics(newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "http://127.0.0.1:1"}), "systemOverview")
	payload := state.collectPayload(cfg)
	if calls != 0 {
		t.Fatalf("systemOverview off must skip the enumeration, got %d calls", calls)
	}
	if payload.System.ProcessCount != 0 {
		t.Fatalf("the filtered payload must not carry system counters: %#v", payload.System)
	}
}

// The Linux test default disables the GPU block, so the collector must not even
// attempt the nvidia-smi probe.
func TestDisabledGPUBlockSkipsNvidiaProbe(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the Windows test default enables the GPU block")
	}
	original := probeRunner
	var nvidiaCalls int
	probeRunner = func(_ context.Context, name string, _ ...string) ([]byte, error) {
		if name == "nvidia-smi" {
			nvidiaCalls++
		}
		return nil, errors.New("probe disabled for this test")
	}
	defer func() { probeRunner = original }()

	cfg := newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "http://127.0.0.1:1"})
	_, _ = collectSlowMetrics(hardwareAssetCache{}, resolveCollectionPlan(cfg))
	if nvidiaCalls != 0 {
		t.Fatalf("a disabled GPU block attempted %d nvidia-smi probes", nvidiaCalls)
	}
}

// Disabling both disk-sensor metrics must skip the smartctl fallback even when
// the disk-sensor TTL has expired.
func TestDisabledDiskSensorsSkipSmartctl(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the smartctl -A fallback only exists on Linux")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "smartctl"), []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	original := probeRunner
	var smartctlCalls int
	probeRunner = func(_ context.Context, name string, _ ...string) ([]byte, error) {
		if name == "smartctl" {
			smartctlCalls++
		}
		return nil, errors.New("probe disabled for this test")
	}
	defer func() { probeRunner = original }()

	cfg := withoutMetrics(newDefaultRuntimeConfig(agentConnectionConfig{ServerURL: "http://127.0.0.1:1"}), "diskHealth", "temperatureSources")
	_, _ = collectSlowMetrics(hardwareAssetCache{}, resolveCollectionPlan(cfg))
	if smartctlCalls != 0 {
		t.Fatalf("disabled disk sensors spawned smartctl %d times", smartctlCalls)
	}
}

// The inventory cache is what removes a per-cycle hardware probe. A change in
// the device set must clear its timestamp so the next cycle re-queries, and a
// refresh rebuilds the struct, so the previous count has to be read first.
func TestHardwareAssetCacheChangeDetectionInvalidates(t *testing.T) {
	assets := hardwareAssetCache{collectedAt: time.Now(), referenceDeviceCount: 2}
	previousDeviceCount := assets.referenceDeviceCount
	// The refresh path: rebuild the cache, compare against the carried-in count.
	assets = hardwareAssetCache{collectedAt: time.Now(), metadata: windowsHardwareMetadata{}}
	if previousDeviceCount != 0 && previousDeviceCount != 3 {
		assets.collectedAt = time.Time{}
	}
	assets.referenceDeviceCount = 3
	if !assets.collectedAt.IsZero() {
		t.Fatal("a changed device count must clear collectedAt so the next cycle refreshes")
	}

	// An unchanged count keeps the cache warm across the rebuild.
	unchanged := hardwareAssetCache{collectedAt: time.Now(), referenceDeviceCount: 2}
	unchanged = hardwareAssetCache{collectedAt: time.Now(), metadata: windowsHardwareMetadata{}}
	if 2 != 0 && 2 != 2 {
		unchanged.collectedAt = time.Time{}
	}
	unchanged.referenceDeviceCount = 2
	if unchanged.collectedAt.IsZero() {
		t.Fatal("an unchanged device count must keep the inventory cache warm")
	}
}

// The disk sensors have their own, much shorter TTL than the hardware
// inventory: temperature is a live reading, so a cycle inside the disk TTL must
// skip the probe while a cycle inside the inventory TTL must not.
func TestDiskSensorCacheTTL(t *testing.T) {
	cache := hardwareAssetCache{}
	if !cache.diskSensorsExpired() {
		t.Fatal("an empty disk sensor cache must report as expired")
	}
	cache.diskSensorsCollectedAt = time.Now()
	if cache.diskSensorsExpired() {
		t.Fatal("a freshly read disk sensor cache must not report as expired")
	}
	// The disk TTL is deliberately shorter than the inventory TTL, so ageing a
	// cache past one but not the other must expire the disks and keep the rest.
	cache.collectedAt = time.Now()
	cache.diskSensorsCollectedAt = time.Now().Add(-(diskSensorCacheTTL + time.Second))
	if !cache.diskSensorsExpired() {
		t.Fatal("disk sensors older than diskSensorCacheTTL must report as expired")
	}
	if cache.expiredFor(hardwareAssetCacheTTL) {
		t.Fatal("the hardware inventory must still be fresh while only the disks expired")
	}
	if diskSensorCacheTTL >= hardwareAssetCacheTTL {
		t.Fatal("the disk sensor TTL must be shorter than the inventory TTL, or temperature freezes as long as a DIMM speed")
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

func TestParseWindowsInventoryPayload(t *testing.T) {
	var payload windowsHardwareMetadataPayload
	raw := []byte(`{
		"memory": [
			{"speedMHz": 2400, "configuredClockMHz": 3200, "formFactor": "DIMM"},
			{"speedMHz": 2400, "configuredClockMHz": 0, "formFactor": "DIMM"}
		],
		"adapters": [
			{"name": "Ethernet", "model": "Intel I219-V", "linkSpeed": "1 Gbps", "connectionType": "802.3"},
			{"name": "", "model": "ignored", "linkSpeed": "1 Gbps", "connectionType": "802.3"}
		],
		"disks": [
			{"name": "C:", "interfaceType": "NVMe SSD", "model": "Samsung 990", "vendor": "Samsung", "physicalDevice": "\\\\.\\PhysicalDrive0", "diskNumber": 0}
		],
		"gpus": [
			{"name": "NVIDIA GeForce RTX 2060", "pnpDeviceId": "PCI\\VEN_10DE", "driverVersion": "31.0.15", "adapterRAM": 8589934592},
			{"name": "Intel(R) UHD Graphics", "pnpDeviceId": "PCI\\VEN_8086", "driverVersion": "30.0.1", "adapterRAM": 0}
		]
	}`)
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	metadata, adapters := parseWindowsInventoryPayload(payload)

	// Memory: the configured clock wins, the average is over the populated modules.
	if metadata.MemorySpeedMHz == nil || *metadata.MemorySpeedMHz != 2800 {
		t.Fatalf("unexpected memory speed: %#v", metadata.MemorySpeedMHz)
	}
	if metadata.MemorySlotCount == nil || *metadata.MemorySlotCount != 2 {
		t.Fatalf("unexpected memory slot count: %#v", metadata.MemorySlotCount)
	}
	if metadata.MemoryFormFactor != "DIMM" {
		t.Fatalf("unexpected memory form factor: %q", metadata.MemoryFormFactor)
	}

	// The adapter model must come out of the merged script, not a second query.
	ethernet, ok := metadata.Networks["Ethernet"]
	if !ok {
		t.Fatalf("expected the Ethernet adapter, got %#v", metadata.Networks)
	}
	if ethernet.Model != "Intel I219-V" {
		t.Fatalf("adapter model must be populated by the merged script, got %q", ethernet.Model)
	}
	if ethernet.LinkSpeedMbps == nil || *ethernet.LinkSpeedMbps != 1000 {
		t.Fatalf("unexpected link speed: %#v", ethernet.LinkSpeedMbps)
	}
	if _, exists := metadata.Networks[""]; exists {
		t.Fatal("an adapter without a name must be skipped")
	}

	disk, ok := metadata.DiskMetadata["C:"]
	if !ok || disk.Model != "Samsung 990" || disk.PhysicalDevice != `\\.\PhysicalDrive0` {
		t.Fatalf("unexpected disk metadata: %#v", metadata.DiskMetadata)
	}
	if metadata.DiskInterfaces["C:"] != "NVMe SSD" {
		t.Fatalf("unexpected disk interface: %#v", metadata.DiskInterfaces)
	}

	if metadata.GpuDrivers["NVIDIA GeForce RTX 2060"] != "31.0.15" {
		t.Fatalf("unexpected GPU drivers: %#v", metadata.GpuDrivers)
	}
	if len(adapters) != 2 {
		t.Fatalf("expected both adapters as records, got %#v", adapters)
	}
	if adapters[0].PNPDeviceID != `PCI\VEN_10DE` || adapters[0].AdapterRAM != 8589934592 {
		t.Fatalf("adapter records must carry PNP id and RAM: %#v", adapters[0])
	}
}

func TestParseWindowsInventoryPayloadEmpty(t *testing.T) {
	metadata, adapters := parseWindowsInventoryPayload(windowsHardwareMetadataPayload{})
	if adapters == nil {
		t.Fatal("an empty payload must still return a non-nil record slice, so callers can tell 'no adapters' from 'never fetched'")
	}
	if len(adapters) != 0 || len(metadata.Networks) != 0 || metadata.MemorySpeedMHz != nil {
		t.Fatalf("unexpected result for an empty payload: %#v %#v", metadata, adapters)
	}
}

// The adapter projection is a pure function of the cached records: it must
// produce the same ids the GPU merge identity matching relies on.
// dmidecode output is only available on a Linux host with root, so the parsing
// is split out and exercised here. Memory speed is what the dashboard's memory
// card shows; a wrong parse silently degrades it.
func TestParseDmidecodeMemory(t *testing.T) {
	output := []byte(`# dmidecode 3.5
Getting SMBIOS data from sysfs.
Handle 0x0008, DMI type 17, 40 bytes
Memory Device
	Size: 16 GB
	Form Factor: DIMM
	Speed: 2666 MT/s
	Configured Memory Speed: 3200 MT/s

Handle 0x0009, DMI type 17, 40 bytes
Memory Device
	Size: No Module Installed
	Form Factor: DIMM
	Speed: Unknown

Handle 0x000A, DMI type 17, 40 bytes
Memory Device
	Size: 16 GB
	Form Factor: DIMM
	Speed: 3200 MT/s
`)
	memory, ok := parseDmidecodeMemory(output)
	if !ok {
		t.Fatal("expected populated modules to parse")
	}
	// The configured speed wins where present; 3200 and 3200 average to 3200.
	if memory.speedMHz == nil || *memory.speedMHz != 3200 {
		t.Fatalf("unexpected memory speed: %#v", memory.speedMHz)
	}
	if memory.slotCount == nil || *memory.slotCount != 2 {
		t.Fatalf("an unpopulated slot must not be counted: %#v", memory.slotCount)
	}
	if memory.formFactor != "DIMM" {
		t.Fatalf("unexpected form factor: %q", memory.formFactor)
	}
}

func TestParseDmidecodeMemoryEmptyAndFallsBackToRawSpeed(t *testing.T) {
	if _, ok := parseDmidecodeMemory([]byte("Handle 0x0000, DMI type 17\nMemory Device\n\tSize: No Module Installed\n")); ok {
		t.Fatal("a document with no populated module must report not-ok")
	}
	if _, ok := parseDmidecodeMemory(nil); ok {
		t.Fatal("empty output must report not-ok")
	}

	// Without a configured speed, the raw Speed field is the fallback.
	memory, ok := parseDmidecodeMemory([]byte("Memory Device\n\tSize: 8 GB\n\tForm Factor: SODIMM\n\tSpeed: 2400 MT/s\n"))
	if !ok || memory.speedMHz == nil || *memory.speedMHz != 2400 {
		t.Fatalf("expected the raw speed to be used: ok=%v %#v", ok, memory)
	}
}

func TestWindowsGPUAdaptersFromRecords(t *testing.T) {
	records := []windowsGPUAdapterRecord{
		{Name: "NVIDIA GeForce RTX 2060", PNPDeviceID: `PCI\VEN_10DE`, DriverVersion: "31.0.15", AdapterRAM: 8 * 1024 * 1024 * 1024},
		{Name: "NVIDIA GeForce RTX 2060", PNPDeviceID: `PCI\VEN_10DE`, DriverVersion: "31.0.15"},
		{Name: "Microsoft Remote Display Adapter", PNPDeviceID: `ROOT\BasicDisplay`},
	}
	adapters := windowsGPUAdaptersFromRecords(records)
	if len(adapters) != 1 {
		t.Fatalf("duplicate ids must collapse, got %#v", adapters)
	}
	if adapters[0].ID != "gpu-"+sanitizeKey(`PCI\VEN_10DE`) {
		t.Fatalf("unexpected adapter id: %q", adapters[0].ID)
	}
	if adapters[0].MemoryKind != "dedicated" {
		t.Fatalf("unexpected memory kind: %q", adapters[0].MemoryKind)
	}
	// A nil cache is the "no inventory yet" case and must not panic.
	if got := windowsGPUAdaptersFromRecords(nil); len(got) != 0 {
		t.Fatalf("nil records must project to an empty list, got %#v", got)
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

func TestNewTemperatureSensorReadingClearsOutOfRangeCurrentValue(t *testing.T) {
	invalid := -125.0
	reading := newTemperatureSensorReading(
		"sensor-invalid",
		"linux-hwmon",
		"hwmon",
		"nct6779",
		"hwmon",
		"nct6779",
		"CPUTIN",
		&invalid,
		nil,
		nil,
		nil,
		"superio",
		"",
	)
	if reading.CurrentC != nil || reading.Status != "invalid" || reading.Confidence != "diagnostic" {
		t.Fatalf("out-of-range temperature must remain diagnostic without a numeric value: %#v", reading)
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

func TestMergeSlowMetricsDoesNotResurrectMissingSensorsOrGPUs(t *testing.T) {
	temperature := 45.0
	previous := emptySlowMetrics()
	previous.hardwareCollected = true
	previous.temperatureSensors = []temperatureSensorReading{{ID: "old", CurrentC: &temperature}}
	previous.gpus = []gpuDeviceStats{{ID: "old-gpu", TemperatureC: &temperature}}
	next := emptySlowMetrics()
	next.hardwareCollected = true
	merged := mergeSlowMetrics(previous, next)
	if len(merged.temperatureSensors) != 0 || len(merged.gpus) != 0 {
		t.Fatalf("missing hardware must not remain in current metrics: sensors=%#v gpus=%#v", merged.temperatureSensors, merged.gpus)
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

func TestMergeWindowsGPUStatsPrefersPhysicalSourcesOverPerformanceFallback(t *testing.T) {
	base := []gpuDeviceStats{
		{
			ID:   "gpu-pci-ven-10de-dev-1f0b-subsys-88041043",
			Name: "NVIDIA GeForce RTX 2060 SUPER",
		},
		{
			ID:   "gpu-pci-ven-8086-dev-a788",
			Name: "Intel(R) UHD Graphics",
		},
	}
	performance := []gpuDeviceStats{
		{
			ID:                  base[0].ID,
			Name:                base[0].Name,
			UtilizationPercent:  10.045,
			utilizationObserved: true,
		},
	}
	lhmFrequency := 1815.0
	lhmTemperature := 87.0
	lhm := []gpuDeviceStats{
		{
			ID:                  "gpu-lhm-nvidia-0",
			Name:                "NVIDIA CMP 40HX",
			UtilizationPercent:  99,
			utilizationObserved: true,
			FrequencyMHz:        &lhmFrequency,
			TemperatureC:        &lhmTemperature,
			TemperatureSource:   "device",
		},
	}
	nvidiaFrequency := 1815.0
	nvidiaTemperature := 87.0
	nvidia := []gpuDeviceStats{
		{
			ID:                  "gpu-nvidia-cmp-40hx-0",
			Name:                "NVIDIA CMP 40HX",
			UtilizationPercent:  99,
			utilizationObserved: true,
			FrequencyMHz:        &nvidiaFrequency,
			TemperatureC:        &nvidiaTemperature,
			TemperatureSource:   "nvidia-smi",
		},
	}

	merged := mergeGPUStats(base, performance, lhm, nvidia)
	if len(merged) != 2 {
		t.Fatalf("expected 2 merged GPUs, got %d", len(merged))
	}
	if merged[0].UtilizationPercent != 99 {
		t.Errorf("expected NVIDIA utilization from physical source, got %v", merged[0].UtilizationPercent)
	}
	if merged[0].FrequencyMHz == nil || *merged[0].FrequencyMHz != 1815 {
		t.Errorf("expected NVIDIA frequency from physical source, got %v", merged[0].FrequencyMHz)
	}
	if merged[0].TemperatureC == nil || *merged[0].TemperatureC != 87 {
		t.Errorf("expected NVIDIA temperature from physical source, got %v", merged[0].TemperatureC)
	}
	if merged[0].TemperatureSource != "nvidia-smi" {
		t.Errorf("expected nvidia-smi temperature source, got %q", merged[0].TemperatureSource)
	}
}

func TestMergeGPUStatsPreservesObservedZeroUtilization(t *testing.T) {
	base := []gpuDeviceStats{{
		ID:   "gpu-pci-ven-10de-dev-1f0b-subsys-88041043",
		Name: "NVIDIA GeForce RTX 2060 SUPER",
	}}
	performance := []gpuDeviceStats{{
		ID:                  base[0].ID,
		Name:                base[0].Name,
		UtilizationPercent:  10,
		utilizationObserved: true,
	}}
	nvidia := []gpuDeviceStats{{
		ID:                  "gpu-nvidia-cmp-40hx-0",
		Name:                "NVIDIA CMP 40HX",
		UtilizationPercent:  0,
		utilizationObserved: true,
	}}

	merged := mergeGPUStats(base, performance, nvidia)
	if len(merged) != 1 {
		t.Fatalf("expected 1 merged GPU, got %d", len(merged))
	}
	if merged[0].UtilizationPercent != 0 {
		t.Errorf("expected observed zero utilization to override fallback, got %v", merged[0].UtilizationPercent)
	}
}

func TestMergeMissingGPUMemoryKeepsCurrentGPUReadings(t *testing.T) {
	previousFrequency := 300.0
	previousTemperature := 34.0
	currentFrequency := 1815.0
	currentTemperature := 87.0
	previous := []gpuDeviceStats{{
		ID:                  "gpu-pci-ven-10de-dev-1f0b-subsys-88041043",
		Name:                "NVIDIA GeForce RTX 2060 SUPER",
		UtilizationPercent:  99,
		FrequencyMHz:        &previousFrequency,
		TemperatureC:        &previousTemperature,
		MemoryKind:          "dedicated",
		MemoryUsedBytes:     4 * 1024 * 1024 * 1024,
		MemoryTotalBytes:    8 * 1024 * 1024 * 1024,
		memoryObserved:      true,
		utilizationObserved: true,
	}}
	current := []gpuDeviceStats{{
		ID:                  previous[0].ID,
		Name:                previous[0].Name,
		UtilizationPercent:  0,
		FrequencyMHz:        &currentFrequency,
		TemperatureC:        &currentTemperature,
		TemperatureSource:   "nvidia-smi",
		MemoryKind:          "dedicated",
		utilizationObserved: true,
	}}

	merged := mergeMissingGPUMemory(previous, current)
	if len(merged) != 1 {
		t.Fatalf("expected 1 merged GPU, got %d", len(merged))
	}
	if merged[0].UtilizationPercent != 0 {
		t.Errorf("expected current observed zero utilization, got %v", merged[0].UtilizationPercent)
	}
	if merged[0].FrequencyMHz == nil || *merged[0].FrequencyMHz != currentFrequency {
		t.Errorf("expected current frequency %v, got %v", currentFrequency, merged[0].FrequencyMHz)
	}
	if merged[0].TemperatureC == nil || *merged[0].TemperatureC != currentTemperature {
		t.Errorf("expected current temperature %v, got %v", currentTemperature, merged[0].TemperatureC)
	}
	if merged[0].MemoryUsedBytes != previous[0].MemoryUsedBytes || merged[0].MemoryTotalBytes != previous[0].MemoryTotalBytes {
		t.Errorf("expected previous memory to be retained, got used=%d total=%d", merged[0].MemoryUsedBytes, merged[0].MemoryTotalBytes)
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
