// Package agentconfig is the single source of truth for the local Agent
// configuration contract: the JSON schema, the built-in defaults, the
// normalization/migration rules, the on-disk layout of the machine-scope
// configuration directory, and redaction.
//
// Both the local control backend and the helper commands shipped with the
// desktop product use this package. The collector keeps a pointer-typed view of
// the same file (see agentConfigFile in agents/main.go) because it must tell
// "field absent" apart from "field explicitly empty"; that view aliases the
// shared sub-types below so the schema cannot drift.
package agentconfig

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
)

const (
	// CurrentConfigVersion is the schema version written by this build.
	CurrentConfigVersion = 1
	// MaxConfigBytes bounds every JSON document this package reads or writes.
	MaxConfigBytes int64 = 256 * 1024
	// MaxSamplingIntervalSeconds bounds both sampling intervals.
	MaxSamplingIntervalSeconds = 86400
)

// AllMetricKeys is the canonical, ordered metric whitelist. It must stay in
// sync with the metric keys in packages/shared/src/index.ts.
var AllMetricKeys = []string{
	"cpuUsage", "cpuFrequency", "cpuTemperature", "cpuTopology", "systemOverview",
	"gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature", "gpuDriverInfo", "temperatureSources",
	"memoryUsage", "swapUsage", "memoryAvailable", "memoryCached", "memoryCommitted", "memoryHardware",
	"diskUsage", "diskRead", "diskWrite", "diskMetadata", "diskActivity", "diskHealth",
	"networkRxRate", "networkTxRate", "networkTraffic", "networkIdentity",
	"fanRpm", "fanControl", "fanTargetTemperature", "fanPwm", "fanChannelState", "fanNote",
}

// Connection holds the Hub endpoint and the shared access key.
type Connection struct {
	ServerURL string `json:"serverUrl"`
	Secret    string `json:"secret"`
	DeviceID  string `json:"deviceId"`
	Hostname  string `json:"hostname"`
}

// Sampling holds the collector's two sampling intervals in seconds.
type Sampling struct {
	NormalIntervalSeconds int `json:"normalIntervalSeconds"`
	SlowIntervalSeconds   int `json:"slowIntervalSeconds"`
}

// ProbeSelection is the per-target hardware probe provider choice.
type ProbeSelection struct {
	Target   string `json:"target"`
	Provider string `json:"provider"`
	Enabled  bool   `json:"enabled"`
}

// Virtualization holds the non-secret hypervisor inventory settings.
type Virtualization struct {
	Enabled               bool   `json:"enabled"`
	Platform              string `json:"platform"`
	Endpoint              string `json:"endpoint"`
	Node                  string `json:"node"`
	InsecureSkipTLSVerify bool   `json:"insecureSkipTlsVerify"`
	PollIntervalSeconds   int    `json:"pollIntervalSeconds"`
}

// LocalConfig is the complete agent-ui.config.json document.
type LocalConfig struct {
	ConfigVersion        int                 `json:"configVersion"`
	Connection           Connection          `json:"connection"`
	Sampling             Sampling            `json:"sampling"`
	EnabledMetrics       []string            `json:"enabledMetrics"`
	EnabledDeviceIDs     map[string][]string `json:"enabledDeviceIds"`
	InstanceMetricConfig map[string][]string `json:"instanceMetricConfig"`
	ProbeSelections      []ProbeSelection    `json:"probeSelections"`
	Virtualization       *Virtualization     `json:"virtualization,omitempty"`
	CloudSyncEnabled     bool                `json:"cloudSyncEnabled"`
	DataRecordingEnabled bool                `json:"dataRecordingEnabled"`
	AutoRestartCollector bool                `json:"autoRestartCollector"`
	AutoStartCollector   bool                `json:"autoStartCollector"`
}

// ProbePlan describes the providers a probe target supports on this platform.
type ProbePlan struct {
	Target    string   `json:"target"`
	Providers []string `json:"providers"`
	Default   string   `json:"default"`
}

