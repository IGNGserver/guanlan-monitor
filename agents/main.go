package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
)

const (
	defaultNormalIntervalSeconds = 15
	defaultFastIntervalSeconds   = 5
	defaultSlowIntervalSeconds   = 30
)

const (
	identityQueryTimeout     = 5 * time.Second
	cpuPackagesTimeout       = 4 * time.Second
	hardwareSensorsTimeout   = 8 * time.Second
	networkInterfacesTimeout = 4 * time.Second
	diskUsageTimeout         = 2 * time.Second
)

const (
	logCategoryConfigParse = "config_parse"
	logCategoryConfigRead  = "config_read"
	logCategoryUpload      = "upload"
	logCategorySlowMetrics = "slow_metrics"
	logCategoryCPUSlow     = "cpu_slow"
	logCategoryDiskSlow    = "disk_slow"
	logCategoryDiskFast    = "disk_fast"
	logCategoryNetworkSlow = "network_slow"
	logCategoryNetworkFast = "network_fast"
)

type collectorIssueError struct {
	category string
	err      error
}

func (e *collectorIssueError) Error() string {
	return e.err.Error()
}

func (e *collectorIssueError) Unwrap() error {
	return e.err
}

func newCollectorIssueError(category string, err error) error {
	if err == nil {
		return nil
	}
	return &collectorIssueError{
		category: category,
		err:      err,
	}
}

var errDiskUsageTimeout = errors.New("disk_usage_timeout")

var allMetricKeys = []string{
	"cpuUsage",
	"cpuFrequency",
	"cpuTemperature",
	"gpuUsage",
	"gpuEncode",
	"gpuDecode",
	"gpuFrequency",
	"gpuMemory",
	"gpuTemperature",
	"memoryUsage",
	"swapUsage",
	"diskUsage",
	"diskRead",
	"diskWrite",
	"networkRxRate",
	"networkTxRate",
	"networkTraffic",
}

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
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	MountPoint   string   `json:"mountPoint"`
	FileSystem   string   `json:"filesystem,omitempty"`
	Model        string   `json:"model,omitempty"`
	Vendor       string   `json:"vendor,omitempty"`
	SourceKey    string   `json:"sourceKey,omitempty"`
	TemperatureC *float64 `json:"temperatureC,omitempty"`
	TotalBytes   uint64   `json:"totalBytes"`
	UsedBytes    uint64   `json:"usedBytes"`
}

type cpuPackageStats struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Model        string   `json:"model,omitempty"`
	CoreCount    int      `json:"coreCount,omitempty"`
	LogicalCount int      `json:"logicalCount,omitempty"`
	FrequencyMHz *float64 `json:"frequencyMHz,omitempty"`
	UsagePercent *float64 `json:"usagePercent,omitempty"`
	TemperatureC *float64 `json:"temperatureC,omitempty"`
}

type rateStats struct {
	ReadBytesPerSec  float64              `json:"readBytesPerSec"`
	WriteBytesPerSec float64              `json:"writeBytesPerSec"`
	Instances        map[string]rateStats `json:"instances,omitempty"`
}

type networkTrafficStats struct {
	RxBytesPerSec float64 `json:"rxBytesPerSec"`
	TxBytesPerSec float64 `json:"txBytesPerSec"`
	TotalRxBytes  uint64  `json:"totalRxBytes"`
	TotalTxBytes  uint64  `json:"totalTxBytes"`
}

type networkInterfaceStats struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	MacAddress    string   `json:"macAddress,omitempty"`
	IPv4          []string `json:"ipv4,omitempty"`
	IPv6          []string `json:"ipv6,omitempty"`
	RxBytesPerSec float64  `json:"rxBytesPerSec,omitempty"`
	TxBytesPerSec float64  `json:"txBytesPerSec,omitempty"`
	TotalRxBytes  uint64   `json:"totalRxBytes,omitempty"`
	TotalTxBytes  uint64   `json:"totalTxBytes,omitempty"`
}

type gpuDeviceStats struct {
	ID                       string   `json:"id"`
	Name                     string   `json:"name"`
	UtilizationPercent       float64  `json:"utilizationPercent"`
	EncodeUtilizationPercent *float64 `json:"encodeUtilizationPercent,omitempty"`
	DecodeUtilizationPercent *float64 `json:"decodeUtilizationPercent,omitempty"`
	FrequencyMHz             *float64 `json:"frequencyMHz,omitempty"`
	MemoryUsedBytes          uint64   `json:"memoryUsedBytes"`
	MemoryTotalBytes         uint64   `json:"memoryTotalBytes"`
	TemperatureC             *float64 `json:"temperatureC,omitempty"`
}

type fanSensorStats struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Interface string `json:"interface"`
	RPM       int    `json:"rpm"`
	Note      string `json:"note,omitempty"`
}

type sensorBackendStatus struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

type metricsPayload struct {
	Identity        agentIdentity           `json:"identity"`
	Timestamp       string                  `json:"timestamp"`
	HeartbeatAt     string                  `json:"heartbeatAt"`
	CPUUsagePercent float64                 `json:"cpuUsagePercent"`
	CPUFrequencyMHz *float64                `json:"cpuFrequencyMHz,omitempty"`
	CPUTemperatureC *float64                `json:"cpuTemperatureC,omitempty"`
	CPUPackages     []cpuPackageStats       `json:"cpuPackages,omitempty"`
	Memory          memoryStats             `json:"memory"`
	DiskUsage       storageUsage            `json:"diskUsage"`
	Disks           []diskDeviceStats       `json:"disks,omitempty"`
	DiskRate        rateStats               `json:"diskRate"`
	NetworkRate     networkTrafficStats     `json:"networkRate"`
	NetworkIfaces   []networkInterfaceStats `json:"networkInterfaces,omitempty"`
	GPUs            []gpuDeviceStats        `json:"gpus"`
	Fans            []fanSensorStats        `json:"fans"`
	SensorBackends  []sensorBackendStatus   `json:"sensorBackends,omitempty"`
}

type agentConnectionConfig struct {
	ServerURL string `json:"serverUrl"`
	Secret    string `json:"secret"`
	DeviceID  string `json:"deviceId"`
	Hostname  string `json:"hostname"`
}

type agentSamplingConfig struct {
	NormalIntervalSeconds int    `json:"normalIntervalSeconds"`
	FastIntervalSeconds   int    `json:"fastIntervalSeconds"`
	SlowIntervalSeconds   int    `json:"slowIntervalSeconds"`
	RealtimeModeEnabled   bool   `json:"realtimeModeEnabled"`
	RealtimeModeExpiresAt string `json:"realtimeModeExpiresAt,omitempty"`
	RealtimeModeSource    string `json:"realtimeModeSource,omitempty"`
}

type agentProbeSelection struct {
	Target   string `json:"target"`
	Provider string `json:"provider"`
	Enabled  bool   `json:"enabled"`
}

type agentConfigFile struct {
	Connection           agentConnectionConfig `json:"connection"`
	Sampling             agentSamplingConfig   `json:"sampling"`
	EnabledMetrics       []string              `json:"enabledMetrics"`
	EnabledDeviceIDs     map[string][]string   `json:"enabledDeviceIds"`
	InstanceMetricConfig map[string][]string   `json:"instanceMetricConfig"`
	ProbeSelections      []agentProbeSelection `json:"probeSelections"`
	CloudSyncEnabled     bool                  `json:"cloudSyncEnabled"`
	DataRecordingEnabled *bool                 `json:"dataRecordingEnabled"`
}

