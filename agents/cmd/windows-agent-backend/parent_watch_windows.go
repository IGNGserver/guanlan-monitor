//go:build windows

package main

import (
	"fmt"

	"golang.org/x/sys/windows"
)

type windowsParentProcessWatcher struct {
	handle windows.Handle
}

func newParentProcessWatcher(pid int) (parentProcessWatcher, error) {
	if pid <= 0 {
		return nil, fmt.Errorf("invalid frontend parent pid: %d", pid)
	}

	handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return nil, fmt.Errorf("open frontend parent process %d: %w", pid, err)
	}

	return &windowsParentProcessWatcher{handle: handle}, nil
}

func (w *windowsParentProcessWatcher) Wait() error {
	status, err := windows.WaitForSingleObject(w.handle, windows.INFINITE)
	if err != nil {
		return err
	}
	if status != windows.WAIT_OBJECT_0 {
		return fmt.Errorf("unexpected wait status: %d", status)
	}
	return nil
}

func (w *windowsParentProcessWatcher) Close() error {
	return windows.CloseHandle(w.handle)
}
