// Package macos isolates Darwin APIs from portable metric semantics.
package macos

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

type Memory struct {
	Total, Used, Available, Cached, Compressed, SwapTotal, SwapUsed uint64
	// Pressure is the kernel memory-pressure level name, empty when unknown.
	Pressure string
}

// MemoryFromPages follows Activity Monitor physical memory accounting. The
// compressed logical-page count is NOT added to physical compressor pages.
func MemoryFromPages(total, page, internal, purgeable, wired, compressor, external uint64) (Memory, error) {
	if total == 0 || page == 0 || purgeable > internal {
		return Memory{}, errors.New("invalid Mach VM statistics")
	}
	maxPages := total / page
	app := internal - purgeable
	if app > maxPages || wired > maxPages-app || compressor > maxPages-app-wired || external > maxPages || purgeable > maxPages-external {
		return Memory{}, errors.New("inconsistent Mach VM statistics")
	}
	used := (app + wired + compressor) * page
	return Memory{Total: total, Used: used, Available: total - used, Cached: (external + purgeable) * page, Compressed: compressor * page}, nil
}

// DecodeSMC accepts only types with an established byte-order/scale. Unsupported
// formats are unavailable rather than guessed. Reads never issue SMC writes.
func DecodeSMC(kind string, data []byte) (*float64, error) {
	var value float64
	switch kind {
	case "sp78":
		if len(data) != 2 {
			return nil, errors.New("invalid sp78 size")
		}
		value = float64(int16(binary.BigEndian.Uint16(data))) / 256
	case "fpe2":
		if len(data) != 2 {
			return nil, errors.New("invalid fpe2 size")
		}
		value = float64(binary.BigEndian.Uint16(data)) / 4
	case "flt ":
		if len(data) != 4 {
			return nil, errors.New("invalid float size")
		}
		value = float64(math.Float32frombits(binary.LittleEndian.Uint32(data)))
	case "ui8 ":
		if len(data) != 1 {
			return nil, errors.New("invalid ui8 size")
		}
		value = float64(data[0])
	case "ui16":
		if len(data) != 2 {
			return nil, errors.New("invalid ui16 size")
		}
		value = float64(binary.BigEndian.Uint16(data))
	default:
		return nil, errors.New("unsupported SMC type")
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return nil, errors.New("non-finite SMC value")
	}
	return &value, nil
}

type State struct {
	Name      string
	Residency int64
	MHz       *float64
}
type FrequencyChannel struct {
	Name   string
	States []State
	Table  []float64
}

// Frequency returns an active-residency-weighted mean only when EVERY active
// state has an explicit frequency. "V2" is an index, never 2 MHz. An unknown
// state or a reset invalidates the channel rather than lowering the average.
func Frequency(channels []FrequencyChannel) *float64 {
	var weighted, total float64
	for _, channel := range channels {
		tableValid := len(channel.Table) > 0
		indices := map[int]bool{}
		for _, state := range channel.States {
			switch strings.ToUpper(state.Name) {
			case "IDLE", "OFF", "DOWN":
				continue
			}
			index, err := strconv.Atoi(strings.TrimPrefix(state.Name, "V"))
			if !strings.HasPrefix(state.Name, "V") || err != nil || index < 0 || index >= len(channel.Table) || indices[index] {
				tableValid = false
			} else {
				indices[index] = true
			}
		}
		if len(indices) != len(channel.Table) {
			tableValid = false
		}
		for _, state := range channel.States {
			if state.Residency < 0 {
				return nil
			}
			if state.Residency == 0 {
				continue
			}
			switch strings.ToUpper(state.Name) {
			case "IDLE", "OFF", "DOWN":
				continue
			}
			mhz := state.MHz
			if mhz == nil && tableValid {
				index, _ := strconv.Atoi(strings.TrimPrefix(state.Name, "V"))
				value := channel.Table[index]
				mhz = &value
			}
			if mhz == nil {
				name := strings.TrimSpace(state.Name)
				factor := 1.0
				if strings.HasSuffix(name, "MHz") {
					name = strings.TrimSpace(strings.TrimSuffix(name, "MHz"))
				} else if strings.HasSuffix(name, "GHz") {
					name = strings.TrimSpace(strings.TrimSuffix(name, "GHz"))
					factor = 1000
				} else {
					return nil
				}
				value, err := strconv.ParseFloat(name, 64)
				if err != nil {
					return nil
				}
				value *= factor
				mhz = &value
			}
			if *mhz <= 0 || *mhz > 10000 || math.IsNaN(*mhz) || math.IsInf(*mhz, 0) {
				return nil
			}
			weighted += *mhz * float64(state.Residency)
			total += float64(state.Residency)
		}
	}
	if total == 0 {
		return nil
	}
	result := weighted / total
	return &result
}

