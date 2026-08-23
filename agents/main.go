package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
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
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	gprocess "github.com/shirou/gopsutil/v4/process"
)

const (
	defaultNormalIntervalSeconds = 30
	defaultSlowIntervalSeconds   = 30
	maxSamplingIntervalSeconds   = 86400
	hardwareSensorHelperInterval = 10 * time.Second
	hardwareSensorCacheMaxAge    = 45 * time.Second
)

const (
	hardwareSensorHelperTaskName   = "DeviceStateConsoleHardwareSensors"
	defaultHardwareSensorCachePath = `C:\ProgramData\DeviceStateConsole\hardware-sensors.json`
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
	logCategoryCPUSlow     = "cpu_slow"
	logCategoryDiskSlow    = "disk_slow"
	logCategoryDiskFast    = "disk_fast"
	logCategoryNetworkSlow = "network_slow"
	logCategoryNetworkFast = "network_fast"
)

const (
	defaultPendingMaxBytes    int64 = 64 * 1024 * 1024
	defaultPendingMaxAgeHours       = 24 * 7
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
	"cpuTopology",
	"systemOverview",
	"gpuUsage",
	"gpuEncode",
	"gpuDecode",
	"gpuFrequency",
	"gpuMemory",
	"gpuTemperature",
	"gpuDriverInfo",
	"temperatureSources",
	"memoryUsage",
	"swapUsage",
	"memoryAvailable",
	"memoryCached",
	"memoryCommitted",
	"memoryHardware",
	"diskUsage",
	"diskRead",
	"diskWrite",
	"diskMetadata",
	"diskActivity",
	"diskHealth",
	"networkRxRate",
	"networkTxRate",
	"networkTraffic",
	"networkIdentity",
	"fanRpm",
	"fanControl",
	"fanTargetTemperature",
	"fanPwm",
	"fanChannelState",
	"fanNote",
}

