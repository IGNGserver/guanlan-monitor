//go:build windows

package live

import (
	"context"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	pdhSuccess        = uint32(0)
	pdhNewData        = uint32(1)
	pdhMoreData       = uint32(0x800007D2)
	pdhFormatDouble   = uint32(0x00000200)
	pdhFormatNoCap100 = uint32(0x00010000)
)

var (
	pdhDLL                    = windows.NewLazySystemDLL("pdh.dll")
	pdhOpenQuery              = pdhDLL.NewProc("PdhOpenQueryW")
	pdhAddEnglishCounter      = pdhDLL.NewProc("PdhAddEnglishCounterW")
	pdhCloseQuery             = pdhDLL.NewProc("PdhCloseQuery")
	pdhCollectQueryData       = pdhDLL.NewProc("PdhCollectQueryData")
	pdhGetFormattedCounterArr = pdhDLL.NewProc("PdhGetFormattedCounterArrayW")
)

type pdhFmtCounterValue struct {
	status      uint32
	doubleValue float64
}

type pdhFmtCounterValueItem struct {
	name  *uint16
	value pdhFmtCounterValue
}

type pdhFormattedItem struct {
	name  string
	value pdhFmtCounterValue
}

type windowsGPUProcessSampler struct {
	query   uintptr
	counter uintptr
	started bool
}

func newGPUProcessSampler() gpuProcessSampler {
	return &windowsGPUProcessSampler{}
}

func (s *windowsGPUProcessSampler) sample(ctx context.Context, observations []processObservation) map[processGPUKey]float64 {
	result := make(map[processGPUKey]float64)
	if ctx.Err() != nil {
		return result
	}
	if !s.started {
		if !s.open() {
			return result
		}
		status, _, _ := pdhCollectQueryData.Call(s.query)
		if uint32(status) != pdhSuccess {
			return result
		}
		s.started = true
		return result
	}
	status, _, _ := pdhCollectQueryData.Call(s.query)
	if uint32(status) != pdhSuccess {
		return result
	}
	items, ok := s.formattedItems()
	if !ok {
		return result
	}
	candidates := make(map[int32]processGPUKey, len(observations))
	for _, observation := range observations {
		candidates[observation.item.PID] = processGPUKey{pid: observation.item.PID, started: observation.started}
	}
	for _, item := range items {
		pid, ok := gpuEnginePID(item.name)
		if !ok || !pdhValueStatusOK(item.value.status) {
			continue
		}
		key, ok := candidates[pid]
		if !ok {
			continue
		}
		value, ok := validGPUPercent(item.value.doubleValue)
		if !ok {
			continue
		}
		if previous, exists := result[key]; !exists || value > previous {
			result[key] = value
		}
	}
	return result
}

func pdhValueStatusOK(status uint32) bool {
	return status == pdhSuccess || status == pdhNewData
}

func (s *windowsGPUProcessSampler) open() bool {
	var query, counter uintptr
	status, _, _ := pdhOpenQuery.Call(0, 0, uintptr(unsafe.Pointer(&query)))
	if uint32(status) != pdhSuccess {
		return false
	}
	path, err := windows.UTF16PtrFromString(`\GPU Engine(*)\Utilization Percentage`)
	if err != nil {
		_, _, _ = pdhCloseQuery.Call(query)
		return false
	}
	status, _, _ = pdhAddEnglishCounter.Call(query, uintptr(unsafe.Pointer(path)), 0, uintptr(unsafe.Pointer(&counter)))
	if uint32(status) != pdhSuccess {
		_, _, _ = pdhCloseQuery.Call(query)
		return false
	}
	s.query, s.counter = query, counter
	return true
}

func (s *windowsGPUProcessSampler) formattedItems() ([]pdhFormattedItem, bool) {
	var size, count uint32
	statusValue, _, _ := pdhGetFormattedCounterArr.Call(s.counter, uintptr(pdhFormatDouble|pdhFormatNoCap100), uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&count)), 0)
	status := uint32(statusValue)
	if status != pdhMoreData && status != pdhSuccess || size == 0 {
		return nil, false
	}
	buffer := make([]byte, size)
	statusValue, _, _ = pdhGetFormattedCounterArr.Call(s.counter, uintptr(pdhFormatDouble|pdhFormatNoCap100), uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&buffer[0])))
	status = uint32(statusValue)
	if status != pdhSuccess || count == 0 {
		return nil, false
	}
	itemSize := unsafe.Sizeof(pdhFmtCounterValueItem{})
	if itemSize == 0 || uint64(count)*uint64(itemSize) > uint64(len(buffer)) {
		return nil, false
	}
	items := unsafe.Slice((*pdhFmtCounterValueItem)(unsafe.Pointer(&buffer[0])), int(count))
	result := make([]pdhFormattedItem, 0, len(items))
	for _, item := range items {
		// The name points into the temporary PDH buffer. Copy its value before
		// the buffer can be released and leave the struct's numeric fields intact.
		result = append(result, pdhFormattedItem{name: windows.UTF16PtrToString(item.name), value: item.value})
	}
	return result, true
}

func gpuEnginePID(instance string) (int32, bool) {
	lower := strings.ToLower(instance)
	start := strings.Index(lower, "pid_")
	if start < 0 {
		return 0, false
	}
	start += len("pid_")
	end := start
	for end < len(lower) && lower[end] >= '0' && lower[end] <= '9' {
		end++
	}
	if end == start {
		return 0, false
	}
	value, err := strconv.ParseInt(lower[start:end], 10, 32)
	return int32(value), err == nil && value > 0
}
