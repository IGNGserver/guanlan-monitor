package collector

import (
	"os"
	"runtime/debug"
	"strings"
	"sync"
)

// BuildVersion is injected by release build scripts. Local ad-hoc builds are
// intentionally marked as dev so they cannot be mistaken for a release.
var BuildVersion = "dev"

// BuildChannel is injected by release build scripts. Test is the safe default
// for local and prerelease builds.
var BuildChannel = "test"

var (
	bundleRootMu         sync.RWMutex
	configuredBundleRoot string
	memoryTuningOnce     sync.Once
)

// SetBuildInfo configures the release version and channel reported by the collector.
func SetBuildInfo(version, channel string) {
	if trimmed := strings.TrimSpace(version); trimmed != "" {
		BuildVersion = trimmed
	}
	if trimmed := strings.TrimSpace(channel); trimmed != "" {
		BuildChannel = trimmed
	}
}

// SetBundleRoot records the directory containing bundled hardware probes/libraries
// when the collector runs embedded inside guanlan-agent.
func SetBundleRoot(dir string) {
	bundleRootMu.Lock()
	configuredBundleRoot = strings.TrimSpace(dir)
	bundleRootMu.Unlock()
}

func currentBundleRoot() string {
	bundleRootMu.RLock()
	defer bundleRootMu.RUnlock()
	return configuredBundleRoot
}

// ApplyHeadlessMemoryTuning bounds Go heap retention in headless/daemon runs
// unless the operator explicitly set GOGC or GOMEMLIMIT.
func ApplyHeadlessMemoryTuning() {
	memoryTuningOnce.Do(func() {
		if strings.TrimSpace(os.Getenv("GOGC")) == "" {
			debug.SetGCPercent(50)
		}
		if strings.TrimSpace(os.Getenv("GOMEMLIMIT")) == "" {
			debug.SetMemoryLimit(32 << 20)
		}
	})
}
