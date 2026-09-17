package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"device-state-console/agent/internal/agentconfig"
	"device-state-console/agent/internal/agentservice"
)

// Exit codes are part of the automation contract: installers, Ansible playbooks
// and CI jobs branch on them, so they must stay stable.
const (
	exitOK             = 0
	exitUsage          = 1
	exitHubUnreachable = 3
	exitNotConfigured  = 4
	exitServiceDown    = 5
)

const cliUsage = `guanlan-agent - local agent service, configuration and diagnostics

Usage:
  guanlan-agent                          run the local control backend
  guanlan-agent version                  print the version
  guanlan-agent status [--json]           report service, configuration and upload state
  guanlan-agent doctor [--json]           check service, configuration and Hub connectivity
  guanlan-agent config get [--json]       print the stored configuration (secret redacted)
  guanlan-agent config set [options]      write configuration without any UI
  guanlan-agent config validate [--file]  validate a configuration document
  guanlan-agent config export [--file]    export the redacted configuration
  guanlan-agent config import --file      import a configuration document
  guanlan-agent service install|uninstall|start|stop|status
  guanlan-agent collector start|stop|restart
  guanlan-agent probes status|detect [--json]
  guanlan-agent onboarding-url           print the loopback control URL
  guanlan-agent wait-for-upload          block until the first upload is confirmed

Configuration options for "config set":
  --hub URL               Hub address, for example https://hub.example.com
  --key-stdin             read the access key from stdin (never from argv)
  --key-file PATH         read the access key from a file (used by installers)
  --device-id ID          device id shown in the console
  --hostname NAME         device display name shown in the console
  --normal-interval SEC   normal sampling interval
  --slow-interval SEC     slow sampling interval
  --metrics all|none|k1,k2
  --data-recording on|off
  --cloud-sync on|off
  --auto-restart on|off
  --auto-start on|off

Global options:
  --config-root DIR       machine-scope configuration directory
                          (default %s)
  --listen ADDR           loopback control address (default %s)

Exit codes:
  0 success/healthy, 1 usage error, 3 configured but the Hub is unreachable,
  4 not configured, 5 the agent service is not running.
`

// knownSubcommands lists the first argument values that select a helper command
// instead of the long-running daemon.
var knownSubcommands = map[string]bool{
	"version":         true,
	"help":            true,
	"--help":          true,
	"-h":              true,
	"status":          true,
	"doctor":          true,
	"config":          true,
	"service":         true,
	"collector":       true,
	"probes":          true,
	"onboarding-url":  true,
	"wait-for-upload": true,
	"run":             true,
}

// dispatchSubcommand runs a helper command when args select one. handled is
// false when the caller should continue into the daemon path.
func dispatchSubcommand(args []string, configDir string, listenAddr string) (handled bool, exitCode int) {
	if len(args) == 0 {
		return false, exitOK
	}
	if !knownSubcommands[args[0]] {
		return false, exitOK
	}

	rest := args[1:]
	switch args[0] {
	case "help", "--help", "-h":
		fmt.Printf(cliUsage, agentconfig.MachineDir(), agentconfig.DefaultListenAddress)
		return true, exitOK
	case "version":
		fmt.Printf("%s (%s)\n", BuildVersion, BuildChannel)
		return true, exitOK
	case "status":
		return true, runStatusCommand(configDir, listenAddr, rest)
	case "doctor":
		return true, runDoctorCommand(configDir, listenAddr, rest)
	case "config":
		return true, runConfigCommand(configDir, listenAddr, rest)
	case "service":
		return true, runServiceCommand(rest)
	case "collector":
		return true, runCollectorCommand(configDir, listenAddr, rest)
	case "probes":
		return true, runProbesCommand(configDir, listenAddr, rest)
	case "onboarding-url":
		fmt.Printf("http://%s/\n", listenAddr)
		return true, exitOK
	case "wait-for-upload":
		return true, runWaitForUpload(configDir, listenAddr, rest)
	case "run":
		return false, exitOK
	}
	return false, exitOK
}

// ---------------------------------------------------------------------------
// local control client
// ---------------------------------------------------------------------------

type localClient struct {
	baseURL string
	token   string
	http    *http.Client
}

