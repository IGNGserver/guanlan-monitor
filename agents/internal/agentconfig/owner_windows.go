//go:build windows

package agentconfig

// matchDirectoryOwner is a no-op on Windows: the machine-scope directory is
// protected with an ACL instead of POSIX ownership.
func matchDirectoryOwner(string) error { return nil }