type agentRuntimeConfig struct {
	Connection           agentConnectionConfig
	Sampling             agentSamplingConfig
	EnabledMetrics       []string
	EnabledDeviceIDs     map[string][]string
	InstanceMetricConfig map[string][]string
	ProbeSelections      []agentProbeSelection
	CloudSyncEnabled     bool
	DataRecordingEnabled bool
}

type cpuSnapshot struct {
	idle  float64
	total float64
}

type ioSnapshot struct {
	read      uint64
	write     uint64
	rx        uint64
	tx        uint64
	diskByKey map[string]rateSnapshot
	netByKey  map[string]netSnapshot
	at        time.Time
}

type rateSnapshot struct {
	read  uint64
	write uint64
}

type netSnapshot struct {
	rx uint64
	tx uint64
}

type slowMetrics struct {
	collectedAt       time.Time
	cpuFrequencyMHz   *float64
	cpuTemperatureC   *float64
	cpuPackages       []cpuPackageStats
	diskUsage         storageUsage
	disks             []diskDeviceStats
	networkInterfaces []networkInterfaceStats
	gpus              []gpuDeviceStats
	fans              []fanSensorStats
	sensorBackends    []sensorBackendStatus
}

type agentState struct {
	baseIdentity agentIdentity
	configPath   string
	client       *http.Client
	lastCPU      cpuSnapshot
	hasLastCPU   bool
	lastIO       *ioSnapshot
	lastSlow     slowMetrics
	hasSlow      bool
	currentCfg   agentRuntimeConfig
	hasConfig    bool
}

func main() {
	defaultConnection := agentConnectionConfig{
		ServerURL: env("DSC_SERVER_URL", "http://127.0.0.1:3100"),
		Secret:    env("DSC_AGENT_SECRET", "replace-me-agent-secret"),
		DeviceID:  env("DSC_DEVICE_ID", ""),
		Hostname:  env("DSC_HOSTNAME", ""),
	}
	if defaultConnection.DeviceID == "" {
		name, _ := os.Hostname()
		defaultConnection.DeviceID = name
	}

	baseIdentity, err := buildIdentity(defaultConnection.DeviceID, defaultConnection.Hostname)
	if err != nil {
		log.Fatalf("build identity: %v", err)
	}

	state := &agentState{
		baseIdentity: baseIdentity,
		configPath:   env("DSC_AGENT_CONFIG_FILE", ""),
		client:       &http.Client{Timeout: 10 * time.Second},
	}

	defaultConfig := newDefaultRuntimeConfig(defaultConnection)
	log.Printf("go agent v%s started for %s -> %s", BuildVersion, baseIdentity.DeviceID, defaultConnection.ServerURL)

	for {
		cycleStartedAt := time.Now()
		cfg := state.loadRuntimeConfig(defaultConfig)
		if !cfg.DataRecordingEnabled {
			log.Printf("data recording is disabled; collector remains unregistered")
			time.Sleep(time.Duration(cfg.currentUploadIntervalSeconds()) * time.Second)
			continue
		}
		payload := state.collectPayload(cfg)
		if err := postMetrics(state.client, cfg.Connection.ServerURL, cfg.Connection.Secret, payload); err != nil {
			logCategoryf(logCategoryUpload, "upload failed: %v", err)
		} else {
			log.Printf("uploaded metrics at %s", payload.Timestamp)
		}

		nextCycleAt := cycleStartedAt.Add(time.Duration(cfg.currentUploadIntervalSeconds()) * time.Second)
		if sleepDuration := time.Until(nextCycleAt); sleepDuration > 0 {
			time.Sleep(sleepDuration)
		}
	}
}

func buildIdentity(deviceID, hostnameOverride string) (agentIdentity, error) {
	infoCtx, infoCancel := context.WithTimeout(context.Background(), identityQueryTimeout)
	defer infoCancel()
	info, err := host.InfoWithContext(infoCtx)
	if err != nil {
		return agentIdentity{}, err
	}
	cpuCtx, cpuCancel := context.WithTimeout(context.Background(), identityQueryTimeout)
	defer cpuCancel()
	cpuInfo, _ := cpu.InfoWithContext(cpuCtx)
	hostname := strings.TrimSpace(hostnameOverride)
	if hostname == "" {
		hostname = info.Hostname
	}
	if hostname == "" {
		hostname = deviceID
	}
	identity := agentIdentity{
		DeviceID: deviceID,
		Hostname: hostname,
		OS:       normalizeOS(runtime.GOOS),
		Platform: info.Platform,
		Arch:     runtime.GOARCH,
	}
	if len(cpuInfo) > 0 {
		identity.CPUModel = cpuInfo[0].ModelName
	}
	return identity, nil
}

func newDefaultRuntimeConfig(connection agentConnectionConfig) agentRuntimeConfig {
	return agentRuntimeConfig{
		Connection: connection,
		Sampling: agentSamplingConfig{
			NormalIntervalSeconds: defaultNormalIntervalSeconds,
			FastIntervalSeconds:   defaultFastIntervalSeconds,
			SlowIntervalSeconds:   defaultSlowIntervalSeconds,
			RealtimeModeEnabled:   false,
		},
		EnabledMetrics:       append([]string{}, allMetricKeys...),
		EnabledDeviceIDs:     map[string][]string{},
		InstanceMetricConfig: map[string][]string{},
		ProbeSelections: []agentProbeSelection{
			{Target: "cpu", Provider: "builtin", Enabled: true},
			{Target: "memory", Provider: "builtin", Enabled: true},
			{Target: "disk", Provider: "builtin", Enabled: true},
			{Target: "network", Provider: "builtin", Enabled: true},
			{Target: "gpu", Provider: "disabled", Enabled: false},
			{Target: "fan", Provider: "disabled", Enabled: false},
		},
		CloudSyncEnabled:     true,
		DataRecordingEnabled: true,
	}
}

func (s *agentState) loadRuntimeConfig(defaults agentRuntimeConfig) agentRuntimeConfig {
	cfg := defaults
	if s.configPath != "" {
		raw, err := os.ReadFile(s.configPath)
		if err == nil && len(raw) > 0 {
			raw = trimUTF8BOM(raw)
			var fileCfg agentConfigFile
			if unmarshalErr := json.Unmarshal(raw, &fileCfg); unmarshalErr != nil {
				logCategoryf(logCategoryConfigParse, "agent config parse failed: %v", unmarshalErr)
			} else {
				cfg = mergeConfig(defaults, fileCfg)
			}
		} else if err != nil && !os.IsNotExist(err) {
			logCategoryf(logCategoryConfigRead, "agent config read failed: %v", err)
		}
	}
	s.currentCfg = cfg
	s.hasConfig = true
	return cfg
}

func trimUTF8BOM(raw []byte) []byte {
	return bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
}

