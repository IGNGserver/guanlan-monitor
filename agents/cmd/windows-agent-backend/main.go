package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
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
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	gnet "github.com/shirou/gopsutil/v4/net"
)

var BuildVersion = "dev"
var BuildChannel = "test"

const (
	currentConfigVersion             = 1
	maxConfigBodyBytes         int64 = 256 * 1024
	maxCloudResponseBytes      int64 = 512 * 1024
	maxSamplingIntervalSeconds       = 86400
)

var allMetricKeys = []string{
	"cpuUsage", "cpuFrequency", "cpuTemperature", "cpuTopology", "systemOverview",
	"gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature", "gpuDriverInfo", "temperatureSources",
	"memoryUsage", "swapUsage", "memoryAvailable", "memoryCached", "memoryCommitted", "memoryHardware",
	"diskUsage", "diskRead", "diskWrite", "diskMetadata", "diskActivity", "diskHealth",
	"networkRxRate", "networkTxRate", "networkTraffic", "networkIdentity",
	"fanRpm", "fanControl", "fanTargetTemperature", "fanPwm", "fanChannelState", "fanNote",
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

type agentVirtualizationConfig struct {
	Enabled               bool   `json:"enabled"`
	Platform              string `json:"platform"`
	Endpoint              string `json:"endpoint"`
	Node                  string `json:"node"`
	InsecureSkipTLSVerify bool   `json:"insecureSkipTlsVerify"`
	PollIntervalSeconds   int    `json:"pollIntervalSeconds"`
}

type agentLocalConfig struct {
	ConfigVersion        int                        `json:"configVersion"`
	Connection           agentConnectionConfig      `json:"connection"`
	Sampling             agentSamplingConfig        `json:"sampling"`
	EnabledMetrics       []string                   `json:"enabledMetrics"`
	EnabledDeviceIDs     map[string][]string        `json:"enabledDeviceIds"`
	InstanceMetricConfig map[string][]string        `json:"instanceMetricConfig"`
	ProbeSelections      []agentProbeSelection      `json:"probeSelections"`
	Virtualization       *agentVirtualizationConfig `json:"virtualization,omitempty"`
	CloudSyncEnabled     bool                       `json:"cloudSyncEnabled"`
	DataRecordingEnabled bool                       `json:"dataRecordingEnabled"`
	AutoRestartCollector bool                       `json:"autoRestartCollector"`
	AutoStartCollector   bool                       `json:"autoStartCollector"`
}

type agentCloudConfigSyncPayload struct {
	DeviceID             string              `json:"deviceId"`
	EnabledMetrics       []string            `json:"enabledMetrics"`
	EnabledDeviceIDs     map[string][]string `json:"enabledDeviceIds,omitempty"`
	InstanceMetricConfig map[string][]string `json:"instanceMetricConfig,omitempty"`
}

type backendState struct {
	Running                        bool                       `json:"running"`
	BackendStartedAt               string                     `json:"backendStartedAt"`
	FrontendParentPID              int                        `json:"frontendParentPid"`
	ChildStartedAt                 string                     `json:"childStartedAt,omitempty"`
	ConnectionStatus               string                     `json:"connectionStatus"`
	LastChildLog                   string                     `json:"lastChildLog,omitempty"`
	LastUploadAt                   string                     `json:"lastUploadAt,omitempty"`
	LastCloudSyncAt                string                     `json:"lastCloudSyncAt,omitempty"`
	LastCloudSyncError             string                     `json:"lastCloudSyncError,omitempty"`
	CloudConfigPending             bool                       `json:"cloudConfigPending"`
	LastDetectAt                   string                     `json:"lastDetectAt,omitempty"`
	LastExitAt                     string                     `json:"lastExitAt,omitempty"`
	LastRestartAt                  string                     `json:"lastRestartAt,omitempty"`
	RestartCount                   int                        `json:"restartCount"`
	LastExitCode                   *int                       `json:"lastExitCode,omitempty"`
	AutoRestartPending             bool                       `json:"autoRestartPending"`
	EffectiveUploadIntervalSeconds int                        `json:"effectiveUploadIntervalSeconds"`
	LastIssueCategory              string                     `json:"lastIssueCategory,omitempty"`
	LastIssueDetail                string                     `json:"lastIssueDetail,omitempty"`
	LastIssueAt                    string                     `json:"lastIssueAt,omitempty"`
	LastIssueCount                 int                        `json:"lastIssueCount"`
	LastIssueRecoveredAt           string                     `json:"lastIssueRecoveredAt,omitempty"`
	ConfigPath                     string                     `json:"configPath"`
	ConfigFileExists               bool                       `json:"configFileExists"`
	SyncStatePath                  string                     `json:"syncStatePath"`
	SyncStateFileExists            bool                       `json:"syncStateFileExists"`
	DiagnosticsPath                string                     `json:"diagnosticsPath"`
	DiagnosticsFileExists          bool                       `json:"diagnosticsFileExists"`
	PendingStatePath               string                     `json:"pendingStatePath"`
	PendingStateFileExists         bool                       `json:"pendingStateFileExists"`
	PendingSampleCount             int                        `json:"pendingSampleCount"`
	PendingBytes                   int64                      `json:"pendingBytes"`
	OldestPendingAt                string                     `json:"oldestPendingAt,omitempty"`
	LastUploadError                string                     `json:"lastUploadError,omitempty"`
	Config                         agentLocalConfig           `json:"config"`
	SupportedProbePlans            []probePlanSupport         `json:"supportedProbePlans"`
	DetectedTargets                []probeTargetState         `json:"detectedTargets"`
	TemperatureSources             []temperatureSourceReading `json:"temperatureSources"`
	TemperatureSensorBackends      []sensorBackendStatus      `json:"temperatureSensorBackends"`
	TemperatureProbeError          string                     `json:"temperatureProbeError,omitempty"`
}

type probePlanSupport struct {
	Target    string   `json:"target"`
	Providers []string `json:"providers"`
	Default   string   `json:"default"`
}

type probeTargetState struct {
	Target    string                `json:"target"`
	Label     string                `json:"label"`
	Instances []probeDetectedTarget `json:"instances"`
}

type probeDetectedTarget struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Subtitle string   `json:"subtitle,omitempty"`
	Enabled  bool     `json:"enabled"`
	Metrics  []string `json:"metrics"`
}

// Keep this response shape aligned with the collector's temperature sensor
// payload. The backend exposes the result of the same one-shot probe to the
// local Agent page without turning temperature sources into fake hardware
// instances.
type temperatureSourceReading struct {
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

type fanSensorReading struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Interface string `json:"interface"`
}

type temperatureProbeResponse struct {
	TemperatureSources        []temperatureSourceReading `json:"temperatureSources"`
	TemperatureSensorBackends []sensorBackendStatus      `json:"temperatureSensorBackends"`
	Fans                      []fanSensorReading         `json:"fans"`
}

type gpuAdapterDetectRow struct {
	Name                 string `json:"Name"`
	PNPDeviceID          string `json:"PNPDeviceID"`
	AdapterCompatibility string `json:"AdapterCompatibility"`
	VideoProcessor       string `json:"VideoProcessor"`
}

type connectionCheckResult struct {
	OK          bool   `json:"ok"`
	Reachable   bool   `json:"reachable"`
	Authorized  bool   `json:"authorized"`
	DeviceKnown bool   `json:"deviceKnown"`
	Status      string `json:"status"`
	Message     string `json:"message"`
	ServerTime  string `json:"serverTime,omitempty"`
}

type server struct {
	mu                        sync.Mutex
	shutdownOnce              sync.Once
	configPath                string
	syncStatePath             string
	diagnosticsPath           string
	pendingStatePath          string
	childBinaryPath           string
	localToken                string
	childJob                  jobObject
	config                    agentLocalConfig
	cmd                       *exec.Cmd
	requestClient             *http.Client
	httpServer                *http.Server
	frontendParentPID         int
	logBuffer                 string
	connectionState           string
	childStartedAt            time.Time
	backendStartedAt          time.Time
	lastUploadAt              time.Time
	lastCloudSyncAt           time.Time
	lastCloudSyncErr          string
	cloudConfigDirty          bool
	lastDetectAt              time.Time
	detectedTargets           []probeTargetState
	lastExitAt                time.Time
	lastRestartAt             time.Time
	restartCount              int
	lastExitCode              *int
	lastIssueCategory         string
	lastIssueDetail           string
	lastIssueAt               time.Time
	lastIssueCount            int
	lastIssueRecoveredAt      time.Time
	temperatureSources        []temperatureSourceReading
	temperatureSensorBackends []sensorBackendStatus
	temperatureProbeError     string
	stopRequested             bool
	autoRestarting            bool
}

type cloudSyncStateFile struct {
	CloudConfigDirty bool   `json:"cloudConfigDirty"`
	LastCloudSyncAt  string `json:"lastCloudSyncAt,omitempty"`
	LastCloudSyncErr string `json:"lastCloudSyncError,omitempty"`
}

type collectorPendingStateFile struct {
	PendingCount    int    `json:"pendingCount"`
	PendingBytes    int64  `json:"pendingBytes"`
	OldestSampledAt string `json:"oldestSampledAt,omitempty"`
	LastUploadError string `json:"lastUploadError,omitempty"`
}

const (
	restartBackoffBase = 2 * time.Second
	restartBackoffMax  = 20 * time.Second
)

