//go:build windows

package collector

import (
	"encoding/binary"
	"fmt"
	"math/bits"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	modPDH                      = windows.NewLazySystemDLL("pdh.dll")
	procPdhOpenQueryW           = modPDH.NewProc("PdhOpenQueryW")
	procPdhAddEnglishCounterW   = modPDH.NewProc("PdhAddEnglishCounterW")
	procPdhCollectQueryData     = modPDH.NewProc("PdhCollectQueryData")
	procPdhGetFormattedArrayW   = modPDH.NewProc("PdhGetFormattedCounterArrayW")
	procPdhCloseQuery           = modPDH.NewProc("PdhCloseQuery")

	modKernel32                           = windows.NewLazySystemDLL("kernel32.dll")
	procGetLogicalProcessorInformation    = modKernel32.NewProc("GetLogicalProcessorInformation")

	modWlanapi            = windows.NewLazySystemDLL("wlanapi.dll")
	procWlanOpenHandle    = modWlanapi.NewProc("WlanOpenHandle")
	procWlanCloseHandle   = modWlanapi.NewProc("WlanCloseHandle")
	procWlanEnumIfaces    = modWlanapi.NewProc("WlanEnumInterfaces")
	procWlanQueryIface    = modWlanapi.NewProc("WlanQueryInterface")
	procWlanFreeMemory    = modWlanapi.NewProc("WlanFreeMemory")

	modIphlpapi                   = windows.NewLazySystemDLL("iphlpapi.dll")
	procConvertInterfaceGuidToLuid = modIphlpapi.NewProc("ConvertInterfaceGuidToLuid")
	procConvertInterfaceLuidToAlias = modIphlpapi.NewProc("ConvertInterfaceLuidToAlias")
)

const (
	pdhFmtDouble    uint32 = 0x00000200
	pdhFmtLarge     uint32 = 0x00000400
	pdhMoreData     uint32 = 0x800007D2
	pdhCStatusValid uint32 = 0x00000000
	pdhCStatusNew   uint32 = 0x00000001
)

type pdhCounterItemDouble struct {
	Name        *uint16
	CStatus     uint32
	_           uint32
	DoubleValue float64
}

type pdhCounterItemLarge struct {
	Name       *uint16
	CStatus    uint32
	_          uint32
	LargeValue int64
}

func pdhReadDoubleArray(counter uintptr) (map[string]float64, bool) {
	var bufSize uint32
	var count uint32
	r1, _, _ := procPdhGetFormattedArrayW.Call(counter, uintptr(pdhFmtDouble), uintptr(unsafe.Pointer(&bufSize)), uintptr(unsafe.Pointer(&count)), 0)
	if uint32(r1) != pdhMoreData || bufSize == 0 || count == 0 {
		return nil, uint32(r1) == 0
	}
	words := make([]uint64, (int(bufSize)+7)/8)
	r2, _, _ := procPdhGetFormattedArrayW.Call(counter, uintptr(pdhFmtDouble), uintptr(unsafe.Pointer(&bufSize)), uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&words[0])))
	if r2 != 0 {
		return nil, false
	}
	items := unsafe.Slice((*pdhCounterItemDouble)(unsafe.Pointer(&words[0])), int(count))
	out := make(map[string]float64, int(count))
	for _, item := range items {
		if item.Name == nil || (item.CStatus != pdhCStatusValid && item.CStatus != pdhCStatusNew) {
			continue
		}
		name := windows.UTF16PtrToString(item.Name)
		if name != "" {
			out[name] = item.DoubleValue
		}
	}
	return out, true
}

func pdhReadLargeArray(counter uintptr) (map[string]uint64, bool) {
	var bufSize uint32
	var count uint32
	r1, _, _ := procPdhGetFormattedArrayW.Call(counter, uintptr(pdhFmtLarge), uintptr(unsafe.Pointer(&bufSize)), uintptr(unsafe.Pointer(&count)), 0)
	if uint32(r1) != pdhMoreData || bufSize == 0 || count == 0 {
		return nil, uint32(r1) == 0
	}
	words := make([]uint64, (int(bufSize)+7)/8)
	r2, _, _ := procPdhGetFormattedArrayW.Call(counter, uintptr(pdhFmtLarge), uintptr(unsafe.Pointer(&bufSize)), uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&words[0])))
	if r2 != 0 {
		return nil, false
	}
	items := unsafe.Slice((*pdhCounterItemLarge)(unsafe.Pointer(&words[0])), int(count))
	out := make(map[string]uint64, int(count))
	for _, item := range items {
		if item.Name == nil || (item.CStatus != pdhCStatusValid && item.CStatus != pdhCStatusNew) || item.LargeValue < 0 {
			continue
		}
		name := windows.UTF16PtrToString(item.Name)
		if name != "" {
			out[name] = uint64(item.LargeValue)
		}
	}
	return out, true
}