type agentIdentity struct {
	DeviceID string `json:"deviceId"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Platform string `json:"platform"`
	Arch     string `json:"arch"`
	CPUModel string `json:"cpuModel,omitempty"`
	Version  string `json:"version,omitempty"`
	Channel  string `json:"channel,omitempty"`
}

type memoryStats struct {
	TotalBytes       uint64   `json:"totalBytes"`
	UsedBytes        uint64   `json:"usedBytes"`
	AvailableBytes   uint64   `json:"availableBytes"`
	CachedBytes      uint64   `json:"cachedBytes"`
	CommittedBytes   uint64   `json:"committedBytes"`
	CommitLimitBytes uint64   `json:"commitLimitBytes"`
	SwapTotalBytes   uint64   `json:"swapTotalBytes"`
	SwapUsedBytes    uint64   `json:"swapUsedBytes"`
	SpeedMHz         *float64 `json:"speedMHz,omitempty"`
	SlotCount        *int     `json:"slotCount,omitempty"`
	FormFactor       string   `json:"formFactor,omitempty"`
}

type systemStats struct {
	ProcessCount  int    `json:"processCount"`
	ThreadCount   int    `json:"threadCount"`
	HandleCount   uint64 `json:"handleCount"`
	UptimeSeconds uint64 `json:"uptimeSeconds,omitempty"`
}

type storageUsage struct {
	TotalBytes uint64 `json:"totalBytes"`
	UsedBytes  uint64 `json:"usedBytes"`
}

type diskDeviceStats struct {
	ID                string               `json:"id"`
	Name              string               `json:"name"`
	MountPoint        string               `json:"mountPoint"`
	FileSystem        string               `json:"filesystem,omitempty"`
	Model             string               `json:"model,omitempty"`
	Vendor            string               `json:"vendor,omitempty"`
	SourceKey         string               `json:"sourceKey,omitempty"`
	PhysicalDevice    string               `json:"physicalDevice,omitempty"`
	TemperatureC      *float64             `json:"temperatureC,omitempty"`
	HealthStatus      string               `json:"healthStatus,omitempty"`
	HealthReason      string               `json:"healthReason,omitempty"`
	HealthPercent     *float64             `json:"healthPercent,omitempty"`
	SmartAttributes   []diskSmartAttribute `json:"smartAttributes,omitempty"`
	ActivePercent     *float64             `json:"activePercent,omitempty"`
	AverageResponseMs *float64             `json:"averageResponseMs,omitempty"`
	InterfaceType     string               `json:"interfaceType,omitempty"`
	TotalBytes        uint64               `json:"totalBytes"`
	UsedBytes         uint64               `json:"usedBytes"`
}

type diskSmartAttribute struct {
	ID        int     `json:"id"`
	Name      string  `json:"name"`
	Value     float64 `json:"value"`
	Threshold float64 `json:"threshold"`
}

type cpuPackageStats struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Model        string   `json:"model,omitempty"`
	CoreCount    int      `json:"coreCount,omitempty"`
	LogicalCount int      `json:"logicalCount,omitempty"`
	L3CacheBytes uint64   `json:"l3CacheBytes,omitempty"`
	FrequencyMHz *float64 `json:"frequencyMHz,omitempty"`
	UsagePercent *float64 `json:"usagePercent,omitempty"`
	TemperatureC *float64 `json:"temperatureC,omitempty"`
}

type rateStats struct {
	ReadBytesPerSec   float64              `json:"readBytesPerSec"`
	WriteBytesPerSec  float64              `json:"writeBytesPerSec"`
	ActivePercent     float64              `json:"activePercent,omitempty"`
	AverageResponseMs float64              `json:"averageResponseMs,omitempty"`
	Instances         map[string]rateStats `json:"instances,omitempty"`
}

type networkTrafficStats struct {
	RxBytesPerSec float64                        `json:"rxBytesPerSec"`
	TxBytesPerSec float64                        `json:"txBytesPerSec"`
	TotalRxBytes  uint64                         `json:"totalRxBytes"`
	TotalTxBytes  uint64                         `json:"totalTxBytes"`
	Instances     map[string]networkTrafficStats `json:"-"`
}

type networkInterfaceStats struct {
	ID                    string   `json:"id"`
	Name                  string   `json:"name"`
	Model                 string   `json:"model,omitempty"`
	MacAddress            string   `json:"macAddress,omitempty"`
	IPv4                  []string `json:"ipv4,omitempty"`
	IPv6                  []string `json:"ipv6,omitempty"`
	RxBytesPerSec         float64  `json:"rxBytesPerSec,omitempty"`
	TxBytesPerSec         float64  `json:"txBytesPerSec,omitempty"`
	TotalRxBytes          uint64   `json:"totalRxBytes,omitempty"`
	TotalTxBytes          uint64   `json:"totalTxBytes,omitempty"`
	LinkSpeedMbps         *float64 `json:"linkSpeedMbps,omitempty"`
	ConnectionType        string   `json:"connectionType,omitempty"`
	SignalStrengthPercent *float64 `json:"signalStrengthPercent,omitempty"`
}

type gpuDeviceStats struct {
	ID                       string   `json:"id"`
	Name                     string   `json:"name"`
	UtilizationPercent       float64  `json:"utilizationPercent"`
	EncodeUtilizationPercent *float64 `json:"encodeUtilizationPercent,omitempty"`
	DecodeUtilizationPercent *float64 `json:"decodeUtilizationPercent,omitempty"`
	FrequencyMHz             *float64 `json:"frequencyMHz,omitempty"`
	Integrated               bool     `json:"integrated,omitempty"`
	MemoryKind               string   `json:"memoryKind,omitempty"`
	MemoryUsedBytes          uint64   `json:"memoryUsedBytes"`
	MemoryTotalBytes         uint64   `json:"memoryTotalBytes"`
	TemperatureC             *float64 `json:"temperatureC,omitempty"`
	TemperatureSource        string   `json:"temperatureSource,omitempty"`
	DriverVersion            string   `json:"driverVersion,omitempty"`
	memoryObserved           bool     `json:"-"`
}

type fanSensorStats struct {
	ID                 string   `json:"id"`
	Label              string   `json:"label"`
	Interface          string   `json:"interface"`
	RPM                int      `json:"rpm"`
	ControlMode        string   `json:"controlMode,omitempty"`
	TargetTemperatureC *float64 `json:"targetTemperatureC,omitempty"`
	MinPWMPercent      *float64 `json:"minPwmPercent,omitempty"`
	MaxPWMPercent      *float64 `json:"maxPwmPercent,omitempty"`
	ChannelState       string   `json:"channelState,omitempty"`
	Note               string   `json:"note,omitempty"`
}

type temperatureSensorReading struct {
	ID           string   `json:"id"`
	Source       string   `json:"source"`
	Backend      string   `json:"backend,omitempty"`
	Hardware     string   `json:"hardware,omitempty"`
	HardwareType string   `json:"hardwareType,omitempty"`
	InstanceID   string   `json:"instanceId,omitempty"`
	Path         string   `json:"path,omitempty"`
	RawName      string   `json:"rawName"`
	DisplayName  string   `json:"displayName,omitempty"`
	Role         string   `json:"role"`
	CurrentC     *float64 `json:"currentC,omitempty"`
	HighC        *float64 `json:"highC,omitempty"`
	CriticalC    *float64 `json:"criticalC,omitempty"`
	EmergencyC   *float64 `json:"emergencyC,omitempty"`
	Alarm        *bool    `json:"alarm,omitempty"`
	Status       string   `json:"status"`
	Confidence   string   `json:"confidence"`
	Note         string   `json:"note,omitempty"`
}

type sensorBackendStatus struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

type metricsPayload struct {
	SampleID           string                     `json:"sampleId,omitempty"`
	Identity           agentIdentity              `json:"identity"`
	Timestamp          string                     `json:"timestamp"`
	HeartbeatAt        string                     `json:"heartbeatAt"`
	System             systemStats                `json:"system"`
	CPUUsagePercent    float64                    `json:"cpuUsagePercent"`
	CPUFrequencyMHz    *float64                   `json:"cpuFrequencyMHz,omitempty"`
	CPUTemperatureC    *float64                   `json:"cpuTemperatureC,omitempty"`
	CPUPackages        []cpuPackageStats          `json:"cpuPackages,omitempty"`
	Memory             memoryStats                `json:"memory"`
	DiskUsage          storageUsage               `json:"diskUsage"`
	Disks              []diskDeviceStats          `json:"disks,omitempty"`
	DiskRate           rateStats                  `json:"diskRate"`
	NetworkRate        networkTrafficStats        `json:"networkRate"`
	NetworkIfaces      []networkInterfaceStats    `json:"networkInterfaces,omitempty"`
	GPUs               []gpuDeviceStats           `json:"gpus"`
	Fans               []fanSensorStats           `json:"fans"`
	TemperatureSensors []temperatureSensorReading `json:"temperatureSensors,omitempty"`
	SensorBackends     []sensorBackendStatus      `json:"sensorBackends,omitempty"`
	Virtualization     *virtualizationSnapshot    `json:"virtualization,omitempty"`
}

type agentConnectionConfig struct {
	ServerURL string `json:"serverUrl"`
	Secret    string `json:"secret"`
	DeviceID  string `json:"deviceId"`
	Hostname  string `json:"hostname"`
}

type agentSamplingConfig struct {
	NormalIntervalSeconds int `json:"normalIntervalSeconds"`
	SlowIntervalSeconds   int `json:"slowIntervalSeconds"`
}

type agentProbeSelection struct {
	Target   string `json:"target"`
	Provider string `json:"provider"`
	Enabled  bool   `json:"enabled"`
}

type agentConfigFile struct {
	Connection           agentConnectionConfig      `json:"connection"`
	Sampling             agentSamplingConfig        `json:"sampling"`
	EnabledMetrics       *[]string                  `json:"enabledMetrics"`
	EnabledDeviceIDs     map[string][]string        `json:"enabledDeviceIds"`
	InstanceMetricConfig map[string][]string        `json:"instanceMetricConfig"`
	ProbeSelections      []agentProbeSelection      `json:"probeSelections"`
	Virtualization       *agentVirtualizationConfig `json:"virtualization"`
	CloudSyncEnabled     *bool                      `json:"cloudSyncEnabled"`
	DataRecordingEnabled *bool                      `json:"dataRecordingEnabled"`
}

type agentRuntimeConfig struct {
	Connection           agentConnectionConfig
	Sampling             agentSamplingConfig
	EnabledMetrics       []string
	EnabledDeviceIDs     map[string][]string
	InstanceMetricConfig map[string][]string
	ProbeSelections      []agentProbeSelection
	Virtualization       agentVirtualizationConfig
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
	read       uint64
	write      uint64
	readTime   uint64
	writeTime  uint64
	ioTime     uint64
	readCount  uint64
	writeCount uint64
}

type netSnapshot struct {
	rx uint64
	tx uint64
}

type networkHardwareMetadata struct {
	Model                 string
	LinkSpeedMbps         *float64
	ConnectionType        string
	SignalStrengthPercent *float64
}

type diskHardwareMetadata struct {
	Model          string
	Vendor         string
	InterfaceType  string
	TemperatureC   *float64
	PhysicalDevice string
	DiskNumber     int
}

type diskSensorMetadata struct {
	TemperatureC       *float64
	TemperatureSensors []temperatureSensorReading
	HealthStatus       string
	HealthReason       string
	HealthPercent      *float64
	SmartAttributes    []diskSmartAttribute
}

type windowsHardwareMetadata struct {
	MemorySpeedMHz   *float64
	MemorySlotCount  *int
	MemoryFormFactor string
	GpuDrivers       map[string]string
	Networks         map[string]networkHardwareMetadata
	DiskInterfaces   map[string]string
	DiskMetadata     map[string]diskHardwareMetadata
}

type slowMetrics struct {
	collectedAt        time.Time
	cpuCollected       bool
	diskCollected      bool
	networkCollected   bool
	hardwareCollected  bool
	cpuFrequencyMHz    *float64
	cpuTemperatureC    *float64
	memorySpeedMHz     *float64
	memorySlotCount    *int
	memoryFormFactor   string
	cpuPackages        []cpuPackageStats
	diskUsage          storageUsage
	disks              []diskDeviceStats
	networkInterfaces  []networkInterfaceStats
	gpus               []gpuDeviceStats
	gpuDrivers         map[string]string
	networkMetadata    map[string]networkHardwareMetadata
	diskInterfaces     map[string]string
	diskMetadata       map[string]diskHardwareMetadata
	diskSensorMetadata map[string]diskSensorMetadata
	fans               []fanSensorStats
	sensorBackends     []sensorBackendStatus
	temperatureSensors []temperatureSensorReading
}

type agentState struct {
	baseIdentity         agentIdentity
	configPath           string
	client               *http.Client
	lastCPU              cpuSnapshot
	hasLastCPU           bool
	lastIO               *ioSnapshot
	lastSlow             slowMetrics
	hasSlow              bool
	currentCfg           agentRuntimeConfig
	hasConfig            bool
	lastVirtualizationAt time.Time
	lastVirtualization   *virtualizationSnapshot
}

type pendingSample struct {
	ID        string         `json:"id"`
	ServerURL string         `json:"serverUrl"`
	SampledAt string         `json:"sampledAt"`
	Payload   metricsPayload `json:"payload"`
}

type pendingStateFile struct {
	PendingCount    int    `json:"pendingCount"`
	PendingBytes    int64  `json:"pendingBytes"`
	OldestSampledAt string `json:"oldestSampledAt,omitempty"`
	UpdatedAt       string `json:"updatedAt"`
	LastUploadError string `json:"lastUploadError,omitempty"`
}

type pendingStore struct {
	path          string
	statePath     string
	maxBytes      int64
	maxAge        time.Duration
	lastUploadErr string
}

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version":
			fmt.Printf("%s (%s)\n", BuildVersion, BuildChannel)
			return
		case "update":
			if err := runUpdateCommand(os.Args[2:]); err != nil {
				log.Printf("update failed: %v", err)
				os.Exit(1)
			}
			return
		case "hardware-sensor-helper":
			if err := runHardwareSensorHelper(os.Args[2:]); err != nil {
				log.Printf("hardware sensor helper failed: %v", err)
				os.Exit(1)
			}
			return
		case "hardware-sensor-probe":
			if err := runHardwareSensorProbe(); err != nil {
				log.Printf("hardware sensor probe failed: %v", err)
				os.Exit(1)
			}
			return
		case "install-hardware-helper":
			if err := installHardwareSensorHelper(); err != nil {
				log.Printf("install hardware sensor helper failed: %v", err)
				os.Exit(1)
			}
			return
		case "uninstall-hardware-helper":
			if err := uninstallHardwareSensorHelper(); err != nil {
				log.Printf("uninstall hardware sensor helper failed: %v", err)
				os.Exit(1)
			}
			return
		}
	}
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
	pending := newPendingStore(state.configPath)
	runContext, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	defaultConfig := newDefaultRuntimeConfig(defaultConnection)
	log.Printf("go agent v%s started for %s -> %s", BuildVersion, baseIdentity.DeviceID, defaultConnection.ServerURL)

	for {
		cycleStartedAt := time.Now()
		cfg := state.loadRuntimeConfig(defaultConfig)
		if !cfg.DataRecordingEnabled {
			log.Printf("data recording is disabled; collector remains unregistered")
			if !waitForNextCycle(runContext.Done(), time.Duration(cfg.currentUploadIntervalSeconds())*time.Second) {
				pending.close()
				return
			}
			continue
		}
		if !cfg.CloudSyncEnabled {
			log.Printf("cloud sync is disabled; collector upload loop is paused")
			if !waitForNextCycle(runContext.Done(), time.Duration(cfg.currentUploadIntervalSeconds())*time.Second) {
				pending.close()
				return
			}
			continue
		}
		payload := state.collectPayload(cfg)
		if err := pending.drain(runContext, state.client, cfg.Connection.ServerURL, cfg.Connection.Secret); err != nil {
			logCategoryf(logCategoryUpload, "pending upload drain stopped: %v", err)
		}
		if err := postMetricsContext(runContext, state.client, cfg.Connection.ServerURL, cfg.Connection.Secret, payload); err != nil {
			pending.lastUploadErr = err.Error()
			if enqueueErr := pending.enqueue(pendingSample{
				ID:        payload.SampleID,
				ServerURL: cfg.Connection.ServerURL,
				SampledAt: payload.Timestamp,
				Payload:   payload,
			}); enqueueErr != nil {
				logCategoryf(logCategoryUpload, "upload failed and pending spool write failed: %v", enqueueErr)
			} else {
				logCategoryf(logCategoryUpload, "upload failed; sample persisted for replay: %v", err)
			}
		} else {
			pending.lastUploadErr = ""
			pending.writeState()
			log.Printf("uploaded metrics at %s", payload.Timestamp)
		}

		nextCycleAt := cycleStartedAt.Add(time.Duration(cfg.currentUploadIntervalSeconds()) * time.Second)
		if sleepDuration := time.Until(nextCycleAt); sleepDuration > 0 && !waitForNextCycle(runContext.Done(), sleepDuration) {
			pending.close()
			return
		}
	}
}

func waitForNextCycle(stop <-chan struct{}, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-stop:
		log.Printf("shutdown requested; stopping new samples")
		return false
	}
}

func newPendingStore(configPath string) *pendingStore {
	pendingPath := strings.TrimSpace(env("DSC_AGENT_PENDING_FILE", ""))
	if pendingPath == "" && strings.TrimSpace(configPath) != "" {
		pendingPath = configPath + ".pending.jsonl"
	}
	if pendingPath == "" {
		dataRoot, err := os.UserConfigDir()
		if err != nil || strings.TrimSpace(dataRoot) == "" {
			dataRoot = "."
		}
		pendingPath = filepath.Join(dataRoot, "device-state-console", "agent-pending.jsonl")
	}
	if !filepath.IsAbs(pendingPath) && strings.TrimSpace(configPath) != "" {
		pendingPath = filepath.Join(filepath.Dir(configPath), pendingPath)
	}
	maxBytes := parsePositiveInt64Env("DSC_AGENT_PENDING_MAX_BYTES", defaultPendingMaxBytes)
	maxAgeHours := parsePositiveInt64Env("DSC_AGENT_PENDING_MAX_AGE_HOURS", defaultPendingMaxAgeHours)
	store := &pendingStore{
		path:      pendingPath,
		statePath: pendingPath + ".state.json",
		maxBytes:  maxBytes,
		maxAge:    time.Duration(maxAgeHours) * time.Hour,
	}
	store.writeState()
	return store
}

func parsePositiveInt64Env(key string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func (s *pendingStore) close() {
	s.writeState()
}

func (s *pendingStore) enqueue(sample pendingSample) error {
	if sample.ID == "" {
		sample.ID = sampleID(sample.Payload)
	}
	if sample.SampledAt == "" {
		sample.SampledAt = sample.Payload.Timestamp
	}
	entries, err := s.readEntries()
	if err != nil {
		return err
	}
	entries = s.prune(entries, time.Now().UTC())
	for _, existing := range entries {
		if existing.ID == sample.ID {
			if err := s.writeEntries(entries); err != nil {
				return err
			}
			s.writeState()
			return nil
		}
	}
	entries = append(entries, sample)
	s.sortEntries(entries)
	entries = s.fit(entries)
	if err := s.writeEntries(entries); err != nil {
		return err
	}
	s.writeState()
	return nil
}

func (s *pendingStore) drain(ctx context.Context, client *http.Client, currentServerURL, secret string) error {
	entries, err := s.readEntries()
	if err != nil {
		return err
	}
	entries = s.prune(entries, time.Now().UTC())
	s.sortEntries(entries)
	replayURL := strings.TrimSpace(currentServerURL)
	for index, entry := range entries {
		serverURL := replayURL
		if serverURL == "" {
			serverURL = strings.TrimSpace(entry.ServerURL)
		}
		if serverURL == "" {
			return fmt.Errorf("pending sample %s has no server URL", entry.ID)
		}
		// A queued sample may have been created before the user changed the
		// Hub address. Replay it against the current endpoint instead of
		// permanently blocking the queue on the retired endpoint.
		entries[index].ServerURL = serverURL
		if err := postMetricsContext(ctx, client, serverURL, secret, entry.Payload); err != nil {
			s.lastUploadErr = err.Error()
			remaining := append([]pendingSample(nil), entries[index:]...)
			if writeErr := s.writeEntries(remaining); writeErr != nil {
				return fmt.Errorf("replay failed: %w; spool rewrite failed: %v", err, writeErr)
			}
			s.writeState()
			return err
		}
	}
	s.lastUploadErr = ""
	if err := s.writeEntries(nil); err != nil {
		return err
	}
	s.writeState()
	return nil
}

func (s *pendingStore) readEntries() ([]pendingSample, error) {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	entries := make([]pendingSample, 0)
	for _, line := range bytes.Split(raw, []byte{'\n'}) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var entry pendingSample
		if err := json.Unmarshal(line, &entry); err != nil {
			logCategoryf(logCategoryUpload, "ignoring malformed pending sample: %v", err)
			continue
		}
		if entry.Payload.SampleID == "" {
			entry.Payload.SampleID = entry.ID
		}
		if entry.ID == "" {
			entry.ID = sampleID(entry.Payload)
		}
		if entry.SampledAt == "" {
			entry.SampledAt = entry.Payload.Timestamp
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func (s *pendingStore) prune(entries []pendingSample, now time.Time) []pendingSample {
	seen := map[string]struct{}{}
	result := make([]pendingSample, 0, len(entries))
	for _, entry := range entries {
		if entry.ID == "" {
			entry.ID = sampleID(entry.Payload)
		}
		if _, exists := seen[entry.ID]; exists {
			continue
		}
		seen[entry.ID] = struct{}{}
		if sampledAt, err := time.Parse(time.RFC3339, entry.SampledAt); err == nil && now.Sub(sampledAt) > s.maxAge {
			continue
		}
		result = append(result, entry)
	}
	return result
}

func (s *pendingStore) fit(entries []pendingSample) []pendingSample {
	if s.maxBytes <= 0 {
		return entries
	}
	for len(entries) > 0 {
		raw, err := json.Marshal(entries)
		if err == nil && int64(len(raw)) <= s.maxBytes {
			return entries
		}
		entries = entries[1:]
	}
	return nil
}

func (s *pendingStore) sortEntries(entries []pendingSample) {
	sort.SliceStable(entries, func(i, j int) bool {
		left, leftErr := time.Parse(time.RFC3339, entries[i].SampledAt)
		right, rightErr := time.Parse(time.RFC3339, entries[j].SampledAt)
		if leftErr != nil || rightErr != nil {
			return entries[i].SampledAt < entries[j].SampledAt
		}
		return left.Before(right)
	})
}

func (s *pendingStore) writeEntries(entries []pendingSample) error {
	if len(entries) == 0 {
		if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	temporary := s.path + ".tmp"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(file)
	for _, entry := range entries {
		if err := encoder.Encode(entry); err != nil {
			_ = file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(temporary, s.path)
}

func (s *pendingStore) writeState() {
	entries, err := s.readEntries()
	if err != nil {
		return
	}
	entries = s.prune(entries, time.Now().UTC())
	s.sortEntries(entries)
	bytesUsed, _ := json.Marshal(entries)
	state := pendingStateFile{
		PendingCount:    len(entries),
		PendingBytes:    int64(len(bytesUsed)),
		UpdatedAt:       time.Now().UTC().Format(time.RFC3339),
		LastUploadError: s.lastUploadErr,
	}
	if len(entries) > 0 {
		state.OldestSampledAt = entries[0].SampledAt
	}
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.statePath), 0o700); err != nil {
		return
	}
	_ = os.WriteFile(s.statePath, raw, 0o600)
}

func runHardwareSensorProbe() error {
	// Use the same slow collection path as normal telemetry so the detection
	// result includes motherboard/CPU/GPU sensors as well as disk SMART and
	// platform-specific fallbacks. The command is intentionally one-shot: the
	// desktop backend invokes it only after the user requests hardware detect.
	metrics := collectSlowMetrics()
	response := struct {
		TemperatureSensors []temperatureSensorReading `json:"temperatureSources"`
		SensorBackends     []sensorBackendStatus      `json:"temperatureSensorBackends"`
		Fans               []fanSensorStats           `json:"fans"`
	}{
		TemperatureSensors: metrics.temperatureSensors,
		SensorBackends:     metrics.sensorBackends,
		Fans:               metrics.fans,
	}
	return json.NewEncoder(os.Stdout).Encode(response)
}

func sampleID(payload metricsPayload) string {
	payload.SampleID = ""
	raw, err := json.Marshal(payload)
	if err != nil {
		return payload.Timestamp
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
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
		Version:  BuildVersion,
		Channel:  BuildChannel,
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
			NormalIntervalSeconds: 30,
			SlowIntervalSeconds:   defaultSlowIntervalSeconds,
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
		Virtualization:       newDefaultVirtualizationConfig(),
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
	if fileCfg.Sampling.NormalIntervalSeconds > 0 && fileCfg.Sampling.NormalIntervalSeconds <= maxSamplingIntervalSeconds {
		cfg.Sampling.NormalIntervalSeconds = fileCfg.Sampling.NormalIntervalSeconds
	}
	if fileCfg.Sampling.SlowIntervalSeconds > 0 && fileCfg.Sampling.SlowIntervalSeconds <= maxSamplingIntervalSeconds {
		cfg.Sampling.SlowIntervalSeconds = fileCfg.Sampling.SlowIntervalSeconds
	}
	if fileCfg.EnabledMetrics != nil {
		cfg.EnabledMetrics = normalizeMetricKeys(*fileCfg.EnabledMetrics)
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
	if fileCfg.Virtualization != nil {
		cfg.Virtualization = normalizeVirtualizationConfig(*fileCfg.Virtualization)
	}
	if fileCfg.CloudSyncEnabled != nil {
		cfg.CloudSyncEnabled = *fileCfg.CloudSyncEnabled
	}
	if fileCfg.DataRecordingEnabled != nil {
		cfg.DataRecordingEnabled = *fileCfg.DataRecordingEnabled
	}
	return cfg
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
		slow := collectSlowMetrics()
		if !s.hasSlow {
			s.lastSlow = slow
			s.hasSlow = true
		} else {
			s.lastSlow = mergeSlowMetrics(s.lastSlow, slow)
		}
	}

	slow := s.lastSlow
	if !s.hasSlow {
		slow = emptySlowMetrics()
	}
	memory.SpeedMHz = slow.memorySpeedMHz
	memory.SlotCount = slow.memorySlotCount
	memory.FormFactor = slow.memoryFormFactor
	for index := range slow.disks {
		if metadata, ok := slow.diskMetadata[slow.disks[index].SourceKey]; ok {
			if slow.disks[index].InterfaceType == "" {
				slow.disks[index].InterfaceType = metadata.InterfaceType
			}
			if slow.disks[index].Model == "" {
				slow.disks[index].Model = metadata.Model
			}
			if slow.disks[index].Vendor == "" {
				slow.disks[index].Vendor = metadata.Vendor
			}
		}
		if metadata, ok := lookupDiskSensorMetadata(slow.diskSensorMetadata, slow.disks[index].SourceKey, slow.disks[index].Name, slow.disks[index].Model, slow.disks[index].MountPoint); ok {
			if slow.disks[index].TemperatureC == nil {
				slow.disks[index].TemperatureC = metadata.TemperatureC
			}
			if slow.disks[index].HealthStatus == "" {
				slow.disks[index].HealthStatus = metadata.HealthStatus
			}
			if slow.disks[index].HealthReason == "" {
				slow.disks[index].HealthReason = metadata.HealthReason
			}
			if slow.disks[index].HealthPercent == nil {
				slow.disks[index].HealthPercent = metadata.HealthPercent
			}
			if len(slow.disks[index].SmartAttributes) == 0 {
				slow.disks[index].SmartAttributes = metadata.SmartAttributes
			}
		}
		if rate, ok := lookupDiskRate(diskRate.Instances, slow.disks[index].SourceKey, slow.disks[index].Name, slow.disks[index].MountPoint); ok {
			active := rate.ActivePercent
			response := rate.AverageResponseMs
			slow.disks[index].ActivePercent = &active
			slow.disks[index].AverageResponseMs = &response
			if diskRate.Instances == nil {
				diskRate.Instances = map[string]rateStats{}
			}
			// A mounted Linux partition is usually named /dev/sda2 while
			// gopsutil exposes the IO counter as sda. Preserve aliases so the
			// backend can attach the rate to both the partition and instance.
			diskRate.Instances[slow.disks[index].SourceKey] = rate
			diskRate.Instances[slow.disks[index].ID] = rate
		}
	}
	for index := range slow.networkInterfaces {
		if rate, ok := networkRate.Instances[slow.networkInterfaces[index].Name]; ok {
			slow.networkInterfaces[index].RxBytesPerSec = rate.RxBytesPerSec
			slow.networkInterfaces[index].TxBytesPerSec = rate.TxBytesPerSec
			slow.networkInterfaces[index].TotalRxBytes = rate.TotalRxBytes
			slow.networkInterfaces[index].TotalTxBytes = rate.TotalTxBytes
		}
		if metadata, ok := slow.networkMetadata[slow.networkInterfaces[index].Name]; ok {
			if slow.networkInterfaces[index].Model == "" {
				slow.networkInterfaces[index].Model = metadata.Model
			}
			slow.networkInterfaces[index].LinkSpeedMbps = metadata.LinkSpeedMbps
			slow.networkInterfaces[index].ConnectionType = metadata.ConnectionType
			slow.networkInterfaces[index].SignalStrengthPercent = metadata.SignalStrengthPercent
		}
	}
	for index := range slow.gpus {
		for name, driver := range slow.gpuDrivers {
			if strings.EqualFold(name, slow.gpus[index].Name) {
				slow.gpus[index].DriverVersion = driver
			}
		}
	}

	payload := metricsPayload{
		Identity:           identity,
		Timestamp:          now.Format(time.RFC3339),
		HeartbeatAt:        now.Format(time.RFC3339),
		System:             collectSystemStats(),
		CPUUsagePercent:    cpuUsagePercent,
		CPUFrequencyMHz:    slow.cpuFrequencyMHz,
		CPUTemperatureC:    slow.cpuTemperatureC,
		CPUPackages:        ensureCPUPackages(slow.cpuPackages),
		Memory:             memory,
		DiskUsage:          slow.diskUsage,
		Disks:              slow.disks,
		DiskRate:           diskRate,
		NetworkRate:        networkRate,
		NetworkIfaces:      slow.networkInterfaces,
		GPUs:               ensureGPUs(slow.gpus),
		Fans:               ensureFans(slow.fans),
		TemperatureSensors: append([]temperatureSensorReading{}, slow.temperatureSensors...),
		SensorBackends:     slow.sensorBackends,
		Virtualization:     s.collectVirtualization(cfg, now),
	}

	applyRuntimeConfig(&payload, cfg)
	payload.SampleID = sampleID(payload)
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
	committedBytes := virtualMemory.CommittedAS
	commitLimitBytes := uint64(0)
	if runtime.GOOS == "windows" {
		if current, limit, ok := collectWindowsCommitMemory(); ok {
			committedBytes = current
			commitLimitBytes = limit
		}
	}
	if commitLimitBytes == 0 {
		commitLimitBytes = virtualMemory.Total + swapMemory.Total
	}
	return memoryStats{
		TotalBytes:       virtualMemory.Total,
		UsedBytes:        virtualMemory.Used,
		AvailableBytes:   virtualMemory.Available,
		CachedBytes:      virtualMemory.Cached,
		CommittedBytes:   committedBytes,
		CommitLimitBytes: commitLimitBytes,
		SwapTotalBytes:   swapMemory.Total,
		SwapUsedBytes:    swapMemory.Used,
	}
}

func collectSystemStats() systemStats {
	uptimeSeconds, _ := host.Uptime()
	if runtime.GOOS == "windows" {
		if result, ok := collectWindowsSystemStats(); ok {
			result.UptimeSeconds = uptimeSeconds
			return result
		}
	}

	items, err := gprocess.Processes()
	if err != nil {
		return systemStats{UptimeSeconds: uptimeSeconds}
	}

	result := systemStats{ProcessCount: len(items), UptimeSeconds: uptimeSeconds}
	for _, item := range items {
		if item == nil {
			continue
		}
		if threads, err := item.NumThreads(); err == nil && threads > 0 {
			result.ThreadCount += int(threads)
		}
		if handles, err := item.NumFDs(); err == nil && handles > 0 {
			result.HandleCount += uint64(handles)
		}
	}
	return result
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

func emptySlowMetrics() slowMetrics {
	return slowMetrics{
		cpuPackages:        []cpuPackageStats{},
		disks:              []diskDeviceStats{},
		networkInterfaces:  []networkInterfaceStats{},
		gpus:               []gpuDeviceStats{},
		gpuDrivers:         map[string]string{},
		networkMetadata:    map[string]networkHardwareMetadata{},
		diskInterfaces:     map[string]string{},
		diskMetadata:       map[string]diskHardwareMetadata{},
		diskSensorMetadata: map[string]diskSensorMetadata{},
		fans:               []fanSensorStats{},
		sensorBackends:     []sensorBackendStatus{},
		temperatureSensors: []temperatureSensorReading{},
	}
}

func logSlowMetricsError(defaultCategory string, err error) {
	if err == nil {
		return
	}
	var issueErr *collectorIssueError
	if errors.As(err, &issueErr) {
		logCategoryf(issueErr.category, "slow metrics collector failed: %v", issueErr.err)
		return
	}
	logCategoryf(defaultCategory, "slow metrics collector failed: %v", err)
}

func mergeSlowMetrics(previous slowMetrics, next slowMetrics) slowMetrics {
	merged := previous
	if !next.collectedAt.IsZero() {
		merged.collectedAt = next.collectedAt
	}
	if next.cpuCollected {
		merged.cpuCollected = true
		merged.cpuPackages = next.cpuPackages
		if next.cpuFrequencyMHz != nil {
			merged.cpuFrequencyMHz = next.cpuFrequencyMHz
		}
	}
	if next.diskCollected {
		merged.diskCollected = true
		merged.diskUsage = next.diskUsage
		merged.disks = next.disks
	}
	if next.networkCollected {
		merged.networkCollected = true
		merged.networkInterfaces = next.networkInterfaces
	}
	if next.hardwareCollected {
		merged.hardwareCollected = true
		merged.cpuTemperatureC = next.cpuTemperatureC
		merged.memorySpeedMHz = next.memorySpeedMHz
		merged.memorySlotCount = next.memorySlotCount
		merged.memoryFormFactor = next.memoryFormFactor
		merged.gpus = mergeMissingGPUMemory(previous.gpus, next.gpus)
		if merged.cpuTemperatureC != nil {
			// The historical-memory merge may bring back a previous GPU
			// temperature. Integrated GPUs have no independent sensor, so
			// restore the invariant after merging: their temperature always
			// follows the current CPU Package value.
			applyIntegratedGPUTemperature(merged.gpus, *merged.cpuTemperatureC)
		}
		merged.gpuDrivers = next.gpuDrivers
		merged.networkMetadata = next.networkMetadata
		merged.diskInterfaces = next.diskInterfaces
		merged.diskMetadata = next.diskMetadata
		merged.diskSensorMetadata = next.diskSensorMetadata
		merged.fans = next.fans
		merged.sensorBackends = next.sensorBackends
		merged.temperatureSensors = mergeTemperatureSensors(previous.temperatureSensors, next.temperatureSensors)
		if next.cpuFrequencyMHz != nil {
			merged.cpuFrequencyMHz = next.cpuFrequencyMHz
		}
	}
	return merged
}

func collectSlowMetrics() slowMetrics {
	result := emptySlowMetrics()
	result.collectedAt = time.Now().UTC()

	cpuFrequencyMHz, cpuPackages, cpuErr := collectCPUPackages()
	if cpuErr != nil {
		logSlowMetricsError(logCategoryCPUSlow, cpuErr)
	} else {
		result.cpuCollected = true
		result.cpuFrequencyMHz = cpuFrequencyMHz
		result.cpuPackages = cpuPackages
	}

	disks, diskUsage, diskErr := collectDisks()
	if diskErr != nil {
		logSlowMetricsError(logCategoryDiskSlow, diskErr)
	} else {
		result.diskCollected = true
		result.diskUsage = diskUsage
		result.disks = disks
	}

	networkInterfaces, networkErr := collectNetworkInterfaces()
	if networkErr != nil {
		logSlowMetricsError(logCategoryNetworkSlow, networkErr)
	} else {
		result.networkCollected = true
		result.networkInterfaces = networkInterfaces
	}

	hardware := collectHardwareSensors()
	temperatureSensors := append([]temperatureSensorReading{}, hardware.temperatureSensors...)
	windowsMetadata := collectWindowsHardwareMetadata()
	memorySpeedMHz := windowsMetadata.MemorySpeedMHz
	memorySlotCount := windowsMetadata.MemorySlotCount
	memoryFormFactor := windowsMetadata.MemoryFormFactor
	if runtime.GOOS == "linux" {
		linuxSpeed, linuxSlots, linuxFormFactor := collectLinuxMemoryMetadata()
		if linuxSpeed != nil {
			memorySpeedMHz = linuxSpeed
		}
		if linuxSlots != nil {
			memorySlotCount = linuxSlots
		}
		if linuxFormFactor != "" {
			memoryFormFactor = linuxFormFactor
		}
	}
	if runtime.GOOS == "windows" {
		windowsDiskSensors := collectWindowsDiskSensorMetadata(windowsMetadata.DiskMetadata)
		for index := range result.disks {
			disk := &result.disks[index]
			metadata := windowsMetadata.DiskMetadata[disk.SourceKey]
			if metadata.PhysicalDevice != "" {
				disk.PhysicalDevice = metadata.PhysicalDevice
			}
			if sensor, ok := windowsDiskSensors[metadata.PhysicalDevice]; ok {
				applyDiskSensorMetadata(disk, sensor)
				temperatureSensors = append(temperatureSensors, sensor.TemperatureSensors...)
			}
		}
	}
	if runtime.GOOS == "linux" {
		linuxDiskSensors := collectLinuxDiskSensorMetadata(result.disks)
		for index := range result.disks {
			if sensor, ok := lookupDiskSensorMetadata(linuxDiskSensors, result.disks[index].SourceKey, result.disks[index].Name, result.disks[index].Model, result.disks[index].MountPoint); ok {
				applyDiskSensorMetadata(&result.disks[index], sensor)
				temperatureSensors = append(temperatureSensors, sensor.TemperatureSensors...)
			}
		}
	}

	var gpus []gpuDeviceStats
	if runtime.GOOS == "windows" {
		baseAdapters := collectWindowsGPUAdapters()
		lhmGpus := hardware.gpus
		nvidiaGpus := collectNvidiaGPUs()
		appendGPUTemperatureSensors(&temperatureSensors, nvidiaGpus, "nvidia-smi")
		perfGpus := collectWindowsGPUPerformance()
		gpus = mergeGPUStats(baseAdapters, lhmGpus, nvidiaGpus, perfGpus)
		if len(gpus) == 0 {
			gpus = mergeGPUStats(lhmGpus, nvidiaGpus, perfGpus)
		}
	} else {
		nvidiaGpus := collectNvidiaGPUs()
		appendGPUTemperatureSensors(&temperatureSensors, nvidiaGpus, "nvidia-smi")
		gpus = mergeGPUStats(hardware.gpus, nvidiaGpus)
	}
	if hardware.cpuTemperatureC != nil {
		applyIntegratedGPUTemperature(gpus, *hardware.cpuTemperatureC)
		appendIntegratedGPUTemperatureSensors(&temperatureSensors, gpus, *hardware.cpuTemperatureC)
	}
	hardware.gpus = gpus
	if hardware.cpuFrequencyMHz == nil {
		hardware.cpuFrequencyMHz = collectWindowsCPUFrequency(cpuFrequencyMHz)
	}
	if hardware.cpuFrequencyMHz != nil {
		result.cpuFrequencyMHz = hardware.cpuFrequencyMHz
		for index := range result.cpuPackages {
			result.cpuPackages[index].FrequencyMHz = hardware.cpuFrequencyMHz
		}
	}
	applyCPUPackageTemperature(result.cpuPackages, hardware.cpuTemperatureC)
	sensorBackends := append([]sensorBackendStatus{}, hardware.sensorBackends...)
	sensorBackends = append(sensorBackends, collectPlatformSensorBackends()...)

	result.hardwareCollected = true
	result.cpuTemperatureC = hardware.cpuTemperatureC
	result.memorySpeedMHz = memorySpeedMHz
	result.memorySlotCount = memorySlotCount
	result.memoryFormFactor = memoryFormFactor
	result.gpus = hardware.gpus
	result.gpuDrivers = windowsMetadata.GpuDrivers
	result.networkMetadata = windowsMetadata.Networks
	result.diskInterfaces = windowsMetadata.DiskInterfaces
	result.diskMetadata = windowsMetadata.DiskMetadata
	result.diskSensorMetadata = hardware.diskSensorMetadata
	result.fans = hardware.fans
	result.sensorBackends = sensorBackends
	result.temperatureSensors = mergeTemperatureSensors(nil, temperatureSensors)
	return result
}

func normalizeGPUName(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" {
		return ""
	}
	replacements := []string{
		"(r)", "",
		"(tm)", "",
		"corporation", "",
		"with max-q design", "",
		"with max-q", "",
		"with max-p", "",
		"laptop gpu", "",
		"mobile", "",
		"graphics", "",
		"series", "",
		"family", "",
	}
	replacer := strings.NewReplacer(replacements...)
	cleaned := replacer.Replace(lower)
	var b strings.Builder
	for _, r := range cleaned {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteRune(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func matchGPUName(a, b string) bool {
	aTrim := strings.TrimSpace(a)
	bTrim := strings.TrimSpace(b)
	if aTrim == "" || bTrim == "" {
		return false
	}
	if strings.EqualFold(aTrim, bTrim) {
		return true
	}
	normA := normalizeGPUName(aTrim)
	normB := normalizeGPUName(bTrim)
	if normA == "" || normB == "" {
		return false
	}
	if normA == normB {
		return true
	}
	if len(normA) >= 4 && len(normB) >= 4 {
		if strings.Contains(normA, normB) || strings.Contains(normB, normA) {
			return true
		}
	}
	return false
}

func isVirtualGPUAdapter(name, pnpDeviceID string) bool {
	lowerName := strings.ToLower(strings.TrimSpace(name))
	upperPNP := strings.ToUpper(strings.TrimSpace(pnpDeviceID))
	if strings.Contains(lowerName, "virtual display") ||
		strings.Contains(lowerName, "remote display") ||
		strings.Contains(lowerName, "indirect display") ||
		strings.Contains(lowerName, "parsec") ||
		strings.Contains(lowerName, "gameviewer") ||
		strings.Contains(lowerName, "spacedesk") ||
		strings.Contains(lowerName, "sunshine") ||
		strings.Contains(lowerName, "virtual desktop") ||
		strings.Contains(lowerName, "rdpidd") ||
		strings.Contains(lowerName, "citrix") ||
		strings.Contains(lowerName, "idesk") {
		return true
	}
	if strings.HasPrefix(upperPNP, "ROOT\\") ||
		strings.HasPrefix(upperPNP, "SWD\\REMOTEDISPLAY") ||
		strings.Contains(upperPNP, "INDIRECTDISPLAY") {
		return true
	}
	return false
}

func isNvidiaGPUNameOrID(name, id string) bool {
	combined := strings.ToLower(name + " " + id)
	return strings.Contains(combined, "nvidia") ||
		strings.Contains(combined, "geforce") ||
		strings.Contains(combined, "quadro") ||
		strings.Contains(combined, "tesla") ||
		strings.Contains(combined, "rtx") ||
		strings.Contains(combined, "gtx") ||
		strings.Contains(combined, "cmp") ||
		strings.Contains(combined, "ven_10de") ||
		strings.Contains(combined, "ven-10de")
}

func isAmdGPUNameOrID(name, id string) bool {
	combined := strings.ToLower(name + " " + id)
	return strings.Contains(combined, "amd") ||
		strings.Contains(combined, "radeon") ||
		strings.Contains(combined, "advanced micro devices") ||
		strings.Contains(combined, "ven_1002") ||
		strings.Contains(combined, "ven-1002")
}

func isIntelGPUNameOrID(name, id string) bool {
	combined := strings.ToLower(name + " " + id)
	return strings.Contains(combined, "intel") ||
		strings.Contains(combined, "arc") ||
		strings.Contains(combined, "iris") ||
		strings.Contains(combined, "uhd") ||
		strings.Contains(combined, "hd graphics") ||
		strings.Contains(combined, "ven_8086") ||
		strings.Contains(combined, "ven-8086")
}

func gpuVendorFamily(name, id string) string {
	if isNvidiaGPUNameOrID(name, id) {
		return "nvidia"
	}
	if isAmdGPUNameOrID(name, id) {
		return "amd"
	}
	if isIntelGPUNameOrID(name, id) {
		return "intel"
	}
	return ""
}

func mergeGPUStats(base []gpuDeviceStats, overlays ...[]gpuDeviceStats) []gpuDeviceStats {
	return mergeGPUStatsWithOptions(false, base, overlays...)
}

func mergeGPUStatsWithOptions(preserveObservedMemory bool, base []gpuDeviceStats, overlays ...[]gpuDeviceStats) []gpuDeviceStats {
	result := coalesceGPUStats(base)

	for _, overlay := range overlays {
		if len(overlay) == 0 {
			continue
		}
		overlay = coalesceGPUStats(overlay)
		matchedOverlay := make([]bool, len(overlay))
		for index := range result {
			matchIndex := -1
			// 1. Direct ID or Name match
			for overlayIndex, candidate := range overlay {
				if matchedOverlay[overlayIndex] {
					continue
				}
				if (candidate.ID != "" && strings.EqualFold(result[index].ID, candidate.ID)) ||
					matchGPUName(result[index].Name, candidate.Name) {
					matchIndex = overlayIndex
					break
				}
			}

			// 2. Vendor-based ordinal fallback matching
			if matchIndex < 0 {
				targetVendor := gpuVendorFamily(result[index].Name, result[index].ID)
				if targetVendor != "" {
					targetOrdinal := 0
					for i := 0; i < index; i++ {
						if gpuVendorFamily(result[i].Name, result[i].ID) == targetVendor {
							targetOrdinal++
						}
					}
					candidateOrdinal := 0
					for overlayIndex, candidate := range overlay {
						if matchedOverlay[overlayIndex] {
							continue
						}
						if gpuVendorFamily(candidate.Name, candidate.ID) == targetVendor {
							if candidateOrdinal == targetOrdinal {
								matchIndex = overlayIndex
								break
							}
							candidateOrdinal++
						}
					}
				}
			}

			if matchIndex < 0 {
				continue
			}
			matchedOverlay[matchIndex] = true
			candidate := overlay[matchIndex]
			mergeGPUStatsRecord(&result[index], candidate, preserveObservedMemory)
		}

		for overlayIndex, candidate := range overlay {
			if !matchedOverlay[overlayIndex] {
				if resultIndex := findGPUStatsIdentity(result, candidate); resultIndex >= 0 {
					mergeGPUStatsRecord(&result[resultIndex], candidate, preserveObservedMemory)
					continue
				}
				result = append(result, candidate)
			}
		}
	}
	return result
}

// coalesceGPUStats collapses duplicate observations produced by different
// hardware APIs before they reach the dashboard. Windows can expose the same
// physical adapter once through a root LHM node and again through a child or
// performance-counter node, all carrying the same PNP-derived ID.
func coalesceGPUStats(items []gpuDeviceStats) []gpuDeviceStats {
	result := make([]gpuDeviceStats, 0, len(items))
	for _, candidate := range items {
		if index := findGPUStatsIdentity(result, candidate); index >= 0 {
			mergeGPUStatsRecord(&result[index], candidate, false)
			continue
		}
		result = append(result, candidate)
	}
	return result
}

func findGPUStatsIdentity(items []gpuDeviceStats, candidate gpuDeviceStats) int {
	if strings.TrimSpace(candidate.ID) != "" {
		for index := range items {
			if strings.TrimSpace(items[index].ID) != "" && strings.EqualFold(items[index].ID, candidate.ID) {
				return index
			}
		}
	}
	for index := range items {
		if strings.TrimSpace(items[index].ID) == "" || strings.TrimSpace(candidate.ID) == "" {
			if matchGPUName(items[index].Name, candidate.Name) {
				return index
			}
		}
	}
	return -1
}

func mergeGPUStatsRecord(target *gpuDeviceStats, candidate gpuDeviceStats, preserveObservedMemory bool) {
	if candidate.UtilizationPercent > 0 || target.UtilizationPercent == 0 {
		target.UtilizationPercent = candidate.UtilizationPercent
	}
	if candidate.EncodeUtilizationPercent != nil {
		target.EncodeUtilizationPercent = candidate.EncodeUtilizationPercent
	}
	if candidate.DecodeUtilizationPercent != nil {
		target.DecodeUtilizationPercent = candidate.DecodeUtilizationPercent
	}
	if candidate.FrequencyMHz != nil {
		target.FrequencyMHz = candidate.FrequencyMHz
	}
	if candidate.Integrated {
		target.Integrated = true
	}
	if target.MemoryKind == "" || target.MemoryKind == "unknown" {
		if candidate.MemoryKind != "" {
			target.MemoryKind = candidate.MemoryKind
		}
	}
	if candidate.TemperatureC != nil {
		target.TemperatureC = candidate.TemperatureC
		target.TemperatureSource = candidate.TemperatureSource
	}
	if !preserveObservedMemory || !target.memoryObserved {
		mergeGPUMemoryStats(target, candidate)
	}
	if target.DriverVersion == "" && candidate.DriverVersion != "" {
		target.DriverVersion = candidate.DriverVersion
	}
}

func mergeMissingGPUMemory(previous, next []gpuDeviceStats) []gpuDeviceStats {
	if len(next) == 0 {
		return previous
	}
	if len(previous) == 0 {
		return next
	}
	return mergeGPUStatsWithOptions(true, next, previous)
}

func mergeWindowsGPUFallback(primary, fallback []gpuDeviceStats) []gpuDeviceStats {
	return mergeGPUStats(primary, fallback)
}

func applyIntegratedGPUTemperature(gpus []gpuDeviceStats, cpuTemperature float64) {
	if !isValidHardwareTemperature(cpuTemperature) {
		return
	}
	for index := range gpus {
		if !gpus[index].Integrated && !isIntegratedGPUName(gpus[index].Name) {
			continue
		}
		value := cpuTemperature
		gpus[index].TemperatureC = &value
		gpus[index].TemperatureSource = "cpuPackageShared"
		gpus[index].Integrated = true
	}
}

func appendIntegratedGPUTemperatureSensors(sensors *[]temperatureSensorReading, gpus []gpuDeviceStats, cpuTemperature float64) {
	if sensors == nil || !isValidHardwareTemperature(cpuTemperature) {
		return
	}
	for _, gpu := range gpus {
		if !gpu.Integrated && !isIntegratedGPUName(gpu.Name) {
			continue
		}
		value := cpuTemperature
		reading := newTemperatureSensorReading(
			"temperature-derived-gpu-"+sanitizeKey(gpu.ID),
			"cpu-package-shared",
			"derived",
			gpu.Name,
			"gpu",
			gpu.ID,
			"CPU Package shared temperature",
			&value,
			nil,
			nil,
			nil,
			"derived",
			"Integrated GPU has no independent temperature sensor",
		)
		*sensors = append(*sensors, reading)
	}
}

func appendGPUTemperatureSensors(sensors *[]temperatureSensorReading, gpus []gpuDeviceStats, source string) {
	if sensors == nil {
		return
	}
	for _, gpu := range gpus {
		if gpu.TemperatureC == nil {
			continue
		}
		value := *gpu.TemperatureC
		*sensors = append(*sensors, newTemperatureSensorReading(
			"temperature-"+sanitizeKey(source)+"-"+sanitizeKey(gpu.ID),
			source,
			source,
			gpu.Name,
			"gpu",
			gpu.ID,
			"GPU Temperature",
			&value,
			nil,
			nil,
			nil,
			"gpu_core",
			"Alternate GPU temperature source",
		))
	}
}

// A machine with one CPU package has no ambiguity when the hardware probe only
// exposes an aggregate Package/Core temperature. Preserve that value on the
// package record as well as the top-level metric so the server and per-CPU
// charts use the same source. Do not copy an aggregate across multiple
// packages, where it could falsely look like a per-package reading.
func applyCPUPackageTemperature(packages []cpuPackageStats, temperature *float64) {
	if len(packages) != 1 || temperature == nil || !isValidHardwareTemperature(*temperature) {
		return
	}
	if packages[0].TemperatureC == nil {
		value := *temperature
		packages[0].TemperatureC = &value
	}
}

func isIntegratedGPUName(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" {
		return false
	}
	if strings.Contains(lower, "arc") || strings.Contains(lower, "rx ") || strings.Contains(lower, "firepro") {
		return false
	}
	return (strings.Contains(lower, "intel") && (strings.Contains(lower, "uhd") || strings.Contains(lower, "iris") || strings.Contains(lower, "hd graphics"))) ||
		(strings.Contains(lower, "amd") && strings.Contains(lower, "radeon") && strings.Contains(lower, "graphics")) ||
		strings.Contains(lower, "integrated") || strings.Contains(lower, "apu")
}

func gpuMemoryKindForAdapter(name string, adapterRAM uint64) string {
	if isIntegratedGPUName(name) {
		return "shared"
	}
	if adapterRAM > 0 {
		return "dedicated"
	}
	return "unknown"
}

func gpuMemoryTotalForAdapter(name string, adapterRAM uint64) uint64 {
	if isIntegratedGPUName(name) {
		return 0
	}
	return adapterRAM
}

func mergeGPUMemoryStats(target *gpuDeviceStats, candidate gpuDeviceStats) {
	candidateKind := normalizeGPUMemoryKind(candidate.MemoryKind)
	targetKind := normalizeGPUMemoryKind(target.MemoryKind)
	if targetKind != "" && targetKind != "unknown" && candidateKind != "" && candidateKind != "unknown" && targetKind != candidateKind {
		return
	}
	if targetKind != "" && targetKind != "unknown" && candidateKind == "unknown" {
		return
	}
	if targetKind == "" || targetKind == "unknown" {
		if candidateKind != "" {
			target.MemoryKind = candidateKind
		}
	}
	candidateObserved := candidate.memoryObserved || candidate.MemoryTotalBytes > 0 || candidate.MemoryUsedBytes > 0
	if !candidateObserved {
		return
	}
	if candidate.MemoryTotalBytes > target.MemoryTotalBytes {
		// Multiple Windows providers may report the same adapter with different
		// scopes (for example a small child-node budget and a full shared-memory
		// view). Keep the observation with the larger known capacity.
		target.MemoryTotalBytes = candidate.MemoryTotalBytes
	}
	if candidate.memoryObserved || candidate.MemoryUsedBytes > 0 {
		if candidate.MemoryUsedBytes > target.MemoryUsedBytes {
			target.MemoryUsedBytes = candidate.MemoryUsedBytes
		}
	}
	target.memoryObserved = target.memoryObserved || candidate.memoryObserved
	if target.MemoryTotalBytes > 0 && target.MemoryTotalBytes < target.MemoryUsedBytes {
		target.MemoryTotalBytes = target.MemoryUsedBytes
	}
}

func normalizeGPUMemoryKind(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "dedicated":
		return "dedicated"
	case "shared":
		return "shared"
	case "unknown":
		return "unknown"
	default:
		return ""
	}
}

func collectLinuxMemoryMetadata() (*float64, *int, string) {
	if runtime.GOOS != "linux" {
		return nil, nil, ""
	}
	if _, err := exec.LookPath("dmidecode"); err != nil {
		return nil, nil, ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, "dmidecode", "--type", "memory").Output()
	if err != nil {
		return nil, nil, ""
	}

	type module struct {
		populated          bool
		speedMHz           float64
		configuredSpeedMHz float64
		formFactor         string
	}
	modules := []module{}
	current := module{}
	flush := func() {
		if current.populated {
			modules = append(modules, current)
		}
		current = module{}
	}
	for _, rawLine := range strings.Split(string(output), "\n") {
		line := strings.TrimSpace(rawLine)
		switch {
		case strings.HasPrefix(line, "Memory Device"):
			flush()
		case strings.HasPrefix(line, "Size:"):
			current.populated = !strings.Contains(strings.ToLower(line), "no module installed") && !strings.Contains(strings.ToLower(line), "unknown")
		case strings.HasPrefix(line, "Speed:"):
			current.speedMHz = parseMemorySpeedMHz(line)
		case strings.HasPrefix(line, "Configured Memory Speed:"):
			current.configuredSpeedMHz = parseMemorySpeedMHz(line)
		case strings.HasPrefix(line, "Form Factor:"):
			current.formFactor = strings.TrimSpace(strings.TrimPrefix(line, "Form Factor:"))
		}
	}
	flush()
	if len(modules) == 0 {
		return nil, nil, ""
	}
	speeds := []float64{}
	formFactor := ""
	for _, item := range modules {
		speed := item.configuredSpeedMHz
		if speed <= 0 {
			speed = item.speedMHz
		}
		if speed > 0 {
			speeds = append(speeds, speed)
		}
		if formFactor == "" {
			formFactor = item.formFactor
		}
	}
	return averagePointer(speeds), intPointer(len(modules)), formFactor
}

func parseMemorySpeedMHz(line string) float64 {
	colon := strings.Index(line, ":")
	if colon < 0 {
		return 0
	}
	for _, field := range strings.Fields(line[colon+1:]) {
		value, err := strconv.ParseFloat(strings.TrimSpace(field), 64)
		if err == nil && value > 0 {
			return value
		}
	}
	return 0
}

func intPointer(value int) *int {
	return &value
}

func collectPlatformSensorBackends() []sensorBackendStatus {
	if runtime.GOOS == "linux" {
		return []sensorBackendStatus{
			{ID: "linux-procfs-gopsutil", Label: "Linux procfs / gopsutil", OK: true, Detail: "CPU、内存、进程、磁盘 IO 和网络计数可用"},
			{ID: "linux-sysfs", Label: "Linux sysfs", OK: true, Detail: "网卡链路速度和磁盘型号按系统暴露情况读取"},
			optionalCommandBackend("lm-sensors", "lm-sensors", "sensors", "CPU 温度和风扇传感器"),
			optionalCommandBackend("smartmontools", "smartctl", "smartctl", "磁盘温度和健康信息"),
			optionalCommandBackend("nvidia-smi", "NVIDIA SMI", "nvidia-smi", "NVIDIA GPU 指标"),
		}
	}
	return []sensorBackendStatus{
		{ID: "windows-wmi", Label: "Windows WMI", OK: true, Detail: "系统、内存、网卡和磁盘元数据可用；温度/风扇数值需硬件驱动暴露"},
		{ID: "windows-performance-counters", Label: "Windows 性能计数器", OK: true, Detail: "CPU、磁盘、网络和 GPU Engine/Adapter Memory 计数器可用"},
		optionalCommandBackend("smartmontools", "smartctl", "smartctl.exe", "磁盘温度和健康信息"),
		optionalCommandBackend("nvidia-smi", "NVIDIA SMI", "nvidia-smi.exe", "NVIDIA GPU 指标"),
	}
}

func optionalCommandBackend(id, label, command, capability string) sensorBackendStatus {
	if _, err := exec.LookPath(command); err == nil {
		return sensorBackendStatus{ID: id, Label: label, OK: true, Detail: capability + "组件可执行"}
	}
	return sensorBackendStatus{ID: id, Label: label, OK: false, Detail: "未安装或不可执行；" + capability + "不可用"}
}

func encodePowerShellCommand(script string) string {
	encoded := utf16.Encode([]rune(script))
	bytesValue := make([]byte, len(encoded)*2)
	for index, value := range encoded {
		binary.LittleEndian.PutUint16(bytesValue[index*2:], value)
	}
	return base64.StdEncoding.EncodeToString(bytesValue)
}

func runWindowsPowerShell(ctx context.Context, script string, environment ...string) ([]byte, error) {
	normalizedScript := strings.Join([]string{
		"[Console]::InputEncoding = [System.Text.Encoding]::UTF8",
		"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
		"$OutputEncoding = [System.Text.Encoding]::UTF8",
		"$ProgressPreference = 'SilentlyContinue'",
		script,
	}, "; ")
	command := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShellCommand(normalizedScript))
	if len(environment) > 0 {
		command.Env = append(os.Environ(), environment...)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if err == nil {
		return output, nil
	}
	if detail := strings.TrimSpace(stderr.String()); detail != "" {
		return output, fmt.Errorf("%w；PowerShell stderr: %s", err, detail)
	}
	return output, err
}

func collectCPUPackages() (*float64, []cpuPackageStats, error) {
	infoCtx, infoCancel := context.WithTimeout(context.Background(), cpuPackagesTimeout)
	defer infoCancel()
	info, err := cpu.InfoWithContext(infoCtx)
	if err != nil {
		if runtime.GOOS == "windows" {
			if frequency, packages, fallbackErr := collectWindowsCPUPackagesFallback(); fallbackErr == nil {
				return frequency, packages, nil
			}
		}
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
		l3CacheBytes uint64
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
		if entry.CacheSize > 0 {
			cacheBytes := uint64(entry.CacheSize) * 1024
			if cacheBytes > current.l3CacheBytes {
				current.l3CacheBytes = cacheBytes
			}
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
		if runtime.GOOS == "windows" {
			if frequency, fallbackPackages, fallbackErr := collectWindowsCPUPackagesFallback(); fallbackErr == nil {
				return frequency, fallbackPackages, nil
			}
		}
		return nil, []cpuPackageStats{}, nil
	}

	// gopsutil maps Win32_Processor.NumberOfLogicalProcessors to InfoStat.Cores.
	// Use the separate topology query for a single Windows socket so the UI does
	// not report logical processors as physical cores.
	if runtime.GOOS == "windows" && len(packages) == 1 {
		for _, entry := range packages {
			if physicalCount > 0 {
				entry.coreCount = physicalCount
			}
			if logicalCount > 0 {
				entry.logicalCount = logicalCount
			}
		}
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
			L3CacheBytes: entry.l3CacheBytes,
			FrequencyMHz: freq,
		})
	}

	if runtime.GOOS == "windows" {
		if _, fallbackPackages, fallbackErr := collectWindowsCPUPackagesFallback(); fallbackErr == nil {
			for index := range result {
				if result[index].L3CacheBytes == 0 && index < len(fallbackPackages) {
					result[index].L3CacheBytes = fallbackPackages[index].L3CacheBytes
				}
			}
		}
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].ID < result[j].ID
	})

	return averagePointer(allFrequencies), result, nil
}

type windowsCPUPackageRecord struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Model           string  `json:"model"`
	CoreCount       int     `json:"coreCount"`
	LogicalCount    int     `json:"logicalCount"`
	FrequencyMHz    float64 `json:"frequencyMHz"`
	MaxFrequencyMHz float64 `json:"maxFrequencyMHz"`
	L3CacheKB       uint64  `json:"l3CacheKB"`
}

func collectWindowsCPUPackagesFallback() (*float64, []cpuPackageStats, error) {
	if runtime.GOOS != "windows" {
		return nil, nil, errors.New("Windows CPU package fallback is only available on Windows")
	}

	ctx, cancel := context.WithTimeout(context.Background(), cpuPackagesTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Processor | ForEach-Object { [pscustomobject]@{ id=[string]$_.DeviceID; name=[string]$_.Name; model=[string]$_.Name; coreCount=[int]$_.NumberOfCores; logicalCount=[int]$_.NumberOfLogicalProcessors; frequencyMHz=[double]$_.CurrentClockSpeed; maxFrequencyMHz=[double]$_.MaxClockSpeed; l3CacheKB=[UInt64]$_.L3CacheSize } }); @($rows) | ConvertTo-Json -Depth 4 -Compress`
	output, err := runWindowsPowerShell(ctx, commandText)
	if err != nil {
		return nil, nil, err
	}
	records, err := decodeJSONList[windowsCPUPackageRecord](bytes.TrimSpace(output))
	if err != nil {
		return nil, nil, err
	}

	packages := make([]cpuPackageStats, 0, len(records))
	frequencies := make([]float64, 0, len(records))
	for index, record := range records {
		id := strings.TrimSpace(record.ID)
		if id == "" {
			id = fmt.Sprintf("CPU%d", index)
		}
		name := strings.TrimSpace(record.Name)
		if name == "" {
			name = fmt.Sprintf("CPU %d", index+1)
		}
		model := strings.TrimSpace(record.Model)
		frequency := record.FrequencyMHz
		if frequency <= 0 {
			frequency = record.MaxFrequencyMHz
		}
		if frequency > 0 {
			frequencies = append(frequencies, frequency)
		}
		var frequencyPointer *float64
		if frequency > 0 {
			value := frequency
			frequencyPointer = &value
		}
		packages = append(packages, cpuPackageStats{
			ID:           "cpu-" + sanitizeKey(id),
			Name:         name,
			Model:        model,
			CoreCount:    record.CoreCount,
			LogicalCount: record.LogicalCount,
			L3CacheBytes: record.L3CacheKB * 1024,
			FrequencyMHz: frequencyPointer,
		})
	}
	return averagePointer(frequencies), packages, nil
}

