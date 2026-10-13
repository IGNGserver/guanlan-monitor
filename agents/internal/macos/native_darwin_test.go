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