func pdhAddEnglishCounter(query uintptr, counterPath string) (uintptr, bool) {
	utf16Path, err := windows.UTF16PtrFromString(counterPath)
	if err != nil {
		return 0, false
	}
	var handle uintptr
	r1, _, _ := procPdhAddEnglishCounterW.Call(query, uintptr(unsafe.Pointer(utf16Path)), 0, uintptr(unsafe.Pointer(&handle)))
	if r1 != 0 || handle == 0 {
		return 0, false
	}
	return handle, true
}

var (
	pdhCPUMu        sync.Mutex
	pdhCPUQuery     uintptr
	pdhCPUCounter   uintptr
	pdhCPUCollected bool
)

func nativeWindowsCPUPerformancePercent() (float64, bool) {
	if !isDefaultProbeRunner() {
		return 0, false
	}
	if err := modPDH.Load(); err != nil {
		return 0, false
	}
	pdhCPUMu.Lock()
	defer pdhCPUMu.Unlock()

	if pdhCPUQuery == 0 {
		var q uintptr
		if r1, _, _ := procPdhOpenQueryW.Call(0, 0, uintptr(unsafe.Pointer(&q))); r1 != 0 || q == 0 {
			return 0, false
		}
		counter, ok := pdhAddEnglishCounter(q, `\Processor Information(*)\% Processor Performance`)
		if !ok {
			_, _, _ = procPdhCloseQuery.Call(q)
			return 0, false
		}
		pdhCPUQuery = q
		pdhCPUCounter = counter
		pdhCPUCollected = false
	}

	if r1, _, _ := procPdhCollectQueryData.Call(pdhCPUQuery); r1 != 0 {
		_, _, _ = procPdhCloseQuery.Call(pdhCPUQuery)
		pdhCPUQuery = 0
		pdhCPUCounter = 0
		pdhCPUCollected = false
		return 0, false
	}

	values, ok := pdhReadDoubleArray(pdhCPUCounter)
	if (!ok || len(values) == 0) && !pdhCPUCollected {
		time.Sleep(50 * time.Millisecond)
		if r1, _, _ := procPdhCollectQueryData.Call(pdhCPUQuery); r1 == 0 {
			values, ok = pdhReadDoubleArray(pdhCPUCounter)
		}
	}
	pdhCPUCollected = true
	if !ok || len(values) == 0 {
		return 0, false
	}

	var sum float64
	var count int
	for name, val := range values {
		if strings.Contains(strings.ToLower(name), "_total") || !isFinitePositive(val) {
			continue
		}
		sum += val
		count++
	}
	if count == 0 {
		return 0, false
	}
	return sum / float64(count), true
}

var (
	pdhGPUMu               sync.Mutex
	pdhGPUQuery            uintptr
	pdhGPUDedicatedCounter uintptr
	pdhGPUSharedCounter    uintptr
	pdhGPUCommitCounter    uintptr
	pdhGPUEngineCounter    uintptr
	pdhGPUUnsupported      bool
	pdhGPUUnsupportedAt    time.Time
)