type hardwareSensorSnapshot struct {
	HardwareType    string                   `json:"hardwareType"`
	Name            string                   `json:"name"`
	InstanceID      string                   `json:"instanceId"`
	TemperatureC    *float64                 `json:"temperatureC"`
	HealthPercent   *float64                 `json:"healthPercent"`
	HealthStatus    string                   `json:"healthStatus"`
	HealthReason    string                   `json:"healthReason"`
	SmartAttributes []hardwareSmartAttribute `json:"smartAttributes"`
	Sensors         []hardwareSensor         `json:"sensors"`
}

type hardwareSensorCache struct {
	UpdatedAt string                   `json:"updatedAt"`
	Snapshots []hardwareSensorSnapshot `json:"snapshots"`
}

type hardwarePawnIOStatus struct {
	Available bool   `json:"available"`
	Installed *bool  `json:"installed"`
	Loaded    *bool  `json:"loaded"`
	Version   string `json:"version"`
	Error     string `json:"error"`
}

type hardwareSensorProbeResult struct {
	Snapshots []hardwareSensorSnapshot `json:"snapshots"`
	PawnIO    hardwarePawnIOStatus     `json:"pawnIo"`
}

type hardwareSensor struct {
	SensorType string   `json:"sensorType"`
	Name       string   `json:"name"`
	Value      *float64 `json:"value"`
}