func mergeConfig(defaults agentRuntimeConfig, fileCfg agentConfigFile) agentRuntimeConfig {
	cfg := defaults
	if strings.TrimSpace(fileCfg.Connection.ServerURL) != "" {
		cfg.Connection.ServerURL = strings.TrimSpace(fileCfg.Connection.ServerURL)
	}
	if strings.TrimSpace(fileCfg.Connection.Secret) != "" {
		cfg.Connection.Secret = strings.TrimSpace(fileCfg.Connection.Secret)
	}
	if strings.TrimSpace(fileCfg.Connection.DeviceID) != "" {
		cfg.Connection.DeviceID = strings.TrimSpace(fileCfg.Connection.DeviceID)
	}
	if strings.TrimSpace(fileCfg.Connection.Hostname) != "" {
		cfg.Connection.Hostname = strings.TrimSpace(fileCfg.Connection.Hostname)
	}
	if fileCfg.Sampling.FastIntervalSeconds > 0 {
		cfg.Sampling.FastIntervalSeconds = fileCfg.Sampling.FastIntervalSeconds
	}
	if fileCfg.Sampling.NormalIntervalSeconds > 0 {
		cfg.Sampling.NormalIntervalSeconds = fileCfg.Sampling.NormalIntervalSeconds
	}
	if fileCfg.Sampling.SlowIntervalSeconds > 0 {
		cfg.Sampling.SlowIntervalSeconds = fileCfg.Sampling.SlowIntervalSeconds
	}
	cfg.Sampling.RealtimeModeEnabled = fileCfg.Sampling.RealtimeModeEnabled
	if len(fileCfg.EnabledMetrics) > 0 {
		cfg.EnabledMetrics = uniqueStrings(fileCfg.EnabledMetrics)
	}
	if fileCfg.EnabledDeviceIDs != nil {
		cfg.EnabledDeviceIDs = sanitizeStringMap(fileCfg.EnabledDeviceIDs)
	}
	if fileCfg.InstanceMetricConfig != nil {
		cfg.InstanceMetricConfig = sanitizeStringMap(fileCfg.InstanceMetricConfig)
	}
	if len(fileCfg.ProbeSelections) > 0 {
		cfg.ProbeSelections = fileCfg.ProbeSelections
	}
	cfg.CloudSyncEnabled = fileCfg.CloudSyncEnabled
	if fileCfg.DataRecordingEnabled != nil {
		cfg.DataRecordingEnabled = *fileCfg.DataRecordingEnabled
	}
	return cfg
}

func (c agentRuntimeConfig) fastIntervalSeconds() int {
	if c.Sampling.FastIntervalSeconds > 0 {
		return c.Sampling.FastIntervalSeconds
	}
	return defaultFastIntervalSeconds
}

func (c agentRuntimeConfig) normalIntervalSeconds() int {
	if c.Sampling.NormalIntervalSeconds > 0 {
		return c.Sampling.NormalIntervalSeconds
	}
	return defaultNormalIntervalSeconds
}

func (c agentRuntimeConfig) slowIntervalSeconds() int {
	if c.Sampling.SlowIntervalSeconds > 0 {
		return c.Sampling.SlowIntervalSeconds
	}
	return defaultSlowIntervalSeconds
}

func (c agentRuntimeConfig) currentUploadIntervalSeconds() int {
	if c.Sampling.RealtimeModeEnabled {
		return c.fastIntervalSeconds()
	}
	return c.normalIntervalSeconds()
}

func (s *agentState) currentIdentity(cfg agentRuntimeConfig) agentIdentity {
	identity := s.baseIdentity
	if strings.TrimSpace(cfg.Connection.DeviceID) != "" {
		identity.DeviceID = strings.TrimSpace(cfg.Connection.DeviceID)
	}
	if strings.TrimSpace(cfg.Connection.Hostname) != "" {
		identity.Hostname = strings.TrimSpace(cfg.Connection.Hostname)
	}
	return identity
}

func (s *agentState) collectPayload(cfg agentRuntimeConfig) metricsPayload {
	now := time.Now().UTC()
	identity := s.currentIdentity(cfg)
	cpuUsagePercent := s.sampleCPUUsage()
	memory := sampleMemory()
	diskRate, networkRate := s.sampleFastRates(now, cfg.currentUploadIntervalSeconds())

	if !s.hasSlow || now.Sub(s.lastSlow.collectedAt) >= time.Duration(cfg.slowIntervalSeconds())*time.Second {
		slow, err := collectSlowMetrics()
		if err != nil {
			var issueErr *collectorIssueError
			if errors.As(err, &issueErr) {
				logCategoryf(issueErr.category, "slow metrics refresh failed: %v", issueErr.err)
			} else {
				logCategoryf(logCategorySlowMetrics, "slow metrics refresh failed: %v", err)
			}
		} else {
			s.lastSlow = slow
			s.hasSlow = true
		}
	}

	slow := s.lastSlow
	if !s.hasSlow {
		slow = slowMetrics{
			cpuPackages:       []cpuPackageStats{},
			disks:             []diskDeviceStats{},
			networkInterfaces: []networkInterfaceStats{},
			gpus:              []gpuDeviceStats{},
			fans:              []fanSensorStats{},
			sensorBackends:    []sensorBackendStatus{},
		}
	}

	payload := metricsPayload{
		Identity:        identity,
		Timestamp:       now.Format(time.RFC3339),
		HeartbeatAt:     now.Format(time.RFC3339),
		CPUUsagePercent: cpuUsagePercent,
		CPUFrequencyMHz: slow.cpuFrequencyMHz,
		CPUTemperatureC: slow.cpuTemperatureC,
		CPUPackages:     ensureCPUPackages(slow.cpuPackages),
		Memory:          memory,
		DiskUsage:       slow.diskUsage,
		Disks:           slow.disks,
		DiskRate:        diskRate,
		NetworkRate:     networkRate,
		NetworkIfaces:   slow.networkInterfaces,
		GPUs:            ensureGPUs(slow.gpus),
		Fans:            ensureFans(slow.fans),
		SensorBackends:  slow.sensorBackends,
	}

	applyRuntimeConfig(&payload, cfg)
	return payload
}

func (s *agentState) sampleCPUUsage() float64 {
	times, err := cpu.Times(false)
	if err != nil || len(times) == 0 {
		return 0
	}

	current := cpuSnapshot{
		idle:  times[0].Idle,
		total: times[0].User + times[0].System + times[0].Idle + times[0].Nice + times[0].Iowait + times[0].Irq + times[0].Softirq + times[0].Steal,
	}

	if !s.hasLastCPU {
		s.lastCPU = current
		s.hasLastCPU = true
		return 0
	}

	idleDiff := current.idle - s.lastCPU.idle
	totalDiff := current.total - s.lastCPU.total
	s.lastCPU = current
	if totalDiff <= 0 {
		return 0
	}
	return round((1 - idleDiff/totalDiff) * 100)
}

func sampleMemory() memoryStats {
	virtualMemory, err := mem.VirtualMemory()
	if err != nil {
		return memoryStats{}
	}
	swapMemory, _ := mem.SwapMemory()
	return memoryStats{
		TotalBytes:     virtualMemory.Total,
		UsedBytes:      virtualMemory.Used,
		SwapTotalBytes: swapMemory.Total,
		SwapUsedBytes:  swapMemory.Used,
	}
}

