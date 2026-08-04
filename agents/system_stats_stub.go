//go:build !windows

package main

func collectWindowsSystemStats() (systemStats, bool) {
	return systemStats{}, false
}
