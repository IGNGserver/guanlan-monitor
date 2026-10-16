package live

import (
	"context"
	"fmt"
	"sort"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// gopsutil's Windows Ppid/NumThreads each take a full Toolhelp snapshot per PID,
// which makes a process list O(N²). One snapshot already carries PID, parent,
// thread count and image name; only times and working set need a handle.

type processMemoryCounters struct {
	CB                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
}

var procGetProcessMemoryInfo = windows.NewLazySystemDLL("kernel32.dll").NewProc("K32GetProcessMemoryInfo")

type windowsProcessEntry struct {
	pid     uint32
	parent  uint32
	threads uint32
	name    string
}

func snapshotWindowsProcesses() ([]windowsProcessEntry, error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snapshot)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snapshot, &entry); err != nil {
		return nil, err
	}
	var result []windowsProcessEntry
	for {
		result = append(result, windowsProcessEntry{pid: entry.ProcessID, parent: entry.ParentProcessID, threads: entry.Threads, name: windows.UTF16ToString(entry.ExeFile[:])})
		if err := windows.Process32Next(snapshot, &entry); err != nil {
			break
		}
	}
	return result, nil
}

func filetimeSeconds(value windows.Filetime) float64 {
	return float64(uint64(value.HighDateTime)<<32|uint64(value.LowDateTime)) / 1e7
}

func readProcesses(ctx context.Context, epoch string) ([]processObservation, int, error) {
	entries, err := snapshotWindowsProcesses()
	if err != nil {
		return nil, 0, err
	}
	count := len(entries)
	sort.Slice(entries, func(i, j int) bool { return entries[i].pid < entries[j].pid })
	if len(entries) > processReadLimit {
		entries = entries[:processReadLimit]
	}
	result := make([]processObservation, 0, len(entries))
	for _, entry := range entries {
		if ctx.Err() != nil {
			return nil, count, ctx.Err()
		}
		if entry.pid == 0 {
			continue
		}
		handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, entry.pid)
		if err != nil {
			continue
		}
		var created, exited, kernel, user windows.Filetime
		timesErr := windows.GetProcessTimes(handle, &created, &exited, &kernel, &user)
		var memory processMemoryCounters
		memory.CB = uint32(unsafe.Sizeof(memory))
		memoryOK, _, _ := procGetProcessMemoryInfo.Call(uintptr(handle), uintptr(unsafe.Pointer(&memory)), uintptr(memory.CB))
		windows.CloseHandle(handle)
		// Without a start time the PID cannot be told apart from a reused one.
		started := created.Nanoseconds() / int64(time.Millisecond)
		if timesErr != nil || started <= 0 {
			continue
		}
		pid := int32(entry.pid)
		parent := int32(entry.parent)
		startedText := time.UnixMilli(started).UTC().Format(time.RFC3339Nano)
		item := Process{ID: fmt.Sprintf("%s:%d:%d", epoch, pid, started), PID: pid, ParentPID: &parent, Name: bounded(entry.name), StartedAt: &startedText}
		if entry.threads > 0 {
			threads := int32(entry.threads)
			item.Threads = &threads
		}
		if memoryOK != 0 {
			rss := uint64(memory.WorkingSetSize)
			item.MemoryBytes = &rss
		}
		total := filetimeSeconds(kernel) + filetimeSeconds(user)
		result = append(result, processObservation{item: item, started: started, total: &total, at: time.Now()})
	}
	return result, count, nil
}
