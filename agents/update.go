package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
}

func runUpdateCommand(args []string) error {
	installDir := defaultInstallDir()
	flags := flag.NewFlagSet("update", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	serverURL := flags.String("server-url", os.Getenv("DSC_SERVER_URL"), "Device State Console server URL")
	secret := flags.String("secret", os.Getenv("DSC_AGENT_SECRET"), "shared access key")
	currentVersion := flags.String("current-version", BuildVersion, "current release version")
	channel := flags.String("channel", BuildChannel, "stable or test")
	installDirFlag := flags.String("install-dir", installDir, "installed agent directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	installDir = filepath.Clean(*installDirFlag)
	loadAgentEnvFile(installDir, serverURL, secret)

	if strings.TrimSpace(*serverURL) == "" {
		return errors.New("server URL is required; pass --server-url or set DSC_SERVER_URL")
	}
	if !validChannel(*channel) {
		return fmt.Errorf("invalid channel %q", *channel)
	}
	if !validReleaseVersion(*currentVersion) || *currentVersion == "dev" {
		versionPath := filepath.Join(installDir, "VERSION")
		if data, err := os.ReadFile(versionPath); err == nil && validReleaseVersion(strings.TrimSpace(string(data))) {
			*currentVersion = strings.TrimSpace(string(data))
		}
	}
	if !validReleaseVersion(*currentVersion) {
		return fmt.Errorf("current version %q is not a release version", *currentVersion)
	}

	update, err := fetchCliUpdate(*serverURL, *secret, *currentVersion, *channel)
	if err != nil {
		return err
	}
	if !update.Available {
		fmt.Printf("Device State Console CLI is up to date (%s).\n", *currentVersion)
		return nil
	}
	if update.LatestVersion == nil || update.AssetURL == nil {
		return errors.New("a newer release exists but its CLI asset is missing")
	}
	if compareReleaseVersions(*update.LatestVersion, *currentVersion) <= 0 {
		return fmt.Errorf("server returned a non-newer version %s; refusing downgrade or reinstall", *update.LatestVersion)
	}
	if update.Sha256 == nil || !validSha256(*update.Sha256) {
		return errors.New("update metadata has no valid SHA-256; refusing an unverified package")
	}

	archivePath, err := downloadUpdate(*update.AssetURL, *update.Sha256)
	if err != nil {
		return err
	}
	defer os.Remove(archivePath)

	tempDir, err := os.MkdirTemp(filepath.Dir(installDir), ".dsc-cli-update-")
	if err != nil {
		return fmt.Errorf("create update directory: %w", err)
	}
	defer os.RemoveAll(tempDir)
	if err := extractZipSafely(archivePath, tempDir); err != nil {
		return err
	}

	binaryName := "device-state-console-agent"
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	newBinary, err := findFile(tempDir, binaryName)
	if err != nil {
		return err
	}

	if err := replaceInstalledBinary(installDir, newBinary, binaryName, *update.LatestVersion); err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		fmt.Printf("Device State Console CLI update to %s has been scheduled; the agent will restart after the current command exits.\n", *update.LatestVersion)
	} else {
		fmt.Printf("Device State Console CLI updated to %s.\n", *update.LatestVersion)
	}
	return nil
}

func fetchCliUpdate(serverURL, secret, currentVersion, channel string) (*cliUpdateInfo, error) {
	base := strings.TrimRight(strings.TrimSpace(serverURL), "/")
	query := url.Values{
		"platform":       []string{cliUpdatePlatform()},
		"currentVersion": []string{currentVersion},
		"currentChannel": []string{channel},
		"arch":           []string{runtime.GOARCH},
	}
	request, err := http.NewRequest(http.MethodGet, base+"/api/updates?"+query.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("create update request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	if strings.TrimSpace(secret) != "" {
		request.Header.Set("Authorization", "Bearer "+secret)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("check for update: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("update check returned HTTP %d", response.StatusCode)
	}
	var info cliUpdateInfo
	if err := json.NewDecoder(response.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("decode update metadata: %w", err)
	}
	return &info, nil
}

func downloadUpdate(assetURL, expectedSha256 string) (string, error) {
	request, err := http.NewRequest(http.MethodGet, assetURL, nil)
	if err != nil {
		return "", fmt.Errorf("create package request: %w", err)
	}
	response, err := (&http.Client{Timeout: 30 * time.Minute}).Do(request)
	if err != nil {
		return "", fmt.Errorf("download update: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		return "", fmt.Errorf("download returned HTTP %d", response.StatusCode)
	}

	tempFile, err := os.CreateTemp("", "dsc-cli-update-*.zip")
	if err != nil {
		return "", fmt.Errorf("create package cache: %w", err)
	}
	path := tempFile.Name()
	defer tempFile.Close()
	var copied int64
	total := response.ContentLength
	buffer := make([]byte, 128*1024)
	for {
		read, readErr := response.Body.Read(buffer)
		if read > 0 {
			if _, err := tempFile.Write(buffer[:read]); err != nil {
				os.Remove(path)
				return "", fmt.Errorf("save update: %w", err)
			}
			copied += int64(read)
			if total > 0 {
				fmt.Printf("\rDownloading update: %d%%", copied*100/total)
			} else {
				fmt.Printf("\rDownloading update: %d bytes", copied)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			os.Remove(path)
			return "", fmt.Errorf("download update: %w", readErr)
		}
	}
	fmt.Println()

	digest, err := sha256File(path)
	if err != nil {
		os.Remove(path)
		return "", err
	}
	if !strings.EqualFold(digest, expectedSha256) {
		os.Remove(path)
		return "", fmt.Errorf("SHA-256 mismatch: expected %s, got %s", expectedSha256, digest)
	}
	return path, nil
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
	if runtime.GOOS == "windows" {
		return scheduleWindowsBinaryReplacement(installDir, newBinary, binaryName, version)
	}

	_ = runCommand("systemctl", "stop", "device-state-console-agent.service")
	_ = runCommand("systemctl", "--user", "stop", "device-state-console-agent-backend.service")

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

func cliUpdatePlatform() string {
	if runtime.GOOS == "windows" {
		return "windows-cli"
	}
	return "linux-cli"
}

func validChannel(value string) bool {
	return value == "stable" || value == "test"
}

func validReleaseVersion(value string) bool {
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(value), "v"), ".")
	if len(parts) != 3 {
		return false
	}
	for _, part := range parts {
		if part == "" {
			return false
		}
		for _, char := range part {
			if char < '0' || char > '9' {
				return false
			}
		}
	}
	return true
}

func compareReleaseVersions(left, right string) int {
	leftParts := strings.Split(strings.TrimPrefix(left, "v"), ".")
	rightParts := strings.Split(strings.TrimPrefix(right, "v"), ".")
	for index := 0; index < 3; index++ {
		leftNumber := parseReleasePart(leftParts[index])
		rightNumber := parseReleasePart(rightParts[index])
		if leftNumber > rightNumber {
			return 1
		}
		if leftNumber < rightNumber {
			return -1
		}
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