func (s *agentState) sampleFastRates(now time.Time, fallbackSeconds int) (rateStats, networkTrafficStats) {
	diskCounters, diskErr := disk.IOCounters()
	netCounters, netErr := gnet.IOCounters(true)
	if diskErr != nil {
		logCategoryf(logCategoryDiskFast, "disk counters failed: %v", diskErr)
	}
	if netErr != nil {
		logCategoryf(logCategoryNetworkFast, "network counters failed: %v", netErr)
	}

	current := snapshotIO(diskCounters, netCounters, now)
	diskRate, networkRate := computeRates(s.lastIO, current, fallbackSeconds)
	s.lastIO = current
	return diskRate, networkRate
}

func collectSlowMetrics() (slowMetrics, error) {
	cpuFrequencyMHz, cpuPackages, cpuErr := collectCPUPackages()
	if cpuErr != nil {
		return slowMetrics{}, cpuErr
	}

	disks, diskUsage, diskErr := collectDisks()
	if diskErr != nil {
		return slowMetrics{}, diskErr
	}

	networkInterfaces, networkErr := collectNetworkInterfaces()
	if networkErr != nil {
		return slowMetrics{}, networkErr
	}

	hardware := collectHardwareSensors()
	if len(hardware.gpus) == 0 {
		hardware.gpus = collectNvidiaGPUs()
	}
	if hardware.cpuFrequencyMHz == nil {
		hardware.cpuFrequencyMHz = collectWindowsCPUFrequency(cpuFrequencyMHz)
	}
	if hardware.cpuFrequencyMHz != nil {
		cpuFrequencyMHz = hardware.cpuFrequencyMHz
		for index := range cpuPackages {
			cpuPackages[index].FrequencyMHz = hardware.cpuFrequencyMHz
		}
	}

	return slowMetrics{
		collectedAt:       time.Now().UTC(),
		cpuFrequencyMHz:   cpuFrequencyMHz,
		cpuTemperatureC:   hardware.cpuTemperatureC,
		cpuPackages:       cpuPackages,
		diskUsage:         diskUsage,
		disks:             disks,
		networkInterfaces: networkInterfaces,
		gpus:              hardware.gpus,
		fans:              []fanSensorStats{},
		sensorBackends:    []sensorBackendStatus{},
	}, nil
}

func collectCPUPackages() (*float64, []cpuPackageStats, error) {
	infoCtx, infoCancel := context.WithTimeout(context.Background(), cpuPackagesTimeout)
	defer infoCancel()
	info, err := cpu.InfoWithContext(infoCtx)
	if err != nil {
		return nil, nil, newCollectorIssueError(logCategoryCPUSlow, err)
	}
	countsCtx, countsCancel := context.WithTimeout(context.Background(), cpuPackagesTimeout)
	defer countsCancel()
	logicalCount, _ := cpu.CountsWithContext(countsCtx, true)
	physicalCount, _ := cpu.CountsWithContext(countsCtx, false)

	type packageAccumulator struct {
		id           string
		name         string
		model        string
		coreCount    int
		logicalCount int
		frequencies  []float64
	}

	packages := map[string]*packageAccumulator{}
	order := []string{}
	allFrequencies := []float64{}

	for index, entry := range info {
		key := strings.TrimSpace(entry.PhysicalID)
		if key == "" {
			key = "cpu-0"
		} else {
			key = fmt.Sprintf("cpu-%s", sanitizeKey(key))
		}
		if _, exists := packages[key]; !exists {
			name := entry.ModelName
			if name == "" {
				name = fmt.Sprintf("CPU %d", len(packages)+1)
			}
			packages[key] = &packageAccumulator{
				id:    key,
				name:  name,
				model: entry.ModelName,
			}
			order = append(order, key)
		}
		current := packages[key]
		current.coreCount += int(entry.Cores)
		if entry.Mhz > 0 {
			current.frequencies = append(current.frequencies, entry.Mhz)
			allFrequencies = append(allFrequencies, entry.Mhz)
		}
		if strings.TrimSpace(entry.PhysicalID) == "" && len(info) == 1 {
			current.logicalCount = logicalCount
			if physicalCount > 0 {
				current.coreCount = physicalCount
			}
		}
		if current.name == "" {
			current.name = fmt.Sprintf("CPU %d", index+1)
		}
	}

	if len(packages) == 0 {
		return nil, []cpuPackageStats{}, nil
	}

	fallbackLogical := 0
	if len(packages) > 0 && logicalCount > 0 {
		fallbackLogical = int(math.Max(1, math.Round(float64(logicalCount)/float64(len(packages)))))
	}

	result := make([]cpuPackageStats, 0, len(order))
	for _, key := range order {
		entry := packages[key]
		freq := averagePointer(entry.frequencies)
		logical := entry.logicalCount
		if logical == 0 {
			logical = fallbackLogical
		}
		result = append(result, cpuPackageStats{
			ID:           entry.id,
			Name:         entry.name,
			Model:        entry.model,
			CoreCount:    entry.coreCount,
			LogicalCount: logical,
			FrequencyMHz: freq,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].ID < result[j].ID
	})

	return averagePointer(allFrequencies), result, nil
}

type hardwareSensorSnapshot struct {
	HardwareType string           `json:"hardwareType"`
	Name         string           `json:"name"`
	Sensors      []hardwareSensor `json:"sensors"`
}

type hardwareSensor struct {
	SensorType string   `json:"sensorType"`
	Name       string   `json:"name"`
	Value      *float64 `json:"value"`
}

type hardwareSensorMetrics struct {
	cpuFrequencyMHz *float64
	cpuTemperatureC *float64
	gpus            []gpuDeviceStats
}

