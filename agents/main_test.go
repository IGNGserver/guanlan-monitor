package main

import (
	"encoding/json"
	"testing"
	"time"
)

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
	used := 1990.164
	total := 16281.93
	load := 1.100329
	clock := 550.0

	metrics := mapHardwareSensors([]hardwareSensorSnapshot{{
		HardwareType: "GpuIntel",
		Name:         "Intel(R) UHD Graphics",
		InstanceID:   `PCI\VEN_8086&DEV_A788\3&11583659&0&10`,
		Sensors: []hardwareSensor{
			{SensorType: "Clock", Name: "GPU Core", Value: &clock},
			{SensorType: "Load", Name: "D3D 3D", Value: &load},
			{SensorType: "SmallData", Name: "D3D Shared Memory Used", Value: &used},
			{SensorType: "SmallData", Name: "D3D Shared Memory Total", Value: &total},
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
	if gpu.MemoryUsedBytes == 0 || gpu.MemoryTotalBytes == 0 {
		t.Fatalf("expected shared memory values, got used=%d total=%d", gpu.MemoryUsedBytes, gpu.MemoryTotalBytes)
	}
}

func TestDiskRateLookupNormalizesLinuxPartitionNames(t *testing.T) {
	rate := rateStats{ReadBytesPerSec: 123, WriteBytesPerSec: 456}
	got, ok := lookupDiskRate(map[string]rateStats{"sda": rate}, "/dev/sda2", "/")
	if !ok || got.ReadBytesPerSec != rate.ReadBytesPerSec || got.WriteBytesPerSec != rate.WriteBytesPerSec {
		t.Fatalf("expected /dev/sda2 to resolve to sda, got %#v, ok=%v", got, ok)
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
