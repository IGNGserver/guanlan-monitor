//go:build !windows

package main

import "fmt"

func newParentProcessWatcher(pid int) (parentProcessWatcher, error) {
	return nil, fmt.Errorf("parent process watch is unsupported on this platform: pid=%d", pid)
}
