package agentconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeFillsMissingDefaults(t *testing.T) {
	config := Normalize(LocalConfig{}, nil)

	if config.ConfigVersion != CurrentConfigVersion {
		t.Fatalf("configVersion = %d, want %d", config.ConfigVersion, CurrentConfigVersion)
	}
	if config.Connection.ServerURL == "" || config.Connection.DeviceID == "" || config.Connection.Hostname == "" {
		t.Fatalf("connection defaults were not applied: %+v", config.Connection)
	}
	if config.Sampling.NormalIntervalSeconds <= 0 || config.Sampling.SlowIntervalSeconds <= 0 {
		t.Fatalf("sampling defaults were not applied: %+v", config.Sampling)
	}
	if len(config.ProbeSelections) == 0 {
		t.Fatal("probe selections were not defaulted")
	}
	if len(config.EnabledMetrics) == 0 {
		t.Fatal("metrics were not defaulted")
	}
	if !config.CloudSyncEnabled || !config.DataRecordingEnabled || !config.AutoRestartCollector {
		t.Fatalf("feature defaults were not applied: %+v", config)
	}
}

// A document that never mentioned autoStartCollector used to keep the zero
// value, which silently disabled collection on every restart. An interactive
// configuration keeps meaning "do not auto-start", but the machine-scope
// service must read an absent key as "collect continuously".
func TestServiceScopeBackfillsAutoStartCollector(t *testing.T) {
	dir := t.TempDir()
	path := ConfigPath(dir)
	raw := []byte(`{"connection":{"serverUrl":"https://hub.example.com"},"dataRecordingEnabled":true}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}

	interactive, created, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("created = true for an existing document")
	}
	if interactive.AutoStartCollector {
		t.Fatal("an interactive read must keep the documented default (false)")
	}

	service, _, err := LoadWithOptions(path, LoadOptions{ServiceScope: true})
	if err != nil {
		t.Fatal(err)
	}
	if !service.AutoStartCollector {
		t.Fatal("the machine-scope service must start collecting when the key is absent")
	}

	// An explicit decision by the administrator is always respected.
	explicit := []byte(`{"autoStartCollector":false,"dataRecordingEnabled":true}`)
	if err := os.WriteFile(path, explicit, 0o600); err != nil {
		t.Fatal(err)
	}
	respected, _, err := LoadWithOptions(path, LoadOptions{ServiceScope: true})
	if err != nil {
		t.Fatal(err)
	}
	if respected.AutoStartCollector {
		t.Fatal("an explicit autoStartCollector=false must be preserved")
	}

	serviceDefaults := ServiceDefaults()
	if !serviceDefaults.AutoStartCollector || !serviceDefaults.DataRecordingEnabled {
		t.Fatalf("service defaults must enable collection: %+v", serviceDefaults)
	}
}

// enabledMetrics distinguishes "key absent" (all defaults) from "explicitly
// empty" (collect nothing), and that behaviour must survive normalization.
func TestNormalizeKeepsExplicitEmptyMetrics(t *testing.T) {
	raw := []byte(`{"enabledMetrics":[]}`)
	var decoded LocalConfig
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if got := Normalize(decoded, raw); len(got.EnabledMetrics) != 0 {
		t.Fatalf("enabledMetrics = %v, want empty", got.EnabledMetrics)
	}
}

func TestNormalizeMetricKeysFiltersUnknownAndDuplicates(t *testing.T) {
	got := NormalizeMetricKeys([]string{" cpuUsage ", "cpuUsage", "notAMetric", "", "diskUsage"})
	want := []string{"cpuUsage", "diskUsage"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestNormalizeProbeSelectionsRepairsUnsupportedProvider(t *testing.T) {
	got := NormalizeProbeSelections(
		[]ProbeSelection{{Target: "CPU", Provider: "nonsense", Enabled: true}, {Target: "unknown", Enabled: true}},
		Default().ProbeSelections,
	)

	cpu := findProbe(got, "cpu")
	if cpu == nil {
		t.Fatalf("cpu selection missing from %+v", got)
	}
	if cpu.Provider != "gopsutil" {
		t.Fatalf("cpu provider = %q, want the platform default", cpu.Provider)
	}
	if findProbe(got, "unknown") != nil {
		t.Fatalf("unknown target should have been dropped: %+v", got)
	}
	if findProbe(got, "fan") == nil {
		t.Fatalf("missing default target should have been appended: %+v", got)
	}
}

func TestSaveAndLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := ConfigPath(dir)

	config := ServiceDefaults()
	config.Connection.ServerURL = "https://hub.example.com"
	config.Connection.Secret = "secret-value"
	config.Connection.DeviceID = "node-01"
	if err := Save(path, config); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %o, want 600", info.Mode().Perm())
	}

	loaded, created, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("created = true for an existing document")
	}
	if loaded.Connection.ServerURL != "https://hub.example.com" || loaded.Connection.Secret != "secret-value" {
		t.Fatalf("round trip lost data: %+v", loaded.Connection)
	}
	if !loaded.AutoStartCollector {
		t.Fatal("round trip lost autoStartCollector")
	}

	redacted := Redact(loaded)
	if redacted.Connection.Secret != "" {
		t.Fatal("Redact must clear the secret")
	}
	if redacted.Connection.ServerURL == "" {
		t.Fatal("Redact must keep non-secret fields")
	}
}

func TestLoadMissingDocumentReturnsCreated(t *testing.T) {
	dir := t.TempDir()
	config, created, err := Load(ConfigPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("created = false for a missing document")
	}
	if config.ConfigVersion != CurrentConfigVersion {
		t.Fatalf("configVersion = %d, want %d", config.ConfigVersion, CurrentConfigVersion)
	}
}

func TestResolveDirPrecedence(t *testing.T) {
	explicit := filepath.Join(t.TempDir(), "explicit")
	fromEnv := filepath.Join(t.TempDir(), "env")

	t.Setenv(EnvConfigRoot, fromEnv)
	t.Setenv(EnvLegacyConfigRoot, "")

	if got := ResolveDir(""); got != fromEnv {
		t.Fatalf("ResolveDir(\"\") = %q, want %q", got, fromEnv)
	}
	if got := ResolveDir(explicit); got != explicit {
		t.Fatalf("ResolveDir(explicit) = %q, want %q", got, explicit)
	}

	t.Setenv(EnvConfigRoot, "")
	t.Setenv(EnvLegacyConfigRoot, fromEnv)
	if got := ResolveDir(""); got != fromEnv {
		t.Fatalf("legacy override = %q, want %q", got, fromEnv)
	}

	t.Setenv(EnvLegacyConfigRoot, "")
	if got := ResolveDir(""); got != MachineDir() {
		t.Fatalf("ResolveDir(\"\") = %q, want the machine scope %q", got, MachineDir())
	}
}

func TestPendingStatePathHonoursOverride(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DSC_AGENT_PENDING_FILE", "")
	if got, want := PendingStatePath(dir), ConfigPath(dir)+".pending.jsonl"; got != want {
		t.Fatalf("PendingStatePath = %q, want %q", got, want)
	}

	override := filepath.Join(t.TempDir(), "spool.jsonl")
	t.Setenv("DSC_AGENT_PENDING_FILE", override)
	if got := PendingStatePath(dir); got != override {
		t.Fatalf("PendingStatePath = %q, want %q", got, override)
	}
}

func findProbe(selections []ProbeSelection, target string) *ProbeSelection {
	for index := range selections {
		if selections[index].Target == target {
			return &selections[index]
		}
	}
	return nil
}
