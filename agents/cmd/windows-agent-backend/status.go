package main

import (
	"net/http"
	"os"
	"strings"

	"device-state-console/agent/internal/agentconfig"
)

// statusPayload is the redacted health document served at /api/status.
//
// It exists so an unprivileged desktop UI can show whether the machine-scope
// agent service is healthy without reading the machine configuration file,
// which holds the Hub access key and is therefore restricted to SYSTEM /
// Administrators on Windows and root / guanlan on Linux.
//
// The endpoint is intentionally reachable without the control token, but it is
// bound to the loopback address and never exposes the secret, the control token,
// collector log lines or full filesystem paths beyond the configuration
// directory.
type statusPayload struct {
	Running            bool   `json:"running"`
	ServiceScope       bool   `json:"serviceScope"`
	CollectorRunning   bool   `json:"collectorRunning"`
	ConnectionStatus   string `json:"connectionStatus"`
	Configured         bool   `json:"configured"`
	DeviceID           string `json:"deviceId,omitempty"`
	Hostname           string `json:"hostname,omitempty"`
	HubServerURL       string `json:"hubServerUrl,omitempty"`
	AutoStartCollector bool   `json:"autoStartCollector"`
	DataRecording      bool   `json:"dataRecordingEnabled"`
	CloudSync          bool   `json:"cloudSyncEnabled"`
	LastUploadAt       string `json:"lastUploadAt,omitempty"`
	LastUploadError    string `json:"lastUploadError,omitempty"`
	PendingSamples     int    `json:"pendingSamples"`
	PendingBytes       int64  `json:"pendingBytes"`
	OldestPendingAt    string `json:"oldestPendingAt,omitempty"`
	RestartCount       int    `json:"restartCount"`
	Version            string `json:"version"`
	Channel            string `json:"channel"`
	ConfigDir          string `json:"configDir,omitempty"`
}

func (s *server) handleStatus(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writer.Header().Set("Allow", http.MethodGet)
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	s.mu.Lock()
	pending := readCollectorPendingState(s.pendingStatePath)
	payload := statusPayload{
		Running:            s.cmd != nil && s.cmd.Process != nil,
		ServiceScope:       s.serviceScope,
		CollectorRunning:   !s.childStartedAt.IsZero() && !strings.EqualFold(strings.TrimSpace(s.connectionState), "stopped"),
		ConnectionStatus:   s.connectionState,
		Configured:         strings.TrimSpace(s.config.Connection.Secret) != "" && strings.TrimSpace(s.config.Connection.ServerURL) != "",
		DeviceID:           s.config.Connection.DeviceID,
		Hostname:           s.config.Connection.Hostname,
		HubServerURL:       s.config.Connection.ServerURL,
		AutoStartCollector: s.config.AutoStartCollector,
		DataRecording:      s.config.DataRecordingEnabled,
		CloudSync:          s.config.CloudSyncEnabled,
		LastUploadAt:       formatTime(s.lastUploadAt),
		LastUploadError:    redactSensitiveText(pending.LastUploadError, s.config.Connection.Secret),
		PendingSamples:     pending.PendingCount,
		PendingBytes:       pending.PendingBytes,
		OldestPendingAt:    pending.OldestSampledAt,
		RestartCount:       s.restartCount,
		Version:            BuildVersion,
		Channel:            BuildChannel,
		ConfigDir:          configDirectoryOf(s.configPath),
	}
	s.mu.Unlock()
	writeJSON(writer, http.StatusOK, payload)
}

// configDirectoryOf reports the configuration directory without leaking the
// file name into the public payload.
func configDirectoryOf(configPath string) string {
	trimmed := strings.TrimSpace(configPath)
	if trimmed == "" {
		return ""
	}
	if index := strings.LastIndexAny(trimmed, `/\`); index > 0 {
		return trimmed[:index]
	}
	return trimmed
}

// tokenPresence reports whether the control token file exists. It is used by
// diagnostics only; the token value itself is never exposed.
func tokenPresence(dir string) bool {
	_, err := os.Stat(agentconfig.TokenPath(dir))
	return err == nil
}