type hardwareSmartAttribute struct {
	ID        int     `json:"id"`
	Name      string  `json:"name"`
	Value     float64 `json:"value"`
	Threshold float64 `json:"threshold"`
}

type hardwareSensorMetrics struct {
	cpuFrequencyMHz      *float64
	cpuTemperatureC      *float64
	cpuTemperatureSource string
	gpus                 []gpuDeviceStats
	fans                 []fanSensorStats
	diskSensorMetadata   map[string]diskSensorMetadata
	sensorBackends       []sensorBackendStatus
	temperatureSensors   []temperatureSensorReading
}

// LibreHardwareMonitor exposes live clocks, including CPU boost clocks, where WMI often reports a nominal value.
func collectHardwareSensors() hardwareSensorMetrics {
	if runtime.GOOS == "linux" {
		return collectLinuxHardwareSensors()
	}
	if runtime.GOOS != "windows" {
		return hardwareSensorMetrics{
			gpus:               []gpuDeviceStats{},
			fans:               []fanSensorStats{},
			diskSensorMetadata: map[string]diskSensorMetadata{},
			sensorBackends:     []sensorBackendStatus{},
		}
	}

	dllPath := resolveHardwareMonitorPath()
	if dllPath == "" {
		return hardwareSensorMetrics{
			gpus:               []gpuDeviceStats{},
			fans:               []fanSensorStats{},
			diskSensorMetadata: map[string]diskSensorMetadata{},
			sensorBackends: []sensorBackendStatus{{
				ID:     "librehardwaremonitor",
				Label:  "LibreHardwareMonitor",
				OK:     false,
				Detail: "未找到 LibreHardwareMonitorLib.dll；将尝试使用 Windows 标准 GPU 性能计数器",
			}},
		}
	}

	// The bundled LibreHardwareMonitor library is the Windows-compatible
	// build used by the existing PowerShell integration. Its mutex setup uses
	// the .NET Framework constructor, which is not callable from the .NET 10
	// probe. Keep PowerShell as the primary path so CPU/PawnIO sensors are not
	// lost to an incompatible optional probe, while retaining the .NET probe as
	// a fallback for future compatible monitor libraries.
	powerShellSnapshots, powerShellErr := collectWindowsHardwareSnapshotsWithPowerShell(dllPath)
	if powerShellErr == nil {
		powerShellSnapshots = alignWindowsHardwareGPUIdentifiers(powerShellSnapshots)
		metrics := applyPrivilegedHardwareTemperature(mapHardwareSensors(powerShellSnapshots))
		metrics.sensorBackends = []sensorBackendStatus{{
			ID:     "librehardwaremonitor",
			Label:  "LibreHardwareMonitor",
			OK:     true,
			Detail: hardwareSensorDetail(metrics, "PowerShell 传感器探针", dllPath),
		}}
		return metrics
	}

	probeDetail := hardwareMonitorLibraryDetail(dllPath) + "；PowerShell 传感器探针读取失败：" + powerShellErr.Error()
	if probePath := resolveHardwareMonitorProbePath(); probePath != "" {
		if snapshots, pawnIO, probeErr := collectWindowsHardwareSnapshotsWithDotnetProbe(probePath, dllPath); probeErr == nil {
			snapshots = alignWindowsHardwareGPUIdentifiers(snapshots)
			metrics := applyPrivilegedHardwareTemperature(mapHardwareSensors(snapshots))
			metrics.sensorBackends = []sensorBackendStatus{{
				ID:     "librehardwaremonitor",
				Label:  "LibreHardwareMonitor",
				OK:     true,
				Detail: hardwareSensorDetail(metrics, ".NET 传感器探针", dllPath) + formatHardwarePawnIOStatus(pawnIO) + probeDetail,
			}}
			return metrics
		} else {
			probeDetail += "；.NET 传感器探针读取失败：" + probeErr.Error()
		}
	}

	metrics := applyPrivilegedHardwareTemperature(hardwareSensorMetrics{
		gpus:               []gpuDeviceStats{},
		fans:               []fanSensorStats{},
		diskSensorMetadata: map[string]diskSensorMetadata{},
		sensorBackends: []sensorBackendStatus{{
			ID:     "librehardwaremonitor",
			Label:  "LibreHardwareMonitor",
			OK:     false,
			Detail: "读取失败：" + probeDetail,
		}},
	})
	if metrics.cpuTemperatureC != nil {
		metrics.sensorBackends = []sensorBackendStatus{{
			ID:     "librehardwaremonitor",
			Label:  "LibreHardwareMonitor",
			OK:     true,
			Detail: "已使用 SYSTEM 硬件传感器缓存；" + hardwareSensorDetail(metrics, "特权传感器缓存", dllPath),
		}}
	}
	return metrics
}

func hardwareSensorCachePath() string {
	if configured := strings.TrimSpace(os.Getenv("DSC_HARDWARE_SENSOR_CACHE")); configured != "" {
		return configured
	}
	return defaultHardwareSensorCachePath
}

func applyPrivilegedHardwareTemperature(metrics hardwareSensorMetrics) hardwareSensorMetrics {
	if runtime.GOOS != "windows" {
		return metrics
	}

	cache, err := readHardwareSensorCache(hardwareSensorCachePath())
	if err != nil {
		return metrics
	}
	cachedMetrics := mapHardwareSensors(cache.Snapshots)
	if cachedMetrics.cpuTemperatureC == nil && len(cachedMetrics.temperatureSensors) == 0 {
		return metrics
	}
	if len(cachedMetrics.temperatureSensors) > 0 {
		metrics.temperatureSensors = mergeTemperatureSensors(metrics.temperatureSensors, cachedMetrics.temperatureSensors)
	}
	if metrics.cpuTemperatureC == nil && cachedMetrics.cpuTemperatureC != nil {
		metrics.cpuTemperatureC = cachedMetrics.cpuTemperatureC
		metrics.cpuTemperatureSource = "SYSTEM 硬件传感器缓存"
	}
	return metrics
}

func mergeTemperatureSensors(previous, next []temperatureSensorReading) []temperatureSensorReading {
	if len(previous) == 0 {
		return append([]temperatureSensorReading{}, next...)
	}
	if len(next) == 0 {
		return append([]temperatureSensorReading{}, previous...)
	}
	merged := make(map[string]temperatureSensorReading, len(previous)+len(next))
	order := make([]string, 0, len(previous)+len(next))
	for _, reading := range append(append([]temperatureSensorReading{}, previous...), next...) {
		key := reading.ID
		if strings.TrimSpace(key) == "" {
			key = reading.Source + "-" + reading.Hardware + "-" + reading.RawName
		}
		if _, exists := merged[key]; !exists {
			order = append(order, key)
		}
		merged[key] = reading
	}
	result := make([]temperatureSensorReading, 0, len(order))
	for _, key := range order {
		result = append(result, merged[key])
	}
	return result
}

func readHardwareSensorCache(path string) (hardwareSensorCache, error) {
	var cache hardwareSensorCache
	raw, err := os.ReadFile(path)
	if err != nil {
		return cache, err
	}
	if err := json.Unmarshal(raw, &cache); err != nil {
		return cache, err
	}
	updatedAt, err := time.Parse(time.RFC3339, strings.TrimSpace(cache.UpdatedAt))
	if err != nil || time.Since(updatedAt) > hardwareSensorCacheMaxAge {
		return hardwareSensorCache{}, fmt.Errorf("hardware sensor cache is stale")
	}
	return cache, nil
}

func writeHardwareSensorCache(path string, snapshots []hardwareSensorSnapshot) error {
	cache := hardwareSensorCache{
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Snapshots: snapshots,
	}
	raw, err := json.Marshal(cache)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o644); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(path)
		if retryErr := os.Rename(temporary, path); retryErr != nil {
			_ = os.Remove(temporary)
			return err
		}
	}
	return nil
}

func runHardwareSensorHelper(args []string) error {
	if runtime.GOOS != "windows" {
		return errors.New("hardware sensor helper is only available on Windows")
	}
	outputPath := commandArgument(args, "--output")
	if outputPath == "" {
		outputPath = hardwareSensorCachePath()
	}
	stopContext, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	for {
		dllPath := resolveHardwareMonitorPath()
		if dllPath == "" {
			log.Printf("hardware sensor helper: LibreHardwareMonitorLib.dll not found")
		} else if snapshots, err := collectWindowsHardwareSnapshotsWithPowerShell(dllPath); err != nil {
			log.Printf("hardware sensor helper probe failed: %v", err)
		} else if err := writeHardwareSensorCache(outputPath, snapshots); err != nil {
			log.Printf("hardware sensor helper cache write failed: %v", err)
		}
		if !waitForNextCycle(stopContext.Done(), hardwareSensorHelperInterval) {
			return nil
		}
	}
}

func commandArgument(args []string, name string) string {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == name {
			return strings.TrimSpace(args[index+1])
		}
	}
	return ""
}

func installHardwareSensorHelper() error {
	if runtime.GOOS != "windows" {
		return errors.New("hardware sensor helper is only available on Windows")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	outputPath := hardwareSensorCachePath()
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return err
	}
	_ = runScheduledTaskCommand("/End", "/TN", hardwareSensorHelperTaskName)
	_ = runScheduledTaskCommand("/Delete", "/TN", hardwareSensorHelperTaskName, "/F")
	taskRun := fmt.Sprintf(`"%s" hardware-sensor-helper --output "%s"`, executable, outputPath)
	if err := runScheduledTaskCommand(
		"/Create",
		"/TN", hardwareSensorHelperTaskName,
		"/TR", taskRun,
		"/SC", "ONSTART",
		"/RU", "SYSTEM",
		"/RL", "HIGHEST",
		"/F",
	); err != nil {
		return err
	}
	return runScheduledTaskCommand("/Run", "/TN", hardwareSensorHelperTaskName)
}

func uninstallHardwareSensorHelper() error {
	if runtime.GOOS != "windows" {
		return nil
	}
	_ = runScheduledTaskCommand("/End", "/TN", hardwareSensorHelperTaskName)
	if err := runScheduledTaskCommand("/Delete", "/TN", hardwareSensorHelperTaskName, "/F"); err != nil {
		return err
	}
	return nil
}

func runScheduledTaskCommand(args ...string) error {
	command := exec.Command("schtasks.exe", args...)
	output, err := command.CombinedOutput()
	if err != nil {
		detail := strings.TrimSpace(string(output))
		if detail != "" {
			return fmt.Errorf("schtasks %v failed: %w: %s", args, err, detail)
		}
		return fmt.Errorf("schtasks %v failed: %w", args, err)
	}
	return nil
}

func collectWindowsHardwareSnapshotsWithPowerShell(dllPath string) ([]hardwareSensorSnapshot, error) {
	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='Stop'; $dllDir=Split-Path -Parent $env:DSC_LHM_DLL; [System.IO.Directory]::SetCurrentDirectory($dllDir); Set-Location -LiteralPath $dllDir; Get-ChildItem -LiteralPath $dllDir -Filter '*.dll' -File | ForEach-Object { try { [System.Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null } catch {} }; Add-Type -Path $env:DSC_LHM_DLL; $gpuIds=@{}; Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { if($_.Name -and $_.PNPDeviceID){ $gpuIds[[string]$_.Name]=[string]$_.PNPDeviceID } }; $computer=New-Object LibreHardwareMonitor.Hardware.Computer; $computer.IsCpuEnabled=$true; $computer.IsGpuEnabled=$true; $computer.IsMotherboardEnabled=$true; $computer.IsControllerEnabled=$true; $computer.IsStorageEnabled=$true; $computer.Open(); function Read-Hardware($hardware) { $hardware.Update(); $instanceId=''; $temperatureC=$null; $healthPercent=$null; $healthStatus=''; $healthReason=''; $smartAttributes=@(); if($gpuIds.ContainsKey([string]$hardware.Name)){ $instanceId=$gpuIds[[string]$hardware.Name] }; if([string]$hardware.HardwareType -eq 'Storage') { $storage=$hardware.Storage; $smart=$null; if($storage){ $smart=$storage.Smart }; if($smart){ if($smart.Temperature -ne $null){ $temperatureC=[double]$smart.Temperature }; if($smart.Life -ne $null){ $healthPercent=[double]$smart.Life }; $healthStatus=[string]$smart.DiskStatus; if($healthStatus -and $healthStatus -ne 'Unknown'){ $healthReason='SMART status from LibreHardwareMonitor' } }; $smartAttributes=@($hardware.Attributes | ForEach-Object { [pscustomobject]@{ id=[int]$_.Id; name=[string]$_.Name; value=[double]$_.Value; threshold=[double]$_.Threshold } }) }; $result=@([pscustomobject]@{ hardwareType=[string]$hardware.HardwareType; name=[string]$hardware.Name; instanceId=$instanceId; temperatureC=$temperatureC; healthPercent=$healthPercent; healthStatus=$healthStatus; healthReason=$healthReason; smartAttributes=$smartAttributes; sensors=@($hardware.Sensors | ForEach-Object { [pscustomobject]@{ sensorType=[string]$_.SensorType; name=[string]$_.Name; value=$_.Value } }) }); foreach($sub in $hardware.SubHardware) { $result += Read-Hardware $sub }; return $result }; try { @($computer.Hardware | ForEach-Object { Read-Hardware $_ }) | ConvertTo-Json -Depth 7 -Compress } finally { $computer.Close() }`
	output, err := runWindowsPowerShell(ctx, commandText, "DSC_LHM_DLL="+dllPath)
	if err != nil {
		return nil, err
	}
	snapshots, err := decodeHardwareSnapshots(output)
	if err != nil {
		return nil, fmt.Errorf("传感器输出解析失败：%w", err)
	}
	return snapshots, nil
}

func collectLinuxHardwareSensors() hardwareSensorMetrics {
	metrics := hardwareSensorMetrics{
		gpus:               []gpuDeviceStats{},
		fans:               []fanSensorStats{},
		diskSensorMetadata: map[string]diskSensorMetadata{},
		temperatureSensors: []temperatureSensorReading{},
	}
	if runtime.GOOS != "linux" {
		return metrics
	}

	cpuTemperatures := []float64{}
	cpuPackageTemperatures := []float64{}
	linuxGPUs := map[string]*gpuDeviceStats{}
	hwmonPaths, _ := filepath.Glob("/sys/class/hwmon/hwmon*")
	hwmonSensorCount := 0
	for _, hwmonPath := range hwmonPaths {
		hwmonName := readTrimmedFile(filepath.Join(hwmonPath, "name"))
		hwmonIdentity := linuxHwmonIdentity(hwmonPath, hwmonName)
		for _, temperaturePath := range globFiles(filepath.Join(hwmonPath, "temp*_input")) {
			value, ok := readLinuxRawSensorValue(temperaturePath, 1000)
			if !ok {
				continue
			}
			hwmonSensorCount++
			baseName := strings.TrimSuffix(filepath.Base(temperaturePath), "_input")
			label := readTrimmedFile(filepath.Join(hwmonPath, baseName+"_label"))
			if label == "" {
				label = baseName
			}
			role := linuxTemperatureRole(hwmonName, label)
			highC := readOptionalLinuxSensorValue(filepath.Join(hwmonPath, baseName+"_max"), 1000)
			criticalC := readOptionalLinuxSensorValue(filepath.Join(hwmonPath, baseName+"_crit"), 1000)
			emergencyC := readOptionalLinuxSensorValue(filepath.Join(hwmonPath, baseName+"_emergency"), 1000)
			reading := newTemperatureSensorReading(
				"temperature-linux-hwmon-"+sanitizeKey(hwmonIdentity+"-"+baseName+"-"+label),
				"linux-hwmon",
				"hwmon",
				hwmonName,
				"hwmon",
				hwmonIdentity,
				label,
				&value,
				highC,
				criticalC,
				emergencyC,
				role,
				"",
			)
			reading.Path = temperaturePath
			if alarm, exists := readOptionalLinuxAlarm(filepath.Join(hwmonPath, baseName+"_alarm")); exists {
				reading.Alarm = &alarm
			}
			metrics.temperatureSensors = append(metrics.temperatureSensors, reading)
			if reading.Status == "valid" && (role == "gpu_core" || role == "gpu_hotspot") {
				gpu := linuxGPUs[hwmonIdentity]
				if gpu == nil {
					gpuName := hwmonName
					if strings.EqualFold(gpuName, "nouveau") {
						gpuName = "NVIDIA GPU (nouveau)"
					}
					gpu = &gpuDeviceStats{
						ID:         "gpu-linux-" + sanitizeKey(hwmonIdentity),
						Name:       gpuName,
						MemoryKind: "unknown",
					}
					linuxGPUs[hwmonIdentity] = gpu
				}
				if role == "gpu_core" || gpu.TemperatureC == nil {
					value := value
					gpu.TemperatureC = &value
					gpu.TemperatureSource = "linux-hwmon"
				}
			}
			if reading.Status == "valid" {
				switch role {
				case "cpu_package":
					cpuPackageTemperatures = append(cpuPackageTemperatures, value)
				case "cpu_core":
					cpuTemperatures = append(cpuTemperatures, value)
				}
			}
		}
		for _, fanPath := range globFiles(filepath.Join(hwmonPath, "fan*_input")) {
			value, ok := readLinuxSensorValue(fanPath, 1)
			if !ok || value < 0 {
				continue
			}
			hwmonSensorCount++
			baseName := strings.TrimSuffix(filepath.Base(fanPath), "_input")
			label := readTrimmedFile(filepath.Join(hwmonPath, baseName+"_label"))
			if label == "" {
				label = baseName
			}
			fan := fanSensorStats{
				ID:        "fan-linux-" + sanitizeKey(hwmonName+"-"+baseName),
				Label:     label,
				Interface: hwmonName,
				RPM:       int(math.Round(value)),
			}
			pwmPath := filepath.Join(hwmonPath, strings.Replace(baseName, "fan", "pwm", 1))
			if pwmValue := readTrimmedFile(pwmPath + "_enable"); pwmValue != "" {
				switch pwmValue {
				case "1":
					fan.ControlMode = "手动"
				case "2":
					fan.ControlMode = "自动"
				default:
					fan.ChannelState = pwmValue
				}
			}
			if fan.ChannelState == "" {
				fan.ChannelState = "可用"
			}
			metrics.fans = append(metrics.fans, fan)
		}
	}
	for _, gpu := range linuxGPUs {
		metrics.gpus = append(metrics.gpus, *gpu)
	}

	useThermalForCPU := len(cpuTemperatures) == 0 && len(cpuPackageTemperatures) == 0
	thermalPaths, _ := filepath.Glob("/sys/class/thermal/thermal_zone*/temp")
	for _, thermalPath := range thermalPaths {
		zonePath := filepath.Dir(thermalPath)
		zoneType := readTrimmedFile(filepath.Join(zonePath, "type"))
		value, ok := readLinuxRawSensorValue(thermalPath, 1000)
		if !ok {
			continue
		}
		role := linuxThermalZoneRole(zoneType)
		reading := newTemperatureSensorReading(
			"temperature-linux-thermal-"+sanitizeKey(zoneType+"-"+filepath.Base(zonePath)),
			"linux-thermal",
			"thermal",
			zoneType,
			"thermal",
			filepath.Base(zonePath),
			zoneType,
			&value,
			nil,
			nil,
			nil,
			role,
			"",
		)
		reading.Path = thermalPath
		if role == "acpi_zone" && reading.Status == "valid" {
			reading.Confidence = "diagnostic"
		}
		metrics.temperatureSensors = append(metrics.temperatureSensors, reading)
		if useThermalForCPU && reading.Status == "valid" {
			if role == "cpu_package" {
				cpuPackageTemperatures = append(cpuPackageTemperatures, value)
			} else if role == "cpu_core" {
				cpuTemperatures = append(cpuTemperatures, value)
			}
		}
	}
	if len(cpuPackageTemperatures) > 0 {
		metrics.cpuTemperatureC = averagePointer(cpuPackageTemperatures)
	} else {
		metrics.cpuTemperatureC = averagePointer(cpuTemperatures)
	}
	if hwmonSensorCount > 0 || len(metrics.temperatureSensors) > 0 {
		metrics.sensorBackends = []sensorBackendStatus{{
			ID:     "linux-hwmon-thermal",
			Label:  "Linux hwmon / thermal",
			OK:     true,
			Detail: "已读取温度或风扇传感器",
		}}
	} else {
		metrics.sensorBackends = []sensorBackendStatus{{
			ID:     "linux-hwmon-thermal",
			Label:  "Linux hwmon / thermal",
			OK:     false,
			Detail: "系统未暴露温度或风扇传感器节点",
		}}
	}
	return metrics
}

func linuxHwmonIdentity(hwmonPath, hwmonName string) string {
	if target, err := filepath.EvalSymlinks(filepath.Join(hwmonPath, "device")); err == nil && strings.TrimSpace(target) != "" {
		return hwmonName + "-" + target
	}
	return hwmonName + "-" + filepath.Base(hwmonPath)
}

func linuxTemperatureRole(hwmonName, label string) string {
	lowerHardware := strings.ToLower(strings.TrimSpace(hwmonName))
	lowerLabel := strings.ToLower(strings.TrimSpace(label))
	switch {
	case strings.Contains(lowerLabel, "peci"):
		return "peci"
	case strings.Contains(lowerHardware, "coretemp") || strings.Contains(lowerHardware, "k10temp") || strings.Contains(lowerHardware, "zenpower") || strings.Contains(lowerHardware, "cpu"):
		if strings.Contains(lowerLabel, "package") || strings.Contains(lowerLabel, "tctl") || strings.Contains(lowerLabel, "tdie") || strings.Contains(lowerLabel, "die") {
			return "cpu_package"
		}
		return "cpu_core"
	case strings.Contains(lowerHardware, "nouveau") || strings.Contains(lowerHardware, "amdgpu") || strings.Contains(lowerHardware, "nvidia") || strings.Contains(lowerHardware, "gpu"):
		if strings.Contains(lowerLabel, "hot") || strings.Contains(lowerLabel, "junction") {
			return "gpu_hotspot"
		}
		return "gpu_core"
	case strings.Contains(lowerHardware, "nvme") || strings.Contains(lowerHardware, "storage"):
		if strings.Contains(lowerLabel, "composite") || lowerLabel == "temp1" || lowerLabel == "temperature" {
			return "storage_composite"
		}
		return "storage_sensor"
	case strings.Contains(lowerHardware, "nct") || strings.Contains(lowerHardware, "it8") || strings.Contains(lowerHardware, "superio") || strings.Contains(lowerHardware, "w836"):
		return "superio"
	default:
		return "motherboard"
	}
}

func linuxThermalZoneRole(zoneType string) string {
	lower := strings.ToLower(strings.TrimSpace(zoneType))
	if strings.Contains(lower, "x86_pkg") || strings.Contains(lower, "cpu") || strings.Contains(lower, "processor") {
		return "cpu_package"
	}
	return "acpi_zone"
}

func globFiles(pattern string) []string {
	files, _ := filepath.Glob(pattern)
	return files
}

func readLinuxSensorValue(path string, divisor float64) (float64, bool) {
	value, ok := readLinuxRawSensorValue(path, divisor)
	return value, ok && isFiniteNonNegative(value)
}

func readLinuxRawSensorValue(path string, divisor float64) (float64, bool) {
	if divisor <= 0 {
		return 0, false
	}
	raw := readTrimmedFile(path)
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return value / divisor, true
}

func readOptionalLinuxSensorValue(path string, divisor float64) *float64 {
	value, ok := readLinuxRawSensorValue(path, divisor)
	if !ok || value <= 0 || value > 150 {
		return nil
	}
	return &value
}

func readOptionalLinuxAlarm(path string) (bool, bool) {
	raw := strings.TrimSpace(readTrimmedFile(path))
	if raw == "" {
		return false, false
	}
	return raw == "1" || strings.EqualFold(raw, "true"), true
}

func hardwareSensorDetail(metrics hardwareSensorMetrics, source, dllPath string) string {
	detail := fmt.Sprintf("已通过 %s 读取硬件传感器；温度源 %d 个，风扇 %d 个，磁盘 SMART %d 个%s", source, len(metrics.temperatureSensors), len(metrics.fans), len(metrics.diskSensorMetadata), hardwareMonitorLibraryDetail(dllPath))
	if strings.TrimSpace(metrics.cpuTemperatureSource) != "" {
		detail += "；CPU 温度来源=" + metrics.cpuTemperatureSource
	}
	if metrics.cpuTemperatureC == nil {
		detail += "；未发现 CPU Package/Core 温度传感器，不使用 ACPI 热区值"
	}
	if len(metrics.fans) == 0 {
		detail += "；主板/EC 未暴露可用风扇转速传感器"
	}
	return detail
}

func hardwareMonitorLibraryDetail(dllPath string) string {
	if strings.TrimSpace(dllPath) == "" {
		return ""
	}
	return "；LibreHardwareMonitor 库=" + dllPath
}

func resolveHardwareMonitorProbePath() string {
	candidates := []string{}
	if executable, err := os.Executable(); err == nil {
		base := filepath.Dir(executable)
		candidates = append(candidates,
			filepath.Join(base, "hardware-sensor-probe", "HardwareSensorProbe.dll"),
			filepath.Join(base, "windows-hardware", "hardware-sensor-probe", "HardwareSensorProbe.dll"),
		)
	}
	if workingDirectory, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(workingDirectory, "hardware-sensor-probe", "HardwareSensorProbe.dll"),
			filepath.Join(workingDirectory, "windows-hardware", "hardware-sensor-probe", "HardwareSensorProbe.dll"),
		)
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func resolveDotnetPath() string {
	for _, command := range []string{"dotnet.exe", "dotnet"} {
		if path, err := exec.LookPath(command); err == nil {
			return path
		}
	}
	candidates := []string{`C:\Program Files\dotnet\dotnet.exe`, `C:\Program Files (x86)\dotnet\dotnet.exe`}
	for _, programFiles := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} {
		if strings.TrimSpace(programFiles) != "" {
			candidates = append(candidates, filepath.Join(programFiles, "dotnet", "dotnet.exe"))
		}
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func collectWindowsHardwareSnapshotsWithDotnetProbe(probePath, dllPath string) ([]hardwareSensorSnapshot, hardwarePawnIOStatus, error) {
	if runtime.GOOS != "windows" {
		return nil, hardwarePawnIOStatus{}, errors.New(".NET hardware sensor probe is only available on Windows")
	}
	dotnetPath := resolveDotnetPath()
	if dotnetPath == "" {
		return nil, hardwarePawnIOStatus{}, errors.New("未找到可运行 .NET 传感器探针的 dotnet.exe")
	}
	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, dotnetPath, probePath, "--dll", dllPath)
	command.Dir = filepath.Dir(probePath)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return nil, hardwarePawnIOStatus{}, fmt.Errorf("%w: %s", err, detail)
		}
		return nil, hardwarePawnIOStatus{}, err
	}
	return decodeHardwareProbeResult(output)
}

func alignWindowsHardwareGPUIdentifiers(snapshots []hardwareSensorSnapshot) []hardwareSensorSnapshot {
	if runtime.GOOS != "windows" || len(snapshots) == 0 {
		return snapshots
	}
	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ name=[string]$_.Name; pnpDeviceId=[string]$_.PNPDeviceID } }); @($rows) | ConvertTo-Json -Depth 3 -Compress`
	output, err := runWindowsPowerShell(ctx, commandText)
	if err != nil {
		return snapshots
	}
	rows, err := decodeJSONList[windowsGPUAdapterRecord](bytes.TrimSpace(output))
	if err != nil {
		return snapshots
	}
	for index := range snapshots {
		if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(snapshots[index].HardwareType)), "gpu") {
			continue
		}
		for _, row := range rows {
			if strings.TrimSpace(row.PNPDeviceID) != "" && matchGPUName(row.Name, snapshots[index].Name) {
				snapshots[index].InstanceID = row.PNPDeviceID
				break
			}
		}
	}
	return snapshots
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

