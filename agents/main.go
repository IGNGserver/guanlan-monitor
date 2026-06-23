package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
)

type agentIdentity struct {
	DeviceID string `json:"deviceId"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Platform string `json:"platform"`
	Arch     string `json:"arch"`
	CPUModel string `json:"cpuModel,omitempty"`
}

type memoryStats struct {
	TotalBytes     uint64 `json:"totalBytes"`
	UsedBytes      uint64 `json:"usedBytes"`
	SwapTotalBytes uint64 `json:"swapTotalBytes"`
	SwapUsedBytes  uint64 `json:"swapUsedBytes"`
}

type storageUsage struct {
	TotalBytes uint64 `json:"totalBytes"`
	UsedBytes  uint64 `json:"usedBytes"`
}

type diskDeviceStats struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	MountPoint string `json:"mountPoint"`
	FileSystem string `json:"filesystem,omitempty"`
	Model      string `json:"model,omitempty"`
	Vendor     string `json:"vendor,omitempty"`
	TotalBytes uint64 `json:"totalBytes"`
	UsedBytes  uint64 `json:"usedBytes"`
}

type rateStats struct {
	ReadBytesPerSec  float64 `json:"readBytesPerSec"`
	WriteBytesPerSec float64 `json:"writeBytesPerSec"`
}

type networkTrafficStats struct {
	RxBytesPerSec float64 `json:"rxBytesPerSec"`
	TxBytesPerSec float64 `json:"txBytesPerSec"`
	TotalRxBytes  uint64  `json:"totalRxBytes"`
	TotalTxBytes  uint64  `json:"totalTxBytes"`
}

type metricsPayload struct {
	Identity        agentIdentity       `json:"identity"`
	Timestamp       string              `json:"timestamp"`
	HeartbeatAt     string              `json:"heartbeatAt"`
	CPUUsagePercent float64             `json:"cpuUsagePercent"`
	Memory          memoryStats         `json:"memory"`
	DiskUsage       storageUsage        `json:"diskUsage"`
	Disks           []diskDeviceStats   `json:"disks,omitempty"`
	DiskRate        rateStats           `json:"diskRate"`
	NetworkRate     networkTrafficStats `json:"networkRate"`
}

type byteSnapshot struct {
	read  uint64
	write uint64
	rx    uint64
	tx    uint64
	at    time.Time
}

func main() {
	serverURL := env("DSC_SERVER_URL", "http://127.0.0.1:4000")
	secret := env("DSC_AGENT_SECRET", "replace-me-agent-secret")
	deviceID := env("DSC_DEVICE_ID", "")
	if deviceID == "" {
		name, _ := os.Hostname()
		deviceID = name
	}

	identity, err := buildIdentity(deviceID)
	if err != nil {
		log.Fatalf("build identity: %v", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	var previous *byteSnapshot

	log.Printf("agent started for %s -> %s", identity.DeviceID, serverURL)

	for {
		payload, nextSnapshot, err := collectMetrics(identity, previous)
		if err != nil {
			log.Printf("collect metrics failed: %v", err)
			<-ticker.C
			continue
		}

		if err := postMetrics(client, serverURL, secret, payload); err != nil {
			log.Printf("upload failed: %v", err)
		} else {
			log.Printf("uploaded metrics at %s", payload.Timestamp)
		}

		previous = nextSnapshot
		<-ticker.C
	}
}

func buildIdentity(deviceID string) (agentIdentity, error) {
	info, err := host.InfoWithContext(context.Background())
	if err != nil {
		return agentIdentity{}, err
	}
	cpuInfo, _ := cpu.InfoWithContext(context.Background())
	identity := agentIdentity{
		DeviceID: deviceID,
		Hostname: info.Hostname,
		OS:       normalizeOS(runtime.GOOS),
		Platform: info.Platform,
		Arch:     runtime.GOARCH,
	}
	if len(cpuInfo) > 0 {
		identity.CPUModel = cpuInfo[0].ModelName
	}
	return identity, nil
}

func collectMetrics(identity agentIdentity, previous *byteSnapshot) (metricsPayload, *byteSnapshot, error) {
	now := time.Now().UTC()

	cpuPercent, err := cpu.Percent(0, false)
	if err != nil {
		return metricsPayload{}, nil, err
	}

	virtualMemory, err := mem.VirtualMemory()
	if err != nil {
		return metricsPayload{}, nil, err
	}

	swapMemory, _ := mem.SwapMemory()
	disks, usage, err := collectDisks()
	if err != nil {
		return metricsPayload{}, nil, err
	}

	diskCounters, err := disk.IOCounters()
	if err != nil {
		return metricsPayload{}, nil, err
	}
	netCounters, err := net.IOCounters(false)
	if err != nil {
		return metricsPayload{}, nil, err
	}

	current := snapshotBytes(diskCounters, netCounters, now)
	diskRate, networkRate := computeRates(previous, current)

	payload := metricsPayload{
		Identity:        identity,
		Timestamp:       now.Format(time.RFC3339),
		HeartbeatAt:     now.Format(time.RFC3339),
		CPUUsagePercent: round(cpuPercent[0]),
		Memory: memoryStats{
			TotalBytes:     virtualMemory.Total,
			UsedBytes:      virtualMemory.Used,
			SwapTotalBytes: swapMemory.Total,
			SwapUsedBytes:  swapMemory.Used,
		},
		DiskUsage: storageUsage{
			TotalBytes: usage.Total,
			UsedBytes:  usage.Used,
		},
		Disks: disks,
		DiskRate: diskRate,
		NetworkRate: networkTrafficStats{
			RxBytesPerSec: networkRate.RxBytesPerSec,
			TxBytesPerSec: networkRate.TxBytesPerSec,
			TotalRxBytes:  current.rx,
			TotalTxBytes:  current.tx,
		},
	}

	return payload, current, nil
}

func collectDisks() ([]diskDeviceStats, storageUsage, error) {
	partitions, err := disk.Partitions(false)
	if err != nil {
		return nil, storageUsage{}, err
	}

	disks := make([]diskDeviceStats, 0, len(partitions))
	var totalBytes uint64
	var usedBytes uint64

	for _, partition := range partitions {
		if partition.Mountpoint == "" {
			continue
		}

		usage, err := disk.Usage(partition.Mountpoint)
		if err != nil || usage.Total == 0 {
			continue
		}

		disks = append(disks, diskDeviceStats{
			ID:         fmt.Sprintf("%s:%s", partition.Device, partition.Mountpoint),
			Name:       partition.Device,
			MountPoint: partition.Mountpoint,
			FileSystem: partition.Fstype,
			TotalBytes: usage.Total,
			UsedBytes:  usage.Used,
		})

		totalBytes += usage.Total
		usedBytes += usage.Used
	}

	if len(disks) == 0 {
		return nil, storageUsage{}, fmt.Errorf("no disks detected")
	}

	return disks, storageUsage{
		TotalBytes: totalBytes,
		UsedBytes:  usedBytes,
	}, nil
}

func snapshotBytes(diskCounters map[string]disk.IOCountersStat, netCounters []net.IOCountersStat, now time.Time) *byteSnapshot {
	var readBytes uint64
	var writeBytes uint64
	for _, counter := range diskCounters {
		readBytes += counter.ReadBytes
		writeBytes += counter.WriteBytes
	}

	var rxBytes uint64
	var txBytes uint64
	for _, counter := range netCounters {
		rxBytes += counter.BytesRecv
		txBytes += counter.BytesSent
	}

	return &byteSnapshot{
		read:  readBytes,
		write: writeBytes,
		rx:    rxBytes,
		tx:    txBytes,
		at:    now,
	}
}

func computeRates(previous, current *byteSnapshot) (rateStats, networkTrafficStats) {
	if previous == nil {
		return rateStats{}, networkTrafficStats{
			TotalRxBytes: current.rx,
			TotalTxBytes: current.tx,
		}
	}

	seconds := current.at.Sub(previous.at).Seconds()
	if seconds <= 0 {
		seconds = 5
	}

	return rateStats{
			ReadBytesPerSec:  round(float64(current.read-previous.read) / seconds),
			WriteBytesPerSec: round(float64(current.write-previous.write) / seconds),
		}, networkTrafficStats{
			RxBytesPerSec: round(float64(current.rx-previous.rx) / seconds),
			TxBytesPerSec: round(float64(current.tx-previous.tx) / seconds),
			TotalRxBytes:  current.rx,
			TotalTxBytes:  current.tx,
		}
}

func postMetrics(client *http.Client, serverURL, secret string, payload metricsPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/agent/ingest", serverURL), bytes.NewReader(body))
	if err != nil {
		return err
	}

	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Bearer %s", secret))

	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode >= 300 {
		return fmt.Errorf("unexpected status %s", response.Status)
	}
	return nil
}

func env(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func normalizeOS(goos string) string {
	switch goos {
	case "windows":
		return "windows"
	default:
		return "linux"
	}
}

func round(value float64) float64 {
	return float64(int(value*100)) / 100
}
