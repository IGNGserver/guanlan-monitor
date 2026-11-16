//go:build !windows

package collector

import "os/exec"

// lowerCurrentProcessPriority is a no-op on platforms without the Windows
// priority-class primitive; the only caller is the Windows sensor helper.
func lowerCurrentProcessPriority() {}

func configureBackgroundCommand(_ *exec.Cmd) {}