func newLocalClient(configDir, listenAddr string) *localClient {
	token := ""
	if raw, err := os.ReadFile(agentconfig.TokenPath(configDir)); err == nil {
		token = strings.TrimSpace(string(raw))
	}
	return &localClient{
		baseURL: "http://" + listenAddr,
		token:   token,
		http:    &http.Client{Timeout: 45 * time.Second},
	}
}

func (c *localClient) request(method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		request.Header.Set("X-DSC-Local-Token", c.token)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, agentconfig.MaxConfigBytes))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		detail := strings.TrimSpace(string(raw))
		var payload struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &payload) == nil && payload.Error != "" {
			detail = payload.Error
		}
		return fmt.Errorf("agent_backend_%d: %s", response.StatusCode, detail)
	}
	if out == nil || len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// writeError prints to stderr so --json output on stdout stays machine readable.
func writeError(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "guanlan-agent: "+format+"\n", args...)
}

func emitJSON(value any) int {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		writeError("encode json: %v", err)
		return exitUsage
	}
	fmt.Println(string(encoded))
	return exitOK
}

// ---------------------------------------------------------------------------
// status / doctor
// ---------------------------------------------------------------------------

type cliStatus struct {
	ServiceInstalled   bool   `json:"serviceInstalled"`
	ServiceRunning     bool   `json:"serviceRunning"`
	ServiceKind        string `json:"serviceKind"`
	ServiceDetail      string `json:"serviceDetail,omitempty"`
	ConfigPath         string `json:"configPath"`
	ConfigFileExists   bool   `json:"configFileExists"`
	Configured         bool   `json:"configured"`
	DaemonReachable    bool   `json:"daemonReachable"`
	DeviceID           string `json:"deviceId,omitempty"`
	HubServerURL       string `json:"hubServerUrl,omitempty"`
	AutoStartCollector bool   `json:"autoStartCollector"`
	Version            string `json:"version"`
	Channel            string `json:"channel"`
	LastUploadAt       string `json:"lastUploadAt,omitempty"`
	LastUploadError    string `json:"lastUploadError,omitempty"`
	ConnectionStatus   string `json:"connectionStatus,omitempty"`
	PendingSamples     int    `json:"pendingSamples"`
	PendingBytes       int64  `json:"pendingBytes"`
	CollectorRunning   bool   `json:"collectorRunning"`
	ControlToken       bool   `json:"controlTokenPresent"`
	Message            string `json:"message,omitempty"`
}

func collectStatus(configDir, listenAddr string) cliStatus {
	configPath := agentconfig.ConfigPath(configDir)
	status := cliStatus{
		ConfigPath:   configPath,
		Version:      BuildVersion,
		Channel:      BuildChannel,
		ControlToken: tokenPresence(configDir),
	}

	serviceStatus, _ := agentservice.Query()
	status.ServiceInstalled = serviceStatus.Installed
	status.ServiceRunning = serviceStatus.Running
	status.ServiceKind = string(serviceStatus.Kind)
	status.ServiceDetail = serviceStatus.Detail

	config, _, err := agentconfig.LoadWithOptions(configPath, agentconfig.LoadOptions{ServiceScope: true})
	if err == nil {
		status.ConfigFileExists = true
		status.DeviceID = config.Connection.DeviceID
		status.HubServerURL = config.Connection.ServerURL
		status.AutoStartCollector = config.AutoStartCollector
		status.Configured = strings.TrimSpace(config.Connection.Secret) != "" &&
			strings.TrimSpace(config.Connection.ServerURL) != ""
	} else if !os.IsNotExist(err) {
		status.Message = err.Error()
	}

	if _, statErr := os.Stat(configPath); statErr == nil {
		status.ConfigFileExists = true
	}

	var state backendState
	client := newLocalClient(configDir, listenAddr)
	if err := client.request(http.MethodGet, "/api/state", nil, &state); err == nil {
		status.DaemonReachable = true
		status.CollectorRunning = state.ChildStartedAt != "" && state.ConnectionStatus != "stopped"
		status.LastUploadAt = state.LastUploadAt
		status.LastUploadError = state.LastUploadError
		status.ConnectionStatus = state.ConnectionStatus
		status.PendingSamples = state.PendingSampleCount
		status.PendingBytes = state.PendingBytes
		if status.DeviceID == "" {
			status.DeviceID = state.Config.Connection.DeviceID
		}
		if status.HubServerURL == "" {
			status.HubServerURL = state.Config.Connection.ServerURL
		}
	}
	return status
}

