//go:build !windows

package agentconfig

import (
	"os"
	"path/filepath"
	"syscall"
)

// matchDirectoryOwner hands a file to the owner of its directory.
//
// The machine-scope directory belongs to the service account (guanlan on Linux)
// while administration commands run as root. Without this the service would be
// unable to read a document that root just wrote, which is exactly what the
// unattended install path does.
func matchDirectoryOwner(path string) error {
	if os.Geteuid() != 0 {
		return nil
	}
	directory, err := os.Stat(filepath.Dir(path))
	if err != nil {
		return nil
	}
	directoryStat, ok := directory.Sys().(*syscall.Stat_t)
	if !ok {
		return nil
	}
	file, err := os.Stat(path)
	if err != nil {
		return nil
	}
	if fileStat, ok := file.Sys().(*syscall.Stat_t); ok &&
		fileStat.Uid == directoryStat.Uid && fileStat.Gid == directoryStat.Gid {
		return nil
	}
	return os.Chown(path, int(directoryStat.Uid), int(directoryStat.Gid))
}
