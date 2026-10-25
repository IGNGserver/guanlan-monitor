package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var deviceUpdateFeedURL = "https://raw.githubusercontent.com/IGNGserver/guanlan-monitor/updates/updates.json"
var deviceUpdateMu sync.Mutex
var updateSemverPattern = regexp.MustCompile(`^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)

func parseUpdateSemver(value string) ([4]string, bool) {
	var result [4]string
	match := updateSemverPattern.FindStringSubmatch(value)
	if match == nil {
		return result, false
	}
	for i := 0; i < 3; i++ {
		if _, err := strconv.ParseUint(match[i+1], 10, 64); err != nil {
			return result, false
		}
		result[i] = match[i+1]
	}
	result[3] = match[4]
	for _, part := range strings.Split(result[3], ".") {
		if len(part) > 1 && part[0] == '0' {
			if _, err := strconv.ParseUint(part, 10, 64); err == nil {
				return result, false
			}
		}
	}
	return result, true
}

type deviceReleaseAsset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Digest string `json:"digest"`
	State  string `json:"state"`
	Size   int64  `json:"size"`
}
type deviceRelease struct {
	Tag        string               `json:"tag_name"`
	Prerelease *bool                `json:"prerelease"`
	Draft      *bool                `json:"draft"`
	Assets     []deviceReleaseAsset `json:"assets"`
}
type deviceFeed struct {
	Schema      int             `json:"schemaVersion"`
	Repository  string          `json:"repository"`
	GeneratedAt string          `json:"generatedAt"`
	Releases    []deviceRelease `json:"releases"`
}
type deviceFeedCache struct {
	Feed        *deviceFeed `json:"feed"`
	ETag        string      `json:"etag"`
	NextRequest int64       `json:"nextRequest"`
	NextAuto    int64       `json:"nextAuto"`
	Failures    int         `json:"failures"`
	Channel     string      `json:"channel"`
}

func deviceUpdateCacheFile() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "guanlan", "device-updates.json")
}
func loadDeviceFeedCache() deviceFeedCache {
	var state deviceFeedCache
	if stat, err := os.Stat(deviceUpdateCacheFile()); err != nil || stat.Size() > 5*1024*1024 {
		return state
	}
	data, err := os.ReadFile(deviceUpdateCacheFile())
	if err == nil {
		_ = json.Unmarshal(data, &state)
	}
	if state.Feed != nil && validateDeviceFeed(*state.Feed) != nil {
		state.Feed = nil
		state.ETag = ""
	}
	return state
}
func validateDeviceFeed(feed deviceFeed) error {
	if feed.Schema != 1 || feed.Repository != "IGNGserver/guanlan-monitor" || feed.Releases == nil {
		return fmt.Errorf("invalid update feed")
	}
	if _, err := time.Parse(time.RFC3339Nano, feed.GeneratedAt); err != nil {
		return fmt.Errorf("invalid update feed timestamp")
	}
	for _, r := range feed.Releases {
		if r.Tag == "" || r.Prerelease == nil || r.Draft == nil || r.Assets == nil {
			return fmt.Errorf("invalid release entry")
		}
		for _, a := range r.Assets {
			if a.Name == "" || a.URL == "" {
				return fmt.Errorf("invalid release asset")
			}
		}
	}
	return nil
}
func persistDeviceFeed(state deviceFeedCache) error {
	file := deviceUpdateCacheFile()
	if file == "" {
		return fmt.Errorf("update cache directory unavailable")
	}
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return os.WriteFile(file, data, 0600)
}
func savedUpdateChannel() string {
	channel := loadDeviceFeedCache().Channel
	if channel == "stable" || channel == "preview" {
		return channel
	}
	if BuildChannel == "stable" {
		return "stable"
	}
	return "preview"
}

func fetchDeviceUpdate(current, channel string) (*cliUpdateInfo, error) {
	deviceUpdateMu.Lock()
	defer deviceUpdateMu.Unlock()
	state := loadDeviceFeedCache()
	now := time.Now().Unix()
	state.Channel = channel
	if channel == "test" {
		state.Channel = "preview"
	}
	if err := persistDeviceFeed(state); err != nil {
		return nil, err
	}
	if now >= state.NextRequest {
		state.NextRequest = now + 60
		if err := persistDeviceFeed(state); err != nil {
			return nil, err
		}
		request, err := http.NewRequest(http.MethodGet, deviceUpdateFeedURL, nil)
		if err != nil {
			return nil, err
		}
		if state.ETag != "" {
			request.Header.Set("If-None-Match", state.ETag)
		}
		response, fetchErr := (&http.Client{Timeout: 20 * time.Second}).Do(request)
		if fetchErr == nil {
			defer response.Body.Close()
			if response.StatusCode == http.StatusNotModified && state.Feed != nil {
				state.Failures = 0
			} else if response.StatusCode == http.StatusOK {
				var feed deviceFeed
				var data []byte
				data, fetchErr = io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
				if fetchErr == nil && len(data) > 4*1024*1024 {
					fetchErr = fmt.Errorf("update feed too large")
				}
				if fetchErr == nil {
					fetchErr = json.Unmarshal(data, &feed)
				}
				if fetchErr == nil {
					fetchErr = validateDeviceFeed(feed)
				}
				if fetchErr == nil {
					state.Feed = &feed
					state.ETag = response.Header.Get("ETag")
					state.Failures = 0
				}
			} else {
				fetchErr = fmt.Errorf("update feed returned HTTP %d", response.StatusCode)
				if delay, err := strconv.ParseInt(response.Header.Get("Retry-After"), 10, 64); err == nil && now+delay > state.NextRequest {
					state.NextRequest = now + delay
				} else if deadline, err := http.ParseTime(response.Header.Get("Retry-After")); err == nil && deadline.Unix() > state.NextRequest {
					state.NextRequest = deadline.Unix()
				}
				if reset, err := strconv.ParseInt(response.Header.Get("X-RateLimit-Reset"), 10, 64); err == nil && reset > state.NextRequest {
					state.NextRequest = reset
				}
			}
		}
		if fetchErr != nil {
			state.Failures++
			delay := int64(60 << min(state.Failures, 8))
			if now+delay > state.NextRequest {
				state.NextRequest = now + delay
			}
		} else {
			state.NextAuto = now + 6*3600 + int64(time.Now().Nanosecond()%1800)
		}
		if err := persistDeviceFeed(state); err != nil {
			return nil, err
		}
		if fetchErr != nil && state.Feed == nil {
			return nil, fetchErr
		}
	}
	if state.Feed == nil {
		return nil, fmt.Errorf("update service unavailable; request cooling down")
	}
	info := &cliUpdateInfo{CurrentVersion: current, CurrentChannel: state.Channel}
	if state.Failures > 0 {
		info.Message = "Update service unavailable; using the last verified feed during cooldown."
	}
	releases := make([]deviceRelease, 0, len(state.Feed.Releases))
	for _, r := range state.Feed.Releases {
		if validReleaseVersion(r.Tag) {
			releases = append(releases, r)
		}
	}
	sort.Slice(releases, func(i, j int) bool {
		return compareReleaseVersions(releases[i].Tag, releases[j].Tag) > 0
	})
	for _, release := range releases {
		if release.Draft == nil || *release.Draft || release.Prerelease == nil || !validReleaseVersion(release.Tag) || compareReleaseVersions(release.Tag, current) <= 0 {
			continue
		}
		if state.Channel == "stable" && (*release.Prerelease || strings.Contains(strings.Split(release.Tag, "+")[0], "-")) {
			continue
		}
		version := strings.TrimPrefix(release.Tag, "v")
		name := ""
		if runtime.GOOS == "windows" && runtime.GOARCH == "amd64" {
			name = "DeviceStateConsole-Windows-Setup-v" + version + ".exe"
		}
		if runtime.GOOS == "linux" && runtime.GOARCH == "amd64" {
			name = "DeviceStateConsole-Linux-Install-v" + version + ".deb"
		}
		for _, asset := range release.Assets {
			sha := strings.TrimPrefix(asset.Digest, "sha256:")
			if name == "" || asset.Name != name || asset.State != "uploaded" || asset.Size <= 0 || asset.Size > 9007199254740991 || !strings.HasPrefix(asset.Digest, "sha256:") || !validSha256(sha) || !strings.HasPrefix(asset.URL, "https://github.com/IGNGserver/guanlan-monitor/releases/download/"+release.Tag+"/") {
				continue
			}
			info.Available = true
			info.LatestVersion = &version
			info.AssetURL = &asset.URL
			info.AssetName = &asset.Name
			info.AssetSize = asset.Size
			info.Sha256 = &sha
			return info, nil
		}
	}
	return info, nil
}
