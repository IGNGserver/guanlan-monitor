package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

var BuildVersion = "dev"
var BuildChannel = "test"

const (
	runtimeFileName   = "agent-ui.runtime.json"
	processLogName    = "agent-ui.process.log"
	backendWait       = 8 * time.Second
	backendRequestTTL = 5 * time.Second
)

var allMetricKeys = []string{
	"cpuUsage", "cpuFrequency", "cpuTemperature", "cpuTopology", "systemOverview",
	"gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature", "gpuDriverInfo",
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

type probePlanSupport struct {
	Target    string   `json:"target"`
	Providers []string `json:"providers"`
	Default   string   `json:"default"`
}

type probeTargetState struct {
	Target    string                  `json:"target"`
	Label     string                  `json:"label"`
	Instances []probeDetectedInstance `json:"instances"`
}

type probeDetectedInstance struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Subtitle string   `json:"subtitle,omitempty"`
	Enabled  bool     `json:"enabled"`
	Metrics  []string `json:"metrics"`
}

type backendState struct {
	Running                        bool               `json:"running"`
	ConnectionStatus               string             `json:"connectionStatus"`
	LastChildLog                   string             `json:"lastChildLog,omitempty"`
	LastUploadAt                   string             `json:"lastUploadAt,omitempty"`
	LastCloudSyncAt                string             `json:"lastCloudSyncAt,omitempty"`
	LastCloudSyncError             string             `json:"lastCloudSyncError,omitempty"`
	CloudConfigPending             bool               `json:"cloudConfigPending"`
	LastExitAt                     string             `json:"lastExitAt,omitempty"`
	LastRestartAt                  string             `json:"lastRestartAt,omitempty"`
	RestartCount                   int                `json:"restartCount"`
	LastExitCode                   *int               `json:"lastExitCode,omitempty"`
	AutoRestartPending             bool               `json:"autoRestartPending"`
	EffectiveUploadIntervalSeconds int                `json:"effectiveUploadIntervalSeconds"`
	LastIssueCategory              string             `json:"lastIssueCategory,omitempty"`
	LastIssueDetail                string             `json:"lastIssueDetail,omitempty"`
	LastIssueAt                    string             `json:"lastIssueAt,omitempty"`
	LastIssueCount                 int                `json:"lastIssueCount"`
	LastIssueRecoveredAt           string             `json:"lastIssueRecoveredAt,omitempty"`
	ConfigPath                     string             `json:"configPath"`
	ConfigFileExists               bool               `json:"configFileExists"`
	SyncStatePath                  string             `json:"syncStatePath"`
	SyncStateFileExists            bool               `json:"syncStateFileExists"`
	DiagnosticsPath                string             `json:"diagnosticsPath"`
	DiagnosticsFileExists          bool               `json:"diagnosticsFileExists"`
	PendingStatePath               string             `json:"pendingStatePath"`
	PendingStateFileExists         bool               `json:"pendingStateFileExists"`
	PendingSampleCount             int                `json:"pendingSampleCount"`
	PendingBytes                   int64              `json:"pendingBytes"`
	OldestPendingAt                string             `json:"oldestPendingAt,omitempty"`
	LastUploadError                string             `json:"lastUploadError,omitempty"`
	Config                         agentLocalConfig   `json:"config"`
	SupportedProbePlans            []probePlanSupport `json:"supportedProbePlans"`
	DetectedTargets                []probeTargetState `json:"detectedTargets"`
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

type runtimeRecord struct {
	PID       int    `json:"pid"`
	Port      int    `json:"port"`
	Token     string `json:"token"`
	StartedAt string `json:"startedAt"`
}

type backendClient struct {
	baseURL string
	token   string
	http    *http.Client
}

var errRuntimeNotFound = errors.New("dsc backend runtime is not registered")

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "dsc: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 || args[0] == "ui" {
		return runUI()
	}

	switch args[0] {
	case "help", "--help", "-h":
		printUsage()
		return nil
	case "version", "--version":
		fmt.Printf("dsc %s (%s)\n", BuildVersion, BuildChannel)
		return nil
	case "status":
		return runStatus(args[1:])
	case "start", "stop", "restart":
		return runControl(args[0])
	case "shutdown":
		return shutdownBackend()
	case "doctor":
		return runDoctor()
	case "config":
		return runConfig(args[1:])
	default:
		printUsage()
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func printUsage() {
	fmt.Println("观澜 CLI")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  dsc                         进入终端配置界面")
	fmt.Println("  dsc ui                      进入终端配置界面")
	fmt.Println("  dsc status [--json]         查看本地 Agent 状态")
	fmt.Println("  dsc start                   启动采集器")
	fmt.Println("  dsc stop                    停止采集器")
	fmt.Println("  dsc restart                 重启采集器")
	fmt.Println("  dsc shutdown                停止本地 CLI backend")
	fmt.Println("  dsc doctor                  检查连接和探针")
	fmt.Println("  dsc config get [--json]     输出本地配置（密钥会脱敏）")
	fmt.Println("  dsc config set [options]    无界面修改配置")
	fmt.Println("  dsc version                 显示版本")
}

func runStatus(args []string) error {
	jsonOutput := contains(args, "--json")
	client, record, err := loadExistingClient()
	if err != nil {
		if errors.Is(err, errRuntimeNotFound) || strings.Contains(err.Error(), "connect backend") {
			if jsonOutput {
				return writeOutputJSON(map[string]any{"running": false, "backend": "stopped"})
			}
			fmt.Println("Agent backend: stopped")
			return nil
		}
		return err
	}
	state, err := client.getState()
	if err != nil {
		return err
	}
	if jsonOutput {
		return writeOutputJSON(redactState(state))
	}
	fmt.Printf("Agent backend: running (pid=%d, port=%d)\n", record.PID, record.Port)
	printStateSummary(state)
	return nil
}

func runControl(action string) error {
	var client *backendClient
	var err error
	if action == "stop" {
		client, _, err = loadExistingClient()
		if errors.Is(err, errRuntimeNotFound) {
			fmt.Println("采集器已经停止。")
			return nil
		}
	} else {
		client, err = ensureClient()
	}
	if err != nil {
		return err
	}

	if action == "restart" {
		if _, err := client.control("/api/control/stop", nil); err != nil {
			return err
		}
		action = "start"
	}
	state, err := client.control("/api/control/"+action, nil)
	if err != nil {
		return err
	}
	printStateSummary(&state)
	return nil
}

func shutdownBackend() error {
	root, err := configRoot()
	if err != nil {
		return err
	}
	client, _, err := loadExistingClientAt(root)
	if errors.Is(err, errRuntimeNotFound) {
		fmt.Println("本地 CLI backend 已停止。")
		return nil
	}
	if err != nil {
		return err
	}
	var result struct {
		OK bool `json:"ok"`
	}
	if err := client.request(http.MethodPost, "/api/control/shutdown", nil, &result); err != nil {
		return err
	}
	_ = os.Remove(runtimePath(root))
	fmt.Println("本地 CLI backend 已停止。")
	return nil
}

func runDoctor() error {
	client, err := ensureClient()
	if err != nil {
		return err
	}
	state, err := client.getState()
	if err != nil {
		return err
	}
	printStateSummary(state)

	var result connectionCheckResult
	checkErr := client.request(http.MethodPost, "/api/control/check-connection", nil, &result)
	if result.Message != "" {
		fmt.Printf("连接检查: %s\n", result.Message)
	} else if checkErr != nil {
		fmt.Printf("连接检查失败: %v\n", checkErr)
	}
	if result.OK {
		fmt.Println("连接检查结果: OK")
	} else {
		fmt.Println("连接检查结果: 未通过")
	}

	detected, detectErr := client.control("/api/probes/detect", nil)
	if detectErr != nil {
		fmt.Printf("探针检测失败: %v\n", detectErr)
	} else {
		fmt.Printf("探针检测完成: %d 个目标类别\n", len(detected.DetectedTargets))
	}
	return nil
}

func runConfig(args []string) error {
	if len(args) == 0 || args[0] == "ui" {
		return runUI()
	}
	client, err := ensureClient()
	if err != nil {
		return err
	}
	switch args[0] {
	case "get":
		cfg, err := client.getConfig()
		if err != nil {
			return err
		}
		if contains(args[1:], "--json") {
			return writeOutputJSON(redactConfig(cfg))
		}
		printConfig(cfg)
		return nil
	case "set":
		return runConfigSet(client, args[1:])
	default:
		return fmt.Errorf("unknown config command %q", args[0])
	}
}

func runConfigSet(client *backendClient, args []string) error {
	flags := flag.NewFlagSet("dsc config set", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	serverURL := flags.String("server-url", "", "中枢地址")
	deviceID := flags.String("device-id", "", "设备 ID")
	hostname := flags.String("hostname", "", "设备名称")
	normalInterval := flags.Int("normal-interval", 0, "普通采样间隔（秒）")
	slowInterval := flags.Int("slow-interval", 0, "慢速采样间隔（秒）")
	metrics := flags.String("metrics", "", "all、none 或逗号分隔的指标 key")
	dataRecording := flags.String("data-recording", "", "on 或 off")
	cloudSync := flags.String("cloud-sync", "", "on 或 off")
	autoRestart := flags.String("auto-restart", "", "on 或 off")
	autoStart := flags.String("auto-start", "", "on 或 off")
	secretStdin := flags.Bool("secret-stdin", false, "从 stdin 读取访问密钥")
	if err := flags.Parse(args); err != nil {
		return err
	}

	cfg, err := client.getConfig()
	if err != nil {
		return err
	}
	changed := false
	if strings.TrimSpace(*serverURL) != "" {
		cfg.Connection.ServerURL = strings.TrimSpace(*serverURL)
		changed = true
	}
	if strings.TrimSpace(*deviceID) != "" {
		cfg.Connection.DeviceID = strings.TrimSpace(*deviceID)
		changed = true
	}
	if strings.TrimSpace(*hostname) != "" {
		cfg.Connection.Hostname = strings.TrimSpace(*hostname)
		changed = true
	}
	if *normalInterval > 0 {
		cfg.Sampling.NormalIntervalSeconds = *normalInterval
		changed = true
	}
	if *slowInterval > 0 {
		cfg.Sampling.SlowIntervalSeconds = *slowInterval
		changed = true
	}
	if *metrics != "" {
		parsed, err := parseMetrics(*metrics)
		if err != nil {
			return err
		}
		cfg.EnabledMetrics = parsed
		changed = true
	}
	if *secretStdin {
		secret, err := io.ReadAll(os.Stdin)
		if err != nil {
			return fmt.Errorf("read secret from stdin: %w", err)
		}
		cfg.Connection.Secret = strings.TrimSpace(string(secret))
		changed = true
	}
	for _, item := range []struct {
		value  string
		target *bool
		name   string
	}{
		{*dataRecording, &cfg.DataRecordingEnabled, "data-recording"},
		{*cloudSync, &cfg.CloudSyncEnabled, "cloud-sync"},
		{*autoRestart, &cfg.AutoRestartCollector, "auto-restart"},
		{*autoStart, &cfg.AutoStartCollector, "auto-start"},
	} {
		if strings.TrimSpace(item.value) == "" {
			continue
		}
		parsed, err := parseBool(item.value)
		if err != nil {
			return fmt.Errorf("--%s: %w", item.name, err)
		}
		*item.target = parsed
		changed = true
	}
	if !changed {
		return errors.New("no configuration changes; use dsc config or dsc config set --server-url ...")
	}
	if err := client.putConfig(cfg); err != nil {
		return err
	}
	fmt.Printf("配置已保存到 %s\n", cfgPathFromClient(client))
	return nil
}

func runUI() error {
	if !isInteractiveInput() {
		printUsage()
		return errors.New("dsc UI requires an interactive terminal")
	}
	client, err := ensureClient()
	if err != nil {
		return err
	}
	reader := bufio.NewReader(os.Stdin)
	fmt.Println("观澜 CLI UI 已启动。退出页面不会停止后台 Agent。")

	for {
		state, stateErr := client.getState()
		if stateErr != nil {
			return stateErr
		}
		clearScreen()
		printDashboard(state)
		fmt.Println()
		fmt.Println("[1] 中枢连接   [2] 采样设置   [3] 指标选择")
		fmt.Println("[4] 硬件探针   [5] 运行控制   [6] 诊断")
		fmt.Println("[q] 退出（后台继续运行）")
		choice, err := readLine(reader, "\n请选择: ", "")
		if err != nil {
			return err
		}
		var actionErr error
		switch strings.ToLower(strings.TrimSpace(choice)) {
		case "1":
			actionErr = editConnection(client, reader)
		case "2":
			actionErr = editSampling(client, reader)
		case "3":
			actionErr = editMetrics(client, reader)
		case "4":
			actionErr = editProbes(client, reader)
		case "5":
			actionErr = controlUI(client, reader)
		case "6":
			actionErr = doctorUI(client)
		case "q", "quit", "exit":
			fmt.Println("已退出 UI；后台 Agent 仍继续运行。")
			return nil
		default:
			fmt.Println("无效选择。")
		}
		if actionErr != nil {
			fmt.Printf("操作失败: %v\n", actionErr)
		}
		if actionErr != nil || strings.TrimSpace(choice) != "q" {
			pause(reader)
		}
	}
}

func editConnection(client *backendClient, reader *bufio.Reader) error {
	cfg, err := client.getConfig()
	if err != nil {
		return err
	}
	fmt.Println("\n中枢连接配置（直接回车保留当前值）")
	if cfg.Connection.ServerURL, err = promptValue(reader, "中枢地址", cfg.Connection.ServerURL); err != nil {
		return err
	}
	secret, err := promptSecret(reader, "访问密钥（回车保留，输入 - 清空）: ")
	if err != nil {
		return err
	}
	if secret != "" {
		if secret == "-" {
			cfg.Connection.Secret = ""
		} else {
			cfg.Connection.Secret = secret
		}
	}
	if cfg.Connection.DeviceID, err = promptValue(reader, "设备 ID", cfg.Connection.DeviceID); err != nil {
		return err
	}
	if cfg.Connection.Hostname, err = promptValue(reader, "设备名称", cfg.Connection.Hostname); err != nil {
		return err
	}
	if err := client.putConfig(cfg); err != nil {
		return err
	}
	fmt.Println("连接配置已保存。")
	return nil
}

func editSampling(client *backendClient, reader *bufio.Reader) error {
	cfg, err := client.getConfig()
	if err != nil {
		return err
	}
	fmt.Println("\n采样配置（秒，直接回车保留当前值）")
	if cfg.Sampling.NormalIntervalSeconds, err = promptInt(reader, "普通采样间隔", cfg.Sampling.NormalIntervalSeconds, 1); err != nil {
		return err
	}
	if cfg.Sampling.SlowIntervalSeconds, err = promptInt(reader, "慢速采样间隔", cfg.Sampling.SlowIntervalSeconds, 1); err != nil {
		return err
	}
	if cfg.DataRecordingEnabled, err = promptBool(reader, "是否记录并上传数据", cfg.DataRecordingEnabled); err != nil {
		return err
	}
	if cfg.AutoStartCollector, err = promptBool(reader, "backend 启动时自动启动采集器", cfg.AutoStartCollector); err != nil {
		return err
	}
	if cfg.AutoRestartCollector, err = promptBool(reader, "采集器异常时自动重启", cfg.AutoRestartCollector); err != nil {
		return err
	}
	if cfg.CloudSyncEnabled, err = promptBool(reader, "是否允许同步展示配置", cfg.CloudSyncEnabled); err != nil {
		return err
	}
	if err := client.putConfig(cfg); err != nil {
		return err
	}
	fmt.Println("采样和运行配置已保存。")
	return nil
}

func editMetrics(client *backendClient, reader *bufio.Reader) error {
	cfg, err := client.getConfig()
	if err != nil {
		return err
	}
	fmt.Println("\n当前指标:")
	fmt.Println(strings.Join(cfg.EnabledMetrics, ", "))
	fmt.Println("输入 all 启用全部，none 停用全部，或输入逗号分隔的指标 key。")
	value, err := readLine(reader, "指标: ", "")
	if err != nil {
		return err
	}
	if strings.TrimSpace(value) == "" {
		return nil
	}
	metrics, err := parseMetrics(value)
	if err != nil {
		return err
	}
	cfg.EnabledMetrics = metrics
	if err := client.putConfig(cfg); err != nil {
		return err
	}
	fmt.Println("指标配置已保存。")
	return nil
}

func editProbes(client *backendClient, reader *bufio.Reader) error {
	cfg, err := client.getConfig()
	if err != nil {
		return err
	}
	fmt.Println("\n硬件探针配置（回车保留当前值）")
	for index := range cfg.ProbeSelections {
		selection := &cfg.ProbeSelections[index]
		fmt.Printf("\n目标: %s\n", selection.Target)
		if selection.Provider, err = promptValue(reader, "提供者", selection.Provider); err != nil {
			return err
		}
		if selection.Enabled, err = promptBool(reader, "是否启用", selection.Enabled); err != nil {
			return err
		}
	}
	if err := client.putConfig(cfg); err != nil {
		return err
	}
	fmt.Println("探针配置已保存。")
	return nil
}

func controlUI(client *backendClient, reader *bufio.Reader) error {
	fmt.Println("\n[1] 启动采集器  [2] 停止采集器  [3] 检查连接")
	fmt.Println("[4] 探针检测    [5] 推送展示配置")
	choice, err := readLine(reader, "请选择: ", "")
	if err != nil {
		return err
	}
	var state backendState
	switch strings.TrimSpace(choice) {
	case "1":
		state, err = client.control("/api/control/start", nil)
	case "2":
		state, err = client.control("/api/control/stop", nil)
	case "3":
		var result connectionCheckResult
		err = client.request(http.MethodPost, "/api/control/check-connection", nil, &result)
		fmt.Printf("%s\n", result.Message)
		if result.OK {
			fmt.Println("连接检查通过。")
		} else {
			fmt.Println("连接检查未通过。")
		}
	case "4":
		state, err = client.control("/api/probes/detect", nil)
		if err == nil {
			fmt.Printf("检测到 %d 个目标类别。\n", len(state.DetectedTargets))
		}
	case "5":
		state, err = client.control("/api/cloud/push", nil)
	default:
		return errors.New("无效选择")
	}
	if err != nil {
		return err
	}
	if state.ConfigPath != "" {
		printStateSummary(&state)
	}
	return nil
}

func doctorUI(client *backendClient) error {
	state, err := client.getState()
	if err != nil {
		return err
	}
	printStateSummary(state)
	var result connectionCheckResult
	checkErr := client.request(http.MethodPost, "/api/control/check-connection", nil, &result)
	if result.Message != "" {
		fmt.Printf("连接检查: %s\n", result.Message)
	}
	if checkErr != nil && result.Message == "" {
		fmt.Printf("连接检查: %v\n", checkErr)
	}
	return nil
}

func ensureClient() (*backendClient, error) {
	root, err := configRoot()
	if err != nil {
		return nil, err
	}
	if client, _, err := loadExistingClientAt(root); err == nil {
		return client, nil
	} else if !errors.Is(err, errRuntimeNotFound) {
		if record, loadErr := loadRuntime(root); loadErr == nil {
			terminateProcess(record.PID)
		}
		_ = os.Remove(filepath.Join(root, runtimeFileName))
	}
	return startBackend(root)
}

func loadExistingClient() (*backendClient, *runtimeRecord, error) {
	root, err := configRoot()
	if err != nil {
		return nil, nil, err
	}
	return loadExistingClientAt(root)
}

func loadExistingClientAt(root string) (*backendClient, *runtimeRecord, error) {
	record, err := loadRuntime(root)
	if err != nil {
		return nil, nil, err
	}
	client := newBackendClient(record)
	if _, err := client.getState(); err != nil {
		return nil, record, fmt.Errorf("connect backend: %w", err)
	}
	return client, record, nil
}

func startBackend(root string) (*backendClient, error) {
	exeDir, err := executableDir()
	if err != nil {
		return nil, err
	}
	backendPath := filepath.Join(exeDir, platformBinaryName("device-state-console-agent-backend"))
	collectorPath := filepath.Join(exeDir, platformBinaryName("device-state-console-agent"))
	if _, err := os.Stat(backendPath); err != nil {
		return nil, fmt.Errorf("backend binary is missing: %s", backendPath)
	}
	if _, err := os.Stat(collectorPath); err != nil {
		return nil, fmt.Errorf("collector binary is missing: %s", collectorPath)
	}
	port, err := reserveLoopbackPort()
	if err != nil {
		return nil, err
	}
	token, err := randomToken()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create config directory: %w", err)
	}
	logPath := filepath.Join(root, processLogName)
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open backend log: %w", err)
	}
	args := []string{
		"--listen", "127.0.0.1:" + strconv.Itoa(port),
		"--bundle-root", exeDir,
		"--config-root", root,
		"--child-binary", collectorPath,
		"--local-token", token,
	}
	cmd := exec.Command(backendPath, args...)
	cmd.Dir = exeDir
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	detachCommand(cmd)
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return nil, fmt.Errorf("start backend: %w", err)
	}
	_ = logFile.Close()
	record := &runtimeRecord{
		PID:       cmd.Process.Pid,
		Port:      port,
		Token:     token,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := writeRuntime(root, record); err != nil {
		terminateProcess(record.PID)
		return nil, err
	}
	client := newBackendClient(record)
	deadline := time.Now().Add(backendWait)
	var lastErr error
	for time.Now().Before(deadline) {
		if _, err := client.getState(); err == nil {
			return client, nil
		} else {
			lastErr = err
		}
		time.Sleep(120 * time.Millisecond)
	}
	terminateProcess(record.PID)
	_ = os.Remove(filepath.Join(root, runtimeFileName))
	return nil, fmt.Errorf("backend did not become ready: %v; see %s", lastErr, logPath)
}

