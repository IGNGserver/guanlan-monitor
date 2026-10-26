package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
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

type cliUpdateInfo struct {
	CurrentVersion string  `json:"currentVersion"`
	CurrentChannel string  `json:"currentChannel"`
	Available      bool    `json:"available"`
	LatestVersion  *string `json:"latestVersion"`
	AssetURL       *string `json:"assetUrl"`
	AssetName      *string `json:"assetName"`
	Sha256         *string `json:"sha256"`
	Message        string  `json:"message"`
	AssetSize      int64   `json:"assetSize"`
}

func runUpdateCommand(args []string) error {
	if runtime.GOOS == "darwin" {
		return errors.New("macOS updates require the complete signed installer package; use the desktop update link")
	}
	flags := flag.NewFlagSet("update", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	// Accepted for old automation; update requests never use Hub URLs or credentials.
	_ = flags.String("server-url", "", "deprecated; unused for updates")
	_ = flags.String("secret", "", "deprecated; unused for updates")
	_ = flags.String("install-dir", "", "deprecated; complete package determines installation")
	currentVersion := flags.String("current-version", BuildVersion, "current release version")
	channel := flags.String("channel", savedUpdateChannel(), "stable or preview (test is a compatibility alias)")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if !validChannel(*channel) || !validReleaseVersion(*currentVersion) {
		return errors.New("invalid current version or update channel")
	}
	if *currentVersion != BuildVersion {
		return errors.New("current-version must match the running agent build; refusing a downgrade bypass")
	}
	update, err := fetchDeviceUpdate(*currentVersion, *channel)
	if err != nil {
		return err
	}
	if update.Message != "" {
		fmt.Fprintln(os.Stderr, update.Message)
	}
	if !update.Available {
		fmt.Printf("No newer installable version on the %s channel.\n", *channel)
		return nil
	}
	if update.LatestVersion == nil || update.AssetURL == nil || update.Sha256 == nil || compareReleaseVersions(*update.LatestVersion, *currentVersion) <= 0 {
		return errors.New("refusing invalid or non-newer update")
	}
	packagePath, err := downloadUpdate(*update.AssetURL, *update.Sha256, update.AssetSize)
	if err != nil {
		return err
	}
	defer os.Remove(packagePath)
	if runtime.GOOS == "windows" {
		exePath := packagePath + ".exe"
		if err := os.Rename(packagePath, exePath); err != nil {
			return err
		}
		command := exec.Command(exePath, "/S")
		defer os.Remove(exePath)
		if err := command.Run(); err != nil {
			_ = os.Remove(exePath)
			return err
		}
		fmt.Printf("Complete Windows installer finished for %s; it manages the desktop and machine service.\n", *update.LatestVersion)
		return nil
	}
	debPath := packagePath + ".deb"
	if err := os.Rename(packagePath, debPath); err != nil {
		return err
	}
	defer os.Remove(debPath)
	command := exec.Command("dpkg", "-i", debPath)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	return command.Run()
}

func fetchAgentUpdate(_ string, _ string, currentVersion, channel string) (*cliUpdateInfo, error) {
	return fetchDeviceUpdate(currentVersion, channel)
}
func allowedUpdateDownloadURL(value string) bool {
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	switch u.Hostname() {
	case "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com":
		return true
	}
	return false
}

var updateDownloadTransport http.RoundTripper = http.DefaultTransport

func downloadUpdate(assetURL, expectedSha256 string, expectedSize int64) (string, error) {
	if !allowedUpdateDownloadURL(assetURL) || !validSha256(expectedSha256) || expectedSize <= 0 || expectedSize > 9007199254740991 {
		return "", errors.New("invalid update package metadata")
	}
	request, err := http.NewRequest(http.MethodGet, assetURL, nil)
	if err != nil {
		return "", fmt.Errorf("create package request: %w", err)
	}
	client := &http.Client{Transport: updateDownloadTransport, Timeout: 30 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 || !allowedUpdateDownloadURL(req.URL.String()) {
			return errors.New("update redirect is not an official HTTPS asset URL")
		}
		return nil
	}}
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("download update: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength >= 0 && response.ContentLength != expectedSize {
		return "", errors.New("update package content length does not match feed")
	}
	file, err := os.CreateTemp("", "guanlan-update-*.package")
	if err != nil {
		return "", fmt.Errorf("create package cache: %w", err)
	}
	name := file.Name()
	keep := false
	defer func() {
		_ = file.Close()
		if !keep {
			_ = os.Remove(name)
		}
	}()
	hasher := sha256.New()
	copied, err := io.Copy(io.MultiWriter(file, hasher), io.LimitReader(response.Body, expectedSize+1))
	if err != nil {
		return "", fmt.Errorf("save update: %w", err)
	}
	if copied != expectedSize {
		return "", errors.New("update package actual length does not match feed")
	}
	if !strings.EqualFold(hex.EncodeToString(hasher.Sum(nil)), expectedSha256) {
		return "", errors.New("update package SHA-256 mismatch")
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	keep = true
	return name, nil
}
func extractZipSafely(archivePath, destination string) error {
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("open update archive: %w", err)
	}
	defer archive.Close()
	root, err := filepath.Abs(destination)
	if err != nil {
		return err
	}
	for _, file := range archive.File {
		target := filepath.Join(root, filepath.FromSlash(file.Name))
		targetAbs, err := filepath.Abs(target)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, targetAbs)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return fmt.Errorf("unsafe path in update archive: %s", file.Name)
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(targetAbs, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(targetAbs), 0755); err != nil {
			return err
		}
		input, err := file.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(targetAbs, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0755)
		if err == nil {
			_, err = io.Copy(output, input)
			output.Close()
		}
		input.Close()
		if err != nil {
			return fmt.Errorf("extract %s: %w", file.Name, err)
		}
	}
	return nil
}

