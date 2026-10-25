package main

import (
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"
)

func isolateDeviceFeedCache(t *testing.T) {
	t.Helper()
	directory := t.TempDir()
	previous := deviceUpdateCacheRoot
	deviceUpdateCacheRoot = func() (string, error) { return directory, nil }
	t.Cleanup(func() { deviceUpdateCacheRoot = previous })
}

type updateRoundTrip func(*http.Request) (*http.Response, error)

func (f updateRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDeviceDownloadBoundsAndRedirects(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)
	old := updateDownloadTransport
	defer func() { updateDownloadTransport = old }()
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte("abc")))
	for _, body := range []string{"ab", "abcd", "bad"} {
		updateDownloadTransport = updateRoundTrip(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, ContentLength: -1, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}, nil
		})
		if _, err := downloadUpdate("https://github.com/IGNGserver/guanlan-monitor/releases/download/v1.0.0/package.deb", digest, 3); err == nil {
			t.Fatal("bad download accepted")
		}
		files, _ := os.ReadDir(dir)
		if len(files) != 0 {
			t.Fatal("failed download leaked an open/partial package")
		}
	}
	calls := 0
	updateDownloadTransport = updateRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 302, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{"Location": []string{"http://evil.invalid/package.deb"}}, Request: r}, nil
	})
	if _, err := downloadUpdate("https://github.com/IGNGserver/guanlan-monitor/releases/download/v1.0.0/package.deb", digest, 3); err == nil || calls != 1 {
		t.Fatal("unsafe redirect followed")
	}
}

func TestDeviceFeedDirectSelectionAndCooldown(t *testing.T) {
	isolateDeviceFeedCache(t)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("ETag", `"feed1"`)
		fmt.Fprint(w, `{"schemaVersion":1,"generatedAt":"2026-10-25T12:00:00Z","repository":"IGNGserver/guanlan-monitor","releases":[{"tag_name":"v9.0.0","draft":false,"prerelease":true,"assets":[{"name":"DeviceStateConsole-Linux-Install-v9.0.0.deb","state":"uploaded","size":100,"browser_download_url":"https://github.com/IGNGserver/guanlan-monitor/releases/download/v9.0.0/DeviceStateConsole-Linux-Install-v9.0.0.deb","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}]}`)
	}))
	defer server.Close()
	old := deviceUpdateFeedURL
	deviceUpdateFeedURL = server.URL
	defer func() { deviceUpdateFeedURL = old }()
	preview, err := fetchAgentUpdate("http://unused-hub.invalid", "unused-secret", "1.0.0", "preview")
	if err != nil || preview.CurrentVersion != "1.0.0" || preview.Available != (runtime.GOOS == "linux" && runtime.GOARCH == "amd64") {
		t.Fatalf("direct update: %+v %v", preview, err)
	}
	stable, err := fetchDeviceUpdate("1.0.0", "stable")
	if err != nil || stable.Available {
		t.Fatalf("stable accepted prerelease: %+v %v", stable, err)
	}
	if calls != 1 {
		t.Fatalf("cooldown bypassed: %d", calls)
	}
	state := loadDeviceFeedCache()
	if state.Channel != "stable" || state.NextRequest <= time.Now().Unix() {
		t.Fatal("channel/cooldown not persisted")
	}
}

func TestDeviceFeedRateLimitPersists(t *testing.T) {
	isolateDeviceFeedCache(t)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Retry-After", "3600")
		w.WriteHeader(429)
	}))
	defer server.Close()
	old := deviceUpdateFeedURL
	deviceUpdateFeedURL = server.URL
	defer func() { deviceUpdateFeedURL = old }()
	if _, err := fetchDeviceUpdate("1.0.0", "preview"); err == nil {
		t.Fatal("rate limit not reported")
	}
	if _, err := fetchDeviceUpdate("1.0.0", "preview"); err == nil {
		t.Fatal("empty cached feed reported as current")
	}
	if calls != 1 || loadDeviceFeedCache().NextRequest < time.Now().Unix()+3500 {
		t.Fatal("rate limit deadline not respected")
	}
}

func TestDeviceReleaseSelectionIsIndependentOfRunnerPlatform(t *testing.T) {
	preview, draft := true, false
	releases := []deviceRelease{{Tag: "v9.0.0", Prerelease: &preview, Draft: &draft, Assets: []deviceReleaseAsset{
		{Name: "DeviceStateConsole-Linux-Install-v9.0.0.deb", State: "uploaded", Size: 100, URL: "https://github.com/IGNGserver/guanlan-monitor/releases/download/v9.0.0/DeviceStateConsole-Linux-Install-v9.0.0.deb", Digest: "sha256:" + strings.Repeat("a", 64)},
		{Name: "DeviceStateConsole-Windows-Setup-v9.0.0.exe", State: "uploaded", Size: 100, URL: "https://github.com/IGNGserver/guanlan-monitor/releases/download/v9.0.0/DeviceStateConsole-Windows-Setup-v9.0.0.exe", Digest: "sha256:" + strings.Repeat("a", 64)},
	}}}
	for _, target := range []struct {
		os, arch, extension string
		available           bool
	}{
		{"linux", "amd64", ".deb", true}, {"windows", "amd64", ".exe", true},
		{"linux", "arm64", "", false}, {"windows", "arm64", "", false},
		{"darwin", "amd64", "", false}, {"darwin", "arm64", "", false},
	} {
		selected := selectDeviceRelease(releases, "1.0.0", "preview", target.os, target.arch)
		if selected.Available != target.available {
			t.Fatalf("wrong platform selection for %+v: %+v", target, selected)
		}
		if target.available && (selected.AssetName == nil || !strings.HasSuffix(*selected.AssetName, target.extension)) {
			t.Fatalf("wrong delivery unit for %+v", target)
		}
		if selectDeviceRelease(releases, "1.0.0", "stable", target.os, target.arch).Available {
			t.Fatalf("stable accepted a preview for %+v", target)
		}
		if selectDeviceRelease(releases, "9.0.0", "preview", target.os, target.arch).Available {
			t.Fatalf("same-version reinstall offered for %+v", target)
		}
	}
}

func TestUpdateSemver(t *testing.T) {
	for _, pair := range [][2]string{{"1.0.0-beta.10", "1.0.0-beta.2"}, {"1.0.0", "1.0.0-rc.9"}, {"1.1.0", "1.0.999"}} {
		if compareReleaseVersions(pair[0], pair[1]) != 1 {
			t.Fatalf("wrong precedence: %v", pair)
		}
	}
	if validReleaseVersion("1.0.0-beta.01") || compareReleaseVersions("1.0.0+one", "1.0.0+two") != 0 {
		t.Fatal("invalid SemVer handling")
	}
}

func TestDeviceFeedRejectsOversizedAndMalformedMetadata(t *testing.T) {
	for _, body := range []string{strings.Repeat(" ", 4*1024*1024+1), `{"schemaVersion":1,"repository":"IGNGserver/guanlan-monitor","generatedAt":"invalid","releases":[]}`} {
		isolateDeviceFeedCache(t)
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
		old := deviceUpdateFeedURL
		deviceUpdateFeedURL = server.URL
		_, err := fetchDeviceUpdate("1.0.0", "preview")
		deviceUpdateFeedURL = old
		server.Close()
		if err == nil || loadDeviceFeedCache().Feed != nil {
			t.Fatal("invalid or oversized metadata was retained")
		}
	}
}
