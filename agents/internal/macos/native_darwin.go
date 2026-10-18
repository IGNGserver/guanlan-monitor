//go:build darwin && cgo

package macos

/*
#cgo CFLAGS: -mmacosx-version-min=13.0 -fobjc-arc
#cgo LDFLAGS: -framework Foundation -framework IOKit -framework CoreFoundation -framework CoreWLAN -framework SystemConfiguration -mmacosx-version-min=13.0
#include <stdlib.h>
char *guanlan_memory(void);
char *guanlan_hardware(void);
char *guanlan_plist_json(const void *, size_t);
char *guanlan_storage(int);
char *guanlan_network(void);
char *guanlan_system(int);
char *guanlan_hid_temperatures(void);
char *guanlan_energy(void);
char *guanlan_power_sources(void);
char *guanlan_gpu_clients(void);
*/
import "C"

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"sync"
	"time"
	"unsafe"
)

var nativeMu sync.Mutex

func decodeNative(pointer *C.char, destination any) error {
	if pointer == nil {
		return errors.New("Darwin native API unavailable")
	}
	defer C.free(unsafe.Pointer(pointer))
	return json.Unmarshal([]byte(C.GoString(pointer)), destination)
}

func ReadMemory() (Memory, error) {
	var raw struct {
		Total, Page, Internal, Purgeable, Wired, Compressor, External, SwapTotal, SwapUsed uint64
		Pressure                                                                           *int
	}
	if err := decodeNative(C.guanlan_memory(), &raw); err != nil {
		return Memory{}, err
	}
	memory, err := MemoryFromPages(raw.Total, raw.Page, raw.Internal, raw.Purgeable, raw.Wired, raw.Compressor, raw.External)
	memory.SwapTotal = raw.SwapTotal
	memory.SwapUsed = raw.SwapUsed
	if raw.Pressure != nil {
		memory.Pressure = MemoryPressureName(*raw.Pressure)
	}
	return memory, err
}

func ReadHardware() (Hardware, error) {
	nativeMu.Lock()
	defer nativeMu.Unlock()
	var result Hardware
	err := decodeNative(C.guanlan_hardware(), &result)
	for index := range result.GPUs {
		result.GPUs[index].ID = GPUIdentity(result.GPUs[index].ID)
	}
	return result, err
}

func ReadAPFS() ([]APFSContainer, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// Fixed system tool, no shell, no configurable executable under root.
	data, err := exec.CommandContext(ctx, "/usr/sbin/diskutil", "apfs", "list", "-plist").Output()
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > 16*1024*1024 {
		return nil, errors.New("invalid diskutil plist size")
	}
	pointer := C.guanlan_plist_json(unsafe.Pointer(&data[0]), C.size_t(len(data)))
	if pointer == nil {
		return nil, errors.New("invalid diskutil plist")
	}
	defer C.free(unsafe.Pointer(pointer))
	return ParseAPFS([]byte(C.GoString(pointer)))
}

// rawNative copies one bridge report. A nil pointer means the bridge could not
// serialize anything at all, which callers treat as the capability failing.
func rawNative(pointer *C.char) ([]byte, error) {
	if pointer == nil {
		return nil, errors.New("Darwin native API unavailable")
	}
	defer C.free(unsafe.Pointer(pointer))
	return []byte(C.GoString(pointer)), nil
}

// ReadStorage lists whole disks; SMART logs are read only when asked.
func ReadStorage(includeSMART bool) ([]StorageDevice, error) {
	raw, err := rawNative(C.guanlan_storage(cBool(includeSMART)))
	if err != nil {
		return nil, err
	}
	return ParseStorage(raw)
}

func ReadNetwork() (NetworkReport, error) {
	raw, err := rawNative(C.guanlan_network())
	if err != nil {
		return NetworkReport{}, err
	}
	return ParseNetwork(raw)
}

// ReadSystem reads topology and pressure levels; the per-process walk for
// process/thread totals runs only when includeProcesses is set.
func ReadSystem(includeProcesses bool) (SystemReport, error) {
	raw, err := rawNative(C.guanlan_system(cBool(includeProcesses)))
	if err != nil {
		return SystemReport{}, err
	}
	return ParseSystem(raw)
}

// The HID client and IOReport subscriptions are process-wide statics in the
// bridge; serialize them with the other hardware readers.
func ReadHIDTemperatures() (HIDReport, error) {
	nativeMu.Lock()
	defer nativeMu.Unlock()
	raw, err := rawNative(C.guanlan_hid_temperatures())
	if err != nil {
		return HIDReport{}, err
	}
	return ParseHID(raw)
}

func ReadEnergy() (EnergyReport, error) {
	nativeMu.Lock()
	defer nativeMu.Unlock()
	raw, err := rawNative(C.guanlan_energy())
	if err != nil {
		return EnergyReport{}, err
	}
	return ParseEnergy(raw)
}

func ReadPowerSources() (PowerSourcesReport, error) {
	raw, err := rawNative(C.guanlan_power_sources())
	if err != nil {
		return PowerSourcesReport{}, err
	}
	return ParsePowerSources(raw)
}

// ReadMemoryProfile runs system_profiler once; callers cache it for the
// hardware inventory TTL because installed memory cannot change while booted.
func ReadMemoryProfile() (MemoryHardware, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "/usr/sbin/system_profiler", "SPMemoryDataType", "-json", "-detailLevel", "mini").Output()
	if err != nil {
		return MemoryHardware{}, err
	}
	result, ok := ParseMemoryProfile(data)
	if !ok {
		return MemoryHardware{}, errors.New("no memory module data")
	}
	return result, nil
}

func cBool(value bool) C.int {
	if value {
		return 1
	}
	return 0
}

// ReadGPUClientTime returns cumulative GPU nanoseconds per process from the
// accelerator user clients. ok is false when no accelerator publishes
// AppUsage, so callers can fall back to another source.
func ReadGPUClientTime() (map[int32]uint64, bool, error) {
	raw, err := rawNative(C.guanlan_gpu_clients())
	if err != nil {
		return nil, false, err
	}
	return ParseGPUClients(raw)
}