func newBackendClient(record *runtimeRecord) *backendClient {
	return &backendClient{
		baseURL: "http://127.0.0.1:" + strconv.Itoa(record.Port),
		token:   record.Token,
		http:    &http.Client{Timeout: backendRequestTTL},
	}
}

func (c *backendClient) request(method, endpoint string, payload any, output any) error {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	request, err := http.NewRequest(method, c.baseURL+endpoint, body)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-DSC-Local-Token", c.token)
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return readErr
	}
	if output != nil && len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, output); err != nil {
			return fmt.Errorf("decode backend response: %w", err)
		}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		detail := strings.TrimSpace(string(raw))
		if len(detail) > 500 {
			detail = detail[:500]
		}
		return fmt.Errorf("backend HTTP %d: %s", response.StatusCode, detail)
	}
	return nil
}

func (c *backendClient) getState() (*backendState, error) {
	var state backendState
	if err := c.request(http.MethodGet, "/api/state", nil, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func (c *backendClient) getConfig() (agentLocalConfig, error) {
	var cfg agentLocalConfig
	if err := c.request(http.MethodGet, "/api/config", nil, &cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func (c *backendClient) putConfig(cfg agentLocalConfig) error {
	return c.request(http.MethodPut, "/api/config", cfg, nil)
}

func (c *backendClient) control(endpoint string, output any) (backendState, error) {
	var state backendState
	err := c.request(http.MethodPost, endpoint, nil, &state)
	if output != nil {
		if raw, marshalErr := json.Marshal(state); marshalErr == nil {
			_ = json.Unmarshal(raw, output)
		}
	}
	return state, err
}

func configRoot() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("DSC_CLI_CONFIG_ROOT")); configured != "" {
		resolved, err := filepath.Abs(configured)
		if err != nil {
			return "", err
		}
		return resolved, nil
	}
	root, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}
	return filepath.Join(root, "device-state-console"), nil
}

func executableDir() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	return filepath.Dir(executable), nil
}