func decodeHardwareProbeResult(raw []byte) ([]hardwareSensorSnapshot, hardwarePawnIOStatus, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []hardwareSensorSnapshot{}, hardwarePawnIOStatus{}, nil
	}
	var result hardwareSensorProbeResult
	if err := json.Unmarshal(trimmed, &result); err == nil && result.Snapshots != nil {
		return result.Snapshots, result.PawnIO, nil
	}
	snapshots, err := decodeHardwareSnapshots(trimmed)
	return snapshots, hardwarePawnIOStatus{}, err
}

func formatHardwarePawnIOStatus(status hardwarePawnIOStatus) string {
	if !status.Available && status.Installed == nil && status.Loaded == nil && strings.TrimSpace(status.Error) == "" {
		return ""
	}
	installed := "unknown"
	if status.Installed != nil {
		installed = strconv.FormatBool(*status.Installed)
	}
	loaded := "unknown"
	if status.Loaded != nil {
		loaded = strconv.FormatBool(*status.Loaded)
	}
	detail := fmt.Sprintf("；PawnIO installed=%s, loaded=%s", installed, loaded)
	if version := strings.TrimSpace(status.Version); version != "" {
		detail += ", version=" + version
	}
	if status.Error != "" {
		detail += ", error=" + status.Error
	}
	return detail
}

