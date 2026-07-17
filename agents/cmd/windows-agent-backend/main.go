package main

import (
	"bufio"
	"bytes"
	"context"
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

type agentConnectionConfig struct {
	ServerURL string `json:"serverUrl"`
	Secret    string `json:"secret"`
	DeviceID  string `json:"deviceId"`
	Hostname  string `json:"hostname"`
}

type agentSamplingConfig struct {
	NormalIntervalSeconds     int    `json:"normalIntervalSeconds"`
	FastIntervalSeconds       int    `json:"fastIntervalSeconds"`
	SlowIntervalSeconds       int    `json:"slowIntervalSeconds"`
	ViewerRealtimeHoldSeconds int    `json:"viewerRealtimeHoldSeconds"`
	RealtimeModeEnabled       bool   `json:"realtimeModeEnabled"`
	RealtimeModeExpiresAt     string `json:"realtimeModeExpiresAt,omitempty"`
	RealtimeModeSource        string `json:"realtimeModeSource,omitempty"`
}

type agentProbeSelection struct {
	Target   string `json:"target"`
	Provider string `json:"provider"`
	Enabled  bool   `json:"enabled"`
}

type agentLocalConfig struct {
	Connection           agentConnectionConfig `json:"connection"`
	Sampling             agentSamplingConfig   `json:"sampling"`
	EnabledMetrics       []string              `json:"enabledMetrics"`
	EnabledDeviceIDs     map[string][]string   `json:"enabledDeviceIds"`
	InstanceMetricConfig map[string][]string   `json:"instanceMetricConfig"`
	ProbeSelections      []agentProbeSelection `json:"probeSelections"`
	CloudSyncEnabled     bool                  `json:"cloudSyncEnabled"`
	DataRecordingEnabled bool                  `json:"dataRecordingEnabled"`
	AutoRestartCollector bool                  `json:"autoRestartCollector"`
	AutoStartCollector   bool                  `json:"autoStartCollector"`
}

type agentCloudConfigSyncPayload struct {
	DeviceID             string              `json:"deviceId"`
	EnabledMetrics       []string            `json:"enabledMetrics"`
	EnabledDeviceIDs     map[string][]string `json:"enabledDeviceIds,omitempty"`
	InstanceMetricConfig map[string][]string `json:"instanceMetricConfig,omitempty"`
}

type backendState struct {
	Running                           bool               `json:"running"`
	BackendStartedAt                  string             `json:"backendStartedAt"`
	FrontendParentPID                 int                `json:"frontendParentPid"`
	ChildStartedAt                    string             `json:"childStartedAt,omitempty"`
	ConnectionStatus                  string             `json:"connectionStatus"`
	ControlStreamConnected            bool               `json:"controlStreamConnected"`
	ControlStreamReconnectCount       int                `json:"controlStreamReconnectCount"`
	LastControlStreamEventAt          string             `json:"lastControlStreamEventAt,omitempty"`
	LastControlStreamSnapshotAt       string             `json:"lastControlStreamSnapshotAt,omitempty"`
	LastControlStreamChangeAt         string             `json:"lastControlStreamChangeAt,omitempty"`
	LastControlStreamSnapshotKind     string             `json:"lastControlStreamSnapshotKind,omitempty"`
	LastControlStreamSnapshotSource   string             `json:"lastControlStreamSnapshotSource,omitempty"`
	LastControlStreamDisconnectAt     string             `json:"lastControlStreamDisconnectAt,omitempty"`
	LastControlStreamReconnectAt      string             `json:"lastControlStreamReconnectAt,omitempty"`
	LastControlStreamError            string             `json:"lastControlStreamError,omitempty"`
	ViewerRealtimePhase               string             `json:"viewerRealtimePhase,omitempty"`
	LastViewerRealtimeEnabled         bool               `json:"lastViewerRealtimeEnabled"`
	LastViewerRealtimeViewerCount     int                `json:"lastViewerRealtimeViewerCount"`
	LastViewerRealtimeDurationSeconds int                `json:"lastViewerRealtimeDurationSeconds"`
	LastViewerRealtimeExpiresAt       string             `json:"lastViewerRealtimeExpiresAt,omitempty"`
	LastChildLog                      string             `json:"lastChildLog,omitempty"`
	LastUploadAt                      string             `json:"lastUploadAt,omitempty"`
	LastCloudSyncAt                   string             `json:"lastCloudSyncAt,omitempty"`
	LastCloudSyncError                string             `json:"lastCloudSyncError,omitempty"`
	CloudConfigPending                bool               `json:"cloudConfigPending"`
	LastDetectAt                      string             `json:"lastDetectAt,omitempty"`
	LastExitAt                        string             `json:"lastExitAt,omitempty"`
	LastRestartAt                     string             `json:"lastRestartAt,omitempty"`
	RestartCount                      int                `json:"restartCount"`
	LastExitCode                      *int               `json:"lastExitCode,omitempty"`
	AutoRestartPending                bool               `json:"autoRestartPending"`
	RealtimeModeEnabled               bool               `json:"realtimeModeEnabled"`
	RealtimeModeExpiresAt             string             `json:"realtimeModeExpiresAt,omitempty"`
	RealtimeModeSource                string             `json:"realtimeModeSource,omitempty"`
	EffectiveUploadIntervalSeconds    int                `json:"effectiveUploadIntervalSeconds"`
	LastIssueCategory                 string             `json:"lastIssueCategory,omitempty"`
	LastIssueDetail                   string             `json:"lastIssueDetail,omitempty"`
	LastIssueAt                       string             `json:"lastIssueAt,omitempty"`
	LastIssueCount                    int                `json:"lastIssueCount"`
	LastIssueRecoveredAt              string             `json:"lastIssueRecoveredAt,omitempty"`
	ConfigPath                        string             `json:"configPath"`
	ConfigFileExists                  bool               `json:"configFileExists"`
	SyncStatePath                     string             `json:"syncStatePath"`
	SyncStateFileExists               bool               `json:"syncStateFileExists"`
	DiagnosticsPath                   string             `json:"diagnosticsPath"`
	DiagnosticsFileExists             bool               `json:"diagnosticsFileExists"`
	Config                            agentLocalConfig   `json:"config"`
	SupportedProbePlans               []probePlanSupport `json:"supportedProbePlans"`
	DetectedTargets                   []probeTargetState `json:"detectedTargets"`
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

type viewerRealtimeSnapshot struct {
	Enabled         bool   `json:"enabled"`
	ViewerCount     int    `json:"viewerCount"`
	DurationSeconds int    `json:"durationSeconds"`
	ExpiresAt       string `json:"expiresAt"`
}

type agentControlMessage struct {
	Type      string `json:"type"`
	DeviceID  string `json:"deviceId"`
	EmittedAt string `json:"emittedAt"`
	viewerRealtimeSnapshot
}

type server struct {
	mu                         sync.Mutex
	shutdownOnce               sync.Once
	configPath                 string
	syncStatePath              string
	diagnosticsPath            string
	childBinaryPath            string
	childJob                   jobObject
	config                     agentLocalConfig
	cmd                        *exec.Cmd
	requestClient              *http.Client
	streamClient               *http.Client
	httpServer                 *http.Server
	frontendParentPID          int
	logBuffer                  string
	connectionState            string
	childStartedAt             time.Time
	backendStartedAt           time.Time
	lastUploadAt               time.Time
	lastCloudSyncAt            time.Time
	lastCloudSyncErr           string
	cloudConfigDirty           bool
	lastDetectAt               time.Time
	detectedTargets            []probeTargetState
	lastExitAt                 time.Time
	lastRestartAt              time.Time
	restartCount               int
	lastExitCode               *int
	lastIssueCategory          string
	lastIssueDetail            string
	lastIssueAt                time.Time
	lastIssueCount             int
	lastIssueRecoveredAt       time.Time
	stopRequested              bool
	autoRestarting             bool
	controlConnected           bool
	controlReconnectCount      int
	lastControlEventAt         time.Time
	lastControlSnapshotAt      time.Time
	lastControlChangeAt        time.Time
	lastControlDisconnectAt    time.Time
	lastControlReconnectAt     time.Time
	lastControlError           string
	lastControlSnapshotKind    string
	lastControlSnapshotSource  string
	lastViewerRealtimeSnapshot viewerRealtimeSnapshot
	hasViewerRealtimeSnapshot  bool
	controlStreamCancel        context.CancelFunc
}

type cloudSyncStateFile struct {
	CloudConfigDirty bool   `json:"cloudConfigDirty"`
	LastCloudSyncAt  string `json:"lastCloudSyncAt,omitempty"`
	LastCloudSyncErr string `json:"lastCloudSyncError,omitempty"`
}

const (
	restartBackoffBase      = 2 * time.Second
	restartBackoffMax       = 20 * time.Second
	controlStreamHealthTick = 5 * time.Second
	controlStreamStaleAfter = 45 * time.Second
)

func main() {
	listenAddr := flag.String("listen", "127.0.0.1:17891", "local listen address")
	bundleRoot := flag.String("bundle-root", "", "directory containing packaged backend/agent binaries")
	configRoot := flag.String("config-root", "", "directory for local config files")
	parentPID := flag.Int("parent-pid", 0, "frontend process id to watch; backend exits when this process exits")
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

	configPath := filepath.Join(resolvedConfigRoot, "agent-ui.config.json")
	childBinaryPath := filepath.Join(resolvedBundleRoot, "device-state-console-agent.exe")

	s := &server{
		configPath:       configPath,
		syncStatePath:    filepath.Join(resolvedConfigRoot, "agent-ui.sync-state.json"),
		diagnosticsPath:  filepath.Join(resolvedConfigRoot, "agent-ui.backend.log"),
		childBinaryPath:  childBinaryPath,
		requestClient:    &http.Client{Timeout: 10 * time.Second},
		streamClient:     &http.Client{},
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
	mux.HandleFunc("/api/control/attach-frontend", s.handleAttachFrontend)
	mux.HandleFunc("/api/control/realtime", s.handleRealtimeMode)
	mux.HandleFunc("/api/control/check-connection", s.handleConnectionCheck)
	mux.HandleFunc("/api/control/shutdown", s.handleBackendShutdown)
	mux.HandleFunc("/api/cloud/push", s.handleCloudPush)
	mux.HandleFunc("/api/probes/detect", s.handleProbeDetect)

	httpServer := &http.Server{
		Addr:    *listenAddr,
		Handler: mux,
	}
	s.httpServer = httpServer

	log.Printf("windows agent backend v%s listening on http://%s", BuildVersion, *listenAddr)
	go s.realtimeExpiryLoop()
	go s.cloudRealtimeStreamLoop()
	go s.cloudRealtimeLoop()
	go s.controlStreamHealthLoop()
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func defaultLocalConfig() agentLocalConfig {
	return agentLocalConfig{
		Connection: agentConnectionConfig{
			ServerURL: "http://127.0.0.1:3100",
			Secret:    "",
			DeviceID:  "windows-agent",
			Hostname:  "Windows Agent",
		},
		Sampling: agentSamplingConfig{
			NormalIntervalSeconds:     15,
			FastIntervalSeconds:       5,
			SlowIntervalSeconds:       30,
			ViewerRealtimeHoldSeconds: 20,
			RealtimeModeEnabled:       false,
		},
		EnabledMetrics: []string{
			"cpuUsage", "cpuFrequency", "cpuTemperature",
			"memoryUsage", "swapUsage",
			"diskUsage", "diskRead", "diskWrite",
			"networkRxRate", "networkTxRate", "networkTraffic",
		},
		EnabledDeviceIDs:     map[string][]string{},
		InstanceMetricConfig: map[string][]string{},
		ProbeSelections: []agentProbeSelection{
			{Target: "cpu", Provider: "disabled", Enabled: false},
			{Target: "memory", Provider: "disabled", Enabled: false},
			{Target: "disk", Provider: "disabled", Enabled: false},
			{Target: "network", Provider: "disabled", Enabled: false},
			{Target: "gpu", Provider: "disabled", Enabled: false},
			{Target: "fan", Provider: "disabled", Enabled: false},
		},
		CloudSyncEnabled:     true,
		DataRecordingEnabled: true,
		AutoRestartCollector: true,
	}
}

func supportedProbePlans() []probePlanSupport {
	return []probePlanSupport{
		{Target: "connection", Providers: []string{"gopsutil"}, Default: "gopsutil"},
		{Target: "cpu", Providers: []string{"disabled", "gopsutil"}, Default: "disabled"},
		{Target: "memory", Providers: []string{"disabled", "gopsutil"}, Default: "disabled"},
		{Target: "disk", Providers: []string{"disabled", "gopsutil"}, Default: "disabled"},
		{Target: "network", Providers: []string{"disabled", "gopsutil"}, Default: "disabled"},
		{Target: "gpu", Providers: []string{"disabled", "wmi"}, Default: "disabled"},
		{Target: "fan", Providers: []string{"disabled"}, Default: "disabled"},
	}
}

func (s *server) loadConfig() error {
	raw, err := os.ReadFile(s.configPath)
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
	return nil
}

func (s *server) loadSyncState() error {
	raw, err := os.ReadFile(s.syncStatePath)
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

func writeStateFile(path string, raw []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
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
	return backendState{
		Running:                           s.cmd != nil && s.cmd.Process != nil,
		BackendStartedAt:                  s.backendStartedAt.Format(time.RFC3339),
		FrontendParentPID:                 s.frontendParentPID,
		ChildStartedAt:                    formatTime(s.childStartedAt),
		ConnectionStatus:                  s.connectionState,
		ControlStreamConnected:            s.controlConnected,
		ControlStreamReconnectCount:       s.controlReconnectCount,
		LastControlStreamEventAt:          formatTime(s.lastControlEventAt),
		LastControlStreamSnapshotAt:       formatTime(s.lastControlSnapshotAt),
		LastControlStreamChangeAt:         formatTime(s.lastControlChangeAt),
		LastControlStreamSnapshotKind:     s.lastControlSnapshotKind,
		LastControlStreamSnapshotSource:   s.lastControlSnapshotSource,
		LastControlStreamDisconnectAt:     formatTime(s.lastControlDisconnectAt),
		LastControlStreamReconnectAt:      formatTime(s.lastControlReconnectAt),
		LastControlStreamError:            s.lastControlError,
		ViewerRealtimePhase:               resolveViewerRealtimePhase(s),
		LastViewerRealtimeEnabled:         s.lastViewerRealtimeSnapshot.Enabled,
		LastViewerRealtimeViewerCount:     s.lastViewerRealtimeSnapshot.ViewerCount,
		LastViewerRealtimeDurationSeconds: s.lastViewerRealtimeSnapshot.DurationSeconds,
		LastViewerRealtimeExpiresAt:       s.lastViewerRealtimeSnapshot.ExpiresAt,
		LastChildLog:                      s.logBuffer,
		LastUploadAt:                      formatTime(s.lastUploadAt),
		LastCloudSyncAt:                   formatTime(s.lastCloudSyncAt),
		LastCloudSyncError:                s.lastCloudSyncErr,
		CloudConfigPending:                s.cloudConfigDirty,
		LastDetectAt:                      formatTime(s.lastDetectAt),
		LastExitAt:                        formatTime(s.lastExitAt),
		LastRestartAt:                     formatTime(s.lastRestartAt),
		RestartCount:                      s.restartCount,
		LastExitCode:                      cloneIntPointer(s.lastExitCode),
		AutoRestartPending:                s.autoRestarting,
		RealtimeModeEnabled:               s.config.Sampling.RealtimeModeEnabled,
		RealtimeModeExpiresAt:             s.config.Sampling.RealtimeModeExpiresAt,
		RealtimeModeSource:                s.config.Sampling.RealtimeModeSource,
		EffectiveUploadIntervalSeconds:    effectiveUploadIntervalSeconds(s.config.Sampling),
		LastIssueCategory:                 s.lastIssueCategory,
		LastIssueDetail:                   s.lastIssueDetail,
		LastIssueAt:                       formatTime(s.lastIssueAt),
		LastIssueCount:                    s.lastIssueCount,
		LastIssueRecoveredAt:              formatTime(s.lastIssueRecoveredAt),
		ConfigPath:                        s.configPath,
		ConfigFileExists:                  fileExists(s.configPath),
		SyncStatePath:                     s.syncStatePath,
		SyncStateFileExists:               fileExists(s.syncStatePath),
		DiagnosticsPath:                   s.diagnosticsPath,
		DiagnosticsFileExists:             fileExists(s.diagnosticsPath),
		Config:                            s.config,
		SupportedProbePlans:               supportedProbePlans(),
		DetectedTargets:                   append([]probeTargetState(nil), s.detectedTargets...),
	}
}

func (s *server) handleState(writer http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	writeJSON(writer, http.StatusOK, snapshot)
}

func (s *server) handleConfig(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		s.mu.Lock()
		config := s.snapshotLocked().Config
		s.mu.Unlock()
		writeJSON(writer, http.StatusOK, config)
	case http.MethodPut:
		raw, readErr := io.ReadAll(request.Body)
		if readErr != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
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

func (s *server) handleRealtimeMode(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var payload struct {
		Enabled         bool `json:"enabled"`
		DurationSeconds int  `json:"durationSeconds"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}

	var configRaw []byte
	s.mu.Lock()
	s.config.Sampling.RealtimeModeEnabled = payload.Enabled
	s.config.Sampling.RealtimeModeExpiresAt = ""
	s.config.Sampling.RealtimeModeSource = ""
	if payload.Enabled && payload.DurationSeconds > 0 {
		s.config.Sampling.RealtimeModeExpiresAt = time.Now().UTC().Add(time.Duration(payload.DurationSeconds) * time.Second).Format(time.RFC3339)
		s.config.Sampling.RealtimeModeSource = "manual"
	}
	err := error(nil)
	configRaw, err = s.marshalConfigLocked()
	if err == nil {
		if s.config.Sampling.RealtimeModeExpiresAt != "" {
			s.appendDiagnosticLocked(
				"realtime mode changed; enabled=%t effectiveInterval=%ds expiresAt=%s",
				payload.Enabled,
				effectiveUploadIntervalSeconds(s.config.Sampling),
				s.config.Sampling.RealtimeModeExpiresAt,
			)
		} else {
			s.appendDiagnosticLocked("realtime mode changed; enabled=%t effectiveInterval=%ds", payload.Enabled, effectiveUploadIntervalSeconds(s.config.Sampling))
		}
	}
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	if err != nil {
		writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := writeStateFile(s.configPath, configRaw); err != nil {
		writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(writer, http.StatusOK, snapshot)
}

func (s *server) handleAttachFrontend(writer http.ResponseWriter, request *http.Request) {
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
		s.lastCloudSyncErr = err.Error()
		s.cloudConfigDirty = true
		s.appendDiagnosticLocked("cloud push failed: %v", err)
		syncStateRaw, _ = s.marshalSyncStateLocked()
		s.mu.Unlock()
		if len(syncStateRaw) > 0 {
			_ = writeStateFile(s.syncStatePath, syncStateRaw)
		}
		writeJSON(writer, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer response.Body.Close()

	responseBody, _ := io.ReadAll(response.Body)
	var syncStateRaw []byte
	s.mu.Lock()
	s.lastCloudSyncAt = time.Now().UTC()
	if response.StatusCode >= 300 {
		s.lastCloudSyncErr = strings.TrimSpace(string(responseBody))
		s.appendDiagnosticLocked("cloud push returned status=%d body=%s", response.StatusCode, strings.TrimSpace(string(responseBody)))
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
		writeJSON(writer, response.StatusCode, map[string]string{"error": strings.TrimSpace(string(responseBody))})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"ok":       true,
		"response": json.RawMessage(responseBody),
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
	_ = json.NewDecoder(pingResponse.Body).Decode(&pingBody)

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

	result := connectionCheckResult{
		OK:         true,
		Reachable:  true,
		Authorized: true,
		Status:     "authorized",
		Message:    "已成功连接中枢，Agent Secret 校验通过。",
		ServerTime: strings.TrimSpace(pingBody.ServerTime),
	}

	deviceCheckRequest, err := http.NewRequest(
		http.MethodGet,
		strings.TrimRight(serverURL, "/")+"/api/agent/device-realtime?deviceId="+url.QueryEscape(deviceID),
		nil,
	)
	if err != nil {
		return result
	}
	deviceCheckRequest.Header.Set("Authorization", "Bearer "+secret)

	deviceCheckResponse, err := s.requestClient.Do(deviceCheckRequest)
	if err != nil {
		result.Status = "authorized_device_check_failed"
		result.Message = fmt.Sprintf("已连接中枢，但设备状态查询失败：%v", err)
		return result
	}
	defer deviceCheckResponse.Body.Close()

	if deviceCheckResponse.StatusCode == http.StatusNotFound {
		result.Status = "authorized_device_unknown"
		result.Message = "已连接中枢，Agent Secret 校验通过，但这台设备还没有被中枢看到；启动采集器上报后即可出现。"
		return result
	}
	if deviceCheckResponse.StatusCode >= 300 {
		result.Status = "authorized_device_check_error"
		result.Message = fmt.Sprintf("已连接中枢，但设备状态查询返回：%s", deviceCheckResponse.Status)
		return result
	}

	result.DeviceKnown = true
	result.Status = "authorized_device_known"
	result.Message = "已连接中枢，Agent Secret 校验通过，且这台设备已经被中枢识别。"
	return result
}

func (s *server) handleProbeDetect(writer http.ResponseWriter, request *http.Request) {
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
	decorateDetectedMetrics(detected)

	s.mu.Lock()
	s.detectedTargets = detected
	s.lastDetectAt = time.Now().UTC()
	s.appendDiagnosticLocked("probe detect succeeded; targets=%d", len(detected))
	s.mu.Unlock()

	writeJSON(writer, http.StatusOK, map[string]any{
		"ok":              true,
		"providers":       supportedProbePlans(),
		"detectedTargets": detected,
	})
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
		return []string{"使用率", "频率", "温度", "逻辑核心数", "物理核心数"}
	case "disk":
		return []string{"已用空间", "总空间", "可用空间", "使用率", "读取速率", "写入速率", "文件系统", "挂载点"}
	case "network":
		return []string{"接收速率", "发送速率", "累计接收", "累计发送", "MAC 地址", "IP 地址"}
	case "gpu":
		return []string{"使用率", "显存已用", "显存总量", "显存使用率", "驱动与适配器信息"}
	default:
		return []string{"状态"}
	}
}

func detectTargets(cfg agentLocalConfig) ([]probeTargetState, error) {
	targets := make([]probeTargetState, 0, 4)

	cpuInfo, err := cpu.InfoWithContext(context.Background())
	if err != nil {
		return nil, err
	}
	logicalCount, _ := cpu.CountsWithContext(context.Background(), true)
	physicalCount, _ := cpu.CountsWithContext(context.Background(), false)
	cpuEnabled, cpuExplicit := enabledIDs(cfg.EnabledDeviceIDs, "cpu")
	cpuInstances := detectCPUPackages(cpuInfo, logicalCount, physicalCount, cpuEnabled, cpuExplicit)
	targets = append(targets, probeTargetState{
		Target:    "cpu",
		Label:     "CPU 实例",
		Instances: cpuInstances,
	})

	partitions, err := disk.Partitions(false)
	if err != nil {
		return nil, err
	}
	diskEnabled, diskExplicit := enabledIDs(cfg.EnabledDeviceIDs, "disk")
	diskInstances := make([]probeDetectedTarget, 0, len(partitions))
	for _, partition := range partitions {
		mountPoint := strings.TrimSpace(partition.Mountpoint)
		deviceName := strings.TrimSpace(partition.Device)
		if deviceName == "" {
			deviceName = mountPoint
		}
		if deviceName == "" || mountPoint == "" {
			continue
		}
		id := fmt.Sprintf("%s:%s", deviceName, mountPoint)
		name := deviceName
		subtitle := mountPoint
		if partition.Fstype != "" {
			if subtitle != "" {
				subtitle += " · "
			}
			subtitle += partition.Fstype
		}
		diskInstances = append(diskInstances, probeDetectedTarget{
			ID:       id,
			Name:     name,
			Subtitle: subtitle,
			Enabled:  isIDEnabled(diskEnabled, diskExplicit, id),
		})
	}
	targets = append(targets, probeTargetState{
		Target:    "disk",
		Label:     "磁盘实例",
		Instances: diskInstances,
	})

	interfaces, err := gnet.Interfaces()
	if err != nil {
		return nil, err
	}
	networkEnabled, networkExplicit := enabledIDs(cfg.EnabledDeviceIDs, "network")
	networkInstances := make([]probeDetectedTarget, 0, len(interfaces))
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
	targets = append(targets, probeTargetState{
		Target:    "network",
		Label:     "网卡实例",
		Instances: networkInstances,
	})

	gpuEnabled, gpuExplicit := enabledIDs(cfg.EnabledDeviceIDs, "gpu")
	gpuInstances, err := detectGPUAdapters(gpuEnabled, gpuExplicit)
	if err != nil {
		return nil, err
	}
	targets = append(targets, probeTargetState{
		Target:    "gpu",
		Label:     "显卡实例",
		Instances: gpuInstances,
	})

	return targets, nil
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
	time.Sleep(500 * time.Millisecond)
	_ = cmd.Process.Kill()
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
	if err := os.MkdirAll(filepath.Dir(s.diagnosticsPath), 0o755); err != nil {
		return
	}
	line := fmt.Sprintf("%s %s\n", time.Now().UTC().Format(time.RFC3339), fmt.Sprintf(format, values...))
	file, err := os.OpenFile(s.diagnosticsPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.WriteString(line)
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

	if strings.TrimSpace(cfg.Connection.ServerURL) == "" {
		cfg.Connection.ServerURL = defaults.Connection.ServerURL
	}
	if strings.TrimSpace(cfg.Connection.DeviceID) == "" {
		cfg.Connection.DeviceID = defaults.Connection.DeviceID
	}
	if strings.TrimSpace(cfg.Connection.Hostname) == "" {
		cfg.Connection.Hostname = defaults.Connection.Hostname
	}

	if cfg.Sampling.FastIntervalSeconds <= 0 {
		cfg.Sampling.FastIntervalSeconds = defaults.Sampling.FastIntervalSeconds
	}
	if cfg.Sampling.NormalIntervalSeconds <= 0 {
		cfg.Sampling.NormalIntervalSeconds = defaults.Sampling.NormalIntervalSeconds
	}
	if cfg.Sampling.SlowIntervalSeconds <= 0 {
		cfg.Sampling.SlowIntervalSeconds = defaults.Sampling.SlowIntervalSeconds
	}
	if cfg.Sampling.ViewerRealtimeHoldSeconds <= 0 {
		cfg.Sampling.ViewerRealtimeHoldSeconds = defaults.Sampling.ViewerRealtimeHoldSeconds
	}
	if cfg.Sampling.RealtimeModeExpiresAt != "" {
		expiresAt, err := time.Parse(time.RFC3339, strings.TrimSpace(cfg.Sampling.RealtimeModeExpiresAt))
		if err != nil {
			cfg.Sampling.RealtimeModeExpiresAt = ""
		} else {
			cfg.Sampling.RealtimeModeExpiresAt = expiresAt.UTC().Format(time.RFC3339)
			if !expiresAt.After(time.Now().UTC()) {
				cfg.Sampling.RealtimeModeEnabled = false
				cfg.Sampling.RealtimeModeExpiresAt = ""
			}
		}
	}
	if cfg.Sampling.RealtimeModeSource != "manual" && cfg.Sampling.RealtimeModeSource != "viewer" {
		cfg.Sampling.RealtimeModeSource = ""
	}

	if len(cfg.EnabledMetrics) == 0 {
		cfg.EnabledMetrics = append([]string(nil), defaults.EnabledMetrics...)
	}
	if cfg.EnabledDeviceIDs == nil {
		cfg.EnabledDeviceIDs = map[string][]string{}
	}
	if cfg.InstanceMetricConfig == nil {
		cfg.InstanceMetricConfig = map[string][]string{}
	}
	if len(cfg.ProbeSelections) == 0 {
		cfg.ProbeSelections = append([]agentProbeSelection(nil), defaults.ProbeSelections...)
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
	cfg.EnabledMetrics = uniqueTrimmedStrings(cfg.EnabledMetrics)
	cfg.EnabledDeviceIDs = normalizeStringMap(cfg.EnabledDeviceIDs)
	cfg.InstanceMetricConfig = normalizeStringMap(cfg.InstanceMetricConfig)
	cfg.ProbeSelections = normalizeProbeSelections(cfg.ProbeSelections, defaults.ProbeSelections)
	return cfg
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
	for _, item := range defaults {
		defaultByTarget[item.Target] = item
	}

	result := make([]agentProbeSelection, 0, len(selections))
	seen := map[string]struct{}{}
	for _, item := range selections {
		target := strings.TrimSpace(item.Target)
		if target == "" {
			continue
		}
		if _, exists := seen[target]; exists {
			continue
		}
		seen[target] = struct{}{}

		provider := strings.TrimSpace(item.Provider)
		if provider == "" {
			provider = defaultByTarget[target].Provider
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

func trimUTF8BOM(raw []byte) []byte {
	return bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func effectiveUploadIntervalSeconds(sampling agentSamplingConfig) int {
	if sampling.RealtimeModeEnabled {
		if sampling.FastIntervalSeconds > 0 {
			return sampling.FastIntervalSeconds
		}
		return 5
	}
	if sampling.NormalIntervalSeconds > 0 {
		return sampling.NormalIntervalSeconds
	}
	if sampling.FastIntervalSeconds > 0 {
		return sampling.FastIntervalSeconds
	}
	return 15
}

func (s *server) realtimeExpiryLoop() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		s.mu.Lock()
		expiresAt := strings.TrimSpace(s.config.Sampling.RealtimeModeExpiresAt)
		if !s.config.Sampling.RealtimeModeEnabled || expiresAt == "" {
			s.mu.Unlock()
			continue
		}

		expiresAtTime, err := time.Parse(time.RFC3339, expiresAt)
		if err != nil {
			s.config.Sampling.RealtimeModeExpiresAt = ""
			_ = s.saveConfigLocked()
			s.appendDiagnosticLocked("realtime mode expiry cleared because the stored timestamp was invalid")
			s.mu.Unlock()
			continue
		}
		if time.Now().UTC().Before(expiresAtTime) {
			s.mu.Unlock()
			continue
		}

		s.config.Sampling.RealtimeModeEnabled = false
		s.config.Sampling.RealtimeModeExpiresAt = ""
		s.config.Sampling.RealtimeModeSource = ""
		if err := s.saveConfigLocked(); err != nil {
			s.appendDiagnosticLocked("realtime mode expiry save failed: %v", err)
			s.mu.Unlock()
			continue
		}
		s.appendDiagnosticLocked("realtime mode expired and returned to normal upload interval")
		s.mu.Unlock()
	}
}

func (s *server) cloudRealtimeLoop() {
	s.syncCloudRealtime()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		s.mu.Lock()
		connected := s.controlConnected
		s.mu.Unlock()
		if connected {
			continue
		}
		s.syncCloudRealtime()
	}
}

func (s *server) syncCloudRealtime() {
	s.mu.Lock()
	cfg := s.config
	s.mu.Unlock()

	serverURL := strings.TrimSpace(cfg.Connection.ServerURL)
	secret := strings.TrimSpace(cfg.Connection.Secret)
	deviceID := strings.TrimSpace(cfg.Connection.DeviceID)
	if serverURL == "" || secret == "" || deviceID == "" {
		return
	}

	request, err := http.NewRequest(
		http.MethodGet,
		strings.TrimRight(serverURL, "/")+"/api/agent/device-realtime?deviceId="+url.QueryEscape(deviceID),
		nil,
	)
	if err != nil {
		return
	}
	request.Header.Set("Authorization", "Bearer "+secret)

	response, err := s.requestClient.Do(request)
	if err != nil {
		return
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		return
	}

	var payload viewerRealtimeSnapshot
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.applyViewerRealtimeSnapshotLocked(payload, "poll")
}

func (s *server) cloudRealtimeStreamLoop() {
	reconnectDelay := 2 * time.Second

	for {
		serverURL, secret, deviceID, ok := s.currentAgentControlConfig()
		if !ok {
			s.setControlDisconnected("missing_connection_config")
			time.Sleep(2 * time.Second)
			continue
		}

		endpoint, err := buildAgentControlStreamURL(serverURL, deviceID)
		if err != nil {
			s.setControlDisconnected(fmt.Sprintf("build_control_stream_url_failed: %v", err))
			time.Sleep(reconnectDelay)
			continue
		}

		requestContext, cancel := context.WithCancel(context.Background())
		request, err := http.NewRequestWithContext(requestContext, http.MethodGet, endpoint, nil)
		if err != nil {
			cancel()
			s.setControlDisconnected(fmt.Sprintf("build_control_stream_request_failed: %v", err))
			time.Sleep(reconnectDelay)
			continue
		}
		request.Header.Set("Authorization", "Bearer "+secret)
		request.Header.Set("Accept", "text/event-stream")

		s.setActiveControlStreamCancel(cancel)
		response, err := s.streamClient.Do(request)
		if err != nil {
			s.clearActiveControlStreamCancel(cancel)
			s.setControlDisconnected(fmt.Sprintf("connect_control_stream_failed: %v", err))
			time.Sleep(reconnectDelay)
			reconnectDelay = nextControlReconnectDelay(reconnectDelay)
			continue
		}
		if response.StatusCode >= 300 {
			s.clearActiveControlStreamCancel(cancel)
			_ = response.Body.Close()
			s.setControlDisconnected(fmt.Sprintf("control_stream_status_%d", response.StatusCode))
			time.Sleep(reconnectDelay)
			reconnectDelay = nextControlReconnectDelay(reconnectDelay)
			continue
		}

		reconnectDelay = 2 * time.Second
		s.setControlConnected(true)
		s.appendDiagnostic("connected to agent control stream %s", endpoint)

		scanner := bufio.NewScanner(response.Body)
		var payloadLines []string
		streamClosed := false

		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				if len(payloadLines) == 0 {
					continue
				}

				payload := agentControlMessage{}
				if err := json.Unmarshal([]byte(strings.Join(payloadLines, "\n")), &payload); err == nil {
					if payload.Type == "viewer-realtime" && strings.EqualFold(strings.TrimSpace(payload.DeviceID), deviceID) {
						s.mu.Lock()
						s.applyViewerRealtimeSnapshotLocked(payload.viewerRealtimeSnapshot, "stream")
						s.mu.Unlock()
					}
				}
				payloadLines = payloadLines[:0]
				continue
			}

			if strings.HasPrefix(line, ":") {
				continue
			}
			if strings.HasPrefix(line, "data:") {
				payloadLines = append(payloadLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			}
		}

		if err := scanner.Err(); err != nil {
			if errors.Is(err, context.Canceled) && s.hasControlDisconnectReasonPrefix("control_stream_stale_for_") {
				s.appendDiagnostic("agent control stream canceled locally after stale detection: %v", err)
			} else {
				s.setControlDisconnected(fmt.Sprintf("control_stream_disconnected: %v", err))
				s.appendDiagnostic("agent control stream disconnected: %v", err)
			}
		} else {
			streamClosed = true
			s.setControlDisconnected("control_stream_closed_by_server")
			s.appendDiagnostic("agent control stream closed by server")
		}
		_ = response.Body.Close()
		s.clearActiveControlStreamCancel(cancel)
		if streamClosed {
			time.Sleep(reconnectDelay)
		}
	}
}

func (s *server) currentAgentControlConfig() (string, string, string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	serverURL := strings.TrimSpace(s.config.Connection.ServerURL)
	secret := strings.TrimSpace(s.config.Connection.Secret)
	deviceID := strings.TrimSpace(s.config.Connection.DeviceID)
	if serverURL == "" || secret == "" || deviceID == "" {
		return "", "", "", false
	}
	return serverURL, secret, deviceID, true
}

func buildAgentControlStreamURL(serverURL, deviceID string) (string, error) {
	if err := validateServerTransport(serverURL); err != nil {
		return "", err
	}
	parsed, err := url.Parse(strings.TrimSpace(serverURL))
	if err != nil {
		return "", err
	}

	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
	default:
		return "", fmt.Errorf("unsupported_server_scheme_%s", parsed.Scheme)
	}

	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/api/agent/control-stream"
	query := parsed.Query()
	query.Set("deviceId", deviceID)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
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

func nextControlReconnectDelay(current time.Duration) time.Duration {
	if current <= 0 {
		return 2 * time.Second
	}

	next := current * 2
	if next > 20*time.Second {
		return 20 * time.Second
	}
	return next
}

func (s *server) setControlConnected(connected bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.controlConnected = connected
	if connected {
		s.lastControlError = ""
	}
}

func (s *server) setControlDisconnected(reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.controlConnected = false
	s.lastControlDisconnectAt = time.Now().UTC()
	s.lastControlError = strings.TrimSpace(reason)
}

func (s *server) setActiveControlStreamCancel(cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.controlStreamCancel != nil {
		s.controlStreamCancel()
	}
	s.controlStreamCancel = cancel
}

func (s *server) clearActiveControlStreamCancel(cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.controlStreamCancel == nil {
		return
	}
	if fmt.Sprintf("%p", s.controlStreamCancel) == fmt.Sprintf("%p", cancel) {
		s.controlStreamCancel = nil
	}
}

func (s *server) cancelActiveControlStream(reason string) {
	s.mu.Lock()
	cancel := s.controlStreamCancel
	if cancel != nil {
		s.controlStreamCancel = nil
		s.controlReconnectCount++
		s.lastControlReconnectAt = time.Now().UTC()
	}
	s.mu.Unlock()

	if cancel != nil {
		s.appendDiagnostic("canceling stale control stream: %s", reason)
		cancel()
	}
}

func (s *server) hasControlDisconnectReasonPrefix(prefix string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.HasPrefix(strings.TrimSpace(s.lastControlError), prefix)
}

func (s *server) controlStreamHealthLoop() {
	ticker := time.NewTicker(controlStreamHealthTick)
	defer ticker.Stop()

	for range ticker.C {
		s.mu.Lock()
		connected := s.controlConnected
		lastSnapshotAt := s.lastControlSnapshotAt
		lastSnapshotKind := s.lastControlSnapshotKind
		s.mu.Unlock()

		if !connected || lastSnapshotAt.IsZero() {
			continue
		}

		staleFor := time.Since(lastSnapshotAt)
		if staleFor <= controlStreamStaleAfter {
			continue
		}

		reason := fmt.Sprintf("control_stream_stale_for_%s_lastKind_%s", staleFor.Round(time.Second), lastSnapshotKind)
		s.setControlDisconnected(reason)
		s.cancelActiveControlStream(reason)
	}
}

func (s *server) applyViewerRealtimeSnapshotLocked(payload viewerRealtimeSnapshot, transport string) {
	now := time.Now().UTC()
	s.lastControlSnapshotAt = now
	s.lastControlSnapshotSource = strings.TrimSpace(transport)
	if strings.EqualFold(transport, "stream") {
		s.lastControlEventAt = now
	}
	snapshotChanged := !s.hasViewerRealtimeSnapshot || !viewerRealtimeSnapshotEqual(s.lastViewerRealtimeSnapshot, payload)
	if snapshotChanged {
		s.lastControlChangeAt = now
		s.lastControlSnapshotKind = "change"
	} else {
		s.lastControlSnapshotKind = "keepalive"
	}
	s.lastViewerRealtimeSnapshot = payload
	s.hasViewerRealtimeSnapshot = true

	if payload.Enabled {
		changed := false
		persistConfig := false
		resolvedViewerExpiry := resolveViewerRealtimeExpiry(payload.ExpiresAt, s.config.Sampling.ViewerRealtimeHoldSeconds, now)
		if !s.config.Sampling.RealtimeModeEnabled || s.config.Sampling.RealtimeModeSource == "" || s.config.Sampling.RealtimeModeSource == "viewer" {
			if !s.config.Sampling.RealtimeModeEnabled {
				s.config.Sampling.RealtimeModeEnabled = true
				changed = true
				persistConfig = true
			}
			if s.config.Sampling.RealtimeModeSource != "viewer" {
				s.config.Sampling.RealtimeModeSource = "viewer"
				changed = true
				persistConfig = true
			}
			if shouldRefreshViewerRealtimeExpiry(s.config.Sampling.RealtimeModeExpiresAt, resolvedViewerExpiry) {
				if shouldPersistViewerRealtimeExpiry(s.config.Sampling.RealtimeModeExpiresAt, resolvedViewerExpiry) {
					persistConfig = true
				}
				s.config.Sampling.RealtimeModeExpiresAt = resolvedViewerExpiry
				changed = true
			}
		}
		if changed && (!persistConfig || s.saveConfigLocked() == nil) {
			s.appendDiagnosticLocked(
				"viewer-driven realtime enabled via %s; viewers=%d effectiveInterval=%ds hold=%ds expiresAt=%s",
				transport,
				payload.ViewerCount,
				effectiveUploadIntervalSeconds(s.config.Sampling),
				s.config.Sampling.ViewerRealtimeHoldSeconds,
				s.config.Sampling.RealtimeModeExpiresAt,
			)
		}
		return
	}

	if s.config.Sampling.RealtimeModeEnabled && s.config.Sampling.RealtimeModeSource == "viewer" {
		expiresAt := strings.TrimSpace(s.config.Sampling.RealtimeModeExpiresAt)
		if expiresAt != "" {
			expiresAtTime, err := time.Parse(time.RFC3339, expiresAt)
			if err == nil && expiresAtTime.After(now) {
				s.appendDiagnosticLocked(
					"viewer-driven realtime keepalive window retained after %s disable snapshot; viewers=%d effectiveInterval=%ds hold=%ds expiresAt=%s",
					transport,
					payload.ViewerCount,
					effectiveUploadIntervalSeconds(s.config.Sampling),
					s.config.Sampling.ViewerRealtimeHoldSeconds,
					s.config.Sampling.RealtimeModeExpiresAt,
				)
				return
			}
		}
		s.config.Sampling.RealtimeModeEnabled = false
		s.config.Sampling.RealtimeModeExpiresAt = ""
		s.config.Sampling.RealtimeModeSource = ""
		if s.saveConfigLocked() == nil {
			s.appendDiagnosticLocked("viewer-driven realtime disabled via %s; returning to normal upload interval", transport)
		}
	}
}

func viewerRealtimeSnapshotEqual(left viewerRealtimeSnapshot, right viewerRealtimeSnapshot) bool {
	return left.Enabled == right.Enabled &&
		left.ViewerCount == right.ViewerCount &&
		left.DurationSeconds == right.DurationSeconds &&
		strings.TrimSpace(left.ExpiresAt) == strings.TrimSpace(right.ExpiresAt)
}

func shouldRefreshViewerRealtimeExpiry(current string, next string) bool {
	currentTime, currentErr := time.Parse(time.RFC3339, strings.TrimSpace(current))
	nextTime, nextErr := time.Parse(time.RFC3339, strings.TrimSpace(next))
	if nextErr != nil {
		return false
	}
	if currentErr != nil {
		return true
	}
	return currentTime.Sub(time.Now().UTC()) < 8*time.Second || nextTime.After(currentTime)
}

func shouldPersistViewerRealtimeExpiry(current string, next string) bool {
	currentTime, currentErr := time.Parse(time.RFC3339, strings.TrimSpace(current))
	nextTime, nextErr := time.Parse(time.RFC3339, strings.TrimSpace(next))
	if nextErr != nil {
		return false
	}
	if currentErr != nil {
		return true
	}

	now := time.Now().UTC()
	remaining := currentTime.Sub(now)
	if remaining < 8*time.Second {
		return true
	}

	return nextTime.Sub(currentTime) >= 5*time.Second
}

func resolveViewerRealtimePhase(s *server) string {
	if !s.config.Sampling.RealtimeModeEnabled || !strings.EqualFold(strings.TrimSpace(s.config.Sampling.RealtimeModeSource), "viewer") {
		return ""
	}
	if s.lastViewerRealtimeSnapshot.Enabled && s.lastViewerRealtimeSnapshot.ViewerCount > 0 {
		return "active"
	}
	return "hold"
}

func resolveViewerRealtimeExpiry(next string, holdSeconds int, now time.Time) string {
	nextTime, nextErr := time.Parse(time.RFC3339, strings.TrimSpace(next))
	holdUntil := now
	if holdSeconds > 0 {
		holdUntil = now.Add(time.Duration(holdSeconds) * time.Second)
	}

	switch {
	case nextErr != nil && holdSeconds > 0:
		return holdUntil.Format(time.RFC3339)
	case nextErr != nil:
		return ""
	case holdSeconds <= 0:
		return nextTime.UTC().Format(time.RFC3339)
	case nextTime.Before(holdUntil):
		return holdUntil.Format(time.RFC3339)
	default:
		return nextTime.UTC().Format(time.RFC3339)
	}
}