func nativeWindowsGPUPerformanceRecords() ([]windowsGPUAdapterMemoryRecord, []windowsGPUEngineRecord, bool) {
	if !isDefaultProbeRunner() {
		return nil, nil, false
	}
	if err := modPDH.Load(); err != nil {
		return nil, nil, false
	}
	pdhGPUMu.Lock()
	defer pdhGPUMu.Unlock()

	if pdhGPUUnsupported && time.Since(pdhGPUUnsupportedAt) < hardwareAssetCacheTTL {
		return []windowsGPUAdapterMemoryRecord{}, []windowsGPUEngineRecord{}, true
	}

	if pdhGPUQuery == 0 {
		var q uintptr
		if r1, _, _ := procPdhOpenQueryW.Call(0, 0, uintptr(unsafe.Pointer(&q))); r1 != 0 || q == 0 {
			return nil, nil, false
		}
		ded, ok1 := pdhAddEnglishCounter(q, `\GPU Adapter Memory(*)\Dedicated Usage`)
		shr, ok2 := pdhAddEnglishCounter(q, `\GPU Adapter Memory(*)\Shared Usage`)
		com, ok3 := pdhAddEnglishCounter(q, `\GPU Adapter Memory(*)\Total Committed`)
		eng, ok4 := pdhAddEnglishCounter(q, `\GPU Engine(*)\Utilization Percentage`)
		if !ok1 && !ok2 && !ok3 && !ok4 {
			_, _, _ = procPdhCloseQuery.Call(q)
			pdhGPUUnsupported = true
			pdhGPUUnsupportedAt = time.Now()
			return []windowsGPUAdapterMemoryRecord{}, []windowsGPUEngineRecord{}, true
		}
		pdhGPUQuery = q
		pdhGPUDedicatedCounter = ded
		pdhGPUSharedCounter = shr
		pdhGPUCommitCounter = com
		pdhGPUEngineCounter = eng
		_, _, _ = procPdhCollectQueryData.Call(pdhGPUQuery)
	}

	if r1, _, _ := procPdhCollectQueryData.Call(pdhGPUQuery); r1 != 0 {
		_, _, _ = procPdhCloseQuery.Call(pdhGPUQuery)
		pdhGPUQuery = 0
		pdhGPUDedicatedCounter = 0
		pdhGPUSharedCounter = 0
		pdhGPUCommitCounter = 0
		pdhGPUEngineCounter = 0
		return []windowsGPUAdapterMemoryRecord{}, []windowsGPUEngineRecord{}, true
	}

	var dedicatedMap, sharedMap, committedMap map[string]uint64
	if pdhGPUDedicatedCounter != 0 {
		dedicatedMap, _ = pdhReadLargeArray(pdhGPUDedicatedCounter)
	}
	if pdhGPUSharedCounter != 0 {
		sharedMap, _ = pdhReadLargeArray(pdhGPUSharedCounter)
	}
	if pdhGPUCommitCounter != 0 {
		committedMap, _ = pdhReadLargeArray(pdhGPUCommitCounter)
	}

	memNames := make(map[string]struct{}, len(dedicatedMap)+len(sharedMap)+len(committedMap))
	for k := range dedicatedMap {
		memNames[k] = struct{}{}
	}
	for k := range sharedMap {
		memNames[k] = struct{}{}
	}
	for k := range committedMap {
		memNames[k] = struct{}{}
	}
	memory := make([]windowsGPUAdapterMemoryRecord, 0, len(memNames))
	for name := range memNames {
		memory = append(memory, windowsGPUAdapterMemoryRecord{
			Name:           name,
			DedicatedUsage: dedicatedMap[name],
			SharedUsage:    sharedMap[name],
			TotalCommitted: committedMap[name],
		})
	}

	var engines []windowsGPUEngineRecord
	if pdhGPUEngineCounter != 0 {
		if engineMap, ok := pdhReadDoubleArray(pdhGPUEngineCounter); ok {
			engines = make([]windowsGPUEngineRecord, 0, len(engineMap))
			for name, util := range engineMap {
				engines = append(engines, windowsGPUEngineRecord{
					Name:               name,
					UtilizationPercent: util,
				})
			}
		}
	}
	return memory, engines, true
}