func resolveHardwareMonitorPath() string {
	executablePath := ""
	if executable, err := os.Executable(); err == nil {
		executablePath = executable
	}
	workingDirectory, _ := os.Getwd()
	for _, candidate := range hardwareMonitorPathCandidates(
		executablePath,
		workingDirectory,
		os.Getenv("ProgramFiles(x86)"),
		os.Getenv("ProgramFiles"),
	) {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func hardwareMonitorPathCandidates(executablePath, workingDirectory, programFilesX86, programFiles string) []string {
	candidates := []string{}
	appendCandidate := func(candidate string) {
		if strings.TrimSpace(candidate) == "" {
			return
		}
		for _, existing := range candidates {
			if filepath.Clean(existing) == filepath.Clean(candidate) {
				return
			}
		}
		candidates = append(candidates, candidate)
	}
	// Prefer the library shipped with this Agent. An older FanControl copy can
	// be installed system-wide and may not expose the CPU/PawnIO sensors needed
	// by the current collector.
	for _, base := range []string{filepath.Dir(executablePath), workingDirectory} {
		if strings.TrimSpace(base) == "" || base == "." {
			continue
		}
		appendCandidate(filepath.Join(base, "windows-hardware", "librehardwaremonitor", "LibreHardwareMonitorLib.dll"))
	}
	for _, programFiles := range []string{programFilesX86, programFiles} {
		if strings.TrimSpace(programFiles) == "" {
			continue
		}
		appendCandidate(filepath.Join(programFiles, "FanControl", "LibreHardwareMonitorLib.dll"))
	}
	return candidates
}

func newTemperatureSensorReading(
	id, source, backend, hardware, hardwareType, instanceID, rawName string,
	currentC, highC, criticalC, emergencyC *float64,
	role, note string,
) temperatureSensorReading {
	reading := temperatureSensorReading{
		ID:           id,
		Source:       source,
		Backend:      backend,
		Hardware:     hardware,
		HardwareType: hardwareType,
		InstanceID:   instanceID,
		RawName:      strings.TrimSpace(rawName),
		DisplayName:  strings.TrimSpace(strings.Trim(strings.Join([]string{hardware, rawName}, " · "), " ·")),
		Role:         role,
		CurrentC:     currentC,
		HighC:        highC,
		CriticalC:    criticalC,
		EmergencyC:   emergencyC,
		Status:       "valid",
		Confidence:   "direct",
		Note:         strings.TrimSpace(note),
	}
	if reading.RawName == "" {
		reading.RawName = "Temperature"
	}
	if reading.DisplayName == "" {
		reading.DisplayName = reading.RawName
	}
	if role == "threshold" {
		reading.Status = "threshold"
		reading.Confidence = "diagnostic"
	} else if currentC == nil {
		reading.Status = "unavailable"
		reading.Confidence = "diagnostic"
	} else if !isValidHardwareTemperature(*currentC) || isLikelyUnwiredTemperature(hardwareType, rawName, *currentC) {
		reading.Status = "invalid"
		reading.Confidence = "diagnostic"
	}
	if role == "derived" {
		reading.Confidence = "derived"
	}
	if role == "motherboard" || role == "superio" || role == "peci" || role == "unknown" {
		if reading.Status == "valid" {
			reading.Confidence = "unmapped"
		}
	}
	return reading
}

func hardwareTemperatureRole(hardwareType, hardwareName, sensorName string) string {
	lowerType := strings.ToLower(strings.TrimSpace(hardwareType))
	lowerHardware := strings.ToLower(strings.TrimSpace(hardwareName))
	lowerName := strings.ToLower(strings.TrimSpace(sensorName))
	switch {
	case strings.Contains(lowerName, "warning") || strings.Contains(lowerName, "critical") || strings.Contains(lowerName, "threshold"):
		return "threshold"
	case lowerType == "storage" || strings.Contains(lowerType, "storage"):
		if strings.Contains(lowerName, "composite") || lowerName == "temperature" {
			return "storage_composite"
		}
		return "storage_sensor"
	case lowerType == "cpu" || strings.HasPrefix(lowerType, "cpu"):
		if strings.Contains(lowerName, "package") || strings.Contains(lowerName, "die") || strings.Contains(lowerName, "tctl") || strings.Contains(lowerName, "tdie") || strings.Contains(lowerName, "ccd") {
			return "cpu_package"
		}
		return "cpu_core"
	case strings.HasPrefix(lowerType, "gpu") || strings.Contains(lowerType, "graphics"):
		if strings.Contains(lowerName, "hot spot") || strings.Contains(lowerName, "hotspot") || strings.Contains(lowerName, "junction") {
			return "gpu_hotspot"
		}
		return "gpu_core"
	case strings.Contains(lowerName, "peci"):
		return "peci"
	case strings.Contains(lowerType, "acpi") || strings.Contains(lowerHardware, "thermal zone"):
		return "acpi_zone"
	case strings.Contains(lowerType, "superio") || strings.Contains(lowerType, "motherboard") || strings.Contains(lowerType, "controller"):
		return "superio"
	default:
		return "motherboard"
	}
}

func hardwareTemperatureThresholds(sensors []hardwareSensor) (highC, criticalC *float64) {
	for _, sensor := range sensors {
		if sensor.Value == nil || !isFiniteNonNegative(*sensor.Value) || !strings.EqualFold(strings.TrimSpace(sensor.SensorType), "temperature") {
			continue
		}
		name := strings.ToLower(strings.TrimSpace(sensor.Name))
		value := *sensor.Value
		switch {
		case strings.Contains(name, "warning") || strings.Contains(name, "high"):
			if highC == nil {
				highC = &value
			}
		case strings.Contains(name, "critical") || strings.Contains(name, "crit"):
			if criticalC == nil {
				criticalC = &value
			}
		}
	}
	return highC, criticalC
}

func isLikelyUnwiredTemperature(hardwareType, sensorName string, value float64) bool {
	if value > 1 {
		return false
	}
	lowerType := strings.ToLower(strings.TrimSpace(hardwareType))
	lowerName := strings.ToLower(strings.TrimSpace(sensorName))
	return strings.Contains(lowerType, "superio") && strings.HasPrefix(lowerName, "temperature #")
}

func mapHardwareSensors(snapshots []hardwareSensorSnapshot) hardwareSensorMetrics {
	metrics := hardwareSensorMetrics{
		gpus:               []gpuDeviceStats{},
		fans:               []fanSensorStats{},
		diskSensorMetadata: map[string]diskSensorMetadata{},
		temperatureSensors: []temperatureSensorReading{},
	}
	cpuClocks := []float64{}
	cpuTemperatures := []float64{}
	cpuPackageTemperatures := []float64{}

	for _, snapshot := range snapshots {
		hardwareType := strings.ToLower(snapshot.HardwareType)
		highC, criticalC := hardwareTemperatureThresholds(snapshot.Sensors)
		hasTemperatureSensor := false
		for _, sensor := range snapshot.Sensors {
			if !strings.EqualFold(strings.TrimSpace(sensor.SensorType), "temperature") {
				continue
			}
			hasTemperatureSensor = true
			role := hardwareTemperatureRole(hardwareType, snapshot.Name, sensor.Name)
			readingHighC, readingCriticalC := highC, criticalC
			if role == "threshold" {
				readingHighC = nil
				readingCriticalC = nil
			}
			metrics.temperatureSensors = append(metrics.temperatureSensors, newTemperatureSensorReading(
				"temperature-windows-"+sanitizeKey(snapshot.HardwareType+"-"+snapshot.Name+"-"+sensor.Name),
				"librehardwaremonitor",
				"librehardwaremonitor",
				snapshot.Name,
				snapshot.HardwareType,
				snapshot.InstanceID,
				sensor.Name,
				sensor.Value,
				readingHighC,
				readingCriticalC,
				nil,
				role,
				"",
			))
		}
		if snapshot.TemperatureC != nil && !hasTemperatureSensor {
			aggregateRole := hardwareTemperatureRole(hardwareType, snapshot.Name, "Hardware aggregate")
			metrics.temperatureSensors = append(metrics.temperatureSensors, newTemperatureSensorReading(
				"temperature-windows-"+sanitizeKey(snapshot.HardwareType+"-"+snapshot.Name+"-aggregate"),
				"librehardwaremonitor",
				"librehardwaremonitor",
				snapshot.Name,
				snapshot.HardwareType,
				snapshot.InstanceID,
				"Hardware aggregate",
				snapshot.TemperatureC,
				highC,
				criticalC,
				nil,
				aggregateRole,
				"",
			))
			if isValidHardwareTemperature(*snapshot.TemperatureC) && (hardwareType == "cpu" || strings.HasPrefix(hardwareType, "cpu")) {
				cpuPackageTemperatures = append(cpuPackageTemperatures, *snapshot.TemperatureC)
			}
		}
		if hardwareType == "storage" {
			metadata := diskSensorMetadata{
				TemperatureC:  snapshot.TemperatureC,
				HealthPercent: snapshot.HealthPercent,
				HealthStatus:  normalizeDiskHealthStatus(snapshot.HealthStatus),
				HealthReason:  strings.TrimSpace(snapshot.HealthReason),
			}
			if len(snapshot.SmartAttributes) > 0 {
				metadata.SmartAttributes = make([]diskSmartAttribute, 0, len(snapshot.SmartAttributes))
				for _, attribute := range snapshot.SmartAttributes {
					metadata.SmartAttributes = append(metadata.SmartAttributes, diskSmartAttribute{
						ID:        attribute.ID,
						Name:      attribute.Name,
						Value:     attribute.Value,
						Threshold: attribute.Threshold,
					})
				}
			}
			for _, sensor := range snapshot.Sensors {
				if sensor.Value == nil || !isFiniteNonNegative(*sensor.Value) {
					continue
				}
				sensorType := strings.ToLower(strings.TrimSpace(sensor.SensorType))
				sensorName := strings.ToLower(strings.TrimSpace(sensor.Name))
				switch {
				case sensorType == "temperature" && *sensor.Value > 0 && *sensor.Value <= 150 && (metadata.TemperatureC == nil || sensorName == "temperature"):
					value := *sensor.Value
					metadata.TemperatureC = &value
				case sensorType == "level" && (strings.Contains(sensorName, "life") || strings.Contains(sensorName, "health")):
					value := *sensor.Value
					metadata.HealthPercent = &value
				}
			}
			if metadata.TemperatureC != nil || metadata.HealthStatus != "" || metadata.HealthReason != "" || metadata.HealthPercent != nil || len(metadata.SmartAttributes) > 0 {
				metrics.diskSensorMetadata[sanitizeKey(snapshot.Name)] = metadata
			}
			continue
		}
		if hardwareType == "cpu" || strings.HasPrefix(hardwareType, "cpu") {
			for _, sensor := range snapshot.Sensors {
				if sensor.Value == nil {
					continue
				}
				if strings.EqualFold(sensor.SensorType, "temperature") && !isValidHardwareTemperature(*sensor.Value) {
					continue
				}
				if !isFinitePositive(*sensor.Value) {
					continue
				}
				sensorType := strings.ToLower(sensor.SensorType)
				sensorName := strings.ToLower(strings.TrimSpace(sensor.Name))
				if sensorType == "clock" && !strings.Contains(sensorName, "bus") && !strings.Contains(sensorName, "base") {
					cpuClocks = append(cpuClocks, *sensor.Value)
				}
				if sensorType == "temperature" {
					switch {
					case strings.Contains(sensorName, "package") || strings.Contains(sensorName, "die") || strings.Contains(sensorName, "tctl") || strings.Contains(sensorName, "tdie") || strings.Contains(sensorName, "ccd"):
						cpuPackageTemperatures = append(cpuPackageTemperatures, *sensor.Value)
					case strings.Contains(sensorName, "core") || strings.Contains(sensorName, "cpu") || strings.Contains(sensorName, "thermal"):
						cpuTemperatures = append(cpuTemperatures, *sensor.Value)
					case !strings.Contains(sensorName, "ambient") && !strings.Contains(sensorName, "motherboard") && !strings.Contains(sensorName, "vrm") && !strings.Contains(sensorName, "chipset"):
						// Some LibreHardwareMonitor versions expose the CPU sensor as
						// a generic name such as "Temperature #1". It is still safer
						// to use a temperature belonging to the CPU hardware node
						// than to fall back to an ACPI platform thermal zone.
						cpuTemperatures = append(cpuTemperatures, *sensor.Value)
					}
				}
			}
			continue
		}

		for _, sensor := range snapshot.Sensors {
			if sensor.Value == nil || !isFinitePositive(*sensor.Value) || !strings.EqualFold(sensor.SensorType, "fan") {
				continue
			}

			label := strings.TrimSpace(sensor.Name)
			if label == "" {
				label = "风扇"
			}
			interfaceName := strings.TrimSpace(snapshot.Name)
			fan := fanSensorStats{
				ID:        "fan-" + sanitizeKey(interfaceName+"-"+label),
				Label:     label,
				Interface: interfaceName,
				RPM:       int(math.Round(*sensor.Value)),
			}
			for _, related := range snapshot.Sensors {
				relatedName := strings.ToLower(related.Name)
				if related.Value == nil || !isFinitePositive(*related.Value) {
					continue
				}
				switch {
				case strings.EqualFold(related.SensorType, "temperature") && strings.Contains(relatedName, "target"):
					value := *related.Value
					fan.TargetTemperatureC = &value
				case strings.EqualFold(related.SensorType, "control") && strings.Contains(relatedName, "min"):
					value := *related.Value
					fan.MinPWMPercent = &value
				case strings.EqualFold(related.SensorType, "control") && strings.Contains(relatedName, "max"):
					value := *related.Value
					fan.MaxPWMPercent = &value
				case strings.EqualFold(related.SensorType, "control") && (strings.Contains(relatedName, "pwm") || strings.Contains(relatedName, "fan")):
					if fan.MinPWMPercent == nil {
						value := *related.Value
						fan.MinPWMPercent = &value
					}
				case strings.Contains(relatedName, "manual"):
					fan.ControlMode = "手动"
				case strings.Contains(relatedName, "auto"):
					fan.ControlMode = "自动"
				}
			}
			if fan.ControlMode == "" {
				fan.ChannelState = "可用"
			}
			metrics.fans = append(metrics.fans, fan)
		}

		if !strings.HasPrefix(hardwareType, "gpu") {
			continue
		}

		gpuID := snapshot.InstanceID
		if strings.TrimSpace(gpuID) == "" {
			gpuID = snapshot.Name
		}
		gpu := gpuDeviceStats{
			ID:         "gpu-" + sanitizeKey(gpuID),
			Name:       snapshot.Name,
			Integrated: isIntegratedGPUName(snapshot.Name),
		}
		if gpu.Integrated {
			gpu.MemoryKind = "shared"
		}
		var clock, load, temperature *float64
		if snapshot.TemperatureC != nil && isValidHardwareTemperature(*snapshot.TemperatureC) {
			value := *snapshot.TemperatureC
			temperature = &value
		}
		var dedicatedMemoryUsed, dedicatedMemoryTotal *float64
		var sharedMemoryUsed, sharedMemoryTotal *float64
		var genericMemoryUsed, genericMemoryTotal *float64
		for _, sensor := range snapshot.Sensors {
			if sensor.Value == nil || !isFinitePositive(*sensor.Value) {
				continue
			}
			sensorType := strings.ToLower(sensor.SensorType)
			sensorName := strings.ToLower(sensor.Name)
			switch {
			case sensorType == "clock" && (strings.Contains(sensorName, "core") || strings.Contains(sensorName, "gpu")):
				clock = maxSensorValue(clock, sensor.Value)
			case sensorType == "load" && (strings.Contains(sensorName, "core") || strings.Contains(sensorName, "gpu") || strings.Contains(sensorName, "d3d") || strings.Contains(sensorName, "3d")):
				load = maxSensorValue(load, sensor.Value)
			case sensorType == "temperature" && isValidHardwareTemperature(*sensor.Value) && isGPUTemperatureName(sensorName):
				temperature = maxSensorValue(temperature, sensor.Value)
			case sensorType == "data" || sensorType == "smalldata" || sensorType == "small data":
				isDedicated := strings.Contains(sensorName, "dedicated")
				isShared := strings.Contains(sensorName, "shared")
				isUsed := strings.Contains(sensorName, "used")
				isTotal := strings.Contains(sensorName, "total")

				if isDedicated && isUsed {
					dedicatedMemoryUsed = maxSensorValue(dedicatedMemoryUsed, sensor.Value)
				} else if isDedicated && isTotal {
					dedicatedMemoryTotal = maxSensorValue(dedicatedMemoryTotal, sensor.Value)
				} else if isShared && isUsed {
					sharedMemoryUsed = maxSensorValue(sharedMemoryUsed, sensor.Value)
				} else if isShared && isTotal {
					sharedMemoryTotal = maxSensorValue(sharedMemoryTotal, sensor.Value)
				} else if isUsed && strings.Contains(sensorName, "memory") {
					genericMemoryUsed = maxSensorValue(genericMemoryUsed, sensor.Value)
				} else if isTotal && strings.Contains(sensorName, "memory") {
					genericMemoryTotal = maxSensorValue(genericMemoryTotal, sensor.Value)
				}
			}
		}
		if clock == nil && load == nil && temperature == nil && dedicatedMemoryUsed == nil && sharedMemoryUsed == nil && genericMemoryUsed == nil {
			continue
		}
		gpu.FrequencyMHz = clock
		gpu.TemperatureC = temperature
		if temperature != nil {
			gpu.TemperatureSource = "device"
		}
		if load != nil {
			gpu.UtilizationPercent = *load
		}
		var finalUsedMB, finalTotalMB float64
		switch {
		case gpu.Integrated:
			// UMA/iGPU adapters consume system memory. Dedicated memory exposed
			// by LHM on these adapters is a reserved aperture, not independent
			// VRAM, so never use it as an iGPU memory source.
			if sharedMemoryUsed != nil || sharedMemoryTotal != nil {
				if sharedMemoryUsed != nil {
					finalUsedMB = *sharedMemoryUsed
				}
				if sharedMemoryTotal != nil {
					finalTotalMB = *sharedMemoryTotal
				}
				gpu.memoryObserved = true
			} else if genericMemoryUsed != nil || genericMemoryTotal != nil {
				if genericMemoryUsed != nil {
					finalUsedMB = *genericMemoryUsed
				}
				if genericMemoryTotal != nil {
					finalTotalMB = *genericMemoryTotal
				}
				gpu.memoryObserved = true
			}
			gpu.MemoryKind = "shared"
		case dedicatedMemoryUsed != nil || dedicatedMemoryTotal != nil:
			// A discrete adapter's GPU-memory metric represents its local
			// dedicated VRAM. Shared system-memory spillover is intentionally
			// not mixed into this value.
			if dedicatedMemoryUsed != nil {
				finalUsedMB = *dedicatedMemoryUsed
			}
			if dedicatedMemoryTotal != nil {
				finalTotalMB = *dedicatedMemoryTotal
			}
			gpu.MemoryKind = "dedicated"
			gpu.memoryObserved = true
		case sharedMemoryUsed != nil || sharedMemoryTotal != nil:
			// If a platform exposes only shared memory for an otherwise
			// unclassified adapter, preserve the source semantics explicitly.
			if sharedMemoryUsed != nil {
				finalUsedMB = *sharedMemoryUsed
			}
			if sharedMemoryTotal != nil {
				finalTotalMB = *sharedMemoryTotal
			}
			gpu.MemoryKind = "shared"
			gpu.memoryObserved = true
		case genericMemoryUsed != nil || genericMemoryTotal != nil:
			if genericMemoryUsed != nil {
				finalUsedMB = *genericMemoryUsed
			}
			if genericMemoryTotal != nil {
				finalTotalMB = *genericMemoryTotal
			}
			gpu.memoryObserved = true
		}

		if finalUsedMB > 0 {
			gpu.MemoryUsedBytes = uint64(finalUsedMB * 1024 * 1024)
		}
		if finalTotalMB > 0 {
			gpu.MemoryTotalBytes = uint64(finalTotalMB * 1024 * 1024)
		}
		if gpu.MemoryTotalBytes > 0 && gpu.MemoryTotalBytes < gpu.MemoryUsedBytes {
			gpu.MemoryTotalBytes = gpu.MemoryUsedBytes
		}
		metrics.gpus = append(metrics.gpus, gpu)
	}

	metrics.cpuFrequencyMHz = averagePointer(cpuClocks)
	if len(cpuPackageTemperatures) > 0 {
		metrics.cpuTemperatureC = averagePointer(cpuPackageTemperatures)
	} else {
		metrics.cpuTemperatureC = averagePointer(cpuTemperatures)
	}
	sort.Slice(metrics.fans, func(i, j int) bool { return metrics.fans[i].ID < metrics.fans[j].ID })
	return metrics
}

func normalizeDiskHealthStatus(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	if lower == "" {
		return ""
	}
	switch {
	case strings.Contains(lower, "good") || strings.Contains(lower, "ok") || strings.Contains(lower, "正常"):
		return "good"
	case strings.Contains(lower, "caution") || strings.Contains(lower, "warn") || strings.Contains(lower, "注意") || strings.Contains(lower, "警告"):
		return "caution"
	case strings.Contains(lower, "bad") || strings.Contains(lower, "fail") || strings.Contains(lower, "critical") || strings.Contains(lower, "失败"):
		return "bad"
	default:
		return lower
	}
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

func isValidHardwareTemperature(value float64) bool {
	return isFinitePositive(value) && value <= 150
}

func isGPUTemperatureName(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" || strings.Contains(lower, "memory") || strings.Contains(lower, "ambient") {
		return false
	}
	return strings.Contains(lower, "core") || strings.Contains(lower, "gpu") || strings.Contains(lower, "die") || strings.Contains(lower, "junction") || strings.Contains(lower, "hot spot")
}

type windowsHardwareMetadataPayload struct {
	Memory []struct {
		SpeedMHz           float64 `json:"speedMHz"`
		ConfiguredClockMHz float64 `json:"configuredClockMHz"`
		FormFactor         string  `json:"formFactor"`
	} `json:"memory"`
	Adapters []struct {
		Name           string `json:"name"`
		Model          string `json:"model"`
		LinkSpeed      string `json:"linkSpeed"`
		ConnectionType string `json:"connectionType"`
	} `json:"adapters"`
	Disks []struct {
		Name           string `json:"name"`
		InterfaceType  string `json:"interfaceType"`
		Model          string `json:"model"`
		Vendor         string `json:"vendor"`
		PhysicalDevice string `json:"physicalDevice"`
		DiskNumber     int    `json:"diskNumber"`
	} `json:"disks"`
	GPUs []struct {
		Name          string `json:"name"`
		DriverVersion string `json:"driverVersion"`
	} `json:"gpus"`
}

func collectWindowsHardwareMetadata() windowsHardwareMetadata {
	result := windowsHardwareMetadata{
		GpuDrivers:     map[string]string{},
		Networks:       map[string]networkHardwareMetadata{},
		DiskInterfaces: map[string]string{},
		DiskMetadata:   map[string]diskHardwareMetadata{},
	}
	if runtime.GOOS != "windows" {
		return result
	}

	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='Stop'; $memory=@(Get-CimInstance Win32_PhysicalMemory -ErrorAction SilentlyContinue | ForEach-Object { $form=switch([int]$_.FormFactor){8{'DIMM'}12{'SODIMM'}default{[string]$_.FormFactor}}; [pscustomobject]@{speedMHz=[double]$_.Speed; configuredClockMHz=[double]$_.ConfiguredClockSpeed; formFactor=$form} }); $adapters=@(Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{name=[string]$_.Name; linkSpeed=[string]$_.LinkSpeed; connectionType=[string]$_.MediaType} }); $disks=@(Get-Partition -ErrorAction SilentlyContinue | ForEach-Object { $disk=Get-Disk -Number $_.DiskNumber -ErrorAction SilentlyContinue; $key=if ($_.DriveLetter) { [string]$_.DriveLetter + ':' } elseif ($_.AccessPaths) { [string]$_.AccessPaths[0] } else { '' }; if ($key -and $disk) { [pscustomobject]@{name=$key; interfaceType=(([string]$disk.BusType) + ' ' + ([string]$disk.MediaType)).Trim(); model=[string]$disk.FriendlyName; vendor=[string]$disk.Manufacturer; physicalDevice=('\\.\PhysicalDrive' + [string]$disk.Number); diskNumber=[int]$disk.Number} } }); $gpus=@(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{name=[string]$_.Name; driverVersion=[string]$_.DriverVersion} }); [pscustomobject]@{memory=@($memory); adapters=@($adapters); disks=@($disks); gpus=@($gpus)} | ConvertTo-Json -Depth 4 -Compress`
	output, err := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", commandText).Output()
	if err != nil {
		return result
	}

	var payload windowsHardwareMetadataPayload
	if err := json.Unmarshal(output, &payload); err != nil {
		return result
	}
	var speedTotal float64
	var speedCount int
	for _, module := range payload.Memory {
		speed := module.ConfiguredClockMHz
		if speed <= 0 {
			speed = module.SpeedMHz
		}
		if speed > 0 {
			speedTotal += speed
			speedCount++
		}
		if result.MemoryFormFactor == "" && module.FormFactor != "" {
			result.MemoryFormFactor = module.FormFactor
		}
	}
	if speedCount > 0 {
		speed := speedTotal / float64(speedCount)
		result.MemorySpeedMHz = &speed
	}
	if len(payload.Memory) > 0 {
		slots := len(payload.Memory)
		result.MemorySlotCount = &slots
	}
	for _, adapter := range payload.Adapters {
		if adapter.Name == "" {
			continue
		}
		result.Networks[adapter.Name] = networkHardwareMetadata{
			Model:          adapter.Model,
			LinkSpeedMbps:  parseLinkSpeedMbps(adapter.LinkSpeed),
			ConnectionType: adapter.ConnectionType,
		}
	}
	for name, model := range collectWindowsNetworkModels() {
		metadata := result.Networks[name]
		metadata.Model = model
		result.Networks[name] = metadata
	}
	for name, signal := range collectWindowsWifiSignals() {
		metadata := result.Networks[name]
		metadata.SignalStrengthPercent = signal
		result.Networks[name] = metadata
	}
	for _, disk := range payload.Disks {
		if disk.Name != "" && disk.InterfaceType != "" {
			result.DiskInterfaces[disk.Name] = disk.InterfaceType
		}
		if disk.Name != "" {
			result.DiskMetadata[disk.Name] = diskHardwareMetadata{
				Model:          disk.Model,
				Vendor:         disk.Vendor,
				InterfaceType:  disk.InterfaceType,
				PhysicalDevice: disk.PhysicalDevice,
				DiskNumber:     disk.DiskNumber,
			}
		}
	}
	for _, gpu := range payload.GPUs {
		if gpu.Name != "" && gpu.DriverVersion != "" {
			result.GpuDrivers[gpu.Name] = gpu.DriverVersion
		}
	}
	return result
}

func collectWindowsNetworkModels() map[string]string {
	result := map[string]string{}
	if runtime.GOOS != "windows" {
		return result
	}
	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='SilentlyContinue'; $rows=@(Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ name=[string]$_.Name; model=[string]$_.InterfaceDescription } }); @($rows) | ConvertTo-Json -Depth 3 -Compress`
	output, err := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", commandText).Output()
	if err != nil {
		return result
	}
	type networkModelRow struct {
		Name  string `json:"name"`
		Model string `json:"model"`
	}
	trimmed := bytes.TrimSpace(output)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return result
	}
	var rows []networkModelRow
	if err := json.Unmarshal(trimmed, &rows); err != nil {
		var single networkModelRow
		if json.Unmarshal(trimmed, &single) != nil {
			return result
		}
		rows = []networkModelRow{single}
	}
	for _, row := range rows {
		name := strings.TrimSpace(row.Name)
		model := strings.TrimSpace(row.Model)
		if name != "" && model != "" {
			result[name] = model
		}
	}
	return result
}

func collectWindowsWifiSignals() map[string]*float64 {
	result := map[string]*float64{}
	if runtime.GOOS != "windows" {
		return result
	}
	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, "netsh.exe", "wlan", "show", "interfaces").Output()
	if err != nil {
		return result
	}
	currentName := ""
	for _, line := range strings.Split(string(output), "\n") {
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "name") || strings.HasPrefix(trimmed, "名称") {
			if index := strings.IndexAny(trimmed, ":："); index >= 0 {
				currentName = strings.TrimSpace(trimmed[index+1:])
			}
			continue
		}
		if (strings.HasPrefix(lower, "signal") || strings.HasPrefix(trimmed, "信号")) && currentName != "" {
			if index := strings.IndexAny(trimmed, ":："); index >= 0 {
				value := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(trimmed[index+1:]), "%"))
				if parsed, parseErr := strconv.ParseFloat(value, 64); parseErr == nil && parsed >= 0 && parsed <= 100 {
					result[currentName] = &parsed
				}
			}
		}
	}
	return result
}

func collectWindowsDiskSensorMetadata(metadata map[string]diskHardwareMetadata) map[string]diskSensorMetadata {
	result := map[string]diskSensorMetadata{}
	if runtime.GOOS != "windows" || len(metadata) == 0 {
		return result
	}

	physicalDevices := map[string]struct{}{}
	for _, disk := range metadata {
		if disk.PhysicalDevice != "" {
			physicalDevices[disk.PhysicalDevice] = struct{}{}
		}
	}
	if smartctlPath := resolveSmartctlPath(); smartctlPath != "" {
		for devicePath := range physicalDevices {
			if sensor, ok := collectSmartctlDiskSensor(smartctlPath, devicePath); ok {
				result[devicePath] = sensor
			}
		}
	}

	reliability := collectWindowsStorageReliabilityMetadata()
	for _, disk := range metadata {
		if disk.PhysicalDevice == "" {
			continue
		}
		if sensor, ok := reliability[disk.DiskNumber]; ok {
			merged := result[disk.PhysicalDevice]
			mergeDiskSensorMetadata(&merged, sensor)
			result[disk.PhysicalDevice] = merged
		}
	}
	return result
}

func resolveSmartctlPath() string {
	if runtime.GOOS == "windows" {
		for _, command := range []string{"smartctl.exe", "smartctl"} {
			if path, err := exec.LookPath(command); err == nil {
				return path
			}
		}
		return ""
	}
	path, _ := exec.LookPath("smartctl")
	return path
}

func collectSmartctlDiskSensor(smartctlPath, devicePath string) (diskSensorMetadata, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	var output bytes.Buffer
	args := []string{"-a", "-j", "--device=auto"}
	if runtime.GOOS == "linux" {
		args = append(args, "-n", "standby")
	}
	args = append(args, devicePath)
	command := exec.CommandContext(ctx, smartctlPath, args...)
	command.Stdout = &output
	command.Stderr = &bytes.Buffer{}
	_ = command.Run()
	if output.Len() == 0 {
		return diskSensorMetadata{}, false
	}
	metadata, ok := parseSmartctlJSON(output.Bytes())
	if ok && metadata.TemperatureC != nil {
		if len(metadata.TemperatureSensors) == 0 {
			value := *metadata.TemperatureC
			metadata.TemperatureSensors = []temperatureSensorReading{newTemperatureSensorReading(
				"temperature-smartctl-"+sanitizeKey(devicePath),
				"smartctl",
				"smartctl",
				filepath.Base(devicePath),
				"storage",
				devicePath,
				"SMART Temperature",
				&value,
				nil,
				nil,
				nil,
				"storage_composite",
				"SMART disk temperature; alternate source",
			)}
		}
		for index := range metadata.TemperatureSensors {
			sensor := &metadata.TemperatureSensors[index]
			sensor.ID = "temperature-smartctl-" + sanitizeKey(devicePath+"-"+sensor.RawName)
			sensor.Hardware = filepath.Base(devicePath)
			sensor.HardwareType = "storage"
			sensor.InstanceID = devicePath
			sensor.DisplayName = strings.TrimSpace(strings.Trim(strings.Join([]string{sensor.Hardware, sensor.RawName}, " · "), " ·"))
		}
	}
	return metadata, ok
}

func parseSmartctlJSON(raw []byte) (diskSensorMetadata, bool) {
	trimmed := bytes.TrimSpace(raw)
	start := bytes.IndexByte(trimmed, '{')
	end := bytes.LastIndexByte(trimmed, '}')
	if start < 0 || end < start {
		return diskSensorMetadata{}, false
	}
	var root map[string]any
	if err := json.Unmarshal(trimmed[start:end+1], &root); err != nil {
		return diskSensorMetadata{}, false
	}
	metadata := diskSensorMetadata{}
	if passed, ok := jsonBoolAt(root, "smart_status", "passed"); ok {
		if passed {
			metadata.HealthStatus = "good"
			metadata.HealthReason = "SMART status passed"
		} else {
			metadata.HealthStatus = "bad"
			metadata.HealthReason = "SMART status failed"
		}
	}
	for _, candidate := range []struct {
		name string
		path []string
	}{
		{name: "SMART Temperature", path: []string{"temperature", "current"}},
		{name: "NVMe Composite", path: []string{"nvme_smart_health_information_log", "temperature"}},
		{name: "NVMe Temperature Sensor 1", path: []string{"nvme_smart_health_information_log", "temperature_sensor_1"}},
	} {
		value, ok := jsonNumberAt(root, candidate.path...)
		if !ok || value <= 0 || value > 150 {
			continue
		}
		if metadata.TemperatureC == nil {
			valueCopy := value
			metadata.TemperatureC = &valueCopy
		}
		valueCopy := value
		metadata.TemperatureSensors = append(metadata.TemperatureSensors, newTemperatureSensorReading(
			"temperature-smartctl-"+sanitizeKey(strings.Join(candidate.path, "-")),
			"smartctl",
			"smartctl",
			"storage",
			"storage",
			"",
			candidate.name,
			&valueCopy,
			nil,
			nil,
			nil,
			"storage_composite",
			"SMART disk temperature; alternate source",
		))
	}
	if used, ok := jsonNumberAt(root, "nvme_smart_health_information_log", "percentage_used"); ok && used >= 0 && used <= 100 {
		value := 100 - used
		metadata.HealthPercent = &value
	}
	for _, item := range jsonObjectArrayAt(root, "ata_smart_data", "table") {
		id, _ := jsonNumberAt(item, "id")
		name, _ := jsonStringAt(item, "name")
		rawValue, _ := jsonNumberAt(item, "raw", "value")
		threshold, _ := jsonNumberAt(item, "thresh")
		if id > 0 || name != "" {
			metadata.SmartAttributes = append(metadata.SmartAttributes, diskSmartAttribute{
				ID:        int(id),
				Name:      name,
				Value:     rawValue,
				Threshold: threshold,
			})
		}
		lowerName := strings.ToLower(name)
		if metadata.TemperatureC == nil && strings.Contains(lowerName, "temperature") && rawValue > 0 && rawValue <= 150 {
			value := rawValue
			metadata.TemperatureC = &value
		}
		if metadata.HealthPercent == nil && (strings.Contains(lowerName, "percent used") || strings.Contains(lowerName, "percentage used")) && rawValue >= 0 && rawValue <= 100 {
			value := 100 - rawValue
			metadata.HealthPercent = &value
		}
		if metadata.HealthPercent == nil && (strings.Contains(lowerName, "life") || strings.Contains(lowerName, "remaining")) && rawValue >= 0 && rawValue <= 100 {
			value := rawValue
			metadata.HealthPercent = &value
		}
	}
	return metadata, metadata.TemperatureC != nil || metadata.HealthStatus != "" || metadata.HealthPercent != nil || len(metadata.SmartAttributes) > 0
}