// SupportedProbePlans returns the probe targets and providers for the host OS.
func SupportedProbePlans() []ProbePlan {
	if runtime.GOOS == "linux" {
		return []ProbePlan{
			{Target: "connection", Providers: []string{"gopsutil"}, Default: "gopsutil"},
			{Target: "cpu", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
			{Target: "memory", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
			{Target: "disk", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
			{Target: "network", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
			{Target: "gpu", Providers: []string{"disabled", "wmi"}, Default: "wmi"},
			{Target: "fan", Providers: []string{"disabled", "librehardwaremonitor"}, Default: "librehardwaremonitor"},
		}
	}
	return []ProbePlan{
		{Target: "connection", Providers: []string{"gopsutil"}, Default: "gopsutil"},
		{Target: "cpu", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
		{Target: "memory", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
		{Target: "disk", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
		{Target: "network", Providers: []string{"disabled", "gopsutil"}, Default: "gopsutil"},
		{Target: "gpu", Providers: []string{"disabled", "wmi"}, Default: "wmi"},
		{Target: "fan", Providers: []string{"disabled", "librehardwaremonitor"}, Default: "librehardwaremonitor"},
	}
}

// Default returns the built-in configuration for this platform.
//
// AutoStartCollector is deliberately false here: it is a user/administrator
// choice in interactive mode. The machine-scope service forces it on at
// startup (see ServiceDefaults) so an unattended host starts reporting without
// anybody opening the desktop UI.
func Default() LocalConfig {
	return defaultFor(runtime.GOOS)
}

func defaultFor(goos string) LocalConfig {
	deviceID := "windows-agent"
	hostname := "Windows Agent"
	probeSelections := []ProbeSelection{
		{Target: "cpu", Provider: "gopsutil", Enabled: true},
		{Target: "memory", Provider: "gopsutil", Enabled: true},
		{Target: "disk", Provider: "gopsutil", Enabled: true},
		{Target: "network", Provider: "gopsutil", Enabled: true},
		{Target: "gpu", Provider: "wmi", Enabled: true},
		{Target: "fan", Provider: "librehardwaremonitor", Enabled: true},
	}
	if goos == "linux" {
		deviceID = "linux-agent"
		hostname = "Linux Agent"
		if detectedHostname, err := os.Hostname(); err == nil && strings.TrimSpace(detectedHostname) != "" {
			deviceID = strings.TrimSpace(detectedHostname)
			hostname = strings.TrimSpace(detectedHostname)
		}
		probeSelections = []ProbeSelection{
			{Target: "cpu", Provider: "gopsutil", Enabled: true},
			{Target: "memory", Provider: "gopsutil", Enabled: true},
			{Target: "disk", Provider: "gopsutil", Enabled: true},
			{Target: "network", Provider: "gopsutil", Enabled: true},
			{Target: "gpu", Provider: "disabled", Enabled: false},
			{Target: "fan", Provider: "hwmon", Enabled: true},
		}
	}

	return LocalConfig{
		ConfigVersion: CurrentConfigVersion,
		Connection: Connection{
			ServerURL: "http://127.0.0.1:3100",
			Secret:    "",
			DeviceID:  deviceID,
			Hostname:  hostname,
		},
		Sampling: Sampling{
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

// ServiceDefaults returns the configuration a machine-scope service applies on
// top of the built-in defaults: continuous collection is the point of the
// service, so both recording and collector auto-start are on by default.
func ServiceDefaults() LocalConfig {
	config := Default()
	config.AutoStartCollector = true
	config.DataRecordingEnabled = true
	return config
}

// Normalize migrates a decoded document to the current schema.
//
// raw is the exact byte content the document was decoded from; it is used to
// tell "key absent" apart from "key present but empty", which matters for
// enabledMetrics and the boolean feature switches. Pass nil when the document
// is brand new.
func Normalize(config LocalConfig, raw []byte) LocalConfig {
	defaults := Default()
	metricsConfigured := bytes.Contains(raw, []byte(`"enabledMetrics"`))

	if config.ConfigVersion <= 0 {
		config.ConfigVersion = CurrentConfigVersion
	}

	if strings.TrimSpace(config.Connection.ServerURL) == "" {
		config.Connection.ServerURL = defaults.Connection.ServerURL
	}
	if strings.TrimSpace(config.Connection.DeviceID) == "" {
		config.Connection.DeviceID = defaults.Connection.DeviceID
	}
	if strings.TrimSpace(config.Connection.Hostname) == "" {
		config.Connection.Hostname = defaults.Connection.Hostname
	}

	if config.Sampling.NormalIntervalSeconds <= 0 || config.Sampling.NormalIntervalSeconds > MaxSamplingIntervalSeconds {
		config.Sampling.NormalIntervalSeconds = defaults.Sampling.NormalIntervalSeconds
	}
	if config.Sampling.SlowIntervalSeconds <= 0 || config.Sampling.SlowIntervalSeconds > MaxSamplingIntervalSeconds {
		config.Sampling.SlowIntervalSeconds = defaults.Sampling.SlowIntervalSeconds
	}
	if len(config.ProbeSelections) == 0 {
		config.ProbeSelections = append([]ProbeSelection(nil), defaults.ProbeSelections...)
	}
	if !metricsConfigured && len(config.EnabledMetrics) == 0 {
		config.EnabledMetrics = append([]string(nil), defaults.EnabledMetrics...)
	}
	config.EnabledMetrics = NormalizeMetricKeys(config.EnabledMetrics)
	if !(metricsConfigured && len(config.EnabledMetrics) == 0) {
		if IsProbeSelectionEnabled(config.ProbeSelections, "gpu") && !ContainsMetricPrefix(config.EnabledMetrics, "gpu") {
			config.EnabledMetrics = append(config.EnabledMetrics,
				"gpuUsage",
				"gpuEncode",
				"gpuDecode",
				"gpuFrequency",
				"gpuMemory",
				"gpuTemperature",
				"gpuDriverInfo",
			)
		}
		if IsProbeSelectionEnabled(config.ProbeSelections, "cpu") && ContainsMetricPrefix(config.EnabledMetrics, "cpu") {
			config.EnabledMetrics = AppendMissingMetricKeys(config.EnabledMetrics, []string{"cpuTopology", "systemOverview"})
		}
		if IsProbeSelectionEnabled(config.ProbeSelections, "memory") && ContainsMetricPrefix(config.EnabledMetrics, "memory") {
			config.EnabledMetrics = AppendMissingMetricKeys(config.EnabledMetrics, []string{"memoryAvailable", "memoryCached", "memoryCommitted", "memoryHardware"})
		}
		if IsProbeSelectionEnabled(config.ProbeSelections, "disk") && ContainsMetricPrefix(config.EnabledMetrics, "disk") {
			config.EnabledMetrics = AppendMissingMetricKeys(config.EnabledMetrics, []string{"diskMetadata", "diskActivity", "diskHealth"})
		}
		if IsProbeSelectionEnabled(config.ProbeSelections, "network") && ContainsMetricPrefix(config.EnabledMetrics, "network") {
			config.EnabledMetrics = AppendMissingMetricKeys(config.EnabledMetrics, []string{"networkIdentity"})
		}
		if IsProbeSelectionEnabled(config.ProbeSelections, "fan") {
			config.EnabledMetrics = AppendMissingMetricKeys(config.EnabledMetrics, []string{"fanRpm", "fanControl", "fanTargetTemperature", "fanPwm", "fanChannelState", "fanNote"})
		}
	}
	if config.EnabledDeviceIDs == nil {
		config.EnabledDeviceIDs = map[string][]string{}
	}
	if config.InstanceMetricConfig == nil {
		config.InstanceMetricConfig = map[string][]string{}
	}
	if len(raw) == 0 || !bytes.Contains(raw, []byte(`"cloudSyncEnabled"`)) {
		config.CloudSyncEnabled = defaults.CloudSyncEnabled
	}
	if len(raw) == 0 || !bytes.Contains(raw, []byte(`"dataRecordingEnabled"`)) {
		config.DataRecordingEnabled = defaults.DataRecordingEnabled
	}
	if len(raw) == 0 || !bytes.Contains(raw, []byte(`"autoRestartCollector"`)) {
		config.AutoRestartCollector = defaults.AutoRestartCollector
	}
	// autoStartCollector historically had no backfill rule, so an existing
	// document without the key silently meant "do not start the collector".
	// Backfill it from the defaults for every document the service loads.
	if len(raw) == 0 || !bytes.Contains(raw, []byte(`"autoStartCollector"`)) {
		config.AutoStartCollector = defaults.AutoStartCollector
	}

	config.Connection.ServerURL = strings.TrimSpace(config.Connection.ServerURL)
	config.Connection.Secret = strings.TrimSpace(config.Connection.Secret)
	config.Connection.DeviceID = strings.TrimSpace(config.Connection.DeviceID)
	config.Connection.Hostname = strings.TrimSpace(config.Connection.Hostname)
	config.EnabledMetrics = NormalizeMetricKeys(config.EnabledMetrics)
	config.EnabledDeviceIDs = NormalizeStringMap(config.EnabledDeviceIDs)
	config.InstanceMetricConfig = NormalizeStringMap(config.InstanceMetricConfig)
	config.ProbeSelections = NormalizeProbeSelections(config.ProbeSelections, defaults.ProbeSelections)
	return config
}

// LoadOptions selects the defaults applied while reading a document.
type LoadOptions struct {
	// ServiceScope marks the machine-scope service. In that mode an absent
	// autoStartCollector key means "collect continuously" instead of "wait for
	// the desktop UI to start the collector".
	ServiceScope bool
}

// Load reads and normalizes the configuration document at path. A missing file
// is not an error: the caller receives the built-in defaults together with
// created=true so it can persist them.
func Load(path string) (config LocalConfig, created bool, err error) {
	return LoadWithOptions(path, LoadOptions{})
}

// LoadWithOptions is Load with explicit scope semantics.
func LoadWithOptions(path string, options LoadOptions) (config LocalConfig, created bool, err error) {
	raw, err := ReadFileLimited(path)
	if err != nil {
		if os.IsNotExist(err) {
			if options.ServiceScope {
				return ServiceDefaults(), true, nil
			}
			return Default(), true, nil
		}
		return LocalConfig{}, false, err
	}
	raw = TrimUTF8BOM(raw)
	var decoded LocalConfig
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return LocalConfig{}, false, fmt.Errorf("parse %s: %w", path, err)
	}
	config = Normalize(decoded, raw)
	if options.ServiceScope && !bytes.Contains(raw, []byte(`"autoStartCollector"`)) {
		config.AutoStartCollector = true
	}
	return config, false, nil
}

// Save writes the configuration document atomically with 0600 permissions.
func Save(path string, config LocalConfig) error {
	raw, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return WriteFileAtomic(path, raw, 0o600)
}

// Redact returns a copy safe for logs, exports and non-privileged readers.
func Redact(config LocalConfig) LocalConfig {
	redacted := config
	redacted.Connection.Secret = ""
	return redacted
}

// IsProbeSelectionEnabled reports whether a probe target is enabled with a
// provider other than "disabled".
func IsProbeSelectionEnabled(selections []ProbeSelection, target string) bool {
	for _, selection := range selections {
		if strings.EqualFold(strings.TrimSpace(selection.Target), target) {
			return selection.Enabled && !strings.EqualFold(strings.TrimSpace(selection.Provider), "disabled")
		}
	}
	return false
}

// NormalizeMetricKeys trims, de-duplicates and whitelists metric keys while
// preserving their order.
func NormalizeMetricKeys(items []string) []string {
	known := make(map[string]bool, len(AllMetricKeys))
	for _, key := range AllMetricKeys {
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

// AppendMissingMetricKeys appends keys that are not already present.
func AppendMissingMetricKeys(metrics []string, keys []string) []string {
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

// NormalizeProbeSelections drops unknown targets, repairs unsupported
// providers and appends any default target the document did not mention.
func NormalizeProbeSelections(selections []ProbeSelection, defaults []ProbeSelection) []ProbeSelection {
	defaultByTarget := map[string]ProbeSelection{}
	supportedByTarget := map[string]map[string]bool{}
	for _, plan := range SupportedProbePlans() {
		providers := map[string]bool{}
		for _, provider := range plan.Providers {
			providers[provider] = true
		}
		supportedByTarget[plan.Target] = providers
	}
	for _, item := range defaults {
		defaultByTarget[item.Target] = item
	}

	result := make([]ProbeSelection, 0, len(selections))
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

		result = append(result, ProbeSelection{
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

// TrimUTF8BOM removes a leading UTF-8 byte order mark.
func TrimUTF8BOM(raw []byte) []byte {
	return bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
}

// UniqueTrimmedStrings trims, drops empties and de-duplicates while preserving
// order.
func UniqueTrimmedStrings(items []string) []string {
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

// NormalizeStringMap trims keys and de-duplicates each value list.
func NormalizeStringMap(values map[string][]string) map[string][]string {
	result := make(map[string][]string, len(values))
	for key, items := range values {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		result[trimmedKey] = UniqueTrimmedStrings(items)
	}
	return result
}

// ContainsMetricPrefix reports whether any metric starts with prefix.
func ContainsMetricPrefix(metrics []string, prefix string) bool {
	for _, metric := range metrics {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(metric)), strings.ToLower(prefix)) {
			return true
		}
	}
	return false
}
