package collector

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestConfigSourceAvoidsReparseAndIsolatesSlices(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "agent-ui.config.json")
	raw := []byte(`{
		"connection": {"serverUrl": "https://hub.example", "secret": "k", "deviceId": "dev-1", "hostname": "Host 1"},
		"enabledMetrics": ["cpuUsage", "memoryUsage"],
		"enabledDeviceIds": {"disk": ["disk-a"]}
	}`)
	if err := os.WriteFile(cfgPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}

	source := newConfigSource(cfgPath)
	defaults := newDefaultRuntimeConfig(agentConnectionConfig{
		ServerURL: "http://127.0.0.1:38472",
		Secret:    "default",
		DeviceID:  "default-dev",
		Hostname:  "default-host",
	})

	first := source.load(defaults)
	parsedPtr := source.parsed
	if parsedPtr == nil {
		t.Fatal("expected parsed config to be cached")
	}
	first.EnabledMetrics[0] = "mutated"
	first.EnabledDeviceIDs["disk"][0] = "mutated-disk"

	second := source.load(defaults)
	if source.parsed != parsedPtr {
		t.Fatal("unchanged config file should not be re-unmarshaled within configRecheck")
	}
	if second.EnabledMetrics[0] != "cpuUsage" || second.EnabledDeviceIDs["disk"][0] != "disk-a" {
		t.Fatalf("slice/map mutation leaked across load calls: %#v / %#v", second.EnabledMetrics, second.EnabledDeviceIDs)
	}

	source.invalidate()
	_ = source.load(defaults)
	if source.parsed == parsedPtr {
		t.Fatal("invalidate() must force a fresh JSON decode")
	}
}

func TestPostMetricsNegotiatesGzipInventoryDeltaNeedInventoryAndLiveWake(t *testing.T) {
	var callCount atomic.Int32
	var sawGzip atomic.Bool
	var sawOmitted atomic.Bool
	var sawFullRetry atomic.Bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := callCount.Add(1)
		var bodyBytes []byte
		if r.Header.Get("Content-Encoding") == "gzip" {
			sawGzip.Store(true)
			gr, err := gzip.NewReader(r.Body)
			if err != nil {
				t.Errorf("invalid gzip stream: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			bodyBytes, _ = io.ReadAll(gr)
			_ = gr.Close()
		} else {
			bodyBytes, _ = io.ReadAll(r.Body)
		}

		var payload metricsPayload
		if err := json.Unmarshal(bodyBytes, &payload); err != nil {
			t.Errorf("invalid json payload: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		switch n {
		case 1:
			// Initial upload: uncompressed, full inventory; advertise capabilities.
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"capabilities": map[string]bool{
					"gzip":           true,
					"liveOnDemand":   true,
					"inventoryDelta": true,
				},
				"liveWanted": false,
			})
		case 2:
			// Second upload: gzipped + inventoryOmitted; simulate Hub restart needing full inventory + liveWanted wakeup.
			if payload.InventoryOmitted {
				sawOmitted.Store(true)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":            true,
				"needInventory": true,
				"capabilities": map[string]bool{
					"gzip":           true,
					"liveOnDemand":   true,
					"inventoryDelta": true,
				},
				"liveWanted": false,
			})
		case 3:
			// Automatic full-inventory retry within the same postMetricsWithSession call!
			if !payload.InventoryOmitted && len(payload.Disks) == 1 && payload.Disks[0].Model == "Samsung 990 PRO" {
				sawFullRetry.Store(true)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"capabilities": map[string]bool{
					"gzip":           true,
					"liveOnDemand":   true,
					"inventoryDelta": true,
				},
				"liveWanted": true,
			})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		}
	}))
	defer server.Close()

	session := newHubSessionState()
	client := newAgentHTTPClient()
	sample := metricsPayload{
		Identity: agentIdentity{
			DeviceID: "node-perf-1",
			Hostname: "Perf Host",
			OS:       "linux",
			Platform: "debian",
			Arch:     "amd64",
		},
		Timestamp:       time.Now().UTC().Format(time.RFC3339),
		HeartbeatAt:     time.Now().UTC().Format(time.RFC3339),
		CPUUsagePercent: 12.5,
		Memory:          memoryStats{TotalBytes: 16 << 30, UsedBytes: 4 << 30, MemoryType: "DDR5"},
		Disks: []diskDeviceStats{
			{
				ID:         "nvme0n1p1",
				Name:       "nvme0n1p1",
				MountPoint: "/",
				FileSystem: "ext4",
				Model:      "Samsung 990 PRO",
				Vendor:     "Samsung",
				TotalBytes: 1 << 40,
				UsedBytes:  200 << 30,
				SmartAttributes: []diskSmartAttribute{
					{ID: 1, Name: "Critical Warning", Value: 0, Threshold: 0},
					{ID: 5, Name: "Available Spare", Value: 100, Threshold: 10},
				},
			},
		},
		NetworkIfaces: []networkInterfaceStats{
			{
				ID:         "eth0",
				Name:       "eth0",
				Model:      "Intel I226-V",
				MacAddress: "aa:bb:cc:dd:ee:ff",
				IPv4:       []string{"10.0.0.12", "10.0.0.13"},
			},
		},
		GPUs: []gpuDeviceStats{},
		Fans: []fanSensorStats{},
	}

	if err := postMetricsWithSession(context.Background(), client, session, server.URL, "secret", sample); err != nil {
		t.Fatalf("first ingest failed: %v", err)
	}
	onDemand, wanted := session.liveDemand()
	if !onDemand || wanted {
		t.Fatalf("expected onDemand=true wanted=false after first ingest, got onDemand=%t wanted=%t", onDemand, wanted)
	}

	sample.CPUUsagePercent = 24.0
	sample.Timestamp = time.Now().Add(time.Second).UTC().Format(time.RFC3339)
	sample.HeartbeatAt = sample.Timestamp
	if err := postMetricsWithSession(context.Background(), client, session, server.URL, "secret", sample); err != nil {
		t.Fatalf("second ingest failed: %v", err)
	}

	if !sawGzip.Load() {
		t.Fatal("expected gzip compression after Hub capability negotiation")
	}
	if !sawOmitted.Load() {
		t.Fatal("expected static inventory fields to be omitted on second upload")
	}
	if !sawFullRetry.Load() {
		t.Fatal("expected immediate full inventory resend when Hub returned needInventory=true")
	}
	select {
	case <-session.liveWakeChan():
	default:
		t.Fatal("expected liveWake signal when liveWanted transitioned to true")
	}
	onDemand, wanted = session.liveDemand()
	if !onDemand || !wanted {
		t.Fatalf("expected onDemand=true wanted=true, got onDemand=%t wanted=%t", onDemand, wanted)
	}
}

func TestPendingStoreSkipsDiskWritesInHealthySteadyState(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "agent-ui.config.json")
	store := newPendingStoreWithExplicitPath(cfgPath, "")
	defer store.close()

	info1, err := os.Stat(store.statePath)
	if err != nil {
		t.Fatalf("initial state file missing: %v", err)
	}

	time.Sleep(15 * time.Millisecond)
	store.recordHealthyUpload()
	if err := store.drain(context.Background(), nil, "http://127.0.0.1:38472", "secret"); err != nil {
		t.Fatalf("drain failed: %v", err)
	}
	info2, err := os.Stat(store.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if !info2.ModTime().Equal(info1.ModTime()) {
		t.Fatalf("healthy steady-state upload rewrote state file unnecessarily: %v -> %v", info1.ModTime(), info2.ModTime())
	}
}
