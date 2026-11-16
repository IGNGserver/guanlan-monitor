package collector

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

const windowsLHMWorkerIdleTimeout = 5 * time.Minute

type windowsLHMWorker struct {
	mu        sync.Mutex
	dllPath   string
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    *bufio.Reader
	stderr    bytes.Buffer
	done      chan struct{}
	idleTimer *time.Timer
}

var defaultWindowsLHMWorker windowsLHMWorker

func closeWindowsHardwareWorker() {
	defaultWindowsLHMWorker.Close()
}

func (w *windowsLHMWorker) Close() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopLocked()
}

func (w *windowsLHMWorker) stopLocked() {
	if w.idleTimer != nil {
		w.idleTimer.Stop()
		w.idleTimer = nil
	}
	if w.stdin != nil {
		_, _ = io.WriteString(w.stdin, "EXIT\n")
		_ = w.stdin.Close()
		w.stdin = nil
	}
	if w.cmd != nil && w.cmd.Process != nil {
		done := w.done
		select {
		case <-done:
		case <-time.After(300 * time.Millisecond):
			_ = w.cmd.Process.Kill()
			if done != nil {
				<-done
			}
		}
	}
	w.cmd = nil
	w.stdout = nil
	w.done = nil
	w.dllPath = ""
}

func (w *windowsLHMWorker) resetIdleTimerLocked() {
	if w.idleTimer != nil {
		w.idleTimer.Stop()
	}
	w.idleTimer = time.AfterFunc(windowsLHMWorkerIdleTimeout, func() {
		w.Close()
	})
}

const windowsLHMWorkerScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'

$dllDir = Split-Path -Parent $env:DSC_LHM_DLL
[System.IO.Directory]::SetCurrentDirectory($dllDir)
Set-Location -LiteralPath $dllDir

$resolver = [System.ResolveEventHandler]{
	param($sender, $args)
	try {
		$simpleName = (New-Object System.Reflection.AssemblyName($args.Name)).Name
		$candidate = Join-Path $dllDir ($simpleName + '.dll')
		if (Test-Path -LiteralPath $candidate) {
			return [System.Reflection.Assembly]::LoadFrom($candidate)
		}
	} catch {}
	return $null
}
[System.AppDomain]::CurrentDomain.add_AssemblyResolve($resolver)

try {
	Add-Type -Namespace GuanlanNative -Name WorkingSet -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);' -ErrorAction SilentlyContinue | Out-Null
} catch {}

Add-Type -Path $env:DSC_LHM_DLL

$gpuIds = @{}
try {
	Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
		if ($_.Name -and $_.PNPDeviceID) {
			$gpuIds[[string]$_.Name] = [string]$_.PNPDeviceID
		}
	}
} catch {}

$computer = New-Object LibreHardwareMonitor.Hardware.Computer
$computer.IsCpuEnabled = $true
$computer.IsGpuEnabled = $true
$computer.IsMotherboardEnabled = $true
$computer.IsControllerEnabled = $true
$computer.IsStorageEnabled = $true
$computer.Open()

function Read-Hardware($hardware) {
	$hardware.Update()
	$instanceId = ''
	$temperatureC = $null
	$healthPercent = $null
	$healthStatus = ''
	$healthReason = ''
	$smartAttributes = @()
	if ($gpuIds.ContainsKey([string]$hardware.Name)) {
		$instanceId = $gpuIds[[string]$hardware.Name]
	}
	if ([string]$hardware.HardwareType -eq 'Storage') {
		$storage = $hardware.Storage
		$smart = $null
		if ($storage) { $smart = $storage.Smart }
		if ($smart) {
			if ($smart.Temperature -ne $null) { $temperatureC = [double]$smart.Temperature }
			if ($smart.Life -ne $null) { $healthPercent = [double]$smart.Life }
			$healthStatus = [string]$smart.DiskStatus
			if ($healthStatus -and $healthStatus -ne 'Unknown') {
				$healthReason = 'SMART status from LibreHardwareMonitor'
			}
		}
		$smartAttributes = @($hardware.Attributes | ForEach-Object {
			[pscustomobject]@{ id = [int]$_.Id; name = [string]$_.Name; value = [double]$_.Value; threshold = [double]$_.Threshold }
		})
	}
	$result = @([pscustomobject]@{
		hardwareType = [string]$hardware.HardwareType
		name = [string]$hardware.Name
		instanceId = $instanceId
		temperatureC = $temperatureC
		healthPercent = $healthPercent
		healthStatus = $healthStatus
		healthReason = $healthReason
		smartAttributes = $smartAttributes
		sensors = @($hardware.Sensors | ForEach-Object {
			[pscustomobject]@{ sensorType = [string]$_.SensorType; name = [string]$_.Name; identifier = [string]$_.Identifier; value = $_.Value }
		})
	})
	foreach ($sub in $hardware.SubHardware) {
		$result += Read-Hardware $sub
	}
	return $result
}

