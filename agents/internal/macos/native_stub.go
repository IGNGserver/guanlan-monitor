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
func ReadStorage(bool) ([]StorageDevice, error) {
	return nil, errors.New("Darwin native collector requires macOS and cgo")
}
func ReadNetwork() (NetworkReport, error) {
	return NetworkReport{}, errors.New("Darwin native collector requires macOS and cgo")
}
func ReadSystem(bool) (SystemReport, error) {
	return SystemReport{}, errors.New("Darwin native collector requires macOS and cgo")
}
func ReadHIDTemperatures() (HIDReport, error) {
	return HIDReport{}, errors.New("Darwin native collector requires macOS and cgo")
}
func ReadEnergy() (EnergyReport, error) {
	return EnergyReport{}, errors.New("Darwin native collector requires macOS and cgo")
}
func ReadPowerSources() (PowerSourcesReport, error) {
	return PowerSourcesReport{}, errors.New("Darwin native collector requires macOS and cgo")
}
func ReadMemoryProfile() (MemoryHardware, error) {
	return MemoryHardware{}, errors.New("Darwin native collector requires macOS and cgo")
}
func ReadGPUClientTime() (map[int32]uint64, bool, error) {
	return nil, false, errors.New("Darwin native collector requires macOS and cgo")
}
