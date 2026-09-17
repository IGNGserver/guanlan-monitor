package agentconfig

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// WriteFileAtomic writes raw to path through a same-directory temporary file so
// a crash or a concurrent reader never observes a partially written document.
func WriteFileAtomic(path string, raw []byte, mode os.FileMode) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	_ = os.Chmod(directory, 0o700)

	temporary, err := os.CreateTemp(directory, ".dsc-state-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)

	if err := temporary.Chmod(mode); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := replaceFile(temporaryPath, path); err != nil {
		return fmt.Errorf("replace %s: %w", path, err)
	}
	if err := os.Chmod(path, mode); err != nil {
		return err
	}
	return matchDirectoryOwner(path)
}

// ReadFileLimited reads at most MaxConfigBytes from path.
func ReadFileLimited(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, MaxConfigBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > MaxConfigBytes {
		return nil, fmt.Errorf("file %s is too large", path)
	}
	return raw, nil
}