// LibreHardwareMonitor exposes live clocks, including CPU boost clocks, where WMI often reports a nominal value.
func collectHardwareSensors() hardwareSensorMetrics {
	if runtime.GOOS != "windows" {
		return hardwareSensorMetrics{gpus: []gpuDeviceStats{}}
	}

	dllPath := resolveHardwareMonitorPath()
	if dllPath == "" {
		return hardwareSensorMetrics{gpus: []gpuDeviceStats{}}
	}

	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='Stop'; Add-Type -Path $env:DSC_LHM_DLL; $computer=New-Object LibreHardwareMonitor.Hardware.Computer; $computer.IsCpuEnabled=$true; $computer.IsGpuEnabled=$true; $computer.Open(); function Read-Hardware($hardware) { $hardware.Update(); $result=@([pscustomobject]@{ hardwareType=[string]$hardware.HardwareType; name=[string]$hardware.Name; sensors=@($hardware.Sensors | ForEach-Object { [pscustomobject]@{ sensorType=[string]$_.SensorType; name=[string]$_.Name; value=$_.Value } }) }); foreach($sub in $hardware.SubHardware) { $result += Read-Hardware $sub }; return $result }; try { @($computer.Hardware | ForEach-Object { Read-Hardware $_ }) | ConvertTo-Json -Depth 5 -Compress } finally { $computer.Close() }`
	command := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", commandText)
	command.Env = append(os.Environ(), "DSC_LHM_DLL="+dllPath)
	output, err := command.Output()
	if err != nil {
		return hardwareSensorMetrics{gpus: []gpuDeviceStats{}}
	}

	snapshots, err := decodeHardwareSnapshots(output)
	if err != nil {
		return hardwareSensorMetrics{gpus: []gpuDeviceStats{}}
	}
	return mapHardwareSensors(snapshots)
}

func decodeHardwareSnapshots(raw []byte) ([]hardwareSensorSnapshot, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []hardwareSensorSnapshot{}, nil
	}
	var snapshots []hardwareSensorSnapshot
	if err := json.Unmarshal(trimmed, &snapshots); err == nil {
		return snapshots, nil
	}
	var single hardwareSensorSnapshot
	if err := json.Unmarshal(trimmed, &single); err != nil {
		return nil, err
	}
	return []hardwareSensorSnapshot{single}, nil
}

func resolveHardwareMonitorPath() string {
	candidates := []string{}
	if executable, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(executable), "windows-hardware", "librehardwaremonitor", "LibreHardwareMonitorLib.dll"))
	}
	if workingDirectory, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(workingDirectory, "windows-hardware", "librehardwaremonitor", "LibreHardwareMonitorLib.dll"))
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func mapHardwareSensors(snapshots []hardwareSensorSnapshot) hardwareSensorMetrics {
	metrics := hardwareSensorMetrics{gpus: []gpuDeviceStats{}}
	cpuClocks := []float64{}
	cpuTemperatures := []float64{}

	for _, snapshot := range snapshots {
		hardwareType := strings.ToLower(snapshot.HardwareType)
		if hardwareType == "cpu" {
			for _, sensor := range snapshot.Sensors {
				if sensor.Value == nil || !isFinitePositive(*sensor.Value) {
					continue
				}
				sensorType := strings.ToLower(sensor.SensorType)
				sensorName := strings.ToLower(sensor.Name)
				if sensorType == "clock" && !strings.Contains(sensorName, "bus") && !strings.Contains(sensorName, "base") {
					cpuClocks = append(cpuClocks, *sensor.Value)
				}
				if sensorType == "temperature" && (strings.Contains(sensorName, "package") || strings.Contains(sensorName, "core")) {
					cpuTemperatures = append(cpuTemperatures, *sensor.Value)
				}
			}
			continue
		}

		if !strings.HasPrefix(hardwareType, "gpu") {
			continue
		}

		gpu := gpuDeviceStats{
			ID:   "gpu-" + sanitizeKey(snapshot.Name),
			Name: snapshot.Name,
		}
		var clock, load, temperature, memoryUsed, memoryTotal *float64
		for _, sensor := range snapshot.Sensors {
			if sensor.Value == nil || !isFinitePositive(*sensor.Value) {
				continue
			}
			sensorType := strings.ToLower(sensor.SensorType)
			sensorName := strings.ToLower(sensor.Name)
			switch {
			case sensorType == "clock" && (strings.Contains(sensorName, "core") || strings.Contains(sensorName, "gpu")):
				clock = maxSensorValue(clock, sensor.Value)
			case sensorType == "load" && (strings.Contains(sensorName, "core") || strings.Contains(sensorName, "gpu")):
				load = maxSensorValue(load, sensor.Value)
			case sensorType == "temperature" && (strings.Contains(sensorName, "core") || strings.Contains(sensorName, "gpu")):
				temperature = maxSensorValue(temperature, sensor.Value)
			case (sensorType == "data" || sensorType == "small data") && strings.Contains(sensorName, "memory used"):
				memoryUsed = sensor.Value
			case (sensorType == "data" || sensorType == "small data") && strings.Contains(sensorName, "memory total"):
				memoryTotal = sensor.Value
			}
		}
		if clock == nil && load == nil && temperature == nil {
			continue
		}
		gpu.FrequencyMHz = clock
		gpu.TemperatureC = temperature
		if load != nil {
			gpu.UtilizationPercent = *load
		}
		if memoryUsed != nil {
			gpu.MemoryUsedBytes = uint64(*memoryUsed * 1024 * 1024)
		}
		if memoryTotal != nil {
			gpu.MemoryTotalBytes = uint64(*memoryTotal * 1024 * 1024)
		}
		metrics.gpus = append(metrics.gpus, gpu)
	}

	metrics.cpuFrequencyMHz = averagePointer(cpuClocks)
	metrics.cpuTemperatureC = averagePointer(cpuTemperatures)
	return metrics
}

// Processor Performance is a percentage of the nominal clock and can exceed 100 while Intel Turbo Boost is active.
func collectWindowsCPUFrequency(nominalMHz *float64) *float64 {
	if runtime.GOOS != "windows" || nominalMHz == nil || !isFinitePositive(*nominalMHz) {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='Stop'; $samples=(Get-Counter '\Processor Information(*)\% Processor Performance').CounterSamples | Where-Object { $_.InstanceName -notmatch '_Total' }; if($samples.Count -eq 0){exit 1}; [Math]::Round((($samples | Measure-Object -Property CookedValue -Average).Average), 3)`
	output, err := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", commandText).Output()
	if err != nil {
		return nil
	}
	performancePercent, err := strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
	if err != nil || !isFinitePositive(performancePercent) {
		return nil
	}
	frequency := *nominalMHz * performancePercent / 100
	if !isFinitePositive(frequency) {
		return nil
	}
	return &frequency
}

// NVIDIA's driver reports the actual graphics clock, including boost states, through nvidia-smi.
func collectNvidiaGPUs() []gpuDeviceStats {
	if runtime.GOOS != "windows" {
		return []gpuDeviceStats{}
	}

	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	output, err := exec.CommandContext(
		ctx,
		"nvidia-smi.exe",
		"--query-gpu=name,utilization.gpu,clocks.current.graphics,temperature.gpu,memory.used,memory.total",
		"--format=csv,noheader,nounits",
	).Output()
	if err != nil {
		return []gpuDeviceStats{}
	}

	result := []gpuDeviceStats{}
	for index, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		parts := strings.Split(strings.TrimSpace(line), ",")
		if len(parts) != 6 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		frequency, ok := parsePositiveFloat(parts[2])
		if !ok {
			continue
		}
		gpu := gpuDeviceStats{
			ID:           fmt.Sprintf("gpu-%s-%d", sanitizeKey(name), index),
			Name:         name,
			FrequencyMHz: &frequency,
		}
		if value, ok := parsePositiveFloat(parts[1]); ok {
			gpu.UtilizationPercent = value
		}
		if value, ok := parsePositiveFloat(parts[3]); ok {
			gpu.TemperatureC = &value
		}
		if value, ok := parsePositiveFloat(parts[4]); ok {
			gpu.MemoryUsedBytes = uint64(value * 1024 * 1024)
		}
		if value, ok := parsePositiveFloat(parts[5]); ok {
			gpu.MemoryTotalBytes = uint64(value * 1024 * 1024)
		}
		result = append(result, gpu)
	}
	return result
}

func parsePositiveFloat(raw string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || !isFinitePositive(value) {
		return 0, false
	}
	return value, true
}

func isFinitePositive(value float64) bool {
	return value > 0 && !math.IsInf(value, 0) && !math.IsNaN(value)
}

func maxSensorValue(current, candidate *float64) *float64 {
	if candidate == nil || !isFinitePositive(*candidate) {
		return current
	}
	if current == nil || *candidate > *current {
		value := *candidate
		return &value
	}
	return current
}

