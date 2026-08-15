//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func detachCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