func main() {
	listenAddr := flag.String("listen", "127.0.0.1:17891", "local listen address")
	bundleRoot := flag.String("bundle-root", "", "directory containing packaged backend/agent binaries")
	configRoot := flag.String("config-root", "", "directory for local config files")
	childBinary := flag.String("child-binary", "", "path to the collector binary")
	parentPID := flag.Int("parent-pid", 0, "frontend process id to watch; backend exits when this process exits")
	localToken := flag.String("local-token", "", "legacy bearer token for local control API calls")
	localTokenFile := flag.String("local-token-file", "", "file containing the bearer token for local control API calls")
	flag.Parse()

	exePath, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	resolvedBundleRoot := filepath.Dir(exePath)
	if strings.TrimSpace(*bundleRoot) != "" {
		resolvedBundleRoot = *bundleRoot
	}
	resolvedBundleRoot, err = filepath.Abs(resolvedBundleRoot)
	if err != nil {
		log.Fatal(err)
	}

	resolvedConfigRoot := resolvedBundleRoot
	if strings.TrimSpace(*configRoot) != "" {
		resolvedConfigRoot = *configRoot
	}
	resolvedConfigRoot, err = filepath.Abs(resolvedConfigRoot)
	if err != nil {
		log.Fatal(err)
	}
	if strings.TrimSpace(*localTokenFile) != "" {
		tokenPath := strings.TrimSpace(*localTokenFile)
		if !filepath.IsAbs(tokenPath) {
			tokenPath = filepath.Join(resolvedConfigRoot, tokenPath)
		}
		rawToken, readErr := os.ReadFile(tokenPath)
		if readErr != nil {
			log.Fatalf("read local token file: %v", readErr)
		}
		if len(rawToken) > 4096 {
			log.Fatal("local token file is too large")
		}
		*localToken = strings.TrimSpace(string(rawToken))
	}
	if err := validateListenAddress(*listenAddr, strings.TrimSpace(*localToken)); err != nil {
		log.Fatal(err)
	}

	configPath := filepath.Join(resolvedConfigRoot, "agent-ui.config.json")
	collectorName := "device-state-console-agent"
	if runtime.GOOS == "windows" {
		collectorName += ".exe"
	}
	resolvedChildBinary := strings.TrimSpace(*childBinary)
	if resolvedChildBinary == "" {
		resolvedChildBinary = filepath.Join(resolvedBundleRoot, collectorName)
	} else if !filepath.IsAbs(resolvedChildBinary) {
		resolvedChildBinary = filepath.Join(resolvedBundleRoot, resolvedChildBinary)
	}
	resolvedChildBinary, err = filepath.Abs(resolvedChildBinary)
	if err != nil {
		log.Fatal(err)
	}

	s := &server{
		configPath:       configPath,
		syncStatePath:    filepath.Join(resolvedConfigRoot, "agent-ui.sync-state.json"),
		diagnosticsPath:  filepath.Join(resolvedConfigRoot, "agent-ui.backend.log"),
		pendingStatePath: resolvePendingStatePath(resolvedConfigRoot, configPath),
		childBinaryPath:  resolvedChildBinary,
		localToken:       strings.TrimSpace(*localToken),
		requestClient:    &http.Client{Timeout: 10 * time.Second},
		config:           defaultLocalConfig(),
		connectionState:  "stopped",
		backendStartedAt: time.Now().UTC(),
	}
	if err := s.loadConfig(); err != nil {
		log.Printf("load config failed: %v", err)
	}
	if err := s.loadSyncState(); err != nil {
		log.Printf("load cloud sync state failed: %v", err)
	}
	if s.config.AutoStartCollector && s.config.DataRecordingEnabled {
		s.mu.Lock()
		if err := s.startChildLocked(false); err != nil {
			s.connectionState = "error"
			s.appendDiagnosticLocked("linux auto-start collector failed: %v", err)
		}
		s.mu.Unlock()
	}
	if childJob, err := newJobObject(); err != nil {
		log.Printf("create child job object failed: %v", err)
		s.appendDiagnostic("child job object unavailable: %v", err)
	} else {
		s.childJob = childJob
	}
	if s.childJob != nil {
		defer func() {
			if err := s.childJob.Close(); err != nil {
				log.Printf("close child job object failed: %v", err)
			}
		}()
	}
	s.appendDiagnostic("backend started; config=%s child=%s", s.configPath, s.childBinaryPath)
	if *parentPID > 0 {
		if err := s.attachFrontendParent(*parentPID, "startup"); err != nil {
			s.appendDiagnostic("frontend parent watch failed for pid=%d: %v", *parentPID, err)
			s.requestShutdown(fmt.Sprintf("frontend parent process unavailable; pid=%d", *parentPID))
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/state", s.handleState)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/control/start", s.handleStart)
	mux.HandleFunc("/api/control/stop", s.handleStop)
	mux.HandleFunc("/api/control/restart", s.handleRestart)
	mux.HandleFunc("/api/control/attach-frontend", s.handleAttachFrontend)
	mux.HandleFunc("/api/control/check-connection", s.handleConnectionCheck)
	mux.HandleFunc("/api/control/shutdown", s.handleBackendShutdown)
	mux.HandleFunc("/api/cloud/push", s.handleCloudPush)
	mux.HandleFunc("/api/probes/detect", s.handleProbeDetect)

	httpServer := &http.Server{
		Addr:    *listenAddr,
		Handler: mux,
	}
	s.httpServer = httpServer

	log.Printf("device state console agent backend v%s listening on http://%s", BuildVersion, *listenAddr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func defaultLocalConfig() agentLocalConfig {
	deviceID := "windows-agent"
	hostname := "Windows Agent"
	probeSelections := []agentProbeSelection{
		{Target: "cpu", Provider: "gopsutil", Enabled: true},
		{Target: "memory", Provider: "gopsutil", Enabled: true},
		{Target: "disk", Provider: "gopsutil", Enabled: true},
		{Target: "network", Provider: "gopsutil", Enabled: true},
		{Target: "gpu", Provider: "wmi", Enabled: true},
		{Target: "fan", Provider: "librehardwaremonitor", Enabled: true},
	}
	if runtime.GOOS == "linux" {
		deviceID = "linux-agent"
		hostname = "Linux Agent"
		if detectedHostname, err := os.Hostname(); err == nil && strings.TrimSpace(detectedHostname) != "" {
			deviceID = strings.TrimSpace(detectedHostname)
			hostname = strings.TrimSpace(detectedHostname)
		}
		probeSelections = []agentProbeSelection{
			{Target: "cpu", Provider: "gopsutil", Enabled: true},
			{Target: "memory", Provider: "gopsutil", Enabled: true},
			{Target: "disk", Provider: "gopsutil", Enabled: true},
			{Target: "network", Provider: "gopsutil", Enabled: true},
			{Target: "gpu", Provider: "disabled", Enabled: false},
			{Target: "fan", Provider: "hwmon", Enabled: true},
		}
	}

	return agentLocalConfig{
		ConfigVersion: currentConfigVersion,
		Connection: agentConnectionConfig{
			ServerURL: "http://127.0.0.1:3100",
			Secret:    "",
			DeviceID:  deviceID,
			Hostname:  hostname,
		},
		Sampling: agentSamplingConfig{
			NormalIntervalSeconds: 30,
			SlowIntervalSeconds:   30,
		},
		EnabledMetrics: []string{
			"cpuUsage", "cpuFrequency", "cpuTemperature", "cpuTopology", "systemOverview",
			"memoryUsage", "swapUsage", "memoryAvailable", "memoryCached", "memoryCommitted", "memoryHardware",
			"diskUsage", "diskRead", "diskWrite", "diskMetadata", "diskActivity", "diskHealth",
			"networkRxRate", "networkTxRate", "networkTraffic", "networkIdentity",
		},
		EnabledDeviceIDs:     map[string][]string{},
		InstanceMetricConfig: map[string][]string{},
		ProbeSelections:      probeSelections,
		CloudSyncEnabled:     true,
		DataRecordingEnabled: true,
		AutoRestartCollector: true,
		AutoStartCollector:   false,
	}
}

func supportedProbePlans() []probePlanSupport {
	if runtime.GOOS == "linux" {
		return []probePlanSupport{
			{Target: "connection", Providers: []string{"gopsutil"}, Default: "gopsutil"},
			{Target: "cpu", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
			{Target: "memory", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
			{Target: "disk", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
			{Target: "network", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
			{Target: "gpu", Providers: []string{"disabled"}, Default: "disabled"},
			{Target: "fan", Providers: []string{"disabled", "hwmon"}, Default: "hwmon"},
		}
	}
	return []probePlanSupport{
		{Target: "connection", Providers: []string{"gopsutil"}, Default: "gopsutil"},
		{Target: "cpu", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
		{Target: "memory", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
		{Target: "disk", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
		{Target: "network", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
		{Target: "gpu", Providers: []string{"disabled", "wmi"}, Default: "wmi"},
		{Target: "fan", Providers: []string{"disabled", "librehardwaremonitor"}, Default: "librehardwaremonitor"},
	}
}

func (s *server) loadConfig() error {
	raw, err := readLimitedFile(s.configPath, maxConfigBodyBytes)
	if err != nil {
		if os.IsNotExist(err) {
			return s.saveConfigLocked()
		}
		return err
	}
	raw = trimUTF8BOM(raw)
	var cfg agentLocalConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return err
	}
	s.config = normalizeLocalConfig(cfg, raw)
	// Persist migrations so the collector, which reads the same file directly,
	// observes the normalized metric set immediately after backend startup.
	return s.saveConfigLocked()
}

func (s *server) loadSyncState() error {
	raw, err := readLimitedFile(s.syncStatePath, maxConfigBodyBytes)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	raw = trimUTF8BOM(raw)
	var state cloudSyncStateFile
	if err := json.Unmarshal(raw, &state); err != nil {
		return err
	}
	s.cloudConfigDirty = state.CloudConfigDirty
	s.lastCloudSyncErr = strings.TrimSpace(state.LastCloudSyncErr)
	if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(state.LastCloudSyncAt)); err == nil {
		s.lastCloudSyncAt = parsed.UTC()
	}
	return nil
}

func readLimitedFile(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, fmt.Errorf("file %s is too large", path)
	}
	return raw, nil
}

func (s *server) saveConfigLocked() error {
	raw, err := s.marshalConfigLocked()
	if err != nil {
		return err
	}
	return writeStateFile(s.configPath, raw)
}

func (s *server) saveSyncStateLocked() error {
	raw, err := s.marshalSyncStateLocked()
	if err != nil {
		return err
	}
	return writeStateFile(s.syncStatePath, raw)
}

func (s *server) marshalConfigLocked() ([]byte, error) {
	return json.MarshalIndent(s.config, "", "  ")
}

func (s *server) marshalSyncStateLocked() ([]byte, error) {
	return json.MarshalIndent(cloudSyncStateFile{
		CloudConfigDirty: s.cloudConfigDirty,
		LastCloudSyncAt:  formatTime(s.lastCloudSyncAt),
		LastCloudSyncErr: s.lastCloudSyncErr,
	}, "", "  ")
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}

	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func (s *server) snapshotLocked() backendState {
	pending := readCollectorPendingState(s.pendingStatePath)
	return backendState{
		Running:                        s.cmd != nil && s.cmd.Process != nil,
		BackendStartedAt:               s.backendStartedAt.Format(time.RFC3339),
		FrontendParentPID:              s.frontendParentPID,
		ChildStartedAt:                 formatTime(s.childStartedAt),
		ConnectionStatus:               s.connectionState,
		LastChildLog:                   redactSensitiveText(s.logBuffer, s.config.Connection.Secret),
		LastUploadAt:                   formatTime(s.lastUploadAt),
		LastCloudSyncAt:                formatTime(s.lastCloudSyncAt),
		LastCloudSyncError:             redactSensitiveText(s.lastCloudSyncErr, s.config.Connection.Secret),
		CloudConfigPending:             s.cloudConfigDirty,
		LastDetectAt:                   formatTime(s.lastDetectAt),
		LastExitAt:                     formatTime(s.lastExitAt),
		LastRestartAt:                  formatTime(s.lastRestartAt),
		RestartCount:                   s.restartCount,
		LastExitCode:                   cloneIntPointer(s.lastExitCode),
		AutoRestartPending:             s.autoRestarting,
		EffectiveUploadIntervalSeconds: s.config.Sampling.NormalIntervalSeconds,
		LastIssueCategory:              s.lastIssueCategory,
		LastIssueDetail:                redactSensitiveText(s.lastIssueDetail, s.config.Connection.Secret),
		LastIssueAt:                    formatTime(s.lastIssueAt),
		LastIssueCount:                 s.lastIssueCount,
		LastIssueRecoveredAt:           formatTime(s.lastIssueRecoveredAt),
		ConfigPath:                     s.configPath,
		ConfigFileExists:               fileExists(s.configPath),
		SyncStatePath:                  s.syncStatePath,
		SyncStateFileExists:            fileExists(s.syncStatePath),
		DiagnosticsPath:                s.diagnosticsPath,
		DiagnosticsFileExists:          fileExists(s.diagnosticsPath),
		PendingStatePath:               s.pendingStatePath,
		PendingStateFileExists:         fileExists(s.pendingStatePath),
		PendingSampleCount:             pending.PendingCount,
		PendingBytes:                   pending.PendingBytes,
		OldestPendingAt:                pending.OldestSampledAt,
		LastUploadError:                redactSensitiveText(pending.LastUploadError, s.config.Connection.Secret),
		Config:                         s.config,
		SupportedProbePlans:            supportedProbePlans(),
		DetectedTargets:                append([]probeTargetState(nil), s.detectedTargets...),
		TemperatureSources:             append([]temperatureSourceReading(nil), s.temperatureSources...),
		TemperatureSensorBackends:      append([]sensorBackendStatus(nil), s.temperatureSensorBackends...),
		TemperatureProbeError:          s.temperatureProbeError,
	}
}

func resolvePendingStatePath(configRoot, configPath string) string {
	pendingPath := strings.TrimSpace(os.Getenv("DSC_AGENT_PENDING_FILE"))
	if pendingPath == "" {
		pendingPath = configPath + ".pending.jsonl"
	}
	if !filepath.IsAbs(pendingPath) {
		pendingPath = filepath.Join(configRoot, pendingPath)
	}
	return pendingPath + ".state.json"
}

func readCollectorPendingState(path string) collectorPendingStateFile {
	var state collectorPendingStateFile
	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &state)
	} else if !os.IsNotExist(err) {
		return state
	}

	// The state file is only a cache. Reconcile the displayed count with the
	// JSONL spool so an interrupted collector cannot leave the desktop showing
	// an old queue such as 7711 after the spool has already been drained.
	pendingPath := strings.TrimSuffix(path, ".state.json")
	spool, spoolErr := os.ReadFile(pendingPath)
	if spoolErr != nil {
		if os.IsNotExist(spoolErr) {
			state.PendingCount = 0
			state.PendingBytes = 0
			state.OldestSampledAt = ""
		}
		return state
	}

	state.PendingCount = 0
	state.PendingBytes = int64(len(spool))
	state.OldestSampledAt = ""
	for _, line := range bytes.Split(spool, []byte{'\n'}) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var entry struct {
			SampledAt string `json:"sampledAt"`
		}
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}
		state.PendingCount++
		if state.OldestSampledAt == "" || (entry.SampledAt != "" && entry.SampledAt < state.OldestSampledAt) {
			state.OldestSampledAt = entry.SampledAt
		}
	}
	return state
}

func validateListenAddress(raw, token string) error {
	address := strings.TrimSpace(raw)
	if address == "" {
		return errors.New("local listen address is required")
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("invalid local listen address: %w", err)
	}
	if isLoopbackHost(host) {
		return nil
	}
	if strings.TrimSpace(token) == "" {
		return errors.New("non-loopback local listen address requires a local token")
	}
	return nil
}

func (s *server) authorizeLocalRequest(writer http.ResponseWriter, request *http.Request) bool {
	if s.localToken == "" {
		return true
	}
	provided := strings.TrimSpace(request.Header.Get("X-DSC-Local-Token"))
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(s.localToken)) != 1 {
		writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "unauthorized_local_client"})
		return false
	}
	return true
}

func (s *server) handleState(writer http.ResponseWriter, request *http.Request) {
	if !s.authorizeLocalRequest(writer, request) {
		return
	}
	s.mu.Lock()
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	writeJSON(writer, http.StatusOK, snapshot)
}

func (s *server) handleConfig(writer http.ResponseWriter, request *http.Request) {
	if !s.authorizeLocalRequest(writer, request) {
		return
	}
	switch request.Method {
	case http.MethodGet:
		s.mu.Lock()
		config := s.snapshotLocked().Config
		s.mu.Unlock()
		writeJSON(writer, http.StatusOK, config)
	case http.MethodPut:
		raw, readErr := io.ReadAll(io.LimitReader(request.Body, maxConfigBodyBytes+1))
		if readErr != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
			return
		}
		if int64(len(raw)) > maxConfigBodyBytes {
			writeJSON(writer, http.StatusRequestEntityTooLarge, map[string]string{"error": "config_too_large"})
			return
		}

		var payload agentLocalConfig
		if err := json.Unmarshal(raw, &payload); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
			return
		}

		var (
			configRaw    []byte
			syncStateRaw []byte
			err          error
		)

		s.mu.Lock()
		displayChanged := displayConfigChanged(s.config, payload)
		s.config = normalizeLocalConfig(payload, raw)
		s.detectedTargets = applyDetectedTargetConfig(s.detectedTargets, s.config.EnabledDeviceIDs)
		if !s.config.DataRecordingEnabled {
			s.stopCollectorLocked("data recording disabled")
		}
		configRaw, err = s.marshalConfigLocked()
		if err == nil && displayChanged {
			s.cloudConfigDirty = true
			syncStateRaw, err = s.marshalSyncStateLocked()
		}
		s.mu.Unlock()
		if err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if err := writeStateFile(s.configPath, configRaw); err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if len(syncStateRaw) > 0 {
			if err := writeStateFile(s.syncStatePath, syncStateRaw); err != nil {
				writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
		}
		writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
	default:
		writer.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) handleStart(writer http.ResponseWriter, request *http.Request) {
	if !s.authorizeLocalRequest(writer, request) {
		return
	}
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.mu.Lock()
	if !s.config.DataRecordingEnabled {
		snapshot := s.snapshotLocked()
		s.mu.Unlock()
		writeJSON(writer, http.StatusConflict, map[string]any{"error": "data_recording_disabled", "state": snapshot})
		return
	}
	if s.cmd != nil && s.cmd.Process != nil {
		snapshot := s.snapshotLocked()
		s.mu.Unlock()
		writeJSON(writer, http.StatusOK, snapshot)
		return
	}

	s.stopRequested = false
	if err := s.startChildLocked(false); err != nil {
		s.mu.Unlock()
		writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	writeJSON(writer, http.StatusOK, snapshot)
}

func (s *server) handleStop(writer http.ResponseWriter, request *http.Request) {
	if !s.authorizeLocalRequest(writer, request) {
		return
	}
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.mu.Lock()
	s.stopCollectorLocked("manual stop")
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	writeJSON(writer, http.StatusOK, snapshot)
}

func (s *server) handleRestart(writer http.ResponseWriter, request *http.Request) {
	if !s.authorizeLocalRequest(writer, request) {
		return
	}
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	s.stopCollectorLocked("manual restart")
	if err := s.startChildLocked(true); err != nil {
		snapshot := s.snapshotLocked()
		s.mu.Unlock()
		writeJSON(writer, http.StatusConflict, map[string]any{"error": err.Error(), "state": snapshot})
		return
	}
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	writeJSON(writer, http.StatusOK, snapshot)
}

func (s *server) handleAttachFrontend(writer http.ResponseWriter, request *http.Request) {
	if !s.authorizeLocalRequest(writer, request) {
		return
	}
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var payload struct {
		ParentPID int `json:"parentPid"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}

	if err := s.attachFrontendParent(payload.ParentPID, "attach-api"); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	s.mu.Lock()
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	writeJSON(writer, http.StatusOK, snapshot)
}

func (s *server) handleConnectionCheck(writer http.ResponseWriter, request *http.Request) {
	if !s.authorizeLocalRequest(writer, request) {
		return
	}
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	cfg := s.config
	s.mu.Unlock()

	result := s.checkConnection(cfg)
	statusCode := http.StatusOK
	if !result.OK {
		statusCode = http.StatusBadGateway
		if !result.Reachable {
			statusCode = http.StatusServiceUnavailable
		} else if !result.Authorized {
			statusCode = http.StatusUnauthorized
		}
	}
	writeJSON(writer, statusCode, result)
}

func (s *server) handleBackendShutdown(writer http.ResponseWriter, request *http.Request) {
	if !s.authorizeLocalRequest(writer, request) {
		return
	}
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	snapshot := s.snapshotLocked()
	s.mu.Unlock()

	writeJSON(writer, http.StatusOK, map[string]any{
		"ok":    true,
		"state": snapshot,
	})

	s.scheduleShutdown("backend shutdown requested", 150*time.Millisecond)
}

func (s *server) handleCloudPush(writer http.ResponseWriter, request *http.Request) {
	if !s.authorizeLocalRequest(writer, request) {
		return
	}
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	cfg := s.config
	s.mu.Unlock()

	if !cfg.CloudSyncEnabled {
		s.appendDiagnostic("cloud push skipped because cloud sync is disabled")
		writeJSON(writer, http.StatusConflict, map[string]string{"error": "cloud_sync_disabled"})
		return
	}
	if err := validateServerTransport(cfg.Connection.ServerURL); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	body := agentCloudConfigSyncPayload{
		DeviceID:             cfg.Connection.DeviceID,
		EnabledMetrics:       cfg.EnabledMetrics,
		EnabledDeviceIDs:     cfg.EnabledDeviceIDs,
		InstanceMetricConfig: cfg.InstanceMetricConfig,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	httpRequest, err := http.NewRequest(http.MethodPost, strings.TrimRight(cfg.Connection.ServerURL, "/")+"/api/agent/device-config", bytes.NewReader(raw))
	if err != nil {
		writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", "Bearer "+cfg.Connection.Secret)

	response, err := s.requestClient.Do(httpRequest)
	if err != nil {
		var syncStateRaw []byte
		s.mu.Lock()
		s.lastCloudSyncAt = time.Now().UTC()
		safeErr := redactSensitiveText(err.Error(), cfg.Connection.Secret)
		s.lastCloudSyncErr = safeErr
		s.cloudConfigDirty = true
		s.appendDiagnosticLocked("cloud push failed: %s", safeErr)
		syncStateRaw, _ = s.marshalSyncStateLocked()
		s.mu.Unlock()
		if len(syncStateRaw) > 0 {
			_ = writeStateFile(s.syncStatePath, syncStateRaw)
		}
		writeJSON(writer, http.StatusBadGateway, map[string]string{"error": safeErr})
		return
	}
	defer response.Body.Close()

	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, maxCloudResponseBytes+1))
	if readErr != nil {
		responseBody = []byte("cloud_response_read_failed")
		response.StatusCode = http.StatusBadGateway
	}
	if int64(len(responseBody)) > maxCloudResponseBytes {
		responseBody = []byte("cloud_response_too_large")
		response.StatusCode = http.StatusBadGateway
	}
	responseText := redactSensitiveText(string(responseBody), cfg.Connection.Secret)
	var syncStateRaw []byte
	s.mu.Lock()
	s.lastCloudSyncAt = time.Now().UTC()
	if response.StatusCode >= 300 {
		s.lastCloudSyncErr = responseText
		s.appendDiagnosticLocked("cloud push returned status=%d body=%s", response.StatusCode, responseText)
	} else {
		s.lastCloudSyncErr = ""
		s.cloudConfigDirty = false
		s.appendDiagnosticLocked("cloud push succeeded for device=%s", cfg.Connection.DeviceID)
	}
	syncStateRaw, _ = s.marshalSyncStateLocked()
	s.mu.Unlock()
	if len(syncStateRaw) > 0 {
		_ = writeStateFile(s.syncStatePath, syncStateRaw)
	}

	if response.StatusCode >= 300 {
		writeJSON(writer, response.StatusCode, map[string]string{"error": responseText})
		return
	}
	responsePayload := json.RawMessage("null")
	if json.Valid(responseBody) {
		responsePayload = json.RawMessage(responseBody)
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"ok":       true,
		"response": responsePayload,
	})
}

func (s *server) checkConnection(cfg agentLocalConfig) connectionCheckResult {
	serverURL := strings.TrimSpace(cfg.Connection.ServerURL)
	secret := strings.TrimSpace(cfg.Connection.Secret)
	deviceID := strings.TrimSpace(cfg.Connection.DeviceID)
	if serverURL == "" {
		return connectionCheckResult{
			Status:  "missing_server_url",
			Message: "请先填写中枢 Server URL。",
		}
	}
	if secret == "" {
		return connectionCheckResult{
			Status:  "missing_secret",
			Message: "请先填写 Agent Secret。",
		}
	}
	if deviceID == "" {
		return connectionCheckResult{
			Status:  "missing_device_id",
			Message: "请先填写 Device ID。",
		}
	}
	if err := validateServerTransport(serverURL); err != nil {
		return connectionCheckResult{Status: "insecure_server_transport", Message: err.Error()}
	}

	pingRequest, err := http.NewRequest(http.MethodGet, strings.TrimRight(serverURL, "/")+"/api/agent/ping", nil)
	if err != nil {
		return connectionCheckResult{
			Status:    "invalid_server_url",
			Message:   fmt.Sprintf("中枢地址格式不正确：%v", err),
			Reachable: false,
		}
	}
	pingRequest.Header.Set("Authorization", "Bearer "+secret)

	pingResponse, err := s.requestClient.Do(pingRequest)
	if err != nil {
		return connectionCheckResult{
			Status:    "server_unreachable",
			Message:   fmt.Sprintf("无法连接到中枢：%v", err),
			Reachable: false,
		}
	}
	defer pingResponse.Body.Close()

	var pingBody struct {
		OK         bool   `json:"ok"`
		ServerTime string `json:"serverTime"`
		Error      string `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(pingResponse.Body, 64*1024)).Decode(&pingBody)

	if pingResponse.StatusCode == http.StatusUnauthorized {
		return connectionCheckResult{
			Status:     "unauthorized",
			Message:    "Agent Secret 校验失败，请确认与中枢 AGENT_SHARED_SECRET 一致。",
			Reachable:  true,
			Authorized: false,
		}
	}
	if pingResponse.StatusCode >= 300 {
		return connectionCheckResult{
			Status:     "server_error",
			Message:    fmt.Sprintf("中枢已响应，但返回了异常状态：%s", pingResponse.Status),
			Reachable:  true,
			Authorized: false,
		}
	}

	deviceRequest, err := http.NewRequest(http.MethodGet, strings.TrimRight(serverURL, "/")+"/api/agent/device-state?deviceId="+url.QueryEscape(deviceID), nil)
	if err != nil {
		return connectionCheckResult{
			Status:     "invalid_device_check_url",
			Message:    fmt.Sprintf("设备状态地址格式不正确：%v", err),
			Reachable:  true,
			Authorized: true,
		}
	}
	deviceRequest.Header.Set("Authorization", "Bearer "+secret)
	deviceResponse, err := s.requestClient.Do(deviceRequest)
	if err != nil {
		return connectionCheckResult{
			Status:     "device_check_failed",
			Message:    fmt.Sprintf("中枢可达，但设备状态检查失败：%v", err),
			Reachable:  true,
			Authorized: true,
		}
	}
	defer deviceResponse.Body.Close()
	if deviceResponse.StatusCode == http.StatusNotFound {
		return connectionCheckResult{
			Status:      "device_not_known",
			Message:     "中枢已认证，但尚未找到该设备。",
			Reachable:   true,
			Authorized:  true,
			DeviceKnown: false,
		}
	}
	if deviceResponse.StatusCode == http.StatusUnauthorized {
		return connectionCheckResult{
			Status:     "unauthorized",
			Message:    "Agent Secret 校验失败，请确认与中枢 AGENT_SHARED_SECRET 一致。",
			Reachable:  true,
			Authorized: false,
		}
	}
	if deviceResponse.StatusCode >= 300 {
		return connectionCheckResult{
			Status:     "device_check_failed",
			Message:    fmt.Sprintf("中枢已响应，但设备状态检查返回了异常状态：%s", deviceResponse.Status),
			Reachable:  true,
			Authorized: true,
		}
	}

	result := connectionCheckResult{
		OK:          true,
		Reachable:   true,
		Authorized:  true,
		DeviceKnown: true,
		Status:      "authorized",
		Message:     "已成功连接中枢，Agent Secret 校验通过。",
		ServerTime:  strings.TrimSpace(pingBody.ServerTime),
	}

	result.Message = "已成功连接中枢，Agent Secret 校验通过。"
	return result
}

func (s *server) handleProbeDetect(writer http.ResponseWriter, request *http.Request) {
	if !s.authorizeLocalRequest(writer, request) {
		return
	}
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.mu.Lock()
	cfg := s.config
	s.mu.Unlock()

	detected, err := detectTargets(cfg)
	if err != nil {
		s.appendDiagnostic("probe detect failed: %v", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	temperatureSources, temperatureBackends, fans, temperatureErr := s.detectTemperatureSources()
	decorateDetectedFanTargets(detected, fans, cfg)
	decorateDetectedMetrics(detected)

	s.mu.Lock()
	s.detectedTargets = detected
	s.temperatureSources = temperatureSources
	s.temperatureSensorBackends = temperatureBackends
	s.temperatureProbeError = ""
	if temperatureErr != nil {
		s.temperatureProbeError = temperatureErr.Error()
		s.appendDiagnosticLocked("temperature source probe failed: %v", temperatureErr)
	}
	s.lastDetectAt = time.Now().UTC()
	s.appendDiagnosticLocked("probe detect succeeded; targets=%d temperatureSources=%d", len(detected), len(temperatureSources))
	s.mu.Unlock()

	writeJSON(writer, http.StatusOK, map[string]any{
		"ok":                        true,
		"providers":                 supportedProbePlans(),
		"detectedTargets":           detected,
		"temperatureSources":        temperatureSources,
		"temperatureSensorBackends": temperatureBackends,
		"fans":                      fans,
		"temperatureProbeError": func() string {
			if temperatureErr == nil {
				return ""
			}
			return temperatureErr.Error()
		}(),
	})
}

func (s *server) detectTemperatureSources() ([]temperatureSourceReading, []sensorBackendStatus, []fanSensorReading, error) {
	if strings.TrimSpace(s.childBinaryPath) == "" {
		return []temperatureSourceReading{}, []sensorBackendStatus{}, []fanSensorReading{}, errors.New("collector_binary_missing")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, s.childBinaryPath, "hardware-sensor-probe")
	command.Dir = filepath.Dir(s.childBinaryPath)
	command.Env = append(os.Environ(), fmt.Sprintf("DSC_AGENT_CONFIG_FILE=%s", s.configPath))
	output, err := command.Output()
	if err != nil {
		if ctx.Err() != nil {
			return []temperatureSourceReading{}, []sensorBackendStatus{}, []fanSensorReading{}, fmt.Errorf("temperature_probe_timeout: %w", ctx.Err())
		}
		return []temperatureSourceReading{}, []sensorBackendStatus{}, []fanSensorReading{}, fmt.Errorf("temperature_probe_failed: %w", err)
	}
	var response temperatureProbeResponse
	if err := json.Unmarshal(bytes.TrimSpace(output), &response); err != nil {
		return []temperatureSourceReading{}, []sensorBackendStatus{}, []fanSensorReading{}, fmt.Errorf("temperature_probe_invalid_response: %w", err)
	}
	return response.TemperatureSources, response.TemperatureSensorBackends, response.Fans, nil
}

func decorateDetectedFanTargets(targets []probeTargetState, fans []fanSensorReading, cfg agentLocalConfig) {
	enabled, explicit := enabledIDs(cfg.EnabledDeviceIDs, "fan")
	instances := make([]probeDetectedTarget, 0, len(fans))
	for index, fan := range fans {
		id := strings.TrimSpace(fan.ID)
		if id == "" {
			id = fmt.Sprintf("fan-%s", detectSanitizeKey(strings.TrimSpace(fan.Interface)+"-"+strings.TrimSpace(fan.Label)))
		}
		name := strings.TrimSpace(fan.Label)
		if name == "" {
			name = fmt.Sprintf("风扇 %d", index+1)
		}
		instances = append(instances, probeDetectedTarget{
			ID:       id,
			Name:     name,
			Subtitle: strings.TrimSpace(fan.Interface),
			Enabled:  isIDEnabled(enabled, explicit, id),
		})
	}
	for index := range targets {
		if targets[index].Target == "fan" {
			targets[index].Instances = instances
			return
		}
	}
}

func decorateDetectedMetrics(targets []probeTargetState) {
	for targetIndex := range targets {
		for instanceIndex := range targets[targetIndex].Instances {
			targets[targetIndex].Instances[instanceIndex].Metrics = metricsForProbeTarget(targets[targetIndex].Target)
		}
	}
}

func metricsForProbeTarget(target string) []string {
	switch target {
	case "cpu":
		return []string{"使用率", "频率", "温度", "逻辑核心数", "物理核心数", "进程数", "线程数", "句柄数"}
	case "disk":
		return []string{"已用空间", "总空间", "可用空间", "使用率", "读取速率", "写入速率", "活动时间", "平均响应", "文件系统", "挂载点", "型号", "厂商", "接口类型", "温度", "健康状态", "SMART"}
	case "network":
		return []string{"接收速率", "发送速率", "累计接收", "累计发送", "MAC 地址", "IP 地址", "链路速度", "连接类型", "信号强度"}
	case "gpu":
		return []string{"使用率", "编码利用率", "解码利用率", "核心频率", "显存已用", "显存总量", "显存使用率", "温度", "驱动与适配器信息"}
	case "fan":
		return []string{"转速", "控制模式", "目标温度", "最小 PWM", "最大 PWM", "通道状态", "传感器备注"}
	default:
		return []string{"状态"}
	}
}

func detectTargets(cfg agentLocalConfig) ([]probeTargetState, error) {
	targets := make([]probeTargetState, 0, 5)

	cpuEnabled, cpuExplicit := enabledIDs(cfg.EnabledDeviceIDs, "cpu")
	var cpuInstances []probeDetectedTarget
	cpuInfo, err := cpu.InfoWithContext(context.Background())
	if err == nil && len(cpuInfo) > 0 {
		logicalCount, _ := cpu.CountsWithContext(context.Background(), true)
		physicalCount, _ := cpu.CountsWithContext(context.Background(), false)
		cpuInstances = detectCPUPackages(cpuInfo, logicalCount, physicalCount, cpuEnabled, cpuExplicit)
	}
	if len(cpuInstances) == 0 {
		cpuInstances = detectCPUPackagesFallback(cpuEnabled, cpuExplicit)
	}
	targets = append(targets, probeTargetState{
		Target:    "cpu",
		Label:     "CPU 实例",
		Instances: cpuInstances,
	})

	diskEnabled, diskExplicit := enabledIDs(cfg.EnabledDeviceIDs, "disk")
	diskInstances := detectDiskInstances(diskEnabled, diskExplicit)
	targets = append(targets, probeTargetState{
		Target:    "disk",
		Label:     "磁盘实例",
		Instances: diskInstances,
	})

	networkEnabled, networkExplicit := enabledIDs(cfg.EnabledDeviceIDs, "network")
	var networkInstances []probeDetectedTarget
	if interfaces, err := gnet.Interfaces(); err == nil {
		networkInstances = make([]probeDetectedTarget, 0, len(interfaces))
		for _, iface := range interfaces {
			name := strings.TrimSpace(iface.Name)
			if name == "" {
				continue
			}
			id := fmt.Sprintf("nic-%s", detectSanitizeKey(name))
			addresses := make([]string, 0, len(iface.Addrs))
			for _, addr := range iface.Addrs {
				if strings.TrimSpace(addr.Addr) != "" {
					addresses = append(addresses, strings.TrimSpace(addr.Addr))
				}
			}
			subtitle := strings.Join(addresses, " | ")
			if subtitle == "" {
				subtitle = strings.TrimSpace(iface.HardwareAddr)
			}
			networkInstances = append(networkInstances, probeDetectedTarget{
				ID:       id,
				Name:     name,
				Subtitle: subtitle,
				Enabled:  isIDEnabled(networkEnabled, networkExplicit, id),
			})
		}
	} else {
		networkInstances = []probeDetectedTarget{}
	}
	targets = append(targets, probeTargetState{
		Target:    "network",
		Label:     "网卡实例",
		Instances: networkInstances,
	})

	gpuEnabled, gpuExplicit := enabledIDs(cfg.EnabledDeviceIDs, "gpu")
	gpuInstances, err := detectGPUAdapters(gpuEnabled, gpuExplicit)
	if err != nil {
		// A WMI/PowerShell GPU probe can fail independently of the built-in
		// CPU, disk, and network probes. Keep the successful groups instead of
		// discarding the whole detection result (which used to hide disks too).
		log.Printf("gpu probe detection skipped: %v", err)
		gpuInstances = []probeDetectedTarget{}
	}
	targets = append(targets, probeTargetState{
		Target:    "gpu",
		Label:     "显卡实例",
		Instances: gpuInstances,
	})
	targets = append(targets, probeTargetState{
		Target:    "fan",
		Label:     "风扇实例",
		Instances: []probeDetectedTarget{},
	})

	return targets, nil
}

type windowsDiskPartitionRow struct {
	Device     string `json:"device"`
	MountPoint string `json:"mountPoint"`
	FileSystem string `json:"filesystem"`
}

func detectDiskInstances(enabled map[string]struct{}, explicit bool) []probeDetectedTarget {
	partitions, err := disk.Partitions(false)
	if err != nil || !hasUsableDiskPartitions(partitions) {
		if fallback, fallbackErr := disk.Partitions(true); fallbackErr == nil && hasUsableDiskPartitions(fallback) {
			partitions = fallback
		}
	}

	instances := make([]probeDetectedTarget, 0, len(partitions))
	seen := map[string]struct{}{}
	appendPartition := func(deviceName, mountPoint, filesystem string) {
		deviceName = strings.TrimSpace(deviceName)
		mountPoint = strings.TrimSpace(mountPoint)
		filesystem = strings.TrimSpace(filesystem)
		if deviceName == "" {
			deviceName = mountPoint
		}
		if deviceName == "" || mountPoint == "" {
			return
		}
		id := fmt.Sprintf("%s:%s", deviceName, mountPoint)
		if _, exists := seen[id]; exists {
			return
		}
		seen[id] = struct{}{}
		subtitle := mountPoint
		if filesystem != "" {
			subtitle += " · " + filesystem
		}
		instances = append(instances, probeDetectedTarget{
			ID:       id,
			Name:     deviceName,
			Subtitle: subtitle,
			Enabled:  isIDEnabled(enabled, explicit, id),
		})
	}
	for _, partition := range partitions {
		appendPartition(partition.Device, partition.Mountpoint, partition.Fstype)
	}

	if len(instances) == 0 && runtime.GOOS == "windows" {
		if rows, powershellErr := detectWindowsDiskPartitionRows(); powershellErr == nil {
			for _, row := range rows {
				appendPartition(row.Device, row.MountPoint, row.FileSystem)
			}
		}
	}
	return instances
}

func hasUsableDiskPartitions(partitions []disk.PartitionStat) bool {
	for _, partition := range partitions {
		if strings.TrimSpace(partition.Mountpoint) != "" {
			return true
		}
	}
	return false
}

func detectWindowsDiskPartitionRows() ([]windowsDiskPartitionRow, error) {
	if runtime.GOOS != "windows" {
		return []windowsDiskPartitionRow{}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
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

func detectCPUPackages(info []cpu.InfoStat, logicalCount int, physicalCount int, enabled map[string]struct{}, explicit bool) []probeDetectedTarget {
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

	for index, entry := range info {
		key := strings.TrimSpace(entry.PhysicalID)
		if key == "" {
			key = "cpu-0"
		} else {
			key = fmt.Sprintf("cpu-%s", detectSanitizeKey(key))
		}
		if _, exists := packages[key]; !exists {
			name := strings.TrimSpace(entry.ModelName)
			if name == "" {
				name = fmt.Sprintf("CPU %d", len(packages)+1)
			}
			packages[key] = &packageAccumulator{
				id:    key,
				name:  name,
				model: strings.TrimSpace(entry.ModelName),
			}
			order = append(order, key)
		}

		current := packages[key]
		current.coreCount += int(entry.Cores)
		if entry.Mhz > 0 {
			current.frequencies = append(current.frequencies, entry.Mhz)
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
		return []probeDetectedTarget{}
	}

	fallbackLogical := 0
	if len(packages) > 0 && logicalCount > 0 {
		fallbackLogical = int(math.Max(1, math.Round(float64(logicalCount)/float64(len(packages)))))
	}

	instances := make([]probeDetectedTarget, 0, len(order))
	for _, key := range order {
		entry := packages[key]
		resolvedLogical := entry.logicalCount
		if resolvedLogical == 0 {
			resolvedLogical = fallbackLogical
		}

		details := make([]string, 0, 3)
		if entry.model != "" && !strings.EqualFold(entry.model, entry.name) {
			details = append(details, entry.model)
		}
		if entry.coreCount > 0 {
			details = append(details, fmt.Sprintf("%d 核", entry.coreCount))
		}
		if resolvedLogical > 0 {
			details = append(details, fmt.Sprintf("%d 线程", resolvedLogical))
		}

		instances = append(instances, probeDetectedTarget{
			ID:       entry.id,
			Name:     entry.name,
			Subtitle: strings.Join(details, " · "),
			Enabled:  isIDEnabled(enabled, explicit, entry.id),
		})
	}

	return instances
}

func detectCPUPackagesFallback(enabled map[string]struct{}, explicit bool) []probeDetectedTarget {
	if runtime.GOOS != "windows" {
		return []probeDetectedTarget{}
	}
	commandText := `$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Processor | ForEach-Object { [pscustomobject]@{ id=[string]$_.DeviceID; name=[string]$_.Name; model=[string]$_.Name; coreCount=[int]$_.NumberOfCores; logicalCount=[int]$_.NumberOfLogicalProcessors } }); @($rows) | ConvertTo-Json -Depth 4 -Compress`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", commandText)
	output, err := cmd.Output()
	if err != nil {
		return []probeDetectedTarget{}
	}
	type cpuFallbackRow struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Model        string `json:"model"`
		CoreCount    int    `json:"coreCount"`
		LogicalCount int    `json:"logicalCount"`
	}
	var rows []cpuFallbackRow
	trimmed := bytes.TrimSpace(output)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []probeDetectedTarget{}
	}
	if json.Unmarshal(trimmed, &rows) != nil {
		var single cpuFallbackRow
		if json.Unmarshal(trimmed, &single) == nil {
			rows = []cpuFallbackRow{single}
		}
	}
	instances := make([]probeDetectedTarget, 0, len(rows))
	for index, row := range rows {
		key := strings.TrimSpace(row.ID)
		if key == "" {
			key = fmt.Sprintf("cpu-%d", index)
		} else {
			key = fmt.Sprintf("cpu-%s", detectSanitizeKey(key))
		}
		name := strings.TrimSpace(row.Name)
		if name == "" {
			name = fmt.Sprintf("CPU %d", index+1)
		}
		details := make([]string, 0, 2)
		if row.CoreCount > 0 {
			details = append(details, fmt.Sprintf("%d 核", row.CoreCount))
		}
		if row.LogicalCount > 0 {
			details = append(details, fmt.Sprintf("%d 线程", row.LogicalCount))
		}
		instances = append(instances, probeDetectedTarget{
			ID:       key,
			Name:     name,
			Subtitle: strings.Join(details, " · "),
			Enabled:  isIDEnabled(enabled, explicit, key),
		})
	}
	return instances
}

func enabledIDs(all map[string][]string, key string) (map[string]struct{}, bool) {
	ids := map[string]struct{}{}
	values, ok := all[key]
	if !ok {
		return ids, false
	}
	for _, id := range values {
		trimmed := strings.TrimSpace(id)
		if trimmed != "" {
			ids[trimmed] = struct{}{}
		}
	}
	return ids, true
}

func applyDetectedTargetConfig(targets []probeTargetState, configured map[string][]string) []probeTargetState {
	if len(targets) == 0 {
		return targets
	}

	updated := make([]probeTargetState, len(targets))
	copy(updated, targets)
	for targetIndex := range updated {
		enabled, explicit := enabledIDs(configured, updated[targetIndex].Target)
		instances := make([]probeDetectedTarget, len(updated[targetIndex].Instances))
		copy(instances, updated[targetIndex].Instances)
		for instanceIndex := range instances {
			instances[instanceIndex].Enabled = isIDEnabled(enabled, explicit, instances[instanceIndex].ID)
		}
		updated[targetIndex].Instances = instances
	}
	return updated
}

func isIDEnabled(enabled map[string]struct{}, explicit bool, id string) bool {
	if !explicit {
		return true
	}
	_, ok := enabled[id]
	return ok
}

func detectSanitizeKey(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return "0"
	}
	replacer := strings.NewReplacer(" ", "-", "\\", "-", "/", "-", ":", "-", ".", "-", "_", "-")
	return replacer.Replace(value)
}

func detectGPUAdapters(enabled map[string]struct{}, explicit bool) ([]probeDetectedTarget, error) {
	if runtime.GOOS != "windows" {
		return []probeDetectedTarget{}, nil
	}

	commandText := `$ErrorActionPreference='Stop'; Get-CimInstance Win32_VideoController | Select-Object Name,PNPDeviceID,AdapterCompatibility,VideoProcessor | ConvertTo-Json -Depth 3 -Compress`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", commandText)
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	rows, err := decodeGPUAdapterRows(output)
	if err != nil {
		return nil, err
	}

	results := make([]probeDetectedTarget, 0, len(rows))
	seen := map[string]struct{}{}
	for index, row := range rows {
		name := strings.TrimSpace(row.Name)
		if name == "" {
			name = fmt.Sprintf("GPU %d", index+1)
		}

		// The collector joins LHM hardware to WMI by name and uses the PNP ID
		// when available. Keep detection on the same stable identity.
		keySource := strings.TrimSpace(row.PNPDeviceID)
		if keySource == "" {
			keySource = name
		}
		id := fmt.Sprintf("gpu-%s", detectSanitizeKey(keySource))
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}

		details := make([]string, 0, 2)
		if vendor := strings.TrimSpace(row.AdapterCompatibility); vendor != "" {
			details = append(details, vendor)
		}
		if processor := strings.TrimSpace(row.VideoProcessor); processor != "" && !strings.EqualFold(processor, name) {
			details = append(details, processor)
		}

		results = append(results, probeDetectedTarget{
			ID:       id,
			Name:     name,
			Subtitle: strings.Join(details, " · "),
			Enabled:  isIDEnabled(enabled, explicit, id),
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})
	return results, nil
}

func decodeGPUAdapterRows(raw []byte) ([]gpuAdapterDetectRow, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []gpuAdapterDetectRow{}, nil
	}

	var rows []gpuAdapterDetectRow
	if err := json.Unmarshal(trimmed, &rows); err == nil {
		return rows, nil
	}

	var single gpuAdapterDetectRow
	if err := json.Unmarshal(trimmed, &single); err != nil {
		return nil, err
	}
	return []gpuAdapterDetectRow{single}, nil
}

func (s *server) captureLogs(reader io.Reader) {
	buffer := make([]byte, 2048)
	for {
		count, err := reader.Read(buffer)
		if count > 0 {
			line := strings.TrimSpace(string(buffer[:count]))
			if line != "" {
				s.mu.Lock()
				line = redactSensitiveText(line, s.config.Connection.Secret)
				s.logBuffer = line
				if strings.Contains(strings.ToLower(line), "uploaded") {
					s.connectionState = "connected"
					s.lastUploadAt = time.Now().UTC()
					if s.lastIssueCount > 0 {
						s.lastIssueRecoveredAt = time.Now().UTC()
						s.lastIssueCount = 0
					}
				}
				if category, detail, ok := parseCollectorIssue(line); ok {
					if s.lastIssueCategory == category {
						s.lastIssueCount++
					} else {
						s.lastIssueCount = 1
					}
					s.lastIssueCategory = category
					s.lastIssueDetail = detail
					s.lastIssueAt = time.Now().UTC()
					s.lastIssueRecoveredAt = time.Time{}
				}
				if strings.Contains(strings.ToLower(line), "failed") || strings.Contains(strings.ToLower(line), "error") {
					s.connectionState = "error"
				}
				s.mu.Unlock()
			}
		}
		if err != nil {
			return
		}
	}
}

func (s *server) waitChild(cmd *exec.Cmd) {
	err := cmd.Wait()
	s.mu.Lock()
	if s.cmd == cmd {
		s.cmd = nil
	}
	s.lastExitAt = time.Now().UTC()
	s.childStartedAt = time.Time{}
	s.autoRestarting = false

	var exitCode *int
	if err == nil {
		code := 0
		exitCode = &code
		s.lastExitCode = exitCode
		s.appendDiagnosticLocked("collector exited normally")
		if s.stopRequested {
			s.connectionState = "stopped"
			s.stopRequested = false
			s.mu.Unlock()
			return
		}
		if s.config.AutoRestartCollector {
			delay := nextRestartDelay(s.restartCount)
			s.connectionState = "restart-wait"
			s.autoRestarting = true
			s.logBuffer = fmt.Sprintf("agent exited normally and will restart in %s", delay)
			s.appendDiagnosticLocked("collector exit scheduled for auto restart after %s", delay)
			s.mu.Unlock()
			go s.restartChildAfter(delay)
			return
		}
		s.connectionState = "stopped"
		s.mu.Unlock()
		return
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ProcessState != nil {
		if status, ok := exitErr.ProcessState.Sys().(syscall.WaitStatus); ok {
			code := status.ExitStatus()
			exitCode = &code
			s.logBuffer = fmt.Sprintf("agent exited with code %d", code)
			s.appendDiagnosticLocked("collector exited with code %d", code)
		}
	}
	s.lastExitCode = exitCode
	if s.stopRequested {
		s.connectionState = "stopped"
		s.stopRequested = false
		s.mu.Unlock()
		return
	}
	if s.config.AutoRestartCollector {
		delay := nextRestartDelay(s.restartCount)
		s.connectionState = "restart-wait"
		s.autoRestarting = true
		if exitCode != nil {
			s.logBuffer = fmt.Sprintf("agent exited with code %d, retrying in %s", *exitCode, delay)
			s.appendDiagnosticLocked("collector auto restart scheduled after %s because exitCode=%d", delay, *exitCode)
		} else {
			s.logBuffer = fmt.Sprintf("agent exited unexpectedly, retrying in %s", delay)
			s.appendDiagnosticLocked("collector auto restart scheduled after %s due to unexpected exit", delay)
		}
		s.mu.Unlock()
		go s.restartChildAfter(delay)
		return
	}
	s.connectionState = "error"
	s.mu.Unlock()
}

func (s *server) stopCollectorLocked(reason string) {
	if s.cmd == nil || s.cmd.Process == nil {
		s.connectionState = "stopped"
		s.stopRequested = true
		s.autoRestarting = false
		s.appendDiagnosticLocked("%s requested while collector already stopped", reason)
		return
	}

	cmd := s.cmd
	s.stopRequested = true
	s.autoRestarting = false
	s.connectionState = "stopping"
	s.appendDiagnosticLocked("%s requested for collector pid=%d", reason, cmd.Process.Pid)

	s.mu.Unlock()
	_ = cmd.Process.Signal(os.Interrupt)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && cmd.ProcessState == nil {
		time.Sleep(100 * time.Millisecond)
	}
	if cmd.ProcessState == nil {
		_ = cmd.Process.Kill()
	}
	s.mu.Lock()

	if s.cmd == cmd {
		s.cmd = nil
	}
	s.connectionState = "stopped"
}

func (s *server) scheduleShutdown(reason string, delay time.Duration) {
	go func() {
		if delay > 0 {
			time.Sleep(delay)
		}
		s.requestShutdown(reason)
	}()
}

func (s *server) requestShutdown(reason string) {
	s.shutdownOnce.Do(func() {
		s.mu.Lock()
		s.stopCollectorLocked(reason)
		s.appendDiagnosticLocked("%s", reason)
		httpServer := s.httpServer
		s.mu.Unlock()

		if httpServer == nil {
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(ctx)
	})
}

func (s *server) watchFrontendParent(parentPID int, watcher parentProcessWatcher) {
	defer func() {
		_ = watcher.Close()
	}()

	if err := watcher.Wait(); err != nil {
		s.appendDiagnostic("frontend parent wait failed for pid=%d: %v", parentPID, err)
		return
	}

	s.mu.Lock()
	currentParentPID := s.frontendParentPID
	s.mu.Unlock()
	if currentParentPID != parentPID {
		s.appendDiagnostic("frontend parent process exited but watch is stale; watched=%d current=%d", parentPID, currentParentPID)
		return
	}

	s.requestShutdown(fmt.Sprintf("frontend parent process exited; pid=%d", parentPID))
}

func (s *server) attachFrontendParent(parentPID int, source string) error {
	watcher, err := newParentProcessWatcher(parentPID)
	if err != nil {
		return err
	}

	s.mu.Lock()
	previousPID := s.frontendParentPID
	if previousPID == parentPID {
		s.mu.Unlock()
		_ = watcher.Close()
		return nil
	}

	s.frontendParentPID = parentPID
	s.appendDiagnosticLocked("frontend parent watch attached; source=%s previousPid=%d currentPid=%d", source, previousPID, parentPID)
	s.mu.Unlock()

	go s.watchFrontendParent(parentPID, watcher)
	return nil
}

func (s *server) startChildLocked(isRestart bool) error {
	if !s.config.DataRecordingEnabled {
		return errors.New("data_recording_disabled")
	}
	if err := validateServerTransport(s.config.Connection.ServerURL); err != nil {
		return fmt.Errorf("insecure_server_transport: %w", err)
	}
	if _, err := os.Stat(s.childBinaryPath); err != nil {
		return errors.New("child_agent_binary_missing")
	}

	cmd := exec.Command(s.childBinaryPath)
	cmd.Dir = filepath.Dir(s.childBinaryPath)
	cmd.Env = append(os.Environ(), fmt.Sprintf("DSC_AGENT_CONFIG_FILE=%s", s.configPath))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	if s.childJob != nil {
		if err := s.childJob.Assign(cmd.Process.Pid); err != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			return fmt.Errorf("attach collector to child job: %w", err)
		}
	}

	s.cmd = cmd
	s.childStartedAt = time.Now().UTC()
	s.connectionState = "starting"
	s.autoRestarting = false
	s.stopRequested = false
	if isRestart {
		s.restartCount++
		s.lastRestartAt = s.childStartedAt
		s.appendDiagnosticLocked("collector restarted pid=%d count=%d", cmd.Process.Pid, s.restartCount)
	} else {
		s.appendDiagnosticLocked("collector started pid=%d", cmd.Process.Pid)
	}
	go s.captureLogs(stdout)
	go s.captureLogs(stderr)
	go s.waitChild(cmd)
	return nil
}

func (s *server) restartChildAfter(delay time.Duration) {
	time.Sleep(delay)

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopRequested || !s.config.AutoRestartCollector {
		s.autoRestarting = false
		if s.cmd == nil {
			s.connectionState = "stopped"
		}
		s.appendDiagnosticLocked("auto restart canceled; stopRequested=%t enabled=%t", s.stopRequested, s.config.AutoRestartCollector)
		return
	}
	if s.cmd != nil && s.cmd.Process != nil {
		s.autoRestarting = false
		s.appendDiagnosticLocked("auto restart skipped because collector is already running")
		return
	}
	if err := s.startChildLocked(true); err != nil {
		s.autoRestarting = false
		s.connectionState = "error"
		s.logBuffer = fmt.Sprintf("auto restart failed: %v", err)
		s.appendDiagnosticLocked("auto restart failed: %v", err)
	}
}

func nextRestartDelay(restartCount int) time.Duration {
	delay := restartBackoffBase
	if restartCount > 0 {
		delay = delay * time.Duration(1<<min(restartCount, 4))
	}
	if delay > restartBackoffMax {
		return restartBackoffMax
	}
	return delay
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}

func formatTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Format(time.RFC3339)
}

func (s *server) appendDiagnostic(format string, values ...any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.appendDiagnosticLocked(format, values...)
}

func (s *server) appendDiagnosticLocked(format string, values ...any) {
	if strings.TrimSpace(s.diagnosticsPath) == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.diagnosticsPath), 0o700); err != nil {
		return
	}
	_ = os.Chmod(filepath.Dir(s.diagnosticsPath), 0o700)
	line := fmt.Sprintf("%s %s\n", time.Now().UTC().Format(time.RFC3339), redactSensitiveText(fmt.Sprintf(format, values...), s.config.Connection.Secret))
	file, err := os.OpenFile(s.diagnosticsPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	_ = file.Chmod(0o600)
	_, _ = file.WriteString(line)
}

func redactSensitiveText(value, secret string) string {
	value = strings.TrimSpace(value)
	if secret = strings.TrimSpace(secret); secret != "" {
		value = strings.ReplaceAll(value, secret, "[redacted]")
	}
	if len(value) > 2000 {
		return value[:2000] + "…"
	}
	return value
}

func parseCollectorIssue(line string) (string, string, bool) {
	line = strings.TrimSpace(line)
	if !strings.Contains(line, "[dsc:error]") {
		return "", "", false
	}

	category := "unknown"
	if start := strings.Index(line, "[category="); start >= 0 {
		start += len("[category=")
		if end := strings.Index(line[start:], "]"); end >= 0 {
			category = strings.TrimSpace(line[start : start+end])
		}
	}

	detail := line
	if marker := strings.Index(line, "] "); marker >= 0 && marker+2 < len(line) {
		detail = strings.TrimSpace(line[marker+2:])
	}
	return category, detail, true
}

func normalizeLocalConfig(cfg agentLocalConfig, raw []byte) agentLocalConfig {
	defaults := defaultLocalConfig()
	metricsConfigured := bytes.Contains(raw, []byte(`"enabledMetrics"`))

	if cfg.ConfigVersion <= 0 {
		cfg.ConfigVersion = currentConfigVersion
	}

	if strings.TrimSpace(cfg.Connection.ServerURL) == "" {
		cfg.Connection.ServerURL = defaults.Connection.ServerURL
	}
	if strings.TrimSpace(cfg.Connection.DeviceID) == "" {
		cfg.Connection.DeviceID = defaults.Connection.DeviceID
	}
	if strings.TrimSpace(cfg.Connection.Hostname) == "" {
		cfg.Connection.Hostname = defaults.Connection.Hostname
	}

	if cfg.Sampling.NormalIntervalSeconds <= 0 || cfg.Sampling.NormalIntervalSeconds > maxSamplingIntervalSeconds {
		cfg.Sampling.NormalIntervalSeconds = defaults.Sampling.NormalIntervalSeconds
	}
	if cfg.Sampling.SlowIntervalSeconds <= 0 || cfg.Sampling.SlowIntervalSeconds > maxSamplingIntervalSeconds {
		cfg.Sampling.SlowIntervalSeconds = defaults.Sampling.SlowIntervalSeconds
	}
	if len(cfg.ProbeSelections) == 0 {
		cfg.ProbeSelections = append([]agentProbeSelection(nil), defaults.ProbeSelections...)
	}
	if !metricsConfigured && len(cfg.EnabledMetrics) == 0 {
		cfg.EnabledMetrics = append([]string(nil), defaults.EnabledMetrics...)
	}
	cfg.EnabledMetrics = normalizeMetricKeys(cfg.EnabledMetrics)
	if !(metricsConfigured && len(cfg.EnabledMetrics) == 0) {
		if isProbeSelectionEnabled(cfg.ProbeSelections, "gpu") && !containsMetricPrefix(cfg.EnabledMetrics, "gpu") {
			cfg.EnabledMetrics = append(cfg.EnabledMetrics,
				"gpuUsage",
				"gpuEncode",
				"gpuDecode",
				"gpuFrequency",
				"gpuMemory",
				"gpuTemperature",
				"gpuDriverInfo",
			)
		}
		if isProbeSelectionEnabled(cfg.ProbeSelections, "cpu") && containsMetricPrefix(cfg.EnabledMetrics, "cpu") {
			cfg.EnabledMetrics = appendMissingMetricKeys(cfg.EnabledMetrics, []string{"cpuTopology", "systemOverview"})
		}
		if isProbeSelectionEnabled(cfg.ProbeSelections, "memory") && containsMetricPrefix(cfg.EnabledMetrics, "memory") {
			cfg.EnabledMetrics = appendMissingMetricKeys(cfg.EnabledMetrics, []string{"memoryAvailable", "memoryCached", "memoryCommitted", "memoryHardware"})
		}
		if isProbeSelectionEnabled(cfg.ProbeSelections, "disk") && containsMetricPrefix(cfg.EnabledMetrics, "disk") {
			cfg.EnabledMetrics = appendMissingMetricKeys(cfg.EnabledMetrics, []string{"diskMetadata", "diskActivity", "diskHealth"})
		}
		if isProbeSelectionEnabled(cfg.ProbeSelections, "network") && containsMetricPrefix(cfg.EnabledMetrics, "network") {
			cfg.EnabledMetrics = appendMissingMetricKeys(cfg.EnabledMetrics, []string{"networkIdentity"})
		}
		if isProbeSelectionEnabled(cfg.ProbeSelections, "fan") {
			cfg.EnabledMetrics = appendMissingMetricKeys(cfg.EnabledMetrics, []string{"fanRpm", "fanControl", "fanTargetTemperature", "fanPwm", "fanChannelState", "fanNote"})
		}
	}
	if cfg.EnabledDeviceIDs == nil {
		cfg.EnabledDeviceIDs = map[string][]string{}
	}
	if cfg.InstanceMetricConfig == nil {
		cfg.InstanceMetricConfig = map[string][]string{}
	}
	if len(raw) == 0 || !bytes.Contains(raw, []byte(`"cloudSyncEnabled"`)) {
		cfg.CloudSyncEnabled = defaults.CloudSyncEnabled
	}
	if len(raw) == 0 || !bytes.Contains(raw, []byte(`"dataRecordingEnabled"`)) {
		cfg.DataRecordingEnabled = defaults.DataRecordingEnabled
	}
	if len(raw) == 0 || !bytes.Contains(raw, []byte(`"autoRestartCollector"`)) {
		cfg.AutoRestartCollector = defaults.AutoRestartCollector
	}

	cfg.Connection.ServerURL = strings.TrimSpace(cfg.Connection.ServerURL)
	cfg.Connection.Secret = strings.TrimSpace(cfg.Connection.Secret)
	cfg.Connection.DeviceID = strings.TrimSpace(cfg.Connection.DeviceID)
	cfg.Connection.Hostname = strings.TrimSpace(cfg.Connection.Hostname)
	cfg.EnabledMetrics = normalizeMetricKeys(cfg.EnabledMetrics)
	cfg.EnabledDeviceIDs = normalizeStringMap(cfg.EnabledDeviceIDs)
	cfg.InstanceMetricConfig = normalizeStringMap(cfg.InstanceMetricConfig)
	cfg.ProbeSelections = normalizeProbeSelections(cfg.ProbeSelections, defaults.ProbeSelections)
	return cfg
}

func isProbeSelectionEnabled(selections []agentProbeSelection, target string) bool {
	for _, selection := range selections {
		if strings.EqualFold(strings.TrimSpace(selection.Target), target) {
			return selection.Enabled && !strings.EqualFold(strings.TrimSpace(selection.Provider), "disabled")
		}
	}
	return false
}

func containsMetricPrefix(metrics []string, prefix string) bool {
	for _, metric := range metrics {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(metric)), strings.ToLower(prefix)) {
			return true
		}
	}
	return false
}

