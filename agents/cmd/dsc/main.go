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
	"math"
	"net"
	"net/http"
	"net/url"
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
	currentConfigVersion       = 1
	runtimeFileName            = "agent-ui.runtime.json"
	processLogName             = "agent-ui.process.log"
	localTokenFileName         = "agent-ui.local-token"
	backendWait                = 8 * time.Second
	backendRequestTTL          = 5 * time.Second
	maxConfigFileBytes         = 256 * 1024
	maxBackendResponseBytes    = 2 * 1024 * 1024
	maxSamplingIntervalSeconds = 86400
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

type backendState struct {
	Running                        bool                       `json:"running"`
	ConnectionStatus               string                     `json:"connectionStatus"`
	LastChildLog                   string                     `json:"lastChildLog,omitempty"`
	LastUploadAt                   string                     `json:"lastUploadAt,omitempty"`
	LastCloudSyncAt                string                     `json:"lastCloudSyncAt,omitempty"`
	LastCloudSyncError             string                     `json:"lastCloudSyncError,omitempty"`
	CloudConfigPending             bool                       `json:"cloudConfigPending"`
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
	LastDetectAt                   string                     `json:"lastDetectAt,omitempty"`
	TemperatureSources             []temperatureSourceReading `json:"temperatureSources"`
	TemperatureSensorBackends      []sensorBackendStatus      `json:"temperatureSensorBackends"`
	TemperatureProbeError          string                     `json:"temperatureProbeError,omitempty"`
}

type metricDefinition struct {
	Key   string
	Label string
}

type metricGroupDefinition struct {
	Label string
	Items []metricDefinition
}

var metricGroups = []metricGroupDefinition{
	{Label: "处理器", Items: []metricDefinition{
		{Key: "cpuUsage", Label: "CPU 使用率"},
		{Key: "cpuFrequency", Label: "CPU 频率"},
		{Key: "cpuTemperature", Label: "CPU 温度"},
		{Key: "cpuTopology", Label: "核心、线程与 L3 缓存"},
		{Key: "systemOverview", Label: "系统概览"},
	}},
	{Label: "显卡", Items: []metricDefinition{
		{Key: "gpuUsage", Label: "GPU 使用率"},
		{Key: "gpuEncode", Label: "编码负载"},
		{Key: "gpuDecode", Label: "解码负载"},
		{Key: "gpuFrequency", Label: "GPU 频率"},
		{Key: "gpuMemory", Label: "GPU 内存使用"},
		{Key: "gpuTemperature", Label: "GPU 温度"},
		{Key: "gpuDriverInfo", Label: "驱动信息"},
	}},
	{Label: "内存", Items: []metricDefinition{
		{Key: "memoryUsage", Label: "内存使用率"},
		{Key: "swapUsage", Label: "交换分区"},
		{Key: "memoryAvailable", Label: "可用内存"},
		{Key: "memoryCached", Label: "缓存内存"},
		{Key: "memoryCommitted", Label: "已提交内存"},
		{Key: "memoryHardware", Label: "内存硬件信息"},
	}},
	{Label: "磁盘", Items: []metricDefinition{
		{Key: "diskUsage", Label: "磁盘使用率"},
		{Key: "diskRead", Label: "读取速率"},
		{Key: "diskWrite", Label: "写入速率"},
		{Key: "diskMetadata", Label: "磁盘信息"},
		{Key: "diskActivity", Label: "活动状态"},
		{Key: "diskHealth", Label: "健康状态"},
	}},
	{Label: "网络", Items: []metricDefinition{
		{Key: "networkRxRate", Label: "接收速率"},
		{Key: "networkTxRate", Label: "发送速率"},
		{Key: "networkTraffic", Label: "流量统计"},
		{Key: "networkIdentity", Label: "网卡信息"},
	}},
	{Label: "风扇", Items: []metricDefinition{
		{Key: "fanRpm", Label: "转速"},
		{Key: "fanControl", Label: "控制状态"},
		{Key: "fanTargetTemperature", Label: "目标温度"},
		{Key: "fanPwm", Label: "PWM 占空比"},
		{Key: "fanChannelState", Label: "通道状态"},
		{Key: "fanNote", Label: "风扇备注"},
	}},
	{Label: "温度源", Items: []metricDefinition{
		{Key: "temperatureSources", Label: "全部温度传感器"},
	}},
}

var metricLabels = buildMetricLabels()

var probeTargetLabels = map[string]string{
	"cpu":        "CPU 处理器",
	"gpu":        "GPU 显卡",
	"memory":     "内存",
	"disk":       "磁盘",
	"network":    "网络",
	"fan":        "风扇",
	"connection": "连接",
}

var probeProviderLabels = map[string]string{
	"builtin":              "内置采集",
	"gopsutil":             "系统采集（gopsutil）",
	"hwmon":                "Linux hwmon",
	"wmi":                  "Windows WMI",
	"librehardwaremonitor": "LibreHardwareMonitor",
	"libreHardwareMonitor": "LibreHardwareMonitor",
	"openHardwareMonitor":  "OpenHardwareMonitor",
	"redfish":              "Redfish",
	"disabled":             "禁用",
}

var temperatureRoleLabels = map[string]string{
	"cpu_package":       "CPU 封装",
	"cpu_core":          "CPU 核心",
	"gpu_core":          "GPU 核心",
	"gpu_hotspot":       "GPU 热点",
	"storage_composite": "磁盘综合温度",
	"storage_sensor":    "磁盘附加传感器",
	"motherboard":       "主板温度",
	"superio":           "SuperIO 温度",
	"peci":              "PECI 温度",
	"acpi_zone":         "ACPI 热区",
	"threshold":         "温度阈值",
	"derived":           "派生温度",
	"unknown":           "未知温度源",
}