func statusExitCode(status cliStatus) int {
	if !status.Configured {
		return exitNotConfigured
	}
	if !status.DaemonReachable || (status.ServiceInstalled && !status.ServiceRunning) {
		return exitServiceDown
	}
	if status.LastUploadError != "" {
		return exitHubUnreachable
	}
	return exitOK
}

func runStatusCommand(configDir, listenAddr string, args []string) int {
	jsonOutput := containsFlag(args, "--json")
	status := collectStatus(configDir, listenAddr)

	if jsonOutput {
		return emitJSON(status)
	}

	fmt.Printf("服务: %s (%s)\n", status.ServiceKind, serviceStateText(status.ServiceRunning))
	fmt.Printf("配置: %s (存在=%t, 已配置=%t)\n", status.ConfigPath, status.ConfigFileExists, status.Configured)
	if status.DeviceID != "" {
		fmt.Printf("设备: %s -> %s\n", status.DeviceID, status.HubServerURL)
	}
	if status.DaemonReachable {
		fmt.Printf("采集器: 运行中=%t 状态=%s\n", status.CollectorRunning, status.ConnectionStatus)
		if status.LastUploadAt != "" {
			fmt.Printf("最近上报: %s\n", status.LastUploadAt)
		}
		if status.LastUploadError != "" {
			fmt.Printf("上报错误: %s\n", status.LastUploadError)
		}
		if status.PendingSamples > 0 {
			fmt.Printf("待重放: %d 条 / %d 字节\n", status.PendingSamples, status.PendingBytes)
		}
	} else {
		fmt.Println("采集器: 本地控制接口不可达（服务未运行）")
	}
	if status.Message != "" {
		fmt.Printf("注意: %s\n", status.Message)
	}
	return statusExitCode(status)
}

func serviceStateText(running bool) string {
	if running {
		return "运行中"
	}
	return "已停止"
}

type doctorResult struct {
	cliStatus
	HubReachable      bool   `json:"hubReachable"`
	HubAuthorized     bool   `json:"hubAuthorized"`
	HubDeviceKnown    bool   `json:"hubDeviceKnown"`
	HubMessage        string `json:"hubMessage,omitempty"`
	ConnectionChecked bool   `json:"connectionChecked"`
}

func runDoctorCommand(configDir, listenAddr string, args []string) int {
	jsonOutput := containsFlag(args, "--json")
	status := collectStatus(configDir, listenAddr)
	result := doctorResult{cliStatus: status}

	if status.DaemonReachable {
		var check struct {
			OK          bool   `json:"ok"`
			Reachable   bool   `json:"reachable"`
			Authorized  bool   `json:"authorized"`
			DeviceKnown bool   `json:"deviceKnown"`
			Status      string `json:"status"`
			Message     string `json:"message"`
		}
		client := newLocalClient(configDir, listenAddr)
		if err := client.request(http.MethodPost, "/api/control/check-connection", nil, &check); err == nil {
			result.ConnectionChecked = true
			result.HubReachable = check.Reachable
			result.HubAuthorized = check.Authorized
			result.HubDeviceKnown = check.DeviceKnown
			result.HubMessage = firstNonEmpty(check.Message, check.Status)
		} else {
			result.HubMessage = err.Error()
		}
	} else if status.Configured {
		// The service is not running, but the configuration is complete enough to
		// probe the Hub directly so an operator still gets a useful answer.
		config, _, err := agentconfig.LoadWithOptions(agentconfig.ConfigPath(configDir), agentconfig.LoadOptions{ServiceScope: true})
		if err == nil {
			reachable, authorized, message := probeHub(config.Connection.ServerURL, config.Connection.Secret)
			result.ConnectionChecked = true
			result.HubReachable = reachable
			result.HubAuthorized = authorized
			result.HubMessage = message
		}
	}

	if jsonOutput {
		code := statusExitCode(status)
		if code == exitOK && result.ConnectionChecked && !result.HubReachable {
			code = exitHubUnreachable
		}
		emitJSON(result)
		return code
	}

	fmt.Printf("服务: %s 运行中=%t\n", result.ServiceKind, result.ServiceRunning)
	fmt.Printf("配置: 已配置=%t (%s)\n", result.Configured, result.ConfigPath)
	if result.ConnectionChecked {
		fmt.Printf("中枢连通: %t 已授权: %t 设备已注册: %t\n", result.HubReachable, result.HubAuthorized, result.HubDeviceKnown)
		if result.HubMessage != "" {
			fmt.Printf("中枢消息: %s\n", result.HubMessage)
		}
	} else {
		fmt.Println("中枢连通: 未检查（缺少中枢地址或访问密钥）")
	}
	if result.LastUploadAt != "" {
		fmt.Printf("最近上报: %s\n", result.LastUploadAt)
	}
	if result.LastUploadError != "" {
		fmt.Printf("上报错误: %s\n", result.LastUploadError)
	}

	code := statusExitCode(result.cliStatus)
	if code == exitOK && result.ConnectionChecked && !result.HubReachable {
		code = exitHubUnreachable
	}
	return code
}

