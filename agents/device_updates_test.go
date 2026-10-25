package main

import (
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

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
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
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
	if err != nil || !preview.Available {
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
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
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
		t.Setenv("XDG_CACHE_HOME", t.TempDir())
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
