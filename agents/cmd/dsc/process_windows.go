//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func detachCommand(command *exec.Cmd) {
	const (
		detachedProcess = 0x00000008
		createNoWindow  = 0x08000000
	)
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess | createNoWindow}
}