func collectDisks() ([]diskDeviceStats, storageUsage, error) {
	partitions, err := disk.Partitions(false)
	if err != nil {
		return nil, storageUsage{}, err
	}

	disks := make([]diskDeviceStats, 0, len(partitions))
	seen := map[string]struct{}{}
	var totalBytes uint64
	var usedBytes uint64

	for _, partition := range partitions {
		mountPoint := strings.TrimSpace(partition.Mountpoint)
		if mountPoint == "" || shouldSkipMount(mountPoint, partition.Device, partition.Fstype) {
			continue
		}
		if _, exists := seen[mountPoint]; exists {
			continue
		}
		seen[mountPoint] = struct{}{}

		usage, usageErr := diskUsageWithTimeout(mountPoint, diskUsageTimeout)
		if usageErr != nil {
			if errors.Is(usageErr, errDiskUsageTimeout) {
				logCategoryf(logCategoryDiskSlow, "disk usage skipped for %s: %v", mountPoint, usageErr)
			}
			continue
		}
		if usage.Total == 0 {
			continue
		}

		deviceName := strings.TrimSpace(partition.Device)
		if deviceName == "" {
			deviceName = mountPoint
		}
		disks = append(disks, diskDeviceStats{
			ID:         fmt.Sprintf("%s:%s", deviceName, mountPoint),
			Name:       deviceName,
			MountPoint: mountPoint,
			FileSystem: partition.Fstype,
			SourceKey:  deviceName,
			TotalBytes: usage.Total,
			UsedBytes:  usage.Used,
		})
		totalBytes += usage.Total
		usedBytes += usage.Used
	}

	sort.Slice(disks, func(i, j int) bool {
		return disks[i].MountPoint < disks[j].MountPoint
	})

	return disks, storageUsage{
		TotalBytes: totalBytes,
		UsedBytes:  usedBytes,
	}, nil
}

func diskUsageWithTimeout(path string, timeout time.Duration) (*disk.UsageStat, error) {
	type usageResult struct {
		usage *disk.UsageStat
		err   error
	}

	resultCh := make(chan usageResult, 1)
	go func() {
		usage, err := disk.Usage(path)
		resultCh <- usageResult{
			usage: usage,
			err:   err,
		}
	}()

	select {
	case result := <-resultCh:
		return result.usage, result.err
	case <-time.After(timeout):
		return nil, fmt.Errorf("%w for %s after %s", errDiskUsageTimeout, path, timeout)
	}
}

