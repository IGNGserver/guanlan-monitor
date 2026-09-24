package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"device-state-console/agent/internal/agentconfig"
)

// daemonOptions is the resolved configuration of a daemon run.
type daemonOptions struct {
	Listen         string
	BundleRoot     string
	ConfigRoot     string
	ChildBinary    string
	ParentPID      int
	LocalToken     string
	LocalTokenFile string
	// ServiceMode marks a run hosted by the machine-scope service manager. It
	// changes configuration defaults (machine scope, continuous collection),
	// guarantees a control token and disables parent-process watching.
	ServiceMode bool
}

// parseDaemonOptions parses the daemon flags. Helper subcommands are dispatched
// before this function runs, so an unknown flag here is a genuine usage error.
func parseDaemonOptions(args []string) (daemonOptions, error) {
	flags := flag.NewFlagSet("guanlan-agent", flag.ContinueOnError)
	flags.SetOutput(io.Discard)

	listenAddr := flags.String("listen", agentconfig.DefaultListenAddress, "local listen address")
	bundleRoot := flags.String("bundle-root", "", "directory containing packaged backend/agent binaries")
	configRoot := flags.String("config-root", "", "directory for local config files")
	childBinary := flags.String("child-binary", "", "path to the collector binary")
	parentPID := flags.Int("parent-pid", 0, "frontend process id to watch; the daemon exits when that process exits")
	localToken := flags.String("local-token", "", "legacy bearer token for local control API calls")
	localTokenFile := flags.String("local-token-file", "", "file containing the bearer token for local control API calls")
	serviceMode := flags.Bool("service-mode", false, "run as the machine-scope agent service")

	if err := flags.Parse(args); err != nil {
		return daemonOptions{}, err
	}
	return daemonOptions{
		Listen:         strings.TrimSpace(*listenAddr),
		BundleRoot:     *bundleRoot,
		ConfigRoot:     *configRoot,
		ChildBinary:    *childBinary,
		ParentPID:      *parentPID,
		LocalToken:     *localToken,
		LocalTokenFile: *localTokenFile,
		ServiceMode:    *serviceMode,
	}, nil
}