// probeHub performs an unauthenticated reachability probe followed by an
// authenticated device-state lookup, mirroring the backend's own two-stage
// connection check.
func probeHub(serverURL, secret string) (reachable bool, authorized bool, message string) {
	base := strings.TrimRight(strings.TrimSpace(serverURL), "/")
	if base == "" {
		return false, false, "中枢地址为空"
	}
	client := &http.Client{Timeout: 10 * time.Second}

	pingRequest, err := http.NewRequest(http.MethodGet, base+"/api/agent/ping", nil)
	if err != nil {
		return false, false, err.Error()
	}
	pingResponse, err := client.Do(pingRequest)
	if err != nil {
		return false, false, fmt.Sprintf("无法连接中枢: %v", err)
	}
	_ = pingResponse.Body.Close()
	if pingResponse.StatusCode >= 500 {
		return false, false, fmt.Sprintf("中枢返回 %d", pingResponse.StatusCode)
	}
	reachable = true

	stateRequest, err := http.NewRequest(http.MethodGet, base+"/api/agent/device-state", nil)
	if err != nil {
		return reachable, false, err.Error()
	}
	stateRequest.Header.Set("Authorization", "Bearer "+strings.TrimSpace(secret))
	stateResponse, err := client.Do(stateRequest)
	if err != nil {
		return reachable, false, fmt.Sprintf("鉴权请求失败: %v", err)
	}
	defer stateResponse.Body.Close()
	switch stateResponse.StatusCode {
	case http.StatusOK:
		return reachable, true, "ok"
	case http.StatusUnauthorized, http.StatusForbidden:
		return reachable, false, "访问密钥被拒绝"
	default:
		return reachable, false, fmt.Sprintf("中枢返回 %d", stateResponse.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

func runConfigCommand(configDir, listenAddr string, args []string) int {
	if len(args) == 0 {
		fmt.Printf(cliUsage, agentconfig.MachineDir(), agentconfig.DefaultListenAddress)
		return exitUsage
	}
	switch args[0] {
	case "get":
		return runConfigGet(configDir, args[1:])
	case "set":
		return runConfigSet(configDir, listenAddr, args[1:])
	case "validate":
		return runConfigValidate(configDir, args[1:])
	case "export":
		return runConfigExport(configDir, args[1:])
	case "import":
		return runConfigImport(configDir, listenAddr, args[1:])
	default:
		writeError("unknown config command %q", args[0])
		return exitUsage
	}
}

func runConfigGet(configDir string, args []string) int {
	config, created, err := agentconfig.LoadWithOptions(
		agentconfig.ConfigPath(configDir),
		agentconfig.LoadOptions{ServiceScope: true},
	)
	if err != nil {
		writeError("%v", err)
		return exitUsage
	}
	if created {
		writeError("no configuration document at %s; run \"guanlan-agent config set --hub ... --key-stdin\" first", agentconfig.ConfigPath(configDir))
	}
	redacted := agentconfig.Redact(config)
	if containsFlag(args, "--json") {
		return emitJSON(redacted)
	}
	encoded, _ := json.MarshalIndent(redacted, "", "  ")
	fmt.Println(string(encoded))
	return exitOK
}

func runConfigSet(configDir, listenAddr string, args []string) int {
	flags := flag.NewFlagSet("guanlan-agent config set", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	hub := flags.String("hub", "", "Hub address")
	deviceID := flags.String("device-id", "", "device id")
	hostname := flags.String("hostname", "", "device display name")
	normalInterval := flags.Int("normal-interval", 0, "normal sampling interval in seconds")
	slowInterval := flags.Int("slow-interval", 0, "slow sampling interval in seconds")
	metrics := flags.String("metrics", "", "all, none or a comma separated metric list")
	dataRecording := flags.String("data-recording", "", "on or off")
	cloudSync := flags.String("cloud-sync", "", "on or off")
	autoRestart := flags.String("auto-restart", "", "on or off")
	autoStart := flags.String("auto-start", "", "on or off")
	keyStdin := flags.Bool("key-stdin", false, "read the access key from stdin")
	keyFile := flags.String("key-file", "", "read the access key from a file")
	// Global options are resolved by the caller before dispatch. They are
	// declared here so a command such as
	// "guanlan-agent config set --config-root DIR --hub URL" parses instead of
	// failing with an unknown-flag error.
	flags.String("config-root", "", "ignored: resolved before dispatch")
	flags.String("listen", "", "ignored: resolved before dispatch")
	if err := flags.Parse(args); err != nil {
		writeError("%v", err)
		return exitUsage
	}

	configPath := agentconfig.ConfigPath(configDir)
	if err := agentconfig.Writable(configDir); err != nil {
		writeError("%v", err)
		return exitUsage
	}
	config, _, err := agentconfig.LoadWithOptions(configPath, agentconfig.LoadOptions{ServiceScope: true})
	if err != nil {
		writeError("%v", err)
		return exitUsage
	}

	changed := false
	if value := strings.TrimSpace(*hub); value != "" {
		config.Connection.ServerURL = value
		changed = true
	}
	if value := strings.TrimSpace(*deviceID); value != "" {
		config.Connection.DeviceID = value
		changed = true
	}
	if value := strings.TrimSpace(*hostname); value != "" {
		config.Connection.Hostname = value
		changed = true
	}
	if *normalInterval > 0 {
		config.Sampling.NormalIntervalSeconds = *normalInterval
		changed = true
	}
	if *slowInterval > 0 {
		config.Sampling.SlowIntervalSeconds = *slowInterval
		changed = true
	}
	if value := strings.TrimSpace(*metrics); value != "" {
		keys, err := parseMetricSelection(value)
		if err != nil {
			writeError("%v", err)
			return exitUsage
		}
		config.EnabledMetrics = keys
		changed = true
	}
	if value, ok, err := parseToggle(*dataRecording, "data-recording"); err != nil {
		writeError("%v", err)
		return exitUsage
	} else if ok {
		config.DataRecordingEnabled = value
		changed = true
	}
	if value, ok, err := parseToggle(*cloudSync, "cloud-sync"); err != nil {
		writeError("%v", err)
		return exitUsage
	} else if ok {
		config.CloudSyncEnabled = value
		changed = true
	}
	if value, ok, err := parseToggle(*autoRestart, "auto-restart"); err != nil {
		writeError("%v", err)
		return exitUsage
	} else if ok {
		config.AutoRestartCollector = value
		changed = true
	}
	if value, ok, err := parseToggle(*autoStart, "auto-start"); err != nil {
		writeError("%v", err)
		return exitUsage
	} else if ok {
		config.AutoStartCollector = value
		changed = true
	}
	if *keyStdin && strings.TrimSpace(*keyFile) != "" {
		writeError("use either --key-stdin or --key-file, not both")
		return exitUsage
	}
	if *keyStdin || strings.TrimSpace(*keyFile) != "" {
		secret, err := readSecret(*keyStdin, *keyFile)
		if err != nil {
			writeError("%v", err)
			return exitUsage
		}
		config.Connection.Secret = secret
		changed = true
	}

	if !changed {
		writeError("no configuration changes were requested")
		return exitUsage
	}
	if err := validateConfigForWrite(config); err != nil {
		writeError("%v", err)
		return exitUsage
	}
	// Re-marshal first: Normalize treats a missing key as "restore the default",
	// so it must see the complete document rather than a nil raw buffer.
	complete, err := json.Marshal(config)
	if err != nil {
		writeError("%v", err)
		return exitUsage
	}
	config = agentconfig.Normalize(config, complete)
	if err := agentconfig.Save(configPath, config); err != nil {
		writeError("%v", err)
		return exitUsage
	}

	// Push the document into a running daemon so the collector picks it up now
	// instead of at the next service restart.
	client := newLocalClient(configDir, listenAddr)
	if err := client.request(http.MethodPut, "/api/config", config, nil); err != nil {
		fmt.Printf("配置已写入 %s；本地控制接口不可达，将在服务启动时生效\n", configPath)
	} else {
		fmt.Printf("配置已写入 %s 并已同步到运行中的服务\n", configPath)
	}

	redacted := agentconfig.Redact(config)
	encoded, _ := json.MarshalIndent(redacted, "", "  ")
	fmt.Println(string(encoded))
	return exitOK
}

func runConfigValidate(configDir string, args []string) int {
	path := agentconfig.ConfigPath(configDir)
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		path = args[0]
	}
	raw, err := agentconfig.ReadFileLimited(path)
	if err != nil {
		writeError("read %s: %v", path, err)
		return exitUsage
	}
	var decoded agentconfig.LocalConfig
	if err := json.Unmarshal(agentconfig.TrimUTF8BOM(raw), &decoded); err != nil {
		writeError("%s is not valid JSON: %v", path, err)
		return exitUsage
	}
	if err := validateConfigForWrite(decoded); err != nil {
		writeError("%s: %v", path, err)
		return exitUsage
	}
	fmt.Printf("%s 校验通过\n", path)
	return exitOK
}

func runConfigExport(configDir string, args []string) int {
	config, _, err := agentconfig.LoadWithOptions(
		agentconfig.ConfigPath(configDir),
		agentconfig.LoadOptions{ServiceScope: true},
	)
	if err != nil {
		writeError("%v", err)
		return exitUsage
	}
	encoded, err := json.MarshalIndent(agentconfig.Redact(config), "", "  ")
	if err != nil {
		writeError("%v", err)
		return exitUsage
	}
	encoded = append(encoded, '\n')

	outputPath := flagValue(args, "--file")
	if outputPath == "" {
		fmt.Print(string(encoded))
		return exitOK
	}
	if err := agentconfig.WriteFileAtomic(outputPath, encoded, 0o600); err != nil {
		writeError("%v", err)
		return exitUsage
	}
	fmt.Printf("已导出脱敏配置到 %s\n", outputPath)
	return exitOK
}

func runConfigImport(configDir, listenAddr string, args []string) int {
	inputPath := flagValue(args, "--file")
	if inputPath == "" && len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		inputPath = args[0]
	}
	if inputPath == "" {
		writeError("config import requires --file <path>")
		return exitUsage
	}
	raw, err := agentconfig.ReadFileLimited(inputPath)
	if err != nil {
		writeError("read %s: %v", inputPath, err)
		return exitUsage
	}
	var decoded agentconfig.LocalConfig
	if err := json.Unmarshal(agentconfig.TrimUTF8BOM(raw), &decoded); err != nil {
		writeError("%s is not valid JSON: %v", inputPath, err)
		return exitUsage
	}

	configPath := agentconfig.ConfigPath(configDir)
	// An import carries a redacted document, so preserve the stored secret
	// unless the caller supplies a new one on stdin.
	if strings.TrimSpace(decoded.Connection.Secret) == "" {
		if current, _, err := agentconfig.LoadWithOptions(configPath, agentconfig.LoadOptions{ServiceScope: true}); err == nil {
			decoded.Connection.Secret = current.Connection.Secret
		}
	}
	if containsFlag(args, "--key-stdin") || flagValue(args, "--key-file") != "" {
		secret, err := readSecret(containsFlag(args, "--key-stdin"), flagValue(args, "--key-file"))
		if err != nil {
			writeError("%v", err)
			return exitUsage
		}
		decoded.Connection.Secret = secret
	}
	if err := validateConfigForWrite(decoded); err != nil {
		writeError("%v", err)
		return exitUsage
	}
	if err := agentconfig.Writable(configDir); err != nil {
		writeError("%v", err)
		return exitUsage
	}

	normalized := agentconfig.Normalize(decoded, agentconfig.TrimUTF8BOM(raw))
	if err := agentconfig.Save(configPath, normalized); err != nil {
		writeError("%v", err)
		return exitUsage
	}
	client := newLocalClient(configDir, listenAddr)
	if err := client.request(http.MethodPut, "/api/config", normalized, nil); err != nil {
		fmt.Printf("配置已导入 %s；本地控制接口不可达，将在服务启动时生效\n", configPath)
	} else {
		fmt.Printf("配置已导入 %s 并已同步到运行中的服务\n", configPath)
	}
	return exitOK
}

// validateConfigForWrite applies the checks the desktop UI also enforces.
func validateConfigForWrite(config agentconfig.LocalConfig) error {
	serverURL := strings.TrimSpace(config.Connection.ServerURL)
	if serverURL != "" && !strings.HasPrefix(serverURL, "http://") && !strings.HasPrefix(serverURL, "https://") {
		return fmt.Errorf("中枢地址必须以 http:// 或 https:// 开头：%s", serverURL)
	}
	for label, value := range map[string]int{
		"normalIntervalSeconds": config.Sampling.NormalIntervalSeconds,
		"slowIntervalSeconds":   config.Sampling.SlowIntervalSeconds,
	} {
		if value < 0 || value > agentconfig.MaxSamplingIntervalSeconds {
			return fmt.Errorf("%s 必须在 0..%d 之间", label, agentconfig.MaxSamplingIntervalSeconds)
		}
	}
	known := map[string]bool{}
	for _, key := range agentconfig.AllMetricKeys {
		known[key] = true
	}
	for _, key := range config.EnabledMetrics {
		if !known[key] {
			return fmt.Errorf("未知指标 key：%s", key)
		}
	}
	return nil
}

func parseMetricSelection(value string) ([]string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "all":
		return append([]string(nil), agentconfig.AllMetricKeys...), nil
	case "none":
		return []string{}, nil
	}
	keys := agentconfig.NormalizeMetricKeys(strings.Split(value, ","))
	for _, raw := range strings.Split(value, ",") {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		found := false
		for _, key := range keys {
			if key == trimmed {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("未知指标 key：%s", trimmed)
		}
	}
	return keys, nil
}

func parseToggle(value, label string) (bool, bool, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "":
		return false, false, nil
	case "on", "true", "1", "yes":
		return true, true, nil
	case "off", "false", "0", "no":
		return false, true, nil
	default:
		return false, false, fmt.Errorf("--%s 只接受 on 或 off", label)
	}
}

// readSecret keeps the access key out of the process arguments, where any local
// user could read it from the process list. Installers write the key to a
// temporary file and delete it right after this call.
func readSecret(fromStdin bool, fromFile string) (string, error) {
	var raw []byte
	var err error
	if fromStdin {
		raw, err = io.ReadAll(io.LimitReader(os.Stdin, 4096))
		if err != nil {
			return "", fmt.Errorf("read access key from stdin: %w", err)
		}
	} else {
		raw, err = agentconfig.ReadFileLimited(strings.TrimSpace(fromFile))
		if err != nil {
			return "", fmt.Errorf("read access key file: %w", err)
		}
	}
	secret := strings.TrimSpace(string(raw))
	if secret == "" {
		return "", errors.New("no access key was provided")
	}
	return secret, nil
}

// runWaitForUpload blocks until the service confirms an upload or the timeout
// expires. Installers and CI use it as a single-command acceptance check:
// exit 0 means "this computer is reporting".
func runWaitForUpload(configDir, listenAddr string, args []string) int {
	timeoutSeconds := 60
	if value := flagValue(args, "--timeout"); value != "" {
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || parsed < 0 {
			writeError("--timeout must be a non-negative number of seconds")
			return exitUsage
		}
		timeoutSeconds = parsed
	}
	deadline := time.Now().Add(time.Duration(timeoutSeconds) * time.Second)
	client := newLocalClient(configDir, listenAddr)

	for {
		var status struct {
			LastUploadAt    string `json:"lastUploadAt"`
			LastUploadError string `json:"lastUploadError"`
			Configured      bool   `json:"configured"`
		}
		if err := client.request(http.MethodGet, "/api/status", nil, &status); err == nil {
			if strings.TrimSpace(status.LastUploadAt) != "" {
				fmt.Printf("首次上报已确认：%s\n", status.LastUploadAt)
				return exitOK
			}
			if strings.TrimSpace(status.LastUploadError) != "" {
				fmt.Printf("等待上报中，最近错误：%s\n", status.LastUploadError)
			}
		}
		if time.Now().After(deadline) {
			writeError("在 %d 秒内没有确认到首次上报", timeoutSeconds)
			return exitHubUnreachable
		}
		time.Sleep(2 * time.Second)
	}
}

// ---------------------------------------------------------------------------
// service / collector / probes
// ---------------------------------------------------------------------------

func runServiceCommand(args []string) int {
	if len(args) == 0 {
		writeError("service requires one of: install, uninstall, start, stop, status")
		return exitUsage
	}
	switch args[0] {
	case "status":
		status, err := agentservice.Query()
		if err != nil {
			writeError("%v", err)
			return exitUsage
		}
		if containsFlag(args[1:], "--json") {
			return emitJSON(status)
		}
		fmt.Printf("%s: installed=%t running=%t %s\n", status.Kind, status.Installed, status.Running, status.Detail)
		if !status.Installed {
			return exitServiceDown
		}
		return exitOK
	case "install", "uninstall", "start", "stop":
		executable, err := os.Executable()
		if err != nil {
			writeError("%v", err)
			return exitUsage
		}
		configDir := agentconfig.ResolveDir(flagValue(args[1:], "--config-root"))
		bundleRoot := strings.TrimSpace(flagValue(args[1:], "--bundle-root"))
		if bundleRoot == "" {
			// Both binaries normally sit next to each other.
			bundleRoot = filepath.Dir(executable)
		}
		spec := agentservice.Spec{
			Executable:  executable,
			Arguments:   []string{"--service-mode", "--config-root", configDir, "--bundle-root", bundleRoot},
			DisplayName: "观澜 本机 Agent 服务",
			ServiceUser: flagValue(args[1:], "--service-user"),
			ConfigDir:   configDir,
			BundleRoot:  bundleRoot,
		}

		var status agentservice.Status
		switch args[0] {
		case "install":
			status, err = agentservice.Install(spec)
		case "uninstall":
			status, err = agentservice.Uninstall()
		case "start":
			status, err = agentservice.Start()
		case "stop":
			status, err = agentservice.Stop()
		}
		if err != nil {
			writeError("%v", err)
			return exitUsage
		}
		fmt.Printf("%s: installed=%t running=%t %s\n", status.Kind, status.Installed, status.Running, status.Detail)
		return exitOK
	default:
		writeError("unknown service command %q", args[0])
		return exitUsage
	}
}

func runCollectorCommand(configDir, listenAddr string, args []string) int {
	if len(args) == 0 {
		writeError("collector requires one of: start, stop, restart")
		return exitUsage
	}
	endpoint := map[string]string{
		"start":   "/api/control/start",
		"stop":    "/api/control/stop",
		"restart": "/api/control/restart",
	}[args[0]]
	if endpoint == "" {
		writeError("unknown collector command %q", args[0])
		return exitUsage
	}
	client := newLocalClient(configDir, listenAddr)
	if err := client.request(http.MethodPost, endpoint, nil, nil); err != nil {
		writeError("%v (the agent service is not running)", err)
		return exitServiceDown
	}
	return runStatusCommand(configDir, listenAddr, args[1:])
}

func runProbesCommand(configDir, listenAddr string, args []string) int {
	command := "status"
	for _, arg := range args {
		if strings.HasPrefix(arg, "-") {
			continue
		}
		command = strings.ToLower(strings.TrimSpace(arg))
		break
	}
	client := newLocalClient(configDir, listenAddr)
	switch command {
	case "status":
	case "detect", "refresh", "redetect":
		if err := client.request(http.MethodPost, "/api/probes/detect", nil, nil); err != nil {
			writeError("%v (the agent service is not running)", err)
			return exitServiceDown
		}
	default:
		writeError("unknown probes command %q; use status or detect", command)
		return exitUsage
	}

	var state backendState
	if err := client.request(http.MethodGet, "/api/state", nil, &state); err != nil {
		writeError("%v (the agent service is not running)", err)
		return exitServiceDown
	}
	if containsFlag(args, "--json") {
		return emitJSON(state.DetectedTargets)
	}
	for _, target := range state.DetectedTargets {
		fmt.Printf("%s (%s)\n", target.Target, target.Label)
		for _, instance := range target.Instances {
			fmt.Printf("  - %s %s enabled=%t\n", instance.ID, instance.Name, instance.Enabled)
		}
	}
	return exitOK
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

func containsFlag(args []string, name string) bool {
	for _, arg := range args {
		if arg == name {
			return true
		}
	}
	return false
}

// flagValue accepts both "--name value" and "--name=value".
func flagValue(args []string, name string) string {
	for index, arg := range args {
		if arg == name && index+1 < len(args) {
			return args[index+1]
		}
		if strings.HasPrefix(arg, name+"=") {
			return strings.TrimPrefix(arg, name+"=")
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