func collectNetworkInterfaces() ([]networkInterfaceStats, error) {
	interfacesCtx, interfacesCancel := context.WithTimeout(context.Background(), networkInterfacesTimeout)
	defer interfacesCancel()
	interfaces, err := gnet.InterfacesWithContext(interfacesCtx)
	if err != nil {
		return nil, newCollectorIssueError(logCategoryNetworkSlow, err)
	}

	countersCtx, countersCancel := context.WithTimeout(context.Background(), networkInterfacesTimeout)
	defer countersCancel()
	counterRows, err := gnet.IOCountersWithContext(countersCtx, true)
	if err != nil {
		return nil, newCollectorIssueError(logCategoryNetworkSlow, err)
	}
	counters := make(map[string]gnet.IOCountersStat, len(counterRows))
	for _, row := range counterRows {
		counters[row.Name] = row
	}

	results := make([]networkInterfaceStats, 0, len(interfaces))
	for _, iface := range interfaces {
		if shouldSkipInterface(iface) {
			continue
		}

		ipv4 := make([]string, 0, len(iface.Addrs))
		ipv6 := make([]string, 0, len(iface.Addrs))
		for _, addr := range iface.Addrs {
			if addr.Addr == "" {
				continue
			}
			ip := strings.Split(addr.Addr, "/")[0]
			if strings.Contains(ip, ":") {
				ipv6 = append(ipv6, ip)
			} else {
				ipv4 = append(ipv4, ip)
			}
		}
		if len(ipv4) == 0 && len(ipv6) == 0 {
			continue
		}

		counter := counters[iface.Name]
		results = append(results, networkInterfaceStats{
			ID:           fmt.Sprintf("nic-%s", sanitizeKey(iface.Name)),
			Name:         iface.Name,
			MacAddress:   iface.HardwareAddr,
			IPv4:         ipv4,
			IPv6:         ipv6,
			TotalRxBytes: counter.BytesRecv,
			TotalTxBytes: counter.BytesSent,
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results, nil
}

func snapshotIO(diskCounters map[string]disk.IOCountersStat, netCounters []gnet.IOCountersStat, now time.Time) *ioSnapshot {
	var readBytes uint64
	var writeBytes uint64
	diskByKey := map[string]rateSnapshot{}
	for key, counter := range diskCounters {
		readBytes += counter.ReadBytes
		writeBytes += counter.WriteBytes
		diskByKey[key] = rateSnapshot{read: counter.ReadBytes, write: counter.WriteBytes}
	}

	var rxBytes uint64
	var txBytes uint64
	netByKey := map[string]netSnapshot{}
	for _, counter := range netCounters {
		rxBytes += counter.BytesRecv
		txBytes += counter.BytesSent
		netByKey[counter.Name] = netSnapshot{rx: counter.BytesRecv, tx: counter.BytesSent}
	}

	return &ioSnapshot{
		read:      readBytes,
		write:     writeBytes,
		rx:        rxBytes,
		tx:        txBytes,
		diskByKey: diskByKey,
		netByKey:  netByKey,
		at:        now,
	}
}

func computeRates(previous, current *ioSnapshot, fallbackSeconds int) (rateStats, networkTrafficStats) {
	if previous == nil {
		return rateStats{}, networkTrafficStats{
			TotalRxBytes: current.rx,
			TotalTxBytes: current.tx,
		}
	}

	seconds := current.at.Sub(previous.at).Seconds()
	if seconds <= 0 {
		seconds = float64(max(1, fallbackSeconds))
	}

	diskInstances := map[string]rateStats{}
	for key, currentDisk := range current.diskByKey {
		prevDisk, ok := previous.diskByKey[key]
		if !ok {
			continue
		}
		diskInstances[key] = rateStats{
			ReadBytesPerSec:  round(float64(max64(0, int64(currentDisk.read)-int64(prevDisk.read))) / seconds),
			WriteBytesPerSec: round(float64(max64(0, int64(currentDisk.write)-int64(prevDisk.write))) / seconds),
		}
	}

	return rateStats{
			ReadBytesPerSec:  round(float64(max64(0, int64(current.read)-int64(previous.read))) / seconds),
			WriteBytesPerSec: round(float64(max64(0, int64(current.write)-int64(previous.write))) / seconds),
			Instances:        diskInstances,
		}, networkTrafficStats{
			RxBytesPerSec: round(float64(max64(0, int64(current.rx)-int64(previous.rx))) / seconds),
			TxBytesPerSec: round(float64(max64(0, int64(current.tx)-int64(previous.tx))) / seconds),
			TotalRxBytes:  current.rx,
			TotalTxBytes:  current.tx,
		}
}

func applyRuntimeConfig(payload *metricsPayload, cfg agentRuntimeConfig) {
	enabledMetricSet := makeEnabledMetricSet(cfg.EnabledMetrics)
	enabledBlocks := makeEnabledBlockSet(cfg.ProbeSelections)

	if !enabledBlocks["cpu"] {
		payload.CPUUsagePercent = 0
		payload.CPUFrequencyMHz = nil
		payload.CPUTemperatureC = nil
		payload.CPUPackages = []cpuPackageStats{}
	} else {
		payload.CPUPackages = filterCPUPackages(payload.CPUPackages, cfg)
		cpuUsageEnabled := false
		cpuFrequencyEnabled := false
		cpuTemperatureEnabled := false
		for index := range payload.CPUPackages {
			instanceEnabled, hasOverride := resolveInstanceMetricSet(cfg, payload.CPUPackages[index].ID)
			if metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "cpuUsage") {
				cpuUsageEnabled = true
			} else {
				payload.CPUPackages[index].UsagePercent = nil
			}
			if metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "cpuFrequency") {
				cpuFrequencyEnabled = true
			} else {
				payload.CPUPackages[index].FrequencyMHz = nil
			}
			if metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "cpuTemperature") {
				cpuTemperatureEnabled = true
			} else {
				payload.CPUPackages[index].TemperatureC = nil
			}
		}
		if !enabledMetricSet["cpuUsage"] {
			payload.CPUUsagePercent = 0
		} else if !cpuUsageEnabled {
			payload.CPUUsagePercent = 0
		}
		if !enabledMetricSet["cpuFrequency"] {
			payload.CPUFrequencyMHz = nil
		} else if !cpuFrequencyEnabled {
			payload.CPUFrequencyMHz = nil
		}
		if !enabledMetricSet["cpuTemperature"] {
			payload.CPUTemperatureC = nil
		} else if !cpuTemperatureEnabled {
			payload.CPUTemperatureC = nil
		}
	}

	if !enabledBlocks["memory"] {
		payload.Memory = memoryStats{}
	} else if !enabledMetricSet["memoryUsage"] && !enabledMetricSet["swapUsage"] {
		payload.Memory = memoryStats{}
	} else {
		if !enabledMetricSet["memoryUsage"] {
			payload.Memory.TotalBytes = 0
			payload.Memory.UsedBytes = 0
		}
		if !enabledMetricSet["swapUsage"] {
			payload.Memory.SwapTotalBytes = 0
			payload.Memory.SwapUsedBytes = 0
		}
	}

	if !enabledBlocks["disk"] {
		payload.DiskUsage = storageUsage{}
		payload.Disks = []diskDeviceStats{}
		payload.DiskRate = rateStats{}
	} else {
		payload.Disks = filterDisks(payload.Disks, cfg)
		diskUsageEnabled := false
		diskReadEnabled := false
		diskWriteEnabled := false
		if payload.DiskRate.Instances == nil {
			payload.DiskRate.Instances = map[string]rateStats{}
		}
		for index := range payload.Disks {
			instanceEnabled, hasOverride := resolveInstanceMetricSet(cfg, payload.Disks[index].ID)
			if metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "diskUsage") {
				diskUsageEnabled = true
			} else {
				payload.Disks[index].TotalBytes = 0
				payload.Disks[index].UsedBytes = 0
			}

			rate := payload.DiskRate.Instances[payload.Disks[index].ID]
			if payload.Disks[index].SourceKey != "" {
				if sourceRate, ok := payload.DiskRate.Instances[payload.Disks[index].SourceKey]; ok {
					rate = sourceRate
				}
			}

			if metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "diskRead") {
				diskReadEnabled = true
			} else {
				rate.ReadBytesPerSec = 0
			}
			if metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "diskWrite") {
				diskWriteEnabled = true
			} else {
				rate.WriteBytesPerSec = 0
			}
			payload.DiskRate.Instances[payload.Disks[index].ID] = rate
			if payload.Disks[index].SourceKey != "" {
				payload.DiskRate.Instances[payload.Disks[index].SourceKey] = rate
			}
		}
		if !enabledMetricSet["diskUsage"] {
			payload.DiskUsage = storageUsage{}
		} else if !diskUsageEnabled {
			payload.DiskUsage = storageUsage{}
		}
		if !enabledMetricSet["diskRead"] && !enabledMetricSet["diskWrite"] {
			payload.DiskRate = rateStats{}
		} else {
			if !enabledMetricSet["diskRead"] {
				payload.DiskRate.ReadBytesPerSec = 0
				for key, rate := range payload.DiskRate.Instances {
					rate.ReadBytesPerSec = 0
					payload.DiskRate.Instances[key] = rate
				}
			} else if !diskReadEnabled {
				payload.DiskRate.ReadBytesPerSec = 0
			}
			if !enabledMetricSet["diskWrite"] {
				payload.DiskRate.WriteBytesPerSec = 0
				for key, rate := range payload.DiskRate.Instances {
					rate.WriteBytesPerSec = 0
					payload.DiskRate.Instances[key] = rate
				}
			} else if !diskWriteEnabled {
				payload.DiskRate.WriteBytesPerSec = 0
			}
		}
	}

	if !enabledBlocks["network"] {
		payload.NetworkRate = networkTrafficStats{}
		payload.NetworkIfaces = []networkInterfaceStats{}
	} else {
		payload.NetworkIfaces = filterNetworkInterfaces(payload.NetworkIfaces, cfg)
		networkRxEnabled := false
		networkTxEnabled := false
		networkTrafficEnabled := false
		for index := range payload.NetworkIfaces {
			instanceEnabled, hasOverride := resolveInstanceMetricSet(cfg, payload.NetworkIfaces[index].ID)
			if metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "networkRxRate") {
				networkRxEnabled = true
			} else {
				payload.NetworkIfaces[index].RxBytesPerSec = 0
			}
			if metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "networkTxRate") {
				networkTxEnabled = true
			} else {
				payload.NetworkIfaces[index].TxBytesPerSec = 0
			}
			if metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "networkTraffic") {
				networkTrafficEnabled = true
			} else {
				payload.NetworkIfaces[index].TotalRxBytes = 0
				payload.NetworkIfaces[index].TotalTxBytes = 0
			}
		}
		if !enabledMetricSet["networkRxRate"] {
			payload.NetworkRate.RxBytesPerSec = 0
		} else if !networkRxEnabled {
			payload.NetworkRate.RxBytesPerSec = 0
		}
		if !enabledMetricSet["networkTxRate"] {
			payload.NetworkRate.TxBytesPerSec = 0
		} else if !networkTxEnabled {
			payload.NetworkRate.TxBytesPerSec = 0
		}
		if !enabledMetricSet["networkTraffic"] {
			payload.NetworkRate.TotalRxBytes = 0
			payload.NetworkRate.TotalTxBytes = 0
		} else if !networkTrafficEnabled {
			payload.NetworkRate.TotalRxBytes = 0
			payload.NetworkRate.TotalTxBytes = 0
		}
	}

	if !enabledBlocks["gpu"] {
		payload.GPUs = []gpuDeviceStats{}
	} else {
		payload.GPUs = filterGPUs(payload.GPUs, cfg)
		for index := range payload.GPUs {
			instanceEnabled, hasOverride := resolveInstanceMetricSet(cfg, payload.GPUs[index].ID)
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "gpuUsage") {
				payload.GPUs[index].UtilizationPercent = 0
			}
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "gpuEncode") {
				payload.GPUs[index].EncodeUtilizationPercent = nil
			}
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "gpuDecode") {
				payload.GPUs[index].DecodeUtilizationPercent = nil
			}
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "gpuFrequency") {
				payload.GPUs[index].FrequencyMHz = nil
			}
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "gpuMemory") {
				payload.GPUs[index].MemoryUsedBytes = 0
				payload.GPUs[index].MemoryTotalBytes = 0
			}
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "gpuTemperature") {
				payload.GPUs[index].TemperatureC = nil
			}
		}
	}

	if !enabledBlocks["fan"] {
		payload.Fans = []fanSensorStats{}
		payload.SensorBackends = []sensorBackendStatus{}
	}
}

