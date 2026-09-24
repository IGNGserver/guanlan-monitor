//go:build !windows

package agentconfig

import "os"

func replaceFile(source, destination string) error {
	return os.Rename(source, destination)
}