func replaceInstalledBinary(installDir, newBinary, binaryName, version string) error {
	if runtime.GOOS == "darwin" {
		return errors.New("refusing to replace a binary inside a signed macOS installation")
	}
	if runtime.GOOS == "windows" {
		return scheduleWindowsBinaryReplacement(installDir, newBinary, binaryName, version)
	}

	serviceManaged := managedByAgentService()
	if !serviceManaged {
		_ = runCommand("systemctl", "stop", "device-state-console-agent.service")
		_ = runCommand("systemctl", "--user", "stop", "device-state-console-agent-backend.service")
	}

	target := filepath.Join(installDir, binaryName)
	if err := os.MkdirAll(installDir, 0755); err != nil {
		return err
	}
	staged := target + ".new"
	if err := copyFile(newBinary, staged, 0755); err != nil {
		return fmt.Errorf("stage updated binary: %w", err)
	}
	backup := target + ".backup-" + time.Now().UTC().Format("20060102-150405")
	if err := os.Rename(target, backup); err != nil {
		os.Remove(staged)
		return fmt.Errorf("backup current binary: %w", err)
	}
	if err := os.Rename(staged, target); err != nil {
		_ = os.Rename(backup, target)
		return fmt.Errorf("activate updated binary: %w", err)
	}
	versionPath := filepath.Join(installDir, "VERSION")
	previousVersion, _ := os.ReadFile(versionPath)
	if err := os.WriteFile(versionPath, []byte(strings.TrimSpace(version)+"\n"), 0644); err != nil {
		_ = os.Remove(target)
		_ = os.Rename(backup, target)
		_ = os.WriteFile(versionPath, previousVersion, 0644)
		return fmt.Errorf("write updated VERSION: %w", err)
	}

	if serviceManaged {
		// The machine-scope service supervises this process: exiting lets it
		// restart the collector from the replaced binary without touching the
		// service manager.
		return nil
	}
	if runtime.GOOS == "windows" {
		startWindowsAgentProcesses()
	} else {
		_ = runCommand("systemctl", "start", "device-state-console-agent.service")
		time.Sleep(2 * time.Second)
		if err := runCommand("systemctl", "is-active", "--quiet", "device-state-console-agent.service"); err != nil {
			_ = os.Remove(target)
			_ = os.Rename(backup, target)
			_ = os.WriteFile(versionPath, previousVersion, 0644)
			_ = runCommand("systemctl", "start", "device-state-console-agent.service")
			return fmt.Errorf("start Linux agent after update: %w", err)
		}
	}
	return nil
}

