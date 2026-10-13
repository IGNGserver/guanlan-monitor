//go:build darwin && cgo

package macos

/*
#cgo CFLAGS: -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework Foundation -framework IOKit -framework CoreFoundation -mmacosx-version-min=13.0
#include <stdlib.h>
char *guanlan_memory(void);
char *guanlan_hardware(void);
char *guanlan_plist_json(const void *, size_t);
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
	var raw struct{ Total, Page, Internal, Purgeable, Wired, Compressor, External, SwapTotal, SwapUsed uint64 }
	if err := decodeNative(C.guanlan_memory(), &raw); err != nil {
		return Memory{}, err
	}
	memory, err := MemoryFromPages(raw.Total, raw.Page, raw.Internal, raw.Purgeable, raw.Wired, raw.Compressor, raw.External)
	memory.SwapTotal = raw.SwapTotal
	memory.SwapUsed = raw.SwapUsed
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