func filterCPUPackages(items []cpuPackageStats, cfg agentRuntimeConfig) []cpuPackageStats {
	allowed := cfg.EnabledDeviceIDs["cpu"]
	if len(allowed) == 0 {
		return items
	}
	allowedSet := makeStringSet(allowed)
	filtered := make([]cpuPackageStats, 0, len(items))
	for _, item := range items {
		if allowedSet[item.ID] {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterDisks(items []diskDeviceStats, cfg agentRuntimeConfig) []diskDeviceStats {
	allowed := cfg.EnabledDeviceIDs["disk"]
	if len(allowed) == 0 {
		return items
	}
	allowedSet := makeStringSet(allowed)
	filtered := make([]diskDeviceStats, 0, len(items))
	for _, item := range items {
		if allowedSet[item.ID] {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterNetworkInterfaces(items []networkInterfaceStats, cfg agentRuntimeConfig) []networkInterfaceStats {
	allowed := cfg.EnabledDeviceIDs["network"]
	if len(allowed) == 0 {
		return items
	}
	allowedSet := makeStringSet(allowed)
	filtered := make([]networkInterfaceStats, 0, len(items))
	for _, item := range items {
		if allowedSet[item.ID] {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterGPUs(items []gpuDeviceStats, cfg agentRuntimeConfig) []gpuDeviceStats {
	allowed := cfg.EnabledDeviceIDs["gpu"]
	if len(allowed) == 0 {
		return items
	}
	allowedSet := makeStringSet(allowed)
	filtered := make([]gpuDeviceStats, 0, len(items))
	for _, item := range items {
		if allowedSet[item.ID] {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func metricEnabled(global, instance map[string]bool, hasOverride bool, key string) bool {
	if !global[key] {
		return false
	}
	if !hasOverride {
		return true
	}
	return instance[key]
}

func resolveInstanceMetricSet(cfg agentRuntimeConfig, instanceID string) (map[string]bool, bool) {
	metrics, ok := cfg.InstanceMetricConfig[instanceID]
	if !ok {
		return nil, false
	}
	return makeStringSet(metrics), true
}

func makeEnabledMetricSet(metrics []string) map[string]bool {
	if len(metrics) == 0 {
		metrics = allMetricKeys
	}
	result := map[string]bool{}
	for _, key := range metrics {
		result[strings.TrimSpace(key)] = true
	}
	return result
}

func makeEnabledBlockSet(selections []agentProbeSelection) map[string]bool {
	result := map[string]bool{
		"cpu":     true,
		"memory":  true,
		"disk":    true,
		"network": true,
		"gpu":     false,
		"fan":     false,
	}
	for _, selection := range selections {
		target := strings.TrimSpace(selection.Target)
		if target == "" {
			continue
		}
		result[target] = selection.Enabled && !strings.EqualFold(selection.Provider, "disabled")
	}
	return result
}

func makeStringSet(items []string) map[string]bool {
	result := map[string]bool{}
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			result[trimmed] = true
		}
	}
	return result
}

func postMetrics(client *http.Client, serverURL, secret string, payload metricsPayload) error {
	if err := validateServerTransport(serverURL); err != nil {
		return err
	}
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

func validateServerTransport(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" {
		return fmt.Errorf("invalid_server_url")
	}
	if parsed.User != nil {
		return fmt.Errorf("server_url_userinfo_not_allowed")
	}
	if strings.EqualFold(parsed.Scheme, "https") {
		return nil
	}
	if strings.EqualFold(parsed.Scheme, "http") && isPrivateNetworkHost(parsed.Hostname()) {
		return nil
	}
	return fmt.Errorf("remote_server_requires_https")
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	parsed := net.ParseIP(host)
	return parsed != nil && parsed.IsLoopback()
}

func isPrivateNetworkHost(host string) bool {
	if isLoopbackHost(host) {
		return true
	}
	parsed := net.ParseIP(host)
	if parsed == nil {
		return false
	}
	if parsed.IsPrivate() || parsed.IsLinkLocalUnicast() {
		return true
	}
	return false
}

func shouldSkipMount(mountPoint, deviceName, fileSystem string) bool {
	if runtime.GOOS == "windows" {
		return false
	}
	if mountPoint == "[SWAP]" || mountPoint == "" {
		return true
	}
	if strings.HasPrefix(mountPoint, "/snap") || strings.HasPrefix(mountPoint, "/boot/efi") {
		return true
	}
	if strings.HasPrefix(deviceName, "/dev/loop") {
		return true
	}
	return strings.EqualFold(fileSystem, "squashfs")
}

func shouldSkipInterface(iface gnet.InterfaceStat) bool {
	name := strings.ToLower(iface.Name)
	if strings.Contains(name, "loopback") || name == "lo" || strings.Contains(name, "isatap") || strings.Contains(name, "teredo") {
		return true
	}
	for _, flag := range iface.Flags {
		if strings.EqualFold(flag, "loopback") {
			return true
		}
	}
	return false
}

func averagePointer(values []float64) *float64 {
	filtered := make([]float64, 0, len(values))
	for _, value := range values {
		if value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0) {
			filtered = append(filtered, value)
		}
	}
	if len(filtered) == 0 {
		return nil
	}
	avg := 0.0
	for _, value := range filtered {
		avg += value
	}
	result := round(avg / float64(len(filtered)))
	return &result
}

func ensureCPUPackages(value []cpuPackageStats) []cpuPackageStats {
	if value == nil {
		return []cpuPackageStats{}
	}
	return value
}

func ensureGPUs(value []gpuDeviceStats) []gpuDeviceStats {
	if value == nil {
		return []gpuDeviceStats{}
	}
	return value
}

func ensureFans(value []fanSensorStats) []fanSensorStats {
	if value == nil {
		return []fanSensorStats{}
	}
	return value
}

func uniqueStrings(items []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func sanitizeStringMap(input map[string][]string) map[string][]string {
	result := map[string][]string{}
	for key, values := range input {
		result[key] = uniqueStrings(values)
	}
	return result
}

func sanitizeKey(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return "0"
	}
	replacer := strings.NewReplacer(" ", "-", "\\", "-", "/", "-", ":", "-", ".", "-", "_", "-")
	return replacer.Replace(value)
}

func env(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
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
	return math.Round(value*100) / 100
}

func max(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func max64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func logCategoryf(category, format string, values ...any) {
	category = sanitizeLogCategory(category)
	log.Printf("[dsc:error][category=%s] %s", category, fmt.Sprintf(format, values...))
}

func sanitizeLogCategory(category string) string {
	category = strings.TrimSpace(strings.ToLower(category))
	if category == "" {
		return "unknown"
	}
	replacer := strings.NewReplacer(" ", "_", "-", "_", "/", "_", "\\", "_", ":", "_")
	return replacer.Replace(category)
}