func scheduleWindowsBinaryReplacement(installDir, newBinary, binaryName, version string) error {
	stopWindowsAgentProcesses()

	target := filepath.Join(installDir, binaryName)
	if err := os.MkdirAll(installDir, 0755); err != nil {
		return err
	}
	staged := target + ".new"
	if err := copyFile(newBinary, staged, 0755); err != nil {
		return fmt.Errorf("stage updated binary: %w", err)
	}

	versionPath := filepath.Join(installDir, "VERSION")
	scriptFile, err := os.CreateTemp("", "dsc-cli-update-*.ps1")
	if err != nil {
		os.Remove(staged)
		return fmt.Errorf("create Windows update helper: %w", err)
	}
	scriptPath := scriptFile.Name()
	if _, err := scriptFile.WriteString(windowsUpdateHelperScript); err != nil {
		scriptFile.Close()
		os.Remove(scriptPath)
		os.Remove(staged)
		return fmt.Errorf("write Windows update helper: %w", err)
	}
	if err := scriptFile.Close(); err != nil {
		os.Remove(scriptPath)
		os.Remove(staged)
		return fmt.Errorf("close Windows update helper: %w", err)
	}

	command := exec.Command(
		"powershell.exe",
		"-WindowStyle", "Hidden",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy", "Bypass",
		"-File", scriptPath,
		"-OriginalProcessId", strconv.Itoa(os.Getpid()),
		"-InstallDir", installDir,
		"-Staged", staged,
		"-Target", target,
		"-VersionPath", versionPath,
		"-Version", version,
	)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		os.Remove(scriptPath)
		os.Remove(staged)
		return fmt.Errorf("start Windows update helper: %w", err)
	}
	return nil
}

const windowsUpdateHelperScript = `
param(
  [Parameter(Mandatory = $true)][int]$OriginalProcessId,
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$Staged,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$VersionPath,
  [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = "Stop"
$backup = "$Target.backup-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
$activated = $false

function Stop-AgentProcesses {
  foreach ($taskName in @("DeviceStateConsoleAgent", "Device State Console Agent")) {
    & schtasks.exe /End /TN $taskName 2>$null | Out-Null
  }
  Get-CimInstance Win32_Process -Filter "Name='device-state-console-agent.exe'" |
    Where-Object { $_.ProcessId -ne $OriginalProcessId } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $OriginalProcessId -and
      $_.CommandLine -and
      $_.CommandLine.IndexOf($InstallDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if (-not (Get-Process -Id $OriginalProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 250
  }
  if (Get-Process -Id $OriginalProcessId -ErrorAction SilentlyContinue) {
    throw "the original update process did not exit"
  }

  Stop-AgentProcesses
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      Move-Item -LiteralPath $Target -Destination $backup -Force
      Move-Item -LiteralPath $Staged -Destination $Target -Force
      $activated = $true
      break
    } catch {
      if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $Target)) {
        Move-Item -LiteralPath $backup -Destination $Target -Force -ErrorAction SilentlyContinue
      }
      Stop-AgentProcesses
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $activated) { throw "could not replace the installed agent binary" }

  try {
    Set-Content -LiteralPath $VersionPath -Value ($Version + [Environment]::NewLine) -Encoding ASCII
  } catch {
    Remove-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $backup -Destination $Target -Force -ErrorAction SilentlyContinue
    throw
  }

  foreach ($taskName in @("DeviceStateConsoleAgent", "Device State Console Agent")) {
    & schtasks.exe /Run /TN $taskName 2>$null | Out-Null
  }
} catch {
  if (-not (Test-Path -LiteralPath $Target) -and (Test-Path -LiteralPath $backup)) {
    Move-Item -LiteralPath $backup -Destination $Target -Force -ErrorAction SilentlyContinue
  }
} finally {
  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
}
`

func stopWindowsAgentProcesses() {
	_ = runCommand("schtasks.exe", "/End", "/TN", "DeviceStateConsoleAgent")
	_ = runCommand("schtasks.exe", "/End", "/TN", "Device State Console Agent")
	command := fmt.Sprintf(
		"Get-CimInstance Win32_Process -Filter \"Name='device-state-console-agent.exe'\" | Where-Object ProcessId -ne %d | Stop-Process -Force -ErrorAction SilentlyContinue",
		os.Getpid(),
	)
	_ = runCommand("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
		command)
}

