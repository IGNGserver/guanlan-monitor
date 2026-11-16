//go:build windows

package collector

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// lowerCurrentProcessPriority drops this process to below-normal CPU priority.
// Lowering one's own priority needs no elevation, so the SYSTEM helper keeps the
// token the sensors require while yielding CPU scheduling to foreground work.
func lowerCurrentProcessPriority() {
	handle, err := windows.GetCurrentProcess()
	if err != nil {
		return
	}
	_ = windows.SetPriorityClass(handle, windows.BELOW_NORMAL_PRIORITY_CLASS)
}

func configureBackgroundCommand(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.BELOW_NORMAL_PRIORITY_CLASS | windows.CREATE_NO_WINDOW,
	}
}
