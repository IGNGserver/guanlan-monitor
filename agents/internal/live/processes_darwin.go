package live

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"
	"github.com/shirou/gopsutil/v4/process"
	"golang.org/x/sys/unix"
)

// Darwin's gopsutil Status() spawns `ps` per PID, and its task-info helpers
// discard proc_pidinfo failures. Read native snapshots directly: no subprocess
// storm, and protected task statistics stay null instead of becoming zero.
func readProcesses(ctx context.Context, epoch string) ([]processObservation, int, error) {
	rows, err := unix.SysctlKinfoProcSlice("kern.proc.all")
	if err != nil {
		return nil, 0, err
	}
	count := len(rows)
	sort.Slice(rows, func(i, j int) bool { return rows[i].Proc.P_pid < rows[j].Proc.P_pid })
	if len(rows) > processReadLimit {
		rows = rows[:processReadLimit]
	}
	library, err := purego.Dlopen("/usr/lib/libSystem.B.dylib", purego.RTLD_LAZY|purego.RTLD_LOCAL)
	if err != nil {
		return nil, count, err
	}
	defer purego.Dlclose(library)
	var pidInfo func(int32, int32, uint64, unsafe.Pointer, int32) int32
	var pidPath func(int32, unsafe.Pointer, uint32) int32
	var timeBase func(unsafe.Pointer) int32
	purego.RegisterLibFunc(&pidInfo, library, "proc_pidinfo")
	purego.RegisterLibFunc(&pidPath, library, "proc_pidpath")
	purego.RegisterLibFunc(&timeBase, library, "mach_timebase_info")
	var scale struct{ numerator, denominator uint32 }
	if timeBase(unsafe.Pointer(&scale)) != 0 || scale.denominator == 0 {
		return nil, count, fmt.Errorf("unavailable_process_timebase")
	}
	result := make([]processObservation, 0, len(rows))
	for _, row := range rows {
		if ctx.Err() != nil {
			return nil, count, ctx.Err()
		}
		pid := row.Proc.P_pid
		started := row.Proc.P_starttime.Sec*1_000_000 + int64(row.Proc.P_starttime.Usec)
		if pid <= 0 || started <= 0 {
			continue
		}
		startedText := time.UnixMicro(started).UTC().Format(time.RFC3339Nano)
		name := unix.ByteSliceToString(row.Proc.P_comm[:])
		var executable [4096]byte
		if pidPath(pid, unsafe.Pointer(&executable[0]), uint32(len(executable))) > 0 {
			name = filepath.Base(unix.ByteSliceToString(executable[:]))
		}
		parent := row.Eproc.Ppid
		item := Process{ID: fmt.Sprintf("%s:%d:%d", epoch, pid, started), PID: pid, ParentPID: &parent, Name: bounded(name), StartedAt: &startedText}
		if state := map[int8]string{1: "idle", 2: "running", 3: "sleeping", 4: "stopped", 5: "zombie"}[row.Proc.P_stat]; state != "" {
			item.Status = &state
		}
		observation := processObservation{item: item, started: started, at: time.Now()}
		var task process.ProcTaskInfo
		if pidInfo(pid, 4 /* PROC_PIDTASKINFO */, 0, unsafe.Pointer(&task), int32(unsafe.Sizeof(task))) == int32(unsafe.Sizeof(task)) {
			total := (float64(task.Total_user) + float64(task.Total_system)) * float64(scale.numerator) / float64(scale.denominator) / 1e9
			observation.total = &total
			rss, threads := uint64(task.Resident_size), int32(task.Threadnum)
			observation.item.MemoryBytes = &rss
			if threads > 0 {
				observation.item.Threads = &threads
			}
		}
		result = append(result, observation)
	}
	return result, count, nil
}
