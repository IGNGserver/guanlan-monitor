//go:build !darwin || !cgo

package macos

import "errors"

func ReadMemory() (Memory, error) {
	return Memory{}, errors.New("Darwin native collector requires macOS and cgo")
}
func ReadHardware() (Hardware, error) {
	return Hardware{}, errors.New("Darwin native collector requires macOS and cgo")
}
func ReadAPFS() ([]APFSContainer, error) {
	return nil, errors.New("Darwin native collector requires macOS and cgo")
}