try {
	[Console]::Out.WriteLine('READY')
	[Console]::Out.Flush()
	while ($true) {
		$cmd = [Console]::In.ReadLine()
		if ($null -eq $cmd -or $cmd -eq 'EXIT') { break }
		if ($cmd -ne 'POLL') { continue }
		try {
			$rows = @($computer.Hardware | ForEach-Object { Read-Hardware $_ })
			$json = ConvertTo-Json -InputObject @($rows) -Depth 7 -Compress
			if ([string]::IsNullOrWhiteSpace($json)) { $json = '[]' }
			[Console]::Out.WriteLine('OK ' + $json)
		} catch {
			$msg = ($_.Exception.Message -replace '[\r\n]+', ' ')
			[Console]::Out.WriteLine('ERR ' + $msg)
		}
		[Console]::Out.Flush()
		try {
			[System.GC]::Collect([System.GC]::MaxGeneration, [System.GCCollectionMode]::Optimized, $false)
			[GuanlanNative.WorkingSet]::EmptyWorkingSet([System.Diagnostics.Process]::GetCurrentProcess().Handle) | Out-Null
		} catch {}
	}
} finally {
	$computer.Close()
}
`

func (w *windowsLHMWorker) startLocked(ctx context.Context, dllPath string) error {
	w.stopLocked()

	cmd := exec.Command(
		"powershell.exe",
		"-NoLogo",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy", "Bypass",
		"-EncodedCommand", encodePowerShellCommand(windowsLHMWorkerScript),
	)
	configureBackgroundCommand(cmd)
	cmd.Env = append(os.Environ(), "DSC_LHM_DLL="+dllPath)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return err
	}
	w.stderr.Reset()
	cmd.Stderr = &w.stderr

	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		return err
	}
	recordProbeSpawn("powershell")

	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()

	reader := bufio.NewReaderSize(stdoutPipe, 64*1024)
	w.cmd = cmd
	w.stdin = stdin
	w.stdout = reader
	w.done = done
	w.dllPath = dllPath

	line, err := readWorkerLineWithTimeout(ctx, reader, done)
	if err != nil {
		detail := strings.TrimSpace(w.stderr.String())
		w.stopLocked()
		if detail != "" {
			return fmt.Errorf("%w；PowerShell stderr: %s", err, detail)
		}
		return err
	}
	if strings.TrimSpace(line) != "READY" {
		w.stopLocked()
		return fmt.Errorf("unexpected LHM worker handshake: %q", line)
	}
	w.resetIdleTimerLocked()
	return nil
}

func readWorkerLineWithTimeout(ctx context.Context, reader *bufio.Reader, procDone <-chan struct{}) (string, error) {
	type readResult struct {
		line string
		err  error
	}
	ch := make(chan readResult, 1)
	go func() {
		line, err := reader.ReadString('\n')
		ch <- readResult{line: line, err: err}
	}()

	select {
	case res := <-ch:
		if res.err != nil && len(res.line) == 0 {
			return "", res.err
		}
		return strings.TrimSpace(res.line), nil
	case <-procDone:
		select {
		case res := <-ch:
			if len(res.line) > 0 {
				return strings.TrimSpace(res.line), nil
			}
		default:
		}
		return "", errors.New("LHM worker exited unexpectedly")
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func (w *windowsLHMWorker) Poll(ctx context.Context, dllPath string) ([]hardwareSensorSnapshot, error) {
	if runtime.GOOS != "windows" {
		return nil, errors.New("Windows LHM worker is only available on Windows")
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.cmd == nil || w.dllPath != dllPath {
		if err := w.startLocked(ctx, dllPath); err != nil {
			return nil, err
		}
	} else {
		select {
		case <-w.done:
			if err := w.startLocked(ctx, dllPath); err != nil {
				return nil, err
			}
		default:
		}
	}

	if _, err := io.WriteString(w.stdin, "POLL\n"); err != nil {
		w.stopLocked()
		return nil, err
	}
	line, err := readWorkerLineWithTimeout(ctx, w.stdout, w.done)
	if err != nil {
		detail := strings.TrimSpace(w.stderr.String())
		w.stopLocked()
		if detail != "" {
			return nil, fmt.Errorf("%w；PowerShell stderr: %s", err, detail)
		}
		return nil, err
	}
	w.resetIdleTimerLocked()

	if strings.HasPrefix(line, "ERR ") {
		return nil, errors.New(strings.TrimSpace(strings.TrimPrefix(line, "ERR ")))
	}
	if !strings.HasPrefix(line, "OK ") {
		w.stopLocked()
		return nil, fmt.Errorf("unexpected LHM worker response: %q", line)
	}
	payload := strings.TrimSpace(strings.TrimPrefix(line, "OK "))
	snapshots, err := decodeHardwareSnapshots([]byte(payload))
	if err != nil {
		return nil, fmt.Errorf("传感器输出解析失败：%w", err)
	}
	return snapshots, nil
}
