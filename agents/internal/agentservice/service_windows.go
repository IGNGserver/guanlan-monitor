//go:build windows

package agentservice

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/sys/windows/svc"
)

// serviceName is the SCM identity. It is deliberately stable: the installer,
// the helper commands and the update flow all refer to it.
const serviceName = "GuanlanAgent"

// taskName is the scheduled-task fallback identity.
const taskName = "GuanlanAgent"

// Install registers the native service. If the SCM rejects the registration the
// function falls back to an AtStartup SYSTEM scheduled task and reports which
// mechanism won.
func Install(spec Spec) (Status, error) {
	if strings.TrimSpace(spec.Executable) == "" {
		return Status{Kind: KindNone}, errors.New("agentservice: executable path is required")
	}
	displayName := spec.DisplayName
	if displayName == "" {
		displayName = serviceName
	}

	if err := ensureConfigDocument(spec.ConfigDir); err != nil {
		return Status{Kind: KindNone}, err
	}

	binPath := spec.commandLine()
	// Remove any previous registration first so an upgrade is idempotent.
	_, _ = runCommand("sc.exe", "stop", serviceName)
	_, _ = runCommand("sc.exe", "delete", serviceName)
	_, _ = runCommand("schtasks.exe", "/Delete", "/TN", taskName, "/F")

	if _, err := runCommand("sc.exe", "create", serviceName,
		"binPath=", binPath,
		"start=", "auto",
		"DisplayName=", displayName,
		"obj=", "LocalSystem",
	); err == nil {
		_, _ = runCommand("sc.exe", "description", serviceName,
			"Guanlan device status agent. Collects and uploads this computer's metrics.")
		// Bounded automatic recovery: three escalating restarts per day.
		_, _ = runCommand("sc.exe", "failure", serviceName,
			"reset=", "86400",
			"actions=", "restart/5000/restart/10000/restart/30000")
		if _, err := runCommand("sc.exe", "start", serviceName); err != nil {
			return Status{Kind: KindWindowsService, Installed: true, Running: false,
					Detail: "the service was created but did not start; check the Windows event log"},
				fmt.Errorf("start service %s: %w", serviceName, err)
		}
		return Query()
	}

	// Fallback: a boot-time scheduled task running as SYSTEM. This is still a
	// machine-scope, no-interactive-session mechanism, unlike a Run key.
	if output, err := runCommand("schtasks.exe", "/Create", "/TN", taskName,
		"/SC", "ONSTART",
		"/RU", "SYSTEM",
		"/RL", "HIGHEST",
		"/TR", spec.commandLine(),
		"/F",
	); err != nil {
		return Status{Kind: KindNone},
			fmt.Errorf("neither the Windows service nor the scheduled-task fallback could be installed: %w: %s", err, output)
	}
	if output, err := runCommand("schtasks.exe", "/Run", "/TN", taskName); err != nil {
		return Status{Kind: KindScheduledTask, Installed: true, Running: false,
				Detail: "the scheduled task was created but did not start"},
			fmt.Errorf("start scheduled task %s: %w: %s", taskName, err, output)
	}
	return Query()
}

// Uninstall removes both the service and the scheduled-task fallback so an
// installation can always be cleaned up. A missing registration is not an
// error; only a genuine failure to stop a running mechanism is reported.
func Uninstall() (Status, error) {
	status, _ := Query()
	switch status.Kind {
	case KindWindowsService:
		_, _ = runCommand("sc.exe", "stop", serviceName)
		if output, err := runCommand("sc.exe", "delete", serviceName); err != nil {
			return status, fmt.Errorf("delete service: %w: %s", err, output)
		}
	case KindScheduledTask:
		if output, err := runCommand("schtasks.exe", "/Delete", "/TN", taskName, "/F"); err != nil {
			return status, fmt.Errorf("delete scheduled task: %w: %s", err, output)
		}
	}
	// Clean up the other mechanism too, in case an earlier release installed it.
	_, _ = runCommand("sc.exe", "delete", serviceName)
	_, _ = runCommand("schtasks.exe", "/Delete", "/TN", taskName, "/F")
	return Status{Kind: KindNone, Installed: false, Running: false}, nil
}

// Start starts whichever mechanism is installed.
func Start() (Status, error) {
	status, err := Query()
	if err != nil {
		return status, err
	}
	switch status.Kind {
	case KindWindowsService:
		if output, err := runCommand("sc.exe", "start", serviceName); err != nil {
			return status, fmt.Errorf("start service: %w: %s", err, output)
		}
	case KindScheduledTask:
		if output, err := runCommand("schtasks.exe", "/Run", "/TN", taskName); err != nil {
			return status, fmt.Errorf("start scheduled task: %w: %s", err, output)
		}
	default:
		return status, errors.New("the agent service is not installed")
	}
	return Query()
}

// Stop stops whichever mechanism is installed.
func Stop() (Status, error) {
	status, err := Query()
	if err != nil {
		return status, err
	}
	switch status.Kind {
	case KindWindowsService:
		if output, err := runCommand("sc.exe", "stop", serviceName); err != nil {
			return status, fmt.Errorf("stop service: %w: %s", err, output)
		}
	case KindScheduledTask:
		if output, err := runCommand("schtasks.exe", "/End", "/TN", taskName); err != nil {
			return status, fmt.Errorf("stop scheduled task: %w: %s", err, output)
		}
	default:
		return status, errors.New("the agent service is not installed")
	}
	return Query()
}

// Query reports the current mechanism and state.
func Query() (Status, error) {
	if output, err := runCommand("sc.exe", "query", serviceName); err == nil {
		return Status{
			Kind:      KindWindowsService,
			Installed: true,
			Running:   strings.Contains(strings.ToUpper(output), "RUNNING"),
			Detail:    "windows service",
		}, nil
	}

	if output, err := runCommand("schtasks.exe", "/Query", "/TN", taskName, "/FO", "LIST"); err == nil {
		upper := strings.ToUpper(output)
		running := strings.Contains(upper, "RUNNING") || strings.Contains(upper, "正在运行")
		return Status{
			Kind:      KindScheduledTask,
			Installed: true,
			Running:   running,
			Detail:    "scheduled task (at startup, SYSTEM)",
		}, nil
	}

	return Status{Kind: KindNone, Installed: false, Running: false}, nil
}

// Name returns the service identity used in messages and JSON output.
func Name() string { return serviceName }

// runAsService hosts run under the Service Control Manager. It reports
// handled=false when the process was not started by the SCM, so the caller can
// keep running in the foreground.
func runAsService(run func(context.Context) error) (bool, error) {
	isService, err := svc.IsWindowsService()
	if err != nil {
		return false, err
	}
	if !isService {
		return false, nil
	}
	return true, svc.Run(serviceName, &handler{run: run})
}

type handler struct {
	run func(context.Context) error
}

func (h *handler) Execute(_ []string, requests <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	const accepted = svc.AcceptStop | svc.AcceptShutdown

	changes <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- h.run(ctx) }()

	changes <- svc.Status{State: svc.Running, Accepts: accepted}
	for {
		select {
		case err := <-done:
			changes <- svc.Status{State: svc.StopPending}
			if err != nil {
				return true, 1
			}
			return false, 0
		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				changes <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				changes <- svc.Status{State: svc.StopPending}
				cancel()
				<-done
				return false, 0
			}
		}
	}
}
