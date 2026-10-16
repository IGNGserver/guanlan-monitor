package live

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
)

func TestDockerSeparatesPermissionDeniedFromEmptyEngine(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/info" {
			w.Write([]byte(`{"ID":"engine"}`))
			return
		}
		w.Write([]byte(`[]`))
	}))
	defer server.Close()
	client := server.Client()
	client.Transport = redirectTransport{base: server.URL, inner: http.DefaultTransport}
	result, err := collectDocker(context.Background(), client)
	if err != nil || result.EngineID != "engine" || len(result.Items) != 0 {
		t.Fatal("empty engine not represented accurately", err)
	}
	denied := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusForbidden) }))
	defer denied.Close()
	client.Transport = redirectTransport{base: denied.URL, inner: http.DefaultTransport}
	if _, err := collectDocker(context.Background(), client); err == nil || err.Error() != "docker_permission_denied" {
		t.Fatal("permission denial disguised as no containers", err)
	}
	client.Transport = deniedSocketTransport{}
	if _, err := collectDocker(context.Background(), client); err == nil || err.Error() != "docker_permission_denied" {
		t.Fatal("a wrapped socket EACCES must remain distinguishable from an absent engine", err)
	}
}

type deniedSocketTransport struct{}

func (deniedSocketTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, &net.OpError{Op: "dial", Net: "unix", Err: &os.SyscallError{Syscall: "connect", Err: syscall.EACCES}}
}

type redirectTransport struct {
	base  string
	inner http.RoundTripper
}

func (t redirectTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	clone := r.Clone(r.Context())
	url := *r.URL
	clone.URL = &url
	parts := strings.SplitN(t.base, "://", 2)
	clone.URL.Scheme = parts[0]
	clone.URL.Host = parts[1]
	return t.inner.RoundTrip(clone)
}

func TestDockerStatsDoNotInventFirstCPUReading(t *testing.T) {
	var stats dockerStats
	if err := json.Unmarshal([]byte(`{"cpu_stats":{"cpu_usage":{"total_usage":200},"system_cpu_usage":1000,"online_cpus":4},"memory_stats":{"usage":100,"limit":200}}`), &stats); err != nil {
		t.Fatal(err)
	}
	item := Container{}
	applyDockerStats(&item, stats)
	if item.CPUPercent != nil {
		t.Fatal("first CPU sample must be unavailable")
	}
	stats.PreviousCPU.SystemCPUUsage = 500
	stats.PreviousCPU.CPUUsage.TotalUsage = 100
	applyDockerStats(&item, stats)
	if item.CPUPercent == nil || *item.CPUPercent != 80 {
		t.Fatal("incorrect Docker CPU delta", item.CPUPercent)
	}
}

func TestDockerOneShotStatsUsePriorSnapshotAndFenceEngineChange(t *testing.T) {
	type observation struct {
		engine        string
		total, system int
	}
	var current atomic.Value
	current.Store(observation{"engine-one", 100, 500})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sample := current.Load().(observation)
		switch r.URL.Path {
		case "/info":
			json.NewEncoder(w).Encode(map[string]string{"ID": sample.engine})
		case "/containers/json":
			w.Write([]byte(`[{"Id":"abcdefabcdef","Names":["/fixture"],"State":"running"}]`))
		default:
			json.NewEncoder(w).Encode(map[string]any{"cpu_stats": map[string]any{"system_cpu_usage": sample.system, "online_cpus": 4, "cpu_usage": map[string]int{"total_usage": sample.total}}})
		}
	}))
	defer server.Close()
	client := server.Client()
	client.Transport = redirectTransport{base: server.URL, inner: http.DefaultTransport}
	collector := &DockerCollector{}
	first, err := collector.collect(context.Background(), client, false)
	if err != nil || first.Items[0].CPUPercent != nil {
		t.Fatal("first CPU reading must be absent", err)
	}
	current.Store(observation{"engine-one", 200, 1000})
	second, err := collector.collect(context.Background(), client, false)
	if err != nil || second.Items[0].CPUPercent == nil || *second.Items[0].CPUPercent != 80 {
		t.Fatal("one-shot readings did not form a CPU delta", err)
	}
	current.Store(observation{"engine-two", 200, 1000})
	third, err := collector.collect(context.Background(), client, false)
	if err != nil || third.Items[0].CPUPercent != nil {
		t.Fatal("CPU sample leaked across Engine identity", err)
	}
}

func TestDockerMemoryExcludesInactiveFileCacheLikeDockerStats(t *testing.T) {
	if got := dockerMemoryUsage(1000, map[string]uint64{"inactive_file": 300}); got != 700 {
		t.Fatal("cgroup v2 inactive_file not subtracted", got)
	}
	if got := dockerMemoryUsage(1000, map[string]uint64{"total_inactive_file": 400, "inactive_file": 100}); got != 600 {
		t.Fatal("cgroup v1 total_inactive_file must win", got)
	}
	if got := dockerMemoryUsage(1000, map[string]uint64{"inactive_file": 5000}); got != 1000 {
		t.Fatal("an inconsistent cache counter must not underflow", got)
	}
	if got := dockerMemoryUsage(1000, nil); got != 1000 {
		t.Fatal("missing counters must keep raw usage", got)
	}
}

func TestDockerStatsRotateBeyondTheLimitAndReportCoverage(t *testing.T) {
	const running = 40
	var rows []map[string]any
	for index := 0; index < running; index++ {
		rows = append(rows, map[string]any{"Id": fmt.Sprintf("%012x", 0xabc000+index), "State": "running"})
	}
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/info":
			w.Write([]byte(`{"ID":"engine"}`))
		case "/containers/json":
			json.NewEncoder(w).Encode(rows)
		default:
			step := calls.Add(1)
			json.NewEncoder(w).Encode(map[string]any{"cpu_stats": map[string]any{"system_cpu_usage": 1000 * step, "online_cpus": 1, "cpu_usage": map[string]int64{"total_usage": 10 * step}}})
		}
	}))
	defer server.Close()
	client := server.Client()
	client.Transport = redirectTransport{base: server.URL, inner: http.DefaultTransport}
	collector := &DockerCollector{}
	seen := map[string]bool{}
	for round := 0; round < 3; round++ {
		result, err := collector.collect(context.Background(), client, true)
		if err != nil {
			t.Fatal(err)
		}
		if result.StatsCandidates == nil || *result.StatsCandidates != running || result.StatsRead == nil || *result.StatsRead != dockerStatsLimit {
			t.Fatal("stats coverage not reported", result.StatsCandidates, result.StatsRead)
		}
		for key := range collector.sampledAt {
			seen[key] = true
		}
	}
	if len(seen) != running {
		t.Fatal("containers beyond the stats limit were starved", len(seen))
	}
	legacy, err := collector.collect(context.Background(), client, false)
	if err != nil || legacy.StatsCandidates != nil || legacy.StatsRead != nil {
		t.Fatal("a revision-1 Hub must not receive fields its schema rejects", err)
	}
}