var temperatureSourceLabels = map[string]string{
	"librehardwaremonitor":        "LibreHardwareMonitor",
	"linux-hwmon":                 "Linux hwmon",
	"linux-thermal":               "Linux thermal",
	"smartctl":                    "smartctl / SMART",
	"windows-storage-reliability": "Windows 存储可靠性",
	"cpu-package-shared":          "CPU Package 共享",
}

var temperatureStatusLabels = map[string]string{
	"valid":       "正常",
	"threshold":   "阈值",
	"invalid":     "无效值",
	"unavailable": "不可用",
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
	case "probes":
		return runProbes(args[1:])
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
	fmt.Println("  dsc probes status [--json]  查看最近一次探测结果")
	fmt.Println("  dsc probes detect [--json]  强制重新探测硬件")
	fmt.Println("  dsc config get [--json]     输出本地配置（密钥会脱敏）")
	fmt.Println("  dsc config set [options]    无界面修改配置")
	fmt.Println("  dsc config validate [file]  校验 JSON 配置")
	fmt.Println("  dsc config import --file    导入 JSON 配置")
	fmt.Println("  dsc config export [--file]  导出脱敏 JSON 配置")
	fmt.Println("  dsc config push             推送展示配置到中枢")
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
	_ = os.Remove(localTokenPath(root))
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

	detected, detectErr := detectAndRefresh(client)
	if detectErr != nil {
		fmt.Printf("探针检测失败: %v\n", detectErr)
	} else {
		fmt.Println("探针检测完成:")
		printProbeDetection(detected)
	}
	if checkErr != nil {
		return fmt.Errorf("connection check failed: %w", checkErr)
	}
	if !result.OK {
		return fmt.Errorf("connection check failed: %s", valueOr(result.Status, "not_ok"))
	}
	if detectErr != nil {
		return fmt.Errorf("probe detection failed: %w", detectErr)
	}
	return nil
}

func runProbes(args []string) error {
	jsonOutput := contains(args, "--json")
	command := "status"
	for _, arg := range args {
		if strings.HasPrefix(arg, "--") {
			continue
		}
		command = strings.ToLower(strings.TrimSpace(arg))
		break
	}
	client, err := ensureClient()
	if err != nil {
		return err
	}

	var state *backendState
	switch command {
	case "status":
		state, err = client.getState()
	case "detect", "redetect", "refresh":
		state, err = detectAndRefresh(client)
	default:
		return fmt.Errorf("unknown probes command %q; use status or detect", command)
	}
	if err != nil {
		return err
	}
	if jsonOutput {
		return writeOutputJSON(redactState(state))
	}
	printProbeDetection(state)
	return nil
}