func nativeWindowsDiskPartitionRows() ([]windowsDiskPartitionRow, bool) {
	if !isDefaultProbeRunner() {
		return nil, false
	}
	buf := make([]uint16, 256)
	n, err := windows.GetLogicalDriveStrings(uint32(len(buf)-1), &buf[0])
	if err != nil || n == 0 {
		return nil, false
	}
	if int(n) >= len(buf) {
		buf = make([]uint16, int(n)+2)
		n, err = windows.GetLogicalDriveStrings(uint32(len(buf)-1), &buf[0])
		if err != nil || n == 0 {
			return nil, false
		}
	}

	var rows []windowsDiskPartitionRow
	fsBuf := make([]uint16, 64)
	slice := buf[:n]
	start := 0
	for i := 0; i <= len(slice); i++ {
		if i < len(slice) && slice[i] != 0 {
			continue
		}
		if i > start {
			root := windows.UTF16ToString(slice[start:i])
			rootPtr, ptrErr := windows.UTF16PtrFromString(root)
			if ptrErr == nil && windows.GetDriveType(rootPtr) == windows.DRIVE_FIXED {
				fs := ""
				for k := range fsBuf {
					fsBuf[k] = 0
				}
				if volErr := windows.GetVolumeInformation(rootPtr, nil, 0, nil, nil, nil, &fsBuf[0], uint32(len(fsBuf))); volErr == nil {
					fs = windows.UTF16ToString(fsBuf)
				}
				device := strings.TrimRight(root, `\`)
				if device != "" {
					rows = append(rows, windowsDiskPartitionRow{
						Device:     device,
						MountPoint: device + `\`,
						FileSystem: fs,
					})
				}
			}
		}
		start = i + 1
	}
	return rows, len(rows) > 0
}

type systemLogicalProcessorInformation struct {
	ProcessorMask uintptr
	Relationship  uint32
	Flags         [16]byte
}

func nativeWindowsCPUPackagesFallback() (*float64, []cpuPackageStats, bool) {
	if !isDefaultProbeRunner() {
		return nil, nil, false
	}
	if err := modKernel32.Load(); err != nil {
		return nil, nil, false
	}

	var byteLen uint32
	_, _, _ = procGetLogicalProcessorInformation.Call(0, uintptr(unsafe.Pointer(&byteLen)))
	if byteLen == 0 {
		return nil, nil, false
	}
	entrySize := uint32(unsafe.Sizeof(systemLogicalProcessorInformation{}))
	if entrySize == 0 || byteLen%entrySize != 0 {
		return nil, nil, false
	}
	count := int(byteLen / entrySize)
	entries := make([]systemLogicalProcessorInformation, count)
	r1, _, _ := procGetLogicalProcessorInformation.Call(uintptr(unsafe.Pointer(&entries[0])), uintptr(unsafe.Pointer(&byteLen)))
	if r1 == 0 {
		return nil, nil, false
	}

	type pkgInfo struct {
		mask         uintptr
		coreCount    int
		logicalCount int
		l3Bytes      uint64
	}
	var pkgs []pkgInfo
	var coreMasks []uintptr
	type cacheRecord struct {
		mask uintptr
		size uint64
	}
	var l3Caches []cacheRecord

	for _, e := range entries {
		switch e.Relationship {
		case 0: // RelationProcessorCore
			coreMasks = append(coreMasks, e.ProcessorMask)
		case 2: // RelationCache
			level := e.Flags[0]
			size := uint64(binary.LittleEndian.Uint32(e.Flags[4:8]))
			if level == 3 && size > 0 {
				l3Caches = append(l3Caches, cacheRecord{mask: e.ProcessorMask, size: size})
			}
		case 3: // RelationProcessorPackage
			pkgs = append(pkgs, pkgInfo{
				mask:         e.ProcessorMask,
				logicalCount: bits.OnesCount64(uint64(e.ProcessorMask)),
			})
		}
	}
	if len(pkgs) == 0 {
		var allMask uintptr
		for _, cm := range coreMasks {
			allMask |= cm
		}
		if allMask == 0 {
			return nil, nil, false
		}
		pkgs = append(pkgs, pkgInfo{
			mask:         allMask,
			coreCount:    len(coreMasks),
			logicalCount: bits.OnesCount64(uint64(allMask)),
		})
	} else {
		for i := range pkgs {
			for _, cm := range coreMasks {
				if pkgs[i].mask&cm != 0 {
					pkgs[i].coreCount++
				}
			}
		}
	}
	for i := range pkgs {
		for _, c := range l3Caches {
			if pkgs[i].mask&c.mask != 0 {
				pkgs[i].l3Bytes += c.size
			}
		}
	}

	cpuName, mhz := readWindowsProcessorRegistry()
	var freqPtr *float64
	if mhz > 0 {
		v := mhz
		freqPtr = &v
	}

	out := make([]cpuPackageStats, 0, len(pkgs))
	for i, p := range pkgs {
		name := cpuName
		if name == "" {
			name = fmt.Sprintf("CPU %d", i+1)
		}
		out = append(out, cpuPackageStats{
			ID:           fmt.Sprintf("cpu-cpu%d", i),
			Name:         name,
			SocketIndex:  i,
			Model:        cpuName,
			CoreCount:    p.coreCount,
			LogicalCount: p.logicalCount,
			L3CacheBytes: p.l3Bytes,
			FrequencyMHz: cloneFloat64(freqPtr),
		})
	}
	return freqPtr, out, len(out) > 0
}

func readWindowsProcessorRegistry() (string, float64) {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DESCRIPTION\System\CentralProcessor\0`, registry.QUERY_VALUE)
	if err != nil {
		return "", 0
	}
	defer key.Close()
	name, _, _ := key.GetStringValue("ProcessorNameString")
	mhzVal, _, _ := key.GetIntegerValue("~MHz")
	return strings.TrimSpace(name), float64(mhzVal)
}

type wlanInterfaceInfo struct {
	InterfaceGuid           windows.GUID
	StrInterfaceDescription [256]uint16
	IsState                 uint32
}

type wlanInterfaceInfoListHeader struct {
	NumberOfItems uint32
	Index         uint32
}

type dot11SSID struct {
	SSIDLength uint32
	SSID       [32]byte
}

type wlanAssociationAttributes struct {
	Dot11Ssid         dot11SSID
	Dot11BssType      uint32
	Dot11Bssid        [6]byte
	_                 [2]byte
	Dot11PhyType      uint32
	Dot11PhyIndex     uint32
	WlanSignalQuality uint32
	RxRate            uint32
	TxRate            uint32
}

type wlanConnectionAttributesPrefix struct {
	IsState                   uint32
	WlanConnectionMode        uint32
	StrProfileName            [256]uint16
	WlanAssociationAttributes wlanAssociationAttributes
}

func interfaceAliasFromGUID(guid windows.GUID) string {
	if err := modIphlpapi.Load(); err != nil {
		return ""
	}
	var luid uint64
	if r1, _, _ := procConvertInterfaceGuidToLuid.Call(uintptr(unsafe.Pointer(&guid)), uintptr(unsafe.Pointer(&luid))); r1 != 0 {
		return ""
	}
	aliasBuf := make([]uint16, 257)
	if r1, _, _ := procConvertInterfaceLuidToAlias.Call(uintptr(unsafe.Pointer(&luid)), uintptr(unsafe.Pointer(&aliasBuf[0])), uintptr(len(aliasBuf))); r1 != 0 {
		return ""
	}
	return strings.TrimSpace(windows.UTF16ToString(aliasBuf))
}

func nativeWindowsWifiSignals() (map[string]*float64, bool) {
	if !isDefaultProbeRunner() {
		return nil, false
	}
	result := map[string]*float64{}
	if err := modWlanapi.Load(); err != nil {
		// Wireless LAN feature is not installed on this machine; avoid spawning netsh.
		return result, true
	}

	var negotiated uint32
	var handle uintptr
	r1, _, _ := procWlanOpenHandle.Call(2, 0, uintptr(unsafe.Pointer(&negotiated)), uintptr(unsafe.Pointer(&handle)))
	if r1 != 0 {
		// 1062 = ERROR_SERVICE_NOT_ACTIVE (WlanSvc stopped / no wireless hardware).
		if r1 == 1062 || r1 == 1168 {
			return result, true
		}
		return nil, false
	}
	defer procWlanCloseHandle.Call(handle, 0)

	var listPtr uintptr
	r2, _, _ := procWlanEnumIfaces.Call(handle, 0, uintptr(unsafe.Pointer(&listPtr)))
	if r2 != 0 || listPtr == 0 {
		return result, true
	}
	defer procWlanFreeMemory.Call(listPtr)

	header := (*wlanInterfaceInfoListHeader)(unsafe.Pointer(listPtr))
	count := int(header.NumberOfItems)
	if count <= 0 || count > 64 {
		return result, true
	}

	firstItemPtr := listPtr + unsafe.Sizeof(wlanInterfaceInfoListHeader{})
	items := unsafe.Slice((*wlanInterfaceInfo)(unsafe.Pointer(firstItemPtr)), count)
	minAttrSize := uint32(unsafe.Sizeof(wlanConnectionAttributesPrefix{}))

	for i := range items {
		if items[i].IsState != 1 { // 1 = wlan_interface_state_connected
			continue
		}
		guid := items[i].InterfaceGuid
		var dataSize uint32
		var dataPtr uintptr
		var opcodeType uint32
		// 7 = wlan_intf_opcode_current_connection
		qr, _, _ := procWlanQueryIface.Call(
			handle,
			uintptr(unsafe.Pointer(&guid)),
			7,
			0,
			uintptr(unsafe.Pointer(&dataSize)),
			uintptr(unsafe.Pointer(&dataPtr)),
			uintptr(unsafe.Pointer(&opcodeType)),
		)
		if qr != 0 || dataPtr == 0 {
			continue
		}
		if dataSize >= minAttrSize {
			attr := (*wlanConnectionAttributesPrefix)(unsafe.Pointer(dataPtr))
			quality := attr.WlanAssociationAttributes.WlanSignalQuality
			if quality <= 100 {
				alias := interfaceAliasFromGUID(guid)
				if alias == "" {
					alias = strings.TrimSpace(windows.UTF16ToString(items[i].StrInterfaceDescription[:]))
				}
				if alias != "" {
					val := float64(quality)
					result[alias] = &val
				}
			}
		}
		_, _, _ = procWlanFreeMemory.Call(dataPtr)
	}
	return result, true
}
