package main

import (
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