func runConfig(args []string) error {
	if len(args) == 0 || args[0] == "ui" {
		return runUI()
	}
	if args[0] == "validate" {
		return runConfigValidate(args[1:])
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
	case "import":
		return runConfigImport(client, args[1:])
	case "export":
		return runConfigExport(client, args[1:])
	case "push":
		return runConfigPush(client)
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
	enabledDeviceIDsJSON := flags.String("enabled-device-ids-json", "", "设备实例启用映射 JSON")
	instanceMetricConfigJSON := flags.String("instance-metric-config-json", "", "实例指标覆盖 JSON")
	probeSelectionsJSON := flags.String("probe-selections-json", "", "探针选择 JSON")
	virtualizationJSON := flags.String("virtualization-json", "", "虚拟化非敏感配置 JSON")
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
	state, err := client.getState()
	if err != nil {
		return err
	}
	changed := false
	displayChanged := false
	detectionChanged := false
	if strings.TrimSpace(*serverURL) != "" {
		cfg.Connection.ServerURL = strings.TrimSpace(*serverURL)
		changed = true
	}
	if strings.TrimSpace(*deviceID) != "" {
		cfg.Connection.DeviceID = strings.TrimSpace(*deviceID)
		changed = true
		displayChanged = true
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
		displayChanged = true
		detectionChanged = true
	}
	if strings.TrimSpace(*enabledDeviceIDsJSON) != "" {
		if err := decodeJSON(*enabledDeviceIDsJSON, &cfg.EnabledDeviceIDs); err != nil {
			return fmt.Errorf("--enabled-device-ids-json: %w", err)
		}
		changed = true
		displayChanged = true
	}
	if strings.TrimSpace(*instanceMetricConfigJSON) != "" {
		if err := decodeJSON(*instanceMetricConfigJSON, &cfg.InstanceMetricConfig); err != nil {
			return fmt.Errorf("--instance-metric-config-json: %w", err)
		}
		changed = true
		displayChanged = true
	}
	if strings.TrimSpace(*probeSelectionsJSON) != "" {
		if err := decodeJSON(*probeSelectionsJSON, &cfg.ProbeSelections); err != nil {
			return fmt.Errorf("--probe-selections-json: %w", err)
		}
		changed = true
		displayChanged = true
		detectionChanged = true
	}
	if strings.TrimSpace(*virtualizationJSON) != "" {
		if err := decodeJSON(*virtualizationJSON, &cfg.Virtualization); err != nil {
			return fmt.Errorf("--virtualization-json: %w", err)
		}
		changed = true
	}
	if *secretStdin {
		secret, err := io.ReadAll(io.LimitReader(os.Stdin, 4097))
		if err != nil {
			return fmt.Errorf("read secret from stdin: %w", err)
		}
		if len(secret) > 4096 {
			return errors.New("secret is too large")
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
	if err := validateAgentConfig(cfg, state.SupportedProbePlans); err != nil {
		return err
	}
	if err := saveConfig(client, cfg, displayChanged); err != nil {
		return err
	}
	if detectionChanged {
		if _, err := detectAndRefresh(client); err != nil {
			return fmt.Errorf("配置已保存，但重新探测失败: %w", err)
		}
	}
	fmt.Printf("配置已保存到 %s\n", cfgPathFromClient(client))
	return nil
}

func runConfigValidate(args []string) error {
	flags := flag.NewFlagSet("dsc config validate", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	file := flags.String("file", "", "JSON 配置文件路径")
	if err := flags.Parse(args); err != nil {
		return err
	}
	path := strings.TrimSpace(*file)
	if path == "" && flags.NArg() > 0 {
		path = flags.Arg(0)
	}
	if path == "" {
		root, err := configRoot()
		if err != nil {
			return err
		}
		path = filepath.Join(root, "agent-ui.config.json")
	}
	cfg, err := readConfigJSON(path)
	if err != nil {
		return err
	}
	if err := validateAgentConfig(cfg, nil); err != nil {
		return err
	}
	fmt.Printf("配置校验通过: %s\n", path)
	return nil
}

func runConfigImport(client *backendClient, args []string) error {
	flags := flag.NewFlagSet("dsc config import", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	file := flags.String("file", "", "JSON 配置文件路径")
	secretStdin := flags.Bool("secret-stdin", false, "从 stdin 读取访问密钥")
	clearSecret := flags.Bool("clear-secret", false, "清空当前访问密钥")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*file) == "" {
		return errors.New("config import requires --file")
	}
	cfg, err := readConfigJSON(*file)
	if err != nil {
		return err
	}
	current, err := client.getConfig()
	if err != nil {
		return err
	}
	if *clearSecret {
		cfg.Connection.Secret = ""
	} else if strings.TrimSpace(cfg.Connection.Secret) == "" {
		cfg.Connection.Secret = current.Connection.Secret
	}
	if *secretStdin {
		secret, readErr := io.ReadAll(io.LimitReader(os.Stdin, 4097))
		if readErr != nil {
			return fmt.Errorf("read secret from stdin: %w", readErr)
		}
		if len(secret) > 4096 {
			return errors.New("secret is too large")
		}
		cfg.Connection.Secret = strings.TrimSpace(string(secret))
	}
	state, err := client.getState()
	if err != nil {
		return err
	}
	if err := validateAgentConfig(cfg, state.SupportedProbePlans); err != nil {
		return err
	}
	if err := client.putConfig(cfg); err != nil {
		return err
	}
	if _, err := detectAndRefresh(client); err != nil {
		return fmt.Errorf("配置已导入，但重新探测失败: %w", err)
	}
	fmt.Printf("配置已导入: %s\n", *file)
	return nil
}

func runConfigExport(client *backendClient, args []string) error {
	flags := flag.NewFlagSet("dsc config export", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	file := flags.String("file", "", "输出 JSON 配置文件路径")
	if err := flags.Parse(args); err != nil {
		return err
	}
	cfg, err := client.getConfig()
	if err != nil {
		return err
	}
	redacted := redactConfig(cfg)
	if strings.TrimSpace(*file) == "" {
		return writeOutputJSON(redacted)
	}
	if err := writeJSONFile(*file, redacted); err != nil {
		return err
	}
	fmt.Printf("已导出脱敏配置: %s\n", *file)
	return nil
}

func runConfigPush(client *backendClient) error {
	if err := pushCloudConfig(client); err != nil {
		return err
	}
	fmt.Println("展示配置已成功同步到中枢。")
	return nil
}

func saveConfig(client *backendClient, cfg agentLocalConfig, pushDisplayConfig bool) error {
	if err := client.putConfig(cfg); err != nil {
		return err
	}
	if !pushDisplayConfig {
		return nil
	}
	if !cfg.CloudSyncEnabled {
		fmt.Println("本地配置已保存；云同步已关闭，展示配置暂不推送。")
		return nil
	}
	if err := pushCloudConfig(client); err != nil {
		fmt.Printf("本地配置已保存，但展示配置推送失败，稍后可运行 dsc config push 重试: %v\n", err)
		return nil
	}
	fmt.Println("展示配置已同步到中枢。")
	return nil
}

func pushCloudConfig(client *backendClient) error {
	var result struct {
		OK bool `json:"ok"`
	}
	if err := client.request(http.MethodPost, "/api/cloud/push", nil, &result); err != nil {
		return err
	}
	if !result.OK {
		return errors.New("cloud push did not succeed")
	}
	return nil
}

func readConfigJSON(path string) (agentLocalConfig, error) {
	var cfg agentLocalConfig
	raw, err := os.ReadFile(path)
	if err != nil {
		return cfg, fmt.Errorf("read config %s: %w", path, err)
	}
	if len(raw) > maxConfigFileBytes {
		return cfg, fmt.Errorf("config %s is too large", path)
	}
	if err := json.Unmarshal(bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF}), &cfg); err != nil {
		return cfg, fmt.Errorf("decode config %s: %w", path, err)
	}
	return cfg, nil
}

func writeJSONFile(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return err
	}
	_ = os.Chmod(path, 0o600)
	return nil
}

func decodeJSON(value string, target any) error {
	return json.Unmarshal([]byte(strings.TrimSpace(value)), target)
}

func validateAgentConfig(cfg agentLocalConfig, plans []probePlanSupport) error {
	if cfg.ConfigVersion > currentConfigVersion {
		return fmt.Errorf("unsupported configVersion %d", cfg.ConfigVersion)
	}
	if err := validateServerURL(cfg.Connection.ServerURL); err != nil {
		return fmt.Errorf("serverUrl: %w", err)
	}
	if cfg.Sampling.NormalIntervalSeconds < 1 || cfg.Sampling.NormalIntervalSeconds > maxSamplingIntervalSeconds {
		return fmt.Errorf("normalIntervalSeconds must be between 1 and %d", maxSamplingIntervalSeconds)
	}
	if cfg.Sampling.SlowIntervalSeconds < 1 || cfg.Sampling.SlowIntervalSeconds > maxSamplingIntervalSeconds {
		return fmt.Errorf("slowIntervalSeconds must be between 1 and %d", maxSamplingIntervalSeconds)
	}
	for _, key := range cfg.EnabledMetrics {
		if !contains(allMetricKeys, key) {
			return fmt.Errorf("unknown metric key %q", key)
		}
	}
	for instanceID, metrics := range cfg.InstanceMetricConfig {
		if strings.TrimSpace(instanceID) == "" {
			return errors.New("instanceMetricConfig contains an empty instance id")
		}
		for _, key := range metrics {
			if !contains(allMetricKeys, key) {
				return fmt.Errorf("unknown instance metric key %q for %s", key, instanceID)
			}
		}
	}
	allowed := make(map[string]map[string]bool)
	if len(plans) == 0 {
		allowed = map[string]map[string]bool{
			"connection": map[string]bool{"gopsutil": true},
			"cpu":        map[string]bool{"disabled": true, "gopsutil": true},
			"memory":     map[string]bool{"disabled": true, "gopsutil": true},
			"disk":       map[string]bool{"disabled": true, "gopsutil": true},
			"network":    map[string]bool{"disabled": true, "gopsutil": true},
			"gpu":        map[string]bool{"disabled": true, "wmi": true},
			"fan":        map[string]bool{"disabled": true, "hwmon": true, "librehardwaremonitor": true},
		}
	} else {
		for _, plan := range plans {
			providers := map[string]bool{}
			for _, provider := range plan.Providers {
				providers[provider] = true
			}
			allowed[plan.Target] = providers
		}
	}
	for _, selection := range cfg.ProbeSelections {
		target := strings.ToLower(strings.TrimSpace(selection.Target))
		providers, ok := allowed[target]
		if !ok {
			return fmt.Errorf("unsupported probe target %q", selection.Target)
		}
		if !providers[strings.TrimSpace(selection.Provider)] {
			return fmt.Errorf("unsupported provider %q for probe target %q", selection.Provider, target)
		}
	}
	if cfg.Virtualization != nil && (cfg.Virtualization.PollIntervalSeconds < 0 || cfg.Virtualization.PollIntervalSeconds > maxSamplingIntervalSeconds) {
		return fmt.Errorf("virtualization pollIntervalSeconds must be between 0 and %d", maxSamplingIntervalSeconds)
	}
	return nil
}

func validateServerURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" {
		return errors.New("invalid_server_url")
	}
	if parsed.User != nil {
		return errors.New("server_url_userinfo_not_allowed")
	}
	if strings.EqualFold(parsed.Scheme, "https") {
		return nil
	}
	if strings.EqualFold(parsed.Scheme, "http") && isPrivateNetworkHost(parsed.Hostname()) {
		return nil
	}
	return errors.New("remote_server_requires_https")
}

func isPrivateNetworkHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	parsed := net.ParseIP(host)
	return parsed != nil && (parsed.IsLoopback() || parsed.IsPrivate() || parsed.IsLinkLocalUnicast())
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
		fmt.Println("[1] 中枢连接   [2] 采样与记录 [3] 全局指标")
		fmt.Println("[4] 硬件探针   [5] 实例上报   [6] 实例指标")
		fmt.Println("[7] 运行控制   [8] 诊断       [9] 探测结果")
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
			actionErr = editInstances(client, reader)
		case "6":
			actionErr = editInstanceMetrics(client, reader)
		case "7":
			actionErr = controlUI(client, reader)
		case "8":
			actionErr = doctorUI(client)
		case "9":
			actionErr = probeStatusUI(client)
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
	if err := validateServerURL(cfg.Connection.ServerURL); err != nil {
		return fmt.Errorf("中枢地址无效: %w", err)
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
	if err := saveConfig(client, cfg, true); err != nil {
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
	if cfg.Sampling.NormalIntervalSeconds, err = promptInt(reader, "普通采样间隔", cfg.Sampling.NormalIntervalSeconds, 1, maxSamplingIntervalSeconds); err != nil {
		return err
	}
	if cfg.Sampling.SlowIntervalSeconds, err = promptInt(reader, "慢速采样间隔", cfg.Sampling.SlowIntervalSeconds, 1, maxSamplingIntervalSeconds); err != nil {
		return err
	}
	if cfg.DataRecordingEnabled, err = promptBool(reader, "是否启用采集与本地记录", cfg.DataRecordingEnabled); err != nil {
		return err
	}
	if cfg.AutoStartCollector, err = promptBool(reader, "backend 启动时自动启动采集器", cfg.AutoStartCollector); err != nil {
		return err
	}
	if cfg.AutoRestartCollector, err = promptBool(reader, "采集器异常时自动重启", cfg.AutoRestartCollector); err != nil {
		return err
	}
	if cfg.CloudSyncEnabled, err = promptBool(reader, "是否允许上传到中枢", cfg.CloudSyncEnabled); err != nil {
		return err
	}
	if err := saveConfig(client, cfg, false); err != nil {
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
	fmt.Println("\n当前指标（● 已启用，○ 未启用）:")
	printMetricCatalog(cfg.EnabledMetrics)
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
	if err := saveConfig(client, cfg, true); err != nil {
		return err
	}
	if _, err := detectAndRefresh(client); err != nil {
		return fmt.Errorf("指标配置已保存，但重新探测失败: %w", err)
	}
	fmt.Println("指标配置已保存。")
	return nil
}

func editProbes(client *backendClient, reader *bufio.Reader) error {
	cfg, err := client.getConfig()
	if err != nil {
		return err
	}
	state, err := client.getState()
	if err != nil {
		return err
	}
	if len(state.SupportedProbePlans) == 0 {
		return errors.New("backend did not provide supported probe plans")
	}
	current := make(map[string]agentProbeSelection, len(cfg.ProbeSelections))
	for _, selection := range cfg.ProbeSelections {
		current[strings.ToLower(strings.TrimSpace(selection.Target))] = selection
	}
	selections := make([]agentProbeSelection, 0, len(state.SupportedProbePlans))
	fmt.Println("\n硬件探针配置（输入编号或 provider，回车保留当前值）")
	for _, plan := range state.SupportedProbePlans {
		target := strings.ToLower(strings.TrimSpace(plan.Target))
		selection, exists := current[target]
		if !exists {
			selection = agentProbeSelection{Target: target, Provider: plan.Default, Enabled: plan.Default != "disabled"}
		}
		selection.Target = target
		if !contains(plan.Providers, selection.Provider) {
			selection.Provider = plan.Default
			if !contains(plan.Providers, selection.Provider) && len(plan.Providers) > 0 {
				selection.Provider = plan.Providers[0]
			}
		}
		fmt.Printf("\n目标: %s\n", displayProbeTarget(target))
		providerOptions := append([]string(nil), plan.Providers...)
		if selection.Provider, err = promptChoice(reader, "提供者", selection.Provider, providerOptions); err != nil {
			return err
		}
		if selection.Enabled, err = promptBool(reader, "是否启用", selection.Enabled); err != nil {
			return err
		}
		selections = append(selections, selection)
	}
	cfg.ProbeSelections = selections
	if err := validateAgentConfig(cfg, state.SupportedProbePlans); err != nil {
		return err
	}
	if err := saveConfig(client, cfg, true); err != nil {
		return err
	}
	state, err = detectAndRefresh(client)
	if err != nil {
		return fmt.Errorf("探针配置已保存，但重新探测失败: %w", err)
	}
	fmt.Println("探针配置已保存，探测结果已刷新。")
	printProbeDetection(state)
	return nil
}

var instanceMetricKeys = map[string][]string{
	"cpu":     []string{"cpuUsage", "cpuFrequency", "cpuTemperature", "cpuTopology", "systemOverview"},
	"gpu":     []string{"gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature", "gpuDriverInfo"},
	"disk":    []string{"diskUsage", "diskRead", "diskWrite", "diskMetadata", "diskActivity", "diskHealth"},
	"network": []string{"networkRxRate", "networkTxRate", "networkTraffic", "networkIdentity"},
}

func loadDetectedState(client *backendClient) (*backendState, error) {
	state, err := client.getState()
	if err != nil {
		return nil, err
	}
	if needsProbeDetection(state) {
		return detectAndRefresh(client)
	}
	return state, nil
}

func needsProbeDetection(state *backendState) bool {
	return state == nil || len(state.DetectedTargets) == 0 || strings.TrimSpace(state.LastDetectAt) == ""
}

func editInstances(client *backendClient, reader *bufio.Reader) error {
	state, err := loadDetectedState(client)
	if err != nil {
		return err
	}
	cfg := state.Config
	enabledDeviceIDs := cloneStringMap(cfg.EnabledDeviceIDs)
	changed := false
	for _, group := range state.DetectedTargets {
		target := strings.ToLower(strings.TrimSpace(group.Target))
		if target == "connection" || len(group.Instances) == 0 {
			continue
		}
		configured, explicit := enabledDeviceIDs[target]
		if !explicit {
			configured = make([]string, 0, len(group.Instances))
			for _, instance := range group.Instances {
				if instance.Enabled {
					configured = append(configured, instance.ID)
				}
			}
		}
		configured = uniqueStrings(configured)
		for _, instance := range group.Instances {
			current := contains(configured, instance.ID)
			value, promptErr := promptBool(reader, fmt.Sprintf("%s/%s 上报", displayProbeTarget(target), instance.Name), current)
			if promptErr != nil {
				return promptErr
			}
			if value == current {
				continue
			}
			changed = true
			if value {
				configured = appendUnique(configured, instance.ID)
			} else {
				configured = removeString(configured, instance.ID)
			}
		}
		enabledDeviceIDs[target] = uniqueStrings(configured)
	}
	if !changed {
		fmt.Println("实例配置未修改。")
		return nil
	}
	cfg.EnabledDeviceIDs = enabledDeviceIDs
	if err := saveConfig(client, cfg, true); err != nil {
		return err
	}
	fmt.Println("实例上报配置已保存。")
	return nil
}

func editInstanceMetrics(client *backendClient, reader *bufio.Reader) error {
	state, err := loadDetectedState(client)
	if err != nil {
		return err
	}
	cfg := state.Config
	overrides := cloneStringMap(cfg.InstanceMetricConfig)
	changed := false
	for _, group := range state.DetectedTargets {
		target := strings.ToLower(strings.TrimSpace(group.Target))
		options, supported := instanceMetricKeys[target]
		if !supported || len(group.Instances) == 0 {
			continue
		}
		fmt.Printf("\n%s 实例指标（可输入 inherit、none 或逗号分隔 key）\n", displayProbeTarget(target))
		fmt.Printf("可用指标: %s\n", formatMetricDefinitions(metricDefinitions(options)))
		for _, instance := range group.Instances {
			current, hasOverride := overrides[instance.ID]
			currentLabel := "跟随全局"
			if hasOverride {
				currentLabel = formatMetricKeys(current)
			}
			value, readErr := readLine(reader, fmt.Sprintf("%s [%s]: ", instance.Name, valueOr(currentLabel, "none")), "")
			if readErr != nil {
				return readErr
			}
			if strings.TrimSpace(value) == "" {
				continue
			}
			trimmed := strings.ToLower(strings.TrimSpace(value))
			if trimmed == "inherit" || trimmed == "default" {
				if hasOverride {
					delete(overrides, instance.ID)
					changed = true
				}
				continue
			}
			metrics, parseErr := parseInstanceMetrics(value, options, cfg.EnabledMetrics)
			if parseErr != nil {
				return fmt.Errorf("%s: %w", instance.Name, parseErr)
			}
			overrides[instance.ID] = metrics
			changed = true
		}
	}
	if !changed {
		fmt.Println("实例指标配置未修改。")
		return nil
	}
	cfg.InstanceMetricConfig = overrides
	if err := saveConfig(client, cfg, true); err != nil {
		return err
	}
	fmt.Println("实例指标配置已保存。")
	return nil
}

func parseInstanceMetrics(value string, allowed, global []string) ([]string, error) {
	parsed, err := parseMetrics(value)
	if err != nil {
		return nil, err
	}
	allowedSet := map[string]bool{}
	globalSet := map[string]bool{}
	for _, key := range allowed {
		allowedSet[key] = true
	}
	for _, key := range global {
		globalSet[key] = true
	}
	for _, key := range parsed {
		if !allowedSet[key] {
			return nil, fmt.Errorf("指标 %q 不适用于此实例", key)
		}
		if !globalSet[key] {
			return nil, fmt.Errorf("指标 %q 尚未在全局配置中启用", key)
		}
	}
	return parsed, nil
}

func cloneStringMap(values map[string][]string) map[string][]string {
	result := make(map[string][]string, len(values))
	for key, items := range values {
		result[key] = append([]string(nil), items...)
	}
	return result
}

func appendUnique(values []string, target string) []string {
	if contains(values, target) {
		return values
	}
	return append(values, target)
}

func removeString(values []string, target string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value != target {
			result = append(result, value)
		}
	}
	return result
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
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
		var detected *backendState
		detected, err = detectAndRefresh(client)
		if err == nil {
			state = *detected
			printProbeDetection(detected)
		}
	case "5":
		err = pushCloudConfig(client)
		if err == nil {
			fmt.Println("展示配置已成功同步到中枢。")
		}
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
	detected, detectErr := detectAndRefresh(client)
	if detectErr != nil {
		fmt.Printf("探针检测: %v\n", detectErr)
	} else {
		fmt.Println("探针检测:")
		printProbeDetection(detected)
	}
	if checkErr != nil {
		return fmt.Errorf("connection check failed: %w", checkErr)
	}
	if !result.OK {
		return fmt.Errorf("connection check failed: %s", valueOr(result.Status, "not_ok"))
	}
	if detectErr != nil {
		return fmt.Errorf("probe detection failed: %w", detectErr)
	}
	return nil
}

func probeStatusUI(client *backendClient) error {
	state, err := client.getState()
	if err != nil {
		return err
	}
	printProbeDetection(state)
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
	if err := writeSecureTextFile(localTokenPath(root), token); err != nil {
		return nil, fmt.Errorf("write local token file: %w", err)
	}
	logPath := filepath.Join(root, processLogName)
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		_ = os.Remove(localTokenPath(root))
		return nil, fmt.Errorf("open backend log: %w", err)
	}
	_ = logFile.Chmod(0o600)
	args := []string{
		"--listen", "127.0.0.1:" + strconv.Itoa(port),
		"--bundle-root", exeDir,
		"--config-root", root,
		"--child-binary", collectorPath,
		"--local-token-file", localTokenPath(root),
	}
	cmd := exec.Command(backendPath, args...)
	cmd.Dir = exeDir
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	detachCommand(cmd)
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		_ = os.Remove(localTokenPath(root))
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
		_ = os.Remove(localTokenPath(root))
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
	_ = os.Remove(localTokenPath(root))
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
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, maxBackendResponseBytes+1))
	if readErr != nil {
		return readErr
	}
	if int64(len(raw)) > maxBackendResponseBytes {
		return errors.New("backend response is too large")
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

func detectAndRefresh(client *backendClient) (*backendState, error) {
	if _, err := client.control("/api/probes/detect", nil); err != nil {
		return nil, err
	}
	return client.getState()
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

func localTokenPath(root string) string {
	return filepath.Join(root, localTokenFileName)
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

func writeSecureTextFile(path, value string) error {
	if err := os.WriteFile(path, []byte(value+"\n"), 0o600); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
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

func buildMetricLabels() map[string]string {
	labels := make(map[string]string)
	for _, group := range metricGroups {
		for _, item := range group.Items {
			labels[item.Key] = item.Label
		}
	}
	return labels
}

func metricLabel(key string) string {
	return valueOr(metricLabels[key], key)
}

func metricDefinitions(keys []string) []metricDefinition {
	definitions := make([]metricDefinition, 0, len(keys))
	for _, key := range keys {
		definitions = append(definitions, metricDefinition{Key: key, Label: metricLabel(key)})
	}
	return definitions
}

func formatMetricDefinitions(definitions []metricDefinition) string {
	if len(definitions) == 0 {
		return "无"
	}
	values := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		values = append(values, fmt.Sprintf("%s (%s)", definition.Label, definition.Key))
	}
	return strings.Join(values, ", ")
}

func formatMetricKeys(keys []string) string {
	return formatMetricDefinitions(metricDefinitions(keys))
}

func printMetricCatalog(enabled []string) {
	enabledSet := make(map[string]bool, len(enabled))
	for _, key := range enabled {
		enabledSet[key] = true
	}
	for _, group := range metricGroups {
		fmt.Printf("%s:\n", group.Label)
		for _, item := range group.Items {
			marker := "○"
			if enabledSet[item.Key] {
				marker = "●"
			}
			fmt.Printf("  %s %-18s %s\n", marker, item.Label, item.Key)
		}
	}
}

func displayProbeTarget(target string) string {
	target = strings.ToLower(strings.TrimSpace(target))
	return valueOr(probeTargetLabels[target], target)
}

func displayProbeProvider(provider string) string {
	provider = strings.TrimSpace(provider)
	return valueOr(probeProviderLabels[provider], provider)
}

func displayTemperatureRole(role string) string {
	role = strings.TrimSpace(role)
	return valueOr(temperatureRoleLabels[role], role)
}

func displayTemperatureSource(source string) string {
	source = strings.TrimSpace(source)
	return valueOr(temperatureSourceLabels[source], source)
}

func displayTemperatureStatus(status string) string {
	status = strings.TrimSpace(status)
	return valueOr(temperatureStatusLabels[status], status)
}

func temperatureValueLabel(sensor temperatureSourceReading) string {
	if sensor.CurrentC == nil || math.IsNaN(*sensor.CurrentC) || math.IsInf(*sensor.CurrentC, 0) {
		if sensor.Status == "threshold" {
			return "仅阈值"
		}
		return "—"
	}
	return fmt.Sprintf("%.1f °C", *sensor.CurrentC)
}

func temperatureLimitsLabel(sensor temperatureSourceReading) string {
	limits := make([]string, 0, 3)
	if sensor.HighC != nil {
		limits = append(limits, fmt.Sprintf("高 %.1f°C", *sensor.HighC))
	}
	if sensor.CriticalC != nil {
		limits = append(limits, fmt.Sprintf("临界 %.1f°C", *sensor.CriticalC))
	}
	if sensor.EmergencyC != nil {
		limits = append(limits, fmt.Sprintf("紧急 %.1f°C", *sensor.EmergencyC))
	}
	return strings.Join(limits, " · ")
}

func probeTargetCounts(state *backendState) (groups, instances int) {
	if state == nil {
		return 0, 0
	}
	groups = len(state.DetectedTargets)
	for _, target := range state.DetectedTargets {
		instances += len(target.Instances)
	}
	return groups, instances
}

func printProbeSummary(state *backendState) {
	if state == nil || (strings.TrimSpace(state.LastDetectAt) == "" && len(state.DetectedTargets) == 0 && len(state.TemperatureSources) == 0) {
		fmt.Println("最近探测: 尚未执行")
		return
	}
	groups, instances := probeTargetCounts(state)
	fmt.Printf("最近探测: %s（%d 个目标类别，%d 个实例，%d 个温度源）\n", valueOr(state.LastDetectAt, "时间未知"), groups, instances, len(state.TemperatureSources))
	if state.TemperatureProbeError != "" {
		fmt.Printf("温度探测警告: %s\n", state.TemperatureProbeError)
	}
}

func printProbeDetection(state *backendState) {
	if state == nil {
		fmt.Println("探测结果为空。")
		return
	}
	redacted := redactState(state)
	state = &redacted
	printProbeSummary(state)
	for _, group := range state.DetectedTargets {
		label := displayProbeTarget(group.Target)
		if strings.TrimSpace(group.Label) != "" {
			label = group.Label
		}
		fmt.Printf("  %s: %d 个实例\n", label, len(group.Instances))
		for _, instance := range group.Instances {
			detail := instance.Name
			if instance.Subtitle != "" {
				detail += " · " + instance.Subtitle
			}
			if !instance.Enabled {
				detail += " · 未启用"
			}
			fmt.Printf("    - %s [%s]\n", detail, instance.ID)
			if len(instance.Metrics) > 0 {
				fmt.Printf("      组件: %s\n", strings.Join(instance.Metrics, ", "))
			}
		}
	}

	if len(state.TemperatureSources) > 0 {
		fmt.Println("温度源:")
		for _, sensor := range state.TemperatureSources {
			name := valueOr(sensor.DisplayName, sensor.RawName)
			metadata := []string{displayTemperatureRole(sensor.Role), displayTemperatureSource(sensor.Source)}
			if sensor.Backend != "" {
				metadata = append(metadata, sensor.Backend)
			}
			metadata = append(metadata, displayTemperatureStatus(sensor.Status))
			fmt.Printf("  - %s: %s · %s\n", name, temperatureValueLabel(sensor), strings.Join(metadata, " · "))
			if limits := temperatureLimitsLabel(sensor); limits != "" {
				fmt.Printf("    阈值: %s\n", limits)
			}
			if sensor.Path != "" || sensor.Hardware != "" || sensor.Note != "" {
				details := make([]string, 0, 3)
				if sensor.Hardware != "" {
					details = append(details, "硬件="+sensor.Hardware)
				}
				if sensor.Path != "" {
					details = append(details, "路径="+sensor.Path)
				}
				if sensor.Note != "" {
					details = append(details, sensor.Note)
				}
				fmt.Printf("    %s\n", strings.Join(details, " · "))
			}
		}
	}
	if len(state.TemperatureSensorBackends) > 0 {
		fmt.Println("温度探测后端:")
		for _, backend := range state.TemperatureSensorBackends {
			status := "可用"
			if !backend.OK {
				status = "不可用"
			}
			detail := backend.Label
			if backend.Detail != "" {
				detail += " · " + backend.Detail
			}
			fmt.Printf("  - %s: %s\n", detail, status)
		}
	}
	if state.TemperatureProbeError != "" {
		fmt.Printf("温度探测错误: %s\n", state.TemperatureProbeError)
	}
}

func printDashboard(state *backendState) {
	redacted := redactState(state)
	fmt.Printf("观澜 CLI %s (%s)\n", BuildVersion, BuildChannel)
	fmt.Println("────────────────────────────────────────")
	collector := "已停止"
	if redacted.Running {
		collector = "运行中"
	}
	fmt.Printf("采集器: %-8s  连接: %s\n", collector, valueOr(redacted.ConnectionStatus, "unknown"))
	fmt.Printf("中枢地址: %s\n", valueOr(redacted.Config.Connection.ServerURL, "未配置"))
	fmt.Printf("设备: %s (%s)\n", valueOr(redacted.Config.Connection.DeviceID, "未配置"), valueOr(redacted.Config.Connection.Hostname, "未配置"))
	fmt.Printf("上传间隔: %d 秒  待上传: %d 条\n", redacted.EffectiveUploadIntervalSeconds, redacted.PendingSampleCount)
	if redacted.CloudConfigPending {
		fmt.Println("展示配置: 待同步")
	}
	if redacted.LastCloudSyncError != "" {
		fmt.Printf("展示配置同步错误: %s\n", redacted.LastCloudSyncError)
	}
	if redacted.LastUploadError != "" {
		fmt.Printf("最近错误: %s\n", redacted.LastUploadError)
	}
	printProbeSummary(&redacted)
}

func printStateSummary(state *backendState) {
	redacted := redactState(state)
	collector := "stopped"
	if redacted.Running {
		collector = "running"
	}
	fmt.Printf("采集器: %s\n", collector)
	fmt.Printf("连接状态: %s\n", valueOr(redacted.ConnectionStatus, "unknown"))
	fmt.Printf("配置文件: %s\n", valueOr(redacted.ConfigPath, "unknown"))
	fmt.Printf("诊断日志: %s\n", valueOr(redacted.DiagnosticsPath, "unknown"))
	fmt.Printf("最近上传: %s\n", valueOr(redacted.LastUploadAt, "暂无"))
	fmt.Printf("待上传样本: %d 条（%d bytes）\n", redacted.PendingSampleCount, redacted.PendingBytes)
	if redacted.CloudConfigPending {
		fmt.Println("展示配置: 待同步")
	}
	if redacted.LastCloudSyncError != "" {
		fmt.Printf("展示配置同步错误: %s\n", redacted.LastCloudSyncError)
	}
	if redacted.LastUploadError != "" {
		fmt.Printf("最近上传错误: %s\n", redacted.LastUploadError)
	}
	printProbeSummary(&redacted)
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
	secret := state.Config.Connection.Secret
	copy.LastChildLog = redactSensitiveText(copy.LastChildLog, secret)
	copy.LastCloudSyncError = redactSensitiveText(copy.LastCloudSyncError, secret)
	copy.LastIssueDetail = redactSensitiveText(copy.LastIssueDetail, secret)
	copy.LastUploadError = redactSensitiveText(copy.LastUploadError, secret)
	copy.TemperatureProbeError = redactSensitiveText(copy.TemperatureProbeError, secret)
	copy.Config = redactConfig(copy.Config)
	return copy
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

func writeOutputJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func promptValue(reader *bufio.Reader, label, current string) (string, error) {
	return readLine(reader, fmt.Sprintf("%s [%s]: ", label, valueOr(current, "空")), current)
}

func promptChoice(reader *bufio.Reader, label, current string, options []string) (string, error) {
	if len(options) == 0 {
		return current, errors.New("没有可用选项")
	}
	fmt.Printf("%s选项: ", label)
	for index, option := range options {
		if index > 0 {
			fmt.Print(" / ")
		}
		fmt.Printf("%d=%s", index+1, displayChoiceOption(label, option))
	}
	fmt.Println()
	currentLabel := valueOr(current, options[0])
	if label == "提供者" {
		currentLabel = displayProbeProvider(currentLabel)
	}
	value, err := readLine(reader, fmt.Sprintf("%s [%s]: ", label, currentLabel), current)
	if err != nil {
		return current, err
	}
	trimmed := strings.TrimSpace(value)
	if index, parseErr := strconv.Atoi(trimmed); parseErr == nil {
		if index < 1 || index > len(options) {
			return current, fmt.Errorf("%s 选项无效", label)
		}
		return options[index-1], nil
	}
	for _, option := range options {
		if trimmed == option {
			return option, nil
		}
	}
	return current, fmt.Errorf("%s 必须选择支持的 provider", label)
}

func displayChoiceOption(label, option string) string {
	if label == "提供者" {
		return displayProbeProvider(option)
	}
	return option
}

func promptInt(reader *bufio.Reader, label string, current, minimum, maximum int) (int, error) {
	value, err := readLine(reader, fmt.Sprintf("%s [%d]: ", label, current), "")
	if err != nil {
		return current, err
	}
	if strings.TrimSpace(value) == "" {
		return current, nil
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < minimum || parsed > maximum {
		return current, fmt.Errorf("%s 必须是 %d 到 %d 之间的整数", label, minimum, maximum)
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