type GPU struct {
	ID, Name, Class, MemoryKind, Driver string
	Usage, Frequency, Temperature       *float64
	MemoryUsed, MemoryTotal             *uint64
}

// Registry topology paths persist across reboot; numeric registry entry IDs do
// not. Hash the path so telemetry identifiers stay bounded and contain no path.
func GPUIdentity(registryPath string) string {
	digest := sha256.Sum256([]byte(registryPath))
	return "macos-gpu-" + fmt.Sprintf("%x", digest[:12])
}

type SMCValue struct {
	Key, Type string
	Data      []byte
}
type Hardware struct {
	AppleSilicon                       bool
	GPUs                               []GPU
	SMC                                []SMCValue
	CPUChannels                        []FrequencyChannel
	SMCError, GPUError, FrequencyError string
}

// APFSIdentity names a container by its system/data volume (the boot disk,
// reported as "/") or by its first volume mounted under /Volumes. diskutil's
// plist carries no mount points, so mounts maps BSD device identifiers
// (disk3s1) to mount points from getfsstat; a sealed system snapshot
// (disk3s4s1 on "/") counts for its volume (disk3s4).
func APFSIdentity(container APFSContainer, mounts map[string]string) (id, name, mount string) {
	id = container.APFSContainerUUID
	if id == "" {
		id = container.ContainerReference
	}
	id = "apfs-" + id
	mountOf := func(device, explicit string) string {
		if explicit != "" {
			return explicit
		}
		if value := mounts[device]; value != "" {
			return value
		}
		for candidate, value := range mounts {
			if strings.HasPrefix(candidate, device+"s") && apfsSnapshotSuffix(strings.TrimPrefix(candidate, device+"s")) {
				return value
			}
		}
		return ""
	}
	system := ""
	boot := false
	for _, volume := range container.Volumes {
		point := mountOf(volume.DeviceIdentifier, volume.MountPoint)
		if point == "/" || point == "/System/Volumes/Data" {
			boot = true
			if hasRole(volume.Roles, "System") || point == "/" {
				system = volume.Name
			} else if system == "" {
				system = strings.TrimSuffix(volume.Name, " - Data")
			}
			continue
		}
		if !boot && mount == "" && strings.HasPrefix(point, "/Volumes/") {
			name = volume.Name
			mount = point
		}
	}
	if boot {
		return id, system, "/"
	}
	return
}

func apfsSnapshotSuffix(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func hasRole(roles []string, role string) bool {
	for _, item := range roles {
		if item == role {
			return true
		}
	}
	return false
}

type APFSContainer struct {
	ContainerReference            string
	APFSContainerUUID             string
	CapacityCeiling, CapacityFree uint64
	PhysicalStores                []struct{ DeviceIdentifier string }
	Volumes                       []struct {
		DeviceIdentifier, Name, MountPoint string
		Roles                              []string
	}
}

// ParseAPFS keeps containers separate from volumes, so siblings never multiply
// reported capacity. Device identifiers are used for IO only for a single store.
func ParseAPFS(data []byte) ([]APFSContainer, error) {
	var report struct{ Containers []APFSContainer }
	if err := json.Unmarshal(data, &report); err != nil {
		return nil, err
	}
	if report.Containers == nil {
		return nil, errors.New("missing APFS containers")
	}
	seen := map[string]bool{}
	result := []APFSContainer{}
	for _, c := range report.Containers {
		key := c.APFSContainerUUID
		if key == "" {
			key = c.ContainerReference
		}
		if key == "" || c.CapacityFree > c.CapacityCeiling {
			return nil, errors.New("invalid APFS container")
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, c)
	}
	return result, nil
}
