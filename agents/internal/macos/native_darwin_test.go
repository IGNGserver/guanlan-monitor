//go:build darwin && cgo

package macos

import (
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

func TestNativeMemoryMatchesKernelTotalAndPhysicalAccounting(t *testing.T) {
	value, err := ReadMemory()
	if err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command("/usr/sbin/sysctl", "-n", "hw.memsize").Output()
	if err != nil {
		t.Fatal(err)
	}
	total, err := strconv.ParseUint(strings.TrimSpace(string(output)), 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	if value.Total != total || value.Used > total || value.Available != total-value.Used || value.Compressed > value.Used || value.SwapUsed > value.SwapTotal {
		t.Fatalf("inconsistent native memory: %+v kernelTotal=%d", value, total)
	}
}

func TestNativeInventoryReadsTheRunningMachine(t *testing.T) {
	mounts, err := ReadMounts()
	if err != nil || len(mounts) == 0 {
		t.Fatalf("mounts=%v err=%v", mounts, err)
	}
	root := false
	for _, point := range mounts {
		root = root || point == "/"
	}
	if !root {
		t.Fatalf("no device mounted at /: %v", mounts)
	}
	system, err := ReadSystem(true)
	if err != nil || system.Processes == nil || *system.Processes == 0 || system.OpenFiles == nil || *system.OpenFiles == 0 || len(system.PerfLevels) == 0 {
		t.Fatalf("system=%+v err=%v", system, err)
	}
	if _, err := ReadStorage(false); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadNetwork(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReadGPUClientTime(); err != nil {
		t.Fatal(err)
	}
	// Booleans must decode on every architecture (BOOL is signed char on x86_64).
	if _, err := ReadHardware(); err != nil {
		t.Fatal(err)
	}
}