func appendMissingMetricKeys(metrics []string, keys []string) []string {
	existing := make(map[string]struct{}, len(metrics)+len(keys))
	for _, metric := range metrics {
		existing[strings.TrimSpace(metric)] = struct{}{}
	}
	for _, key := range keys {
		if _, found := existing[key]; found {
			continue
		}
		metrics = append(metrics, key)
		existing[key] = struct{}{}
	}
	return metrics
}

func displayConfigChanged(previous agentLocalConfig, next agentLocalConfig) bool {
	previousPayload, err := json.Marshal(agentCloudConfigSyncPayload{
		DeviceID:             strings.TrimSpace(previous.Connection.DeviceID),
		EnabledMetrics:       uniqueTrimmedStrings(previous.EnabledMetrics),
		EnabledDeviceIDs:     normalizeStringMap(previous.EnabledDeviceIDs),
		InstanceMetricConfig: normalizeStringMap(previous.InstanceMetricConfig),
	})
	if err != nil {
		return true
	}

	nextPayload, err := json.Marshal(agentCloudConfigSyncPayload{
		DeviceID:             strings.TrimSpace(next.Connection.DeviceID),
		EnabledMetrics:       uniqueTrimmedStrings(next.EnabledMetrics),
		EnabledDeviceIDs:     normalizeStringMap(next.EnabledDeviceIDs),
		InstanceMetricConfig: normalizeStringMap(next.InstanceMetricConfig),
	})
	if err != nil {
		return true
	}

	return !bytes.Equal(previousPayload, nextPayload)
}

func cloneIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func uniqueTrimmedStrings(items []string) []string {
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

func normalizeStringMap(values map[string][]string) map[string][]string {
	result := make(map[string][]string, len(values))
	for key, items := range values {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		result[trimmedKey] = uniqueTrimmedStrings(items)
	}
	return result
}

func normalizeProbeSelections(selections []agentProbeSelection, defaults []agentProbeSelection) []agentProbeSelection {
	defaultByTarget := map[string]agentProbeSelection{}
	supportedByTarget := map[string]map[string]bool{}
	for _, plan := range supportedProbePlans() {
		providers := map[string]bool{}
		for _, provider := range plan.Providers {
			providers[provider] = true
		}
		supportedByTarget[plan.Target] = providers
	}
	for _, item := range defaults {
		defaultByTarget[item.Target] = item
	}

	result := make([]agentProbeSelection, 0, len(selections))
	seen := map[string]struct{}{}
	for _, item := range selections {
		target := strings.ToLower(strings.TrimSpace(item.Target))
		if target == "" {
			continue
		}
		providers, supported := supportedByTarget[target]
		if !supported {
			continue
		}
		if _, exists := seen[target]; exists {
			continue
		}
		seen[target] = struct{}{}

		provider := strings.TrimSpace(item.Provider)
		if provider == "" || !providers[provider] {
			provider = defaultByTarget[target].Provider
		}
		if provider == "" {
			provider = "disabled"
		}

		result = append(result, agentProbeSelection{
			Target:   target,
			Provider: provider,
			Enabled:  item.Enabled,
		})
	}

	for _, item := range defaults {
		if _, exists := seen[item.Target]; exists {
			continue
		}
		result = append(result, item)
	}

	return result
}

func normalizeMetricKeys(items []string) []string {
	known := make(map[string]bool, len(allMetricKeys))
	for _, key := range allMetricKeys {
		known[key] = true
	}
	result := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		key := strings.TrimSpace(item)
		if key == "" || !known[key] || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, key)
	}
	return result
}

func trimUTF8BOM(raw []byte) []byte {
	return bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
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
	return parsed.IsPrivate() || parsed.IsLinkLocalUnicast()
}