// runDaemon serves the local control API until ctx is cancelled or a control
// request asks the daemon to stop.
func runDaemon(ctx context.Context, options daemonOptions) error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	resolvedBundleRoot := filepath.Dir(exePath)
	if strings.TrimSpace(options.BundleRoot) != "" {
		resolvedBundleRoot = options.BundleRoot
	}
	resolvedBundleRoot, err = filepath.Abs(resolvedBundleRoot)
	if err != nil {
		return err
	}

	// The machine-scope service owns the machine configuration directory; a
	// desktop-spawned backend keeps using whatever root it was given.
	resolvedConfigRoot := resolvedBundleRoot
	if options.ServiceMode {
		resolvedConfigRoot = agentconfig.ResolveDir(options.ConfigRoot)
	} else if strings.TrimSpace(options.ConfigRoot) != "" {
		resolvedConfigRoot = options.ConfigRoot
	}
	resolvedConfigRoot, err = filepath.Abs(resolvedConfigRoot)
	if err != nil {
		return err
	}

	localToken := strings.TrimSpace(options.LocalToken)
	tokenFile := strings.TrimSpace(options.LocalTokenFile)
	if options.ServiceMode && tokenFile == "" {
		// A long-lived service on a fixed port must always be authenticated;
		// without a token any local process could read the access key and
		// control the collector.
		tokenFile = agentconfig.TokenPath(resolvedConfigRoot)
	}
	if tokenFile != "" {
		tokenPath := tokenFile
		if !filepath.IsAbs(tokenPath) {
			tokenPath = filepath.Join(resolvedConfigRoot, tokenPath)
		}
		if options.ServiceMode {
			if err := ensureControlToken(tokenPath); err != nil {
				return err
			}
		}
		rawToken, readErr := os.ReadFile(tokenPath)
		if readErr != nil {
			return fmt.Errorf("read local token file: %w", readErr)
		}
		if len(rawToken) > 4096 {
			return errors.New("local token file is too large")
		}
		localToken = strings.TrimSpace(string(rawToken))
	}
	if err := validateListenAddress(options.Listen, localToken); err != nil {
		return err
	}

	configPath := agentconfig.ConfigPath(resolvedConfigRoot)
	collectorName := "device-state-console-agent"
	if runtime.GOOS == "windows" {
		collectorName += ".exe"
	}
	resolvedChildBinary := strings.TrimSpace(options.ChildBinary)
	if resolvedChildBinary == "" {
		resolvedChildBinary = filepath.Join(resolvedBundleRoot, collectorName)
		if _, statErr := os.Stat(resolvedChildBinary); os.IsNotExist(statErr) {
			// A packaged layout may keep the CLI outside the agent directory.
			packaged := filepath.Join(filepath.Dir(exePath), "..", "resources", "agent", collectorName)
			if _, packagedErr := os.Stat(packaged); packagedErr == nil {
				resolvedBundleRoot = filepath.Dir(packaged)
				resolvedChildBinary = packaged
			}
		}
	} else if !filepath.IsAbs(resolvedChildBinary) {
		resolvedChildBinary = filepath.Join(resolvedBundleRoot, resolvedChildBinary)
	}
	resolvedChildBinary, err = filepath.Abs(resolvedChildBinary)
	if err != nil {
		return err
	}

	s := &server{
		configPath:       configPath,
		syncStatePath:    agentconfig.SyncStatePath(resolvedConfigRoot),
		diagnosticsPath:  agentconfig.DiagnosticsPath(resolvedConfigRoot),
		pendingStatePath: agentconfig.PendingStateCachePath(resolvedConfigRoot),
		childBinaryPath:  resolvedChildBinary,
		localToken:       localToken,
		requestClient:    &http.Client{Timeout: 10 * time.Second},
		config:           defaultLocalConfig(),
		connectionState:  "stopped",
		backendStartedAt: time.Now().UTC(),
		serviceScope:     options.ServiceMode,
	}
	if err := s.loadConfig(); err != nil {
		log.Printf("load config failed: %v", err)
	}
	if err := s.loadSyncState(); err != nil {
		log.Printf("load cloud sync state failed: %v", err)
	}
	if s.config.AutoStartCollector && s.config.DataRecordingEnabled {
		s.mu.Lock()
		if err := s.startChildLocked(false); err != nil {
			s.connectionState = "error"
			s.appendDiagnosticLocked("auto-start collector failed: %v", err)
		}
		s.mu.Unlock()
	}
	if childJob, err := newJobObject(); err != nil {
		log.Printf("create child job object failed: %v", err)
		s.appendDiagnostic("child job object unavailable: %v", err)
	} else {
		s.childJob = childJob
	}
	if s.childJob != nil {
		defer func() {
			if err := s.childJob.Close(); err != nil {
				log.Printf("close child job object failed: %v", err)
			}
		}()
	}
	s.appendDiagnostic("backend started; mode=%s config=%s child=%s", daemonMode(options), s.configPath, s.childBinaryPath)
	if options.ParentPID > 0 && !options.ServiceMode {
		if err := s.attachFrontendParent(options.ParentPID, "startup"); err != nil {
			s.appendDiagnostic("frontend parent watch failed for pid=%d: %v", options.ParentPID, err)
			s.requestShutdown(fmt.Sprintf("frontend parent process unavailable; pid=%d", options.ParentPID))
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/state", s.handleState)
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/control/start", s.handleStart)
	mux.HandleFunc("/api/control/stop", s.handleStop)
	mux.HandleFunc("/api/control/restart", s.handleRestart)
	mux.HandleFunc("/api/control/attach-frontend", s.handleAttachFrontend)
	mux.HandleFunc("/api/control/check-connection", s.handleConnectionCheck)
	mux.HandleFunc("/api/control/shutdown", s.handleBackendShutdown)
	mux.HandleFunc("/api/cloud/push", s.handleCloudPush)
	mux.HandleFunc("/api/probes/detect", s.handleProbeDetect)

	httpServer := &http.Server{
		Addr:    options.Listen,
		Handler: mux,
	}
	s.httpServer = httpServer

	// A service stop, a container stop or a signal cancels the context and goes
	// through the same graceful drain as an explicit control request.
	go func() {
		<-ctx.Done()
		s.requestShutdown("daemon context cancelled")
	}()

	log.Printf("guanlan-agent backend v%s (%s) listening on http://%s", BuildVersion, daemonMode(options), options.Listen)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func daemonMode(options daemonOptions) string {
	if options.ServiceMode {
		return "service"
	}
	return "desktop"
}

// ensureControlToken creates the loopback control token when it is missing. The
// file is written owner-only; the GUI and the helper commands read it instead of
// passing a secret on the command line.
func ensureControlToken(path string) error {
	if raw, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(raw))) >= 16 {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return err
	}
	token := hex.EncodeToString(buffer)
	return agentconfig.WriteFileAtomic(path, []byte(token+"\n"), 0o600)
}
