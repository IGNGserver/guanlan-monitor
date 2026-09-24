//go:build !windows

package main

func collectWindowsSystemStats() (systemStats, bool) {
	return systemStats{}, false
}

func collectWindowsCommitMemory() (uint64, uint64, bool) {
	return 0, 0, false
}