func startWindowsAgentProcesses() {
	_ = runCommand("schtasks.exe", "/Run", "/TN", "DeviceStateConsoleAgent")
	_ = runCommand("schtasks.exe", "/Run", "/TN", "Device State Console Agent")
}

func runCommand(name string, args ...string) error {
	command := exec.Command(name, args...)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	return command.Run()
}

func copyFile(source, destination string, mode os.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return err
	}
	return output.Close()
}

func findFile(root, name string) (string, error) {
	var found string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.EqualFold(entry.Name(), name) {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if found == "" {
		return "", fmt.Errorf("updated binary %s was not found in archive", name)
	}
	return found, nil
}

func sha256File(path string) (string, error) {
	input, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer input.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, input); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func loadAgentEnvFile(installDir string, serverURL, secret *string) {
	data, err := os.ReadFile(filepath.Join(installDir, "agent.env"))
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		value = strings.Trim(strings.TrimSpace(value), "\"")
		switch key {
		case "DSC_SERVER_URL":
			if strings.TrimSpace(*serverURL) == "" {
				*serverURL = value
			}
		case "DSC_AGENT_SECRET":
			if strings.TrimSpace(*secret) == "" {
				*secret = value
			}
		}
	}
}

func defaultInstallDir() string {
	if configured := strings.TrimSpace(os.Getenv("DSC_INSTALL_DIR")); configured != "" {
		return configured
	}
	if runtime.GOOS == "windows" {
		if programData := os.Getenv("ProgramData"); programData != "" {
			return filepath.Join(programData, "DeviceStateConsoleAgent")
		}
		return filepath.Join("C:\\ProgramData", "DeviceStateConsoleAgent")
	}
	return "/opt/device-state-console-agent"
}

// updatePlatform reports which release asset family this collector belongs to.
// The retired windows-cli/linux-cli platforms no longer exist; a collector
// installed by the desktop package belongs to that platform.
func updatePlatform() string {
	if runtime.GOOS == "windows" {
		return "windows-gui"
	}
	if runtime.GOOS == "darwin" {
		return "macos-gui"
	}
	return "linux-gui"
}

// managedByAgentService reports whether this collector is a child of the
// machine-scope service. Such a collector must not stop or start the service
// manager itself: the service owns the process lifecycle, and stopping the unit
// from inside would kill this very process mid-update.
func managedByAgentService() bool {
	return strings.TrimSpace(os.Getenv("DSC_AGENT_SERVICE_MANAGED")) == "1"
}

func validChannel(value string) bool {
	return value == "stable" || value == "preview" || value == "test"
}

func validReleaseVersion(value string) bool {
	_, ok := parseUpdateSemver(value)
	return ok
}

func compareReleaseVersions(left, right string) int {
	a, aok := parseUpdateSemver(left)
	b, bok := parseUpdateSemver(right)
	if !aok || !bok {
		return 0
	}
	for i := 0; i < 3; i++ {
		x, _ := strconv.ParseUint(a[i], 10, 64)
		y, _ := strconv.ParseUint(b[i], 10, 64)
		if x > y {
			return 1
		}
		if x < y {
			return -1
		}
	}
	if a[3] == "" || b[3] == "" {
		if a[3] == b[3] {
			return 0
		}
		if a[3] == "" {
			return 1
		}
		return -1
	}
	x, y := strings.Split(a[3], "."), strings.Split(b[3], ".")
	for i := 0; i < len(x) || i < len(y); i++ {
		if i >= len(x) {
			return -1
		}
		if i >= len(y) {
			return 1
		}
		if x[i] == y[i] {
			continue
		}
		xn, xe := strconv.ParseUint(x[i], 10, 64)
		yn, ye := strconv.ParseUint(y[i], 10, 64)
		if xe == nil && ye == nil {
			if xn > yn {
				return 1
			}
			return -1
		}
		if xe == nil {
			return -1
		}
		if ye == nil {
			return 1
		}
		if x[i] > y[i] {
			return 1
		}
		return -1
	}
	return 0
}
func parseReleasePart(value string) int64 {
	var result int64
	for _, char := range value {
		result = result*10 + int64(char-'0')
	}
	return result
}

func validSha256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}