func collectWindowsStorageReliabilityMetadata() map[int]diskSensorMetadata {
	result := map[int]diskSensorMetadata{}
	if runtime.GOOS != "windows" {
		return result
	}
	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='SilentlyContinue'; $rows=@(Get-Disk -ErrorAction SilentlyContinue | ForEach-Object { $disk=$_; $counter=Get-StorageReliabilityCounter -PhysicalDisk $disk -ErrorAction SilentlyContinue; if($counter){ [pscustomobject]@{diskNumber=[int]$disk.Number; temperature=[double]$counter.Temperature; wear=[double]$counter.Wear} } }); @($rows) | ConvertTo-Json -Depth 4 -Compress`
	output, err := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", commandText).Output()
	if err != nil || len(bytes.TrimSpace(output)) == 0 {
		return result
	}
	var raw json.RawMessage = bytes.TrimSpace(output)
	records, err := decodeJSONList[windowsStorageReliabilityRecord](raw)
	if err != nil {
		return result
	}
	for _, record := range records {
		metadata := diskSensorMetadata{}
		if record.Temperature > 0 && record.Temperature <= 150 {
			value := record.Temperature
			metadata.TemperatureC = &value
		}
		if record.Wear >= 0 && record.Wear <= 100 {
			value := 100 - record.Wear
			metadata.HealthPercent = &value
		}
		if metadata.TemperatureC != nil || metadata.HealthPercent != nil {
			metadata.HealthReason = "Windows Storage Reliability Counter"
			if metadata.TemperatureC != nil {
				value := *metadata.TemperatureC
				metadata.TemperatureSensors = []temperatureSensorReading{newTemperatureSensorReading(
					fmt.Sprintf("temperature-windows-storage-reliability-%d", record.DiskNumber),
					"windows-storage-reliability",
					"storage-reliability",
					fmt.Sprintf("Disk %d", record.DiskNumber),
					"storage",
					"",
					"StorageReliabilityCounter Temperature",
					&value,
					nil,
					nil,
					nil,
					"storage_composite",
					"Windows Storage Reliability Counter; alternate source",
				)}
			}
			result[record.DiskNumber] = metadata
		}
	}
	return result
}

type windowsStorageReliabilityRecord struct {
	DiskNumber  int     `json:"diskNumber"`
	Temperature float64 `json:"temperature"`
	Wear        float64 `json:"wear"`
}

func collectLinuxDiskSensorMetadata(disks []diskDeviceStats) map[string]diskSensorMetadata {
	result := map[string]diskSensorMetadata{}
	if runtime.GOOS != "linux" {
		return result
	}
	smartctlPath := resolveSmartctlPath()
	if smartctlPath == "" {
		return result
	}
	seen := map[string]struct{}{}
	for _, disk := range disks {
		device := linuxBlockDeviceName(disk.SourceKey)
		if device == "" || !isSmartctlBlockDevice(device) {
			continue
		}
		if _, exists := seen[device]; exists {
			continue
		}
		seen[device] = struct{}{}
		devicePath := "/dev/" + device
		if sensor, ok := collectSmartctlDiskSensor(smartctlPath, devicePath); ok {
			result[sanitizeKey(device)] = sensor
		}
	}
	return result
}

func mergeDiskSensorMetadata(target *diskSensorMetadata, source diskSensorMetadata) {
	if target.TemperatureC == nil {
		target.TemperatureC = source.TemperatureC
	}
	if target.HealthStatus == "" {
		target.HealthStatus = source.HealthStatus
	}
	if target.HealthReason == "" {
		target.HealthReason = source.HealthReason
	}
	if target.HealthPercent == nil {
		target.HealthPercent = source.HealthPercent
	}
	if len(target.SmartAttributes) == 0 {
		target.SmartAttributes = source.SmartAttributes
	}
	if len(source.TemperatureSensors) > 0 {
		target.TemperatureSensors = mergeTemperatureSensors(target.TemperatureSensors, source.TemperatureSensors)
	}
}

func applyDiskSensorMetadata(target *diskDeviceStats, source diskSensorMetadata) {
	if target == nil {
		return
	}
	if target.TemperatureC == nil {
		target.TemperatureC = source.TemperatureC
	}
	if target.HealthStatus == "" {
		target.HealthStatus = source.HealthStatus
	}
	if target.HealthReason == "" {
		target.HealthReason = source.HealthReason
	}
	if target.HealthPercent == nil {
		target.HealthPercent = source.HealthPercent
	}
	if len(target.SmartAttributes) == 0 {
		target.SmartAttributes = source.SmartAttributes
	}
}

func jsonNumberAt(value any, path ...string) (float64, bool) {
	current := value
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return 0, false
		}
		var next any
		found := false
		for actualKey, candidate := range object {
			if strings.EqualFold(actualKey, key) {
				next = candidate
				found = true
				break
			}
		}
		if !found {
			return 0, false
		}
		current = next
	}
	switch number := current.(type) {
	case float64:
		return number, true
	case json.Number:
		parsed, err := number.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func jsonStringAt(value any, path ...string) (string, bool) {
	current := value
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return "", false
		}
		var next any
		found := false
		for actualKey, candidate := range object {
			if strings.EqualFold(actualKey, key) {
				next = candidate
				found = true
				break
			}
		}
		if !found {
			return "", false
		}
		current = next
	}
	stringValue, ok := current.(string)
	return stringValue, ok
}

func jsonBoolAt(value any, path ...string) (bool, bool) {
	current := value
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return false, false
		}
		var next any
		found := false
		for actualKey, candidate := range object {
			if strings.EqualFold(actualKey, key) {
				next = candidate
				found = true
				break
			}
		}
		if !found {
			return false, false
		}
		current = next
	}
	boolean, ok := current.(bool)
	return boolean, ok
}

func jsonObjectArrayAt(value any, path ...string) []map[string]any {
	current := value
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		var next any
		found := false
		for actualKey, candidate := range object {
			if strings.EqualFold(actualKey, key) {
				next = candidate
				found = true
				break
			}
		}
		if !found {
			return nil
		}
		current = next
	}
	array, ok := current.([]any)
	if !ok {
		return nil
	}
	result := make([]map[string]any, 0, len(array))
	for _, item := range array {
		if object, ok := item.(map[string]any); ok {
			result = append(result, object)
		}
	}
	return result
}

func parseLinkSpeedMbps(raw string) *float64 {
	parts := strings.Fields(strings.TrimSpace(raw))
	if len(parts) == 0 {
		return nil
	}
	value, err := strconv.ParseFloat(parts[0], 64)
	if err != nil || value <= 0 {
		return nil
	}
	if len(parts) > 1 && strings.EqualFold(parts[1], "Gbps") {
		value *= 1000
	}
	return &value
}

// NVIDIA's driver reports the actual graphics clock, including boost states, through nvidia-smi.
func collectNvidiaGPUs() []gpuDeviceStats {
	if runtime.GOOS != "windows" && runtime.GOOS != "linux" {
		return []gpuDeviceStats{}
	}

	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	command := "nvidia-smi"
	if runtime.GOOS == "windows" {
		command = "nvidia-smi.exe"
	}
	output, err := exec.CommandContext(
		ctx,
		command,
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
		frequency, ok := parseNonNegativeFloat(parts[2])
		if !ok {
			continue
		}
		gpu := gpuDeviceStats{
			ID:           fmt.Sprintf("gpu-%s-%d", sanitizeKey(name), index),
			Name:         name,
			FrequencyMHz: &frequency,
			MemoryKind:   "dedicated",
		}
		if value, ok := parseNonNegativeFloat(parts[1]); ok {
			gpu.UtilizationPercent = value
		}
		if value, ok := parseNonNegativeFloat(parts[3]); ok {
			gpu.TemperatureC = &value
		}
		if value, ok := parseNonNegativeFloat(parts[4]); ok {
			gpu.MemoryUsedBytes = uint64(value * 1024 * 1024)
			gpu.memoryObserved = true
		}
		if value, ok := parseNonNegativeFloat(parts[5]); ok {
			gpu.MemoryTotalBytes = uint64(value * 1024 * 1024)
			gpu.memoryObserved = true
		}
		result = append(result, gpu)
	}
	return result
}

type windowsGPUAdapterRecord struct {
	Name          string `json:"name"`
	PNPDeviceID   string `json:"pnpDeviceId"`
	DriverVersion string `json:"driverVersion"`
	AdapterRAM    uint64 `json:"adapterRAM"`
}

type windowsGPUAdapterMemoryRecord struct {
	Name           string `json:"name"`
	DedicatedUsage uint64 `json:"dedicatedUsage"`
	SharedUsage    uint64 `json:"sharedUsage"`
	TotalCommitted uint64 `json:"totalCommitted"`
}

type windowsGPUEngineRecord struct {
	Name               string  `json:"name"`
	UtilizationPercent float64 `json:"utilizationPercent"`
}

type windowsGPUPerformancePayload struct {
	Adapters json.RawMessage `json:"adapters"`
	Memory   json.RawMessage `json:"memory"`
	Engines  json.RawMessage `json:"engines"`
}

type windowsGPUPerformanceAggregate struct {
	Key            string
	Utilization    float64
	Encode         float64
	Decode         float64
	MemoryUsed     uint64
	DedicatedUsed  uint64
	SharedUsed     uint64
	MemoryObserved bool
	MemoryTotal    uint64
	TotalCommitted uint64
}

// Windows exposes GPU utilization and adapter memory through the standard
// GPUPerformanceCounters provider even when LibreHardwareMonitor or
// nvidia-smi is unavailable. The counter names contain a LUID, so the
// fallback keeps that identifier unless it can safely associate it with a
// non-virtual Win32_VideoController adapter.
func collectWindowsGPUPerformance() []gpuDeviceStats {
	if runtime.GOOS != "windows" {
		return []gpuDeviceStats{}
	}

	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='Stop'; $adapters=@(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{name=[string]$_.Name; pnpDeviceId=[string]$_.PNPDeviceID; driverVersion=[string]$_.DriverVersion; adapterRAM=[UInt64]([Math]::Max(0,[Int64]$_.AdapterRAM))} }); $memory=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{name=[string]$_.Name; dedicatedUsage=[UInt64]$_.DedicatedUsage; sharedUsage=[UInt64]$_.SharedUsage; totalCommitted=[UInt64]$_.TotalCommitted} }); $engines=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{name=[string]$_.Name; utilizationPercent=[double]$_.UtilizationPercentage} }); ConvertTo-Json -InputObject ([pscustomobject]@{adapters=[array]$adapters; memory=[array]$memory; engines=[array]$engines}) -Depth 5 -Compress`
	output, err := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", commandText).Output()
	if err != nil {
		return []gpuDeviceStats{}
	}
	var payload windowsGPUPerformancePayload
	if err := json.Unmarshal(bytes.TrimSpace(output), &payload); err != nil {
		return []gpuDeviceStats{}
	}
	adapters, err := decodeJSONList[windowsGPUAdapterRecord](payload.Adapters)
	if err != nil {
		return []gpuDeviceStats{}
	}
	memory, err := decodeJSONList[windowsGPUAdapterMemoryRecord](payload.Memory)
	if err != nil {
		return []gpuDeviceStats{}
	}
	engines, err := decodeJSONList[windowsGPUEngineRecord](payload.Engines)
	if err != nil {
		return []gpuDeviceStats{}
	}

	aggregates := map[string]*windowsGPUPerformanceAggregate{}
	for _, item := range memory {
		key := gpuCounterLUID(item.Name)
		if key == "" {
			continue
		}
		if item.DedicatedUsage == 0 && item.SharedUsage <= 65536 {
			continue
		}
		aggregate := getGPUPerformanceAggregate(aggregates, key)
		aggregate.MemoryUsed += item.DedicatedUsage + item.SharedUsage
		aggregate.DedicatedUsed += item.DedicatedUsage
		aggregate.SharedUsed += item.SharedUsage
		aggregate.MemoryObserved = true
		aggregate.TotalCommitted = maxUint64(aggregate.TotalCommitted, item.TotalCommitted)
	}
	for _, item := range engines {
		key := gpuCounterLUID(item.Name)
		if key == "" || !isFiniteNonNegative(item.UtilizationPercent) {
			continue
		}
		aggregate := getGPUPerformanceAggregate(aggregates, key)
		engineType := strings.ToLower(item.Name)
		value := math.Min(100, math.Max(0, item.UtilizationPercent))
		switch {
		case strings.Contains(engineType, "videoencode") || strings.Contains(engineType, "encode"):
			aggregate.Encode = math.Max(aggregate.Encode, value)
		case strings.Contains(engineType, "videodecode") || strings.Contains(engineType, "decode"):
			aggregate.Decode = math.Max(aggregate.Decode, value)
		default:
			aggregate.Utilization = math.Max(aggregate.Utilization, value)
		}
	}

	physicalAdapters := make([]windowsGPUAdapterRecord, 0, len(adapters))
	for _, adapter := range adapters {
		if strings.TrimSpace(adapter.Name) != "" && !isVirtualGPUAdapter(adapter.Name, adapter.PNPDeviceID) {
			physicalAdapters = append(physicalAdapters, adapter)
		}
	}
	if len(physicalAdapters) == 0 {
		for _, adapter := range adapters {
			if strings.TrimSpace(adapter.Name) != "" {
				physicalAdapters = append(physicalAdapters, adapter)
			}
		}
	}
	keys := make([]string, 0, len(aggregates))
	for key := range aggregates {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		left := aggregates[keys[i]]
		right := aggregates[keys[j]]
		leftScore := left.Utilization + float64(left.MemoryUsed)/float64(maxUint64(1, left.TotalCommitted))
		rightScore := right.Utilization + float64(right.MemoryUsed)/float64(maxUint64(1, right.TotalCommitted))
		if leftScore == rightScore {
			return keys[i] < keys[j]
		}
		return leftScore > rightScore
	})
	if len(physicalAdapters) > 0 && len(keys) > len(physicalAdapters) {
		// Virtual display adapters can create their own LUID with only a few
		// bytes of shared memory. Do not expose those as extra physical GPUs
		// when WMI has already identified the real adapter count.
		keys = keys[:len(physicalAdapters)]
	}

	result := make([]gpuDeviceStats, 0, len(keys))
	for index, key := range keys {
		aggregate := aggregates[key]
		name := "Windows GPU " + key
		driver := ""
		if index < len(physicalAdapters) {
			name = physicalAdapters[index].Name
			driver = physicalAdapters[index].DriverVersion
		}
		gpu := gpuDeviceStats{
			ID:                 "gpu-windows-" + sanitizeKey(key),
			Name:               name,
			UtilizationPercent: round(aggregate.Utilization),
			DriverVersion:      driver,
		}
		if index < len(physicalAdapters) {
			keySource := strings.TrimSpace(physicalAdapters[index].PNPDeviceID)
			if keySource == "" {
				keySource = physicalAdapters[index].Name
			}
			gpu.ID = "gpu-" + sanitizeKey(keySource)
			gpu.Integrated = isIntegratedGPUName(name)
			if gpu.Integrated {
				gpu.MemoryKind = "shared"
				gpu.MemoryUsedBytes = aggregate.SharedUsed
			} else {
				gpu.MemoryKind = "dedicated"
				gpu.MemoryUsedBytes = aggregate.DedicatedUsed
			}
			gpu.memoryObserved = aggregate.MemoryObserved
		} else {
			gpu.MemoryUsedBytes = aggregate.MemoryUsed
			gpu.MemoryKind = "unknown"
			gpu.memoryObserved = aggregate.MemoryObserved
		}
		if aggregate.Encode > 0 {
			value := round(aggregate.Encode)
			gpu.EncodeUtilizationPercent = &value
		}
		if aggregate.Decode > 0 {
			value := round(aggregate.Decode)
			gpu.DecodeUtilizationPercent = &value
		}
		if index < len(physicalAdapters) && !gpu.Integrated && physicalAdapters[index].AdapterRAM > 0 {
			// AdapterRAM is useful as a dedicated VRAM capacity for a
			// discrete adapter. TotalCommitted is a current committed usage
			// value, not a capacity, and must not become the denominator.
			gpu.MemoryTotalBytes = physicalAdapters[index].AdapterRAM
		}
		result = append(result, gpu)
	}
	return result
}

