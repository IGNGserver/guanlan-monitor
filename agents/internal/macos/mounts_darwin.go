//go:build darwin

package macos

import (
	"strings"

	"golang.org/x/sys/unix"
)

// ReadMounts maps BSD device identifiers (disk3s1) to their mount points via
// getfsstat. diskutil's APFS plist carries no mount points.
func ReadMounts() (map[string]string, error) {
	count, err := unix.Getfsstat(nil, unix.MNT_NOWAIT)
	if err != nil {
		return nil, err
	}
	buffer := make([]unix.Statfs_t, count+8)
	count, err = unix.Getfsstat(buffer, unix.MNT_NOWAIT)
	if err != nil {
		return nil, err
	}
	result := make(map[string]string, count)
	for _, entry := range buffer[:count] {
		device := unix.ByteSliceToString(entry.Mntfromname[:])
		if strings.HasPrefix(device, "/dev/") {
			result[strings.TrimPrefix(device, "/dev/")] = unix.ByteSliceToString(entry.Mntonname[:])
		}
	}
	return result, nil
}
