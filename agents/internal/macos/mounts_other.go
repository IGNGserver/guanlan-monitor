//go:build !darwin

package macos

import "errors"

func ReadMounts() (map[string]string, error) {
	return nil, errors.New("mount table requires macOS")
}
