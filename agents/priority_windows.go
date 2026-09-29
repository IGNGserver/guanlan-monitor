//go:build windows

package main

import "golang.org/x/sys/windows"

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
