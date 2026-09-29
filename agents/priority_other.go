//go:build !windows

package main

// lowerCurrentProcessPriority is a no-op on platforms without the Windows
// priority-class primitive; the only caller is the Windows sensor helper.
func lowerCurrentProcessPriority() {}