// Keep a physical adapter visible even when Windows exposes no GPU performance
// counter samples for the current session. This still provides the stable
// model, driver, and adapter-memory metadata needed by the device dashboard.
func collectWindowsGPUAdapters() []gpuDeviceStats {
	if runtime.GOOS != "windows" {
		return []gpuDeviceStats{}
	}

	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { $ram=[UInt64]([Math]::Max(0,[Int64]$_.AdapterRAM)); [pscustomobject]@{name=[string]$_.Name; pnpDeviceId=[string]$_.PNPDeviceID; driverVersion=[string]$_.DriverVersion; adapterRAM=$ram} }); @($rows) | ConvertTo-Json -Depth 4 -Compress`
	output, err := runWindowsPowerShell(ctx, commandText)
	if err != nil {
		return []gpuDeviceStats{}
	}
	records, err := decodeJSONList[windowsGPUAdapterRecord](bytes.TrimSpace(output))
	if err != nil {
		return []gpuDeviceStats{}
	}
	filteredRecords := make([]windowsGPUAdapterRecord, 0, len(records))
	for _, record := range records {
		if !isVirtualGPUAdapter(record.Name, record.PNPDeviceID) {
			filteredRecords = append(filteredRecords, record)
		}
	}
	if len(filteredRecords) > 0 {
		records = filteredRecords
	}
	result := make([]gpuDeviceStats, 0, len(records))
	seen := map[string]struct{}{}
	for index, record := range records {
		name := strings.TrimSpace(record.Name)
		if name == "" {
			name = fmt.Sprintf("GPU %d", index+1)
		}
		keySource := strings.TrimSpace(record.PNPDeviceID)
		if keySource == "" {
			keySource = name
		}
		id := "gpu-" + sanitizeKey(keySource)
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, gpuDeviceStats{
			ID:                 id,
			Name:               name,
			Integrated:         isIntegratedGPUName(name),
			MemoryKind:         gpuMemoryKindForAdapter(name, record.AdapterRAM),
			MemoryTotalBytes:   gpuMemoryTotalForAdapter(name, record.AdapterRAM),
			DriverVersion:      strings.TrimSpace(record.DriverVersion),
			UtilizationPercent: 0,
		})
	}
	return result
}

func decodeJSONList[T any](raw json.RawMessage) ([]T, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []T{}, nil
	}
	var list []T
	if trimmed[0] == '[' {
		if err := json.Unmarshal(trimmed, &list); err != nil {
			return nil, err
		}
		return list, nil
	}
	var single T
	if err := json.Unmarshal(trimmed, &single); err != nil {
		return nil, err
	}
	return []T{single}, nil
}

func gpuCounterLUID(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	start := strings.Index(lower, "luid_")
	if start < 0 {
		return ""
	}
	end := strings.Index(lower[start:], "_phys_")
	if end < 0 {
		return lower[start:]
	}
	return lower[start : start+end]
}

func getGPUPerformanceAggregate(aggregates map[string]*windowsGPUPerformanceAggregate, key string) *windowsGPUPerformanceAggregate {
	if value, ok := aggregates[key]; ok {
		return value
	}
	value := &windowsGPUPerformanceAggregate{Key: key}
	aggregates[key] = value
	return value
}

func maxUint64(left, right uint64) uint64 {
	if left > right {
		return left
	}
	return right
}

func isFiniteNonNegative(value float64) bool {
	return value >= 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func parsePositiveFloat(raw string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || !isFinitePositive(value) {
		return 0, false
	}
	return value, true
}

func parseNonNegativeFloat(raw string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || !isFiniteNonNegative(value) {
		return 0, false
	}
	return value, true
}

func collectDiskHardwareMetadata(deviceName string) diskHardwareMetadata {
	if runtime.GOOS != "linux" {
		return diskHardwareMetadata{}
	}

	blockName := linuxBlockDeviceName(deviceName)
	if blockName == "" {
		return diskHardwareMetadata{}
	}
	basePath := filepath.Join("/sys/class/block", blockName)
	model := readTrimmedFile(filepath.Join(basePath, "device", "model"))
	vendor := readTrimmedFile(filepath.Join(basePath, "device", "vendor"))
	interfaceType := linuxDiskInterfaceType(basePath, model)
	return diskHardwareMetadata{
		Model:         model,
		Vendor:        vendor,
		InterfaceType: interfaceType,
	}
}

// smartctl is an optional Linux fallback for disks that do not expose a
// temperature through hwmon. The command is intentionally limited to the
// physical block devices referenced by mounted partitions and uses standby
// mode so a passive monitoring cycle does not wake a sleeping disk.
func collectLinuxDiskTemperatures(partitions []disk.PartitionStat) map[string]*float64 {
	result := map[string]*float64{}
	if runtime.GOOS != "linux" {
		return result
	}
	smartctlPath, err := exec.LookPath("smartctl")
	if err != nil {
		return result
	}

	devices := []string{}
	seen := map[string]struct{}{}
	for _, partition := range partitions {
		device := linuxBlockDeviceName(partition.Device)
		if device == "" || !isSmartctlBlockDevice(device) {
			continue
		}
		if _, exists := seen[device]; exists {
			continue
		}
		seen[device] = struct{}{}
		devices = append(devices, device)
	}
	if len(devices) == 0 {
		return result
	}

	deadline := time.Now().Add(hardwareSensorsTimeout)
	for _, device := range devices {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			break
		}
		if remaining > 3*time.Second {
			remaining = 3 * time.Second
		}
		ctx, cancel := context.WithTimeout(context.Background(), remaining)
		output, commandErr := exec.CommandContext(ctx, smartctlPath, "-A", "-n", "standby", "/dev/"+device).CombinedOutput()
		cancel()
		if commandErr != nil && len(output) == 0 {
			continue
		}
		if temperature := parseSmartctlTemperature(output); temperature != nil {
			result[device] = temperature
		}
	}
	return result
}

func isSmartctlBlockDevice(device string) bool {
	lower := strings.ToLower(device)
	for _, prefix := range []string{"sd", "hd", "vd", "xvd", "nvme", "mmcblk"} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

func parseSmartctlTemperature(output []byte) *float64 {
	for _, rawLine := range strings.Split(string(output), "\n") {
		line := strings.TrimSpace(rawLine)
		lower := strings.ToLower(line)
		if !strings.Contains(lower, "temperature") {
			continue
		}

		valueFields := line
		if colon := strings.IndexAny(line, ":："); colon >= 0 {
			valueFields = line[colon+1:]
		}
		fields := strings.Fields(valueFields)
		values := []float64{}
		for _, field := range fields {
			clean := strings.Trim(field, "()[],;")
			if strings.Contains(clean, "/") {
				continue
			}
			value, err := strconv.ParseFloat(clean, 64)
			if err == nil && value > 0 && value <= 150 {
				values = append(values, value)
			}
		}
		if len(values) == 0 {
			continue
		}
		if strings.Contains(line, ":") || strings.Contains(line, "：") {
			value := values[0]
			return &value
		}
		value := values[len(values)-1]
		return &value
	}
	return nil
}

func linuxBlockDeviceName(deviceName string) string {
	name := strings.TrimSpace(deviceName)
	if name == "" {
		return ""
	}
	name = filepath.Base(strings.TrimPrefix(name, "/dev/"))
	for _, prefix := range []string{"nvme", "mmcblk"} {
		if strings.HasPrefix(name, prefix) {
			if partitionIndex := strings.LastIndex(name, "p"); partitionIndex > len(prefix) && allDigits(name[partitionIndex+1:]) {
				return name[:partitionIndex]
			}
			return name
		}
	}
	for _, prefix := range []string{"sd", "hd", "vd", "xvd"} {
		if strings.HasPrefix(name, prefix) {
			return trimTrailingDigits(name)
		}
	}
	return name
}

func linuxDiskInterfaceType(basePath, model string) string {
	if strings.Contains(strings.ToLower(model), "virtual") {
		return "Virtual"
	}
	subsystem, err := filepath.EvalSymlinks(filepath.Join(basePath, "device", "subsystem"))
	if err != nil {
		subsystem, _ = filepath.EvalSymlinks(filepath.Join(basePath, "device"))
	}
	lower := strings.ToLower(subsystem)
	switch {
	case strings.Contains(lower, "nvme"):
		return "NVMe"
	case strings.Contains(lower, "ata"):
		return "SATA"
	case strings.Contains(lower, "virtio"):
		return "VirtIO"
	case strings.Contains(lower, "usb"):
		return "USB"
	case strings.Contains(lower, "scsi"):
		return "SCSI"
	case strings.Contains(lower, "mmc"):
		return "MMC"
	}
	return ""
}

func readTrimmedFile(path string) string {
	value, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(value))
}

func allDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func trimTrailingDigits(value string) string {
	index := len(value)
	for index > 0 && value[index-1] >= '0' && value[index-1] <= '9' {
		index--
	}
	if index == 0 {
		return value
	}
	return value[:index]
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
	partitions, err := collectDiskPartitions()
	if err != nil {
		return nil, storageUsage{}, err
	}

	disks := make([]diskDeviceStats, 0, len(partitions))
	seen := map[string]struct{}{}
	diskTemperatures := collectLinuxDiskTemperatures(partitions)
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
		metadata := collectDiskHardwareMetadata(deviceName)
		if metadata.TemperatureC == nil {
			metadata.TemperatureC = diskTemperatures[linuxBlockDeviceName(deviceName)]
		}
		disks = append(disks, diskDeviceStats{
			ID:             fmt.Sprintf("%s:%s", deviceName, mountPoint),
			Name:           deviceName,
			MountPoint:     mountPoint,
			FileSystem:     partition.Fstype,
			Model:          metadata.Model,
			Vendor:         metadata.Vendor,
			SourceKey:      deviceName,
			PhysicalDevice: linuxBlockDeviceName(deviceName),
			TemperatureC:   metadata.TemperatureC,
			InterfaceType:  metadata.InterfaceType,
			TotalBytes:     usage.Total,
			UsedBytes:      usage.Used,
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

type windowsDiskPartitionRow struct {
	Device     string `json:"device"`
	MountPoint string `json:"mountPoint"`
	FileSystem string `json:"filesystem"`
}

func collectDiskPartitions() ([]disk.PartitionStat, error) {
	partitions, firstErr := disk.Partitions(false)
	if firstErr == nil && hasUsableDiskPartitions(partitions) {
		return partitions, nil
	}

	if fallback, fallbackErr := disk.Partitions(true); fallbackErr == nil && hasUsableDiskPartitions(fallback) {
		return fallback, nil
	}

	if runtime.GOOS != "windows" {
		if firstErr != nil {
			return nil, firstErr
		}
		return partitions, nil
	}

	rows, powershellErr := collectWindowsDiskPartitionRows()
	if powershellErr == nil && len(rows) > 0 {
		result := make([]disk.PartitionStat, 0, len(rows))
		for _, row := range rows {
			device := strings.TrimSpace(row.Device)
			mountPoint := strings.TrimSpace(row.MountPoint)
			if device == "" || mountPoint == "" {
				continue
			}
			result = append(result, disk.PartitionStat{
				Device:     device,
				Mountpoint: mountPoint,
				Fstype:     strings.TrimSpace(row.FileSystem),
			})
		}
		if len(result) > 0 {
			return result, nil
		}
	}

	if firstErr != nil {
		return nil, firstErr
	}
	if powershellErr != nil {
		return nil, powershellErr
	}
	return partitions, nil
}

func hasUsableDiskPartitions(partitions []disk.PartitionStat) bool {
	for _, partition := range partitions {
		if strings.TrimSpace(partition.Mountpoint) != "" {
			return true
		}
	}
	return false
}

func collectWindowsDiskPartitionRows() ([]windowsDiskPartitionRow, error) {
	if runtime.GOOS != "windows" {
		return []windowsDiskPartitionRow{}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), hardwareSensorsTimeout)
	defer cancel()
	commandText := `$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { $device=[string]$_.DeviceID; [pscustomobject]@{ device=$device; mountPoint=($device + '\'); filesystem=[string]$_.FileSystem } }); @($rows) | ConvertTo-Json -Depth 3 -Compress`
	output, err := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", commandText).Output()
	if err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(output)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []windowsDiskPartitionRow{}, nil
	}
	var rows []windowsDiskPartitionRow
	if err := json.Unmarshal(trimmed, &rows); err == nil {
		return rows, nil
	}
	var single windowsDiskPartitionRow
	if err := json.Unmarshal(trimmed, &single); err != nil {
		return nil, err
	}
	return []windowsDiskPartitionRow{single}, nil
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
		counter := counters[iface.Name]
		if len(ipv4) == 0 && len(ipv6) == 0 && counter.BytesRecv == 0 && counter.BytesSent == 0 && !hasInterfaceFlag(iface.Flags, "up") {
			continue
		}

		metadata := collectNetworkHardwareMetadata(iface.Name)
		results = append(results, networkInterfaceStats{
			ID:                    fmt.Sprintf("nic-%s", sanitizeKey(iface.Name)),
			Name:                  iface.Name,
			MacAddress:            iface.HardwareAddr,
			IPv4:                  ipv4,
			IPv6:                  ipv6,
			TotalRxBytes:          counter.BytesRecv,
			TotalTxBytes:          counter.BytesSent,
			LinkSpeedMbps:         metadata.LinkSpeedMbps,
			ConnectionType:        metadata.ConnectionType,
			SignalStrengthPercent: metadata.SignalStrengthPercent,
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results, nil
}

func hasInterfaceFlag(flags []string, expected string) bool {
	for _, flag := range flags {
		if strings.EqualFold(flag, expected) {
			return true
		}
	}
	return false
}

func collectNetworkHardwareMetadata(name string) networkHardwareMetadata {
	if runtime.GOOS != "linux" {
		return networkHardwareMetadata{}
	}

	metadata := networkHardwareMetadata{
		ConnectionType: linuxNetworkConnectionType(name),
	}
	if rawSpeed := readTrimmedFile(filepath.Join("/sys/class/net", name, "speed")); rawSpeed != "" {
		if speed, err := strconv.ParseFloat(rawSpeed, 64); err == nil && speed > 0 {
			metadata.LinkSpeedMbps = &speed
		}
	}
	metadata.SignalStrengthPercent = readLinuxWifiSignal(name)
	return metadata
}

func linuxNetworkConnectionType(name string) string {
	if name == "lo" {
		return "Loopback"
	}
	basePath := filepath.Join("/sys/class/net", name)
	if _, err := os.Stat(filepath.Join(basePath, "wireless")); err == nil {
		return "Wi-Fi"
	}
	link, _ := filepath.EvalSymlinks(basePath)
	lower := strings.ToLower(link)
	switch {
	case strings.Contains(lower, "/bridge/") || strings.HasPrefix(strings.ToLower(name), "br-") || name == "docker0":
		return "Bridge"
	case strings.HasPrefix(strings.ToLower(name), "veth"):
		return "Virtual"
	case strings.Contains(lower, "/virtual/"):
		return "Virtual"
	}
	if rawType := readTrimmedFile(filepath.Join(basePath, "type")); rawType == "1" {
		return "Ethernet"
	}
	return ""
}

func readLinuxWifiSignal(name string) *float64 {
	if runtime.GOOS != "linux" {
		return nil
	}
	contents, err := os.ReadFile("/proc/net/wireless")
	if err != nil {
		return nil
	}
	for _, line := range strings.Split(string(contents), "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 || strings.TrimSpace(parts[0]) != name {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) == 0 {
			return nil
		}
		quality, err := strconv.ParseFloat(strings.TrimSuffix(fields[0], "."), 64)
		if err != nil || quality < 0 {
			return nil
		}
		if quality <= 70 {
			quality = quality / 70 * 100
		}
		quality = math.Min(100, math.Max(0, quality))
		return &quality
	}
	return nil
}

func snapshotIO(diskCounters map[string]disk.IOCountersStat, netCounters []gnet.IOCountersStat, now time.Time) *ioSnapshot {
	var readBytes uint64
	var writeBytes uint64
	diskByKey := map[string]rateSnapshot{}
	for key, counter := range diskCounters {
		readBytes += counter.ReadBytes
		writeBytes += counter.WriteBytes
		diskByKey[key] = rateSnapshot{
			read:       counter.ReadBytes,
			write:      counter.WriteBytes,
			readTime:   counter.ReadTime,
			writeTime:  counter.WriteTime,
			ioTime:     counter.IoTime,
			readCount:  counter.ReadCount,
			writeCount: counter.WriteCount,
		}
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

func lookupDiskRate(instances map[string]rateStats, names ...string) (rateStats, bool) {
	if len(instances) == 0 {
		return rateStats{}, false
	}
	seen := map[string]struct{}{}
	for _, name := range names {
		for _, candidate := range diskRateCandidates(name) {
			if candidate == "" {
				continue
			}
			if _, exists := seen[candidate]; exists {
				continue
			}
			seen[candidate] = struct{}{}
			if value, ok := instances[candidate]; ok {
				return value, true
			}
		}
	}
	return rateStats{}, false
}

func lookupDiskSensorMetadata(instances map[string]diskSensorMetadata, names ...string) (diskSensorMetadata, bool) {
	if len(instances) == 0 {
		return diskSensorMetadata{}, false
	}
	candidates := []string{}
	for _, name := range names {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			continue
		}
		candidates = append(candidates, sanitizeKey(trimmed))
		if strings.HasPrefix(trimmed, "/dev/") {
			candidates = append(candidates, sanitizeKey(strings.TrimPrefix(trimmed, "/dev/")))
			candidates = append(candidates, sanitizeKey(linuxBlockDeviceName(trimmed)))
		}
	}
	candidates = uniqueStrings(candidates)
	for _, candidate := range candidates {
		if value, ok := instances[candidate]; ok {
			return value, true
		}
	}
	// LHM uses the physical product name while Windows can expose a longer
	// FriendlyName. A one-way containment match handles that safely when only
	// one storage sensor matches the disk identity.
	for key, value := range instances {
		for _, candidate := range candidates {
			if candidate != "" && (strings.Contains(key, candidate) || strings.Contains(candidate, key)) {
				return value, true
			}
		}
	}
	return diskSensorMetadata{}, false
}

func diskRateCandidates(name string) []string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil
	}
	base := filepath.Base(strings.TrimSuffix(trimmed, string(filepath.Separator)))
	candidates := []string{trimmed, base}
	if strings.HasPrefix(trimmed, "/dev/") {
		candidates = append(candidates, strings.TrimPrefix(trimmed, "/dev/"))
	}
	if runtime.GOOS == "linux" {
		candidates = append(candidates, linuxBlockDeviceName(trimmed))
	}
	if strings.HasSuffix(trimmed, ":") {
		candidates = append(candidates, strings.TrimSuffix(trimmed, ":"))
	}
	return uniqueStrings(candidates)
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
		readDelta := max64(0, int64(currentDisk.read)-int64(prevDisk.read))
		writeDelta := max64(0, int64(currentDisk.write)-int64(prevDisk.write))
		ioTimeDelta := max64(0, int64(currentDisk.ioTime)-int64(prevDisk.ioTime))
		operationDelta := max64(0, int64(currentDisk.readCount)-int64(prevDisk.readCount)) + max64(0, int64(currentDisk.writeCount)-int64(prevDisk.writeCount))
		activePercent := float64(ioTimeDelta) / (seconds * 10)
		if activePercent > 100 {
			activePercent = 100
		}
		averageResponseMs := 0.0
		if operationDelta > 0 {
			serviceTimeMs := max64(0, int64(currentDisk.readTime)-int64(prevDisk.readTime)) + max64(0, int64(currentDisk.writeTime)-int64(prevDisk.writeTime))
			averageResponseMs = float64(serviceTimeMs) / float64(operationDelta)
		}
		diskInstances[key] = rateStats{
			ReadBytesPerSec:   round(float64(readDelta) / seconds),
			WriteBytesPerSec:  round(float64(writeDelta) / seconds),
			ActivePercent:     round(activePercent),
			AverageResponseMs: round(averageResponseMs),
		}
	}

	networkInstances := map[string]networkTrafficStats{}
	for key, currentNetwork := range current.netByKey {
		previousNetwork, ok := previous.netByKey[key]
		if !ok {
			continue
		}
		networkInstances[key] = networkTrafficStats{
			RxBytesPerSec: round(float64(max64(0, int64(currentNetwork.rx)-int64(previousNetwork.rx))) / seconds),
			TxBytesPerSec: round(float64(max64(0, int64(currentNetwork.tx)-int64(previousNetwork.tx))) / seconds),
			TotalRxBytes:  currentNetwork.rx,
			TotalTxBytes:  currentNetwork.tx,
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
			Instances:     networkInstances,
		}
}

func applyRuntimeConfig(payload *metricsPayload, cfg agentRuntimeConfig) {
	enabledMetricSet := makeEnabledMetricSet(cfg.EnabledMetrics)
	enabledBlocks := makeEnabledBlockSet(cfg.ProbeSelections)
	if !enabledMetricSet["temperatureSources"] {
		payload.TemperatureSensors = []temperatureSensorReading{}
	}

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
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "cpuTopology") {
				payload.CPUPackages[index].CoreCount = 0
				payload.CPUPackages[index].LogicalCount = 0
				payload.CPUPackages[index].L3CacheBytes = 0
			}
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
	if !enabledMetricSet["systemOverview"] {
		payload.System = systemStats{}
	}

	if !enabledBlocks["memory"] {
		payload.Memory = memoryStats{}
	} else if !enabledMetricSet["memoryUsage"] && !enabledMetricSet["swapUsage"] &&
		!enabledMetricSet["memoryAvailable"] && !enabledMetricSet["memoryCached"] &&
		!enabledMetricSet["memoryCommitted"] && !enabledMetricSet["memoryHardware"] {
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
		if !enabledMetricSet["memoryAvailable"] {
			payload.Memory.AvailableBytes = 0
		}
		if !enabledMetricSet["memoryCached"] {
			payload.Memory.CachedBytes = 0
		}
		if !enabledMetricSet["memoryCommitted"] {
			payload.Memory.CommittedBytes = 0
			payload.Memory.CommitLimitBytes = 0
		}
		if !enabledMetricSet["memoryHardware"] {
			payload.Memory.SpeedMHz = nil
			payload.Memory.SlotCount = nil
			payload.Memory.FormFactor = ""
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
		diskActivityEnabled := false
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

			rate, _ := lookupDiskRate(
				payload.DiskRate.Instances,
				payload.Disks[index].ID,
				payload.Disks[index].SourceKey,
				payload.Disks[index].Name,
				payload.Disks[index].MountPoint,
			)

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
			if metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "diskActivity") {
				diskActivityEnabled = true
			} else {
				rate.ActivePercent = 0
				rate.AverageResponseMs = 0
			}
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "diskMetadata") {
				payload.Disks[index].MountPoint = ""
				payload.Disks[index].FileSystem = ""
				payload.Disks[index].Model = ""
				payload.Disks[index].Vendor = ""
				payload.Disks[index].SourceKey = ""
				payload.Disks[index].InterfaceType = ""
			}
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "diskHealth") {
				payload.Disks[index].TemperatureC = nil
				payload.Disks[index].HealthStatus = ""
				payload.Disks[index].HealthReason = ""
				payload.Disks[index].HealthPercent = nil
				payload.Disks[index].SmartAttributes = nil
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
		if !enabledMetricSet["diskRead"] && !enabledMetricSet["diskWrite"] && !enabledMetricSet["diskActivity"] {
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
			if !enabledMetricSet["diskActivity"] {
				payload.DiskRate.ActivePercent = 0
				payload.DiskRate.AverageResponseMs = 0
				for key, rate := range payload.DiskRate.Instances {
					rate.ActivePercent = 0
					rate.AverageResponseMs = 0
					payload.DiskRate.Instances[key] = rate
				}
			} else if !diskActivityEnabled {
				payload.DiskRate.ActivePercent = 0
				payload.DiskRate.AverageResponseMs = 0
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
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "networkIdentity") {
				payload.NetworkIfaces[index].MacAddress = ""
				payload.NetworkIfaces[index].IPv4 = nil
				payload.NetworkIfaces[index].IPv6 = nil
				payload.NetworkIfaces[index].LinkSpeedMbps = nil
				payload.NetworkIfaces[index].ConnectionType = ""
				payload.NetworkIfaces[index].SignalStrengthPercent = nil
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
			if !metricEnabled(enabledMetricSet, instanceEnabled, hasOverride, "gpuDriverInfo") {
				payload.GPUs[index].DriverVersion = ""
			}
		}
	}

	if !enabledBlocks["fan"] {
		payload.Fans = []fanSensorStats{}
	} else {
		payload.Fans = filterFans(payload.Fans, cfg)
		for index := range payload.Fans {
			if !enabledMetricSet["fanRpm"] {
				payload.Fans[index].RPM = 0
			}
			if !enabledMetricSet["fanControl"] {
				payload.Fans[index].ControlMode = ""
			}
			if !enabledMetricSet["fanTargetTemperature"] {
				payload.Fans[index].TargetTemperatureC = nil
			}
			if !enabledMetricSet["fanPwm"] {
				payload.Fans[index].MinPWMPercent = nil
				payload.Fans[index].MaxPWMPercent = nil
			}
			if !enabledMetricSet["fanChannelState"] {
				payload.Fans[index].ChannelState = ""
			}
			if !enabledMetricSet["fanNote"] {
				payload.Fans[index].Note = ""
			}
		}
	}
}

func filterCPUPackages(items []cpuPackageStats, cfg agentRuntimeConfig) []cpuPackageStats {
	allowed, configured := cfg.EnabledDeviceIDs["cpu"]
	if !configured {
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
	allowed, configured := cfg.EnabledDeviceIDs["disk"]
	if !configured {
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
	allowed, configured := cfg.EnabledDeviceIDs["network"]
	if !configured {
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
	allowed, configured := cfg.EnabledDeviceIDs["gpu"]
	if !configured {
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

func filterFans(items []fanSensorStats, cfg agentRuntimeConfig) []fanSensorStats {
	allowed, configured := cfg.EnabledDeviceIDs["fan"]
	if !configured {
		return items
	}
	allowedSet := makeStringSet(allowed)
	filtered := make([]fanSensorStats, 0, len(items))
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
	result := map[string]bool{}
	for _, key := range metrics {
		trimmed := strings.TrimSpace(key)
		if isKnownMetricKey(trimmed) {
			result[trimmed] = true
		}
	}
	return result
}

func normalizeMetricKeys(metrics []string) []string {
	result := make([]string, 0, len(metrics))
	seen := map[string]bool{}
	for _, metric := range metrics {
		key := strings.TrimSpace(metric)
		if key == "" || !isKnownMetricKey(key) || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, key)
	}
	// Existing configs predate the generic temperature-source metric. Preserve
	// their opt-in metric list while enabling the newly added temperature
	// channels; an explicitly empty list still means "disable everything".
	if len(result) > 0 && !seen["temperatureSources"] {
		result = append(result, "temperatureSources")
	}
	return result
}

func isKnownMetricKey(key string) bool {
	for _, known := range allMetricKeys {
		if known == key {
			return true
		}
	}
	return false
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
	return postMetricsContext(context.Background(), client, serverURL, secret, payload)
}

func postMetricsContext(ctx context.Context, client *http.Client, serverURL, secret string, payload metricsPayload) error {
	normalizedServerURL := strings.TrimRight(strings.TrimSpace(serverURL), "/")
	if err := validateServerTransport(normalizedServerURL); err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/api/agent/ingest", normalizedServerURL), bytes.NewReader(body))
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