func platformBinaryName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

func reserveLoopbackPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("reserve local port: %w", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func randomToken() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func runtimePath(root string) string {
	return filepath.Join(root, runtimeFileName)
}

func loadRuntime(root string) (*runtimeRecord, error) {
	raw, err := os.ReadFile(runtimePath(root))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, errRuntimeNotFound
		}
		return nil, err
	}
	var record runtimeRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, fmt.Errorf("decode runtime state: %w", err)
	}
	if record.PID <= 0 || record.Port <= 0 || strings.TrimSpace(record.Token) == "" {
		return nil, errors.New("runtime state is incomplete")
	}
	return &record, nil
}

func writeRuntime(root string, record *runtimeRecord) error {
	raw, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(root, ".agent-ui.runtime-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(raw); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, runtimePath(root))
}

func terminateProcess(pid int) {
	if pid <= 0 {
		return
	}
	process, err := os.FindProcess(pid)
	if err == nil {
		_ = process.Kill()
	}
}

func printDashboard(state *backendState) {
	fmt.Printf("观澜 CLI %s (%s)\n", BuildVersion, BuildChannel)
	fmt.Println("────────────────────────────────────────")
	collector := "已停止"
	if state.Running {
		collector = "运行中"
	}
	fmt.Printf("采集器: %-8s  连接: %s\n", collector, valueOr(state.ConnectionStatus, "unknown"))
	fmt.Printf("中枢地址: %s\n", valueOr(state.Config.Connection.ServerURL, "未配置"))
	fmt.Printf("设备: %s (%s)\n", valueOr(state.Config.Connection.DeviceID, "未配置"), valueOr(state.Config.Connection.Hostname, "未配置"))
	fmt.Printf("上传间隔: %d 秒  待上传: %d 条\n", state.EffectiveUploadIntervalSeconds, state.PendingSampleCount)
	if state.LastUploadError != "" {
		fmt.Printf("最近错误: %s\n", state.LastUploadError)
	}
}

func printStateSummary(state *backendState) {
	collector := "stopped"
	if state.Running {
		collector = "running"
	}
	fmt.Printf("采集器: %s\n", collector)
	fmt.Printf("连接状态: %s\n", valueOr(state.ConnectionStatus, "unknown"))
	fmt.Printf("配置文件: %s\n", valueOr(state.ConfigPath, "unknown"))
	fmt.Printf("诊断日志: %s\n", valueOr(state.DiagnosticsPath, "unknown"))
	fmt.Printf("最近上传: %s\n", valueOr(state.LastUploadAt, "暂无"))
	fmt.Printf("待上传样本: %d 条（%d bytes）\n", state.PendingSampleCount, state.PendingBytes)
	if state.LastUploadError != "" {
		fmt.Printf("最近上传错误: %s\n", state.LastUploadError)
	}
}

func printConfig(cfg agentLocalConfig) {
	redacted := redactConfig(cfg)
	raw, err := json.MarshalIndent(redacted, "", "  ")
	if err != nil {
		fmt.Printf("配置无法序列化: %v\n", err)
		return
	}
	fmt.Println(string(raw))
}

func redactConfig(cfg agentLocalConfig) agentLocalConfig {
	cfg.Connection.Secret = ""
	return cfg
}

func redactState(state *backendState) backendState {
	copy := *state
	copy.Config = redactConfig(copy.Config)
	return copy
}

func writeOutputJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func promptValue(reader *bufio.Reader, label, current string) (string, error) {
	return readLine(reader, fmt.Sprintf("%s [%s]: ", label, valueOr(current, "空")), current)
}

func promptInt(reader *bufio.Reader, label string, current, minimum int) (int, error) {
	value, err := readLine(reader, fmt.Sprintf("%s [%d]: ", label, current), "")
	if err != nil {
		return current, err
	}
	if strings.TrimSpace(value) == "" {
		return current, nil
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < minimum {
		return current, fmt.Errorf("%s 必须是大于等于 %d 的整数", label, minimum)
	}
	return parsed, nil
}

func promptBool(reader *bufio.Reader, label string, current bool) (bool, error) {
	value, err := readLine(reader, fmt.Sprintf("%s [%s] (y/n): ", label, boolLabel(current)), "")
	if err != nil {
		return current, err
	}
	if strings.TrimSpace(value) == "" {
		return current, nil
	}
	return parseBool(value)
}

func promptSecret(reader *bufio.Reader, prompt string) (string, error) {
	if runtime.GOOS == "windows" {
		command := exec.Command("powershell.exe", "-NoProfile", "-Command", `$secure=Read-Host -Prompt '访问密钥' -AsSecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}`)
		command.Stdin = os.Stdin
		command.Stderr = os.Stderr
		if output, err := command.Output(); err == nil {
			return strings.TrimSpace(string(output)), nil
		}
	}

	fmt.Print(prompt)
	if isInteractiveInput() {
		echoOff := exec.Command("stty", "-echo")
		echoOff.Stdin = os.Stdin
		echoOff.Stdout = io.Discard
		echoOff.Stderr = io.Discard
		if err := echoOff.Run(); err == nil {
			value, readErr := reader.ReadString('\n')
			echoOn := exec.Command("stty", "echo")
			echoOn.Stdin = os.Stdin
			_ = echoOn.Run()
			fmt.Println()
			return strings.TrimSpace(value), readErr
		}
	}
	value, err := reader.ReadString('\n')
	fmt.Println()
	return strings.TrimSpace(value), err
}

func readLine(reader *bufio.Reader, prompt, fallback string) (string, error) {
	fmt.Print(prompt)
	value, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return fallback, err
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback, nil
	}
	return value, nil
}

func pause(reader *bufio.Reader) {
	_, _ = readLine(reader, "\n按回车继续...", "")
}

func clearScreen() {
	fmt.Print("\033[2J\033[H")
}

func isInteractiveInput() bool {
	info, err := os.Stdin.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func parseMetrics(value string) ([]string, error) {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "all" {
		return append([]string(nil), allMetricKeys...), nil
	}
	if trimmed == "none" {
		return []string{}, nil
	}
	known := map[string]struct{}{}
	for _, key := range allMetricKeys {
		known[key] = struct{}{}
	}
	result := make([]string, 0)
	seen := map[string]struct{}{}
	for _, item := range strings.Split(value, ",") {
		key := strings.TrimSpace(item)
		if key == "" {
			continue
		}
		if _, ok := known[key]; !ok {
			return nil, fmt.Errorf("未知指标 key %q", key)
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, key)
	}
	return result, nil
}

func parseBool(value string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "y", "on":
		return true, nil
	case "0", "false", "no", "n", "off":
		return false, nil
	default:
		return false, errors.New("请输入 on/off、y/n 或 true/false")
	}
}

func boolLabel(value bool) string {
	if value {
		return "on"
	}
	return "off"
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func cfgPathFromClient(client *backendClient) string {
	_ = client
	root, err := configRoot()
	if err != nil {
		return "unknown"
	}
	return filepath.Join(root, "agent-ui.config.json")
}
